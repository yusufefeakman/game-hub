/* =====================================================================
   DOPING RUNNER — Game Engine
   An endless runner where you sprint through a neon city, collect
   doping boosters (nitro capsules) to accelerate, and dodge obstacles.
   All graphics procedural on canvas; all audio synthesized with the
   Web Audio API. No external assets. Mobile friendly (tap / buttons).

   Controls:
     Space / ArrowUp / W / Tap  — jump (double jump allowed)
     Down / S                   — fast-fall / slide
     P pause · M mute · Enter start

   Public API:
     startGame(canvas) -> () => void
   ===================================================================== */

/* ================= 1. CONSTANTS ================= */
const W = 960;
const H = 540;
const GROUND_Y = 452;

const GRAVITY = 2600;
const JUMP_VEL = -830;
const DOUBLE_JUMP_VEL = -720;
const FAST_FALL = 1400;

const RUNNER_X = 190; // fixed screen x of the runner
const RUNNER_W = 44;
const RUNNER_H = 70;

const BASE_SPEED = 330;
const MAX_SPEED = 900;
const DOPING_DURATION = 5; // seconds of nitro speed after collecting
const DOPING_MULT = 1.7;

/* ================= 2. AUDIO ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
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
    osc.connect(g); g.connect(this.master!);
    osc.start(t); osc.stop(t + dur + 0.02);
  },
  noise(dur: number, vol = 0.3, delay = 0) {
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
    src.connect(g); g.connect(this.master!);
    src.start(t);
  },
  jump() { this.tone("sine", 350, 650, 0.14, 0.3); },
  dJump() { this.tone("sine", 450, 800, 0.12, 0.3); },
  doping() { [660, 880, 1320].forEach((f, i) => this.tone("square", f, f, 0.09, 0.32, i * 0.06)); },
  hit() { this.tone("sawtooth", 300, 90, 0.3, 0.4); this.noise(0.2, 0.4); },
  slide() { this.noise(0.15, 0.2); },
  score() { this.tone("sine", 1200, 1400, 0.05, 0.12); },
  gameover() { [392, 330, 262, 196, 131].forEach((f, i) => this.tone("triangle", f, f, 0.28, 0.35, i * 0.22)); },
  record() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone("square", f, f, 0.15, 0.3, i * 0.12)); },
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.28; },
};

/* ================= 3. INPUT ================= */
const Input = {
  jumpPressed: false,
  jumpHeld: false,
  downHeld: false,
  init(onStart: () => void) {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "arrowdown", "w", "s"].includes(k)) e.preventDefault();
      if (k === " " || k === "arrowup" || k === "w") {
        if (!this.jumpHeld) this.jumpPressed = true;
        this.jumpHeld = true;
        if (game.state === "start" || game.state === "gameover" || game.state === "victory") onStart();
      }
      if (k === "arrowdown" || k === "s") this.downHeld = true;
      if (k === "p") game.togglePause();
      if (k === "m") game.toggleMute();
      if (k === "enter") {
        if (game.state === "start" || game.state === "gameover" || game.state === "victory") onStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " " || k === "arrowup" || k === "w") this.jumpHeld = false;
      if (k === "arrowdown" || k === "s") this.downHeld = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    // touch buttons
    const bind = (id: string, onDown: () => void, onUp?: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e: Event) => { e.preventDefault(); onDown(); };
      const end = (e: Event) => { e.preventDefault(); onUp?.(); };
      el.addEventListener("touchstart", start, { passive: false });
      el.addEventListener("mousedown", start);
      if (onUp) {
        el.addEventListener("touchend", end, { passive: false });
        el.addEventListener("mouseup", end);
      }
    };
    bind("t-jump", () => { Input.jumpPressed = true; });
    bind("t-slide", () => { Input.downHeld = true; }, () => { Input.downHeld = false; });

    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
      document.body.classList.add("touch");
    }
  },
  destroy() {},
};

/* ================= 4. STATE ================= */
type GameState = "start" | "playing" | "paused" | "gameover" | "victory";

interface Obstacle { x: number; y: number; w: number; h: number; type: "block" | "spike" | "fly"; passed: boolean; }
interface Pickup { x: number; y: number; taken: boolean; t: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; }

const game = {
  state: "start" as GameState,
  time: 0,
  distance: 0,
  score: 0,
  speed: BASE_SPEED,
  dopingT: 0,
  best: 0,
  runner: { y: GROUND_Y, vy: 0, onGround: true, jumps: 0, animT: 0, sliding: false },

  obstacles: [] as Obstacle[],
  pickups: [] as Pickup[],
  particles: [] as Particle[],

  startGame() {
    AudioSys.init(); AudioSys.resume();
    this.time = 0;
    this.distance = 0;
    this.score = 0;
    this.speed = BASE_SPEED;
    this.dopingT = 0;
    this.runner = { y: GROUND_Y, vy: 0, onGround: true, jumps: 0, animT: 0, sliding: false };
    this.obstacles = [];
    this.pickups = [];
    this.particles = [];
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
  die() {
    this.state = "gameover";
    AudioSys.gameover();
    const isRecord = this.score > this.best && this.best > 0;
    if (this.score > this.best) { this.best = this.score; try { localStorage.setItem("doping-best", String(this.best)); } catch { /* */ } }
    const el = document.getElementById("final-stats");
    if (el) {
      el.innerHTML = `Skor: <b>${this.score}</b> &nbsp;·&nbsp; Mesafe: <b>${Math.floor(this.distance / 10)}m</b>${this.score >= this.best && this.best > 0 ? " &nbsp;🏆" : ""}`;
    }
    if (isRecord) AudioSys.record();
    show("screen-gameover");
  },
  update(dt: number) {
    if (this.state !== "playing") return;
    this.time += dt;
    const r = this.runner;

    // speed ramp + doping boost
    this.speed = Math.min(MAX_SPEED, BASE_SPEED + this.distance * 0.004);
    if (this.dopingT > 0) {
      this.dopingT -= dt;
      this.speed *= DOPING_MULT;
    }
    this.distance += this.speed * dt;
    this.score += this.speed * dt * 0.02;

    // ---- runner physics ----
    r.animT += dt;
    if (!r.onGround) {
      r.vy += GRAVITY * dt;
      if (Input.downHeld) r.vy += FAST_FALL * dt;
      r.y += r.vy * dt;
      if (r.y >= GROUND_Y) { r.y = GROUND_Y; r.vy = 0; r.onGround = true; r.jumps = 0; }
    }
    if (Input.jumpPressed) {
      if (r.onGround) {
        r.vy = JUMP_VEL;
        r.onGround = false;
        r.jumps = 1;
        AudioSys.jump();
        spawnRunDust(8);
      } else if (r.jumps < 2) {
        r.vy = DOUBLE_JUMP_VEL;
        r.jumps = 2;
        AudioSys.dJump();
        spawnRing(RUNNER_X + RUNNER_W / 2, r.y + RUNNER_H / 2);
      }
    }
    // sliding = ducked hitbox
    r.sliding = !r.onGround ? false : Input.downHeld;
    Input.jumpPressed = false;

    // ---- spawn ----
    if (this.obstacles.length === 0 || this.obstacles[this.obstacles.length - 1].x < W - (300 + Math.random() * 420)) {
      this.spawnPattern();
    }
    if (this.pickups.length === 0 || this.pickups[this.pickups.length - 1].x < W - (200 + Math.random() * 500)) {
      this.spawnPickup();
    }

    // ---- move ----
    for (const o of this.obstacles) o.x -= this.speed * dt;
    for (const p of this.pickups) { p.x -= this.speed * dt; p.t += dt; }
    this.obstacles = this.obstacles.filter((o) => o.x > -120);
    this.pickups = this.pickups.filter((p) => p.x > -80);

    // ---- collisions ----
    const runnerBox = {
      x: RUNNER_X + 6,
      y: r.sliding ? r.y + RUNNER_H - 30 : r.y,
      w: RUNNER_W - 12,
      h: r.sliding ? 30 : RUNNER_H,
    };
    for (const o of this.obstacles) {
      if (!o.passed && o.x + o.w < RUNNER_X) { o.passed = true; this.score += 25; AudioSys.score(); }
      if (o.type === "fly") {
        // fly obstacles hang lower; runner must slide or the block hits only when on ground+upright
        const flyBox = { x: o.x, y: o.y, w: o.w, h: 26 };
        if (this.hit(runnerBox, flyBox)) { this.die(); return; }
      } else {
        const oBox = { x: o.x, y: o.y, w: o.w, h: o.h };
        if (this.hit(runnerBox, oBox)) { this.die(); return; }
      }
    }
    for (const p of this.pickups) {
      if (p.taken) continue;
      const px = p.x - 16, py = p.y - 16;
      if (this.hit({ x: runnerBox.x, y: runnerBox.y, w: runnerBox.w, h: runnerBox.h }, { x: px, y: py, w: 32, h: 32 })) {
        p.taken = true;
        this.dopingT = DOPING_DURATION;
        this.score += 150;
        AudioSys.doping();
        addMsg("DOPING! ⚡", RUNNER_X + RUNNER_W / 2, r.y - 40, "#7ee081");
        this.boostFlash = 0.4;
        spawnBurst(p.x, p.y, 14, "#7ee081");
      }
    }

    // ---- particles & messages ----
    this.updateParticles(dt);
    if (this.boostFlash > 0) this.boostFlash -= dt;
    if (this.dopingT > 0 && Math.random() < 0.5) {
      this.particles.push({ x: RUNNER_X + RUNNER_W / 2 - Math.random() * 20, y: r.y + RUNNER_H - 10, vx: -this.speed * 0.4 - Math.random() * 120, vy: -30 - Math.random() * 80, life: 0.5, max: 0.5, size: 4, color: "#7ee081" });
    }

    updateHUD();
  },
  boostFlash: 0,
  hit(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  },
  spawnPattern() {
    const t = Math.random();
    const gap = 360 + Math.random() * 160;
    if (t < 0.35) {
      // ground block (jump over)
      const h = 46 + Math.random() * 40;
      this.obstacles.push({ x: W + 20, y: GROUND_Y - h, w: 40 + Math.random() * 24, h, type: "block", passed: false });
    } else if (t < 0.6) {
      // spike wall
      const h = 60 + Math.random() * 50;
      this.obstacles.push({ x: W + 20, y: GROUND_Y - h, w: 30, h, type: "spike", passed: false });
    } else if (t < 0.82) {
      // flying drone (slide under or jump over) at head height
      const h = 34;
      this.obstacles.push({ x: W + 20, y: GROUND_Y - 150, w: 46, h, type: "fly", passed: false });
      // low barrier right before so you can't just run
      this.obstacles.push({ x: W + 20 + 260, y: GROUND_Y - 42, w: 34, h: 42, type: "block", passed: false });
      void gap;
    } else {
      // double stack (jump twice)
      this.obstacles.push({ x: W + 20, y: GROUND_Y - 44, w: 36, h: 44, type: "block", passed: false });
      this.obstacles.push({ x: W + 20 + 170, y: GROUND_Y - 56, w: 40, h: 56, type: "block", passed: false });
      void gap;
    }
  },
  spawnPickup() {
    // arcs of capsules at jump height
    const cx = W + 60;
    const y = GROUND_Y - 130 - Math.random() * 60;
    for (let i = 0; i < 3; i++) {
      this.pickups.push({ x: cx + i * 70, y, taken: false, t: Math.random() * 6 });
    }
  },
  updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 600 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const m of msgs) { m.t += dt; m.y -= 40 * dt; }
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].t > 1.1) msgs.splice(i, 1);
  },
};

const msgs: { text: string; x: number; y: number; t: number; color: string }[] = [];
function addMsg(text: string, x: number, y: number, color: string) { msgs.push({ text, x, y, t: 0, color }); }
function spawnRunDust(n: number) {
  for (let i = 0; i < n; i++) {
    game.particles.push({ x: RUNNER_X + Math.random() * RUNNER_W, y: GROUND_Y - 2, vx: -80 - Math.random() * 140, vy: -20 - Math.random() * 60, life: 0.4, max: 0.4, size: 3 + Math.random() * 3, color: "#9aa5c0" });
  }
}
function spawnRing(x: number, y: number) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    game.particles.push({ x, y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, life: 0.35, max: 0.35, size: 3, color: "#ffd23f" });
  }
}
function spawnBurst(x: number, y: number, n: number, color: string) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 150 + Math.random() * 280;
    game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.6, max: 0.6, size: 3 + Math.random() * 3, color });
  }
}

/* ================= 5. HUD ================= */
function updateHUD() {
  const set = (id: string, v: string | number) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  set("hud-score", Math.floor(game.score));
  set("hud-dist", Math.floor(game.distance / 10));
  set("hud-best", game.best);
  const bar = document.getElementById("hud-boost");
  if (bar) {
    const pct = Math.max(0, Math.min(1, game.dopingT / DOPING_DURATION));
    bar.style.width = (pct * 100) + "%";
    bar.style.opacity = pct > 0 ? "1" : "0";
  }
}

/* ================= 6. RENDER ================= */
let ctx: CanvasRenderingContext2D;

function drawBg() {
  // night city gradient
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0b1030");
  g.addColorStop(0.55, "#232a5e");
  g.addColorStop(1, "#10142e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // moon
  const mg = ctx.createRadialGradient(W - 150, 90, 6, W - 150, 90, 70);
  mg.addColorStop(0, "rgba(255,250,220,0.95)");
  mg.addColorStop(1, "rgba(255,250,220,0)");
  ctx.fillStyle = mg;
  ctx.fillRect(W - 250, 0, 220, 200);

  // stars
  for (let i = 0; i < 70; i++) {
    const sx = (i * 173 + 37) % W;
    const sy = (i * 97 + 11) % 220;
    ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(game.time * 2 + i));
    ctx.fillStyle = "#fff";
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;

  // parallax skyline
  const off = (game.distance * 0.15) % 120;
  ctx.fillStyle = "#141a45";
  for (let x = -off; x < W + 130; x += 120) {
    const h = 60 + ((x * 7) % 90);
    ctx.fillRect(x, GROUND_Y - h, 70, h + 40);
  }
  ctx.fillStyle = "#1c2457";
  const off2 = (game.distance * 0.35) % 80;
  for (let x = -off2; x < W + 100; x += 80) {
    const h = 30 + ((x * 13) % 60);
    ctx.fillRect(x, GROUND_Y - h, 46, h + 30);
    // lit windows
    ctx.fillStyle = "#ffd23f";
    for (let wy = GROUND_Y - h + 8; wy < GROUND_Y - 8; wy += 14) {
      if (Math.floor(wy + x) % 3 === 0) ctx.fillRect(x + 10 + (wy % 20), wy, 4, 6);
    }
    ctx.fillStyle = "#1c2457";
  }

  // ground
  const gg = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  gg.addColorStop(0, "#2a2f55");
  gg.addColorStop(1, "#191d3a");
  ctx.fillStyle = gg;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  // moving lane lines
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 4;
  const laneOff = (game.distance * 1) % 60;
  ctx.beginPath();
  for (let x = -laneOff; x < W; x += 60) {
    ctx.moveTo(x, GROUND_Y + 40);
    ctx.lineTo(x + 26, GROUND_Y + 40);
  }
  ctx.stroke();
}

function drawObstacles() {
  for (const o of game.obstacles) {
    if (o.x > W + 100 || o.x < -100) continue;
    if (o.type === "spike") {
      ctx.fillStyle = "#ff5d73";
      const n = Math.max(2, Math.floor(o.w / 10));
      ctx.beginPath();
      ctx.moveTo(o.x, o.y + o.h);
      for (let i = 0; i <= n; i++) {
        const x = o.x + (i / n) * o.w;
        const y = i % 2 === 0 ? o.y : o.y + o.h;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#c62839";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (o.type === "fly") {
      // drone
      ctx.save();
      ctx.translate(o.x + o.w / 2, o.y + 12);
      ctx.fillStyle = "#c792ea";
      ctx.beginPath();
      ctx.ellipse(0, 0, o.w / 2, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4dd0e1";
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sx * o.w * 0.55, -2, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // block crate
      const grad = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      grad.addColorStop(0, "#8d6e63");
      grad.addColorStop(1, "#5d4037");
      ctx.fillStyle = grad;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "#3e2723";
      ctx.lineWidth = 3;
      ctx.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(o.x + 4, o.y + 4); ctx.lineTo(o.x + o.w - 4, o.y + o.h - 4);
      ctx.moveTo(o.x + o.w - 4, o.y + 4); ctx.lineTo(o.x + 4, o.y + o.h - 4);
      ctx.stroke();
    }
  }
}

function drawPickups() {
  for (const p of game.pickups) {
    if (p.taken || p.x > W + 40 || p.x < -40) continue;
    const bob = Math.sin(p.t * 4) * 4;
    const y = p.y + bob;
    const wob = Math.abs(Math.sin(p.t * 3));
    ctx.save();
    ctx.translate(p.x, y);
    // capsule glow
    ctx.shadowColor = "#7ee081";
    ctx.shadowBlur = 14 + wob * 8;
    // capsule body
    ctx.fillStyle = "#3fbf5f";
    ctx.beginPath();
    ctx.roundRect(-13, -9, 26, 18, 9);
    ctx.fill();
    ctx.fillStyle = "#7ee081";
    ctx.beginPath();
    ctx.roundRect(-9, -9, 18, 18, 9);
    ctx.fill();
    // liquid + shine
    ctx.fillStyle = "#eaffea";
    ctx.fillRect(-6, 2, 12, 5);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-9, -7, 3, 14);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawRunner() {
  const r = game.runner;
  const x = RUNNER_X;
  const y = r.y;
  const boost = game.dopingT > 0;

  // boost aura
  if (boost) {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 20);
    ctx.strokeStyle = `rgba(126,224,129,${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(x + RUNNER_W / 2, y + RUNNER_H / 2, RUNNER_W * 0.75 + pulse * 4, RUNNER_H * 0.7 + pulse * 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const squash = r.sliding ? 0.6 : r.onGround ? 1 : 0.92;
  ctx.save();
  ctx.translate(x + RUNNER_W / 2, y + RUNNER_H);
  ctx.scale(1, squash);
  ctx.translate(-(x + RUNNER_W / 2), -(y + RUNNER_H));

  const cx = x + RUNNER_W / 2;
  const legPhase = r.onGround && !r.sliding ? Math.sin(r.animT * 14) * 8 : 0;

  // legs
  ctx.fillStyle = "#2b3a67";
  ctx.fillRect(cx - 13 + legPhase, y + RUNNER_H - 18, 11, 18);
  ctx.fillRect(cx + 2 - legPhase, y + RUNNER_H - 18, 11, 18);
  // shoes
  ctx.fillStyle = "#ff8c1a";
  ctx.fillRect(cx - 15 + legPhase, y + RUNNER_H - 7, 14, 7);
  ctx.fillRect(cx + 1 - legPhase, y + RUNNER_H - 7, 14, 7);

  // body (jacket)
  const bodyGrad = ctx.createLinearGradient(cx - RUNNER_W / 2, y, cx + RUNNER_W / 2, y + RUNNER_H);
  bodyGrad.addColorStop(0, boost ? "#7ee081" : "#ff5d73");
  bodyGrad.addColorStop(1, boost ? "#2f9e44" : "#c62839");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.roundRect(cx - RUNNER_W / 2 + 3, y + 20, RUNNER_W - 6, RUNNER_H - 36, 8);
  ctx.fill();
  // stripe
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(cx - RUNNER_W / 2 + 3, y + 34, RUNNER_W - 6, 6);

  // arms swinging
  ctx.strokeStyle = "#2b3a67";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  const armSwing = r.onGround ? Math.sin(r.animT * 14) * 12 : -14;
  ctx.beginPath();
  ctx.moveTo(cx - RUNNER_W / 2 + 7, y + 30);
  ctx.lineTo(cx - RUNNER_W / 2 + 3 + armSwing, y + 42);
  ctx.moveTo(cx + RUNNER_W / 2 - 7, y + 30);
  ctx.lineTo(cx + RUNNER_W / 2 - 3 - armSwing, y + 42);
  ctx.stroke();

  // head
  const hy = r.sliding ? y + RUNNER_H - 34 : y;
  ctx.fillStyle = "#ffd9b3";
  ctx.beginPath();
  ctx.arc(cx, hy + 8, 15, 0, Math.PI * 2);
  ctx.fill();
  // hair
  ctx.fillStyle = "#263238";
  ctx.beginPath();
  ctx.arc(cx, hy + 4, 15.5, Math.PI * 0.95, Math.PI * 2.05);
  ctx.fill();
  // bandana
  ctx.fillStyle = boost ? "#7ee081" : "#ff8c1a";
  ctx.fillRect(cx - 16, hy + 2, 32, 5);
  ctx.beginPath();
  ctx.moveTo(cx + 15, hy + 3);
  ctx.lineTo(cx + 30, hy - 2 + Math.sin(r.animT * 10) * 3);
  ctx.lineTo(cx + 26, hy + 8);
  ctx.closePath();
  ctx.fill();
  // eye
  ctx.fillStyle = "#1a1a2e";
  ctx.beginPath();
  ctx.arc(cx + 5, hy + 9, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of game.particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.font = "bold 20px monospace";
  for (const m of msgs) {
    const a = 1 - m.t / 1.1;
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    ctx.strokeText(m.text, m.x, m.y);
    ctx.fillStyle = m.color;
    ctx.fillText(m.text, m.x, m.y);
  }
  ctx.globalAlpha = 1;
}

function drawHUDCanvas() {
  if (game.state === "start") return;
  // speed line effect at high speed / doping
  if (game.speed > 600 || game.dopingT > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const ly = (i * 70 + game.time * 300) % (H + 40) - 20;
      ctx.beginPath();
      ctx.moveTo(W - ((game.time * game.speed * 0.5) % 200), ly);
      ctx.lineTo(W - 40 - ((game.time * game.speed * 0.5) % 200), ly);
      ctx.stroke();
    }
  }
  // doping vignette
  if (game.boostFlash > 0) {
    ctx.strokeStyle = `rgba(126,224,129,${game.boostFlash})`;
    ctx.lineWidth = 26;
    ctx.strokeRect(0, 0, W, H);
  }
}

function render() {
  drawBg();
  drawObstacles();
  drawPickups();
  drawRunner();
  drawParticles();
  drawHUDCanvas();
}

/* ================= 7. OVERLAY UI ================= */
const OVERLAY_CSS = `
.dr-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(8,10,30,0.88); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.dr-overlay.hidden { display:none; }
.dr-overlay h1 { font-size:clamp(32px,7.5vw,62px); letter-spacing:3px; color:#7ee081; text-shadow:0 0 20px rgba(126,224,129,0.7),3px 3px 0 #0a5a2a; margin-bottom:6px; }
.dr-overlay h2 { font-size:clamp(20px,4.5vw,34px); color:#ffd23f; margin-bottom:14px; }
.dr-overlay p { font-size:clamp(13px,2.4vw,17px); line-height:1.8; color:#c3d4ff; margin-bottom:6px; }
.dr-overlay .big-btn { margin-top:18px; font-family:inherit; font-size:clamp(16px,3.4vw,24px); font-weight:bold; padding:13px 38px; background:linear-gradient(#7ee081,#2f9e44); color:#05250e; border:3px solid #fff; border-radius:14px; cursor:pointer; box-shadow:0 5px 0 #0a5a2a; letter-spacing:2px; }
.dr-overlay .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #0a5a2a; }
.dr-overlay .keys { margin-top:16px; font-size:12px; color:#8ea0d8; line-height:2.1; }
.dr-overlay .keys b { color:#7ee081; }
.dr-hud { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:flex-start; padding:10px 14px; pointer-events:none; z-index:5; font-family:'Courier New',monospace; }
.dr-hud-box { background:rgba(0,0,0,0.5); border:2px solid rgba(126,224,129,0.5); border-radius:10px; color:#fff; font-size:15px; font-weight:bold; padding:6px 12px; letter-spacing:1px; display:flex; gap:14px; align-items:center; }
.dr-hud-box .lbl { color:#8ea0d8; font-size:12px; }
.dr-mute { pointer-events:auto; cursor:pointer; background:rgba(0,0,0,0.5); border:2px solid rgba(126,224,129,0.5); border-radius:10px; color:#fff; font-size:16px; width:42px; height:36px; }
.dr-boostwrap { position:absolute; top:58px; left:50%; transform:translateX(-50%); width:min(420px,60%); height:12px; background:rgba(0,0,0,0.5); border:2px solid rgba(126,224,129,0.5); border-radius:8px; overflow:hidden; }
.dr-boost { height:100%; background:linear-gradient(90deg,#2f9e44,#7ee081); width:0%; opacity:0; transition:opacity .2s; }
.dr-toast { position:absolute; top:80px; left:50%; transform:translateX(-50%); background:rgba(8,10,30,0.92); border:2px solid #7ee081; color:#7ee081; font-family:'Courier New',monospace; font-weight:bold; padding:8px 18px; border-radius:10px; opacity:0; transition:opacity .2s; pointer-events:none; z-index:7; }
.dr-toast.show { opacity:1; }
.dr-touch { position:absolute; bottom:0; left:0; right:0; display:none; justify-content:space-between; align-items:flex-end; padding:16px 20px; z-index:8; pointer-events:none; }
body.touch .dr-touch { display:flex; }
.dr-tbtn { pointer-events:auto; width:84px; height:84px; border-radius:50%; background:rgba(255,255,255,0.14); border:3px solid rgba(255,255,255,0.55); color:#fff; font-size:32px; font-weight:bold; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; }
.dr-tbtn:active { background:rgba(255,255,255,0.4); }
.dr-tbtn.small { width:68px; height:68px; font-size:16px; border-radius:12px; }
`;

function buildOverlayUI(container: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "dr-hud";
  hud.innerHTML = `
    <div class="dr-hud-box">
      <span><span class="lbl">SKOR</span> <span id="hud-score">0</span></span>
      <span><span class="lbl">MESAFE</span> <span id="hud-dist">0</span>m</span>
    </div>
    <button id="mute-btn" class="dr-mute" title="Mute (M)">&#128266;</button>
    <div class="dr-hud-box">
      <span><span class="lbl">REKOR</span> <span id="hud-best">0</span></span>
    </div>`;
  container.appendChild(hud);

  const boostWrap = document.createElement("div");
  boostWrap.className = "dr-boostwrap";
  boostWrap.innerHTML = `<div class="dr-boost" id="hud-boost"></div>`;
  container.appendChild(boostWrap);

  const mk = (id: string, inner: string, hidden = false) => {
    const el = document.createElement("div");
    el.className = "dr-overlay" + (hidden ? " hidden" : "");
    el.id = id;
    el.innerHTML = inner;
    container.appendChild(el);
    return el;
  };

  mk("screen-start", `
    <h1>DOPING RUNNER</h1>
    <h2>Sonsuz Koşu ⚡</h2>
    <p>Neon şehirde koş, <b style="color:#7ee081">doping kapsüllerini</b> topla,<br>süper hıza ulaş ve engellerden kaç!</p>
    <button class="big-btn" id="btn-start">KOŞMAYA BAŞLA</button>
    <div class="keys">
      <b>Space / &#8593;</b> zıpla (çift zıplama var) &nbsp;·&nbsp; <b>&#8595;</b> hızlı iniş<br>
      <b>P</b> duraklat &nbsp;·&nbsp; <b>M</b> sessiz &nbsp;·&nbsp; mobilde butonlar
    </div>`);

  mk("screen-pause", `
    <h2>DURAKLATILDI</h2>
    <button class="big-btn" id="btn-resume">DEVAM ET</button>`, true);

  mk("screen-gameover", `
    <h2 style="color:#ff5d73">YAKALANDIN!</h2>
    <p style="color:#ffd23f;font-size:clamp(16px,3vw,24px)" id="final-stats"></p>
    <button class="big-btn" id="btn-retry">TEKRAR KOŞ</button>`, true);

  const touch = document.createElement("div");
  touch.className = "dr-touch";
  touch.innerHTML = `
    <div class="dr-tbtn" id="t-slide">&#9660;</div>
    <div class="dr-tbtn" id="t-jump">&#9650;</div>`;
  container.appendChild(touch);

  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  on("btn-start", () => game.startGame());
  on("btn-resume", () => game.togglePause());
  on("btn-retry", () => game.startGame());
  on("mute-btn", () => game.toggleMute());
}

function show(id: string) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id: string) { document.getElementById(id)?.classList.add("hidden"); }
function hideAllScreens() {
  ["screen-start", "screen-pause", "screen-gameover"].forEach(hide);
}

/* ================= 8. MAIN LOOP & PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  ctx = canvas.getContext("2d")!;

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;";
  canvas.parentNode?.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  buildOverlayUI(wrap);

  const resize = () => {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
  };
  resize();
  window.addEventListener("resize", resize);

  Input.init(() => game.startGame());
  try {
    const b = localStorage.getItem("doping-best");
    if (b) game.best = Number(b) || 0;
  } catch { /* */ }
  updateHUD();

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

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    wrap.remove();
    document.body.classList.remove("touch");
  };
}
