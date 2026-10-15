/* Astro Blaster headless doğrulama: sayfa yüklenir, JS hataları toplanır,
   oyun başlatılır, fırlatma, palet, blok çarpışması, bölüm geçişi,
   kaybetme, kazanma ve rekor kaydı test kancası (__astroTest) üzerinden doğrulanır.
   Kullanım: node tools/verify-astro-blaster.js  (serve-hub 8124 + CDP 9333 hazırken) */
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
  const poll = async (expr, pred, timeoutMs = 8000, step = 150) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = await evaluate(sessionId, expr);
      if (pred(v)) return v;
      await sleep(step);
    }
    return evaluate(sessionId, expr);
  };

  // 1) Page load
  events.length = 0;
  await send('Page.navigate', { url: BASE + '/game-hub/games/astro-blaster/' }, sessionId);
  await sleep(3500);
  const li = JSON.parse(await evaluate(sessionId, `JSON.stringify({
    canvas: document.querySelectorAll('canvas').length,
    cw: document.querySelector('canvas')?.width,
    ch: document.querySelector('canvas')?.height,
    title: document.title,
  })`) || '{}');
  check('Sayfa yüklendi, canvas mevcut', li.canvas === 1, JSON.stringify(li));

  // 2) rAF loop alive
  const raf = await evaluate(sessionId, `(async()=>{let f=0;const t0=performance.now();await new Promise(r=>{const tick=()=>{f++;if(performance.now()-t0>1200){r()}else{requestAnimationFrame(tick)}};requestAnimationFrame(tick)});return f})()`);
  check('rAF döngüsü çalışıyor', raf > 10, `raf=${raf}`);

  // 3) Test hook present, state start
  const h0 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__astroTest;
    return JSON.stringify({ has: !!t, state: t && t.state, lives: t && t.lives });
  })()`) || '{}');
  check('Test kancası hazır, başlangıç ekranı', h0.has && h0.state === 'start', JSON.stringify(h0));

  // 4) Start → playing, 3 lives, 1 stuck ball
  await evaluate(sessionId, `window.__astroTest.start()`);
  await sleep(200);
  const s1 = JSON.parse(await evaluate(sessionId, `JSON.stringify({
    state: window.__astroTest.state, lives: window.__astroTest.lives,
    level: window.__astroTest.level, stuck: window.__astroTest.stuckBalls,
    blocks: window.__astroTest.blocksBreakable,
  })`));
  check('Start: playing, 3 can, 1 bağlı top, bloklar dolu', s1.state === 'playing' && s1.lives === 3 && s1.stuck === 1 && s1.blocks > 0, JSON.stringify(s1));

  // 5) Launch → ball free
  await evaluate(sessionId, `window.__astroTest.launch()`);
  await sleep(150);
  const s2 = JSON.parse(await evaluate(sessionId, `JSON.stringify({ stuck: window.__astroTest.stuckBalls, ball: window.__astroTest.ballAt(0) })`));
  check('Fırlatma: top serbest, hareket ediyor', s2.stuck === 0 && s2.ball && Math.abs(s2.ball.vy) > 0, JSON.stringify(s2));

  // 6) Paddle move
  const s3 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__astroTest;
    t.movePaddle(200);
    return JSON.stringify({ x: t.paddleX });
  })()`));
  check('Palet hareketi', Math.abs(s3.x - 200) < 3, JSON.stringify(s3));

  // 7) Block collision → score up
  const s4 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__astroTest;
    const score0 = t.score;
    const blocks0 = t.blocksBreakable;
    // Blok (0,0) merkezi ~ (75,77); topu bloğun altına koyup yukarı gönder
    t.setBall(75, 130, 0, -420);
    return JSON.stringify({ score0, blocks0 });
  })()`));
  await poll(`JSON.stringify({ score: window.__astroTest.score, blocks: window.__astroTest.blocksBreakable })`,
    (v) => { const o = JSON.parse(v); return o.score > s4.score0; }, 4000);
  const s4b = JSON.parse(await evaluate(sessionId, `JSON.stringify({ score: window.__astroTest.score, blocks: window.__astroTest.blocksBreakable })`));
  check('Blok çarpışması: skor arttı', s4b.score > s4.score0, JSON.stringify({ ...s4, after: s4b }));

  // 8) Level clear → next level
  await evaluate(sessionId, `window.__astroTest.breakAllBreakable()`);
  const s5 = await poll(`window.__astroTest.level`, (v) => v >= 2, 8000);
  check('Bölüm temizlenince sonraki bölüme geçiş', s5 >= 2, `level=${s5}`);

  // 9) Pause / resume
  const s6 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__astroTest;
    t.togglePause();
    const paused = t.state;
    t.togglePause();
    return JSON.stringify({ paused, resumed: t.state });
  })()`));
  check('Pause/resume (P)', s6.paused === 'paused' && s6.resumed === 'playing', JSON.stringify(s6));

  // 10) Game over → best recorded
  const s7 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__astroTest;
    t.loseAllLives();
    return JSON.stringify({ state: t.state, best: t.best, newBest: t.newBest });
  })()`));
  check('Canlar bitince game over + rekor', s7.state === 'gameover' && s7.best > 0, JSON.stringify(s7));

  // 11) localStorage raw
  const raw = await evaluate(sessionId, `localStorage.getItem('astro-blaster-best')`);
  check('localStorage ham kaydı', raw && Number(raw) > 0, `value=${raw}`);

  // 12) Victory
  const s8 = JSON.parse(await evaluate(sessionId, `(() => {
    const t = window.__astroTest;
    t.start();
    t.forceVictory();
    return JSON.stringify({ started: true });
  })()`));
  const s8b = await poll(`window.__astroTest.state`, (v) => v === 'victory', 6000);
  check('Tüm bölümler bitince zafer', s8b === 'victory', `state=${s8b}`);

  // 13) Canvas updates
  const pix = await evaluate(sessionId, `(() => {
    const c = document.querySelector('canvas');
    const t = window.__astroTest;
    t.start(); t.launch();
    const a = c.toDataURL().length;
    return new Promise(res => setTimeout(() => res(c.toDataURL().length !== a), 300));
  })()`);
  check('Canvas güncelleniyor', pix === true, `pix=${pix}`);

  // 14) No JS exceptions
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown');
  check('JS istisna yok', errs.length === 0, errs.length ? errs[0].params.exceptionDetails?.text : '');

  await send('Target.closeTarget', { targetId }).catch(() => {});
  ws.close();

  console.log(failures === 0 ? '\n✅ Astro Blaster tüm kontrollerden geçti' : `\n❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('KRİTİK HATA:', e); process.exit(2); });
