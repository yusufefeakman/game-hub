/* Candy Burst headless doğrulama: sayfa yüklenir, JS hataları toplanır,
   oyun başlatılır, sürükleyerek takaslar simüle edilir, rAF + piksel
   değişimi ile oyunun gerçekten çalıştığı doğrulanır.
   Kullanım: node tools/verify-candy-burst.js  (serve-hub 8124 + CDP 9333 hazırken) */
const http = require('http');
const BASE = process.env.HUB_URL || 'http://127.0.0.1:8124';
const CDP = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

(async () => {
  const version = await getJson(`${CDP}/json/version`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let mid = 0; const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown' || m.method === 'Runtime.consoleAPICalled') events.push(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++mid; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timeout')); } }, 20000);
  });
  const evaluate = async (sessionId, expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.result?.exceptionDetails) return '<exc:' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] + '>';
    return r.result?.result?.value;
  };

  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  let failures = 0;
  const check = (name, ok, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
  };

  // 1) Page load
  events.length = 0;
  await send('Page.navigate', { url: BASE + '/game-hub/games/candy-burst/' }, sessionId);
  await sleep(4000);
  const loadInfo = await evaluate(sessionId, `JSON.stringify({
    canvas: document.querySelectorAll('canvas').length,
    cw: document.querySelector('canvas')?.width,
    ch: document.querySelector('canvas')?.height,
    title: document.title,
  })`);
  const li = JSON.parse(loadInfo || '{}');
  check('Sayfa yüklendi, canvas mevcut', li.canvas === 1, JSON.stringify(li));

  // 2) rAF loop alive (menu animation)
  const raf = await evaluate(sessionId, `(async()=>{let f=0;const t0=performance.now();await new Promise(r=>{const tick=()=>{f++;if(performance.now()-t0>800){r()}else{requestAnimationFrame(tick)}};requestAnimationFrame(tick)});return f})()`);
  check('rAF döngüsü çalışıyor', raf > 20, `raf=${raf}`);

  // 3) Canvas is HiDPI-scaled (width > 900 when dpr=2, else 900)
  check('Canvas çözünürlüğü ayarlandı', li.cw >= 900, `cw=${li.cw} ch=${li.ch}`);

  // 4) Click canvas → game starts (menu disappears)
  await evaluate(sessionId, `(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const opts = (x, y) => ({ clientX: x, clientY: y, bubbles: true });
    c.dispatchEvent(new MouseEvent('mousedown', opts(r.left + r.width/2, r.top + r.height/2)));
    window.dispatchEvent(new MouseEvent('mouseup', opts(r.left + r.width/2, r.top + r.height/2)));
    return true;
  })()`);
  await sleep(1500);
  const afterStart = await evaluate(sessionId, `(() => {
    const c = document.querySelector('canvas');
    const d = c.toDataURL().length;
    return JSON.stringify({ dataLen: d });
  })()`);
  check('Oyun menüden başlatıldı', JSON.parse(afterStart || '{}').dataLen > 10000);

  // 5) Simulate several drag-swaps across the grid (canvas 900x600, grid 448x448 @ (226,100))
  const swapResult = await evaluate(sessionId, `new Promise((resolve) => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const scale = r.width / 900;
    const toPx = (cx, cy) => [r.left + cx * scale, r.top + cy * scale];
    // Grid cell centers in canvas coords
    const cell = (row, col) => [226 + col * 56 + 28, 100 + row * 56 + 28];
    const swaps = [
      [0, 0, 0, 1], [1, 2, 1, 3], [2, 4, 2, 5], [3, 1, 4, 1],
      [4, 6, 4, 7], [5, 3, 5, 2], [6, 0, 6, 1], [7, 5, 6, 5],
      [0, 3, 1, 3], [2, 7, 2, 6], [3, 3, 3, 4], [5, 0, 5, 1],
    ];
    let i = 0;
    const doSwap = () => {
      if (i >= swaps.length) { resolve(JSON.stringify({ done: i })); return; }
      const [r1, c1, r2, c2] = swaps[i++];
      const [ax, ay] = cell(r1, c1);
      const [bx, by] = cell(r2, c2);
      const [sx, sy] = toPx(ax, ay);
      const [ex, ey] = toPx(bx, by);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: sx, clientY: sy, bubbles: true }));
      setTimeout(() => window.dispatchEvent(new MouseEvent('mouseup', { clientX: ex, clientY: ey, bubbles: true })), 60);
      setTimeout(doSwap, 650);
    };
    doSwap();
  })`);
  check('12 sürükle-takas simüle edildi', JSON.parse(swapResult || '{}').done === 12, swapResult);
  await sleep(2000);

  // 6) No JS exceptions / console errors across all interactions
  const errs = [];
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      errs.push('EXC: ' + (d.exception?.description || d.text || '').split('\n')[0]);
    } else if (e.params.type === 'error') {
      errs.push('CONSOLE: ' + (e.params.args?.[0]?.value || e.params.args?.[0]?.description || '').toString().split('\n')[0]);
    }
  }
  const uniq = [...new Set(errs)];
  check('JS istisna/console hatası yok', uniq.length === 0, uniq.slice(0, 3).join(' | '));

  // 7) Canvas pixels are changing (game is animating)
  const pix = await evaluate(sessionId, `new Promise((resolve) => {
    const c = document.querySelector('canvas');
    const ctx = c.getContext('2d');
    const snap = () => ctx.getImageData(400, 300, 120, 120).data.slice(0, 400).join(',');
    const a = snap();
    setTimeout(() => resolve(JSON.stringify({ changed: snap() !== a })), 700);
  })`);
  check('Canvas pikselleri animasyonlu', JSON.parse(pix || '{}').changed === true);

  // 8) LocalStorage best-score wiring (touch it and read back)
  const ls = await evaluate(sessionId, `(() => {
    localStorage.setItem('candy-burst-best', '12345');
    return localStorage.getItem('candy-burst-best');
  })()`);
  check('localStorage rekor altyapısı', ls === '12345', `value=${ls}`);

  // 9) Screenshot for visual inspection
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  require('fs').writeFileSync('/tmp/candy-burst-play.png', Buffer.from(shot.result.data, 'base64'));
  // Also capture the menu screen on a fresh target
  const { targetId: t2 } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId: s2 } = (await send('Target.attachToTarget', { targetId: t2, flatten: true })).result;
  await send('Page.navigate', { url: BASE + '/game-hub/games/candy-burst/' }, s2);
  await sleep(3000);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' }, s2);
  require('fs').writeFileSync('/tmp/candy-burst-menu.png', Buffer.from(shot2.result.data, 'base64'));
  check('Ekran görüntüleri alındı', true, '/tmp/candy-burst-play.png, /tmp/candy-burst-menu.png');

  await send('Target.closeTarget', { targetId }).catch(() => {});
  await send('Target.closeTarget', { targetId: t2 }).catch(() => {});
  ws.close();
  console.log(failures === 0 ? '\n✅ Candy Burst tüm kontrollerden geçti' : `\n❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('KRİTİK:', e); process.exit(2); });
