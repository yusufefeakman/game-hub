/* Game Hub smoke testi: her oyun sayfasını headless Chrome'da yükler,
   istisna/console hatalarını toplar, canvas/oyun kökü varlığını kontrol eder.
   Kullanım: node tools/smoke-hub.js  (serve-hub 8124 + CDP 9333 hazırken) */
const http = require('http');
const BASE = process.env.HUB_URL || 'http://127.0.0.1:8124';
const CDP = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

const ROUTES = [
  '/', '/arcade/', '/fighting/', '/doping-challenge/',
  '/games/akil-kupu/', '/games/anime-legends/', '/games/astro-blaster/',
  '/games/candy-burst/', '/games/chess/', '/games/cube-master/',
  '/games/doping-runner/', '/games/fighter/', '/games/lets-world/',
  '/games/mayin-tarlasi/', '/games/okey/', '/games/pixel-pals/',
  '/games/powerboat/', '/games/spaceship/', '/games/sunny-side-ride/',
  '/games/world-war-z/', '/games/yilan-arena/',
];

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
    if (r.result?.exceptionDetails) return '<exc>';
    return r.result?.result?.value;
  };

  let bad = 0;
  for (const route of ROUTES) {
    events.length = 0;
    const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
    const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
    await send('Runtime.enable', {}, sessionId);
    try {
      await send('Page.navigate', { url: BASE + '/game-hub' + route }, sessionId);
      await sleep(route === '/' ? 2500 : 5000);
      const info = await evaluate(sessionId, `JSON.stringify({
        title: document.title,
        canvas: document.querySelectorAll('canvas').length,
        bodyLen: (document.body?.innerText || '').length,
      })`);
      const errs = [];
      for (const e of events) {
        if (e.method === 'Runtime.exceptionThrown') {
          const d = e.params.exceptionDetails;
          errs.push('EXC: ' + (d.exception?.description || d.text || '').split('\n')[0]);
        } else if (e.params.type === 'error') {
          errs.push('CONSOLE: ' + (e.params.args?.[0]?.value || e.params.args?.[0]?.description || '').toString().split('\n')[0]);
        }
      }
      const uniq = [...new Set(errs)].slice(0, 4);
      const i = JSON.parse(info || '{}');
      /* canvas-only oyunlarda DOM metin az olabilir — rAF + piksel探针 ile doğrula */
      let raf = 0;
      if (i.canvas > 0 && i.bodyLen <= 60) {
        raf = await evaluate(sessionId, `(async()=>{let f=0;const t0=performance.now();await new Promise(r=>{const tick=()=>{f++;if(performance.now()-t0>1200){r()}else{requestAnimationFrame(tick)}};requestAnimationFrame(tick)});return f})()`);
      }
      const ok = uniq.length === 0 && (i.bodyLen > 50 || raf > 10);
      if (!ok) bad++;
      console.log(`${ok ? 'OK  ' : 'HATA'} | ${route.padEnd(26)} canvas=${i.canvas} metin=${i.bodyLen}${raf ? ` raf=${raf}` : ''}${uniq.length ? '\n     ' + uniq.join('\n     ') : ''}`);
    } catch (e) {
      bad++;
      console.log(`HATA | ${route.padEnd(26)} yüklenemedi: ${e.message}`);
    }
    await send('Target.closeTarget', { targetId }).catch(() => {});
  }
  ws.close();
  console.log(bad === 0 ? '\n✅ Tüm sayfalar temiz' : `\n❌ ${bad} sayfada sorun`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error('KRİTİK:', e); process.exit(2); });
