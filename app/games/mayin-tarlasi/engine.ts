/* =====================================================================
   MAYIN TARLASI — Game Engine
   Neon mayın tarlası: klasik mayın oyunu. İlk tık her zaman güvenli.
   Sol tık aç, sağ tık (veya bayrak modu) bayrak dik. Sıfır komşulu
   bölgeler otomatik açılır. Kolay/Orta/Zor zorluklar ve zorluk başına
   en iyi süre localStorage'da tutulur. Grafikler canvas'ta prosedürel,
   sesler Web Audio API ile sentezlenir. Dış varlık yok. Mobil uyumlu.

   Controls:
     Sol tık / dokunuş      — hücre aç (bayrak modu kapalıyken)
     Sağ tık                — bayrak koy/kaldır
     🚩 Bayrak modu butonu  — dokunmatik için bayrak koy/kaldır
     M                      — ses aç/kapat

   Public API:
     startGame(canvas) -> () => void
   ===================================================================== */

const W = 960;
const H = 540;
const COLS = 16;
const ROWS = 10;
const CELL = 48;
const OX = (W - COLS * CELL) / 2;
const OY = (H - ROWS * CELL) / 2 + 12;

type Diff = "easy" | "medium" | "hard";
const DIFFS: Record<Diff, { label: string; mines: number }> = {
  easy: { label: "Kolay", mines: 20 },
  medium: { label: "Orta", mines: 32 },
  hard: { label: "Zor", mines: 45 },
};
const BEST_KEY = "mayin-tarlasi-best";

const NUM_COLORS = ["", "#60a5fa", "#4ade80", "#f87171", "#c084fc", "#fbbf24", "#22d3ee", "#f472b6", "#e5e7eb"];

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
  open() { this.tone("square", 300, 340, 0.06, 0.3); },
  flag() { this.tone("triangle", 220, 300, 0.08, 0.35); },
  boom() { this.tone("sawtooth", 220, 40, 0.6, 0.6); },
  win() { this.tone("triangle", 520, 780, 0.15, 0.5); this.tone("triangle", 780, 1040, 0.18, 0.4, 0.12); this.tone("triangle", 1040, 1560, 0.22, 0.35, 0.26); },
  click() { this.tone("square", 240, 240, 0.05, 0.25); },
};

/* ================= 2. TYPES ================= */
type Phase = "menu" | "playing" | "won" | "lost";
type Best = Record<Diff, number>;

/* ================= 3. PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  AudioSys.init();
  const g = canvas.getContext("2d")!;
  const container = canvas.parentElement ?? document.body;

  /* ---------- durum ---------- */
  let phase: Phase = "menu";
  let diff: Diff = "easy";
  let mines = new Set<number>();
  let revealed = new Set<number>();
  let flags = new Set<number>();
  let started = false;
  let time = 0;
  let exploded = -1;
  let hover = -1;
  let flagMode = false;
  let newRec = false;
  let raf = 0;
  let last = performance.now();
  let best: Best = { easy: 0, medium: 0, hard: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) || "{}") as Partial<Best>;
    for (const k of ["easy", "medium", "hard"] as Diff[]) {
      const v = Number(raw[k]);
      best[k] = Number.isFinite(v) && v > 0 ? v : 0;
    }
  } catch { /* bozuk kayıt */ }

  const idx = (x: number, y: number) => y * COLS + x;
  const inGrid = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
  const TOTAL = COLS * ROWS;

  function neighbors(x: number, y: number): number[] {
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (inGrid(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
      }
    return out;
  }
  const countMines = (x: number, y: number) => neighbors(x, y).filter((n) => mines.has(n)).length;

  /* ---------- DOM ---------- */
  const style = document.createElement("style");
  style.textContent = `
.mt-hud{position:absolute;top:8px;left:12px;right:12px;display:flex;justify-content:space-between;
  align-items:center;font-family:'Segoe UI',system-ui,sans-serif;color:#e6f7ff;font-weight:800;
  text-shadow:0 0 8px rgba(248,113,113,.5);font-size:18px;pointer-events:none;z-index:5}
.mt-hud .mid{font-size:13px;color:#f0abfc;font-weight:700;text-shadow:none}
.mt-btns{position:absolute;top:6px;right:10px;display:flex;gap:6px;z-index:6}
.mt-btn{background:rgba(10,20,30,.7);border:1px solid rgba(248,113,113,.5);color:#fecdd3;border-radius:8px;
  height:30px;min-width:30px;padding:0 8px;cursor:pointer;font-size:13px;font-weight:800}
.mt-btn:hover{background:rgba(248,113,113,.22)}
.mt-btn.on{background:rgba(248,113,113,.45);border-color:#f87171;color:#fff}
.mt-ov{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:10px;background:rgba(3,5,15,.75);backdrop-filter:blur(2px);
  font-family:'Segoe UI',system-ui,sans-serif;color:#fff;text-align:center}
.mt-ov h1{margin:0;font-size:40px;letter-spacing:2px;color:#f87171;text-shadow:0 0 18px rgba(248,113,113,.8)}
.mt-ov h1.win{color:#4ade80;text-shadow:0 0 18px rgba(74,222,128,.8)}
.mt-ov h2{margin:0;font-size:15px;font-weight:600;color:#9fb6cc}
.mt-ov p{margin:2px 0;font-size:13px;color:#cfd8e3}
.mt-ov .big{font-size:24px;color:#ffd23f;text-shadow:0 0 12px rgba(255,210,63,.6)}
.mt-diffs{display:flex;gap:8px;margin-top:4px}
.mt-diff{background:rgba(30,42,58,.8);border:1px solid rgba(248,113,113,.4);color:#fecdd3;border-radius:10px;
  padding:8px 16px;cursor:pointer;font-weight:800;font-size:14px}
.mt-diff.on{background:linear-gradient(135deg,#f87171,#9f1239);border-color:#f87171;color:#fff}
.mt-play{margin-top:8px;background:linear-gradient(135deg,#f87171,#7c3aed);border:none;color:#fff;
  font-weight:900;font-size:18px;letter-spacing:1px;padding:12px 34px;border-radius:12px;cursor:pointer;
  box-shadow:0 0 24px rgba(248,113,113,.5)}
.mt-play:hover{transform:scale(1.05)}
.mt-rec{color:#ffd23f;font-weight:800}
`;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "mt-hud";
  hud.innerHTML = `<span id="mt-mines">💣 20</span><span class="mid" id="mt-diff">Kolay</span><span id="mt-time">⏱ 0 sn</span>`;
  container.appendChild(hud);

  const btns = document.createElement("div");
  btns.className = "mt-btns";
  btns.innerHTML = `<button class="mt-btn" id="mt-flag" title="Bayrak modu">🚩</button><button class="mt-btn" id="mt-mute" title="Ses (M)">🔊</button>`;
  container.appendChild(btns);

  const ov = document.createElement("div");
  ov.className = "mt-ov";
  container.appendChild(ov);

  const minesEl = hud.querySelector<HTMLElement>("#mt-mines")!;
  const timeEl = hud.querySelector<HTMLElement>("#mt-time")!;
  const diffEl = hud.querySelector<HTMLElement>("#mt-diff")!;
  const flagBtn = btns.querySelector<HTMLElement>("#mt-flag")!;
  const muteBtn = btns.querySelector<HTMLElement>("#mt-mute")!;

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function bindPlay(btnId: string, cb: () => void) {
    ov.querySelector<HTMLElement>(`#${btnId}`)!.addEventListener("click", () => { AudioSys.resume(); AudioSys.click(); cb(); });
  }
  function bindDiffs() {
    ov.querySelectorAll<HTMLElement>(".mt-diff").forEach((b) => {
      b.addEventListener("click", () => {
        diff = b.dataset.d as Diff;
        ov.querySelectorAll<HTMLElement>(".mt-diff").forEach((x) => x.classList.toggle("on", x === b));
        AudioSys.click();
      });
    });
  }
  function diffButtonsHtml() {
    return `<div class="mt-diffs">${(["easy", "medium", "hard"] as Diff[])
      .map((d) => `<button class="mt-diff${d === diff ? " on" : ""}" data-d="${d}">${DIFFS[d].label} (${DIFFS[d].mines})</button>`).join("")}</div>`;
  }
  function showMenu() {
    ov.style.display = "flex";
    ov.innerHTML = `
      <h1>💣 MAYIN TARLASI</h1>
      <h2>Neon mayın tarlası — klasik mayın oyunu</h2>
      <p><b>Sol tık</b> aç · <b>Sağ tık</b> / 🚩 bayrak modu bayrak · <b>M</b> ses</p>
      <p>İlk tık her zaman güvenli! Sıfır komşulu bölge otomatik açılır.</p>
      ${diffButtonsHtml()}
      <button class="mt-play" id="mt-play">▶ BAŞLA</button>
      <p class="mt-rec">En iyi süreler — Kolay ${best.easy ? fmt(best.easy) : "—"} · Orta ${best.medium ? fmt(best.medium) : "—"} · Zor ${best.hard ? fmt(best.hard) : "—"}</p>`;
    bindDiffs();
    bindPlay("mt-play", start);
  }
  function showEnd(won: boolean) {
    ov.style.display = "flex";
    const rec = newRec ? `<p class="mt-rec">🏆 YENİ REKOR!</p>` : `<p class="mt-rec">En iyi (${DIFFS[diff].label}): ${best[diff] ? fmt(best[diff]) : "—"}</p>`;
    ov.innerHTML = won
      ? `<h1 class="win">🏆 KAZANDIN!</h1><p class="big">Süre: ${fmt(time)}</p>${rec}${diffButtonsHtml()}<button class="mt-play" id="mt-play">▶ TEKRAR</button>`
      : `<h1>💥 PATLADI!</h1><p class="big">Süre: ${fmt(time)}</p><p class="mt-rec">En iyi (${DIFFS[diff].label}): ${best[diff] ? fmt(best[diff]) : "—"}</p>${diffButtonsHtml()}<button class="mt-play" id="mt-play">▶ TEKRAR</button>`;
    bindDiffs();
    bindPlay("mt-play", start);
  }

  /* ---------- oyun kurulumu ---------- */
  function start() {
    mines = new Set(); revealed = new Set(); flags = new Set();
    started = false; time = 0; exploded = -1; newRec = false;
    phase = "playing";
    ov.style.display = "none";
    diffEl.textContent = DIFFS[diff].label;
    updateHud();
  }

  function placeMines(safeIdx: number) {
    const safe = new Set([safeIdx, ...neighbors(safeIdx % COLS, Math.floor(safeIdx / COLS))]);
    let attempts = 0;
    while (mines.size < DIFFS[diff].mines && attempts < 5000) {
      attempts++;
      const c = Math.floor(Math.random() * TOTAL);
      if (safe.has(c)) continue;
      mines.add(c);
    }
    started = true;
  }

  function reveal(x: number, y: number) {
    const i = idx(x, y);
    if (revealed.has(i) || flags.has(i)) return;
    if (mines.has(i)) { exploded = i; lose(); return; }
    const stack = [i];
    while (stack.length) {
      const c = stack.pop()!;
      if (revealed.has(c) || flags.has(c)) continue;
      revealed.add(c);
      const cx = c % COLS, cy = Math.floor(c / COLS);
      if (countMines(cx, cy) === 0) {
        for (const n of neighbors(cx, cy)) if (!revealed.has(n) && !flags.has(n) && !mines.has(n)) stack.push(n);
      }
    }
    AudioSys.open();
    checkWin();
    updateHud();
  }

  function toggleFlag(x: number, y: number) {
    const i = idx(x, y);
    if (revealed.has(i)) return;
    if (flags.has(i)) flags.delete(i); else flags.add(i);
    AudioSys.flag();
    updateHud();
  }

  function checkWin() {
    if (revealed.size === TOTAL - mines.size) {
      phase = "won";
      AudioSys.win();
      const t = Math.floor(time);
      newRec = !best[diff] || t < best[diff];
      if (newRec) {
        best[diff] = t;
        try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* yok */ }
      }
      showEnd(true);
    }
  }
  function lose() {
    phase = "lost";
    AudioSys.boom();
    showEnd(false);
  }

  function updateHud() {
    minesEl.textContent = `💣 ${Math.max(0, DIFFS[diff].mines - flags.size)}`;
    timeEl.textContent = `⏱ ${fmt(time)}`;
  }

  /* ---------- girdi ---------- */
  function cellFromEvent(e: MouseEvent | TouchEvent): number {
    const r = canvas.getBoundingClientRect();
    let cx: number, cy: number;
    if ("touches" in e) { const t = e.changedTouches[0]; cx = t.clientX; cy = t.clientY; }
    else { cx = e.clientX; cy = e.clientY; }
    const px = (cx - r.left) * (canvas.width / r.width) - OX;
    const py = (cy - r.top) * (canvas.height / r.height) - OY;
    const x = Math.floor(px / CELL), y = Math.floor(py / CELL);
    return inGrid(x, y) ? idx(x, y) : -1;
  }
  function onDown(e: MouseEvent) {
    if (phase !== "playing") return;
    const i = cellFromEvent(e);
    if (i < 0) return;
    const x = i % COLS, y = Math.floor(i / COLS);
    if (e.button === 2) { toggleFlag(x, y); return; }
    if (e.button !== 0) return;
    if (flagMode) { toggleFlag(x, y); return; }
    if (!started) placeMines(i);
    reveal(x, y);
  }
  function onMove(e: MouseEvent) { hover = phase === "playing" ? cellFromEvent(e) : -1; }
  function onLeave() { hover = -1; }
  function onCtx(e: Event) { e.preventDefault(); }
  function onTouch(e: TouchEvent) {
    if (phase !== "playing") return;
    const i = cellFromEvent(e);
    if (i < 0) return;
    const x = i % COLS, y = Math.floor(i / COLS);
    if (flagMode) { toggleFlag(x, y); return; }
    if (!started) placeMines(i);
    reveal(x, y);
  }
  function onKey(e: KeyboardEvent) {
    if (e.code === "KeyM") { AudioSys.muted = !AudioSys.muted; muteBtn.textContent = AudioSys.muted ? "🔇" : "🔊"; }
  }
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  canvas.addEventListener("contextmenu", onCtx);
  canvas.addEventListener("touchend", onTouch, { passive: true });
  window.addEventListener("keydown", onKey);

  flagBtn.addEventListener("click", () => {
    flagMode = !flagMode;
    flagBtn.classList.toggle("on", flagMode);
    AudioSys.click();
  });
  muteBtn.addEventListener("click", () => {
    AudioSys.muted = !AudioSys.muted;
    muteBtn.textContent = AudioSys.muted ? "🔇" : "🔊";
  });

  /* ---------- çizim ---------- */
  function draw(dt: number) {
    if (phase === "playing" && started) { time += dt; timeEl.textContent = `⏱ ${fmt(time)}`; }
    g.fillStyle = "#05060f";
    g.fillRect(0, 0, W, H);

    // alan kenarı
    g.strokeStyle = "rgba(248,113,113,.5)";
    g.lineWidth = 3;
    g.shadowColor = "#f87171";
    g.shadowBlur = 12;
    g.strokeRect(OX - 4, OY - 4, COLS * CELL + 8, ROWS * CELL + 8);
    g.shadowBlur = 0;

    const showAll = phase === "lost";
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y);
        const px = OX + x * CELL, py = OY + y * CELL;
        const open = revealed.has(i) || showAll;
        if (!open) {
          // kapalı hücre
          g.fillStyle = i === hover ? "#2b3a52" : "#1e2a3a";
          g.strokeStyle = "rgba(255,255,255,.12)";
          g.lineWidth = 1;
          g.beginPath(); g.roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 6); g.fill(); g.stroke();
          if (flags.has(i)) drawFlag(px, py);
        } else {
          // açık hücre
          g.fillStyle = i === exploded ? "rgba(248,113,113,.35)" : "#0d1424";
          g.beginPath(); g.roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 6); g.fill();
          if (mines.has(i)) {
            drawMine(px, py, i === exploded);
          } else {
            const n = countMines(x, y);
            if (n > 0) {
              g.fillStyle = NUM_COLORS[n];
              g.font = `900 ${CELL * 0.55}px 'Segoe UI', sans-serif`;
              g.textAlign = "center"; g.textBaseline = "middle";
              g.shadowColor = NUM_COLORS[n]; g.shadowBlur = 8;
              g.fillText(String(n), px + CELL / 2, py + CELL / 2 + 2);
              g.shadowBlur = 0;
            }
          }
        }
      }
    }
  }

  function drawFlag(px: number, py: number) {
    g.fillStyle = "#e5e7eb";
    g.fillRect(px + CELL / 2 - 1, py + 10, 2, CELL - 20);
    g.fillStyle = "#f87171";
    g.beginPath();
    g.moveTo(px + CELL / 2 + 1, py + 10);
    g.lineTo(px + CELL / 2 + 16, py + 15);
    g.lineTo(px + CELL / 2 + 1, py + 22);
    g.closePath(); g.fill();
    g.fillStyle = "#94a3b8";
    g.fillRect(px + CELL / 2 - 6, py + CELL - 12, 12, 3);
  }
  function drawMine(px: number, py: number, boom: boolean) {
    const cx = px + CELL / 2, cy = py + CELL / 2;
    g.strokeStyle = boom ? "#fca5a5" : "#94a3b8";
    g.lineWidth = 2;
    for (let a = 0; a < 8; a++) {
      const rad = (a / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(rad) * 8, cy + Math.sin(rad) * 8);
      g.lineTo(cx + Math.cos(rad) * 15, cy + Math.sin(rad) * 15);
      g.stroke();
    }
    g.fillStyle = boom ? "#f87171" : "#1f2937";
    g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = boom ? "#fff" : "#e5e7eb";
    g.beginPath(); g.arc(cx - 3, cy - 3, 2.5, 0, Math.PI * 2); g.fill();
  }

  /* ---------- döngü ---------- */
  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    draw(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  showMenu();

  /* ---------- temizlik ---------- */
  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener("mousedown", onDown);
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
    canvas.removeEventListener("contextmenu", onCtx);
    canvas.removeEventListener("touchend", onTouch);
    window.removeEventListener("keydown", onKey);
    style.remove(); hud.remove(); btns.remove(); ov.remove();
  };
}