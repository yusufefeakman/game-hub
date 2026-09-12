/* =====================================================================
   CANDY BURST: Eşleştirme Macerası — Match-3 Game Engine
   Progressive difficulty from easy to ultra hard. Boss every 10 levels.
   All graphics procedural on canvas; all audio via Web Audio API.
   ===================================================================== */

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

  startMusic() {
    if (!this.ctx || this.muted || this.musicInterval) return;
    this.resume();
    const melody = [262,330,392,523,392,330,294,349, 262,330,392,523,392,330,294,349, 349,440,523,698,523,440,392,440, 330,392,440,523,440,392,349,330];
    this.musicNoteIndex = 0;
    this.musicInterval = setInterval(() => {
      if (!this.ctx || this.muted) return;
      const f = melody[this.musicNoteIndex % melody.length];
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
      this.musicNoteIndex++;
    }, 260);
  },
  stopMusic() { if (this.musicInterval) { clearInterval(this.musicInterval); this.musicInterval = null; } },
  destroy() { this.stopMusic(); if (this.ctx) { this.ctx.close(); this.ctx = null; } },
};

/* ---- Types ---- */
interface Candy {
  color: number;
  x: number; y: number;
  targetX: number; targetY: number;
  clearing: boolean;
  clearTimer: number;
  scale: number;
}
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
}
interface BossState {
  hp: number; maxHp: number;
  x: number; y: number;
  flashTimer: number; alive: boolean; deathTimer: number;
}
type GameState = "menu" | "playing" | "swapping" | "clearing" | "falling" | "levelComplete" | "gameover" | "victory";

/* ================= MAIN ENGINE ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d")!;
  canvas.width = W;
  canvas.height = H;

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
  let particles: Particle[] = [];
  let boss: BossState | null = null;
  let isBossLevel = false;
  let animTime = 0;
  let shakeTimer = 0;
  let shakeIntensity = 0;
  let currentConfig: LevelConfig = getLevelConfig(1);
  let floatTexts: { x: number; y: number; text: string; color: string; life: number }[] = [];

  /* ---- Input ---- */
  let mouseDown = false;
  let mouseX = 0, mouseY = 0;

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
    mouseDown = true;
    mouseX = px; mouseY = py;
    const cell = cellAt(px, py);
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
    mouseDown = false;
    if (state !== "playing" || !selected) return;
    const sx = GRID_OFFSET_X + selected.c * CELL_SIZE + CELL_SIZE / 2;
    const sy = GRID_OFFSET_Y + selected.r * CELL_SIZE + CELL_SIZE / 2;
    const dx = px - sx;
    const dy = py - sy;
    if (Math.abs(dx) > CELL_SIZE * 0.6 || Math.abs(dy) > CELL_SIZE * 0.6) {
      let target: { r: number; c: number };
      if (Math.abs(dx) > Math.abs(dy)) target = { r: selected.r, c: selected.c + (dx > 0 ? 1 : -1) };
      else target = { r: selected.r + (dy > 0 ? 1 : -1), c: selected.c };
      if (target.r >= 0 && target.r < GRID_SIZE && target.c >= 0 && target.c < GRID_SIZE) {
        trySwap(selected, target);
      }
    }
  }

  function onMouseDown(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    onPointerDown((e.clientX - rect.left) * (W / rect.width), (e.clientY - rect.top) * (H / rect.height));
  }
  function onMouseUp(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    onPointerUp((e.clientX - rect.left) * (W / rect.width), (e.clientY - rect.top) * (H / rect.height));
  }
  function onMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) * (W / rect.width);
    mouseY = (e.clientY - rect.top) * (H / rect.height);
  }
  function onTouchStart(e: TouchEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    onPointerDown((t.clientX - rect.left) * (W / rect.width), (t.clientY - rect.top) * (H / rect.height));
  }
  function onTouchEnd(e: TouchEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.changedTouches[0];
    onPointerUp((t.clientX - rect.left) * (W / rect.width), (t.clientY - rect.top) * (H / rect.height));
  }
  function onKeyDown(e: KeyboardEvent) {
    if (state === "menu" && (e.code === "Space" || e.code === "Enter")) startGamePlay();
    if ((state === "gameover" || state === "victory") && (e.code === "Space" || e.code === "Enter")) resetGame();
  }

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  /* ---- Grid Logic ---- */
  function createCandy(r: number, c: number, color: number, yOffset = 0): Candy {
    return {
      color,
      x: GRID_OFFSET_X + c * CELL_SIZE + CELL_SIZE / 2,
      y: GRID_OFFSET_Y + r * CELL_SIZE + CELL_SIZE / 2 + yOffset,
      targetX: GRID_OFFSET_X + c * CELL_SIZE + CELL_SIZE / 2,
      targetY: GRID_OFFSET_Y + r * CELL_SIZE + CELL_SIZE / 2,
      clearing: false,
      clearTimer: 0,
      scale: 1,
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

  function findMatches(): { r: number; c: number }[] {
    const matched = new Set<string>();
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE - 2; c++) {
        const a = grid[r][c];
        if (!a) continue;
        const b = grid[r][c + 1];
        const d = grid[r][c + 2];
        if (b && d && a.color === b.color && b.color === d.color) {
          matched.add(`${r},${c}`); matched.add(`${r},${c + 1}`); matched.add(`${r},${c + 2}`);
          let ext = c + 3;
          while (ext < GRID_SIZE) {
            const e = grid[r][ext];
            if (e && e.color === a.color) { matched.add(`${r},${ext}`); ext++; } else break;
          }
        }
      }
    }
    for (let c = 0; c < GRID_SIZE; c++) {
      for (let r = 0; r < GRID_SIZE - 2; r++) {
        const a = grid[r][c];
        if (!a) continue;
        const b = grid[r + 1][c];
        const d = grid[r + 2][c];
        if (b && d && a.color === b.color && b.color === d.color) {
          matched.add(`${r},${c}`); matched.add(`${r + 1},${c}`); matched.add(`${r + 2},${c}`);
          let ext = r + 3;
          while (ext < GRID_SIZE) {
            const e = grid[ext][c];
            if (e && e.color === a.color) { matched.add(`${ext},${c}`); ext++; } else break;
          }
        }
      }
    }
    return [...matched].map(s => { const [r, c] = s.split(",").map(Number); return { r, c }; });
  }

  function trySwap(a: { r: number; c: number }, b: { r: number; c: number }) {
    if (state !== "playing") return;
    const candyA = grid[a.r][a.c];
    const candyB = grid[b.r][b.c];
    if (!candyA || !candyB) return;

    grid[a.r][a.c] = candyB;
    grid[b.r][b.c] = candyA;

    if (findMatches().length === 0) {
      grid[a.r][a.c] = candyA;
      grid[b.r][b.c] = candyB;
      AudioSys.invalid();
      selected = null;
      return;
    }

    AudioSys.swap();
    state = "swapping";
    swapFrom = a; swapTo = b; swapProgress = 0;
    movesLeft--;
    combo = 0;
    selected = null;

    candyA.targetX = GRID_OFFSET_X + b.c * CELL_SIZE + CELL_SIZE / 2;
    candyA.targetY = GRID_OFFSET_Y + b.r * CELL_SIZE + CELL_SIZE / 2;
    candyB.targetX = GRID_OFFSET_X + a.c * CELL_SIZE + CELL_SIZE / 2;
    candyB.targetY = GRID_OFFSET_Y + a.r * CELL_SIZE + CELL_SIZE / 2;
  }

  function clearMatches(matches: { r: number; c: number }[]) {
    if (matches.length === 0) return;
    combo++;
    const points = matches.length * SCORE_PER_CANDY + (combo > 1 ? combo * COMBO_BONUS : 0);
    score += points;
    totalScore += points;

    if (boss && boss.alive) {
      boss.hp = Math.max(0, boss.hp - matches.length);
      boss.flashTimer = 10;
      if (boss.hp <= 0) {
        boss.alive = false;
        boss.deathTimer = 60;
        AudioSys.bossDefeat();
        score += 1000;
        totalScore += 1000;
        spawnBurst(boss.x, boss.y, 30, "#ff4444");
        spawnBurst(boss.x, boss.y, 20, "#ffd700");
        shakeTimer = 20;
        shakeIntensity = 12;
      } else {
        AudioSys.bossHit();
      }
    }

    AudioSys.match();
    if (combo > 1) AudioSys.cascade();

    const cx = matches.reduce((s, m) => s + m.c, 0) / matches.length;
    const cy = matches.reduce((s, m) => s + m.r, 0) / matches.length;
    floatTexts.push({
      x: GRID_OFFSET_X + cx * CELL_SIZE + CELL_SIZE / 2,
      y: GRID_OFFSET_Y + cy * CELL_SIZE,
      text: `+${points}`,
      color: combo > 1 ? "#ffd700" : "#fff",
      life: 40,
    });

    for (const m of matches) {
      const c = grid[m.r][m.c];
      if (c) {
        c.clearing = true;
        c.clearTimer = CLEAR_DURATION / 16;
        const col = COLORS[c.color].base;
        spawnBurst(GRID_OFFSET_X + m.c * CELL_SIZE + CELL_SIZE / 2, GRID_OFFSET_Y + m.r * CELL_SIZE + CELL_SIZE / 2, 6, col);
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
            const has = findMatches().length > 0;
            grid[r][c] = a; grid[r][c + 1] = b;
            if (has) return true;
          }
        }
        if (r < GRID_SIZE - 1) {
          const a = grid[r][c], b = grid[r + 1][c];
          if (a && b) {
            grid[r][c] = b; grid[r + 1][c] = a;
            const has = findMatches().length > 0;
            grid[r][c] = a; grid[r + 1][c] = b;
            if (has) return true;
          }
        }
      }
    }
    return false;
  }

  function reshuffleGrid() {
    const allColors: number[] = [];
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++)
        if (grid[r][c]) allColors.push(grid[r][c]!.color);
    for (let i = allColors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allColors[i], allColors[j]] = [allColors[j], allColors[i]];
    }
    let idx = 0;
    for (let r = 0; r < GRID_SIZE; r++)
      for (let c = 0; c < GRID_SIZE; c++)
        if (grid[r][c]) grid[r][c]!.color = allColors[idx++];
  }

  function spawnBurst(x: number, y: number, count: number, color: string) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 4;
      particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 2, life: 20 + Math.random() * 20, maxLife: 40, size: 2 + Math.random() * 4, color });
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

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
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
            const matches = findMatches();
            if (matches.length > 0) clearMatches(matches);
            else { state = "playing"; swapFrom = null; swapTo = null; }
          }
        } else { state = "playing"; swapFrom = null; swapTo = null; }
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
              candy.y += Math.sign(dy) * Math.min(Math.abs(dy), FALL_SPEED);
              allSettled = false;
            } else { candy.y = candy.targetY; candy.scale = 1; }
          }
        }
      }
      if (allSettled) {
        const matches = findMatches();
        if (matches.length > 0) { clearMatches(matches); }
        else {
          combo = 0;
          if (!checkLevelComplete()) {
            if (movesLeft <= 0) {
              if (isBossLevel) {
                if (boss && !boss.alive) { state = "levelComplete"; stateTimer = 120; AudioSys.levelup(); }
                else { state = "gameover"; AudioSys.stopMusic(); AudioSys.lose(); }
              } else {
                if (score < targetScore) { state = "gameover"; AudioSys.stopMusic(); AudioSys.lose(); }
                else { state = "levelComplete"; stateTimer = 120; AudioSys.levelup(); }
              }
            } else if (!hasValidMoves()) {
              reshuffleGrid();
              if (!hasValidMoves()) initGrid(currentConfig.numColors);
            }
            state = "playing";
          }
        }
      }
    } else if (state === "levelComplete") {
      stateTimer--;
      if (stateTimer <= 0) {
        if (level >= 30) { state = "victory"; AudioSys.stopMusic(); AudioSys.levelup(); }
        else startLevel(level + 1);
      }
    }
  }

  /* ---- Drawing ---- */
  function drawCandy(candy: Candy) {
    if (!candy) return;
    const x = candy.x;
    const y = candy.y;
    const size = CELL_SIZE * 0.4 * candy.scale;
    if (size <= 0) return;

    const col = COLORS[candy.color];
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(2, size * 0.3, size * 0.9, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(-size * 0.2, -size * 0.2, size * 0.1, 0, 0, size);
    grad.addColorStop(0, col.light);
    grad.addColorStop(0.7, col.base);
    grad.addColorStop(1, col.dark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.ellipse(-size * 0.25, -size * 0.3, size * 0.3, size * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBoss(b: BossState) {
    if (!b.alive && b.deathTimer <= 0) return;
    ctx.save();
    ctx.translate(b.x, b.y);

    const pulse = 1 + Math.sin(animTime * 0.08) * 0.04;
    const flash = b.flashTimer > 0 && b.flashTimer % 4 < 2;
    ctx.scale(pulse, pulse);

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
    ctx.beginPath();
    ctx.moveTo(-25, -25); ctx.lineTo(-40, -55); ctx.lineTo(-15, -30); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(25, -25); ctx.lineTo(40, -55); ctx.lineTo(15, -30); ctx.fill();

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

    ctx.fillStyle = "rgba(255,255,255,0.3)";
    for (let i = 0; i < 50; i++) {
      const x = (i * 173.7) % W;
      const y = (i * 97.3) % (H * 0.6);
      const size = (i % 3) + 1;
      ctx.fillRect(x, y, size, size);
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
    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 20;
    ctx.fillText("CANDY BURST", 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.font = "24px Arial";
    ctx.fillStyle = "#69dbff";
    ctx.fillText("Eşleştirme Macerası", W / 2, H / 2 - 40);

    // Candy preview
    const previewColors = [0, 1, 2, 3, 4];
    for (let i = 0; i < previewColors.length; i++) {
      const px = W / 2 - 120 + i * 60;
      const py = H / 2 + 20 + Math.sin(animTime * 0.05 + i) * 8;
      const col = COLORS[previewColors[i]];
      const grad = ctx.createRadialGradient(px - 8, py - 8, 4, px, py, 20);
      grad.addColorStop(0, col.light);
      grad.addColorStop(1, col.dark);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.font = "18px Arial";
    ctx.fillStyle = "#ccc";
    ctx.fillText("Boncukları eşleştir, zincirleme patlamalar yap!", W / 2, H / 2 + 80);
    ctx.fillText("Her 10 bölümde BOSS seni bekliyor!", W / 2, H / 2 + 110);

    const alpha = 0.5 + Math.sin(animTime * 0.06) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = "bold 26px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText("Tıkla veya SPACE ile Başla", W / 2, H / 2 + 170);
    ctx.globalAlpha = 1;

    ctx.font = "14px Arial";
    ctx.fillStyle = "#888";
    ctx.fillText("Kolay → Ultra | 30 Bölüm | Boss'lar dahil", W / 2, H - 40);

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
    const alpha = 0.5 + Math.sin(animTime * 0.06) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = "bold 22px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.fillText("Tıkla veya SPACE ile Tekrar Oyna", W / 2, H / 2 + 70);
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
    ctx.fillText(`Toplam Skor: ${totalScore}`, W / 2, H / 2 + 30);
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

    // Grid background
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
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Float texts
    for (const ft of floatTexts) {
      ctx.globalAlpha = ft.life / 40;
      ctx.fillStyle = ft.color;
      ctx.font = "bold 20px Arial";
      ctx.textAlign = "center";
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    drawHUD();

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
    canvas.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("keydown", onKeyDown);
    AudioSys.destroy();
  };
}
