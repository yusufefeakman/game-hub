/* =====================================================================
   LET'S WORLD: Platform Macerası — Game Engine
   A Super Mario-style platformer with levels, bosses every 10 levels,
   chiptune music, and synthesized sound effects. All graphics drawn
   procedurally on canvas. No external assets.

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */

/* ================= 1. SETUP & CONSTANTS ================= */
const W = 900;
const H = 600;

const GRAVITY = 0.65;
const JUMP_FORCE = -14.5;
const MOVE_SPEED = 6;
const ACCEL = 1.0;
const FRICTION = 0.88;
const MAX_FALL = 16;

const START_LIVES = 3;

/* ================= 2. AUDIO (Web Audio, synthesized) ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  musicGain: null as GainNode | null,
  musicOsc: null as OscillatorNode | null,
  musicLFO: null as OscillatorNode | null,
  musicGainNode: null as GainNode | null,
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
      this.musicGain.gain.value = 0.12;
      this.musicGain.connect(this.ctx.destination);
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

  jump() { this.tone("square", 200, 600, 0.12, 0.3); },
  coin() { this.tone("square", 987, 987, 0.06, 0.3); this.tone("square", 1319, 1319, 0.14, 0.3, 0.06); },
  stomp() { this.tone("triangle", 400, 100, 0.12, 0.35); },
  hurt() { this.tone("sawtooth", 280, 80, 0.4, 0.45); },
  gameover() {
    this.tone("sawtooth", 300, 200, 0.3, 0.4);
    this.tone("sawtooth", 250, 150, 0.3, 0.4, 0.3);
    this.tone("sawtooth", 200, 80, 0.5, 0.5, 0.6);
  },
  levelup() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone("square", f, f, 0.12, 0.3, i * 0.1));
  },
  bossHit() { this.tone("square", 600, 200, 0.15, 0.4); this.tone("sawtooth", 150, 80, 0.2, 0.3, 0.05); },
  bossDefeat() {
    [440, 554, 659, 880, 1108].forEach((f, i) => this.tone("square", f, f, 0.15, 0.35, i * 0.1));
    this.tone("sawtooth", 80, 40, 0.8, 0.4, 0.6);
  },
  break() { this.tone("sawtooth", 200, 60, 0.15, 0.3); },

  startMusic() {
    if (!this.ctx || this.muted || this.musicInterval) return;
    this.resume();
    const notes = [
      262, 330, 392, 523, 392, 330, 294, 349,
      262, 330, 392, 523, 392, 330, 294, 349,
      349, 440, 523, 698, 523, 440, 392, 440,
      349, 440, 523, 698, 523, 440, 392, 349,
    ];
    this.musicNoteIndex = 0;
    this.musicInterval = setInterval(() => {
      if (!this.ctx || this.muted) return;
      const f = notes[this.musicNoteIndex % notes.length];
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g);
      g.connect(this.musicGain!);
      osc.start(t);
      osc.stop(t + 0.2);
      this.musicNoteIndex++;
    }, 220);
  },

  stopMusic() {
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  },

  destroy() {
    this.stopMusic();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  },
};

/* ================= 3. TYPES ================= */
interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
  type: "ground" | "normal" | "moving" | "breakable";
  origX: number;
  origY: number;
  moveRange: number;
  moveSpeed: number;
  hp: number;
  breakTimer: number;
}

interface Coin {
  x: number;
  y: number;
  r: number;
  collected: boolean;
  bobOffset: number;
}

interface Enemy {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  platform: Platform;
  type: "walker" | "spiky";
  alive: boolean;
  frame: number;
}

interface Boss {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  timer: number;
  jumpTimer: number;
  alive: boolean;
  frame: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface GameState {
  running: boolean;
  level: number;
  coins: number;
  lives: number;
  score: number;
  cameraX: number;
  isBossLevel: boolean;
  shakeTimer: number;
  shakeIntensity: number;
  time: number;
  state: "menu" | "playing" | "levelComplete" | "gameover" | "win";
  stateTimer: number;
}

interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  onGround: boolean;
  facing: number;
  jumping: boolean;
  invincible: number;
  runFrame: number;
  runTimer: number;
  isRunning: boolean;
  leanAngle: number;
}

/* ================= 4. GAME ENGINE ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d")!;
  canvas.width = W;
  canvas.height = H;

  // --- State ---
  const game: GameState = {
    running: false,
    level: 1,
    coins: 0,
    lives: START_LIVES,
    score: 0,
    cameraX: 0,
    isBossLevel: false,
    shakeTimer: 0,
    shakeIntensity: 0,
    time: 0,
    state: "menu",
    stateTimer: 0,
  };

  let player: PlayerState = {
    x: 80, y: 400, vx: 0, vy: 0,
    w: 32, h: 46,
    onGround: false, facing: 1, jumping: false,
    invincible: 0, runFrame: 0, runTimer: 0, isRunning: false, leanAngle: 0,
  };

  let platforms: Platform[] = [];
  let coins: Coin[] = [];
  let enemies: Enemy[] = [];
  let boss: Boss | null = null;
  let particles: Particle[] = [];
  let levelWidth = 2400;
  let goalFlag: { x: number; y: number; w: number; h: number } | null = null;

  // --- Input ---
  const keys: Record<string, boolean> = {};
  let mouseDown = false;
  let touchStartX = 0;
  let touchStartY = 0;

  function onKeyDown(e: KeyboardEvent) {
    keys[e.code] = true;
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown") e.preventDefault();
    if (game.state === "menu" && (e.code === "Space" || e.code === "Enter")) {
      startGamePlay();
    }
    if (game.state === "gameover" && (e.code === "Space" || e.code === "Enter")) {
      resetGame();
    }
  }
  function onKeyUp(e: KeyboardEvent) { keys[e.code] = false; }
  function onMouseDown() { mouseDown = true; }
  function onMouseUp() { mouseDown = false; }

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // Touch controls
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    if (game.state === "menu") startGamePlay();
    if (game.state === "gameover") resetGame();
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    if (dx > 20) { keys["ArrowRight"] = true; keys["ArrowLeft"] = false; }
    else if (dx < -20) { keys["ArrowLeft"] = true; keys["ArrowRight"] = false; }
    else { keys["ArrowLeft"] = false; keys["ArrowRight"] = false; }
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    keys["ArrowLeft"] = false;
    keys["ArrowRight"] = false;
    if (Math.abs(e.changedTouches[0].clientY - touchStartY) > 30) {
      keys["Space"] = true;
      setTimeout(() => { keys["Space"] = false; }, 100);
    }
  }, { passive: false });

  // --- Level Generation ---
  function generateLevel(lvl: number) {
    platforms = [];
    coins = [];
    enemies = [];
    boss = null;
    particles = [];
    game.isBossLevel = lvl % 10 === 0;
    game.cameraX = 0;
    levelWidth = 2200 + lvl * 150;

    const groundY = 540;
    platforms.push({ x: 0, y: groundY, w: levelWidth, h: 60, type: "ground", origX: 0, origY: groundY, moveRange: 0, moveSpeed: 0, hp: 999, breakTimer: 0 });

    // Gaps in ground for higher levels
    if (lvl >= 3) {
      const numGaps = Math.min(Math.floor(lvl / 3), 4);
      const gapPositions: number[] = [];
      for (let g = 0; g < numGaps; g++) {
        const gapX = 400 + g * (levelWidth / (numGaps + 1)) + Math.random() * 100;
        const gapW = 60 + lvl * 5;
        // Replace ground with segments around gaps
        platforms = platforms.filter(p => p.type !== "ground");
        let prevEnd = 0;
        for (const gx of gapPositions.sort((a, b) => a - b)) {
          if (gx > prevEnd + 40) {
            platforms.push({ x: prevEnd, y: groundY, w: gx - prevEnd, h: 60, type: "ground", origX: prevEnd, origY: groundY, moveRange: 0, moveSpeed: 0, hp: 999, breakTimer: 0 });
          }
          prevEnd = gx + gapW;
        }
        if (prevEnd < levelWidth) {
          platforms.push({ x: prevEnd, y: groundY, w: levelWidth - prevEnd, h: 60, type: "ground", origX: prevEnd, origY: groundY, moveRange: 0, moveSpeed: 0, hp: 999, breakTimer: 0 });
        }
        break; // Only process first gap batch
      }
    }

    // Floating platforms
    const numPlatforms = 8 + Math.floor(lvl * 1.5);
    for (let i = 0; i < numPlatforms; i++) {
      const px = 200 + (i / numPlatforms) * (levelWidth - 500) + Math.random() * 60;
      const py = 320 + Math.random() * 160;
      const pw = 70 + Math.random() * 110;
      const r = Math.random();
      const type: Platform["type"] = r < 0.15 ? "moving" : r < 0.25 ? "breakable" : "normal";
      platforms.push({
        x: px, y: py, w: pw, h: 25, type,
        origX: px, origY: py,
        moveRange: type === "moving" ? 60 + Math.random() * 80 : 0,
        moveSpeed: type === "moving" ? 0.015 + Math.random() * 0.02 : 0,
        hp: type === "breakable" ? 2 : 999,
        breakTimer: 0,
      });
    }

    // Coins
    for (const p of platforms) {
      if (p.type === "ground") continue;
      const numCoins = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < numCoins; c++) {
        const spacing = (p.w - 30) / Math.max(1, numCoins);
        coins.push({ x: p.x + 15 + c * spacing, y: p.y - 28, r: 10, collected: false, bobOffset: Math.random() * Math.PI * 2 });
      }
    }
    for (let i = 0; i < 4 + lvl; i++) {
      coins.push({ x: 250 + Math.random() * (levelWidth - 500), y: groundY - 28, r: 10, collected: false, bobOffset: Math.random() * Math.PI * 2 });
    }

    // Enemies
    const numEnemies = Math.min(2 + Math.floor(lvl * 0.8), 12);
    for (let i = 0; i < numEnemies; i++) {
      const availPlatforms = platforms.filter(p => p.type !== "breakable" && p.type !== "ground");
      const plat = availPlatforms[Math.floor(Math.random() * availPlatforms.length)] || platforms[0];
      enemies.push({
        x: plat.x + 15,
        y: plat.y - 35,
        w: 30, h: 32,
        vx: (Math.random() > 0.5 ? 1 : -1) * (1.5 + Math.random() * lvl * 0.25),
        platform: plat,
        type: Math.random() < 0.35 ? "spiky" : "walker",
        alive: true,
        frame: 0,
      });
    }

    // Boss
    if (game.isBossLevel) {
      const bossHp = 5 + Math.floor(lvl / 10) * 3;
      boss = {
        x: levelWidth - 400,
        y: groundY - 80,
        w: 70, h: 75,
        vx: 2 + lvl * 0.12,
        vy: 0,
        hp: bossHp,
        maxHp: bossHp,
        timer: 0,
        jumpTimer: 0,
        alive: true,
        frame: 0,
      };
    }

    // Goal
    if (!game.isBossLevel) {
      goalFlag = { x: levelWidth - 120, y: groundY - 85, w: 10, h: 85 };
    }

    // Reset player
    player = {
      x: 80, y: groundY - 60, vx: 0, vy: 0,
      w: 32, h: 46,
      onGround: false, facing: 1, jumping: false,
      invincible: 0, runFrame: 0, runTimer: 0, isRunning: false, leanAngle: 0,
    };
  }

  function startGamePlay() {
    AudioSys.init();
    AudioSys.resume();
    AudioSys.startMusic();
    game.state = "playing";
    game.level = 1;
    game.coins = 0;
    game.lives = START_LIVES;
    game.score = 0;
    generateLevel(1);
  }

  function resetGame() {
    game.state = "playing";
    game.level = 1;
    game.coins = 0;
    game.lives = START_LIVES;
    game.score = 0;
    generateLevel(1);
    AudioSys.startMusic();
  }

  function nextLevel() {
    game.level++;
    game.state = "levelComplete";
    game.stateTimer = 120;
    AudioSys.levelup();
  }

  function loseLife() {
    if (player.invincible > 0) return;
    game.lives--;
    player.invincible = 90;
    game.shakeTimer = 20;
    game.shakeIntensity = 10;
    AudioSys.hurt();
    spawnParticles(player.x + player.w / 2, player.y + player.h / 2, 15, "#ff4444", 5);

    if (game.lives <= 0) {
      game.state = "gameover";
      game.stateTimer = 0;
      AudioSys.stopMusic();
      AudioSys.gameover();
    } else {
      player.x = 80;
      player.y = 400;
      player.vx = 0;
      player.vy = 0;
    }
  }

  // --- Particles ---
  function spawnParticles(x: number, y: number, count: number, color: string, speed: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = Math.random() * speed;
      particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 2,
        life: 30 + Math.random() * 20,
        maxLife: 50,
        size: 2 + Math.random() * 3,
        color,
      });
    }
  }

  // --- Collision ---
  function checkCollision(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // --- Update ---
  function update() {
    if (game.state !== "playing") {
      if (game.state === "levelComplete") {
        game.stateTimer--;
        if (game.stateTimer <= 0) {
          game.state = "playing";
          generateLevel(game.level);
        }
      }
      return;
    }

    game.time++;

    // Player movement
    let moveDir = 0;
    if (keys["ArrowLeft"] || keys["KeyA"]) moveDir = -1;
    if (keys["ArrowRight"] || keys["KeyD"]) moveDir = 1;

    if (moveDir !== 0) {
      player.vx += moveDir * ACCEL;
      if (Math.abs(player.vx) > MOVE_SPEED) player.vx = MOVE_SPEED * moveDir;
      player.facing = moveDir;
      player.isRunning = player.onGround && Math.abs(player.vx) > 1;
    } else {
      player.isRunning = false;
    }

    // Smooth lean
    const targetLean = player.isRunning ? player.facing * 0.08 : 0;
    player.leanAngle += (targetLean - player.leanAngle) * 0.15;

    // Jump
    if ((keys["Space"] || keys["ArrowUp"] || keys["KeyW"]) && player.onGround) {
      player.vy = JUMP_FORCE;
      player.onGround = false;
      player.jumping = true;
      AudioSys.jump();
      spawnParticles(player.x + player.w / 2, player.y + player.h, 6, "#8B7355", 3);
    }
    if (!(keys["Space"] || keys["ArrowUp"] || keys["KeyW"]) && player.vy < -6) {
      player.vy = -6;
    }

    // Physics
    player.vx *= FRICTION;
    if (Math.abs(player.vx) < 0.1) player.vx = 0;
    player.vy += GRAVITY;
    if (player.vy > MAX_FALL) player.vy = MAX_FALL;
    player.x += player.vx;
    player.y += player.vy;

    // Bounds
    if (player.x < 0) { player.x = 0; player.vx = 0; }
    if (player.x + player.w > levelWidth) { player.x = levelWidth - player.w; player.vx = 0; }

    // Platform collision
    player.onGround = false;
    for (const p of platforms) {
      if (p.hp <= 0) continue;

      if (p.type === "moving") {
        p.x = p.origX + Math.sin(game.time * p.moveSpeed + p.origY * 0.01) * p.moveRange;
      }

      const pTop = p.y;
      const pBottom = p.y + p.h;
      const pLeft = p.x;
      const pRight = p.x + p.w;

      if (player.x + player.w > pLeft && player.x < pRight) {
        if (player.vy >= 0 && player.y + player.h >= pTop && player.y + player.h <= pTop + Math.max(player.vy, 8) + 2) {
          player.y = pTop - player.h;
          player.vy = 0;
          player.onGround = true;
          player.jumping = false;

          if (p.type === "breakable") {
            p.hp--;
            p.breakTimer = 10;
            AudioSys.break();
            if (p.hp <= 0) {
              spawnParticles(p.x + p.w / 2, p.y + p.h / 2, 15, "#8B6914", 5);
            }
          }
        } else if (player.vy < 0 && player.y <= pBottom && player.y >= pTop) {
          player.vy = 2;
        }
      }

      if (player.y + player.h > pTop + 5 && player.y < pBottom - 5) {
        if (player.vx > 0 && player.x + player.w > pLeft && player.x + player.w < pLeft + 15) {
          player.x = pLeft - player.w;
          player.vx = 0;
        } else if (player.vx < 0 && player.x < pRight && player.x > pRight - 15) {
          player.x = pRight;
          player.vx = 0;
        }
      }
    }

    // Fall off
    if (player.y > H + 100) loseLife();

    // Enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      e.x += e.vx;
      e.frame++;

      if (e.platform && e.platform.hp > 0) {
        if (e.x < e.platform.x) { e.x = e.platform.x; e.vx *= -1; }
        if (e.x + e.w > e.platform.x + e.platform.w) { e.x = e.platform.x + e.platform.w - e.w; e.vx *= -1; }
      }

      if (player.invincible <= 0 && checkCollision(player, e)) {
        if (player.vy > 0 && player.y + player.h < e.y + e.h * 0.6) {
          e.alive = false;
          player.vy = -9;
          game.score += 100;
          AudioSys.stomp();
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 10, "#e74c3c", 4);
        } else {
          loseLife();
        }
      }
    }

    // Boss
    if (boss && boss.alive) {
      boss.timer++;
      boss.frame++;

      const speed = 2.5 + game.level * 0.12;
      if (boss.timer % 100 < 50) boss.vx = speed;
      else boss.vx = -speed;

      boss.jumpTimer++;
      if (boss.jumpTimer > 90) {
        boss.jumpTimer = 0;
        let groundY = 540;
        for (const p of platforms) {
          if (boss.x + boss.w / 2 > p.x && boss.x + boss.w / 2 < p.x + p.w) {
            if (p.y < groundY) groundY = p.y;
          }
        }
        if (boss.y + boss.h >= groundY - 5) {
          boss.vy = -13;
          AudioSys.hurt();
        }
      }

      boss.vy += GRAVITY;
      boss.x += boss.vx;
      boss.y += boss.vy;

      if (boss.x < 0 || boss.x + boss.w > levelWidth) boss.vx *= -1;
      let gY = 540;
      for (const p of platforms) {
        if (boss.x + boss.w / 2 > p.x && boss.x + boss.w / 2 < p.x + p.w) {
          if (p.y < gY) gY = p.y;
        }
      }
      if (boss.y + boss.h > gY) {
        boss.y = gY - boss.h;
        boss.vy = 0;
      }

      if (player.invincible <= 0 && checkCollision(player, boss)) {
        if (player.vy > 0 && player.y + player.h < boss.y + boss.h * 0.5) {
          boss.hp--;
          player.vy = -11;
          game.shakeTimer = 15;
          game.shakeIntensity = 8;
          game.score += 200;
          AudioSys.bossHit();
          spawnParticles(boss.x + boss.w / 2, boss.y, 12, "#ff4444", 5);

          if (boss.hp <= 0) {
            boss.alive = false;
            game.score += 1000;
            AudioSys.bossDefeat();
            spawnParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, 30, "#ff4444", 8);
            spawnParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, 20, "#ffd700", 6);
            setTimeout(() => { if (game.state === "playing") nextLevel(); }, 2000);
          }
        } else {
          loseLife();
        }
      }
    }

    // Coins
    for (const c of coins) {
      if (c.collected) continue;
      const dx = (player.x + player.w / 2) - c.x;
      const dy = (player.y + player.h / 2) - c.y;
      if (Math.sqrt(dx * dx + dy * dy) < c.r + 18) {
        c.collected = true;
        game.coins++;
        game.score += 50;
        AudioSys.coin();
        spawnParticles(c.x, c.y, 8, "#ffd700", 3);
      }
    }

    // Goal
    if (goalFlag && !game.isBossLevel) {
      if (player.x + player.w > goalFlag.x && player.x < goalFlag.x + 40 && player.y + player.h > goalFlag.y) {
        nextLevel();
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (player.invincible > 0) player.invincible--;

    // Camera
    const targetCamX = player.x + player.w / 2 - W * 0.4;
    game.cameraX += (targetCamX - game.cameraX) * 0.08;
    if (game.cameraX < 0) game.cameraX = 0;
    if (game.cameraX > levelWidth - W) game.cameraX = levelWidth - W;

    if (game.shakeTimer > 0) game.shakeTimer--;

    // Run animation
    if (player.isRunning) {
      player.runTimer++;
      if (player.runTimer > 6) {
        player.runFrame = (player.runFrame + 1) % 8;
        player.runTimer = 0;
      }
    } else {
      player.runFrame = 0;
      player.runTimer = 0;
    }
  }

  // --- Drawing ---
  function drawClouds(parallax: number) {
    ctx.globalAlpha = 0.3 * parallax;
    const cloudColor = game.isBossLevel ? "#3a2a5a" : "#ffffff";
    const t = game.time * 0.002 * parallax;
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 200 + t * 100 + parallax * 300) % (W + 300)) - 150;
      const cy = 40 + i * 25 + parallax * 50;
      ctx.fillStyle = cloudColor;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 55, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 35, cy - 10, 40, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - 30, cy - 5, 35, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMountains() {
    ctx.globalAlpha = 0.3;
    const offset = -game.cameraX * 0.1;
    ctx.fillStyle = game.isBossLevel ? "#2a1a4a" : "#5a8a5a";
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 50) {
      const h = 200 + Math.sin((x + offset) * 0.01) * 80 + Math.cos((x + offset) * 0.025) * 40;
      ctx.lineTo(x, H - h);
    }
    ctx.lineTo(W, H);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPlatform(p: Platform) {
    if (p.hp <= 0) return;

    if (p.type === "ground") {
      ctx.fillStyle = "#5a8f3c";
      ctx.fillRect(p.x, p.y, p.w, 10);
      ctx.fillStyle = "#8B5E34";
      ctx.fillRect(p.x, p.y + 10, p.w, p.h - 10);
      ctx.fillStyle = "#6ab04c";
      for (let gx = p.x; gx < p.x + p.w; gx += 15) {
        ctx.fillRect(gx, p.y - 4, 10, 6);
      }
      ctx.fillStyle = "#7a5020";
      for (let dx = p.x + 5; dx < p.x + p.w; dx += 25) {
        for (let dy = p.y + 15; dy < p.y + p.h; dy += 15) {
          ctx.fillRect(dx + (dy % 2) * 10, dy, 8, 4);
        }
      }
    } else if (p.type === "breakable") {
      ctx.fillStyle = p.breakTimer > 0 ? "#ff8866" : "#c8843c";
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = "#8B5E34";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = "#a06a2c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + p.h / 2);
      ctx.lineTo(p.x + p.w, p.y + p.h / 2);
      ctx.stroke();
      if (p.hp < 2) {
        ctx.strokeStyle = "#4a3020";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x + p.w * 0.3, p.y);
        ctx.lineTo(p.x + p.w * 0.45, p.y + p.h * 0.5);
        ctx.lineTo(p.x + p.w * 0.35, p.y + p.h);
        ctx.stroke();
      }
    } else {
      const baseColor = p.type === "moving" ? "#4a90d9" : "#7a5c3a";
      const topColor = p.type === "moving" ? "#6ab0f0" : "#8B7355";
      ctx.fillStyle = baseColor;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = topColor;
      ctx.fillRect(p.x, p.y, p.w, 7);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
      if (p.type === "moving") {
        ctx.shadowColor = "#4a90d9";
        ctx.shadowBlur = 8;
        ctx.strokeStyle = "#8ac0ff";
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.shadowBlur = 0;
      }
    }
  }

  function drawCoin(c: Coin) {
    if (c.collected) return;
    const bobY = Math.sin(game.time * 0.06 + c.bobOffset) * 4;
    const spin = Math.abs(Math.cos(game.time * 0.08 + c.bobOffset));

    ctx.save();
    ctx.translate(c.x, c.y + bobY);
    ctx.scale(Math.max(0.2, spin), 1);

    ctx.beginPath();
    ctx.arc(0, 0, c.r + 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,215,0,0.2)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, c.r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd700";
    ctx.fill();
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, c.r * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = "#daa520";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", 0, 0);

    ctx.restore();
  }

  function drawEnemy(e: Enemy) {
    if (!e.alive) return;
    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + e.h / 2);

    const bounce = Math.sin(e.frame * 0.15) * 2;
    const squish = 1 + Math.sin(e.frame * 0.15) * 0.05;

    if (e.type === "walker") {
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath();
      ctx.ellipse(0, bounce, 14 * squish, 14 / squish, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(-5, -3 + bounce, 4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(5, -3 + bounce, 4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      const lookDir = e.vx > 0 ? 1 : -1;
      ctx.beginPath();
      ctx.arc(-5 + lookDir, -3 + bounce, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(5 + lookDir, -3 + bounce, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-9, -7 + bounce);
      ctx.lineTo(-3, -5 + bounce);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(9, -7 + bounce);
      ctx.lineTo(3, -5 + bounce);
      ctx.stroke();

      const footAnim = Math.sin(e.frame * 0.2) * 4;
      ctx.fillStyle = "#c0392b";
      ctx.beginPath();
      ctx.ellipse(-6, 13 + bounce, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(6, 13 + bounce - footAnim * 0.3, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Spiky
      ctx.fillStyle = "#8e44ad";
      ctx.beginPath();
      const spikes = 10;
      for (let i = 0; i < spikes; i++) {
        const angle = (i / spikes) * Math.PI * 2 + e.frame * 0.03;
        const r = i % 2 === 0 ? 19 : 12;
        const sx = Math.cos(angle) * r;
        const sy = Math.sin(angle) * r + bounce;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#6c2c8a";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#6c2c8a";
      ctx.beginPath();
      ctx.arc(0, bounce, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ff0";
      ctx.shadowColor = "#ff0";
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(0, bounce, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(0, bounce, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawBoss(b: Boss) {
    if (!b.alive) return;
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);

    const pulse = 1 + Math.sin(b.frame * 0.08) * 0.04;
    ctx.scale(pulse, pulse);

    // Glow
    ctx.shadowColor = "#ff0000";
    ctx.shadowBlur = 15;

    // Body
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath();
    ctx.ellipse(0, 5, 32, 36, 0, 0, Math.PI * 2);
    ctx.fill();

    // Armor
    ctx.fillStyle = "#2a2a4a";
    ctx.beginPath();
    ctx.ellipse(0, -5, 26, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4a4a8a";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Shoulder pads
    ctx.fillStyle = "#3a3a5a";
    ctx.beginPath();
    ctx.ellipse(-28, -5, 12, 10, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(28, -5, 12, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Head
    ctx.fillStyle = "#0a0a1a";
    ctx.beginPath();
    ctx.arc(0, -30, 18, 0, Math.PI * 2);
    ctx.fill();

    // Horns
    ctx.fillStyle = "#4a4a6e";
    ctx.beginPath();
    ctx.moveTo(-12, -40);
    ctx.lineTo(-22, -60);
    ctx.lineTo(-8, -42);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(12, -40);
    ctx.lineTo(22, -60);
    ctx.lineTo(8, -42);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "#ff2200";
    ctx.shadowColor = "#ff2200";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(-7, -32, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7, -32, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Pupils
    ctx.fillStyle = "#ffff00";
    ctx.beginPath();
    ctx.arc(-7, -32, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7, -32, 2, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.fillStyle = "#ff4400";
    ctx.beginPath();
    ctx.arc(0, -22, 7, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "#fff";
    for (let i = -5; i <= 5; i += 2.5) {
      ctx.fillRect(i - 1, -22, 2, 4);
    }

    // Arms
    const armSwing = Math.sin(b.frame * 0.08) * 12;
    ctx.fillStyle = "#2a2a4a";
    ctx.beginPath();
    ctx.ellipse(-32, 8 + armSwing, 10, 16, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(32, 8 - armSwing, 10, 16, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Claws
    ctx.fillStyle = "#8a8aaa";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-35 + i * 5, 22 + armSwing);
      ctx.lineTo(-37 + i * 5, 30 + armSwing);
      ctx.lineTo(-33 + i * 5, 22 + armSwing);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(35 + i * 5, 22 - armSwing);
      ctx.lineTo(37 + i * 5, 30 - armSwing);
      ctx.lineTo(33 + i * 5, 22 - armSwing);
      ctx.fill();
    }

    // Legs
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(-18, 30, 12, 15);
    ctx.fillRect(6, 30, 12, 15);

    ctx.restore();

    // HP Bar
    const barW = 80;
    const barH = 10;
    const bx = b.x + b.w / 2 - barW / 2;
    const by = b.y - 25;
    ctx.fillStyle = "#333";
    ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    ctx.fillStyle = "#111";
    ctx.fillRect(bx, by, barW, barH);
    const hpRatio = b.hp / b.maxHp;
    ctx.fillStyle = hpRatio > 0.5 ? "#44cc44" : hpRatio > 0.25 ? "#ffaa00" : "#ff2200";
    ctx.fillRect(bx, by, barW * hpRatio, barH);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 1, by - 1, barW + 2, barH + 2);

    ctx.fillStyle = "#ff4444";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText("💀 BOSS", b.x + b.w / 2, by - 6);
  }

  function drawPlayer() {
    ctx.save();
    const px = player.x;
    const py = player.y;

    if (player.invincible > 0 && Math.floor(player.invincible / 4) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    // Shadow
    if (player.onGround) {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(px + player.w / 2, py + player.h + 2, 14, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(px + player.w / 2, py + player.h);
    ctx.rotate(player.leanAngle);
    ctx.translate(-player.w / 2, -player.h);

    // Legs with running animation
    const t = player.runFrame;
    const isMoving = player.isRunning;
    const isAir = !player.onGround;

    let legAngleL: number, legAngleR: number;
    if (isMoving) {
      const runCycle = [0.4, 0.15, 0, -0.15, -0.4, -0.15, 0, 0.15][t % 8];
      legAngleL = runCycle;
      legAngleR = -runCycle;
    } else if (isAir) {
      legAngleL = 0.5;
      legAngleR = -0.3;
    } else {
      legAngleL = 0;
      legAngleR = 0;
    }

    const hipY = 30;
    const bodyBounce = isMoving ? Math.abs(Math.sin(t * Math.PI / 4)) * 2 : 0;

    // Left leg
    ctx.save();
    ctx.translate(12, hipY);
    ctx.rotate(legAngleL);
    ctx.fillStyle = "#3a5a8a";
    ctx.fillRect(-3, 0, 7, 14);
    ctx.fillStyle = "#5a3a1a";
    ctx.beginPath();
    ctx.roundRect(-4, 12, 10, 5, 2);
    ctx.fill();
    ctx.restore();

    // Right leg
    ctx.save();
    ctx.translate(20, hipY);
    ctx.rotate(legAngleR);
    ctx.fillStyle = "#3a5a8a";
    ctx.fillRect(-3, 0, 7, 14);
    ctx.fillStyle = "#5a3a1a";
    ctx.beginPath();
    ctx.roundRect(-4, 12, 10, 5, 2);
    ctx.fill();
    ctx.restore();

    // Torso
    ctx.fillStyle = "#2ecc40";
    ctx.beginPath();
    ctx.roundRect(8, 12 - bodyBounce, 16, 18, 3);
    ctx.fill();
    ctx.fillStyle = "#27ae36";
    ctx.fillRect(8, 12 - bodyBounce, 16, 4);
    // Belt
    ctx.fillStyle = "#4a3520";
    ctx.fillRect(8, 28 - bodyBounce, 16, 4);
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(14, 28 - bodyBounce, 4, 4);

    // Arms
    const armSwingL = isMoving ? Math.sin(t * Math.PI / 4) * 0.5 : 0;
    const armSwingR = isMoving ? -Math.sin(t * Math.PI / 4) * 0.5 : 0;
    const armBaseY = 15 - bodyBounce;

    ctx.save();
    ctx.translate(8, armBaseY);
    ctx.rotate(armSwingL);
    ctx.fillStyle = "#d4a574";
    ctx.fillRect(-2, 0, 5, 12);
    ctx.fillStyle = "#c49464";
    ctx.beginPath();
    ctx.arc(0, 13, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(24, armBaseY);
    ctx.rotate(armSwingR);
    ctx.fillStyle = "#d4a574";
    ctx.fillRect(-3, 0, 5, 12);
    ctx.fillStyle = "#c49464";
    ctx.beginPath();
    ctx.arc(0, 13, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Head
    const headY = -2 - bodyBounce;
    ctx.fillStyle = "#d4a574";
    ctx.fillRect(13, headY + 10, 6, 5);
    ctx.beginPath();
    ctx.arc(16, headY + 5, 12, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = "#2a1a0a";
    ctx.beginPath();
    ctx.arc(16, headY + 1, 12, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.fillRect(4, headY + 1, 4, 10);
    ctx.fillRect(28, headY + 1, 4, 10);

    // Hat
    ctx.fillStyle = "#2ecc40";
    ctx.beginPath();
    ctx.arc(16, headY - 4, 12, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(4, headY - 4, 24, 4);
    ctx.fillStyle = "#157022";
    ctx.fillRect(3, headY - 3, 26, 3);
    ctx.fillStyle = "#ffd700";
    ctx.beginPath();
    ctx.arc(16, headY - 14, 2, 0, Math.PI * 2);
    ctx.fill();

    // Face
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(12, headY + 5, 3.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(20, headY + 5, 3.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a4a8a";
    ctx.beginPath();
    ctx.arc(12, headY + 5, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, headY + 5, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(12, headY + 5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, headY + 5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(13, headY + 4, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(21, headY + 4, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    ctx.fillStyle = "#c49a6a";
    ctx.beginPath();
    ctx.arc(16, headY + 9, 2, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = "#8a5a3a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (isMoving || isAir) {
      ctx.arc(16, headY + 11, 4, 0.1, Math.PI - 0.1);
    } else {
      ctx.arc(16, headY + 11, 3, 0.3, Math.PI - 0.3);
    }
    ctx.stroke();

    // Blush
    ctx.fillStyle = "rgba(255,150,150,0.3)";
    ctx.beginPath();
    ctx.ellipse(10, headY + 9, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(22, headY + 9, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  function drawGoalFlag() {
    if (!goalFlag) return;
    ctx.fillStyle = "#654321";
    ctx.fillRect(goalFlag.x, goalFlag.y, 5, goalFlag.h);
    const wave = Math.sin(game.time * 0.05) * 3;
    ctx.fillStyle = "#2ecc40";
    ctx.beginPath();
    ctx.moveTo(goalFlag.x + 5, goalFlag.y);
    ctx.quadraticCurveTo(goalFlag.x + 30, goalFlag.y + 10 + wave, goalFlag.x + 50, goalFlag.y + 15);
    ctx.lineTo(goalFlag.x + 5, goalFlag.y + 30);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("★", goalFlag.x + 22, goalFlag.y + 18);
    ctx.fillStyle = "#4a3520";
    ctx.fillRect(goalFlag.x - 5, goalFlag.y + goalFlag.h - 5, 15, 5);
  }

  function drawHUD() {
    ctx.save();
    ctx.font = "bold 18px Arial";
    ctx.textBaseline = "top";

    // Lives
    let heartsStr = "";
    for (let i = 0; i < 3; i++) heartsStr += i < game.lives ? "❤️ " : "🖤 ";
    ctx.fillStyle = "#ff6b6b";
    ctx.fillText(heartsStr.trim(), 12, 10);

    // Coins
    ctx.fillStyle = "#ffd700";
    ctx.textAlign = "center";
    ctx.fillText(`🪙 ${game.coins}`, W / 2, 10);

    // Level
    ctx.fillStyle = "#69dbff";
    ctx.textAlign = "right";
    const levelText = `Bölüm ${game.level}${game.isBossLevel ? " ⚔️" : ""}`;
    ctx.fillText(levelText, W - 12, 10);

    // Score
    ctx.fillStyle = "#aaa";
    ctx.font = "14px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`Skor: ${game.score}`, W - 12, 34);

    ctx.restore();
  }

  function drawMenu() {
    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, W, H);

    // Stars
    for (let i = 0; i < 80; i++) {
      const x = (i * 137.5) % W;
      const y = (i * 73.3) % (H - 100);
      const size = (i % 3) + 1;
      ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.15})`;
      ctx.fillRect(x, y, size, size);
    }

    // Title
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const pulse = 1 + Math.sin(game.time * 0.03) * 0.05;
    ctx.save();
    ctx.translate(W / 2, H / 2 - 80);
    ctx.scale(pulse, pulse);
    ctx.font = "bold 56px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 20;
    ctx.fillText("🌍 LET'S WORLD", 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.font = "24px Arial";
    ctx.fillStyle = "#69dbff";
    ctx.fillText("Platform Macerası", W / 2, H / 2 - 20);

    // Instructions
    ctx.font = "18px Arial";
    ctx.fillStyle = "#ccc";
    ctx.fillText("← → Tuşları ile koş, SPACE ile zıpla", W / 2, H / 2 + 40);
    ctx.fillText("🪙 Jetonları topla, düşmanlardan kaç!", W / 2, H / 2 + 70);
    ctx.fillText("💀 Her 10 bölümde BOSS savaşı!", W / 2, H / 2 + 100);

    // Start prompt
    const alpha = 0.5 + Math.sin(game.time * 0.06) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = "bold 28px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText("▶ SPACE veya ENTER ile Başla", W / 2, H / 2 + 170);
    ctx.globalAlpha = 1;

    // Controls hint
    ctx.font = "14px Arial";
    ctx.fillStyle = "#888";
    ctx.fillText("Mobilde: Sol/ Sağ kaydır = hareket, Yukarı kaydır = zıpla", W / 2, H - 40);

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
    ctx.fillText(`🎉 BÖLÜM ${game.level} TAMAMLANDI!`, W / 2, H / 2 - 30);
    ctx.shadowBlur = 0;
    ctx.font = "22px Arial";
    ctx.fillStyle = "#ccc";
    ctx.fillText(`Skor: ${game.score}  |  Jeton: ${game.coins}`, W / 2, H / 2 + 30);
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
    ctx.fillText("💀 OYUN BİTTİ", W / 2, H / 2 - 40);
    ctx.shadowBlur = 0;
    ctx.font = "24px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText(`Skor: ${game.score}  |  Bölüm: ${game.level}  |  🪙 ${game.coins}`, W / 2, H / 2 + 20);
    const alpha = 0.5 + Math.sin(game.time * 0.06) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = "bold 22px Arial";
    ctx.fillStyle = "#ffd700";
    ctx.fillText("SPACE ile Tekrar Oyna", W / 2, H / 2 + 80);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // --- Main Draw ---
  function draw() {
    ctx.clearRect(0, 0, W, H);

    if (game.state === "menu") {
      game.time++;
      drawMenu();
      return;
    }

    // Sky
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    if (game.isBossLevel) {
      grad.addColorStop(0, "#1a0a2e");
      grad.addColorStop(0.5, "#2d1b4e");
      grad.addColorStop(1, "#0a0a1a");
    } else {
      grad.addColorStop(0, "#4a90d9");
      grad.addColorStop(0.4, "#87CEEB");
      grad.addColorStop(1, "#c8e6c0");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    drawClouds(0.3);
    drawClouds(0.6);
    drawMountains();

    ctx.save();

    // Screen shake
    if (game.shakeTimer > 0) {
      const shake = game.shakeIntensity * (game.shakeTimer / 15);
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    ctx.save();
    ctx.translate(-game.cameraX, 0);

    // Platforms
    for (const p of platforms) {
      if (p.x + p.w < game.cameraX - 50 || p.x > game.cameraX + W + 50) continue;
      drawPlatform(p);
    }

    // Coins
    for (const c of coins) {
      if (c.x < game.cameraX - 50 || c.x > game.cameraX + W + 50) continue;
      drawCoin(c);
    }

    // Enemies
    for (const e of enemies) {
      if (e.x < game.cameraX - 50 || e.x > game.cameraX + W + 50) continue;
      drawEnemy(e);
    }

    // Boss
    if (boss) drawBoss(boss);

    // Goal
    drawGoalFlag();

    // Player
    drawPlayer();

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // HUD
    drawHUD();

    // Overlays
    if (game.state === "levelComplete") drawLevelComplete();
    if (game.state === "gameover") drawGameOver();

    ctx.restore();
  }

  // --- Game Loop ---
  let rafId = 0;
  let lastTime = performance.now();

  function loop(now: number) {
    const _dt = now - lastTime;
    lastTime = now;

    update();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // Start the loop immediately for menu
  rafId = requestAnimationFrame(loop);

  // --- Cleanup ---
  return () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("mouseup", onMouseUp);
    AudioSys.destroy();
  };
}
