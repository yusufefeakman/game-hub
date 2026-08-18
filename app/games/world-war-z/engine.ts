/* =====================================================================
   WORLD WAR Z — Simple 3D Zombie Survival (Three.js)
   FPS: WASD move, mouse look, click to shoot, survive waves.
   All geometry is procedural (boxes/spheres) — no external assets.
   Audio is synthesized with the Web Audio API.

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */
import * as THREE from "three";

/* ================= 1. CONSTANTS ================= */
const ARENA = 60;            // arena half-size (playable square: -60..60)
const PLAYER_SPEED = 14;     // m/s
const PLAYER_HEIGHT = 1.7;   // eye height
const GRAVITY = 25;          // for jump
const JUMP_VEL = 8;
const BULLET_SPEED = 90;
const FIRE_RATE = 0.18;      // seconds between shots
const MAG_SIZE = 30;
const RELOAD_TIME = 1.6;
const ZOMBIE_BASE_SPEED = 2.2;
const ZOMBIE_HP = 3;
const WAVE_ZOMBIE_BASE = 6;
const WAVE_ZOMBIE_PER_WAVE = 4;
const WAVE_BREAK = 4;        // seconds between waves
const ZOMBIE_ATTACK_RANGE = 1.6;
const ZOMBIE_DAMAGE = 12;    // hp per hit
const ZOMBIE_ATTACK_CD = 0.9;

/* ================= 2. AUDIO (synthesized) ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
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
  noise(dur: number, vol = 0.4, delay = 0, freq = 1000) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master!);
    src.start(t);
  },
  shoot() { this.noise(0.12, 0.5, 0, 1800); this.tone("square", 180, 60, 0.1, 0.3); },
  reload() { this.tone("square", 400, 300, 0.08, 0.25); this.tone("square", 500, 400, 0.08, 0.25, 0.15); },
  zombieHit() { this.noise(0.1, 0.35, 0, 600); this.tone("sawtooth", 120, 60, 0.12, 0.3); },
  zombieDie() { this.tone("sawtooth", 200, 40, 0.4, 0.4); this.noise(0.3, 0.3, 0.05, 400); },
  playerHurt() { this.tone("sawtooth", 300, 80, 0.3, 0.5); this.noise(0.2, 0.4, 0, 800); },
  waveStart() { [220, 277, 330, 440].forEach((f, i) => this.tone("square", f, f, 0.15, 0.3, i * 0.12)); },
  empty() { this.tone("square", 200, 150, 0.05, 0.2); },
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.4; },
};

/* ================= 3. INPUT ================= */
const Input = {
  forward: false, back: false, left: false, right: false,
  jump: false, shooting: false,
  mouseDX: 0, mouseDY: 0,
  locked: false,
  init(canvas: HTMLCanvasElement, onLockChange: (locked: boolean) => void) {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
      if (k === "w" || k === "arrowup") this.forward = true;
      if (k === "s" || k === "arrowdown") this.back = true;
      if (k === "a" || k === "arrowleft") this.left = true;
      if (k === "d" || k === "arrowright") this.right = true;
      if (k === " ") this.jump = true;
      if (k === "r") game.reload();
      if (k === "m") game.toggleMute();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") this.forward = false;
      if (k === "s" || k === "arrowdown") this.back = false;
      if (k === "a" || k === "arrowleft") this.left = false;
      if (k === "d" || k === "arrowright") this.right = false;
      if (k === " ") this.jump = false;
    };
    const mouseMove = (e: MouseEvent) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    const mouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        if (!this.locked) {
          canvas.requestPointerLock();
        } else {
          this.shooting = true;
        }
      }
    };
    const mouseUp = (e: MouseEvent) => { if (e.button === 0) this.shooting = false; };
    const lockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      onLockChange(this.locked);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("mousemove", mouseMove);
    canvas.addEventListener("mousedown", mouseDown);
    document.addEventListener("mouseup", mouseUp);
    document.addEventListener("pointerlockchange", lockChange);
    this.cleanup = () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("mousemove", mouseMove);
      canvas.removeEventListener("mousedown", mouseDown);
      document.removeEventListener("mouseup", mouseUp);
      document.removeEventListener("pointerlockchange", lockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  },
  cleanup: () => {},
  consumeMouse() { const dx = this.mouseDX, dy = this.mouseDY; this.mouseDX = 0; this.mouseDY = 0; return { dx, dy }; },
};

/* ================= 4. ZOMBIE ================= */
interface Zombie {
  group: THREE.Group;
  hp: number;
  speed: number;
  alive: boolean;
  attackCD: number;
  deathT: number;
  hitFlash: number;
  // body part references for animation
  leftArm: THREE.Mesh; rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh; rightLeg: THREE.Mesh;
  walkPhase: number;
}

function makeZombie(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x5a7a4a });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x6b4a3a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x3a3a4a });

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), shirt);
  torso.position.y = 1.15;
  g.add(torso);
  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), skin);
  head.position.y = 1.85;
  g.add(head);
  // Eyes (glowing red)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
  eyeL.position.set(-0.1, 1.9, 0.23);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.1;
  g.add(eyeL, eyeR);
  // Arms (raised forward — classic zombie)
  const armGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);
  const leftArm = new THREE.Mesh(armGeo, skin);
  leftArm.position.set(-0.5, 1.4, 0.35);
  leftArm.rotation.x = -Math.PI / 2.2;
  const rightArm = new THREE.Mesh(armGeo, skin);
  rightArm.position.set(0.5, 1.4, 0.35);
  rightArm.rotation.x = -Math.PI / 2.2;
  g.add(leftArm, rightArm);
  // Legs
  const legGeo = new THREE.BoxGeometry(0.26, 0.8, 0.26);
  const leftLeg = new THREE.Mesh(legGeo, pants);
  leftLeg.position.set(-0.18, 0.4, 0);
  const rightLeg = new THREE.Mesh(legGeo, pants);
  rightLeg.position.set(0.18, 0.4, 0);
  g.add(leftLeg, rightLeg);

  return g;
}

/* ================= 5. GAME STATE ================= */
type GameState = "start" | "playing" | "paused" | "gameover" | "victory";

const game = {
  state: "start" as GameState,
  score: 0,
  wave: 0,
  zombiesKilled: 0,
  time: 0,
  waveBreakT: 0,
  // player
  hp: 100,
  mag: MAG_SIZE,
  reserveAmmo: Infinity,
  reloading: false,
  reloadT: 0,
  fireT: 0,
  vy: 0,
  onGround: true,
  hurtFlash: 0,
  // world
  zombies: [] as Zombie[],
  bullets: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[],
  obstacles: [] as THREE.Mesh[],
  spawnQueue: 0,
  spawnT: 0,

  startGame() {
    AudioSys.init(); AudioSys.resume();
    this.score = 0; this.wave = 0; this.zombiesKilled = 0; this.time = 0;
    this.hp = 100; this.mag = MAG_SIZE; this.reloading = false; this.reloadT = 0;
    this.fireT = 0; this.vy = 0; this.onGround = true; this.hurtFlash = 0;
    this.zombies.forEach(z => scene.remove(z.group));
    this.zombies = [];
    this.bullets.forEach(b => scene.remove(b.mesh));
    this.bullets = [];
    this.spawnQueue = 0; this.spawnT = 0;
    player.position.set(0, PLAYER_HEIGHT, 0);
    player.vel.set(0, 0, 0);
    yaw = 0; pitch = 0;
    this.state = "playing";
    this.waveBreakT = 1.5; // short delay before wave 1
    hideAllScreens();
    updateHUD();
  },
  reload() {
    if (this.reloading || this.mag === MAG_SIZE || this.state !== "playing") return;
    this.reloading = true;
    this.reloadT = RELOAD_TIME;
    AudioSys.reload();
  },
  toggleMute() {
    AudioSys.init();
    AudioSys.setMuted(!AudioSys.muted);
    const btn = document.getElementById("wwz-mute");
    if (btn) btn.innerHTML = AudioSys.muted ? "&#128263;" : "&#128266;";
  },
  gameOver() {
    this.state = "gameover";
    AudioSys.playerHurt();
    const el = document.getElementById("wwz-stats");
    if (el) el.innerHTML = `Score: ${this.score} &nbsp; Waves: ${this.wave} &nbsp; Zombies: ${this.zombiesKilled}`;
    show("wwz-screen-gameover");
    if (document.pointerLockElement) document.exitPointerLock();
  },
  addWave() {
    this.wave++;
    this.spawnQueue = WAVE_ZOMBIE_BASE + (this.wave - 1) * WAVE_ZOMBIE_PER_WAVE;
    this.spawnT = 0;
    AudioSys.waveStart();
    showWaveBanner(this.wave);
    updateHUD();
  },
  update(dt: number) {
    if (this.state !== "playing") return;
    this.time += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    // --- Player movement (WASD relative to yaw) ---
    const { dx, dy } = Input.consumeMouse();
    yaw -= dx * 0.0022;
    pitch -= dy * 0.0022;
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));

    const move = new THREE.Vector3();
    if (Input.forward) move.z -= 1;
    if (Input.back) move.z += 1;
    if (Input.left) move.x -= 1;
    if (Input.right) move.x += 1;
    if (move.lengthSq() > 0) {
      move.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      player.position.x += move.x * PLAYER_SPEED * dt;
      player.position.z += move.z * PLAYER_SPEED * dt;
    }
    // Jump
    if (Input.jump && this.onGround) { this.vy = JUMP_VEL; this.onGround = false; }
    this.vy -= GRAVITY * dt;
    player.position.y += this.vy * dt;
    if (player.position.y <= PLAYER_HEIGHT) { player.position.y = PLAYER_HEIGHT; this.vy = 0; this.onGround = true; }
    // Arena bounds
    player.position.x = Math.max(-ARENA + 1, Math.min(ARENA - 1, player.position.x));
    player.position.z = Math.max(-ARENA + 1, Math.min(ARENA - 1, player.position.z));
    // Obstacle collision (simple push-out)
    for (const o of this.obstacles) {
      const dxo = player.position.x - o.position.x;
      const dzo = player.position.z - o.position.z;
      const dist = Math.sqrt(dxo * dxo + dzo * dzo);
      const minDist = 1.2;
      if (dist < minDist && dist > 0.001) {
        const push = (minDist - dist) / dist;
        player.position.x += dxo * push;
        player.position.z += dzo * push;
      }
    }
    camera.position.copy(player.position);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(yaw);
    camera.rotateX(pitch);

    // --- Shooting ---
    this.fireT -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloading = false; this.mag = MAG_SIZE; updateHUD(); }
    } else if (Input.shooting && this.fireT <= 0) {
      if (this.mag > 0) {
        this.fireT = FIRE_RATE;
        this.mag--;
        AudioSys.shoot();
        spawnMuzzleFlash();
        // Bullet from camera center
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const origin = camera.position.clone().add(dir.clone().multiplyScalar(0.5));
        origin.y -= 0.15;
        const mesh = new THREE.Mesh(bulletGeo, bulletMat);
        mesh.position.copy(origin);
        scene.add(mesh);
        this.bullets.push({ mesh, vel: dir.multiplyScalar(BULLET_SPEED), life: 2 });
        updateHUD();
      } else {
        AudioSys.empty();
        this.fireT = 0.25;
        this.reload();
      }
    }

    // --- Bullets ---
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      let hit = false;
      // Hit zombie?
      for (const z of this.zombies) {
        if (!z.alive) continue;
        const zp = z.group.position;
        const dx = b.mesh.position.x - zp.x;
        const dy = b.mesh.position.y - (zp.y + 1.2);
        const dz = b.mesh.position.z - zp.z;
        if (dx * dx + dy * dy + dz * dz < 1.2) {
          z.hp--;
          z.hitFlash = 0.1;
          hit = true;
          if (z.hp <= 0) {
            z.alive = false;
            z.deathT = 0;
            this.zombiesKilled++;
            this.score += 100;
            AudioSys.zombieDie();
          } else {
            AudioSys.zombieHit();
          }
          updateHUD();
          break;
        }
      }
      // Hit obstacle?
      if (!hit) {
        for (const o of this.obstacles) {
          const dx = b.mesh.position.x - o.position.x;
          const dz = b.mesh.position.z - o.position.z;
          const dy = b.mesh.position.y - o.position.y;
          if (dx * dx + dz * dz < 2.5 && Math.abs(dy) < 3) { hit = true; break; }
        }
      }
      if (hit || b.life <= 0 || Math.abs(b.mesh.position.x) > ARENA + 5 || Math.abs(b.mesh.position.z) > ARENA + 5) {
        scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // --- Wave spawning ---
    if (this.zombies.filter(z => z.alive).length === 0 && this.spawnQueue === 0) {
      if (this.waveBreakT <= 0) {
        this.waveBreakT = WAVE_BREAK;
        showWaveBanner(this.wave + 1, true);
      }
    }
    if (this.waveBreakT > 0) {
      this.waveBreakT -= dt;
      if (this.waveBreakT <= 0) this.addWave();
    }
    if (this.spawnQueue > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 0.5;
        this.spawnQueue--;
        spawnZombie();
      }
    }

    // --- Zombies ---
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (!z.alive) {
        z.deathT += dt;
        z.group.rotation.x = Math.min(Math.PI / 2, z.deathT * 4);
        z.group.position.y = -z.deathT * 0.5;
        if (z.deathT > 1.5) {
          scene.remove(z.group);
          this.zombies.splice(i, 1);
        }
        continue;
      }
      if (z.hitFlash > 0) z.hitFlash -= dt;
      z.attackCD -= dt;
      // Move toward player
      const dir = new THREE.Vector3(
        player.position.x - z.group.position.x, 0,
        player.position.z - z.group.position.z
      );
      const dist = dir.length();
      dir.normalize();
      if (dist > ZOMBIE_ATTACK_RANGE) {
        z.group.position.addScaledVector(dir, z.speed * dt);
        // Walk animation
        z.walkPhase += dt * z.speed * 2;
        const swing = Math.sin(z.walkPhase) * 0.5;
        z.leftLeg.rotation.x = swing;
        z.rightLeg.rotation.x = -swing;
        z.leftArm.rotation.x = -Math.PI / 2.2 + Math.sin(z.walkPhase * 0.7) * 0.1;
        z.rightArm.rotation.x = -Math.PI / 2.2 - Math.sin(z.walkPhase * 0.7) * 0.1;
      } else {
        // Attack
        if (z.attackCD <= 0) {
          z.attackCD = ZOMBIE_ATTACK_CD;
          this.hp -= ZOMBIE_DAMAGE;
          this.hurtFlash = 0.3;
          AudioSys.playerHurt();
          updateHUD();
          if (this.hp <= 0) { this.hp = 0; this.gameOver(); return; }
        }
      }
      // Face player
      z.group.rotation.y = Math.atan2(dir.x, dir.z);
      // Hit flash
      const flash = z.hitFlash > 0;
      z.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const m = child.material as THREE.MeshLambertMaterial;
          if (m.emissive) m.emissive.setHex(flash ? 0xff0000 : 0x000000);
        }
      });
    }
  },
};

/* ================= 6. THREE.JS SETUP ================= */
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let player: { position: THREE.Vector3; vel: THREE.Vector3 };
let yaw = 0, pitch = 0;
let bulletGeo: THREE.SphereGeometry;
let bulletMat: THREE.MeshBasicMaterial;
let muzzleLight: THREE.PointLight;
let muzzleT = 0;

function buildWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 30, 90);

  camera = new THREE.PerspectiveCamera(75, 960 / 540, 0.1, 200);

  // Lights
  const ambient = new THREE.AmbientLight(0x404060, 1.2);
  scene.add(ambient);
  const moon = new THREE.DirectionalLight(0x8899ff, 0.8);
  moon.position.set(20, 40, 10);
  scene.add(moon);
  muzzleLight = new THREE.PointLight(0xffaa33, 0, 8);
  scene.add(muzzleLight);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(ARENA * 2, ARENA * 2, 30, 30);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x2a2a35 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // Grid lines on ground
  const grid = new THREE.GridHelper(ARENA * 2, 40, 0x3a3a4a, 0x2e2e3a);
  grid.position.y = 0.01;
  scene.add(grid);

  // Arena walls
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x3a3a4a });
  const wallH = 6;
  const mkWall = (w: number, d: number, x: number, z: number) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    wall.position.set(x, wallH / 2, z);
    scene.add(wall);
  };
  mkWall(ARENA * 2 + 2, 1, 0, -ARENA - 0.5);
  mkWall(ARENA * 2 + 2, 1, 0, ARENA + 0.5);
  mkWall(1, ARENA * 2 + 2, -ARENA - 0.5, 0);
  mkWall(1, ARENA * 2 + 2, ARENA + 0.5, 0);

  // Obstacles: crates and concrete blocks
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x6b5a3a });
  const blockMat = new THREE.MeshLambertMaterial({ color: 0x555566 });
  const obstaclePositions = [
    { x: -15, z: -10, s: 2, mat: crateMat },
    { x: 12, z: -18, s: 2.5, mat: blockMat },
    { x: 20, z: 8, s: 2, mat: crateMat },
    { x: -22, z: 15, s: 3, mat: blockMat },
    { x: 5, z: 22, s: 2, mat: crateMat },
    { x: -8, z: -25, s: 2.5, mat: blockMat },
    { x: 28, z: -5, s: 2, mat: crateMat },
    { x: -30, z: -20, s: 2, mat: crateMat },
    { x: 15, z: 30, s: 2.5, mat: blockMat },
    { x: -18, z: 32, s: 2, mat: crateMat },
  ];
  for (const p of obstaclePositions) {
    const h = p.s * 1.2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.s, h, p.s), p.mat);
    mesh.position.set(p.x, h / 2, p.z);
    scene.add(mesh);
    game.obstacles.push(mesh);
  }

  // Dead trees (dark cones) for atmosphere
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = ARENA - 5 - Math.random() * 8;
    const tree = new THREE.Mesh(new THREE.ConeGeometry(0.8, 5 + Math.random() * 3, 5), treeMat);
    tree.position.set(Math.cos(a) * r, 2.5, Math.sin(a) * r);
    scene.add(tree);
  }

  // Bullets
  bulletGeo = new THREE.SphereGeometry(0.08, 6, 6);
  bulletMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });

  player = { position: new THREE.Vector3(0, PLAYER_HEIGHT, 0), vel: new THREE.Vector3() };
}

function spawnZombie() {
  const group = makeZombie();
  // Spawn at arena edge
  const edge = Math.floor(Math.random() * 4);
  const t = (Math.random() - 0.5) * ARENA * 2;
  let x = 0, z = 0;
  if (edge === 0) { x = t; z = -ARENA + 2; }
  else if (edge === 1) { x = t; z = ARENA - 2; }
  else if (edge === 2) { x = -ARENA + 2; z = t; }
  else { x = ARENA - 2; z = t; }
  group.position.set(x, 0, z);
  scene.add(group);
  const speed = ZOMBIE_BASE_SPEED + game.wave * 0.15 + Math.random() * 0.5;
  game.zombies.push({
    group, hp: ZOMBIE_HP, speed, alive: true, attackCD: 0, deathT: 0, hitFlash: 0,
    leftArm: group.children[4] as THREE.Mesh, rightArm: group.children[5] as THREE.Mesh,
    leftLeg: group.children[6] as THREE.Mesh, rightLeg: group.children[7] as THREE.Mesh,
    walkPhase: Math.random() * 10,
  });
}

function spawnMuzzleFlash() {
  muzzleT = 0.06;
  muzzleLight.position.copy(camera.position);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  muzzleLight.position.addScaledVector(dir, 1);
  muzzleLight.intensity = 3;
}

/* ================= 7. HUD & OVERLAYS ================= */
const OVERLAY_CSS = `
.wwz-hud { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:center; padding:10px 16px; pointer-events:none; z-index:5; font-family:'Courier New',monospace; }
.wwz-hud-box { background:rgba(0,0,0,0.55); border:2px solid rgba(255,80,80,0.6); border-radius:8px; color:#fff; font-size:15px; font-weight:bold; padding:5px 14px; letter-spacing:1px; text-shadow:1px 1px 0 #000; display:flex; gap:16px; align-items:center; }
.wwz-hp-bar { width:120px; height:12px; background:rgba(255,255,255,0.2); border-radius:6px; overflow:hidden; }
.wwz-hp-fill { height:100%; background:linear-gradient(90deg,#ff3333,#ff6666); transition:width 0.2s; }
.wwz-mute { pointer-events:auto; cursor:pointer; background:rgba(0,0,0,0.55); border:2px solid rgba(255,255,255,0.6); border-radius:8px; color:#fff; font-size:16px; width:40px; height:36px; }
.wwz-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(10,5,15,0.88); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.wwz-overlay.hidden { display:none; }
.wwz-overlay h1 { font-size:clamp(30px,7vw,60px); letter-spacing:4px; color:#ff4444; text-shadow:3px 3px 0 #660000,6px 6px 0 rgba(0,0,0,0.5); margin-bottom:12px; }
.wwz-overlay h2 { font-size:clamp(18px,4vw,30px); margin-bottom:14px; color:#ffaa66; text-shadow:2px 2px 0 #000; }
.wwz-overlay p { font-size:clamp(13px,2.2vw,17px); line-height:1.8; margin-bottom:8px; color:#cfd8ff; }
.wwz-overlay .big-btn { margin-top:24px; font-family:inherit; font-size:clamp(16px,3vw,22px); font-weight:bold; padding:14px 38px; background:linear-gradient(#ff5533,#cc2200); color:#fff; border:3px solid #fff; border-radius:12px; cursor:pointer; box-shadow:0 5px 0 #660000; letter-spacing:2px; }
.wwz-overlay .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #660000; }
.wwz-overlay .keys { margin-top:18px; font-size:13px; color:#9aa5d1; line-height:2; }
.wwz-overlay .keys b { color:#ffaa66; }
.wwz-stats { font-size:clamp(15px,2.6vw,20px); color:#ffdd44; margin:8px 0; }
.wwz-wave-banner { position:absolute; top:35%; left:0; right:0; text-align:center; font-family:'Courier New',monospace; font-size:clamp(28px,6vw,52px); font-weight:bold; color:#ff4444; text-shadow:3px 3px 0 #000; z-index:6; pointer-events:none; opacity:0; transition:opacity 0.4s; letter-spacing:4px; }
.wwz-wave-banner.show { opacity:1; }
.wwz-crosshair { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:4; pointer-events:none; }
.wwz-crosshair::before, .wwz-crosshair::after { content:''; position:absolute; background:rgba(255,255,255,0.8); }
.wwz-crosshair::before { width:2px; height:18px; left:-1px; top:-9px; }
.wwz-crosshair::after { width:18px; height:2px; left:-9px; top:-1px; }
.wwz-damage-vignette { position:absolute; inset:0; pointer-events:none; z-index:3; background:radial-gradient(ellipse at center, transparent 55%, rgba(255,0,0,0.5) 100%); opacity:0; transition:opacity 0.15s; }
.wwz-aim-hint { position:absolute; bottom:12%; left:0; right:0; text-align:center; font-family:'Courier New',monospace; font-size:15px; color:rgba(255,255,255,0.7); z-index:4; pointer-events:none; }
`;

function buildOverlayUI(container: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "wwz-hud";
  hud.innerHTML = `
    <div class="wwz-hud-box">
      <span>HP <span class="wwz-hp-bar"><span class="wwz-hp-fill" id="wwz-hp-fill" style="width:100%"></span></span></span>
      <span id="wwz-hp-num">100</span>
    </div>
    <div class="wwz-hud-box">
      <span>WAVE <span id="wwz-wave">0</span></span>
      <span>SCORE <span id="wwz-score">0</span></span>
      <span>AMMO <span id="wwz-ammo">30</span></span>
    </div>
    <button id="wwz-mute" class="wwz-mute" title="Mute (M)">&#128266;</button>`;
  container.appendChild(hud);

  const crosshair = document.createElement("div");
  crosshair.className = "wwz-crosshair";
  container.appendChild(crosshair);

  const vignette = document.createElement("div");
  vignette.className = "wwz-damage-vignette";
  vignette.id = "wwz-vignette";
  container.appendChild(vignette);

  const waveBanner = document.createElement("div");
  waveBanner.className = "wwz-wave-banner";
  waveBanner.id = "wwz-wave-banner";
  container.appendChild(waveBanner);

  const aimHint = document.createElement("div");
  aimHint.className = "wwz-aim-hint";
  aimHint.id = "wwz-aim-hint";
  aimHint.textContent = "Click to start — WASD move, Mouse aim, Click shoot, R reload";
  container.appendChild(aimHint);

  const mk = (id: string, inner: string, hidden = false) => {
    const el = document.createElement("div");
    el.className = "wwz-overlay" + (hidden ? " hidden" : "");
    el.id = id;
    el.innerHTML = inner;
    container.appendChild(el);
    return el;
  };

  mk("wwz-screen-start", `
    <h1>WORLD WAR Z</h1>
    <h2>Zombie Survival</h2>
    <p>The horde is coming. Survive as many waves as you can.</p>
    <p>Each wave brings more zombies, faster and meaner.</p>
    <button class="big-btn" id="wwz-btn-start">START</button>
    <div class="keys">
      <b>WASD / Arrows</b> move &nbsp; &middot; &nbsp; <b>Mouse</b> aim &nbsp; &middot; &nbsp; <b>Click</b> shoot<br>
      <b>Space</b> jump &nbsp; &middot; &nbsp; <b>R</b> reload &nbsp; &middot; &nbsp; <b>M</b> mute
    </div>`);

  mk("wwz-screen-gameover", `
    <h1>YOU DIED</h1>
    <p>The horde got you...</p>
    <div class="wwz-stats" id="wwz-stats"></div>
    <button class="big-btn" id="wwz-btn-retry">TRY AGAIN</button>`, true);

  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  on("wwz-btn-start", () => { game.startGame(); canvasEl?.requestPointerLock(); });
  on("wwz-btn-retry", () => { game.startGame(); canvasEl?.requestPointerLock(); });
  on("wwz-mute", () => game.toggleMute());
}

let canvasEl: HTMLCanvasElement | null = null;

function show(id: string) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id: string) { document.getElementById(id)?.classList.add("hidden"); }
function hideAllScreens() {
  ["wwz-screen-start", "wwz-screen-gameover"].forEach(hide);
}
function showWaveBanner(wave: number, incoming = false) {
  const el = document.getElementById("wwz-wave-banner");
  if (!el) return;
  el.textContent = incoming ? `WAVE ${wave} INCOMING` : `WAVE ${wave}`;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}
function updateHUD() {
  const set = (id: string, v: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set("wwz-score", game.score);
  set("wwz-wave", game.wave);
  set("wwz-ammo", game.reloading ? "..." : game.mag);
  set("wwz-hp-num", Math.ceil(game.hp));
  const fill = document.getElementById("wwz-hp-fill");
  if (fill) fill.style.width = Math.max(0, game.hp) + "%";
  const vignette = document.getElementById("wwz-vignette");
  if (vignette) vignette.style.opacity = game.hurtFlash > 0 ? "1" : "0";
  const hint = document.getElementById("wwz-aim-hint");
  if (hint) hint.style.display = game.state === "playing" && Input.locked ? "none" : (game.state === "playing" ? "block" : "none");
}

/* ================= 8. MAIN LOOP & PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  buildWorld();

  // Wrap canvas for overlay UI
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;";
  canvas.parentNode?.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  buildOverlayUI(wrap);

  const resize = () => {
    const scale = Math.min(window.innerWidth / 960, window.innerHeight / 540);
    canvas.style.width = 960 * scale + "px";
    canvas.style.height = 540 * scale + "px";
  };
  resize();
  window.addEventListener("resize", resize);

  Input.init(canvas, () => updateHUD());
  updateHUD();

  let raf = 0;
  let lastTime = 0;
  const loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0.016);
    lastTime = ts;
    game.update(dt);
    // Muzzle flash decay
    if (muzzleT > 0) { muzzleT -= dt; if (muzzleT <= 0) muzzleLight.intensity = 0; }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    Input.cleanup();
    wrap.remove();
    renderer.dispose();
    canvasEl = null;
  };
}