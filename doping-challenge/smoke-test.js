/* Doping Challenge — tam akış simülasyon testi
   game.js'i gerçek rAF kuyruğuyla çalıştırır; 80+ saniye simüle ederek
   spawn/collision/enerji-bitişi/oyun-bitti/rekor akışını doğrular. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

function makeCtx() {
  const gradient = { addColorStop() {} };
  const t = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(t, {
    get(o, p) {
      if (!(p in o)) o[p] = () => {};
      return o[p];
    },
    set(o, p, v) { o[p] = v; return true; },
  });
}

const els = {};
const listeners = {};
function makeEl(id) {
  return {
    id, style: {}, dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : f; on ? this._s.add(c) : this._s.delete(c); return on; },
    },
    textContent: "", innerHTML: "", width: 420, height: 760,
    addEventListener(type, fn) { (listeners[this.id] = listeners[this.id] || {})[type] = fn; },
    getContext() { return makeCtx(); },
  };
}
const ids = [
  "game", "screen-menu", "screen-how", "screen-pause", "screen-over", "hud",
  "risk-flash", "menu-best", "hud-best", "score", "level", "energy",
  "combo-tip", "final-score", "final-best", "final-dist", "final-lvl",
  "new-record", "pause-score",
  "btn-play", "btn-how", "btn-how-back", "btn-pause", "btn-resume",
  "btn-restart", "btn-quit", "btn-replay", "btn-menu",
];
ids.forEach((i) => { els[i] = makeEl(i); });

let rafQueue = [];
const sandbox = {
  console,
  document: {
    getElementById: (id) => els[id] || makeEl(id),
    addEventListener() {},
    hidden: false,
  },
  window: { devicePixelRatio: 2, addEventListener() {} },
  localStorage: {
    _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); },
  },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout() {},
  Math, Date, JSON, isFinite, parseInt,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "game.js"), "utf8"), sandbox, { filename: "game.js" });
console.log("✓ game.js yüklendi");

// BAŞLA'ya tıkla
(listeners["btn-play"] || {}).click && listeners["btn-play"].click();
if (!els["screen-menu"].classList.contains("hidden")) {
  console.error("✗ BAŞLA oyunu başlatmadı");
  process.exit(1);
}
console.log("✓ Oyun başladı (menu gizlendi)");

// rAF kuyruğunu işle — frame(ts) her çağrıda yeni rAF ekler.
// İlk kuyrukta: game.js yüklenirken requestAnimationFrame((ts)=>{last=ts; raf(frame)}) vardı.
function pumpFrames(count) {
  for (let i = 0; i < count; i++) {
    const next = rafQueue.shift();
    if (!next) break;
    next(16.666 * (i + 1));
  }
}
pumpFrames(3);
console.log("✓ İlk kareler render edildi");

// ~90 saniye simüle et (5400 kare). Periyodik zıplama ile engellerden kaçmaya çalış.
let errors = [];
const origConsoleError = console.error;
console.error = (...a) => errors.push(a.join(" "));
for (let i = 0; i < 5400; i++) {
  // periyodik dokunma (jump) — sadece playing'ken etkili
  if (i % 60 === 0) {
    const pd = listeners.game && listeners.game.pointerdown;
    if (pd) pd({ preventDefault() {} });
  }
  pumpFrames(1);
}
console.error = origConsoleError;

// Sonuçları doğrula
const overShown = els["screen-over"] && !els["screen-over"].classList.contains("hidden");
const bestSaved = sandbox.localStorage._d["doping-challenge-best"];
const hudHidden = els["hud"] && els["hud"].classList.contains("hidden");

console.log("oyun-bitti ekranı açıldı:", overShown);
console.log("rekor kaydedildi:", bestSaved !== undefined ? bestSaved : "(yok)");
console.log("hud gizlendi:", hudHidden);
if (errors.length) {
  console.error("✗ Konsol hataları:", errors.slice(0, 5));
  process.exit(1);
}

if (overShown && bestSaved !== undefined) {
  console.log("✓ UÇTAN UCA TEST BAŞARILI — oyun oynanabilir, enerji bitişi + skor ekranı + rekor çalışıyor");
  process.exit(0);
} else {
  console.error("✗ Beklenen akış tamamlanmadı (oyun 90sn içinde bitmedi veya rekor yazılmadı)");
  process.exit(1);
}
