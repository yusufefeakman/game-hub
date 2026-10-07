/* 101 Okey motorunu headless Chrome (CDP) ile gerçek oyunla doğrular:
   oyun kurar, insan oyuncu ipucu motoruyla hamleler yapar, turları ilerletir,
   sayfa hatalarını ve kural ihlallerini toplar.

   Kullanım: node tools/verify-okey.js  (out/ + tools/serve-hub.js 8124 hazırken) */
const http = require('http');

const BASE = process.env.HUB_URL || 'http://127.0.0.1:8124';
const OKEY_URL = `${BASE}/game-hub/games/okey/`;
const CDP = 'http://127.0.0.1:9333';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`);
};

(async () => {
  const version = await getJson(`${CDP}/json/version`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let mid = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++mid;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timeout')); } }, 15000);
    });
  const evaluate = async (sessionId, expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (r.error) throw new Error('eval: ' + JSON.stringify(r.error));
    if (r.result?.exceptionDetails) throw new Error('exc: ' + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  /* --- hedef: oyun sayfası --- */
  const { targetId } = (await send('Target.createTarget', { url: OKEY_URL })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  await send('Runtime.enable', {}, sessionId);

  /* sayfa hatalarını topla */
  await evaluate(sessionId, `window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e)));`);

  /* motor yüklenene kadar bekle */
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    ready = await evaluate(sessionId, `!!window.__okey`);
    if (!ready) await sleep(250);
  }
  check('motor yüklendi (__okey)', ready);
  if (!ready) { ws.close(); process.exit(1); }

  check('ipucu butonu var', await evaluate(sessionId, `!!document.querySelector('[data-ok="hint"]')`));
  check('ses butonu var', await evaluate(sessionId, `!!document.querySelector('[data-ok="sound"]')`));

  /* 3 oyunculu maç başlat */
  await evaluate(sessionId, `document.querySelector('[data-ok="start"]').click()`);
  await sleep(400);

  let roundsSeen = 0;
  let matchesPlayed = 0;
  let humanMoves = 0, humanPasses = 0, hintsUsed = 0, humanPenaltyMax = 0;

  for (let step = 0; step < 1600 && matchesPlayed < 3; step++) {
    const st = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
    humanPenaltyMax = Math.max(humanPenaltyMax, st.players[st.humanIdx].penalty ?? 0);
    if (st.phase === 'roundEnd' || st.phase === 'matchEnd') {
      if (st.phase === 'matchEnd') matchesPlayed++;
      else roundsSeen++;
      await evaluate(sessionId, `__okey.next()`);
      await sleep(300);
      continue;
    }
    if (!st.busy && st.turn === st.humanIdx) {
      /* bazen ipucu akışını da test et (modüler step bot tur adımıyla korelasyonlu — rastgele seç) */
      const tryHint = Math.random() < 0.25;
      let spec = null;
      if (tryHint) {
        await evaluate(sessionId, `document.querySelector('[data-ok="hint"]').click()`);
        hintsUsed++;
      } else {
        spec = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.suggest())`));
      }
      if (spec) {
        const res = await evaluate(sessionId, `__okey.doMove(${JSON.stringify(spec)})`);
        if (res === 'ok') humanMoves++;
        else console.log('  move sonuc:', res);
      } else {
        const res = await evaluate(sessionId, `__okey.pass()`);
        if (res === 'ok') humanPasses++;
      }
    }
    await sleep(140);
  }

  check('en az 1 tur tamamlandı', roundsSeen >= 1, `tur=${roundsSeen}`);
  /* Gerçek 101 Okey: ilk elden 101+ açılış nadirdir (~%1) — oyuncu ya açar
     ya da 3 pas kuralıyla ceza yazar. Harness insanı ikisinden birini yapmalı. */
  check('insan oyuncu set açtı veya ceza aldı', humanMoves >= 1 || humanPenaltyMax >= 1,
    `hamle=${humanMoves} ceza=${humanPenaltyMax}`);
  check('insan oyuncu geçti (açılış zor)', humanPasses >= 1, `geçiş=${humanPasses}`);
  check('ipucu kullanıldı', hintsUsed >= 1, `ipucu=${hintsUsed}`);

  const finalState = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
  console.log('final faz:', finalState.phase, '| son maç puanları:', finalState.players.map((p) => p.score).join(', '));

  const errs = JSON.parse(await evaluate(sessionId, `JSON.stringify(window.__errs)`));
  check('sayfa hatası yok', errs.length === 0, errs.join(' | '));

  check('maç -101 hedefiyle bitti', matchesPlayed >= 1, `maç=${matchesPlayed}`);

  ws.close();
  console.log(fails === 0 ? '\n✅ 101 Okey doğrulama TEMİZ' : `\n❌ ${fails} doğrulama BAŞARISIZ`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('KRİTİK:', e); process.exit(2); });
