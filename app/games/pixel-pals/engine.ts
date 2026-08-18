/* =====================================================================
   PIXEL PALS: Quest for the Star — Game Engine
   Ported from the standalone index.html into a Next.js client module.
   All graphics are drawn procedurally on canvas; all audio is
   synthesized with the Web Audio API. No external assets.

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */

/* ================= 1. SETUP & CONSTANTS ================= */
const W = 960;
const H = 540;

// Physics tuning (pixels, seconds)
const GRAVITY = 2300; // px/s^2
const MAX_FALL = 1150; // terminal velocity
const MOVE_ACCEL = 2600; // ground acceleration
const AIR_ACCEL = 1700; // air acceleration
const FRICTION = 2400; // ground friction when no input
const AIR_DRAG = 300;
const MAX_SPEED = 330; // px/s
const JUMP_VEL = -760; // initial jump velocity
const JUMP_CUT = 0.45; // velocity multiplier when jump released early
const COYOTE_TIME = 0.09; // seconds of grace after leaving a ledge
const JUMP_BUFFER = 0.12; // seconds jump input is remembered
const ENEMY_SPEED = 70;
const KILL_BOUNCE = -420; // bounce when stomping an enemy
const PLAYER_W = 34;
const PLAYER_H = 42;
const LEVEL_TIME = 180; // seconds

// World / level geometry
const TILE = 40; // tile size in px
const LEVEL_COLS = 220; // level width in tiles
const ROWS = Math.ceil(H / TILE) + 1; // 15 rows; ground band = last 2 rows
const LEVEL_W = LEVEL_COLS * TILE;
const GROUND_Y = (ROWS - 2) * TILE; // top of the ground band = 520
const DEATH_Y = H + 200; // falling below this = lose a life

// Colors (original palette)
const C = {
  skyTop: "#6fc3e8",
  skyBot: "#bfe8f7",
  hillFar: "#8fd6a0",
  hillNear: "#5cb874",
  groundTop: "#67c26b",
  groundBody: "#a9744f",
  groundDark: "#8a5a3b",
  brick: "#d98a4a",
  brickDark: "#a85f2a",
  brickLight: "#f0b077",
  question: "#ffd23f",
  questionDark: "#c9971a",
  stone: "#9aa5b1",
  stoneDark: "#6b7684",
  coin: "#ffd23f",
  coinDark: "#c9971a",
  player: "#4fc3f7",
  playerDark: "#2a7fb5",
  playerBelly: "#d6f3ff",
  enemy: "#b06ab3",
  enemyDark: "#7d4480",
  boss: "#c792ea",
  bossDark: "#8e5bb5",
  star: "#ffe066",
  pipe: "#4caf7d",
  pipeDark: "#2e7d54",
  cloud: "rgba(255,255,255,0.9)",
};

/* ================= 2. AUDIO (Web Audio, synthesized) ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  },
  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
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
  noise(dur: number, vol = 0.4, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g);
    g.connect(this.master!);
    src.start(t);
  },
  jump() { this.tone("square", 320, 660, 0.18, 0.35); },
  coin() { this.tone("square", 988, 988, 0.07, 0.3); this.tone("square", 1319, 1319, 0.22, 0.3, 0.07); },
  stomp() { this.noise(0.12, 0.5); this.tone("triangle", 220, 90, 0.15, 0.4); },
  breakBlk() { this.noise(0.2, 0.55); this.tone("square", 180, 60, 0.2, 0.3); },
  hurt() { this.tone("sawtooth", 300, 110, 0.35, 0.4); },
  checkpoint() { this.tone("square", 523, 523, 0.1, 0.3); this.tone("square", 659, 659, 0.1, 0.3, 0.1); this.tone("square", 784, 784, 0.25, 0.3, 0.2); },
  powerup() { [523, 659, 784, 1047].forEach((f, i) => this.tone("square", f, f, 0.12, 0.3, i * 0.09)); },
  bossHit() { this.noise(0.15, 0.5); this.tone("square", 140, 70, 0.2, 0.4); },
  bossDie() { [784, 659, 523, 392, 262].forEach((f, i) => this.tone("square", f, f, 0.16, 0.35, i * 0.12)); this.noise(0.5, 0.5, 0.6); },
  gameover() { [392, 330, 262, 196].forEach((f, i) => this.tone("triangle", f, f, 0.3, 0.4, i * 0.25)); },
  victory() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone("square", f, f, 0.18, 0.32, i * 0.14)); },
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.35; },
};

/* ================= 3. INPUT ================= */
const Input = {
  left: false,
  right: false,
  jump: false,
  jumpPressedAt: -10,
  init(onStart: () => void) {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", " ", "a", "d", "w"].includes(k)) e.preventDefault();
      if (k === "arrowleft" || k === "a") this.left = true;
      if (k === "arrowright" || k === "d") this.right = true;
      if (k === "arrowup" || k === "w" || k === " ") {
        if (!this.jump) this.jumpPressedAt = game.time;
        this.jump = true;
      }
      if (k === "p") game.togglePause();
      if (k === "m") game.toggleMute();
      if (k === "enter") {
        if (game.state === "start" || game.state === "gameover" || game.state === "victory") onStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") this.left = false;
      if (k === "arrowright" || k === "d") this.right = false;
      if (k === "arrowup" || k === "w" || k === " ") this.jump = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    // Touch buttons (only shown on touch devices via CSS)
    const bind = (id: string, prop: "left" | "right" | "jump") => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e: Event) => {
        e.preventDefault();
        el.classList.add("pressed");
        if (prop === "jump" && !this.jump) this.jumpPressedAt = game.time;
        this[prop] = true;
      };
      const off = (e: Event) => {
        e.preventDefault();
        el.classList.remove("pressed");
        this[prop] = false;
      };
      el.addEventListener("touchstart", on, { passive: false });
      el.addEventListener("touchend", off, { passive: false });
      el.addEventListener("touchcancel", off, { passive: false });
      el.addEventListener("mousedown", on);
      el.addEventListener("mouseup", off);
      el.addEventListener("mouseleave", off);
    };
    bind("t-left", "left");
    bind("t-right", "right");
    bind("t-jump", "jump");

    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
      document.body.classList.add("touch");
    }
  },
  destroy() {
    // Keyboard listeners are removed by the window; touch buttons are
    // removed from the DOM by the overlay cleanup.
  },
};

/* ================= 4. LEVEL DATA =================
   Tile codes:
   0 = empty, 1 = ground, 2 = brick (breakable), 3 = question block (coin),
   4 = stone (solid, unbreakable), 5 = pipe top, 6 = pipe body */
interface Coin { x: number; y: number; taken: boolean; }
interface Enemy {
  type: "walker" | "hopper";
  x: number; y: number; w: number; h: number;
  vx: number; vy: number; alive: boolean; squashT: number;
  hopT?: number; dir?: number; onGround?: boolean;
}
interface MovingPlatform {
  x: number; y: number; w: number;
  x0: number; x1: number; y0: number; y1: number;
  dx: number; dy: number; speed: number; t: number;
  curDX: number; curDY: number;
}
interface Checkpoint { x: number; y: number; active: boolean; }
interface Boss {
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number; vx: number; vy: number;
  state: "walk" | "leap" | "fire"; stateT: number; facing: number;
  orbs: { x: number; y: number; vx: number; vy: number; r: number; life: number }[];
  alive: boolean; flashT: number; deadT: number; onGround?: boolean;
}

const Level = {
  grid: [] as number[][],
  rows: 0,
  coins: [] as Coin[],
  enemies: [] as Enemy[],
  movingPlatforms: [] as MovingPlatform[],
  checkpoints: [] as Checkpoint[],
  secret: null as null | { x: number; y: number; revealed: boolean; coins: Coin[] },
  boss: null as Boss | null,
  finish: null as { x: number; y: number; r: number; reached: boolean } | null,
  spawn: { x: 3 * TILE, y: GROUND_Y - PLAYER_H },

  build() {
    this.rows = ROWS;
    this.grid = Array.from({ length: this.rows }, () => new Array(LEVEL_COLS).fill(0));
    this.coins = []; this.enemies = []; this.movingPlatforms = [];
    this.checkpoints = []; this.secret = null; this.boss = null;

    const g = this.grid;
    const set = (c: number, r: number, v: number) => {
      if (c >= 0 && c < LEVEL_COLS && r >= 0 && r < this.rows) g[r][c] = v;
    };
    const ground = (c0: number, c1: number) => {
      for (let c = c0; c <= c1; c++) { set(c, this.rows - 2, 1); set(c, this.rows - 1, 1); }
    };
    const gap = (c0: number, c1: number) => {
      for (let c = c0; c <= c1; c++) { set(c, this.rows - 2, 0); set(c, this.rows - 1, 0); }
    };
    const platform = (c0: number, c1: number, r: number) => {
      for (let c = c0; c <= c1; c++) set(c, r, 4);
    };
    const brick = (c: number, r: number) => set(c, r, 2);
    const qblock = (c: number, r: number) => set(c, r, 3);
    const pipe = (c: number, h: number) => {
      const rTop = this.rows - 2 - h;
      set(c, rTop, 5); set(c + 1, rTop, 5);
      for (let r = rTop + 1; r < this.rows - 1; r++) { set(c, r, 6); set(c + 1, r, 6); }
    };
    const coinRow = (c0: number, c1: number, r: number) => {
      for (let c = c0; c <= c1; c++) this.coins.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, taken: false });
    };
    const coinArc = (cx: number, r: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        this.coins.push({ x: (cx - 2 + t * 4) * TILE + TILE / 2, y: (r - Math.sin(t * Math.PI) * 1.6) * TILE + TILE / 2, taken: false });
      }
    };
    const walker = (c: number, r: number, dir = 1) =>
      this.enemies.push({ type: "walker", x: c * TILE, y: r * TILE - 34, w: 34, h: 34, vx: ENEMY_SPEED * dir, vy: 0, alive: true, squashT: 0 });
    const hopper = (c: number, r: number) =>
      this.enemies.push({ type: "hopper", x: c * TILE, y: r * TILE - 36, w: 32, h: 36, vx: 0, vy: 0, alive: true, squashT: 0, hopT: 0, dir: 1 });
    const checkpoint = (c: number) => this.checkpoints.push({ x: c * TILE, y: GROUND_Y - 56, active: false });

    const R = this.rows;
    const gnd = R - 2;

    /* ---- SECTION 1: Gentle meadow (cols 0-35) ---- */
    ground(0, 35);
    qblock(8, gnd - 3);
    qblock(10, gnd - 3);
    brick(9, gnd - 3);
    coinRow(8, 10, gnd - 4);
    walker(16, gnd);
    pipe(22, 2);
    coinRow(20, 21, gnd - 4);
    walker(28, gnd);
    platform(31, 34, gnd - 3);
    coinRow(31, 34, gnd - 4);
    checkpoint(34);

    /* ---- SECTION 2: Pits & floating bricks (cols 36-70) ---- */
    ground(36, 44); gap(45, 47); ground(48, 56); gap(57, 59); ground(60, 70);
    platform(45, 47, gnd - 2);
    coinRow(45, 47, gnd - 3);
    platform(57, 59, gnd - 3);
    coinRow(57, 59, gnd - 4);
    brick(52, gnd - 3); qblock(53, gnd - 3); brick(54, gnd - 3);
    coinArc(53, gnd - 4, 5);
    walker(50, gnd); walker(63, gnd);
    hopper(66, gnd);
    platform(68, 70, gnd - 4);
    coinRow(68, 70, gnd - 5);
    checkpoint(69);

    /* ---- SECTION 3: Tower climb (cols 71-100) ---- */
    ground(71, 80); gap(81, 83); ground(84, 100);
    platform(81, 83, gnd - 3);
    platform(86, 87, gnd - 2);
    platform(89, 90, gnd - 4);
    platform(92, 93, gnd - 6);
    coinRow(86, 93, gnd - 7);
    qblock(90, gnd - 5);
    walker(88, gnd);
    this.movingPlatforms.push({ x: 95 * TILE, y: (gnd - 6) * TILE, w: 90, x0: 95 * TILE, x1: 100 * TILE, y0: 0, y1: 0, dx: 1, dy: 0, speed: 60, t: 0, curDX: 0, curDY: 0 });
    platform(101, 103, gnd - 6);
    coinRow(101, 103, gnd - 7);
    hopper(96, gnd);
    ground(101, 110);
    walker(106, gnd); walker(108, gnd);
    checkpoint(109);

    /* ---- SECTION 4: Stone corridor (cols 111-140) ---- */
    ground(111, 140);
    for (let c = 111; c <= 140; c++) { set(c, gnd - 8, 4); set(c, gnd - 9, 4); }
    for (let r = gnd - 7; r >= gnd - 2; r--) { set(118, r, 4); set(128, r, 4); set(136, r, 4); }
    brick(114, gnd - 3); qblock(115, gnd - 3);
    brick(123, gnd - 3); qblock(124, gnd - 3); brick(125, gnd - 3);
    coinRow(113, 116, gnd - 4);
    coinRow(122, 126, gnd - 4);
    walker(121, gnd); walker(131, gnd); hopper(133, gnd);
    set(130, gnd - 2, 2); set(130, gnd - 3, 2);
    this.secret = {
      x: 130 * TILE + TILE / 2, y: (gnd - 4) * TILE + TILE / 2, revealed: false,
      coins: Array.from({ length: 5 }, (_, i) => ({ x: (129 + i * 0.5) * TILE + TILE / 2, y: (gnd - 4) * TILE + TILE / 2, taken: false })),
    };
    this.movingPlatforms.push({ x: 138 * TILE, y: (gnd - 4) * TILE, w: 90, x0: 0, x1: 0, y0: (gnd - 4) * TILE, y1: (gnd - 7) * TILE, dx: 0, dy: 1, speed: 55, t: 0, curDX: 0, curDY: 0 });
    platform(141, 143, gnd - 7);
    coinRow(141, 143, gnd - 8);
    checkpoint(142);

    /* ---- SECTION 5: Gauntlet (cols 144-175) ---- */
    ground(144, 150); gap(151, 153); ground(154, 158); gap(159, 161); ground(162, 175);
    platform(151, 153, gnd - 2);
    platform(159, 161, gnd - 3);
    coinRow(151, 161, gnd - 4);
    walker(147, gnd); walker(156, gnd); walker(165, gnd); walker(168, gnd);
    hopper(171, gnd); hopper(173, gnd);
    gap(166, 169);
    this.movingPlatforms.push({ x: 166 * TILE, y: (gnd - 2) * TILE, w: 80, x0: 165 * TILE, x1: 170 * TILE, y0: 0, y1: 0, dx: 1, dy: 0, speed: 90, t: 0, curDX: 0, curDY: 0 });
    qblock(174, gnd - 3);
    checkpoint(174);

    /* ---- SECTION 6: Boss arena (cols 176-205) ---- */
    ground(176, 205);
    this.boss = {
      x: 192 * TILE, y: GROUND_Y - 96, w: 96, h: 96,
      hp: 5, maxHp: 5, vx: -120, vy: 0,
      state: "walk", stateT: 0, facing: -1,
      orbs: [], alive: true, flashT: 0, deadT: 0,
    };
    this.finish = { x: 203 * TILE, y: GROUND_Y - 70, r: 26, reached: false };
  },

  tileAt(col: number, row: number): number {
    if (col < 0 || col >= LEVEL_COLS) return 4;
    if (row < 0) return 0;
    if (row >= this.rows) return 0;
    return this.grid[row][col];
  },
  isSolid(col: number, row: number): boolean {
    const t = this.tileAt(col, row);
    return t === 1 || t === 2 || t === 3 || t === 4 || t === 5 || t === 6;
  },
  solidRect(x: number, y: number, w: number, h: number): boolean {
    const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 0.01) / TILE);
    const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 0.01) / TILE);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (this.isSolid(c, r)) return true;
    return false;
  },
};

/* ================= 5. ENTITIES ================= */
const Player = {
  x: 0, y: 0, vx: 0, vy: 0,
  onGround: false, facing: 1,
  coyote: 0, jumpBuf: 0,
  invuln: 0,
  dead: false, deadT: 0,
  animT: 0,
  reset() {
    const s = Level.spawn;
    this.x = s.x; this.y = s.y; this.vx = 0; this.vy = 0;
    this.onGround = false; this.facing = 1;
    this.coyote = 0; this.jumpBuf = 0; this.invuln = 0;
    this.dead = false; this.deadT = 0; this.animT = 0;
  },
  respawn() {
    let cp = Level.spawn;
    for (const c of Level.checkpoints) if (c.active) cp = { x: c.x, y: c.y };
    this.x = cp.x; this.y = cp.y; this.vx = 0; this.vy = 0;
    this.onGround = false; this.invuln = 2; this.dead = false; this.deadT = 0;
  },
  update(dt: number) {
    if (this.dead) {
      this.deadT += dt;
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      return;
    }
    this.animT += dt;
    if (this.invuln > 0) this.invuln -= dt;

    const accel = this.onGround ? MOVE_ACCEL : AIR_ACCEL;
    if (Input.left && !Input.right) {
      this.vx -= accel * dt;
      this.facing = -1;
    } else if (Input.right && !Input.left) {
      this.vx += accel * dt;
      this.facing = 1;
    } else {
      const fr = (this.onGround ? FRICTION : AIR_DRAG) * dt;
      if (Math.abs(this.vx) <= fr) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * fr;
    }
    this.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vx));

    if (Input.jump && game.time - Input.jumpPressedAt < JUMP_BUFFER) this.jumpBuf = JUMP_BUFFER;
    else if (!Input.jump) this.jumpBuf = 0;
    if (this.onGround) this.coyote = COYOTE_TIME;
    else this.coyote -= dt;

    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = JUMP_VEL;
      this.onGround = false;
      this.coyote = 0; this.jumpBuf = 0;
      AudioSys.jump();
      spawnDust(this.x + PLAYER_W / 2, this.y + PLAYER_H, 6);
    }
    if (!Input.jump && this.vy < 0) this.vy *= Math.pow(JUMP_CUT, dt * 30);

    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;

    let platDX = 0, platDY = 0;
    for (const p of Level.movingPlatforms) {
      if (this.onGround &&
        this.x + PLAYER_W > p.x + 2 && this.x < p.x + p.w - 2 &&
        Math.abs(this.y + PLAYER_H - p.y) < 6) {
        platDX = p.curDX; platDY = p.curDY;
      }
    }

    this.x += (this.vx + platDX) * dt;
    this.collideAxis(true);
    this.y += (this.vy + platDY) * dt;
    this.onGround = false;
    this.collideAxis(false);

    for (const p of Level.movingPlatforms) {
      if (this.vy >= 0 &&
        this.x + PLAYER_W > p.x + 2 && this.x < p.x + p.w - 2 &&
        this.y + PLAYER_H >= p.y && this.y + PLAYER_H <= p.y + 14 + Math.max(0, this.vy * dt)) {
        this.y = p.y - PLAYER_H;
        this.vy = 0;
        this.onGround = true;
        this.coyote = COYOTE_TIME;
      }
    }

    if (this.x < 0) { this.x = 0; this.vx = Math.max(0, this.vx); }
    if (this.x + PLAYER_W > LEVEL_W) { this.x = LEVEL_W - PLAYER_W; this.vx = Math.min(0, this.vx); }

    if (this.y > DEATH_Y) this.die();
  },
  collideAxis(horizontal: boolean) {
    const x = this.x, y = this.y;
    if (horizontal) {
      if (this.vx > 0 && Level.solidRect(this.x + PLAYER_W - 1, y + 2, 2, PLAYER_H - 4)) {
        this.x = Math.floor((this.x + PLAYER_W) / TILE) * TILE - PLAYER_W - 0.01;
        this.vx = 0;
      } else if (this.vx < 0 && Level.solidRect(x - 1, y + 2, 2, PLAYER_H - 4)) {
        this.x = (Math.floor(x / TILE) + 1) * TILE + 0.01;
        this.vx = 0;
      }
    } else {
      if (this.vy > 0 && Level.solidRect(x + 2, this.y + PLAYER_H - 1, PLAYER_W - 4, 2)) {
        this.y = Math.floor((this.y + PLAYER_H) / TILE) * TILE - PLAYER_H - 0.01;
        this.vy = 0;
        this.onGround = true;
        this.coyote = COYOTE_TIME;
      } else if (this.vy < 0 && Level.solidRect(x + 2, this.y - 1, PLAYER_W - 4, 2)) {
        this.y = (Math.floor(this.y / TILE) + 1) * TILE + 0.01;
        this.vy = 0;
        this.hitBlockFromBelow();
      }
    }
  },
  hitBlockFromBelow() {
    const c = Math.floor((this.x + PLAYER_W / 2) / TILE);
    const r = Math.floor((this.y - 4) / TILE);
    const t = Level.tileAt(c, r);
    if (t === 2) {
      Level.grid[r][c] = 0;
      AudioSys.breakBlk();
      spawnBrickBits(c * TILE + TILE / 2, r * TILE + TILE / 2);
      game.score += 20;
      if (Level.secret && !Level.secret.revealed) {
        const sc = Math.floor(Level.secret.x / TILE);
        if (Math.abs(c - sc) <= 1) {
          Level.secret.revealed = true;
          Level.coins.push(...Level.secret.coins);
          AudioSys.powerup();
          game.addMessage("Hidden coins found!", Level.secret.x, Level.secret.y - 40);
        }
      }
    } else if (t === 3) {
      Level.grid[r][c] = 4;
      AudioSys.coin();
      game.coins++; game.score += 100;
      spawnCoinPop(c * TILE + TILE / 2, r * TILE);
      game.addMessage("+100", c * TILE + TILE / 2, r * TILE - 10);
    }
  },
  die() {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.vy = -500;
    AudioSys.hurt();
    game.lives--;
    updateHUD();
    if (game.lives <= 0) {
      setTimeout(() => { if (this.dead) game.gameOver(); }, 1200);
    } else {
      setTimeout(() => { if (this.dead) this.respawn(); }, 1200);
    }
  },
  hurt() {
    if (this.invuln > 0 || this.dead) return;
    this.die();
  },
};

function updateEnemies(dt: number) {
  for (const e of Level.enemies) {
    if (!e.alive) { e.squashT += dt; continue; }
    e.vy += GRAVITY * dt;
    if (e.vy > MAX_FALL) e.vy = MAX_FALL;

    if (e.type === "hopper") {
      e.hopT! += dt;
      if (e.onGround && e.hopT! > 1.1) {
        e.vy = -520; e.vx = 130 * e.dir!; e.hopT = 0;
        AudioSys.tone("triangle", 200, 320, 0.1, 0.15);
      }
      if (e.onGround && e.hopT! < 0.3) e.vx *= 0.9;
    }

    e.x += e.vx * dt;
    if (Level.solidRect(e.x + (e.vx > 0 ? e.w : 0), e.y + 4, e.vx > 0 ? 2 : e.w, e.h - 8)) {
      e.x -= e.vx * dt;
      e.vx = -e.vx;
    }
    e.y += e.vy * dt;
    e.onGround = false;
    if (e.vy > 0 && Level.solidRect(e.x + 2, e.y + e.h - 1, e.w - 4, 2)) {
      e.y = Math.floor((e.y + e.h) / TILE) * TILE - e.h - 0.01;
      e.vy = 0; e.onGround = true;
    } else if (e.vy < 0 && Level.solidRect(e.x + 2, e.y - 1, e.w - 4, 2)) {
      e.y = (Math.floor(e.y / TILE) + 1) * TILE + 0.01;
      e.vy = 0;
    }
    if (e.type === "walker" && e.onGround) {
      const aheadX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
      if (!Level.solidRect(aheadX, e.y + e.h + 4, 2, 4)) e.vx = -e.vx;
    }
    if (e.y > DEATH_Y) { e.alive = false; continue; }

    const p = Player;
    if (!p.dead && rectsOverlap(p.x, p.y, PLAYER_W, PLAYER_H, e.x, e.y, e.w, e.h)) {
      const stomping = p.vy > 120 && p.y + PLAYER_H - e.y < 24;
      if (stomping) {
        e.alive = false; e.squashT = 0;
        p.vy = KILL_BOUNCE;
        game.score += 150;
        AudioSys.stomp();
        spawnDust(e.x + e.w / 2, e.y + e.h / 2, 8);
        game.addMessage("+150", e.x + e.w / 2, e.y - 10);
      } else {
        p.hurt();
      }
    }
  }
}

function updateBoss(dt: number) {
  const b = Level.boss;
  if (!b || !b.alive) return;
  if (b.flashT > 0) b.flashT -= dt;

  const arenaActive = Player.x > 176 * TILE - 200;
  if (!arenaActive) return;

  b.stateT += dt;
  const p = Player;

  if (b.state === "walk") {
    b.vx = b.facing * 120;
    if (b.stateT > 1.6) { b.state = "leap"; b.stateT = 0; b.vy = -620; }
  } else if (b.state === "leap") {
    if (b.onGround) {
      b.state = "fire"; b.stateT = 0;
      const dir = p.x < b.x ? -1 : 1;
      for (let i = 0; i < 3; i++) {
        b.orbs.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, vx: dir * (220 + i * 60), vy: -140 - i * 40, r: 10, life: 3 });
      }
      AudioSys.tone("sawtooth", 160, 90, 0.3, 0.35);
    }
  } else if (b.state === "fire") {
    b.vx = 0;
    if (b.stateT > 0.8) { b.state = "walk"; b.stateT = 0; b.facing = p.x < b.x ? -1 : 1; }
  }

  b.vy += GRAVITY * dt;
  if (b.vy > MAX_FALL) b.vy = MAX_FALL;
  b.x += b.vx * dt;
  if (b.x < 177 * TILE) { b.x = 177 * TILE; b.facing = 1; }
  if (b.x + b.w > 204 * TILE) { b.x = 204 * TILE - b.w; b.facing = -1; }
  b.y += b.vy * dt;
  b.onGround = false;
  if (b.vy > 0 && Level.solidRect(b.x + 4, b.y + b.h - 1, b.w - 8, 2)) {
    b.y = Math.floor((b.y + b.h) / TILE) * TILE - b.h - 0.01;
    b.vy = 0; b.onGround = true;
  }

  for (const o of b.orbs) {
    o.life -= dt;
    o.vy += 500 * dt;
    o.x += o.vx * dt; o.y += o.vy * dt;
    if (Level.solidRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2)) o.life = 0;
    if (!p.dead && o.life > 0 &&
      p.x < o.x + o.r && p.x + PLAYER_W > o.x - o.r &&
      p.y < o.y + o.r && p.y + PLAYER_H > o.y - o.r) {
      o.life = 0;
      p.hurt();
    }
  }
  b.orbs = b.orbs.filter((o) => o.life > 0);

  if (!p.dead && rectsOverlap(p.x, p.y, PLAYER_W, PLAYER_H, b.x, b.y, b.w, b.h)) {
    const stomping = p.vy > 120 && p.y + PLAYER_H - b.y < 30;
    if (stomping) {
      b.hp--; b.flashT = 0.25;
      p.vy = KILL_BOUNCE;
      game.score += 500;
      AudioSys.bossHit();
      spawnDust(b.x + b.w / 2, b.y, 12);
      game.addMessage("+500", b.x + b.w / 2, b.y - 16);
      if (b.hp <= 0) {
        b.alive = false; b.deadT = 0;
        AudioSys.bossDie();
        game.score += 2000;
        game.addMessage("GLOOM DEFEATED! +2000", b.x + b.w / 2, b.y - 30);
        spawnStarBurst(b.x + b.w / 2, b.y + b.h / 2);
      }
    } else {
      p.hurt();
    }
  }
  if (!b.alive) b.deadT += dt;
}

function updateMovingPlatforms(dt: number) {
  for (const p of Level.movingPlatforms) {
    const ox = p.x, oy = p.y;
    p.t += dt * p.speed;
    if (p.dx) {
      const range = p.x1 - p.x0;
      const cyc = p.t % (range * 2);
      const off = cyc < range ? cyc : range * 2 - cyc;
      p.x = p.x0 + off;
    }
    if (p.dy) {
      const range = p.y1 - p.y0;
      const cyc = p.t % (range * 2);
      const off = cyc < range ? cyc : range * 2 - cyc;
      p.y = p.y0 + off;
    }
    p.curDX = p.x - ox;
    p.curDY = p.y - oy;
  }
}

function updatePickups() {
  const p = Player;
  if (p.dead) return;
  for (const c of Level.coins) {
    if (c.taken) continue;
    if (Math.abs(p.x + PLAYER_W / 2 - c.x) < 26 && Math.abs(p.y + PLAYER_H / 2 - c.y) < 30) {
      c.taken = true;
      game.coins++; game.score += 50;
      AudioSys.coin();
      game.addMessage("+50", c.x, c.y - 14);
    }
  }
  for (const cp of Level.checkpoints) {
    if (!cp.active && p.x + PLAYER_W > cp.x && p.x < cp.x + TILE && p.y + PLAYER_H > cp.y) {
      cp.active = true;
      AudioSys.checkpoint();
      game.addMessage("CHECKPOINT!", cp.x + TILE / 2, cp.y - 20);
    }
  }
  const f = Level.finish;
  if (f && !f.reached && Level.boss!.alive === false) {
    if (Math.abs(p.x + PLAYER_W / 2 - f.x) < 40 && Math.abs(p.y + PLAYER_H / 2 - f.y) < 50) {
      f.reached = true;
      game.victory();
    }
  }
}

/* Particles & floating messages */
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  rot?: number; spin?: number; coin?: boolean;
}
const particles: Particle[] = [];
const messages: { text: string; x: number; y: number; t: number }[] = [];

function spawnDust(x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 120, life: 0.5, max: 0.5, size: 4, color: "#d8c9a3" });
}
function spawnBrickBits(x: number, y: number) {
  for (let i = 0; i < 6; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 300, vy: -Math.random() * 350 - 50, life: 0.9, max: 0.9, size: 7, color: C.brick, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 10 });
}
function spawnCoinPop(x: number, y: number) {
  particles.push({ x, y, vx: 0, vy: -260, life: 0.6, max: 0.6, size: 12, color: C.coin, coin: true });
}
function spawnStarBurst(x: number, y: number) {
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    particles.push({ x, y, vx: Math.cos(a) * (150 + Math.random() * 150), vy: Math.sin(a) * (150 + Math.random() * 150), life: 1.2, max: 1.2, size: 6, color: i % 2 ? C.star : "#fff" });
  }
}
function updateParticles(dt: number) {
  for (const p of particles) {
    p.life -= dt;
    p.vy += 900 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.rot !== undefined) p.rot += (p.spin || 0) * dt;
  }
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  for (const m of messages) { m.t += dt; m.y -= 30 * dt; }
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].t > 1.2) messages.splice(i, 1);
}

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/* ================= 6. GAME STATE & FLOW ================= */
type GameState = "start" | "playing" | "paused" | "gameover" | "victory";

const game = {
  state: "start" as GameState,
  time: 0,
  score: 0, coins: 0, lives: 3,
  timeLeft: LEVEL_TIME,
  camX: 0,

  startGame() {
    AudioSys.init(); AudioSys.resume();
    Level.build();
    Player.reset();
    particles.length = 0; messages.length = 0;
    this.score = 0; this.coins = 0; this.lives = 3;
    this.timeLeft = LEVEL_TIME;
    this.camX = 0;
    this.state = "playing";
    hideAllScreens();
    updateHUD();
  },
  togglePause() {
    if (this.state === "playing") { this.state = "paused"; show("screen-pause"); }
    else if (this.state === "paused") { this.state = "playing"; hide("screen-pause"); }
  },
  toggleMute() {
    AudioSys.init();
    AudioSys.setMuted(!AudioSys.muted);
    const btn = document.getElementById("mute-btn");
    if (btn) btn.innerHTML = AudioSys.muted ? "&#128263;" : "&#128266;";
  },
  gameOver() {
    this.state = "gameover";
    AudioSys.gameover();
    const el = document.getElementById("final-stats");
    if (el) el.innerHTML = `Score: ${this.score} &nbsp; Coins: ${this.coins}`;
    show("screen-gameover");
  },
  victory() {
    this.state = "victory";
    AudioSys.victory();
    const bonus = Math.floor(this.timeLeft) * 10;
    this.score += bonus;
    const el = document.getElementById("final-stats-v");
    if (el) el.innerHTML = `Score: ${this.score} (time bonus +${bonus}) &nbsp; Coins: ${this.coins} &nbsp; Lives left: ${this.lives}`;
    show("screen-victory");
  },
  addMessage(text: string, x: number, y: number) { messages.push({ text, x, y, t: 0 }); },
  update(dt: number) {
    if (this.state !== "playing") return;
    this.time += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      Player.hurt();
      if (this.lives > 0) this.timeLeft = 30;
    }
    updateMovingPlatforms(dt);
    Player.update(dt);
    updateEnemies(dt);
    updateBoss(dt);
    updatePickups();
    updateParticles(dt);

    const target = Player.x + PLAYER_W / 2 - W * 0.42;
    this.camX += (target - this.camX) * Math.min(1, dt * 8);
    this.camX = Math.max(0, Math.min(LEVEL_W - W, this.camX));

    updateHUD();
  },
};

function updateHUD() {
  const set = (id: string, v: string | number) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  set("hud-score", game.score);
  set("hud-coins", game.coins);
  set("hud-time", Math.ceil(game.timeLeft));
  const hearts = document.getElementById("hud-lives");
  if (hearts) hearts.innerHTML = '<span class="heart">&#9829;</span>'.repeat(Math.max(0, game.lives));
}

function show(id: string) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id: string) { document.getElementById(id)?.classList.add("hidden"); }
function hideAllScreens() {
  ["screen-start", "screen-pause", "screen-gameover", "screen-victory"].forEach(hide);
}

/* ================= 7. RENDERING ================= */
let ctx: CanvasRenderingContext2D;

function rnd(i: number) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, C.skyTop);
  grad.addColorStop(1, C.skyBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}
function drawClouds(camX: number) {
  ctx.fillStyle = C.cloud;
  for (let i = 0; i < 14; i++) {
    const cx = ((i * 420 + rnd(i) * 200) - camX * 0.3) % (LEVEL_W * 0.5);
    const x = ((cx % (W + 300)) + (W + 300)) % (W + 300) - 150;
    const y = 40 + rnd(i + 40) * 120;
    const s = 0.7 + rnd(i + 80) * 0.8;
    ctx.beginPath();
    ctx.ellipse(x, y, 46 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 30 * s, y - 10 * s, 30 * s, 15 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 30 * s, y - 6 * s, 26 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawHills(camX: number) {
  ctx.fillStyle = C.hillFar;
  for (let i = 0; i < 30; i++) {
    const x = i * 380 - (camX * 0.5) % 380 - 190;
    ctx.beginPath();
    ctx.arc(x, H - 60, 150 + rnd(i) * 60, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = C.hillNear;
  for (let i = 0; i < 24; i++) {
    const x = i * 460 - (camX * 0.7) % 460 - 230;
    ctx.beginPath();
    ctx.arc(x, H - 40, 110 + rnd(i + 3) * 50, Math.PI, 0);
    ctx.fill();
  }
}
function drawTile(t: number, x: number, y: number) {
  switch (t) {
    case 1:
      ctx.fillStyle = C.groundBody; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = C.groundTop; ctx.fillRect(x, y, TILE, 10);
      ctx.fillStyle = C.groundDark;
      ctx.fillRect(x + 6, y + 18, 8, 6); ctx.fillRect(x + 24, y + 26, 7, 5);
      break;
    case 2:
      ctx.fillStyle = C.brick; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = C.brickDark;
      ctx.fillRect(x, y + 18, TILE, 3); ctx.fillRect(x + 18, y, 3, 18);
      ctx.fillRect(x + 9, y + 21, 3, 19); ctx.fillRect(x + 27, y + 21, 3, 19);
      ctx.fillStyle = C.brickLight; ctx.fillRect(x, y, TILE, 3);
      break;
    case 3:
      ctx.fillStyle = C.question; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = C.questionDark; ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = C.question; ctx.fillRect(x + 5, y + 5, TILE - 10, TILE - 10);
      ctx.fillStyle = C.questionDark;
      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", x + TILE / 2, y + TILE / 2 + 1);
      break;
    case 4:
      ctx.fillStyle = C.stone; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = C.stoneDark;
      ctx.fillRect(x, y + TILE - 4, TILE, 4); ctx.fillRect(x + TILE - 4, y, 4, TILE);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x, y, TILE, 4); ctx.fillRect(x, y, 4, TILE);
      break;
    case 5:
      ctx.fillStyle = C.pipe; ctx.fillRect(x - 4, y, TILE + 8, TILE);
      ctx.fillStyle = C.pipeDark; ctx.fillRect(x - 4, y + TILE - 6, TILE + 8, 6);
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fillRect(x + 2, y + 4, 8, TILE - 10);
      break;
    case 6:
      ctx.fillStyle = C.pipe; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = C.pipeDark; ctx.fillRect(x + TILE - 8, y, 8, TILE);
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fillRect(x + 4, y, 8, TILE);
      break;
  }
}
function drawTiles() {
  const c0 = Math.max(0, Math.floor(game.camX / TILE) - 1);
  const c1 = Math.min(LEVEL_COLS - 1, c0 + Math.ceil(W / TILE) + 2);
  for (let r = 0; r < Level.rows; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = Level.grid[r][c];
      if (t) drawTile(t, c * TILE - game.camX, r * TILE);
    }
  }
}
function drawCoins() {
  const t = game.time;
  for (const c of Level.coins) {
    if (c.taken) continue;
    const x = c.x - game.camX;
    if (x < -30 || x > W + 30) continue;
    const wobble = Math.abs(Math.sin(t * 4 + c.x * 0.05));
    const rw = 8 * (0.35 + 0.65 * wobble);
    ctx.fillStyle = C.coinDark;
    ctx.beginPath(); ctx.ellipse(x, c.y, rw + 1.5, 10.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.coin;
    ctx.beginPath(); ctx.ellipse(x, c.y, rw, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.ellipse(x - rw * 0.3, c.y - 3, rw * 0.3, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  }
}
function drawCheckpoints() {
  for (const cp of Level.checkpoints) {
    const x = cp.x - game.camX;
    if (x < -60 || x > W + 60) continue;
    const y = cp.y;
    ctx.fillStyle = "#8d6e63";
    ctx.fillRect(x + 18, y, 5, 56);
    const wave = Math.sin(game.time * 5) * 3;
    ctx.fillStyle = cp.active ? "#ff5d73" : "#cfd8dc";
    ctx.beginPath();
    ctx.moveTo(x + 23, y + 2);
    ctx.lineTo(x + 52 + wave, y + 12);
    ctx.lineTo(x + 23, y + 24);
    ctx.closePath(); ctx.fill();
    if (cp.active) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      ctx.fillText("OK", x + 32, y + 16);
    }
  }
}
function drawMovingPlatforms() {
  for (const p of Level.movingPlatforms) {
    const x = p.x - game.camX;
    if (x + p.w < -20 || x > W + 20) continue;
    ctx.fillStyle = "#7986cb"; ctx.fillRect(x, p.y, p.w, 14);
    ctx.fillStyle = "#5c6bc0"; ctx.fillRect(x, p.y + 10, p.w, 4);
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(x, p.y, p.w, 3);
    ctx.fillStyle = "#3949ab";
    for (let i = 10; i < p.w - 6; i += 22) ctx.fillRect(x + i, p.y + 5, 4, 4);
  }
}
function drawEnemies() {
  for (const e of Level.enemies) {
    const x = e.x - game.camX;
    if (x + e.w < -20 || x > W + 20) continue;
    if (!e.alive) {
      if (e.squashT < 0.5) {
        ctx.fillStyle = e.type === "hopper" ? "#e57373" : C.enemyDark;
        ctx.fillRect(x, e.y + e.h - 8, e.w, 8);
      }
      continue;
    }
    const bob = Math.sin(game.time * 8 + e.x * 0.1) * 2;
    if (e.type === "walker") {
      ctx.fillStyle = C.enemy;
      ctx.beginPath(); ctx.ellipse(x + e.w / 2, e.y + e.h / 2 + bob, e.w / 2, e.h / 2 - 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.enemyDark;
      ctx.beginPath(); ctx.ellipse(x + e.w / 2, e.y + e.h - 6, e.w / 2 - 4, 6, 0, 0, Math.PI); ctx.fill();
      const ex = e.vx > 0 ? 4 : -4;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x + e.w / 2 - 7 + ex, e.y + 12 + bob, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + e.w / 2 + 7 + ex, e.y + 12 + bob, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#222";
      ctx.beginPath(); ctx.arc(x + e.w / 2 - 7 + ex + Math.sign(e.vx) * 2, e.y + 12 + bob, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + e.w / 2 + 7 + ex + Math.sign(e.vx) * 2, e.y + 12 + bob, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.enemyDark; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x + e.w / 2 - 12 + ex, e.y + 5 + bob); ctx.lineTo(x + e.w / 2 - 3 + ex, e.y + 8 + bob); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + e.w / 2 + 12 + ex, e.y + 5 + bob); ctx.lineTo(x + e.w / 2 + 3 + ex, e.y + 8 + bob); ctx.stroke();
    } else {
      ctx.fillStyle = "#e57373";
      ctx.beginPath(); ctx.ellipse(x + e.w / 2, e.y + e.h / 2 + bob, e.w / 2, e.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c62828";
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i / 4) * Math.PI;
        const sx = x + e.w / 2 + Math.cos(a) * e.w * 0.45;
        const sy = e.y + e.h / 2 + bob + Math.sin(a) * e.h * 0.45;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * 8, sy + Math.sin(a) * 8);
        ctx.lineTo(sx + Math.cos(a + 0.5) * 4, sy + Math.sin(a + 0.5) * 4);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x + e.w / 2 - 6, e.y + 14 + bob, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + e.w / 2 + 6, e.y + 14 + bob, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#222";
      ctx.beginPath(); ctx.arc(x + e.w / 2 - 6 + (e.dir || 1) * 1.5, e.y + 14 + bob, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + e.w / 2 + 6 + (e.dir || 1) * 1.5, e.y + 14 + bob, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function drawBoss() {
  const b = Level.boss;
  if (!b) return;
  const x = b.x - game.camX;
  if (x + b.w < -40 || x > W + 40) return;
  if (!b.alive) {
    if (b.deadT < 1.5) {
      ctx.globalAlpha = 1 - b.deadT / 1.5;
      ctx.fillStyle = C.bossDark;
      ctx.beginPath(); ctx.ellipse(x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    return;
  }
  const flash = b.flashT > 0 && Math.floor(b.flashT * 20) % 2 === 0;
  const bob = Math.sin(game.time * 4) * 4;
  ctx.fillStyle = flash ? "#fff" : C.boss;
  ctx.beginPath();
  ctx.ellipse(x + b.w / 2, b.y + b.h / 2 + bob, b.w / 2, b.h / 2 - 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + b.w * 0.25, b.y + b.h * 0.3 + bob, b.w * 0.28, 0, Math.PI * 2);
  ctx.arc(x + b.w * 0.75, b.y + b.h * 0.3 + bob, b.w * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = flash ? "#ddd" : C.bossDark;
  ctx.beginPath(); ctx.ellipse(x + b.w / 2, b.y + b.h - 14 + bob, b.w / 2 - 8, 12, 0, 0, Math.PI); ctx.fill();
  const ex = b.facing * 6;
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(x + b.w / 2 - 18 + ex, b.y + 34 + bob, 11, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + b.w / 2 + 18 + ex, b.y + 34 + bob, 11, 13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ff1744";
  ctx.beginPath(); ctx.arc(x + b.w / 2 - 18 + ex + b.facing * 3, b.y + 36 + bob, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + b.w / 2 + 18 + ex + b.facing * 3, b.y + 36 + bob, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.bossDark; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(x + b.w / 2 + ex, b.y + 74 + bob, 12, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  ctx.fillStyle = C.bossDark;
  ctx.beginPath(); ctx.moveTo(x + b.w * 0.2, b.y + 14 + bob); ctx.lineTo(x + b.w * 0.12, b.y - 8 + bob); ctx.lineTo(x + b.w * 0.32, b.y + 10 + bob); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + b.w * 0.8, b.y + 14 + bob); ctx.lineTo(x + b.w * 0.88, b.y - 8 + bob); ctx.lineTo(x + b.w * 0.68, b.y + 10 + bob); ctx.closePath(); ctx.fill();
  for (const o of b.orbs) {
    const ox = o.x - game.camX;
    ctx.fillStyle = "rgba(142,91,181,0.5)";
    ctx.beginPath(); ctx.arc(ox, o.y, o.r + 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.bossDark;
    ctx.beginPath(); ctx.arc(ox, o.y, o.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(ox - 3, o.y - 3, 3, 0, Math.PI * 2); ctx.fill();
  }
  const bw = 120, bx = x + b.w / 2 - bw / 2, by = b.y - 26;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(bx - 2, by - 2, bw + 4, 12);
  ctx.fillStyle = "#ff1744";
  ctx.fillRect(bx, by, bw * (b.hp / b.maxHp), 8);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
  ctx.fillText("GLOOM", x + b.w / 2, by - 6);
}
function drawPlayer() {
  const p = Player;
  if (p.dead && p.deadT > 1.2) return;
  const x = p.x - game.camX;
  const y = p.y;
  if (p.invuln > 0 && Math.floor(p.invuln * 15) % 2 === 0 && !p.dead) return;

  const runPhase = p.onGround && Math.abs(p.vx) > 30 ? Math.sin(p.animT * 16) : 0;
  const squash = p.onGround ? 1 : p.vy < 0 ? 1.08 : 0.94;
  const cx = x + PLAYER_W / 2;

  ctx.save();
  ctx.translate(cx, y + PLAYER_H);
  ctx.scale(1 / squash, squash);
  ctx.translate(-cx, -(y + PLAYER_H));

  ctx.fillStyle = C.playerDark;
  const footL = x + 5 + runPhase * 4;
  const footR = x + PLAYER_W - 15 - runPhase * 4;
  ctx.fillRect(footL, y + PLAYER_H - 7, 10, 7);
  ctx.fillRect(footR, y + PLAYER_H - 7, 10, 7);

  ctx.fillStyle = C.player;
  ctx.beginPath();
  ctx.ellipse(cx, y + PLAYER_H / 2 + 4, PLAYER_W / 2 - 2, PLAYER_H / 2 - 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.playerBelly;
  ctx.beginPath();
  ctx.ellipse(cx, y + PLAYER_H / 2 + 9, PLAYER_W / 2 - 9, PLAYER_H / 2 - 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#66bb6a";
  ctx.beginPath();
  ctx.ellipse(cx + p.facing * 2, y - 4, 5, 9, p.facing * 0.4, 0, Math.PI * 2);
  ctx.fill();

  const ex = p.facing * 5;
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(cx - 7 + ex, y + 14, 6, 7.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 7 + ex, y + 14, 6, 7.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1a237e";
  ctx.beginPath(); ctx.arc(cx - 7 + ex + p.facing * 2, y + 15, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 7 + ex + p.facing * 2, y + 15, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(cx - 8 + ex + p.facing * 2, y + 13, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 6 + ex + p.facing * 2, y + 13, 1.2, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = "#1a237e"; ctx.lineWidth = 2;
  ctx.beginPath();
  if (p.dead) ctx.arc(cx + ex, y + 28, 4, 0, Math.PI * 2);
  else ctx.arc(cx + ex, y + 25, 5, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,150,180,0.6)";
  ctx.beginPath(); ctx.ellipse(cx - 12 + ex, y + 21, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 12 + ex, y + 21, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}
function drawStar(cx: number, cy: number, spikes: number, outer: number, inner: number) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
}
function drawFinish() {
  const f = Level.finish;
  if (!f) return;
  const x = f.x - game.camX;
  if (x < -60 || x > W + 60) return;
  const t = game.time;
  const glow = 0.5 + 0.5 * Math.sin(t * 3);
  ctx.fillStyle = "#8d6e63";
  ctx.fillRect(x - 3, f.y, 6, 70);
  const sy = f.y - 14 + Math.sin(t * 2) * 5;
  ctx.save();
  ctx.translate(x, sy);
  ctx.rotate(t * 0.8);
  ctx.fillStyle = `rgba(255,224,102,${0.35 + glow * 0.3})`;
  drawStar(0, 0, 5, f.r + 6, f.r * 0.45 + 3);
  ctx.fillStyle = C.star;
  drawStar(0, 0, 5, f.r, f.r * 0.45);
  ctx.fillStyle = "#fff8e1";
  drawStar(0, 0, 5, f.r * 0.5, f.r * 0.24);
  ctx.restore();
}
function drawParticles() {
  for (const p of particles) {
    const a = p.life / p.max;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    const x = p.x - game.camX;
    if (p.coin) {
      ctx.beginPath(); ctx.ellipse(x, p.y, 8, 9, 0, 0, Math.PI * 2); ctx.fill();
    } else if (p.rot !== undefined) {
      ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(x, p.y, p.size * a + 1, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  for (const m of messages) {
    ctx.globalAlpha = 1 - m.t / 1.2;
    ctx.fillStyle = "#000";
    ctx.fillText(m.text, m.x - game.camX + 1, m.y + 1);
    ctx.fillStyle = "#ffd23f";
    ctx.fillText(m.text, m.x - game.camX, m.y);
  }
  ctx.globalAlpha = 1;
}
function render() {
  drawSky();
  drawClouds(game.camX);
  drawHills(game.camX);
  drawTiles();
  drawMovingPlatforms();
  drawCheckpoints();
  drawCoins();
  drawFinish();
  drawEnemies();
  drawBoss();
  drawPlayer();
  drawParticles();
}

/* ================= 8. OVERLAY UI (injected DOM) ================= */
const OVERLAY_CSS = `
.pp-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(10,10,30,0.82); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.pp-overlay.hidden { display:none; }
.pp-overlay h1 { font-size:clamp(28px,6vw,54px); letter-spacing:3px; color:#ffd23f; text-shadow:3px 3px 0 #b3541e,6px 6px 0 rgba(0,0,0,0.4); margin-bottom:10px; }
.pp-overlay h2 { font-size:clamp(20px,4vw,34px); margin-bottom:14px; text-shadow:2px 2px 0 #000; }
.pp-overlay p { font-size:clamp(13px,2.2vw,17px); line-height:1.7; margin-bottom:8px; color:#cfd8ff; }
.pp-overlay .big-btn { margin-top:22px; font-family:inherit; font-size:clamp(16px,3vw,22px); font-weight:bold; padding:12px 34px; background:linear-gradient(#ffd23f,#f5a623); color:#4a2c00; border:3px solid #fff; border-radius:12px; cursor:pointer; box-shadow:0 5px 0 #b3541e; letter-spacing:1px; }
.pp-overlay .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #b3541e; }
.pp-overlay .keys { margin-top:16px; font-size:13px; color:#9aa5d1; line-height:1.9; }
.pp-overlay .keys b { color:#ffd23f; }
.pp-hud { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:center; padding:8px 14px; pointer-events:none; z-index:5; font-family:'Courier New',monospace; }
.pp-hud-box { background:rgba(0,0,0,0.45); border:2px solid rgba(255,255,255,0.7); border-radius:8px; color:#fff; font-size:15px; font-weight:bold; padding:4px 12px; letter-spacing:1px; text-shadow:1px 1px 0 #000; display:flex; gap:14px; align-items:center; }
.pp-hud-box .coin-ico { display:inline-block; width:14px; height:14px; background:radial-gradient(circle at 35% 35%,#fff3a0,#ffd23f 60%,#d99a00); border-radius:50%; border:1px solid #8a6d00; vertical-align:-2px; }
.pp-hud-box .heart { color:#ff5d73; font-size:16px; }
.pp-mute-btn { pointer-events:auto; cursor:pointer; background:rgba(0,0,0,0.45); border:2px solid rgba(255,255,255,0.7); border-radius:8px; color:#fff; font-size:16px; width:40px; height:34px; }
.pp-touch { position:absolute; bottom:0; left:0; right:0; display:none; justify-content:space-between; align-items:flex-end; padding:14px 18px; z-index:8; pointer-events:none; }
body.touch .pp-touch { display:flex; }
.pp-tbtn { pointer-events:auto; width:74px; height:74px; border-radius:50%; background:rgba(255,255,255,0.16); border:3px solid rgba(255,255,255,0.55); color:#fff; font-size:30px; font-weight:bold; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; }
.pp-tbtn.pressed { background:rgba(255,255,255,0.42); }
.pp-tbtn.pp-jump { width:88px; height:88px; font-size:22px; }
.pp-tcluster { display:flex; gap:14px; }
`;

function buildOverlayUI(container: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "pp-hud";
  hud.innerHTML = `
    <div class="pp-hud-box">
      <span>SCORE <span id="hud-score">0</span></span>
      <span><span class="coin-ico"></span> <span id="hud-coins">0</span></span>
    </div>
    <div class="pp-hud-box">
      <span id="hud-lives"><span class="heart">&#9829;</span><span class="heart">&#9829;</span><span class="heart">&#9829;</span></span>
      <span>TIME <span id="hud-time">180</span></span>
    </div>
    <button id="mute-btn" title="Mute (M)">&#128266;</button>`;
  container.appendChild(hud);

  const mk = (id: string, inner: string, hidden = false) => {
    const el = document.createElement("div");
    el.className = "pp-overlay" + (hidden ? " hidden" : "");
    el.id = id;
    el.innerHTML = inner;
    container.appendChild(el);
    return el;
  };

  mk("screen-start", `
    <h1>PIXEL PALS</h1>
    <h2>Quest for the Star</h2>
    <p>Help <b style="color:#7ee081">Bloop</b> the little blue critter cross the meadow,<br>
       smash the grumps, grab every coin, and reach the Golden Star!</p>
    <p style="color:#ff9db0">Beware the boss <b style="color:#c792ea">Gloom</b> at the end of the path!</p>
    <button class="big-btn" id="btn-start">START GAME</button>
    <div class="keys">
      <b>&#8592;/&#8594; or A/D</b> move &nbsp; &middot; &nbsp; <b>Space / W / &#8593;</b> jump (hold = higher)<br>
      <b>P</b> pause &nbsp; &middot; &nbsp; <b>M</b> mute &nbsp; &middot; &nbsp; touch controls on mobile
    </div>`);

  mk("screen-pause", `
    <h2>PAUSED</h2>
    <p>Take a breath, Bloop is waiting.</p>
    <button class="big-btn" id="btn-resume">RESUME</button>
    <button class="big-btn" id="btn-restart-pause" style="background:linear-gradient(#9aa5d1,#5c6bc0);box-shadow:0 5px 0 #283593;color:#fff">RESTART LEVEL</button>`, true);

  mk("screen-gameover", `
    <h2 style="color:#ff5d73">GAME OVER</h2>
    <p>Bloop tumbled into the void...</p>
    <div id="final-stats" style="font-size:clamp(15px,2.6vw,20px);color:#ffd23f;margin:6px 0;"></div>
    <button class="big-btn" id="btn-retry">TRY AGAIN</button>`, true);

  mk("screen-victory", `
    <h1>YOU WIN!</h1>
    <p>Bloop claimed the Golden Star! The meadow is safe again.</p>
    <div id="final-stats-v" style="font-size:clamp(15px,2.6vw,20px);color:#ffd23f;margin:6px 0;"></div>
    <button class="big-btn" id="btn-play-again">PLAY AGAIN</button>`, true);

  const touch = document.createElement("div");
  touch.className = "pp-touch";
  touch.innerHTML = `
    <div class="pp-tcluster">
      <div class="pp-tbtn" id="t-left">&#9664;</div>
      <div class="pp-tbtn" id="t-right">&#9654;</div>
    </div>
    <div class="pp-tbtn pp-jump" id="t-jump">JUMP</div>`;
  container.appendChild(touch);

  // Wire buttons
  const on = (id: string, fn: () => void) => {
    const el = document.getElementById(id);
    el?.addEventListener("click", fn);
  };
  on("btn-start", () => game.startGame());
  on("btn-resume", () => game.togglePause());
  on("btn-restart-pause", () => game.startGame());
  on("btn-retry", () => game.startGame());
  on("btn-play-again", () => game.startGame());
  on("mute-btn", () => game.toggleMute());
}

/* ================= 9. MAIN LOOP & PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  ctx = canvas.getContext("2d")!;

  // Wrap the canvas in a positioned container for overlay UI
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;";
  canvas.parentNode?.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  buildOverlayUI(wrap);

  // Fit canvas to window while keeping aspect ratio
  const resize = () => {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
  };
  resize();
  window.addEventListener("resize", resize);

  Input.init(() => game.startGame());
  Level.build();
  Player.reset();

  let raf = 0;
  let lastTime = 0;
  const loop = (ts: number) => {
    const dt = Math.min(0.033, (ts - lastTime) / 1000 || 0.016);
    lastTime = ts;
    game.update(dt);
    render();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // Cleanup: stop the loop, remove listeners and injected DOM
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    wrap.remove();
    document.body.classList.remove("touch");
  };
}