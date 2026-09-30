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
const WAVE_ZOMBIE_BASE = 6;
const WAVE_ZOMBIE_PER_WAVE = 4;
const WAVE_BREAK = 4;        // seconds between waves
const ZOMBIE_ATTACK_RANGE = 1.6;
const PICKUP_RANGE = 1.3;    // walk-over pickup radius (XZ)

/* Weapons: rifle / shotgun / sniper (switch with 1/2/3 or mouse wheel) */
interface WeaponDef {
  name: string;
  fireRate: number;    // seconds between shots
  magSize: number;
  reloadTime: number;
  pellets: number;     // projectiles per trigger pull (shotgun = spread shot)
  spread: number;      // radians of random spread per projectile
  damage: number;      // hp per projectile
  bulletSpeed: number;
  bulletLife: number;  // seconds (short for pellets -> close-range damage)
  tracerColor: number;
  flashColor: number; flashIntensity: number; flashDur: number; // per-weapon muzzle flash
  reserveMax: number;  // Infinity for rifle
  recoil: number;      // viewmodel kick
}
const WEAPONS: WeaponDef[] = [
  { name: "RIFLE",   fireRate: 0.18, magSize: 30, reloadTime: 1.6, pellets: 1, spread: 0.012, damage: 1, bulletSpeed: 90,  bulletLife: 2,    tracerColor: 0xffdd44, flashColor: 0xffaa33, flashIntensity: 3, flashDur: 0.06, reserveMax: Infinity, recoil: 0.05 },
  { name: "SHOTGUN", fireRate: 0.9,  magSize: 8,  reloadTime: 2.2, pellets: 8, spread: 0.1,   damage: 1, bulletSpeed: 75,  bulletLife: 0.35, tracerColor: 0xffaa66, flashColor: 0xff7722, flashIntensity: 5, flashDur: 0.09, reserveMax: 40,       recoil: 0.14 },
  { name: "SNIPER",  fireRate: 1.2,  magSize: 5,  reloadTime: 2.4, pellets: 1, spread: 0.002, damage: 3, bulletSpeed: 160, bulletLife: 1.2,  tracerColor: 0x66ddff, flashColor: 0x88ccff, flashIntensity: 6, flashDur: 0.1,  reserveMax: 24,       recoil: 0.2 },
];

/* Zombie variants: walker (default), runner (fast/weak), brute (slow/tanky) */
type ZombieKind = "walker" | "runner" | "brute";
interface ZombieVariant {
  hp: number; speed: number; damage: number;
  attackCD: number; scale: number; score: number;
  skin: number; shirt: number; pants: number; eyes: number;
}
const VARIANTS: Record<ZombieKind, ZombieVariant> = {
  walker: { hp: 3,  speed: 2.2, damage: 12, attackCD: 0.9, scale: 1,   score: 100, skin: 0x5a7a4a, shirt: 0x6b4a3a, pants: 0x3a3a4a, eyes: 0xff2222 },
  runner: { hp: 2,  speed: 4.6, damage: 8,  attackCD: 0.6, scale: 0.8, score: 150, skin: 0x8a6a3a, shirt: 0x4a3a5a, pants: 0x2a2a3a, eyes: 0xff8822 },
  brute:  { hp: 10, speed: 1.4, damage: 25, attackCD: 1.4, scale: 1.7, score: 300, skin: 0x3a5a2a, shirt: 0x5a2a2a, pants: 0x3a3a3a, eyes: 0xff0000 },
};

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
  shootShotgun() { this.noise(0.25, 0.6, 0, 900); this.tone("square", 120, 40, 0.18, 0.4); },
  shootSniper() { this.noise(0.3, 0.7, 0, 2200); this.tone("sawtooth", 220, 30, 0.25, 0.5); },
  reload() { this.tone("square", 400, 300, 0.08, 0.25); this.tone("square", 500, 400, 0.08, 0.25, 0.15); },
  zombieHit() { this.noise(0.1, 0.35, 0, 600); this.tone("sawtooth", 120, 60, 0.12, 0.3); },
  zombieDie() { this.tone("sawtooth", 200, 40, 0.4, 0.4); this.noise(0.3, 0.3, 0.05, 400); },
  playerHurt() { this.tone("sawtooth", 300, 80, 0.3, 0.5); this.noise(0.2, 0.4, 0, 800); },
  waveStart() { [220, 277, 330, 440].forEach((f, i) => this.tone("square", f, f, 0.15, 0.3, i * 0.12)); },
  empty() { this.tone("square", 200, 150, 0.05, 0.2); },
  pickup() { this.tone("square", 500, 800, 0.12, 0.3); this.tone("square", 800, 1200, 0.1, 0.25, 0.1); },
  weaponSwitch() { this.tone("square", 300, 350, 0.06, 0.2); this.tone("square", 350, 300, 0.06, 0.2, 0.08); },
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
      if (k === "1") game.switchWeapon(0);
      if (k === "2") game.switchWeapon(1);
      if (k === "3") game.switchWeapon(2);
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
    const wheel = (e: WheelEvent) => {
      if (!this.locked || game.state !== "playing") return;
      e.preventDefault();
      game.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    };
    const lockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      onLockChange(this.locked);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("mousemove", mouseMove);
    canvas.addEventListener("mousedown", mouseDown);
    document.addEventListener("mouseup", mouseUp);
    document.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("pointerlockchange", lockChange);
    this.cleanup = () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("mousemove", mouseMove);
      canvas.removeEventListener("mousedown", mouseDown);
      document.removeEventListener("mouseup", mouseUp);
      document.removeEventListener("wheel", wheel);
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
  kind: ZombieKind;
  hp: number;
  speed: number;
  damage: number;
  attackCD: number; attackCDMax: number;
  attackRange: number;
  radius: number;      // bullet hit-test radius (scales with size)
  alive: boolean;
  deathT: number;
  hitFlash: number;
  // body part references for animation
  leftArm: THREE.Mesh; rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh; rightLeg: THREE.Mesh;
  walkPhase: number;
}

// Shared geometries (built once) — materials stay per-zombie so hit flash is local
let zombieGeos: {
  torso: THREE.BoxGeometry; head: THREE.BoxGeometry; eye: THREE.BoxGeometry;
  arm: THREE.BoxGeometry; leg: THREE.BoxGeometry;
} | null = null;

function makeZombie(kind: ZombieKind): THREE.Group {
  if (!zombieGeos) {
    zombieGeos = {
      torso: new THREE.BoxGeometry(0.7, 0.9, 0.4),
      head: new THREE.BoxGeometry(0.45, 0.45, 0.45),
      eye: new THREE.BoxGeometry(0.08, 0.08, 0.05),
      arm: new THREE.BoxGeometry(0.22, 0.7, 0.22),
      leg: new THREE.BoxGeometry(0.26, 0.8, 0.26),
    };
  }
  const v = VARIANTS[kind];
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: v.skin });
  const shirt = new THREE.MeshLambertMaterial({ color: v.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: v.pants });

  // Torso
  const torso = new THREE.Mesh(zombieGeos.torso, shirt);
  torso.position.y = 1.15;
  g.add(torso);
  // Head
  const head = new THREE.Mesh(zombieGeos.head, skin);
  head.position.y = 1.85;
  g.add(head);
  // Eyes (glowing)
  const eyeMat = new THREE.MeshBasicMaterial({ color: v.eyes });
  const eyeL = new THREE.Mesh(zombieGeos.eye, eyeMat);
  eyeL.position.set(-0.1, 1.9, 0.23);
  const eyeR = new THREE.Mesh(zombieGeos.eye, eyeMat); eyeR.position.x = 0.1;
  g.add(eyeL, eyeR);
  // Arms (raised forward — classic zombie)
  const leftArm = new THREE.Mesh(zombieGeos.arm, skin);
  leftArm.position.set(-0.5, 1.4, 0.35);
  leftArm.rotation.x = -Math.PI / 2.2;
  const rightArm = new THREE.Mesh(zombieGeos.arm, skin);
  rightArm.position.set(0.5, 1.4, 0.35);
  rightArm.rotation.x = -Math.PI / 2.2;
  g.add(leftArm, rightArm);
  // Legs
  const leftLeg = new THREE.Mesh(zombieGeos.leg, pants);
  leftLeg.position.set(-0.18, 0.4, 0);
  const rightLeg = new THREE.Mesh(zombieGeos.leg, pants);
  rightLeg.position.set(0.18, 0.4, 0);
  g.add(leftLeg, rightLeg);

  // Variant silhouettes: runner leans forward, brute is bulky
  if (kind === "runner") { torso.rotation.x = 0.35; head.position.z = 0.12; }
  if (kind === "brute") { torso.scale.set(1.35, 1.1, 1.3); head.position.y = 1.95; }
  g.scale.setScalar(v.scale);

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
  weapon: 0,                                    // index into WEAPONS
  weapons: WEAPONS.map(() => ({ mag: 0, reserve: 0, owned: false })),
  reloading: false,
  reloadT: 0,
  fireT: 0,
  vy: 0,
  onGround: true,
  hurtFlash: 0,
  // fx
  hitMarkerT: 0,
  viewKick: 0,
  bobPhase: 0,
  // world
  zombies: [] as Zombie[],
  bullets: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; damage: number }[],
  pickups: [] as Pickup[],
  obstacles: [] as THREE.Mesh[],
  spawnQueue: 0,
  spawnT: 0,

  startGame() {
    AudioSys.init(); AudioSys.resume();
    this.score = 0; this.wave = 0; this.zombiesKilled = 0; this.time = 0;
    this.hp = 100; this.weapon = 0; this.reloading = false; this.reloadT = 0;
    this.weapons = WEAPONS.map((w, i) => ({ mag: i === 0 ? w.magSize : 0, reserve: i === 0 ? Infinity : 0, owned: i === 0 }));
    this.fireT = 0; this.vy = 0; this.onGround = true; this.hurtFlash = 0;
    this.hitMarkerT = 0; this.viewKick = 0; this.bobPhase = 0;
    this.zombies.forEach(z => scene.remove(z.group));
    this.zombies = [];
    this.bullets.forEach(b => scene.remove(b.mesh));
    this.bullets = [];
    this.pickups.forEach(p => scene.remove(p.mesh));
    this.pickups = [];
    this.spawnQueue = 0; this.spawnT = 0;
    player.position.set(0, PLAYER_HEIGHT, 0);
    player.vel.set(0, 0, 0);
    yaw = 0; pitch = 0;
    this.state = "playing";
    this.waveBreakT = 1.5; // short delay before wave 1
    spawnStartPickups();
    hideAllScreens();
    updateHUD();
  },
  reload() {
    const ammo = this.weapons[this.weapon];
    const w = WEAPONS[this.weapon];
    if (this.reloading || ammo.mag === w.magSize || ammo.reserve <= 0 || this.state !== "playing") return;
    this.reloading = true;
    this.reloadT = w.reloadTime;
    AudioSys.reload();
  },
  switchWeapon(i: number) {
    if (this.state !== "playing" || i === this.weapon || !this.weapons[i]?.owned) return;
    this.weapon = i;
    this.reloading = false; // cancel any reload on switch
    this.fireT = Math.max(this.fireT, 0.2); // short switch delay
    AudioSys.weaponSwitch();
    updateHUD();
  },
  cycleWeapon(dir: number) {
    const owned = this.weapons.map((w, i) => i).filter(i => this.weapons[i].owned);
    if (owned.length < 2) return;
    const pos = owned.indexOf(this.weapon);
    this.switchWeapon(owned[(pos + dir + owned.length) % owned.length]);
  },
  toggleMute() {
    AudioSys.init();
    AudioSys.setMuted(!AudioSys.muted);
    const btn = document.getElementById("wwz-mute");
    if (btn) btn.innerHTML = AudioSys.muted ? "&#128263;" : "&#128266;";
  },
  gameOver() {
    this.state = "gameover";
    this.hitMarkerT = 0;
    AudioSys.playerHurt();
    const el = document.getElementById("wwz-stats");
    if (el) el.innerHTML = `Score: ${this.score} &nbsp; Waves: ${this.wave} &nbsp; Zombies: ${this.zombiesKilled}`;
    show("wwz-screen-gameover");
    updateHUD();
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
      if (this.onGround) this.bobPhase += dt * 9; // viewmodel walk bob
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
    const w = WEAPONS[this.weapon];
    const ammo = this.weapons[this.weapon];
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloading = false;
        const take = Math.min(w.magSize - ammo.mag, ammo.reserve);
        ammo.mag += take; ammo.reserve -= take; // rifle reserve stays Infinity
        updateHUD();
      }
    } else if (Input.shooting && this.fireT <= 0) {
      if (ammo.mag > 0) {
        this.fireT = w.fireRate;
        ammo.mag--;
        this.viewKick = w.recoil;
        if (this.weapon === 1) AudioSys.shootShotgun();
        else if (this.weapon === 2) AudioSys.shootSniper();
        else AudioSys.shoot();
        spawnMuzzleFlash(w);
        // Projectiles from camera center (shotgun fires a pellet spread;
        // pellets die quickly so shotgun damage falls off with distance)
        const baseDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const origin = camera.position.clone().addScaledVector(baseDir, 0.5);
        origin.y -= 0.15;
        for (let p = 0; p < w.pellets; p++) {
          const dir = baseDir.clone();
          if (w.spread > 0) {
            tmpAxis.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
            dir.applyAxisAngle(tmpAxis, (Math.random() - 0.5) * w.spread * 2);
          }
          const mesh = new THREE.Mesh(bulletGeo, tracerMats[this.weapon]);
          mesh.position.copy(origin);
          scene.add(mesh);
          this.bullets.push({ mesh, vel: dir.multiplyScalar(w.bulletSpeed), life: w.bulletLife, damage: w.damage });
        }
        updateHUD();
      } else {
        AudioSys.empty();
        this.fireT = 0.25;
        this.reload();
      }
    }

    // --- Viewmodel (recoil kick + walk bob + reload tilt) ---
    this.viewKick = Math.max(0, this.viewKick - dt * 5);
    const vm = viewmodels[this.weapon];
    if (vm) {
      vm.position.set(VM_POS_X, VM_POS_Y + Math.sin(this.bobPhase) * 0.012, VM_POS_Z + this.viewKick * 0.6);
      vm.rotation.x = -this.viewKick * 0.8 - (this.reloading ? 0.4 : 0);
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
        const dy = b.mesh.position.y - (zp.y + 1.2 * VARIANTS[z.kind].scale);
        const dz = b.mesh.position.z - zp.z;
        if (dx * dx + dy * dy + dz * dz < z.radius * z.radius) {
          z.hp -= b.damage;
          z.hitFlash = 0.1;
          this.hitMarkerT = 0.12;
          hit = true;
          if (z.hp <= 0) {
            z.alive = false;
            z.deathT = 0;
            this.zombiesKilled++;
            this.score += VARIANTS[z.kind].score;
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
        spawnBreakPickups(); // crates/ammo/health appear between waves
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

    // --- Pickups (bob + walk-over pickup) ---
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.bob += dt;
      p.mesh.position.y = 0.14 + Math.sin(p.bob * 3) * 0.1;
      p.mesh.rotation.y += dt * 1.2;
      const dxp = player.position.x - p.mesh.position.x;
      const dzp = player.position.z - p.mesh.position.z;
      if (dxp * dxp + dzp * dzp < PICKUP_RANGE * PICKUP_RANGE && player.position.y < PLAYER_HEIGHT + 1) {
        applyPickup(p.kind);
        scene.remove(p.mesh);
        this.pickups.splice(i, 1);
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
      if (dist > z.attackRange) {
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
          z.attackCD = z.attackCDMax;
          this.hp -= z.damage;
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
let tracerMats: THREE.MeshBasicMaterial[] = [];   // per-weapon bullet tracers
let muzzleLight: THREE.PointLight;
let muzzleT = 0;
let viewmodels: THREE.Group[] = [];               // weapon viewmodels (camera children)
const tmpAxis = new THREE.Vector3();              // scratch for shot spread
const VM_POS_X = 0.28, VM_POS_Y = -0.24, VM_POS_Z = -0.5; // viewmodel anchor (camera space)

function buildWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 30, 90);

  camera = new THREE.PerspectiveCamera(75, 960 / 540, 0.1, 200);
  scene.add(camera); // camera children (viewmodels) render in front of everything

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

  // Bullets: shared geometry, one tracer material per weapon
  bulletGeo = new THREE.SphereGeometry(0.08, 6, 6);
  tracerMats = WEAPONS.map(w => new THREE.MeshBasicMaterial({ color: w.tracerColor }));

  // Weapon viewmodels (camera children; visibility toggled in updateHUD)
  viewmodels = [];
  const gunMetal = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const gunWood = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const mkPart = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };
  // Rifle: long slim barrel + wooden stock + magazine
  const rifle = new THREE.Group();
  rifle.add(mkPart(0.06, 0.06, 0.55, 0, 0, -0.3, gunMetal), mkPart(0.07, 0.1, 0.22, 0, -0.06, 0.12, gunWood), mkPart(0.05, 0.16, 0.06, 0, -0.13, -0.05, gunMetal));
  // Shotgun: wide short barrel + pump grip
  const shotgun = new THREE.Group();
  shotgun.add(mkPart(0.1, 0.09, 0.42, 0, 0, -0.25, gunMetal), mkPart(0.09, 0.07, 0.16, 0, -0.08, -0.05, gunWood), mkPart(0.08, 0.11, 0.2, 0, -0.05, 0.14, gunWood));
  // Sniper: very long barrel + scope on top
  const sniper = new THREE.Group();
  sniper.add(mkPart(0.05, 0.05, 0.7, 0, 0.02, -0.42, gunMetal), mkPart(0.07, 0.09, 0.3, 0, -0.05, 0.1, gunMetal));
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), gunMetal);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.09, -0.12);
  sniper.add(scope);
  for (const vm of [rifle, shotgun, sniper]) {
    vm.position.set(VM_POS_X, VM_POS_Y, VM_POS_Z);
    vm.visible = false;
    camera.add(vm);
    viewmodels.push(vm);
  }

  player = { position: new THREE.Vector3(0, PLAYER_HEIGHT, 0), vel: new THREE.Vector3() };
}

function pickZombieKind(): ZombieKind {
  // Runners from wave 3, brutes from wave 5 — odds grow with wave number
  const w = game.wave;
  const r = Math.random();
  if (w >= 5 && r < Math.min(0.22, 0.06 + (w - 5) * 0.04)) return "brute";
  if (w >= 3 && r < Math.min(0.4, 0.12 + (w - 3) * 0.06)) return "runner";
  return "walker";
}

function spawnZombie() {
  const kind = pickZombieKind();
  const v = VARIANTS[kind];
  const group = makeZombie(kind);
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
  const speed = v.speed + game.wave * 0.1 + Math.random() * 0.4;
  game.zombies.push({
    group, kind, hp: v.hp, speed, damage: v.damage,
    attackCD: 0, attackCDMax: v.attackCD,
    attackRange: ZOMBIE_ATTACK_RANGE * v.scale,
    radius: 1.1 * v.scale,
    alive: true, deathT: 0, hitFlash: 0,
    leftArm: group.children[4] as THREE.Mesh, rightArm: group.children[5] as THREE.Mesh,
    leftLeg: group.children[6] as THREE.Mesh, rightLeg: group.children[7] as THREE.Mesh,
    walkPhase: Math.random() * 10,
  });
}

function spawnMuzzleFlash(w: WeaponDef) {
  muzzleT = w.flashDur;
  muzzleLight.position.copy(camera.position);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  muzzleLight.position.addScaledVector(dir, 1);
  muzzleLight.color.setHex(w.flashColor);
  muzzleLight.intensity = w.flashIntensity;
}

/* ================= PICKUPS ================= */
type PickupKind = "shotgun" | "sniper" | "ammo" | "health";
interface Pickup { mesh: THREE.Group; kind: PickupKind; bob: number; }

// Shared pickup geometry + one material pair per kind
let pickupGeos: { crate: THREE.BoxGeometry; band: THREE.BoxGeometry } | null = null;
const pickupMats: Record<PickupKind, THREE.MeshLambertMaterial> = {
  shotgun: new THREE.MeshLambertMaterial({ color: 0x8a5a2a }),
  sniper: new THREE.MeshLambertMaterial({ color: 0x2a4a7a }),
  ammo: new THREE.MeshLambertMaterial({ color: 0x3a6a3a }),
  health: new THREE.MeshLambertMaterial({ color: 0xdddddd }),
};
const pickupBandMats: Record<PickupKind, THREE.MeshLambertMaterial> = {
  shotgun: new THREE.MeshLambertMaterial({ color: 0xff8833 }),
  sniper: new THREE.MeshLambertMaterial({ color: 0x66ddff }),
  ammo: new THREE.MeshLambertMaterial({ color: 0xffdd44 }),
  health: new THREE.MeshLambertMaterial({ color: 0xff3333 }),
};

function makePickup(kind: PickupKind): THREE.Group {
  if (!pickupGeos) {
    pickupGeos = { crate: new THREE.BoxGeometry(0.7, 0.5, 0.5), band: new THREE.BoxGeometry(0.72, 0.12, 0.52) };
  }
  const g = new THREE.Group();
  const crate = new THREE.Mesh(pickupGeos.crate, pickupMats[kind]);
  crate.position.y = 0.25;
  const band = new THREE.Mesh(pickupGeos.band, pickupBandMats[kind]);
  band.position.y = 0.25;
  g.add(crate, band);
  return g;
}

function spawnPickup(kind: PickupKind) {
  const g = makePickup(kind);
  // Random spot away from the player and clear of obstacles
  let x = 0, z = 0;
  for (let tries = 0; tries < 20; tries++) {
    x = (Math.random() - 0.5) * (ARENA * 2 - 10);
    z = (Math.random() - 0.5) * (ARENA * 2 - 10);
    const d = Math.hypot(x - player.position.x, z - player.position.z);
    if (d > 8 && game.obstacles.every(o => Math.hypot(x - o.position.x, z - o.position.z) > 2.5)) break;
  }
  g.position.set(x, 0, z);
  scene.add(g);
  game.pickups.push({ mesh: g, kind, bob: Math.random() * 10 });
}

function spawnStartPickups() {
  if (!game.weapons[1].owned) spawnPickup("shotgun");
  spawnPickup("ammo");
  spawnPickup("health");
}

function spawnBreakPickups() {
  // Weapon crates for guns not yet owned; otherwise ammo/health supplies
  if (!game.weapons[1].owned && !game.pickups.some(p => p.kind === "shotgun")) spawnPickup("shotgun");
  if (!game.weapons[2].owned && game.wave >= 3 && !game.pickups.some(p => p.kind === "sniper")) spawnPickup("sniper");
  spawnPickup("ammo");
  spawnPickup(game.hp < 60 || Math.random() < 0.5 ? "health" : "ammo");
}

function applyPickup(kind: PickupKind) {
  AudioSys.pickup();
  if (kind === "shotgun" || kind === "sniper") {
    const i = kind === "shotgun" ? 1 : 2;
    const wasOwned = game.weapons[i].owned;
    game.weapons[i].owned = true;
    game.weapons[i].reserve = Math.min(WEAPONS[i].reserveMax, game.weapons[i].reserve + WEAPONS[i].magSize * 3);
    if (!wasOwned) { game.switchWeapon(i); pickupMsg(`PICKED UP ${WEAPONS[i].name} — PRESS ${i + 1}`); }
    else pickupMsg(`+${WEAPONS[i].magSize * 3} ${WEAPONS[i].name} AMMO`);
  } else if (kind === "ammo") {
    for (let i = 0; i < WEAPONS.length; i++) {
      if (game.weapons[i].owned) game.weapons[i].reserve = Math.min(WEAPONS[i].reserveMax, game.weapons[i].reserve + WEAPONS[i].magSize * 2);
    }
    pickupMsg("+AMMO FOR ALL WEAPONS");
  } else {
    game.hp = Math.min(100, game.hp + 30);
    pickupMsg("+30 HP");
  }
  updateHUD();
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
.wwz-hitmarker { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(45deg); width:26px; height:26px; z-index:4; pointer-events:none; opacity:0; transition:opacity 0.12s; }
.wwz-hitmarker::before, .wwz-hitmarker::after { content:''; position:absolute; background:#ff5555; }
.wwz-hitmarker::before { width:2px; height:26px; left:12px; top:0; }
.wwz-hitmarker::after { width:26px; height:2px; top:12px; left:0; }
.wwz-weapon-box { background:rgba(0,0,0,0.55); border:2px solid rgba(255,170,100,0.6); border-radius:8px; color:#fff; font-size:15px; font-weight:bold; padding:5px 14px; letter-spacing:1px; text-shadow:1px 1px 0 #000; display:flex; gap:14px; align-items:center; }
.wwz-weapon-name { color:#ffaa66; }
.wwz-weapon-slots { display:flex; gap:6px; }
.wwz-slot { background:rgba(255,255,255,0.15); border-radius:4px; padding:1px 7px; font-size:12px; opacity:0.4; }
.wwz-slot.owned { opacity:0.85; }
.wwz-slot.active { background:rgba(255,170,100,0.35); opacity:1; color:#ffdd44; }
.wwz-pickup-msg { position:absolute; bottom:18%; left:0; right:0; text-align:center; font-family:'Courier New',monospace; font-size:clamp(14px,2.4vw,20px); font-weight:bold; color:#ffdd44; text-shadow:2px 2px 0 #000; z-index:6; pointer-events:none; opacity:0; transition:opacity 0.3s; letter-spacing:2px; }
.wwz-pickup-msg.show { opacity:1; }
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
    </div>
    <div class="wwz-weapon-box">
      <span class="wwz-weapon-name" id="wwz-weapon">RIFLE</span>
      <span id="wwz-ammo">30</span>
      <span class="wwz-weapon-slots">
        <span class="wwz-slot owned active" id="wwz-slot-0">1</span>
        <span class="wwz-slot" id="wwz-slot-1">2</span>
        <span class="wwz-slot" id="wwz-slot-2">3</span>
      </span>
    </div>
    <button id="wwz-mute" class="wwz-mute" title="Mute (M)">&#128266;</button>`;
  container.appendChild(hud);

  const crosshair = document.createElement("div");
  crosshair.className = "wwz-crosshair";
  container.appendChild(crosshair);

  const hitmarker = document.createElement("div");
  hitmarker.className = "wwz-hitmarker";
  hitmarker.id = "wwz-hitmarker";
  container.appendChild(hitmarker);

  const vignette = document.createElement("div");
  vignette.className = "wwz-damage-vignette";
  vignette.id = "wwz-vignette";
  container.appendChild(vignette);

  const waveBanner = document.createElement("div");
  waveBanner.className = "wwz-wave-banner";
  waveBanner.id = "wwz-wave-banner";
  container.appendChild(waveBanner);

  const pickupMsgEl = document.createElement("div");
  pickupMsgEl.className = "wwz-pickup-msg";
  pickupMsgEl.id = "wwz-pickup-msg";
  container.appendChild(pickupMsgEl);

  const aimHint = document.createElement("div");
  aimHint.className = "wwz-aim-hint";
  aimHint.id = "wwz-aim-hint";
  aimHint.textContent = "Click to start — WASD move, Mouse aim, Click shoot, R reload, 1/2/3 weapons";
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
    <p>Each wave brings more zombies — fast runners and armored brutes join later.</p>
    <p>Grab weapon crates, ammo and medkits between waves.</p>
    <button class="big-btn" id="wwz-btn-start">START</button>
    <div class="keys">
      <b>WASD / Arrows</b> move &nbsp; &middot; &nbsp; <b>Mouse</b> aim &nbsp; &middot; &nbsp; <b>Click</b> shoot<br>
      <b>Space</b> jump &nbsp; &middot; &nbsp; <b>R</b> reload &nbsp; &middot; &nbsp; <b>1/2/3 / Wheel</b> weapons &nbsp; &middot; &nbsp; <b>M</b> mute
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
function pickupMsg(text: string) {
  const el = document.getElementById("wwz-pickup-msg");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}
function updateHUD() {
  const set = (id: string, v: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set("wwz-score", game.score);
  set("wwz-wave", game.wave);
  const ammo = game.weapons[game.weapon];
  const w = WEAPONS[game.weapon];
  set("wwz-weapon", w.name);
  const reserve = ammo.reserve === Infinity ? "\u221e" : ammo.reserve;
  set("wwz-ammo", game.reloading ? "..." : `${ammo.mag}/${reserve}`);
  WEAPONS.forEach((_, i) => {
    const el = document.getElementById("wwz-slot-" + i);
    if (el) el.className = "wwz-slot" + (game.weapons[i].owned ? " owned" : "") + (i === game.weapon ? " active" : "");
  });
  // Only the equipped owned weapon shows its viewmodel
  viewmodels.forEach((vm, i) => { vm.visible = game.state === "playing" && game.weapons[i].owned && i === game.weapon; });
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

  // Cached fx elements (toggled per-frame below)
  const hitMarkerEl = document.getElementById("wwz-hitmarker");
  const vignetteEl = document.getElementById("wwz-vignette");

  let raf = 0;
  let lastTime = 0;
  const loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0.016);
    lastTime = ts;
    game.update(dt);
    // Muzzle flash decay
    if (muzzleT > 0) { muzzleT -= dt; if (muzzleT <= 0) muzzleLight.intensity = 0; }
    // Hit marker flash
    if (game.hitMarkerT > 0) { game.hitMarkerT -= dt; hitMarkerEl?.classList.add("show"); }
    else if (hitMarkerEl?.classList.contains("show")) hitMarkerEl.classList.remove("show");
    // Damage vignette: hurt flash, plus low-HP pulse
    if (vignetteEl) {
      const lowHp = game.state === "playing" && game.hp < 30;
      vignetteEl.style.opacity = game.hurtFlash > 0 ? "1" : lowHp ? String(0.35 + Math.sin(game.time * 6) * 0.12) : "0";
    }
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