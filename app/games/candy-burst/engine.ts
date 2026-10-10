/* =====================================================================
   CANDY BURST: Eşleştirme Macerası — Match-3 Game Engine (v2)
   Progressive difficulty from easy to ultra hard. Boss every 10 levels.
   Special candies: 4-in-a-row → Striped (row/column blast),
   5-in-a-row → Color Bomb, L/T shape → Wrapped (3×3 blast).
   All graphics procedural on canvas; all audio via Web Audio API.
   ===================================================================== */

import { saveScore } from "../../lib/auth";

const W = 900;
const H = 600;
const GRID_SIZE = 8;
const CELL_SIZE = 56;
const GRID_OFFSET_X = (W - GRID_SIZE * CELL_SIZE) / 2;
const GRID_OFFSET_Y = 100;
const SWAP_DURATION = 200;
const CLEAR_DURATION = 300;
const FALL_SPEED = 12;
const SCORE_PER_CANDY = 60;
const COMBO_BONUS = 30;
const SPECIAL_BONUS = 150;
const HINT_DELAY = 360; // frames (~6s) without a move → hint
const DRAG_THRESHOLD = 24; // canvas px

/* Special candy types */
const SP_NONE = 0;
const SP_STRIPED_H = 1; // clears a row
const SP_STRIPED_V = 2; // clears a column
const SP_WRAPPED = 3; // clears a 3×3 area
const SP_BOMB = 4; // clears every candy of one color

const COLORS = [
  { name: "red", base: "#e63946", light: "#ff6b6b", dark: "#b71c1c" },
  { name: "orange", base: "#f4a261", light: "#ffc49a", dark: "#c8782a" },
  { name: "yellow", base: "#ffd23f", light: "#ffe680", dark: "#d4a820" },
  { name: "green", base: "#2a9d3a", light: "#5fd46e", dark: "#1a7028" },
  { name: "blue", base: "#4a90d9", light: "#7ab8f0", dark: "#2a6aaa" },
] as const;

/* ---- Difficulty Tiers ---- */
interface LevelConfig {
  moves: number;
  targetScore: number;
  numColors: number;
  bossHp: number;
  name: string;
  emoji: string;
  color: string;
}

function getLevelConfig(lvl: number): LevelConfig {
  if (lvl <= 3)
    return { moves: 25, targetScore: 400 + lvl * 100, numColors: 3, bossHp: 0, name: "KOLAY", emoji: "🟢", color: "#4ade80" };
  if (lvl <= 7)
    return { moves: 22, targetScore: 800 + (lvl - 3) * 200, numColors: 4, bossHp: 0, name: "ORTA", emoji: "🟡", color: "#facc15" };
  if (lvl <= 9)
    return { moves: 19, targetScore: 1600 + (lvl - 7) * 300, numColors: 5, bossHp: 0, name: "ZOR", emoji: "🟠", color: "#fb923c" };
  if (lvl === 10)
    return { moves: 20, targetScore: 0, numColors: 5, bossHp: 12, name: "BOSS", emoji: "💀", color: "#ff4444" };
  if (lvl <= 15)
    return { moves: 17, targetScore: 2200 + (lvl - 10) * 400, numColors: 5, bossHp: 0, name: "ÇOK ZOR", emoji: "🟣", color: "#a78bfa" };
  if (lvl <= 19)
    return { moves: 14, targetScore: 4000 + (lvl - 15) * 500, numColors: 5, bossHp: 0, name: "EKSTREM", emoji: "🔥", color: "#f97316" };
  if (lvl === 20)
    return { moves: 18, targetScore: 0, numColors: 5, bossHp: 20, name: "BOSS", emoji: "💀", color: "#ff4444" };
  if (lvl <= 25)
    return { moves: 12, targetScore: 6000 + (lvl - 20) * 600, numColors: 5, bossHp: 0, name: "KÂBUS", emoji: "🖤", color: "#6b7280" };
  if (lvl === 30)
    return { moves: 15, targetScore: 0, numColors: 5, bossHp: 30, name: "BOSS", emoji: "💀", color: "#ff4444" };
  return { moves: 10, targetScore: 8000 + (lvl - 25) * 700, numColors: 5, bossHp: 0, name: "ULTRA", emoji: "💀", color: "#dc2626" };
}

/* ---- Audio ---- */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  musicGain: null as GainNode | null,
  musicInterval: null as ReturnType<typeof setInterval> | null,
  musicNoteIndex: 0,

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.1;
      this.musicGain.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
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
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },
  swap() { this.tone("sine", 300, 450, 0.1, 0.25); },
  invalid() { this.tone("square", 150, 100, 0.15, 0.2); },
  match() { this.tone("square", 660, 880, 0.12, 0.3); this.tone("square", 880, 1100, 0.1, 0.25, 0.08); },
  cascade() { [523, 659, 784].forEach((f, i) => this.tone("square", f, f * 1.2, 0.1, 0.3, i * 0.06)); },
  levelup() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone("square", f, f, 0.15, 0.35, i * 0.1)); },
  lose() { this.tone("sawtooth", 300, 150, 0.4, 0.4); this.tone("sawtooth", 200, 80, 0.6, 0.4, 0.3); },
  bossHit() { this.tone("sawtooth", 400, 100, 0.2, 0.4); this.tone("square", 200, 80, 0.25, 0.3, 0.05); },
  bossDefeat() { [440, 554, 659, 880, 1108, 1319].forEach((f, i) => this.tone("square", f, f, 0.15, 0.35, i * 0.1)); this.tone("sawtooth", 80, 30, 1.0, 0.4, 0.7); },
  special() { this.tone("square", 660, 1320, 0.18, 0.35); this.tone("sine", 220, 440, 0.25, 0.3, 0.02); this.tone("square", 990, 1980, 0.16, 0.25, 0.1); },
  bomb() { this.tone("sawtooth", 150, 30, 0.6, 0.5); this.tone("square", 80, 20, 0.5, 0.4, 0.05); this.tone("sine", 400, 60, 0.4, 0.3, 0.08); },
  shuffle() { [400, 500, 450, 550].forEach((f, i) => this.tone("square", f, f, 0.06, 0.2, i * 0.05)); },
  hint() { this.tone("sine", 880, 1100, 0.12, 0.12); },

  startMusic() {
    if (!this.ctx || this.muted || this.musicInterval) return;
    this.resume();
    const melody = [262,330,392,523,392,330,294,349, 262,330,392,523,392,330,294,349, 349,440,523,698,523,440,392,440, 330,392,440,523,440,392,349,330];
    this.musicNoteIndex = 0;
    this.musicInterval = setInterval(() => {
      if (!this.ctx || this.muted) return;
      const bossMode = (window as any).__candyBossMusic === true;
      const f = melody[this.musicNoteIndex % melody.length] * (bossMode ? 0.84 : 1);
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(g);
      g.connect(this.musicGain!);
      osc.start(t);
      osc.stop(t + 0.28);
      // Sub-octave bass pulse under every note
      const bass = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bass.type = "triangle";
      bass.frequency.value = f / 2;
      bg.gain.setValueAtTime(0.05, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      bass.connect(bg);
      bg.connect(this.musicGain!);
      bass.start(t);
      bass.stop(t + 0.26);
      if (bossMode && this.musicNoteIndex % 8 === 0) {
        const th = this.ctx.createOscillator();
        const tg = this.ctx.createGain();
        th.type = "sawtooth";
        th.frequency.setValueAtTime(110, t);
        th.frequency.exponentialRampToValueAtTime(55, t + 0.2);
        tg.gain.setValueAtTime(0.06, t);
        tg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        th.connect(tg);
        tg.connect(this.musicGain!);
        th.start(t);
        th.stop(t + 0.22);
      }
      this.musicNoteIndex++;
    }, 260);
  },
  stopMusic() { if (this.musicInterval) { clearInterval(this.musicInterval); this.musicInterval = null; } },
  destroy() { this.stopMusic(); if (this.ctx) { this.ctx.close(); this.ctx = null; } },
};

/* ---- Types ---- */
interface Candy {
  color: number; // -1 for color bomb
  special: number; // SP_*
  x: number; y: number;
  targetX: number; targetY: number;
  clearing: boolean;
  clearTimer: number;
  scale: number;
  squash: number; // 0..1 landing squash
  fallSpeed: number;
  wobblePhase: number;
  activated: boolean; // per-clear-set guard
}
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
  kind: "dot" | "ring" | "sparkle";
}
interface Run {
  cells: { r: number; c: number }[];
  horizontal: boolean;
  length: number;
}
interface BossState {
  hp: number; maxHp: number;
  x: number; y: number;
  flashTimer: number; alive: boolean; deathTimer: number;
}
type GameState = "menu" | "playing" | "swapping" | "clearing" | "falling" | "levelComplete" | "gameover" | "victory";

const cellKey = (r: number, c: number) => `${r},${c}`;

/* ================= MAIN ENGINE ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let state: GameState = "menu";
  let stateTimer = 0;
  let level = 1;
  let score = 0;
  let totalScore = 0;
  let movesLeft = 20;
  let targetScore = 500;
  let combo = 0;
  let grid: (Candy | null)[][] = [];
  let selected: { r: number; c: number } | null = null;
  let swapFrom: { r: number; c: number } | null = null;
  let swapTo: { r: number; c: number } | null = null;
  let swapProgress = 0;
  let bombSwap = false;
  let bombPartnerColor = -1;
  let particles: Particle[] = [];
  let boss: BossState | null = null;
  let isBossLevel = false;
  let animTime = 0;
  let shakeTimer = 0;
  let shakeIntensity = 0;
  let currentConfig: LevelConfig = getLevelConfig(1);
  let floatTexts: { x: number; y: number; text: string; color: string; life: number; size: number }[] = [];
  let idleFrames = 0;
  let hintCells: { r: number; c: number }[] | null = null;
  let bannerTimer = 0;
  let bannerTitle = "";
  let bannerSub = "";
  let best = 0;

  /* ---- High score (local) ---- */
  function loadBest(): number {
    try { return Number(localStorage.getItem("candy-burst-best")) || 0; } catch { return 0; }
  }
  function touchBest() {
    if (totalScore > best) {
      best = totalScore;
      try { localStorage.setItem("candy-burst-best", String(best)); } catch { /* ignore */ }
    }
  }
  best = loadBest();

  /* ---- Input ---- */
  let pointerDown = false;
  let downX = 0, downY = 0;
  let downCell: { r: number; c: number } | null = null;

  function toCanvas(px: number, py: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: (px - rect.left) * (W / rect.width), y: (py - rect.top) * (H / rect.height) };
  }

  function cellAt(px: number, py: number): { r: number; c: number } | null {
    const c = Math.floor((px - GRID_OFFSET_X) / CELL_SIZE);
    const r = Math.floor((py - GRID_OFFSET_Y) / CELL_SIZE);
    if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) return { r, c };
    return null;
  }

  function onPointerDown(px: number, py: number) {
    if (state === "menu") { startGamePlay(); return; }
    if (state === "gameover" || state === "victory") { resetGame(); return; }
    if (state !== "playing") return;
    pointerDown = true;
    downX = px; downY = py;
    const cell = cellAt(px, py);
    downCell = cell;
    if (!cell) return;
    if (!selected) {
      selected = cell;
    } else {
      const dr = Math.abs(cell.r - selected.r);
      const dc = Math.abs(cell.c - selected.c);
      if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
        trySwap(selected, cell);
      } else {
        selected = cell;
      }
    }
  }

  function onPointerUp(px: number, py: number) {
    pointerDown = false;
    if (state !== "playing") return;
    // Drag/swipe swap: compare against the press position
    if (downCell) {
      const dx = px - downX;
      const dy = py - downY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        let target: { r: number; c: number };
        if (Math.abs(dx) > Math.abs(dy)) target = { r: downCell.r, c: downCell.c + (dx > 0 ? 1 : -1) };
        else target = { r: downCell.r + (dy > 0 ? 1 : -1), c: downCell.c };
        if (target.r >= 0 && target.r < GRID_SIZE && target.c >= 0 && target.c < GRID_SIZE) {
          trySwap(downCell, target);
        }
      }
    }
    downCell = null;
  }

  function onMouseDown(e: MouseEvent) {
    const p = toCanvas(e.clientX, e.clientY);
    onPointerDown(p.x, p.y);
  }
  function onMouseUp(e: MouseEvent) {
    const p = toCanvas(e.clientX, e.clientY);
    onPointerUp(p.x, p.y);
  }
  function onTouchStart(e: TouchEvent) {
    e.preventDefault();
    const t = e.touches[0];
    const p = toCanvas(t.clientX, t.clientY);
    onPointerDown(p.x, p.y);
  }
  function onTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (pointerDown && e.touches[0]) {
      const t = e.touches[0];
      const p = toCanvas(t.clientX, t.clientY);
      // Live swipe: trigger as soon as the drag passes the threshold
      const dx = p.x - downX;
      const dy = p.y - downY;
      if (Math.abs(dx) > DRAG_THRESHOLD * 1.4 || Math.abs(dy) > DRAG_THRESHOLD * 1.4) {
        onPointerUp(p.x, p.y);
      }
    }
  }
  function onTouchEnd(e: TouchEvent) {
    e.preventDefault();
    const t = e.changedTouches[0];
    const p = toCanvas(t.clientX, t.clientY);
    onPointerUp(p.x, p.y);
  }
  function onKeyDown(e: KeyboardEvent) {
    if (state === "menu" && (e.code === "Space" || e.code === "Enter")) startGamePlay();
    if ((state === "gameover" || state === "victory") && (e.code === "Space" || e.code === "Enter")) resetGame();
  }

  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  /* ---- Grid Logic ---- */
  function createCandy(r: number, c: number, color: number, yOffset = 0, special = SP_NONE): Candy {
    return {
      color,
      special,
      x: GRID_OFFSET_X + c * CELL_SIZE + CELL_SIZE / 2,
      y: GRID_OFFSET_Y + r * CELL_SIZE + CELL_SIZE / 2 + yOffset,
      targetX: GRID_OFFSET_X + c * CELL_SIZE + CELL_SIZE / 2,
      targetY: GRID_OFFSET_Y + r * CELL_SIZE + CELL_SIZE / 2,
      clearing: false,
      clearTimer: 0,
      scale: 1,
      squash: 0,
      fallSpeed: 0,
      wobblePhase: Math.random() * Math.PI * 2,
      activated: false,
    };
  }

  function createsInitialMatch(r: number, c: number, color: number): boolean {
    if (c >= 2 && grid[r][c - 1]?.color === color && grid[r][c - 2]?.color === color) return true;
    if (r >= 2 && grid[r - 1]?.[c]?.color === color && grid[r - 2]?.[c]?.color === color) return true;
    return false;
  }

  function initGrid(numColors: number) {
    grid = Array.from({ length: GRID_SIZE }, () => Array<Candy | null>(GRID_SIZE).fill(null));
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        let color: number;
        let attempts = 0;
        do {
          color = Math.floor(Math.random() * numColors);
          attempts++;
        } while (attempts < 20 && createsInitialMatch(r, c, color));
        grid[r][c] = createCandy(r, c, color);
      }
    }
  }

  /** All maximal runs of 3+ and the union of matched cells. */
  function findRuns(): { runs: Run[]; cells: { r: number; c: number }[] } {
    const runs: Run[] = [];
    const matched = new Set<string>();
    // Horizontal runs
    for (let r = 0; r < GRID_SIZE; r++) {
      let c = 0;
      while (c < GRID_SIZE) {
        const a = grid[r][c];
        if (!a || a.color < 0) { c++; continue; }
        let end = c + 1;
        while (end < GRID_SIZE && grid[r][end] && grid[r][end]!.color === a.color) end++;
        if (end - c >= 3) {
          const cells: { r: number; c: number }[] = [];
          for (let i = c; i < end; i++) { cells.push({ r, c: i }); matched.add(cellKey(r, i)); }
          runs.push({ cells, horizontal: true, length: end - c });
        }
        c = end;
      }
    }
    // Vertical runs
    for (let c = 0; c < GRID_SIZE; c++) {
      let r = 0;
      while (r < GRID_SIZE) {
        const a = grid[r][c];
        if (!a || a.color < 0) { r++; continue; }
        let end = r + 1;
        while (end < GRID_SIZE && grid[end][c] && grid[end][c]!.color === a.color) end++;
        if (end - r >= 3) {
          const cells: { r: number; c: number }[] = [];
          for (let i = r; i < end; i++) { cells.push({ r: i, c }); matched.add(cellKey(i, c)); }
          runs.push({ cells, horizontal: false, length: end - r });
        }
        r = end;
      }
    }
    const cells = [...matched].map(s => { const [r, c] = s.split(",").map(Number); return { r, c }; });
    return { runs, cells };
  }

  /** Pick which special candy (if any) a match set should spawn. */
  function pickSpecial(runs: Run[], cellSet: Set<string>, prefer: { r: number; c: number } | null): { r: number; c: number; type: number } | null {
    const inSet = (r: number, c: number) => cellSet.has(cellKey(r, c));
    // 1) 5+ run → Color Bomb (center of run, or the swapped cell if it's in it)
    for (const run of runs) {
      if (run.length >= 5) {
        let pos = run.cells[Math.floor(run.length / 2)];
        if (prefer && inSet(prefer.r, prefer.c) && run.cells.some(x => x.r === prefer.r && x.c === prefer.c)) pos = prefer;
        return { r: pos.r, c: pos.c, type: SP_BOMB };
      }
    }
    // 2) L/T intersection (cell in both a horizontal and vertical run of 3+) → Wrapped
    const hCells = new Set<string>();
    const vCells = new Set<string>();
    for (const run of runs) {
      if (run.length < 3) continue;
      for (const x of run.cells) (run.horizontal ? hCells : vCells).add(cellKey(x.r, x.c));
    }
    let wrappedPos: { r: number; c: number } | null = null;
    if (prefer && hCells.has(cellKey(prefer.r, prefer.c)) && vCells.has(cellKey(prefer.r, prefer.c))) wrappedPos = prefer;
    else for (const k of hCells) if (vCells.has(k)) { wrappedPos = { r: Number(k.split(",")[0]), c: Number(k.split(",")[1]) }; break; }
    if (wrappedPos) return { r: wrappedPos.r, c: wrappedPos.c, type: SP_WRAPPED };
    // 3) 4-run → Striped (horizontal match → vertical stripes, and vice versa)
    for (const run of runs) {
      if (run.length === 4) {
        let pos = run.cells[Math.floor(run.length / 2)];
        if (prefer && run.cells.some(x => x.r === prefer.r && x.c === prefer.c)) pos = prefer;
        return { r: pos.r, c: pos.c, type: run.horizontal ? SP_STRIPED_V : SP_STRIPED_H };
      }
    }
    return null;
  }

  /** Expand a clear set through special-candy chain reactions. */
  function expandClear(initial: Set<string>, partnerColor: number): { set: Set<string>; specialCount: number; bombUsed: boolean } {
    const result = new Set(initial);
    let specialCount = 0;
    let bombUsed = false;
    const queue: string[] = [];
    const pushCell = (r: number, c: number) => {
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return;
      const k = cellKey(r, c);
      if (result.has(k)) return;
      result.add(k);
      const cd = grid[r][c];
      if (cd && cd.special !== SP_NONE && !cd.activated) queue.push(k);
    };
    for (const k of initial) {
      const [r, c] = k.split(",").map(Number);
      const cd = grid[r][c];
      if (cd && cd.special !== SP_NONE && !cd.activated) queue.push(k);
    }
    const dominantColor = (): number => {
      const counts = new Array(5).fill(0);
      for (let r = 0; r < GRID_SIZE; r++)
        for (let c = 0; c < GRID_SIZE; c++) {
          const cd = grid[r][c];
          if (cd && cd.color >= 0) counts[cd.color]++;
        }
      let bestC = 0, bestN = 0;
      for (let i = 0; i < 5; i++) if (counts[i] > bestN) { bestN = counts[i]; bestC = i; }
      return bestC;
    };
    let guard = 0;
    while (queue.length > 0 && guard++ < 64) {
      const k = queue.shift()!;
      const [r, c] = k.split(",").map(Number);
      const cd = grid[r][c];
      if (!cd || cd.activated) continue;
      cd.activated = true;
      specialCount++;
      if (cd.special === SP_STRIPED_H) { for (let cc = 0; cc < GRID_SIZE; cc++) pushCell(r, cc); }
      else if (cd.special === SP_STRIPED_V) { for (let rr = 0; rr < GRID_SIZE; rr++) pushCell(rr, c); }
      else if (cd.special === SP_WRAPPED) {
        for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) pushCell(rr, cc);
      } else if (cd.special === SP_BOMB) {
        bombUsed = true;
        const col = partnerColor >= 0 ? partnerColor : dominantColor();
        for (let rr = 0; rr < GRID_SIZE; rr++)
          for (let cc = 0; cc < GRID_SIZE; cc++)
            if (grid[rr][cc] && grid[rr][cc]!.color === col) pushCell(rr, cc);
      }
    }
    return { set: result, specialCount, bombUsed };
  }

  function trySwap(a: { r: number; c: number }, b: { r: number; c: number }) {
    if (state !== "playing") return;
    const candyA = grid[a.r][a.c];
    const candyB = grid[b.r][b.c];
    if (!candyA || !candyB) return;

    const isBomb = candyA.special === SP_BOMB || candyB.special === SP_BOMB;
    if (!isBomb) {
      grid[a.r][a.c] = candyB;
      grid[b.r][b.c] = candyA;
      const ok = findRuns().cells.length > 0;
      if (!ok) {
        grid[a.r][a.c] = candyA;
        grid[b.r][b.c] = candyB;
        AudioSys.invalid();
        selected = null;
        return;
      }
    }

    AudioSys.swap();
    state = "swapping";
    swapFrom = a; swapTo = b; swapProgress = 0;
    bombSwap = isBomb;
    bombPartnerColor = candyA.special === SP_BOMB ? candyB.color : candyB.special === SP_BOMB ? candyA.color : -1;
    movesLeft--;
    combo = 0;
    selected = null;
    hintCells = null;
    idleFrames = 0;

    grid[a.r][a.c] = candyB;
    grid[b.r][b.c] = candyA;

    candyA.targetX = GRID_OFFSET_X + b.c * CELL_SIZE + CELL_SIZE / 2;
    candyA.targetY = GRID_OFFSET_Y + b.r * CELL_SIZE + CELL_SIZE / 2;
    candyB.targetX = GRID_OFFSET_X + a.c * CELL_SIZE + CELL_SIZE / 2;
    candyB.targetY = GRID_OFFSET_Y + a.r * CELL_SIZE + CELL_SIZE / 2;
  }

  function clearMatches(initialCells: { r: number; c: number }[], runs: Run[], partnerColor: number) {
    if (initialCells.length === 0) return;
    combo++;

    const initialSet = new Set(initialCells.map(c => cellKey(c.r, c.c)));
    // Reset per-set activation guards
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++)
        if (grid[r][c]) grid[r][c]!.activated = false;

    const { set, specialCount, bombUsed } = expandClear(initialSet, partnerColor);

    // Spawn a special candy from this match (first clear of a swap only)
    if (combo === 1 && runs.length > 0) {
      const spec = pickSpecial(runs, initialSet, swapTo);
      if (spec) {
        initialSet.delete(cellKey(spec.r, spec.c));
        const cd = grid[spec.r][spec.c];
        if (cd) {
          cd.special = spec.type;
          if (spec.type === SP_BOMB) cd.color = -1;
          cd.clearing = false;
          floatTexts.push({
            x: cd.x, y: cd.y - 26,
            text: spec.type === SP_BOMB ? "RENK BOMBASI!" : spec.type === SP_WRAPPED ? "SARMALI!" : "ÇUBUKLU!",
            color: "#7ab8f0", life: 50, size: 16,
          });
        }
      }
    }

    const points = set.size * SCORE_PER_CANDY + (combo > 1 ? combo * COMBO_BONUS : 0) + specialCount * SPECIAL_BONUS;
    score += points;
    totalScore += points;
    touchBest();

    if (boss && boss.alive) {
      boss.hp = Math.max(0, boss.hp - set.size);
      boss.flashTimer = 10;
      if (boss.hp <= 0) {
        boss.alive = false;
        boss.deathTimer = 60;
        AudioSys.bossDefeat();
        score += 1000;
        totalScore += 1000;
        touchBest();
        spawnBurst(boss.x, boss.y, 30, "#ff4444");
        spawnBurst(boss.x, boss.y, 20, "#ffd700");
        spawnRing(boss.x, boss.y, "#ffd700");
        shakeTimer = 20;
        shakeIntensity = 12;
      } else {
        AudioSys.bossHit();
      }
    }

    AudioSys.match();
    if (combo > 1) AudioSys.cascade();
    if (specialCount > 0) AudioSys.special();
    if (bombUsed) { AudioSys.bomb(); shakeTimer = Math.max(shakeTimer, 14); shakeIntensity = Math.max(shakeIntensity, 8); }

    const cx = [...set].reduce((s, k) => s + Number(k.split(",")[1]), 0) / set.size;
    const cy = [...set].reduce((s, k) => s + Number(k.split(",")[0]), 0) / set.size;
    floatTexts.push({
      x: GRID_OFFSET_X + cx * CELL_SIZE + CELL_SIZE / 2,
      y: GRID_OFFSET_Y + cy * CELL_SIZE,
      text: specialCount > 0 ? `SÜPER! +${points}` : `+${points}`,
      color: specialCount > 0 || combo > 1 ? "#ffd700" : "#fff",
      life: 40,
      size: specialCount > 0 ? 24 : 20,
    });
    if (floatTexts.length > 10) floatTexts.splice(0, floatTexts.length - 10);

    for (const k of set) {
      const [r, c] = k.split(",").map(Number);
      const cd = grid[r][c];
      if (cd && !cd.clearing) {
        cd.clearing = true;
        cd.clearTimer = CLEAR_DURATION / 16;
        const col = cd.color >= 0 ? COLORS[cd.color].base : "#ffd700";
        spawnBurst(GRID_OFFSET_X + c * CELL_SIZE + CELL_SIZE / 2, GRID_OFFSET_Y + r * CELL_SIZE + CELL_SIZE / 2, cd.special === SP_NONE ? 5 : 8, col);
        if (cd.special !== SP_NONE) spawnRing(GRID_OFFSET_X + c * CELL_SIZE + CELL_SIZE / 2, GRID_OFFSET_Y + r * CELL_SIZE + CELL_SIZE / 2, col);
      }
    }

    state = "clearing";
    stateTimer = CLEAR_DURATION / 16;
  }

  function applyGravity() {
    const numC = currentConfig.numColors;
    for (let c = 0; c < GRID_SIZE; c++) {
      let writeRow = GRID_SIZE - 1;
      for (let r = GRID_SIZE - 1; r >= 0; r--) {
        const candy = grid[r][c];
        if (candy && !candy.clearing) {
          if (writeRow !== r) {
            grid[writeRow][c] = candy;
            grid[r][c] = null;
            candy.targetY = GRID_OFFSET_Y + writeRow * CELL_SIZE + CELL_SIZE / 2;
          }
          writeRow--;
        }
      }
      for (let r = writeRow; r >= 0; r--) {
        const color = Math.floor(Math.random() * numC);
        const newCandy = createCandy(r, c, color, -(writeRow - r + 1) * CELL_SIZE - 20);
        grid[r][c] = newCandy;
      }
    }
  }

  function hasValidMoves(): boolean {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (c < GRID_SIZE - 1) {
          const a = grid[r][c], b = grid[r][c + 1];
          if (a && b) {
            grid[r][c] = b; grid[r][c + 1] = a;
            const has = findRuns().cells.length > 0;
            grid[r][c] = a; grid[r][c + 1] = b;
            if (has) return true;
          }
        }
        if (r < GRID_SIZE - 1) {
          const a = grid[r][c], b = grid[r + 1][c];
          if (a && b) {
            grid[r][c] = b; grid[r + 1][c] = a;
            const has = findRuns().cells.length > 0;
            grid[r][c] = a; grid[r + 1][c] = b;
            if (has) return true;
          }
        }
      }
    }
    return false;
  }

  /** Find the first valid move (for the hint system). */
  function findHintMove(): { a: { r: number; c: number }; b: { r: number; c: number } } | null {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const dirs = [[0, 1], [1, 0]];
        for (const [dr, dc] of dirs) {
          const r2 = r + dr, c2 = c + dc;
          if (r2 >= GRID_SIZE || c2 >= GRID_SIZE) continue;
          const a = grid[r][c], b = grid[r2][c2];
          if (!a || !b) continue;
          // Bomb swap is always valid
          if (a.special === SP_BOMB || b.special === SP_BOMB) return { a: { r, c }, b: { r: r2, c: c2 } };
          grid[r][c] = b; grid[r2][c2] = a;
          const has = findRuns().cells.length > 0;
          grid[r][c] = a; grid[r2][c2] = b;
          if (has) return { a: { r, c }, b: { r: r2, c: c2 } };
        }
      }
    }
    return null;
  }

  function reshuffleGrid() {
    let ok = false;
    for (let attempt = 0; attempt < 40 && !ok; attempt++) {
      const allColors: number[] = [];
      for (let r = 0; r < GRID_SIZE; r++)
        for (let c = 0; c < GRID_SIZE; c++)
          if (grid[r][c] && grid[r][c]!.color >= 0) allColors.push(grid[r][c]!.color);
      for (let i = allColors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allColors[i], allColors[j]] = [allColors[j], allColors[i]];
      }
      let idx = 0;
      for (let r = 0; r < GRID_SIZE; r++)
        for (let c = 0; c < GRID_SIZE; c++)
          if (grid[r][c] && grid[r][c]!.color >= 0) grid[r][c]!.color = allColors[idx++];
      ok = findRuns().cells.length === 0 && hasValidMoves();
    }
    if (!ok) {
      initGrid(currentConfig.numColors);
      let g = 0;
      while (!hasValidMoves() && g++ < 50) initGrid(currentConfig.numColors);
    }
    floatTexts.push({ x: W / 2, y: H / 2 - 20, text: "KARIŞTIRILIYOR!", color: "#69dbff", life: 60, size: 28 });
    AudioSys.shuffle();
    shakeTimer = 8;
    shakeIntensity = 4;
  }

  function spawnBurst(x: number, y: number, count: number, color: string) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 4;
      particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 2, life: 20 + Math.random() * 20, maxLife: 40, size: 2 + Math.random() * 4, color, kind: "dot" });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function spawnRing(x: number, y: number, color: string) {
    particles.push({ x, y, vx: 0, vy: 0, life: 22, maxLife: 22, size: 46, color, kind: "ring" });
  }

  function spawnSparkles(x: number, y: number, count: number, color: string) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 0.5 + Math.random() * 2;
      particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 1, life: 24 + Math.random() * 16, maxLife: 40, size: 3 + Math.random() * 3, color, kind: "sparkle" });
    }
  }

  /* ---- Level Management ---- */
  function startLevel(lvl: number) {
    level = lvl;
    score = 0;
    combo = 0;
    isBossLevel = lvl % 10 === 0;
    currentConfig = getLevelConfig(lvl);
    movesLeft = currentConfig.moves;
    targetScore = currentConfig.targetScore;

    (window as any).__candyBossMusic = isBossLevel;

    if (isBossLevel) {
      boss = { hp: currentConfig.bossHp, maxHp: currentConfig.bossHp, x: W / 2, y: 50, flashTimer: 0, alive: true, deathTimer: 0 };
    } else {
      boss = null;
    }

    initGrid(currentConfig.numColors);
    let attempts = 0;
    while (!hasValidMoves() && attempts < 50) { initGrid(currentConfig.numColors); attempts++; }
    state = "playing";
    selected = null;
    hintCells = null;
    idleFrames = 0;
    bannerTitle = `BÖLÜM ${lvl}`;
    bannerSub = isBossLevel ? `${currentConfig.name} — BOSS SAVAŞI!` : currentConfig.name;
    bannerTimer = 110;
  }

  function startGamePlay() {
    AudioSys.init();
    AudioSys.resume();
    AudioSys.startMusic();
    totalScore = 0;
    startLevel(1);
  }

  function resetGame() {
    totalScore = 0;
    startLevel(1);
    AudioSys.startMusic();
  }

  function checkLevelComplete(): boolean {
    if (isBossLevel) {
      if (boss && !boss.alive) {
        state = "levelComplete";
        stateTimer = 120;
        AudioSys.levelup();
        return true;
      }
      return false;
    }
    if (score >= targetScore) {
      state = "levelComplete";
      stateTimer = 120;
      AudioSys.levelup();
      return true;
    }
    return false;
  }

  /* ---- Update ---- */
  function update() {
    animTime++;
    if (shakeTimer > 0) shakeTimer--;
    if (bannerTimer > 0) bannerTimer--;

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.kind !== "ring") { p.x += p.vx; p.y += p.vy; p.vy += 0.15; }
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatTexts.length - 1; i >= 0; i--) {
      floatTexts[i].y -= 1; floatTexts[i].life--;
      if (floatTexts[i].life <= 0) floatTexts.splice(i, 1);
    }
    if (boss) {
      if (boss.flashTimer > 0) boss.flashTimer--;
      if (!boss.alive && boss.deathTimer > 0) { boss.deathTimer--; if (boss.deathTimer <= 0) boss = null; }
    }
    // Squash decay
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cd = grid[r]?.[c];
        if (cd && cd.squash > 0.01) cd.squash *= 0.82;
        else if (cd) cd.squash = 0;
      }
    }
    if (state === "playing") {
      idleFrames++;
      if (idleFrames > HINT_DELAY) {
        const mv = findHintMove();
        if (mv) {
          hintCells = [mv.a, mv.b];
          idleFrames = HINT_DELAY - 150; // re-hint after ~2.5s
          AudioSys.hint();
        }
      }
    }

    if (state === "swapping") {
      swapProgress += 1 / (SWAP_DURATION / 16);
      if (swapFrom && swapTo) {
        const a = grid[swapFrom.r][swapFrom.c];
        const b = grid[swapTo.r][swapTo.c];
        if (a && b) {
          const t = Math.min(1, swapProgress);
          const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          a.x = a.x + (a.targetX - a.x) * ease * 0.3;
          a.y = a.y + (a.targetY - a.y) * ease * 0.3;
          b.x = b.x + (b.targetX - b.x) * ease * 0.3;
          b.y = b.y + (b.targetY - b.y) * ease * 0.3;
          if (t >= 1) {
            a.x = a.targetX; a.y = a.targetY;
            b.x = b.targetX; b.y = b.targetY;
            const { cells, runs } = findRuns();
            if (bombSwap) {
              const init = [{ r: swapFrom.r, c: swapFrom.c }, { r: swapTo.r, c: swapTo.c }, ...cells];
              clearMatches(init, runs, bombPartnerColor);
            } else if (cells.length > 0) {
              clearMatches(cells, runs, -1);
            } else {
              state = "playing";
              swapFrom = null; swapTo = null;
              bombSwap = false;
            }
          }
        } else { state = "playing"; swapFrom = null; swapTo = null; bombSwap = false; }
      }
    } else if (state === "clearing") {
      stateTimer--;
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const candy = grid[r][c];
          if (candy?.clearing) {
            candy.clearTimer--;
            candy.scale = Math.max(0, candy.clearTimer / (CLEAR_DURATION / 16));
            if (candy.clearTimer <= 0) grid[r][c] = null;
          }
        }
      }
      if (stateTimer <= 0) { applyGravity(); state = "falling"; }
    } else if (state === "falling") {
      let allSettled = true;
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const candy = grid[r][c];
          if (candy) {
            const dy = candy.targetY - candy.y;
            if (Math.abs(dy) > 1) {
              const step = Math.sign(dy) * Math.min(Math.abs(dy), FALL_SPEED);
              candy.fallSpeed = Math.abs(step);
              candy.y += step;
              allSettled = false;
            } else {
              if (candy.fallSpeed > 7) candy.squash = 1;
              candy.fallSpeed = 0;
              candy.y = candy.targetY;
              candy.scale = 1;
            }
          }
        }
      }
      if (allSettled) {
        const { cells, runs } = findRuns();
        if (cells.length > 0) {
          clearMatches(cells, runs, -1);
        } else {
          combo = 0;
          if (!checkLevelComplete()) {
            if (movesLeft <= 0) {
              if (isBossLevel) {
                if (boss && !boss.alive) { state = "levelComplete"; stateTimer = 120; AudioSys.levelup(); }
                else { saveScore("candy-burst", totalScore); state = "gameover"; AudioSys.stopMusic(); AudioSys.lose(); }
              } else {
                if (score < targetScore) { saveScore("candy-burst", totalScore); state = "gameover"; AudioSys.stopMusic(); AudioSys.lose(); }
                else { state = "levelComplete"; stateTimer = 120; AudioSys.levelup(); }
              }
            } else if (!hasValidMoves()) {
              reshuffleGrid();
            }
            state = "playing";
          }
        }
      }
    } else if (state === "levelComplete") {
      stateTimer--;
      if (stateTimer <= 0) {
        if (level >= 30) {
          saveScore("candy-burst", totalScore);
          state = "victory";
          AudioSys.stopMusic();
          AudioSys.levelup();
          for (let i = 0; i < 8; i++) {
            spawnBurst(100 + Math.random() * (W - 200), 80 + Math.random() * 200, 12, COLORS[i % 5].base);
            spawnSparkles(W / 2, H / 2, 10, "#ffd700");
          }
        } else startLevel(level + 1);
      }
    }
  }

  /* ---- Candy shape helpers ---- */
  function starPath(cx: number, cy: number, spikes: number, outer: number, inner: number) {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function hexPath(s: number) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * s;
      const py = Math.sin(a) * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // Trace the silhouette for a candy color (centered at 0,0, radius ~ size).
  function traceCandyShape(color: number, s: number) {
    ctx.beginPath();
    switch (color) {
      case 0: // red → heart
        ctx.moveTo(0, s * 0.85);
        ctx.bezierCurveTo(-s * 1.35, s * 0.05, -s * 0.95, -s * 0.75, 0, -s * 0.2);
        ctx.bezierCurveTo(s * 0.95, -s * 0.75, s * 1.35, s * 0.05, 0, s * 0.85);
        ctx.closePath();
        break;
      case 1: // orange → round citrus
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.closePath();
        break;
      case 2: // yellow → star
        starPath(0, 0, 5, s, s * 0.45);
        break;
      case 3: // green → hexagon
        hexPath(s);
        break;
      default: // blue → gem / diamond
        ctx.moveTo(0, -s * 1.1);
        ctx.lineTo(s * 0.85, 0);
        ctx.lineTo(0, s * 1.1);
        ctx.lineTo(-s * 0.85, 0);
        ctx.closePath();
        break;
    }
  }

  function drawCandy(candy: Candy) {
    if (!candy) return;
    const settled = Math.abs(candy.y - candy.targetY) < 1 && !candy.clearing;
    const wobble = settled ? Math.sin(animTime * 0.06 + candy.wobblePhase) * 1.3 : 0;
    const x = candy.x;
    const y = candy.y + wobble;
    const size = CELL_SIZE * 0.4 * candy.scale;
    if (size <= 0) return;

    const col = candy.color >= 0 ? COLORS[candy.color] : COLORS[0];
    ctx.save();
    ctx.translate(x, y);
    // Landing squash: wide & flat
    const sx = 1 + candy.squash * 0.22;
    const sy = 1 - candy.squash * 0.28;
    ctx.scale(sx, sy);

    // Soft drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(2, size * 0.55, size * 0.9, size * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    if (candy.special === SP_BOMB) {
      // ---- Color Bomb: rotating rainbow sphere ----
      const rot = animTime * 0.04;
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.05, 0, Math.PI * 2);
      ctx.closePath();
      ctx.save();
      ctx.clip();
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = COLORS[i % 5].base;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, size * 1.1, rot + (i / 8) * Math.PI * 2, rot + ((i + 1) / 8) * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      const bg = ctx.createRadialGradient(-size * 0.3, -size * 0.3, size * 0.1, 0, 0, size * 1.05);
      bg.addColorStop(0, "rgba(255,255,255,0.75)");
      bg.addColorStop(0.5, "rgba(255,255,255,0.1)");
      bg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Orbiting sparkles
      for (let i = 0; i < 3; i++) {
        const a = rot * 2 + (i / 3) * Math.PI * 2;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(Math.cos(a) * size * 0.6, Math.sin(a) * size * 0.6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Body gradient (light source from top-left)
      const grad = ctx.createRadialGradient(-size * 0.25, -size * 0.25, size * 0.1, 0, 0, size);
      grad.addColorStop(0, col.light);
      grad.addColorStop(0.55, col.base);
      grad.addColorStop(1, col.dark);

      traceCandyShape(candy.color, size);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Striped overlay (clipped to the shape)
      if (candy.special === SP_STRIPED_H || candy.special === SP_STRIPED_V) {
        ctx.save();
        traceCandyShape(candy.color, size);
        ctx.clip();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        if (candy.special === SP_STRIPED_H) {
          for (const oy of [-0.5, 0, 0.5]) ctx.fillRect(-size * 1.2, oy * size - size * 0.13, size * 2.4, size * 0.26);
        } else {
          for (const ox of [-0.5, 0, 0.5]) ctx.fillRect(ox * size - size * 0.13, -size * 1.2, size * 0.26, size * 2.4);
        }
        ctx.restore();
      }

      // Shape-specific inner detail
      if (candy.color === 1) {
        // orange segments
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * size * 0.28, Math.sin(a) * size * 0.28);
          ctx.lineTo(Math.cos(a) * size * 0.9, Math.sin(a) * size * 0.9);
          ctx.stroke();
        }
      } else if (candy.color === 4) {
        // gem facet lines
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-size * 0.42, -size * 0.55);
        ctx.lineTo(size * 0.42, -size * 0.55);
        ctx.moveTo(0, -size * 1.1);
        ctx.lineTo(0, size * 1.1);
        ctx.stroke();
      } else if (candy.color === 2) {
        // star inner glint
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.arc(0, -size * 0.2, size * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else if (candy.color === 0) {
        // heart sparkle
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.beginPath();
        ctx.arc(-size * 0.35, -size * 0.3, size * 0.12, 0, Math.PI * 2);
        ctx.fill();
      } else if (candy.color === 3) {
        // hexagon core
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * size * 0.45;
          const py = Math.sin(a) * size * 0.45;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Gloss highlight
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.ellipse(-size * 0.28, -size * 0.38, size * 0.3, size * 0.18, -0.5, 0, Math.PI * 2);
      ctx.fill();

      // Wrapped: pulsing glow rings
      if (candy.special === SP_WRAPPED) {
        const pulse = 1 + Math.sin(animTime * 0.15) * 0.08;
        ctx.strokeStyle = "rgba(255,215,0,0.8)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, size * 1.18 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, size * 1.35 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawBoss(b: BossState) {
    if (!b.alive && b.deathTimer <= 0) return;
    ctx.save();
    ctx.translate(b.x, b.y);

    const pulse = 1 + Math.sin(animTime * 0.08) * 0.04;
    const flash = b.flashTimer > 0 && b.flashTimer % 4 < 2;
    const dying = !b.alive;
    ctx.scale(pulse, pulse * (dying ? Math.max(0.2, b.deathTimer / 60) : 1));

    ctx.shadowColor = flash ? "#ffffff" : "#ff0000";
    ctx.shadowBlur = 20;

    ctx.fillStyle = flash ? "#ff6666" : "#2a1a3a";
    ctx.beginPath();
    ctx.ellipse(0, 0, 50, 40, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = flash ? "#ff8888" : "#3a2a4a";
    ctx.beginPath();
    ctx.ellipse(0, -5, 38, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = flash ? "#ffffff" : "#5a4a7a";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = flash ? "#ffaaaa" : "#4a3a5a";
    ctx.beginPath(); ctx.moveTo(-25, -25); ctx.lineTo(-40, -55); ctx.lineTo(-15, -30); ctx.fill();
    ctx.beginPath(); ctx.moveTo(25, -25); ctx.lineTo(40, -55); ctx.lineTo(15, -30); ctx.fill();

    ctx.shadowBlur = 0;

    ctx.fillStyle = flash ? "#ffffff" : "#ff2200";
    ctx.shadowColor = "#ff2200";
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.ellipse(-15, -8, 8, 6, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(15, -8, 8, 6, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffff00";
    ctx.beginPath(); ctx.arc(-15, -8, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(15, -8, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#ff4400";
    ctx.beginPath(); ctx.arc(0, 12, 12, 0, Math.PI); ctx.fill();
    ctx.fillStyle = "#fff";
    for (let i = -9; i <= 9; i += 4) ctx.fillRect(i - 1.5, 12, 3, 6);

    ctx.restore();

    const barW = 100;
    const barH = 10;
    const bx = b.x - barW / 2;
    const by = b.y - 55;
    ctx.fillStyle = "#222";
    ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    ctx.fillStyle = "#111";
    ctx.fillRect(bx, by, barW, barH);
    const ratio = b.hp / b.maxHp;
    ctx.fillStyle = ratio > 0.5 ? "#44cc44" : ratio > 0.25 ? "#ffaa00" : "#ff2200";
    ctx.fillRect(bx, by, barW * ratio, barH);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 1, by - 1, barW + 2, barH + 2);

    ctx.fillStyle = "#ff4444";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("BOSS", b.x, by - 6);
  }

  function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    if (currentConfig.name === "BOSS" || currentConfig.name === "KÂBUS" || currentConfig.name === "ULTRA") {
      grad.addColorStop(0, "#1a0a2e");
      grad.addColorStop(0.5, "#2d1b4e");
      grad.addColorStop(1, "#0a0a1a");
    } else {
      grad.addColorStop(0, "#2a1a4e");
      grad.addColorStop(0.5, "#1a2a5e");
      grad.addColorStop(1, "#0a1a3a");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Twinkling stars
    for (let i = 0; i < 50; i++) {
      const x = (i * 173.7) % W;
      const y = (i * 97.3) % (H * 0.6);
      const size = (i % 3) + 1;
      ctx.globalAlpha = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(animTime * 0.04 + i * 1.7));
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;

    // Faint floating candy silhouettes drifting across the backdrop
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 260 + animTime * 0.15) % (W + 220)) - 110;
      const cy = 130 + ((i * 173 + animTime * 0.08) % 240);
      const csize = 30 + (i % 3) * 18;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = COLORS[i % 5].base;
      traceCandyShape(i % 5, csize);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Soft vignette for depth
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.32)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGridPanel() {
    const px = GRID_OFFSET_X - 10;
    const py = GRID_OFFSET_Y - 10;
    const pw = GRID_SIZE * CELL_SIZE + 20;
    const ph = GRID_SIZE * CELL_SIZE + 20;
    ctx.save();
    ctx.shadowColor = "rgba(255,210,63,0.35)";
    ctx.shadowBlur = 18;
    roundRectPath(px, py, pw, ph, 14);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,210,63,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const x = GRID_OFFSET_X + c * CELL_SIZE;
        const y = GRID_OFFSET_Y + r * CELL_SIZE;
        ctx.fillStyle = (r + c) % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)";
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }

    // Selection highlight
    if (selected) {
      const sx = GRID_OFFSET_X + selected.c * CELL_SIZE;
      const sy = GRID_OFFSET_Y + selected.r * CELL_SIZE;
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(sx + 2, sy + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.setLineDash([]);
    }

    // Hint highlight (pulsing)
    if (hintCells) {
      const a = 0.35 + Math.sin(animTime * 0.18) * 0.3;
      ctx.strokeStyle = `rgba(105,219,255,${a.toFixed(3)})`;
      ctx.lineWidth = 4;
      for (const hc of hintCells) {
        const sx = GRID_OFFSET_X + hc.c * CELL_SIZE;
        const sy = GRID_OFFSET_Y + hc.r * CELL_SIZE;
        roundRectPath(sx + 3, sy + 3, CELL_SIZE - 6, CELL_SIZE - 6, 8);
        ctx.stroke();
      }
    }
  }

  function drawHUD() {
    ctx.save();
    ctx.font = "bold 18px Arial";
    ctx.textBaseline = "top";

    // Difficulty label
    ctx.fillStyle = currentConfig.color;
    ctx.textAlign = "left";
    ctx.fillText(`${currentConfig.emoji} ${currentConfig.name}`, 15, 10);

    // Level
    ctx.fillStyle = "#69dbff";
    ctx.textAlign = "left";
    ctx.fillText(`Bölüm ${level}`, 15, 36);

    // Score / Target
    ctx.fillStyle = "#ffd700";
    ctx.textAlign = "center";
    const targetText = isBossLevel ? "BOSS'u Yen!" : `${score} / ${targetScore}`;
    ctx.fillText(targetText, W / 2, 12);

    // Progress bar (score levels)
    if (!isBossLevel) {
      const bx = W / 2 - 110, by = 38, bw = 220, bh = 8;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      roundRectPath(bx, by, bw, bh, 4);
      ctx.fill();
      const prog = Math.min(1, score / Math.max(1, targetScore));
      if (prog > 0) {
        const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        pg.addColorStop(0, "#ffd23f");
        pg.addColorStop(1, "#ff9e2c");
        ctx.fillStyle = pg;
        roundRectPath(bx, by, bw * prog, bh, 4);
        ctx.fill();
      }
    }

    // Moves
    ctx.fillStyle = movesLeft <= 5 ? "#ff6b6b" : "#ccc";
    ctx.textAlign = "right";
    ctx.fillText(`Hamle: ${movesLeft}`, W - 15, 12);

    // Total score
    ctx.fillStyle = "#888";
    ctx.font = "14px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`Toplam: ${totalScore}`, W - 15, 36);

    ctx.restore();
  }

  function drawBanner() {
    if (bannerTimer <= 0) return;
    const t = bannerTimer;
    const alpha = Math.min(1, t / 30, (110 - t) / 20);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, H / 2 - 90, W, 130);
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 46px Arial";
    ctx.fillStyle = isBossLevel ? "#ff4444" : "#ffd700";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 18;
    ctx.fillText(bannerTitle, W / 2, H / 2 - 40);
    ctx.shadowBlur = 0;
    ctx.font = "bold 24px Arial";
    ctx.fillStyle = isBossLevel ? "#ff8888" : "#69dbff";
    ctx.fillText(bannerSub, W / 2, H / 2 + 10);
    ctx.restore();
  }

  function drawMenu() {
    drawBackground();

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const pulse = 1 + Math.sin(animTime * 0.03) * 0.05;
    ctx.save();
    ctx.translate(W / 2, H / 2 - 100);
    ctx.scale(pulse, pulse);
    ctx.font = "bold 52px Arial";
    const tg = ctx.createLinearGradient(-220, 0, 220, 0);
    COLORS.forEach((c, i) => tg.addColorStop(i / (COLORS.length - 1), c.light));
    ctx.fillStyle = tg;
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 22;
    ctx.fillText("CANDY BURST", 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.font = "24px Arial";
    ctx.fillStyle = "#69dbff";
    ctx.fillText("Eşleştirme Macerası", W / 2, H / 2 - 40);

    // Candy preview (matches the in-game shapes)
    const previewColors = [0, 1, 2, 3, 4];
    for (let i = 0; i < previewColors.length; i++) {
      const px = W / 2 - 120 + i * 60;
      const py = H / 2 + 20 + Math.sin(animTime * 0.05 + i) * 8;
      const col = COLORS[previewColors[i]];
      ctx.save();
      ctx.translate(px, py);
      const grad = ctx.createRadialGradient(-5, -5, 3, 0, 0, 20);
      grad.addColorStop(0, col.light);
      grad.addColorStop(1, col.dark);
      traceCandyShape(previewColors[i], 20);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.font = "18px Arial";
    ctx.fillStyle = "#ccc";
    ctx.fillText("Boncukları eşleştir, zincirleme patlamalar yap!", W / 2, H / 2 + 80);
    ctx.fillText("4 sıra → Çubuklu • 5 sıra → Renk Bombası • L/T → Sarmalı!", W / 2, H / 2 + 108);
    ctx.fillText("Her 10 bölümde BOSS seni bekliyor!", W / 2, H / 2 + 136);

    if (best > 0) {
      ctx.font = "bold 18px Arial";
      ctx.fillStyle = "#ffd700";
      ctx.fillText(`🏆 REKOR: ${best}`, W / 2, H / 2 + 168);
    }

    const alpha = 0.5 + Math.sin(animTime * 0.06) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = "bold 26px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText("Tıkla veya SPACE ile Başla", W / 2, H / 2 + 200);
    ctx.globalAlpha = 1;

    ctx.font = "14px Arial";
    ctx.fillStyle = "#888";
    ctx.fillText("Kolay → Ultra | 30 Bölüm | Boss'lar dahil", W / 2, H - 30);

    ctx.restore();
  }

  function drawLevelComplete() {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 42px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 15;
    ctx.fillText(`BÖLÜM ${level} TAMAMLANDI!`, W / 2, H / 2 - 40);
    ctx.shadowBlur = 0;
    ctx.font = "22px Arial";
    ctx.fillStyle = "#ccc";
    ctx.fillText(`Skor: ${score}  |  Toplam: ${totalScore}`, W / 2, H / 2 + 20);
    if (isBossLevel) {
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "bold 24px Arial";
      ctx.fillText("BOSS YENİLDİ!", W / 2, H / 2 + 55);
    }
    ctx.restore();
  }

  function drawGameOver() {
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 48px Arial";
    ctx.fillStyle = "#ff4444";
    ctx.shadowColor = "#ff0000";
    ctx.shadowBlur = 20;
    ctx.fillText("OYUN BİTTİ", W / 2, H / 2 - 50);
    ctx.shadowBlur = 0;
    ctx.font = "22px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText(`Bölüm: ${level}  |  Skor: ${score}  |  Toplam: ${totalScore}`, W / 2, H / 2 + 10);
    ctx.font = "bold 20px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.fillText(`🏆 Rekor: ${best}`, W / 2, H / 2 + 42);
    const alpha = 0.5 + Math.sin(animTime * 0.06) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = "bold 22px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.fillText("Tıkla veya SPACE ile Tekrar Oyna", W / 2, H / 2 + 85);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawVictory() {
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 48px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 25;
    ctx.fillText("TEBRİKLER!", W / 2, H / 2 - 60);
    ctx.shadowBlur = 0;
    ctx.font = "28px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText("Tüm bölümleri tamamladın!", W / 2, H / 2 - 10);
    ctx.font = "22px Arial";
    ctx.fillStyle = "#ccc";
    ctx.fillText(`Toplam Skor: ${totalScore}  |  🏆 Rekor: ${best}`, W / 2, H / 2 + 30);
    const alpha = 0.5 + Math.sin(animTime * 0.06) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = "bold 22px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.fillText("Tıkla veya SPACE ile Tekrar Oyna", W / 2, H / 2 + 90);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    if (state === "menu") { drawMenu(); return; }

    ctx.save();
    if (shakeTimer > 0) {
      const shake = shakeIntensity * (shakeTimer / 20);
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawBackground();
    drawGridPanel();

    // Candies
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const candy = grid[r][c];
        if (candy) drawCandy(candy);
      }
    }

    // Boss
    if (boss) drawBoss(boss);

    // Particles
    for (const p of particles) {
      const lifeRatio = p.life / p.maxLife;
      if (p.kind === "ring") {
        ctx.globalAlpha = lifeRatio * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * lifeRatio + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - lifeRatio) + 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === "sparkle") {
        ctx.globalAlpha = lifeRatio;
        ctx.fillStyle = p.color;
        const s = p.size * lifeRatio;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 0.2);
        ctx.fillRect(-s, -s * 0.3, s * 2, s * 0.6);
        ctx.fillRect(-s * 0.3, -s, s * 0.6, s * 2);
        ctx.restore();
      } else {
        ctx.globalAlpha = lifeRatio;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Float texts
    for (const ft of floatTexts) {
      ctx.globalAlpha = Math.min(1, ft.life / 40);
      ctx.fillStyle = ft.color;
      ctx.font = `bold ${ft.size}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    drawHUD();
    drawBanner();

    if (state === "levelComplete") drawLevelComplete();
    if (state === "gameover") drawGameOver();
    if (state === "victory") drawVictory();
  }

  /* ---- Main Loop ---- */
  let rafId = 0;
  function loop() {
    update();
    draw();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  /* ---- Cleanup ---- */
  return () => {
    cancelAnimationFrame(rafId);
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("keydown", onKeyDown);
    (window as any).__candyBossMusic = false;
    AudioSys.destroy();
  };
}
