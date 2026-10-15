/* Mayın Tarlası headless doğrulama: sayfa yüklenir, JS hataları toplanır,
   oyun başlatılır, ilk tık güvenli, bayrak, chord, kaybetme, kazanma ve
   rekor kaydı test kancası (__mineTest) üzerinden doğrulanır.
   Kullanım: node tools/verify-mayin-tarlasi.js  (serve-hub 8124 + CDP 9333 hazırken) */
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
  await send('Page.navigate', { url: BASE + '/game-hub/games/mayin-tarlasi/' }, sessionId);
  await sleep(3500);
  const li = JSON.parse(await evaluate(sessionId, `JSON.stringify({
    canvas: document.querySelectorAll('canvas').length,
    cw: document.querySelector('canvas')?.width,
    ch: document.querySelector('canvas')?.height,
    title: document.title,
  })`) || '{}');
  check('Sayfa yüklendi, canvas mevcut', li.canvas === 1, JSON.stringify(li));

  // 2) rAF loop alive
  const raf = await evaluate(sessionId, `(async()=>{let f=0;const t0=performance.now();await new Promise(r=>{const tick=()=>{f++;if(performance.now()-t0>1500){r()}else{requestAnimationFrame(tick)}};requestAnimationFrame(tick)});return f})()`);
  check('rAF döngüsü çalışıyor', raf > 10, `raf=${raf}`);

  // 3) Test hook present, phase menu
  const hook0 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    return JSON.stringify({ has: !!t, phase: t && t.phase, reset: !!t && typeof t.reset === 'function' });
  })()`) || '{}');
  check('Test kancası hazır, menüde', hook0.has && hook0.phase === 'menu', JSON.stringify(hook0));

  // 4) Click BAŞLA → playing, started false
  await evaluate(sessionId, `(() => {
    const b = document.querySelector('#mt-play');
    if (b) b.click();
    return true;
  })()`);
  await sleep(200);
  const s1 = JSON.parse(await evaluate(sessionId, `JSON.stringify({ phase: window.__mineTest.phase, started: window.__mineTest.started, mines: window.__mineTest.mines })`));
  check('BAŞLA: playing, henüz mayın yok', s1.phase === 'playing' && s1.started === false && s1.mines === 0, JSON.stringify(s1));

  // 5) First click → started, 20 mines, clicked cell safe+revealed
  const s2 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    t.revealAt(8, 5);
    return JSON.stringify({
      started: t.started, mines: t.mines,
      revealed: t.revealed,
      clickedSafe: !t.isMine(5 * 16 + 8) && t.isRevealed(5 * 16 + 8),
    });
  })()`));
  check('İlk tık güvenli: 20 mayın, hücre açıldı', s2.started === true && s2.mines === 20 && s2.clickedSafe, JSON.stringify(s2));

  // 6) Flag a cell
  const s3 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    // Açılmamış, mayın olmayan bir hücre bul, bayrakla
    for (let i = 0; i < 160; i++) {
      if (!t.isRevealed(i) && !t.isMine(i) && !t.isFlagged(i)) { t.flagAt(i % 16, Math.floor(i / 16)); return JSON.stringify({ flags: t.flags, flagged: t.isFlagged(i) }); }
    }
    return JSON.stringify({ flags: t.flags, flagged: false });
  })()`));
  check('Bayrak dikildi', s3.flags === 1 && s3.flagged === true, JSON.stringify(s3));

  // 7) Chord: numbered revealed cell + exact flags → neighbors open
  const s4 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      if (!t.isRevealed(i)) continue;
      const n = t.neighborCount(x, y);
      if (n === 0) continue;
      const nbrs = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < 16 && ny >= 0 && ny < 10) nbrs.push(ny * 16 + nx);
      }
      const mineNbrs = nbrs.filter(c => t.isMine(c) && !t.isFlagged(c));
      if (mineNbrs.length !== n) continue;
      // En az bir komşu açık değilse anlamlı
      if (!nbrs.some(c => !t.isRevealed(c) && !t.isMine(c))) continue;
      for (const c of mineNbrs) t.flagAt(c % 16, Math.floor(c / 16));
      const before = t.revealed;
      t.chordAt(x, y);
      return JSON.stringify({ x, y, n, before, after: t.revealed, phase: t.phase, opened: t.revealed - before });
    }
    return JSON.stringify({ found: false, phase: t.phase });
  })()`));
  check('Chord: komşular açıldı, oyun sürüyor', s4.found !== false && s4.phase === 'playing' && s4.opened > 0, JSON.stringify(s4));

  // 8) Reset
  const s5 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    t.reset();
    return JSON.stringify({ phase: t.phase, started: t.started, mines: t.mines, revealed: t.revealed });
  })()`));
  check('↻ Sıfırlama: temiz playing', s5.phase === 'playing' && s5.started === false && s5.revealed === 0, JSON.stringify(s5));

  // 9) Lose: reveal a mine
  const s6 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    t.revealAt(3, 3);
    for (let i = 0; i < 160; i++) if (t.isMine(i)) { t.revealAt(i % 16, Math.floor(i / 16)); break; }
    return JSON.stringify({ phase: t.phase });
  })()`));
  check('Mayına basılınca kaybetme', s6.phase === 'lost', JSON.stringify(s6));

  // 10) Win: reveal all non-mines → won + best saved
  const s7 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    t.reset();
    t.revealAt(0, 0);
    for (let i = 0; i < 160; i++) if (!t.isMine(i)) t.revealAt(i % 16, Math.floor(i / 16));
    return JSON.stringify({ phase: t.phase, revealed: t.revealed, best: t.best });
  })()`));
  check('Tüm güvenli hücreler açılınca kazanma', s7.phase === 'won' && s7.revealed === 140, JSON.stringify(s7));
  check('Rekor mekanizması çalıştı (sonlu süre yazıldı)', s7.best && Number.isFinite(s7.best.easy), JSON.stringify(s7.best));

  // 11) localStorage raw
  const raw = await evaluate(sessionId, `localStorage.getItem('mayin-tarlasi-best')`);
  check('localStorage ham kaydı okunabilir', raw && raw.includes('easy'), `value=${raw}`);

  // 12) Canvas gerçekten güncelleniyor (reset + reveal → board değişti)
  const pix = await evaluate(sessionId, `(() => {
    const t = window.__mineTest;
    const c = document.querySelector('canvas');
    t.reset();
    const a = c.toDataURL().length;
    t.revealAt(4, 4);
    return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(c.toDataURL().length !== a))));
  })()`);
  check('Canvas reveal sonrası güncelleniyor', pix === true, `pix=${pix}`);

  // 13) No JS exceptions
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown');
  check('JS istisna yok', errs.length === 0, errs.length ? errs[0].params.exceptionDetails?.text : '');

  await send('Target.closeTarget', { targetId }).catch(() => {});
  ws.close();

  console.log(failures === 0 ? '\n✅ Mayın Tarlası tüm kontrollerden geçti' : `\n❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('KRİTİK HATA:', e); process.exit(2); });
