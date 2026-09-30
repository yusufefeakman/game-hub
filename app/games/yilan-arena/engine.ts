/* =====================================================================
   YILAN ARENA — Game Engine
   Neon yılan arenasında klasik yılan oyunu: elmalar ye, hızlan, nadir
   yıldız meyveyi kap, altın elmayı kap ve kısa süreliğine hayalet ol
   (duvarlar/dışarı geçebilirsin).
   Tüm grafikler canvas üzerinde prosedürel; sesler Web Audio API ile
   sentezlenir. Dış varlık yok. Mobil uyumlu (kaydırma + ekran butonları).

   Controls:
     Oklar / WASD        — yön
     Space / Enter       — başla / tekrar
     P                   — duraklat
     M                   — ses aç/kapat
     Kaydırma / butonlar — mobil yön

   Public API:
     startGame(canvas) -> () => void
   ===================================================================== */

const W = 960;
const H = 540;
const COLS = 32;
const ROWS = 18;
const CELL = 30;

const BASE_TICK = 185;   // ms / adım
const MIN_TICK = 105;    // en hızlı adım
const GOLD_LIFE = 6;     // sn — altın elma sahnede kalma süresi
const STAR_LIFE = 5;     // sn — yıldız meyve sahnede kalma süresi
const GHOST_TIME = 6;    // sn — altın elma sonrası hayalet modu

const REC_KEY = "yilan-arena-best";

/* ================= 1. AUDIO ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume(); },
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.5, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master!);
    osc.start(t); osc.stop(t + dur + 0.02);
  },
  eat() { this.tone("square", 420, 760, 0.09, 0.4); },
  gold() { this.tone("triangle", 520, 900, 0.12, 0.5); this.tone("triangle", 780, 1300, 0.14, 0.4, 0.09); },
  star() { this.tone("triangle", 880, 1560, 0.1, 0.4); this.tone("sine", 1320, 2100, 0.12, 0.3, 0.08); },
  die() { this.tone("sawtooth", 300, 60, 0.5, 0.5); },
  click() { this.tone("square", 240, 240, 0.05, 0.25); },
};

/* ================= 2. TYPES ================= */
type Phase = "menu" | "playing" | "paused" | "over";
interface Cell { x: number; y: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; }

/* ================= 3. PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  AudioSys.init();
  const g = canvas.getContext("2d")!;
  const container = canvas.parentElement ?? document.body;

  /* ---------- durum ---------- */
  let phase: Phase = "menu";
  let snake: Cell[] = [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }, { x: 5, y: 9 }];
  let dir: Cell = { x: 1, y: 0 };
  let queuedDir: Cell[] = [];
  let grow = 0;
  let score = 0;
  let best = 0;
  let applesEaten = 0;
  let gold: Cell | null = null;
  let goldTimer = 0;
  let star: Cell | null = null;   // nadir bonus yıldız meyve
  let starTimer = 0;
  let ghost = 0;      // kalan hayalet süresi (sn)
  let tickMs = BASE_TICK;
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let particles: Particle[] = [];
  let newRecord = false;
  try { best = Number(localStorage.getItem(REC_KEY)) || 0; } catch { best = 0; }

  /* ---------- DOM ---------- */
  const style = document.createElement("style");
  style.textContent = `
.yla-hud{position:absolute;top:8px;left:12px;right:12px;display:flex;justify-content:space-between;
  pointer-events:none;font-family:'Segoe UI',system-ui,sans-serif;color:#e6f7ff;font-weight:800;
  text-shadow:0 0 8px rgba(52,211,153,.6);font-size:18px;z-index:5}
.yla-hud .mid{font-size:13px;color:#9fe7c8;font-weight:700;text-shadow:none}
.yla-btns{position:absolute;top:6px;right:10px;display:flex;gap:6px;z-index:6}
.yla-btn{background:rgba(10,20,30,.7);border:1px solid rgba(52,211,153,.5);color:#bdf5dd;border-radius:8px;
  width:30px;height:30px;cursor:pointer;font-size:14px;font-weight:900}
.yla-btn:hover{background:rgba(52,211,153,.25)}
.yla-ov{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:10px;background:rgba(3,5,15,.72);backdrop-filter:blur(2px);
  font-family:'Segoe UI',system-ui,sans-serif;color:#fff;text-align:center}
.yla-ov h1{margin:0;font-size:44px;letter-spacing:3px;color:#34d399;text-shadow:0 0 18px rgba(52,211,153,.8)}
.yla-ov h2{margin:0;font-size:15px;font-weight:600;color:#9fb6cc}
.yla-ov p{margin:2px 0;font-size:13px;color:#cfd8e3}
.yla-ov .big{font-size:26px;color:#ffd23f;text-shadow:0 0 12px rgba(255,210,63,.6)}
.yla-play{margin-top:8px;background:linear-gradient(135deg,#34d399,#0891b2);border:none;color:#04121a;
  font-weight:900;font-size:18px;letter-spacing:1px;padding:12px 34px;border-radius:12px;cursor:pointer;
  box-shadow:0 0 24px rgba(52,211,153,.5)}
.yla-play:hover{transform:scale(1.05)}
.yla-rec{color:#ffd23f;font-weight:800}
.yla-pad{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:10px;z-index:6}
.yla-pad button{width:56px;height:56px;border-radius:14px;border:1px solid rgba(52,211,153,.55);
  background:rgba(8,16,28,.65);color:#bdf5dd;font-size:22px;font-weight:900;cursor:pointer;touch-action:none}
.yla-pad button:active{background:rgba(52,211,153,.35)}
@media (min-width:900px){.yla-pad{display:none}}
`;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "yla-hud";
  hud.innerHTML = `<span id="yla-score">Skor: 0</span><span class="mid" id="yla-speed">Hız 1</span><span id="yla-best">Rekor: ${best}</span>`;
  container.appendChild(hud);

  const btns = document.createElement("div");
  btns.className = "yla-btns";
  btns.innerHTML = `<button class="yla-btn" id="yla-pause" title="Duraklat (P)">⏸</button><button class="yla-btn" id="yla-mute" title="Ses (M)">🔊</button>`;
  container.appendChild(btns);

  const pad = document.createElement("div");
  pad.className = "yla-pad";
  pad.innerHTML = `<button data-d="L">◀</button><button data-d="U">▲</button><button data-d="D">▼</button><button data-d="R">▶</button>`;
  container.appendChild(pad);

  const ov = document.createElement("div");
  ov.className = "yla-ov";
  container.appendChild(ov);

  const scoreEl = hud.querySelector<HTMLElement>("#yla-score")!;
  const bestEl = hud.querySelector<HTMLElement>("#yla-best")!;
  const speedEl = hud.querySelector<HTMLElement>("#yla-speed")!;
  const muteBtn = btns.querySelector<HTMLElement>("#yla-mute")!;

  function showMenu() {
    ov.style.display = "flex";
    ov.innerHTML = `
      <h1>🐍 YILAN ARENA</h1>
      <h2>Neon yılan arenasında klasik yılan oyunu</h2>
      <p><b>Oklar / WASD</b> yön · <b>Space</b> başlat · <b>P</b> duraklat · <b>M</b> ses</p>
      <p>🍎 elma +10 · ⭐ yıldız meyve +5 · ✨ altın elma +50 ve <b>hayalet modu</b> (6 sn duvarlardan geç!)</p>
      <p>Her elmada hızlan — rekoru kır!</p>
      <button class="yla-play" id="yla-play">▶ OYNA</button>
      <p class="yla-rec">Rekor: ${best}</p>`;
    ov.querySelector<HTMLElement>("#yla-play")!.addEventListener("click", () => { AudioSys.resume(); AudioSys.click(); reset(); phase = "playing"; ov.style.display = "none"; });
  }
  function showOver() {
    ov.style.display = "flex";
    ov.innerHTML = `
      <h1 style="color:#ff5d5d;text-shadow:0 0 18px rgba(255,93,93,.7)">💀 YILAN ÖLDÜ</h1>
      <p class="big">Skor: ${score}</p>
      ${newRecord ? `<p class="yla-rec">🏆 YENİ REKOR!</p>` : `<p class="yla-rec">Rekor: ${best}</p>`}
      <button class="yla-play" id="yla-play">▶ TEKRAR</button>
      <p>Space / Enter ile hızlı tekrar</p>`;
    ov.querySelector<HTMLElement>("#yla-play")!.addEventListener("click", () => { AudioSys.resume(); AudioSys.click(); reset(); phase = "playing"; ov.style.display = "none"; });
  }
  function showPause() {
    ov.style.display = "flex";
    ov.innerHTML = `<h1>⏸ DURAKLATILDI</h1><p>Devam için P veya tıklayın</p>`;
  }

  /* ---------- oyun kurulumu ---------- */
  function reset() {
    snake = [{ x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }, { x: 5, y: 9 }];
    dir = { x: 1, y: 0 };
    queuedDir = [];
    grow = 0; score = 0; applesEaten = 0;
    gold = null; goldTimer = 0; ghost = 0; star = null; starTimer = 0;
    tickMs = BASE_TICK; acc = 0; particles = []; newRecord = false;
    spawnFood();
    scoreEl.textContent = "Skor: 0";
    bestEl.textContent = `Rekor: ${best}`;
    speedEl.textContent = "Hız 1";
  }

  function freeCell(): Cell {
    let c: Cell;
    do {
      c = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some((s) => s.x === c.x && s.y === c.y) || (gold && gold.x === c.x && gold.y === c.y) || (star && star.x === c.x && star.y === c.y));
    return c;
  }
  let food: Cell = { x: 20, y: 9 };
  function spawnFood() { food = freeCell(); }

  function burst(cx: number, cy: number, colors: string[], n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 180;
      const life = 0.4 + Math.random() * 0.5;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 24, life, max: life, color: colors[i % colors.length], size: 2 + Math.random() * 3 });
    }
  }

  /* ---------- girdi ---------- */
  function queueDir(nx: number, ny: number) {
    const lastDir = queuedDir.length ? queuedDir[queuedDir.length - 1] : dir;
    if (lastDir.x === -nx && lastDir.y === -ny) return; // 180° yasak
    if (lastDir.x === nx && lastDir.y === ny) return;
    queuedDir.push({ x: nx, y: ny });
    if (queuedDir.length > 2) queuedDir.shift();
  }
  const KEYS: Record<string, [number, number]> = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };
  function onKey(e: KeyboardEvent) {
    const k = KEYS[e.code];
    if (k) {
      e.preventDefault();
      if (phase === "playing") queueDir(k[0], k[1]);
      return;
    }
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (phase === "menu" || phase === "over") { AudioSys.resume(); reset(); phase = "playing"; ov.style.display = "none"; }
      else if (phase === "paused") { phase = "playing"; ov.style.display = "none"; }
      return;
    }
    if (e.code === "KeyP") { togglePause(); return; }
    if (e.code === "KeyM") { toggleMute(); }
  }
  function togglePause() {
    if (phase === "playing") { phase = "paused"; showPause(); }
    else if (phase === "paused") { phase = "playing"; ov.style.display = "none"; }
  }
  function toggleMute() {
    AudioSys.muted = !AudioSys.muted;
    muteBtn.textContent = AudioSys.muted ? "🔇" : "🔊";
  }
  window.addEventListener("keydown", onKey);

  btns.querySelector<HTMLElement>("#yla-pause")!.addEventListener("click", () => { togglePause(); AudioSys.click(); });
  muteBtn.addEventListener("click", () => { toggleMute(); AudioSys.click(); });
  ov.addEventListener("click", () => { if (phase === "paused") { phase = "playing"; ov.style.display = "none"; } });

  // dokunmatik: kaydırma
  let touchStart: { x: number; y: number } | null = null;
  function onTouchStart(e: TouchEvent) { const t = e.changedTouches[0]; touchStart = { x: t.clientX, y: t.clientY }; }
  function onTouchEnd(e: TouchEvent) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) queueDir(dx > 0 ? 1 : -1, 0);
    else queueDir(0, dy > 0 ? 1 : -1);
  }
  canvas.addEventListener("touchstart", onTouchStart, { passive: true });
  canvas.addEventListener("touchend", onTouchEnd, { passive: true });

  // dokunmatik: ekran butonları
  const PAD_DIRS: Record<string, [number, number]> = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] };
  const padHandlers: Array<[HTMLElement, EventListener]> = [];
  pad.querySelectorAll<HTMLElement>("button").forEach((b) => {
    const d = PAD_DIRS[b.dataset.d!];
    const h: EventListener = (ev) => { ev.preventDefault(); if (phase === "playing") queueDir(d[0], d[1]); };
    b.addEventListener("pointerdown", h);
    padHandlers.push([b, h]);
  });

  /* ---------- adım ---------- */
  function step() {
    if (queuedDir.length) dir = queuedDir.shift()!;
    const head = snake[0];
    let nx = head.x + dir.x, ny = head.y + dir.y;
    const ghostOn = ghost > 0;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      if (ghostOn) { nx = (nx + COLS) % COLS; ny = (ny + ROWS) % ROWS; }
      else return die();
    }
    const hitsSelf = snake.some((s, i) => i < snake.length - 1 && s.x === nx && s.y === ny);
    if (hitsSelf && !ghostOn) return die();

    snake.unshift({ x: nx, y: ny });
    if (grow > 0) grow -= 1;
    else snake.pop();

    if (nx === food.x && ny === food.y) {
      score += 10; applesEaten += 1; grow += 1;
      burst((food.x + 0.5) * CELL, (food.y + 0.5) * CELL, ["#ff5d5d", "#ff9a9a", "#ffd23f"], 16);
      AudioSys.eat();
      spawnFood();
      if (applesEaten % 7 === 0 && !gold) { gold = freeCell(); goldTimer = GOLD_LIFE; }
      if (applesEaten % 5 === 0 && !star) { star = freeCell(); starTimer = STAR_LIFE; }
      tickMs = Math.max(MIN_TICK, BASE_TICK - Math.floor(score / 100) * 5);
      scoreEl.textContent = `Skor: ${score}`;
      speedEl.textContent = `Hız ${Math.min(10, 1 + Math.floor(score / 100))}`;
    }
    if (gold && nx === gold.x && ny === gold.y) {
      score += 50; grow += 2; ghost = GHOST_TIME; gold = null;
      burst((nx + 0.5) * CELL, (ny + 0.5) * CELL, ["#ffd23f", "#fff7cf", "#ffb347"], 22);
      AudioSys.gold();
      scoreEl.textContent = `Skor: ${score}`;
      speedEl.textContent = `Hız ${Math.min(10, 1 + Math.floor(score / 100))}`;
    }
    if (star && nx === star.x && ny === star.y) {
      score += 5; star = null;
      burst((nx + 0.5) * CELL, (ny + 0.5) * CELL, ["#c084fc", "#e9d5ff", "#f0abfc"], 18);
      AudioSys.star();
      scoreEl.textContent = `Skor: ${score}`;
      speedEl.textContent = `Hız ${Math.min(10, 1 + Math.floor(score / 100))}`;
    }
  }

  function die() {
    phase = "over";
    AudioSys.die();
    const head = snake[0];
    burst((head.x + 0.5) * CELL, (head.y + 0.5) * CELL, ["#ff5d5d", "#ff9a9a", "#ff8a3d"], 34);
    if (score > best) {
      best = score; newRecord = true;
      try { localStorage.setItem(REC_KEY, String(best)); } catch { /* yok */ }
    }
    bestEl.textContent = `Rekor: ${best}`;
    showOver();
  }

  /* ---------- çizim ---------- */
  function draw(dt: number) {
    g.fillStyle = "#05060f";
    g.fillRect(0, 0, W, H);
    const t = performance.now() / 1000;
    // canlı grid — hafif kayan, nefes alan çizgiler
    const shift = (t * 4) % CELL;
    const gridA = 0.04 + Math.sin(t * 1.2) * 0.018;
    g.strokeStyle = `rgba(52,211,153,${gridA.toFixed(3)})`;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = -1; x <= COLS; x++) { const px = x * CELL + shift + 0.5; g.moveTo(px, 0); g.lineTo(px, H); }
    for (let y = -1; y <= ROWS; y++) { const py = y * CELL + shift * 0.5 + 0.5; g.moveTo(0, py); g.lineTo(W, py); }
    g.stroke();
    // arena kenarı — nabız gibi parlayan çerçeve
    g.strokeStyle = ghost > 0 ? "rgba(56,189,248,.8)" : "rgba(52,211,153,.5)";
    g.lineWidth = 3;
    g.shadowColor = ghost > 0 ? "#38bdf8" : "#34d399";
    g.shadowBlur = 14 + Math.sin(t * 2) * 4;
    g.strokeRect(2, 2, W - 4, H - 4);
    g.shadowBlur = 0;
    // yem (elma) — gövde degrade, kıvrık sap ve yaprak detayı
    const pulse = 1 + Math.sin(t * 5) * 0.12;
    g.save();
    g.translate((food.x + 0.5) * CELL, (food.y + 0.5) * CELL);
    g.scale(pulse, pulse);
    g.shadowColor = "#ff5d5d"; g.shadowBlur = 18;
    const ag = g.createRadialGradient(-3, -1, 2, 0, 2, 11);
    ag.addColorStop(0, "#ff9a9a"); ag.addColorStop(0.55, "#ff5d5d"); ag.addColorStop(1, "#d92f2f");
    g.fillStyle = ag;
    g.beginPath(); g.arc(0, 2, 9, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "#7a4a2f"; g.lineWidth = 2; g.lineCap = "round";
    g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(1, -10, 2, -12); g.stroke();
    const leaf = g.createLinearGradient(2, -12, 9, -9);
    leaf.addColorStop(0, "#6fe06a"); leaf.addColorStop(1, "#3f8f3a");
    g.fillStyle = leaf;
    g.beginPath(); g.moveTo(2, -11); g.quadraticCurveTo(7, -14, 10, -10); g.quadraticCurveTo(6, -8, 2, -11); g.fill();
    g.fillStyle = "rgba(255,255,255,.7)";
    g.beginPath(); g.arc(-3, 0, 2.2, 0, Math.PI * 2); g.fill();
    g.restore();

    // altın elma (yanıp söner, süresi azalınca titrer) + dönen kıvılcımlar
    if (gold) {
      const blink = goldTimer < 2 ? (Math.sin(t * 14) > 0 ? 1 : 0.25) : 1;
      g.save();
      g.globalAlpha = blink;
      g.translate((gold.x + 0.5) * CELL, (gold.y + 0.5) * CELL);
      g.rotate(Math.sin(t * 3) * 0.2);
      g.shadowColor = "#ffd23f"; g.shadowBlur = 22;
      const gg = g.createRadialGradient(-2, -2, 1, 0, 0, 12);
      gg.addColorStop(0, "#fff7cf"); gg.addColorStop(1, "#e8a80f");
      g.fillStyle = gg;
      g.beginPath();
      g.moveTo(0, -11); g.lineTo(9, 0); g.lineTo(0, 11); g.lineTo(-9, 0); g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = "#fff7cf"; g.fillRect(-2, -4, 4, 4);
      g.restore();
      g.save();
      g.translate((gold.x + 0.5) * CELL, (gold.y + 0.5) * CELL);
      g.fillStyle = "#fff7cf";
      for (let i = 0; i < 3; i++) {
        const a = t * 2.4 + (i * Math.PI * 2) / 3;
        const r = 13 + Math.sin(t * 6 + i) * 2;
        g.globalAlpha = 0.5 + Math.sin(t * 8 + i * 2) * 0.4;
        g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 1.6, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }

    // yıldız meyve — nadir bonus (+5), mor parıltı ve kıvılcımlar
    if (star) {
      const blink = starTimer < 1.5 ? (Math.sin(t * 16) > 0 ? 1 : 0.3) : 1;
      g.save();
      g.globalAlpha = blink;
      g.translate((star.x + 0.5) * CELL, (star.y + 0.5) * CELL);
      const sp = 1 + Math.sin(t * 6) * 0.1;
      g.scale(sp, sp);
      g.rotate(t * 0.8);
      g.shadowColor = "#c084fc"; g.shadowBlur = 20;
      const sg = g.createRadialGradient(0, 0, 1, 0, 0, 12);
      sg.addColorStop(0, "#f0abfc"); sg.addColorStop(1, "#7c3aed");
      g.fillStyle = sg;
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
        g.lineTo(Math.cos(a + Math.PI / 5) * 5, Math.sin(a + Math.PI / 5) * 5);
      }
      g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = "#fdf4ff";
      g.beginPath(); g.arc(0, 0, 2.5, 0, Math.PI * 2); g.fill();
      g.restore();
      g.save();
      g.translate((star.x + 0.5) * CELL, (star.y + 0.5) * CELL);
      g.fillStyle = "#e9d5ff";
      for (let i = 0; i < 4; i++) {
        const a = -t * 3 + (i * Math.PI) / 2;
        g.globalAlpha = 0.35 + Math.sin(t * 7 + i * 1.7) * 0.35;
        g.beginPath(); g.arc(Math.cos(a) * 15, Math.sin(a) * 15, 1.4, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }

    // yılan — baştan kuyruğa degrade gövde, hayalet modunda titreşen parıltı
    const ghostOn = ghost > 0;
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const k = i / Math.max(1, snake.length - 1);
      const hue = ghostOn ? 195 : 152 - k * 24;
      const lum = ghostOn ? 62 : 52 - k * 14;
      g.globalAlpha = ghostOn ? 0.55 + Math.sin(t * 8 - i * 0.7) * 0.2 : 1;
      g.fillStyle = `hsl(${hue}, 85%, ${lum}%)`;
      g.shadowColor = ghostOn ? "#38bdf8" : "#34d399";
      g.shadowBlur = i === 0 ? 20 : 10;
      const inset = i === 0 ? 2 : 3 + k * 2;
      g.beginPath();
      g.roundRect(s.x * CELL + inset, s.y * CELL + inset, CELL - inset * 2, CELL - inset * 2, 7);
      g.fill();
      if (!ghostOn) { // üst parlama çizgisi — gövdeye hacim katar
        g.shadowBlur = 0;
        g.fillStyle = `hsla(${hue}, 90%, ${Math.min(80, lum + 24)}%, .45)`;
        g.fillRect(s.x * CELL + inset + 3, s.y * CELL + inset + 2, CELL - inset * 2 - 6, 3);
      }
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    // baş detayları (snake boşsa atla — ilk kare güvenliği)
    if (snake.length) {
      const head = snake[0];
      const cx = head.x * CELL + CELL / 2, cy = head.y * CELL + CELL / 2;
      // çatallı dil — yönünde ara sıra titrer
      const flick = Math.max(0, Math.sin(t * 7));
      if (flick > 0.15) {
        g.strokeStyle = "#ff5d7a"; g.lineWidth = 2; g.lineCap = "round";
        const bx = cx + dir.x * 6, by = cy + dir.y * 6;
        const tx = cx + dir.x * 12, ty = cy + dir.y * 12;
        g.beginPath();
        g.moveTo(bx, by); g.lineTo(tx, ty);
        g.moveTo(tx, ty); g.lineTo(tx + dir.y * 3 - dir.x * 2, ty + dir.x * 3 - dir.y * 2);
        g.moveTo(tx, ty); g.lineTo(tx - dir.y * 3 - dir.x * 2, ty - dir.x * 3 - dir.y * 2);
        g.stroke();
      }
      // gözler — beyaz sklera + bebek
      const ex = cx + dir.x * 6, ey = cy + dir.y * 6;
      g.fillStyle = "#f8fefc";
      g.beginPath(); g.arc(ex - dir.y * 5, ey - dir.x * 5, 3.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(ex + dir.y * 5, ey + dir.x * 5, 3.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#04121a";
      g.beginPath(); g.arc(ex - dir.y * 5 + dir.x * 1.4, ey - dir.x * 5 + dir.y * 1.4, 1.7, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(ex + dir.y * 5 + dir.x * 1.4, ey + dir.x * 5 + dir.y * 1.4, 1.7, 0, Math.PI * 2); g.fill();
    }

    // parçacıklar — küçülen, hafif yerçekimli parıltılar
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vx *= 0.96; p.vy = p.vy * 0.96 + 70 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.life / p.max;
      g.globalAlpha = k * 0.9;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, p.size * k), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // hayalet süresi göstergesi
    if (ghostOn) {
      g.fillStyle = "rgba(56,189,248,.9)";
      g.font = "700 14px 'Segoe UI', sans-serif";
      g.textAlign = "center";
      g.fillText(`👻 HAYALET ${ghost.toFixed(1)} sn`, W / 2, 24);
    }
  }

  /* ---------- döngü ---------- */
  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (phase === "playing") {
      acc += dt * 1000;
      while (acc >= tickMs) { acc -= tickMs; step(); }
      if (ghost > 0) ghost = Math.max(0, ghost - dt);
      if (gold) { goldTimer -= dt; if (goldTimer <= 0) gold = null; }
      if (star) { starTimer -= dt; if (starTimer <= 0) star = null; }
    }
    draw(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  showMenu();

  /* ---------- temizlik ---------- */
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchend", onTouchEnd);
    padHandlers.forEach(([b, h]) => b.removeEventListener("pointerdown", h));
    style.remove(); hud.remove(); btns.remove(); pad.remove(); ov.remove();
  };
}