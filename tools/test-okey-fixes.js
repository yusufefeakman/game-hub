/* 101 Okey hata düzeltmelerini hedefli doğrular:
   A) açılmadan masa setine taş eklenemez  B) destek bitiminde kazanan 0 ceza
   C) 9+ taş seçim sınırı kalktı  E) metin — + sayfa hatası yok.
   Kullanım: node tools/test-okey-fixes.js  (serve-hub 8124 + CDP 9333 hazırken) */
const http = require('http');
const BASE = process.env.HUB_URL || 'http://127.0.0.1:8124';
const OKEY_URL = `${BASE}/game-hub/games/okey/`;
const CDP = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? ' | ' + extra : ''}`); };

(async () => {
  const version = await getJson(`${CDP}/json/version`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let mid = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++mid; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timeout')); } }, 15000);
  });
  const evaluate = async (sessionId, expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (r.error) throw new Error('eval: ' + JSON.stringify(r.error));
    if (r.result?.exceptionDetails) throw new Error('exc: ' + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  const { targetId } = (await send('Target.createTarget', { url: OKEY_URL })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  await send('Runtime.enable', {}, sessionId);
  await evaluate(sessionId, `window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e)));`);

  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { ready = await evaluate(sessionId, `!!window.__okey`); if (!ready) await sleep(250); }
  check('motor yüklendi', ready);
  if (!ready) { ws.close(); process.exit(1); }

  await evaluate(sessionId, `document.querySelector('[data-ok="start"]').click()`);
  await sleep(600);

  /* insan turu gelene kadar bekle */
  const waitHumanTurn = async () => {
    for (let i = 0; i < 60; i++) {
      const st = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
      if (st.phase === 'play' && !st.busy && st.turn === st.humanIdx) return st;
      await sleep(200);
    }
    return null;
  };
  let st = await waitHumanTurn();
  check('insan turu', !!st);

  /* ---- HATA A: açılmadan extend ---- */
  // Bot 1'e motor destesine (1-9 x 6 renk) uygun bilinen 102 açılış eli ver:
  // karma 9 (6 renk, 54) + karma 8 (6 renk, 48) = 102 + 2 yedek taş
  await evaluate(sessionId, `__okey.debug.deal(1, [[0,9],[1,9],[2,9],[3,9],[4,9],[5,9],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[1,2],[2,4]].map(([c,n])=>({c,n})))`);
  const opened = await evaluate(sessionId, `__okey.debug.openBot(1)`);
  check('bot açılışı masada (test kurulumu)', opened === 'ok', opened);
  st = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
  const tableTiles = st.table.reduce((a, s) => a + s.tiles.length, 0);
  check('masada set var', tableTiles === 12, `setler=${st.table.length} tas=${tableTiles}`);

  // İnsan tek taş seçsin (eldeki ilk taş)
  const handIds = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.hand().map(t=>t.id))`));
  await evaluate(sessionId, `document.querySelector('.ok [data-tid="${handIds[0]}"]').click()`);
  st = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
  check('tek taş seçildi', st.selection.length === 1);
  const glow = await evaluate(sessionId, `!!document.querySelector('.setrow.canext')`);
  check('açılmayan insanda set parlamaz (glow yok)', !glow);
  // sete tıkla -> extend reddedilmeli
  await evaluate(sessionId, `document.querySelector('[data-seti="0"]').click()`);
  const toastTxt = await evaluate(sessionId, `document.querySelector('[data-ok="toast"]').textContent`);
  check('extend reddi: açılış uyarısı', toastTxt.includes('101+ açılış'), toastTxt);
  const st2 = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
  check('masaya taş eklenmedi', st2.table.reduce((a, s) => a + s.tiles.length, 0) === 12);
  const extRes = await evaluate(sessionId, `__okey.doMove({kind:"extend",tile:${handIds[0]},setIdx:0})`);
  check('doMove extend hook reddi', extRes === 'not-opened', extRes);

  /* ---- HATA C: 16 taşlık seçim sınırı ---- */
  // önceki seçimi temizle, 12 taş seç
  await evaluate(sessionId, `document.querySelector('.ok [data-tid="${handIds[0]}"]').click()`);
  for (let k = 1; k <= 12; k++) await evaluate(sessionId, `document.querySelector('.ok [data-tid="${handIds[k]}"]').click()`);
  st = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
  check('12 taş seçilebildi (eski sınır 9)', st.selection.length === 12, `secim=${st.selection.length}`);
  for (let k = 1; k <= 12; k++) await evaluate(sessionId, `document.querySelector('.ok [data-tid="${handIds[k]}"]').click()`);

  /* ---- HATA B: destek bitimi — kazanan 0 ceza ---- */
  // Bot 2 açılış yapamayan elle kilitlenmesin
  await evaluate(sessionId, `__okey.debug.deal(2, [[0,1],[1,3],[2,5],[3,7],[4,9],[5,2],[0,4],[1,6],[2,8],[3,1],[4,3],[5,5],[0,7],[1,9],[2,1]].map(([c,n])=>({c,n})))`);
  await evaluate(sessionId, `__okey.debug.setPool(0)`);
  // 3 ardışık pas -> pool düğümü
  for (let p = 0; p < 8; p++) {
    const s = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
    if (s.phase !== 'play') break;
    if (!s.busy && s.turn === s.humanIdx) await evaluate(sessionId, `__okey.pass()`);
    await sleep(400);
  }
  const fin = JSON.parse(await evaluate(sessionId, `JSON.stringify(__okey.state())`));
  check('destek bitimi turu bitirdi', fin.phase === 'roundEnd' || fin.phase === 'matchEnd', fin.phase);
  const pens = fin.players.map((p) => p.penalty);
  const zeroCount = pens.filter((x) => x === 0).length;
  const sumPos = pens.filter((x) => x > 0).reduce((a, x) => a + x, 0);
  check('kazanan 0 ceza, diğerleri el toplamı', zeroCount === 1 && sumPos > 0, `cezalar=${pens.join(',')}`);
  const scores = fin.players.map((p) => p.score);
  check('ceza skora işlendi', scores.some((x) => x < 0), `skorlar=${scores.join(',')}`);

  const errs = JSON.parse(await evaluate(sessionId, `JSON.stringify(window.__errs)`));
  check('sayfa hatası yok', errs.length === 0, errs.join(' | '));

  ws.close();
  console.log(fails === 0 ? '\n✅ Hata düzeltmeleri TEMİZ' : `\n❌ ${fails} test BAŞARISIZ`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('KRİTİK:', e); process.exit(2); });
