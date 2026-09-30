/* =====================================================================
   WORLD WAR Z — Simple 3D Zombie Survival (Three.js)
   FPS: WASD move, mouse look, click to shoot, survive waves.
   All geometry is procedural (capsules/spheres/cylinders + canvas textures)
   — no external assets. Three chapters (ruined city, dark forest, military base),
    5 waves each, with a continuous day/night cycle across all levels.
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
const DAY_LENGTH = 240;      // seconds per full day/night cycle (~4 minutes)
const NIGHT_SPAWN_MULT = 1.25; // night waves spawn ~25% more zombies
const MEDKIT_MAX = 5;          // medkits carried at once (Q or inventory row to use)
const MEDKIT_HEAL = 30;        // HP restored per medkit
const ROCKET_SPLASH_DMG = 2;   // splash damage to every zombie inside the blast radius
const WAVES_PER_LEVEL = 5;     // waves per chapter; clearing all 5 advances to the next level
/* Chapters: light multiplier + fog distances per level (world rebuilds between levels) */
const LEVELS = [
  { name: "YIKIK ŞEHİR", lightMul: 1, fogNear: 30, fogFar: 110 },
  { name: "KARANLIK ORMAN", lightMul: 0.6, fogNear: 18, fogFar: 70 },
  { name: "ASKERİ ÜS", lightMul: 0.85, fogNear: 26, fogFar: 95 },
];

/* Weapons: rifle / shotgun / sniper / smg / rocket launcher (switch with 1-5 or mouse wheel) */
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
  splash?: number;     // blast radius (m) — rockets detonate on impact/timeout
}
const WEAPONS: WeaponDef[] = [
  { name: "RIFLE",   fireRate: 0.18, magSize: 30, reloadTime: 1.6, pellets: 1, spread: 0.012, damage: 1, bulletSpeed: 90,  bulletLife: 2,    tracerColor: 0xffdd44, flashColor: 0xffaa33, flashIntensity: 3, flashDur: 0.06, reserveMax: Infinity, recoil: 0.05 },
  { name: "SHOTGUN", fireRate: 0.9,  magSize: 8,  reloadTime: 2.2, pellets: 8, spread: 0.1,   damage: 1, bulletSpeed: 75,  bulletLife: 0.35, tracerColor: 0xffaa66, flashColor: 0xff7722, flashIntensity: 5, flashDur: 0.09, reserveMax: 40,       recoil: 0.14 },
  { name: "SNIPER",  fireRate: 1.2,  magSize: 5,  reloadTime: 2.4, pellets: 1, spread: 0.002, damage: 3, bulletSpeed: 160, bulletLife: 1.2,  tracerColor: 0x66ddff, flashColor: 0x88ccff, flashIntensity: 6, flashDur: 0.1,  reserveMax: 24,       recoil: 0.2 },
  { name: "SMG",     fireRate: 0.08, magSize: 40, reloadTime: 1.5, pellets: 1, spread: 0.03,  damage: 1, bulletSpeed: 80,  bulletLife: 1.6,  tracerColor: 0xffee77, flashColor: 0xffbb44, flashIntensity: 2.5, flashDur: 0.05, reserveMax: 200,      recoil: 0.04 },
  { name: "ROCKET",  fireRate: 1.8,  magSize: 1,  reloadTime: 2.8, pellets: 1, spread: 0,     damage: 3, bulletSpeed: 45,  bulletLife: 3,    tracerColor: 0xff8833, flashColor: 0xff6622, flashIntensity: 5, flashDur: 0.12, reserveMax: 12,       recoil: 0.25, splash: 4 },
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
  shootSMG() { this.noise(0.09, 0.4, 0, 2400); this.tone("square", 220, 90, 0.07, 0.25); },
  shootRocket() { this.noise(0.3, 0.45, 0, 500); this.tone("sawtooth", 90, 300, 0.25, 0.3); },
  explosion() { this.noise(0.6, 0.8, 0, 300); this.tone("sawtooth", 120, 20, 0.5, 0.6); },
  medkit() { this.tone("square", 500, 700, 0.1, 0.25); this.tone("square", 700, 900, 0.12, 0.2, 0.1); },
  reload() { this.tone("square", 400, 300, 0.08, 0.25); this.tone("square", 500, 400, 0.08, 0.25, 0.15); },
  zombieHit() { this.noise(0.1, 0.35, 0, 600); this.tone("sawtooth", 120, 60, 0.12, 0.3); },
  zombieDie() { this.tone("sawtooth", 200, 40, 0.4, 0.4); this.noise(0.3, 0.3, 0.05, 400); },
  playerHurt() { this.tone("sawtooth", 300, 80, 0.3, 0.5); this.noise(0.2, 0.4, 0, 800); },
  waveStart() { [220, 277, 330, 440].forEach((f, i) => this.tone("square", f, f, 0.15, 0.3, i * 0.12)); },
  victory() { [330, 440, 550, 660, 880].forEach((f, i) => this.tone("square", f, f, 0.3, 0.3, i * 0.18)); }, // ascending fanfare
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
      if (["w", "a", "s", "d", " ", "tab", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
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
      if (k === "4") game.switchWeapon(3);
      if (k === "5") game.switchWeapon(4);
      if (k === "q") game.useMedkit();
      if (k === "tab" || k === "b") game.toggleInventory();
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
  // eye material (per-zombie) — eyes glow brighter at night
  eyeMat: THREE.MeshBasicMaterial; eyeBase: THREE.Color;
}

// Shared geometries (built once) — materials stay per-zombie so hit flash is local
let zombieGeos: {
  torso: THREE.CapsuleGeometry; head: THREE.SphereGeometry; eye: THREE.SphereGeometry;
  arm: THREE.CapsuleGeometry; leg: THREE.CapsuleGeometry;
} | null = null;

function makeZombie(kind: ZombieKind): THREE.Group {
  if (!zombieGeos) {
    zombieGeos = {
      torso: new THREE.CapsuleGeometry(0.34, 0.55, 4, 8),
      head: new THREE.SphereGeometry(0.27, 12, 10),
      eye: new THREE.SphereGeometry(0.055, 6, 6),
      // limbs pivot at shoulder/hip: geometry shifted down so swing rotation looks natural
      arm: new THREE.CapsuleGeometry(0.1, 0.5, 3, 6).translate(0, -0.3, 0),
      leg: new THREE.CapsuleGeometry(0.12, 0.55, 3, 6).translate(0, -0.35, 0),
    };
  }
  const v = VARIANTS[kind];
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: v.skin });
  const shirt = new THREE.MeshLambertMaterial({ color: v.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: v.pants });

  // Torso (rounded capsule)
  const torso = new THREE.Mesh(zombieGeos.torso, shirt);
  torso.position.y = 1.15;
  g.add(torso);
  // Head (sphere with a slight jaw)
  const head = new THREE.Mesh(zombieGeos.head, skin);
  head.position.y = 1.85;
  head.scale.set(1, 1.15, 0.95);
  g.add(head);
  // Eyes (glowing)
  const eyeMat = new THREE.MeshBasicMaterial({ color: v.eyes });
  const eyeL = new THREE.Mesh(zombieGeos.eye, eyeMat);
  eyeL.position.set(-0.1, 1.9, 0.22);
  const eyeR = new THREE.Mesh(zombieGeos.eye, eyeMat); eyeR.position.x = 0.1;
  g.add(eyeL, eyeR);
  // Arms (raised forward — classic zombie; pivot at shoulder)
  const leftArm = new THREE.Mesh(zombieGeos.arm, skin);
  leftArm.position.set(-0.45, 1.5, 0.05);
  leftArm.rotation.x = -Math.PI / 2.2;
  const rightArm = new THREE.Mesh(zombieGeos.arm, skin);
  rightArm.position.set(0.45, 1.5, 0.05);
  rightArm.rotation.x = -Math.PI / 2.2;
  g.add(leftArm, rightArm);
  // Legs (pivot at hip)
  const leftLeg = new THREE.Mesh(zombieGeos.leg, pants);
  leftLeg.position.set(-0.16, 0.85, 0);
  const rightLeg = new THREE.Mesh(zombieGeos.leg, pants);
  rightLeg.position.set(0.16, 0.85, 0);
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
  level: 1,                                       // current chapter (1..LEVELS.length)
  levelWave: 0,                                   // waves cleared inside the current chapter
  levelTransitionT: 0,                            // countdown to the next chapter's world build
  // player
  hp: 100,
  medkits: 1,                                   // Q / inventory row heals
  inventoryOpen: false,                         // Tab/B inventory panel
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
  bullets: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; damage: number; splash: number }[],
  fx: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[], // explosion debris
  pickups: [] as Pickup[],
  obstacles: [] as THREE.Object3D[], // meshes/groups with userData.r/h collision radii
  spawnQueue: 0,
  spawnT: 0,

  startGame() {
    AudioSys.init(); AudioSys.resume();
    this.score = 0; this.wave = 0; this.zombiesKilled = 0; this.time = 0;
    this.hp = 100; this.medkits = 1; this.weapon = 0; this.reloading = false; this.reloadT = 0;
    this.weapons = WEAPONS.map((w, i) => ({ mag: i === 0 ? w.magSize : 0, reserve: i === 0 ? Infinity : 0, owned: i === 0 }));
    this.fireT = 0; this.vy = 0; this.onGround = true; this.hurtFlash = 0;
    this.hitMarkerT = 0; this.viewKick = 0; this.bobPhase = 0;
    this.zombies.forEach(z => scene.remove(z.group));
    this.zombies = [];
    this.bullets.forEach(b => scene.remove(b.mesh));
    this.bullets = [];
    this.fx.forEach(f => scene.remove(f.mesh));
    this.fx = [];
    this.pickups.forEach(p => scene.remove(p.mesh));
    this.pickups = [];
    this.spawnQueue = 0; this.spawnT = 0;
    this.level = 1; this.levelWave = 0; this.levelTransitionT = 0;
    applyLevel(1); // rebuild chapter 1 props/obstacles/fog/light on every (re)start
    player.position.set(0, PLAYER_HEIGHT, 0);
    player.vel.set(0, 0, 0);
    yaw = 0; pitch = 0;
    this.state = "playing";
    this.waveBreakT = 1.5; // short delay before wave 1
    spawnStartPickups();
    closeInventory(); // make sure the inventory panel is shut on (re)start
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
  useMedkit() {
    if (this.state !== "playing") return;
    if (this.medkits <= 0) { AudioSys.empty(); pickupMsg("NO MEDKITS LEFT"); return; }
    if (this.hp >= 100) { pickupMsg("HP ALREADY FULL"); return; }
    this.medkits--;
    this.hp = Math.min(100, this.hp + MEDKIT_HEAL);
    AudioSys.medkit();
    pickupMsg(`+${MEDKIT_HEAL} HP`);
    updateHUD();
  },
  toggleInventory() {
    if (this.state !== "playing") return;
    this.inventoryOpen = !this.inventoryOpen;
    const el = document.getElementById("wwz-inventory");
    if (el) el.classList.toggle("hidden", !this.inventoryOpen);
    if (this.inventoryOpen) {
      updateInventory();
      if (document.pointerLockElement) document.exitPointerLock(); // unlock so rows are clickable
    } else {
      canvasEl?.requestPointerLock(); // closing via Tab/B re-locks cleanly
    }
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
    closeInventory(); // hide the inventory panel on gameover
    show("wwz-screen-gameover");
    updateHUD();
    if (document.pointerLockElement) document.exitPointerLock();
  },
  victory() {
    this.state = "victory";
    this.hitMarkerT = 0;
    AudioSys.victory();
    const el = document.getElementById("wwz-victory-stats");
    if (el) el.innerHTML = `Score: ${this.score} &nbsp; Waves: ${this.wave} &nbsp; Zombies: ${this.zombiesKilled}`;
    closeInventory(); // hide the inventory panel on victory
    show("wwz-screen-victory");
    updateHUD();
    if (document.pointerLockElement) document.exitPointerLock();
  },
  advanceLevel() {
    this.level++;
    this.levelWave = 0;
    this.levelTransitionT = 0;
    this.pickups.forEach(p => scene.remove(p.mesh)); // old pickups sit in the old world — clear them
    this.pickups = [];
    applyLevel(this.level); // rebuild props/obstacles/fog/light for the new chapter
    player.position.set(0, PLAYER_HEIGHT, 0);
    player.vel.set(0, 0, 0);
    this.vy = 0; this.onGround = true;
    this.waveBreakT = 2.5; // short breather before the first wave of the new chapter
    spawnPickup("ammo");
    spawnPickup("health");
    showBanner(`BÖLÜM ${this.level} — ${LEVELS[this.level - 1].name}`, 3000);
  },
  addWave() {
    this.wave++;
    this.levelWave++;
    this.spawnQueue = WAVE_ZOMBIE_BASE + (this.wave - 1) * WAVE_ZOMBIE_PER_WAVE;
    if (nightF > 0.5) this.spawnQueue = Math.ceil(this.spawnQueue * NIGHT_SPAWN_MULT); // night horde is thicker
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
    // Obstacle collision (simple push-out; radius comes from userData)
    for (const o of this.obstacles) {
      const dxo = player.position.x - o.position.x;
      const dzo = player.position.z - o.position.z;
      const dist = Math.sqrt(dxo * dxo + dzo * dzo);
      const minDist = (o.userData.r as number) || 1.2;
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
        if (w.name === "SHOTGUN") AudioSys.shootShotgun();
        else if (w.name === "SNIPER") AudioSys.shootSniper();
        else if (w.name === "SMG") AudioSys.shootSMG();
        else if (w.name === "ROCKET") AudioSys.shootRocket();
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
          const mesh = new THREE.Mesh(w.splash ? rocketGeo : bulletGeo, tracerMats[this.weapon]);
          mesh.position.copy(origin);
          if (w.splash) mesh.quaternion.setFromUnitVectors(FWD, dir); // rocket nose points along its flight path
          scene.add(mesh);
          this.bullets.push({ mesh, vel: dir.multiplyScalar(w.bulletSpeed), life: w.bulletLife, damage: w.damage, splash: w.splash || 0 });
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
          hit = true;
          damageZombie(z, b.damage);
          break;
        }
      }
      // Hit obstacle? (uses per-obstacle collision radius/height)
      if (!hit) {
        for (const o of this.obstacles) {
          const dx = b.mesh.position.x - o.position.x;
          const dz = b.mesh.position.z - o.position.z;
          const dy = b.mesh.position.y - o.position.y;
          const r = (o.userData.r as number) || 1.58;
          const h = (o.userData.h as number) || 3;
          if (dx * dx + dz * dz < r * r && Math.abs(dy) < h) { hit = true; break; }
        }
      }
      if (hit || b.life <= 0 || Math.abs(b.mesh.position.x) > ARENA + 5 || Math.abs(b.mesh.position.z) > ARENA + 5) {
        if (b.splash > 0) explode(b.mesh.position, b.splash); // rockets detonate on impact (or when they expire)
        scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // --- Explosion debris (gravity + shrink) ---
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      f.vel.y -= GRAVITY * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.scale.setScalar(Math.min(1, Math.max(0.05, f.life * 2)));
      if (f.life <= 0 || f.mesh.position.y < 0.05) { scene.remove(f.mesh); this.fx.splice(i, 1); }
    }

    // --- Wave / level progression ---
    if (this.levelTransitionT > 0) {
      this.levelTransitionT -= dt;
      if (this.levelTransitionT <= 0) this.advanceLevel();
    } else if (this.zombies.filter(z => z.alive).length === 0 && this.spawnQueue === 0) {
      if (this.waveBreakT <= 0) {
        if (this.levelWave >= WAVES_PER_LEVEL) {
          if (this.level < LEVELS.length) {
            this.levelTransitionT = 4; // pause, then rebuild the world for the next chapter
            showBanner(`BÖLÜM ${this.level} TAMAMLANDI`, 4000);
          } else {
            this.victory(); return; // all three chapters cleared
          }
        } else {
          this.waveBreakT = WAVE_BREAK;
          showWaveBanner(this.wave + 1, true);
          spawnBreakPickups(); // crates/ammo/health appear between waves
        }
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
      z.eyeMat.color.copy(z.eyeBase).multiplyScalar(0.55 + 0.85 * nightF); // eyes glow brighter at night
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
let rocketGeo: THREE.CylinderGeometry;            // rocket projectile (shared)
let explosionGeo: THREE.SphereGeometry;           // explosion debris (shared)
let explosionMats: THREE.MeshBasicMaterial[] = []; // orange/yellow/gray debris chunks
let tracerMats: THREE.MeshBasicMaterial[] = [];   // per-weapon bullet tracers
let muzzleLight: THREE.PointLight;
let muzzleT = 0;
let viewmodels: THREE.Group[] = [];               // weapon viewmodels (camera children)
const tmpAxis = new THREE.Vector3();              // scratch for shot spread
const FWD = new THREE.Vector3(0, 0, 1);           // scratch for rocket orientation
const VM_POS_X = 0.28, VM_POS_Y = -0.24, VM_POS_Z = -0.5; // viewmodel anchor (camera space)
// Day/night cycle state (lerped every frame in updateDayNight)
let sunLight: THREE.DirectionalLight;             // sun by day, dim blue moonlight by night
let hemiLight: THREE.HemisphereLight;
let ambientLight: THREE.AmbientLight;
let moonMesh: THREE.Mesh;                         // visible at night
let moonMat: THREE.MeshBasicMaterial;
let stars: THREE.Points;                          // visible at night
let starsMat: THREE.PointsMaterial;
let lampMat: THREE.MeshLambertMaterial;           // shared emissive lamp-head material
let lampLights: THREE.PointLight[] = [];          // only a few real lamp lights (perf)
let windowMats: THREE.MeshLambertMaterial[] = []; // building window strips (emissive at night)
let bgColor: THREE.Color;                         // sky background (fog color follows)
let nightF = 0;                                   // 0 = full day, 1 = full night
let lastDayNight = "";                            // cached HUD indicator text
const tmpSkyA = new THREE.Color(), tmpSkyB = new THREE.Color(); // sky/sun color lerp scratch

/* ================= DAY/NIGHT CYCLE ================= */
interface SkyKey { label: string; sky: number; sun: number; sunI: number; hemiI: number; ambI: number; night: number; }
// Keyframes around the cycle: t=0 dawn -> day -> dusk -> night -> wraps back to dawn
const SKY_KEYS: SkyKey[] = [
  { label: "DAWN",  sky: 0x5a3a4a, sun: 0xff9a66, sunI: 0.55, hemiI: 0.7,  ambI: 0.9,  night: 0.3 },
  { label: "DAY",   sky: 0x87a6c8, sun: 0xfff2cc, sunI: 1.0,  hemiI: 1.0,  ambI: 1.2,  night: 0 },
  { label: "DUSK",  sky: 0x4a2a3a, sun: 0xff6644, sunI: 0.45, hemiI: 0.6,  ambI: 0.8,  night: 0.5 },
  { label: "NIGHT", sky: 0x0d0d1e, sun: 0x8899ff, sunI: 0.3,  hemiI: 0.35, ambI: 0.5,  night: 1 },
];

function updateDayNight() {
  const t = (game.time % DAY_LENGTH) / DAY_LENGTH;
  const s = t * SKY_KEYS.length;
  const i = Math.floor(s) % SKY_KEYS.length;
  const f = s - Math.floor(s);
  const k = f * f * (3 - 2 * f); // smoothstep between keyframes
  const a = SKY_KEYS[i], b = SKY_KEYS[(i + 1) % SKY_KEYS.length];
  nightF = a.night + (b.night - a.night) * k;
  // Sky background + fog color lerp together
  bgColor.copy(tmpSkyA.setHex(a.sky).lerp(tmpSkyB.setHex(b.sky), k));
  (scene.fog as THREE.Fog).color.copy(bgColor);
  // Sun orbits the arena; at night it becomes dim blue moonlight
  const ang = t * Math.PI * 2;
  sunLight.position.set(Math.cos(ang) * 80, Math.sin(ang) * 70, 25);
  sunLight.color.copy(tmpSkyA.setHex(a.sun).lerp(tmpSkyB.setHex(b.sun), k));
  sunLight.intensity = (a.sunI + (b.sunI - a.sunI) * k) * levelLightMul; // chapter light multiplier
  hemiLight.intensity = (a.hemiI + (b.hemiI - a.hemiI) * k) * levelLightMul;
  ambientLight.intensity = (a.ambI + (b.ambI - a.ambI) * k) * levelLightMul;
  // Moon + stars fade in at night
  moonMesh.visible = stars.visible = nightF > 0.05;
  moonMat.opacity = nightF;
  starsMat.opacity = nightF * 0.9;
  // Street lamps + lit windows glow at night (emissive, cheap)
  lampMat.emissiveIntensity = nightF * 1.8;
  for (const l of lampLights) l.intensity = nightF * 1.4;
  for (const m of windowMats) m.emissiveIntensity = nightF * 1.3;
  // HUD day/night indicator (only touch the DOM when the text changes)
  const el = document.getElementById("wwz-daynight");
  if (el) {
    const icon = nightF > 0.5 ? "\u{1F319}" : "\u2600\uFE0F"; // 🌙 / ☀️
    const txt = icon + " " + SKY_KEYS[f < 0.5 ? i : (i + 1) % SKY_KEYS.length].label;
    if (txt !== lastDayNight) { el.textContent = txt; lastDayNight = txt; }
  }
}

/* Procedural canvas textures for the levels (no external assets) */
function makeGroundTexture(level: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const bases = ["#2b2b33", "#1d2416", "#33312a"]; // asphalt / forest floor / packed dirt
  g.fillStyle = bases[level - 1];
  g.fillRect(0, 0, 256, 256);
  // patches for subtle color variation
  for (let i = 0; i < 90; i++) {
    const shade = 30 + Math.floor(Math.random() * 24);
    const green = level === 2 ? 6 : 0;
    g.fillStyle = `rgb(${shade},${shade + green},${shade + 8})`;
    const w = 6 + Math.random() * 26;
    g.fillRect(Math.random() * 256, Math.random() * 256, w, w * (0.4 + Math.random() * 0.8));
  }
  if (level === 2) {
    // grass tufts as tiny strokes over the dirt
    g.strokeStyle = "rgba(70,110,50,0.5)";
    g.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 6, y - 4 - Math.random() * 5);
      g.stroke();
    }
  } else {
    // cracks on the paved/asphalt levels (1 & 3)
    g.strokeStyle = "rgba(15,15,20,0.6)";
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      let x = Math.random() * 256, y = Math.random() * 256;
      g.beginPath();
      g.moveTo(x, y);
      for (let seg = 0; seg < 5; seg++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

function makeWindowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000"; // emissiveMap: black = no glow
  g.fillRect(0, 0, 64, 128);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      if (Math.random() < 0.35) continue; // some windows dark/destroyed
      const warm = 150 + Math.floor(Math.random() * 105);
      g.fillStyle = `rgb(255,${warm},90)`;
      g.fillRect(6 + col * 14, 4 + row * 15, 9, 10);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* Per-level world content (props/materials/textures rebuilt on every chapter change) */
let levelProps: THREE.Object3D[] = [];  // meshes/groups/lights belonging to the current chapter
let levelMats: THREE.Material[] = [];   // level materials (disposed on chapter change)
let levelTexs: THREE.Texture[] = [];    // level textures, incl. window texture clones (disposed on chapter change)
let levelLightMul = 1;                  // chapter light multiplier (from LEVELS, applied in updateDayNight)
let sharedGeos: {                       // geometries created once in initWorld, reused by every level
  ground: THREE.PlaneGeometry; unitBox: THREE.BoxGeometry;
  carBody: THREE.BoxGeometry; carTop: THREE.BoxGeometry; wheel: THREE.CylinderGeometry;
  barrel: THREE.CylinderGeometry; fence: THREE.BoxGeometry; pole: THREE.CylinderGeometry;
  lampHead: THREE.SphereGeometry; debris: THREE.BoxGeometry; pipe: THREE.CylinderGeometry;
  trunk: THREE.CylinderGeometry; cone: THREE.ConeGeometry; foliage: THREE.SphereGeometry;
  log: THREE.CylinderGeometry; rock: THREE.DodecahedronGeometry;
  towerLeg: THREE.CylinderGeometry; towerRoof: THREE.ConeGeometry;
};

function mkLevelMat(opts: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial(opts);
  levelMats.push(m);
  return m;
}
function mkLevelTex(t: THREE.Texture): THREE.Texture {
  levelTexs.push(t);
  return t;
}
function addLevelProp(o: THREE.Object3D, collide = false) {
  scene.add(o);
  levelProps.push(o);
  if (collide) game.obstacles.push(o);
}

function initWorld() {
  scene = new THREE.Scene();
  bgColor = new THREE.Color(0x5a3a4a); // cycle starts at dawn
  scene.background = bgColor;
  scene.fog = new THREE.Fog(bgColor.getHex(), 30, 110);

  camera = new THREE.PerspectiveCamera(75, 960 / 540, 0.1, 200);
  scene.add(camera); // camera children (viewmodels) render in front of everything

  // Lights: sun (color/intensity lerps through day/night), hemisphere + ambient fill
  sunLight = new THREE.DirectionalLight(0xff9a66, 0.55);
  sunLight.position.set(80, 10, 25);
  scene.add(sunLight);
  hemiLight = new THREE.HemisphereLight(0x87a6c8, 0x3a3a30, 0.7);
  scene.add(hemiLight);
  ambientLight = new THREE.AmbientLight(0x404060, 0.9);
  scene.add(ambientLight);
  muzzleLight = new THREE.PointLight(0xffaa33, 0, 8);
  scene.add(muzzleLight);

  // Shared geometry (created once; every level scales/reuses these)
  sharedGeos = {
    ground: new THREE.PlaneGeometry(ARENA * 2, ARENA * 2, 30, 30),
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    carBody: new THREE.BoxGeometry(2.2, 0.6, 4.4),
    carTop: new THREE.BoxGeometry(1.8, 0.55, 2.2),
    wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.28, 10),
    barrel: new THREE.CylinderGeometry(0.38, 0.42, 1.05, 10),
    fence: new THREE.BoxGeometry(3.2, 1.1, 0.12),
    pole: new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6),
    lampHead: new THREE.SphereGeometry(0.18, 8, 6),
    debris: new THREE.BoxGeometry(0.6, 0.18, 0.8),
    pipe: new THREE.CylinderGeometry(0.12, 0.14, 1.1, 6),
    trunk: new THREE.CylinderGeometry(0.18, 0.3, 1, 7),
    cone: new THREE.ConeGeometry(1, 2, 8),
    foliage: new THREE.SphereGeometry(1, 8, 6),
    log: new THREE.CylinderGeometry(0.32, 0.32, 3, 8),
    rock: new THREE.DodecahedronGeometry(0.9),
    towerLeg: new THREE.CylinderGeometry(0.12, 0.16, 1, 6),
    towerRoof: new THREE.ConeGeometry(1, 1, 4),
  };
  lampMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, emissive: 0xffdd88, emissiveIntensity: 0 }); // shared lamp heads (persistent)

  // Moon + stars (visible at night; fog disabled so they stay bright)
  moonMat = new THREE.MeshBasicMaterial({ color: 0xdfe4ff, transparent: true, opacity: 0, fog: false });
  moonMesh = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 12), moonMat);
  moonMesh.position.set(-40, 110, -90);
  moonMesh.visible = false;
  scene.add(moonMesh);
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(260 * 3);
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.15 + Math.random() * 0.85; // upper hemisphere
    const r = 150 + Math.random() * 30;
    const s = Math.sqrt(1 - y * y);
    starPos[i * 3] = Math.cos(a) * s * r;
    starPos[i * 3 + 1] = y * r;
    starPos[i * 3 + 2] = Math.sin(a) * s * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starsMat = new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
  stars = new THREE.Points(starGeo, starsMat);
  stars.visible = false;
  scene.add(stars);

  // Bullets: shared geometry, one tracer material per weapon
  bulletGeo = new THREE.SphereGeometry(0.08, 6, 6);
  tracerMats = WEAPONS.map(w => new THREE.MeshBasicMaterial({ color: w.tracerColor }));
  // Rocket projectile + explosion debris (shared geometry for perf)
  rocketGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8).rotateX(Math.PI / 2); // axis along ±Z
  explosionGeo = new THREE.SphereGeometry(0.12, 6, 6);
  explosionMats = [0xff7722, 0xffdd44, 0x888888].map(color => new THREE.MeshBasicMaterial({ color }));

  // Weapon viewmodels (camera children; visibility toggled in updateHUD)
  viewmodels = [];
  const gunMetal = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const gunWood = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const mkPart = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };
  const mkCyl = (r: number, len: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    m.rotation.x = Math.PI / 2; // cylinder axis along -Z (forward)
    m.position.set(0, y, z);
    return m;
  };
  const stockGeo = new THREE.CapsuleGeometry(0.045, 0.17, 3, 8); // shared stock shape
  const mkStock = (y: number, z: number, tilt: number) => {
    const m = new THREE.Mesh(stockGeo, gunWood);
    m.rotation.x = Math.PI / 2 + tilt; // angled butt
    m.position.set(0, y, z);
    return m;
  };
  // Rifle: receiver + slim barrel + wooden stock + angled magazine + sight
  const rifle = new THREE.Group();
  rifle.add(mkPart(0.09, 0.09, 0.32, 0, 0, -0.05, gunMetal), mkCyl(0.022, 0.42, 0.01, -0.42, gunMetal), mkStock(-0.05, 0.16, 0.2), mkPart(0.05, 0.18, 0.07, 0, -0.14, -0.1, gunMetal), mkPart(0.02, 0.05, 0.06, 0, 0.08, -0.18, gunMetal));
  rifle.children[3].rotation.x = 0.35; // angled magazine
  // Shotgun: fat barrel + pump grip + stock
  const shotgun = new THREE.Group();
  shotgun.add(mkPart(0.1, 0.1, 0.3, 0, 0, -0.02, gunMetal), mkCyl(0.032, 0.4, 0.03, -0.32, gunMetal), mkCyl(0.042, 0.16, -0.05, -0.2, gunWood), mkStock(-0.04, 0.18, 0.15));
  // Sniper: long barrel + stock + scope with lens
  const sniper = new THREE.Group();
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x99ccee });
  sniper.add(mkPart(0.08, 0.09, 0.34, 0, -0.02, 0.02, gunMetal), mkCyl(0.02, 0.62, 0.02, -0.48, gunMetal), mkStock(-0.06, 0.2, 0.18), mkPart(0.05, 0.14, 0.07, 0, -0.12, -0.08, gunMetal), mkCyl(0.045, 0.26, 0.1, -0.12, gunMetal), mkCyl(0.035, 0.02, 0.1, -0.25, lensMat));
  // SMG: compact receiver + short barrel + angled magazine + stub stock
  const smg = new THREE.Group();
  smg.add(mkPart(0.08, 0.08, 0.24, 0, 0, -0.02, gunMetal), mkCyl(0.018, 0.22, 0.01, -0.24, gunMetal), mkPart(0.05, 0.16, 0.06, 0, -0.13, -0.04, gunMetal), mkStock(-0.04, 0.14, 0.25));
  smg.children[2].rotation.x = 0.5; // angled magazine
  // Rocket launcher: fat tube + cone warhead + grip + stock
  const rocket = new THREE.Group();
  const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 10), gunMetal);
  warhead.rotation.x = -Math.PI / 2; // cone tip points forward (-Z)
  warhead.position.set(0, 0.02, -0.5);
  rocket.add(mkCyl(0.06, 0.52, 0.02, -0.2, gunMetal), warhead, mkPart(0.05, 0.13, 0.07, 0, -0.12, -0.05, gunMetal), mkStock(-0.05, 0.16, 0.1));
  for (const vm of [rifle, shotgun, sniper, smg, rocket]) {
    vm.position.set(VM_POS_X, VM_POS_Y, VM_POS_Z);
    vm.visible = false;
    camera.add(vm);
    viewmodels.push(vm);
  }

  player = { position: new THREE.Vector3(0, PLAYER_HEIGHT, 0), vel: new THREE.Vector3() };
}

/* Drop every prop belonging to the current chapter (meshes, lights, materials, textures) */
function clearLevelProps() {
  for (const o of levelProps) scene.remove(o);
  levelProps = [];
  game.obstacles.length = 0; // fresh level: drop obstacles from the previous chapter
  for (const m of levelMats) m.dispose();
  levelMats = [];
  for (const t of levelTexs) t.dispose(); // window texture clones included
  levelTexs = [];
  windowMats = [];
  lampLights = [];
}

function applyLevel(level: number) {
  game.level = level;
  levelLightMul = LEVELS[level - 1].lightMul;
  const fog = scene.fog as THREE.Fog;
  fog.near = LEVELS[level - 1].fogNear;
  fog.far = LEVELS[level - 1].fogFar;
  clearLevelProps();
  buildLevelProps(level);
  updateHUD();
}

function buildLevelProps(level: number) {
  // Ground: per-level procedural texture on the shared plane
  const ground = new THREE.Mesh(sharedGeos.ground, mkLevelMat({ map: mkLevelTex(makeGroundTexture(level)) }));
  ground.rotation.x = -Math.PI / 2;
  addLevelProp(ground);
  // Arena perimeter walls (shared unit box, per-level tint)
  const wallColors = [0x3a3a4a, 0x2c3a2c, 0x4a4638];
  const wallMat = mkLevelMat({ color: wallColors[level - 1] });
  const wallH = 6;
  const mkWall = (w: number, d: number, x: number, z: number) => {
    const wall = new THREE.Mesh(sharedGeos.unitBox, wallMat);
    wall.scale.set(w, wallH, d);
    wall.position.set(x, wallH / 2, z);
    addLevelProp(wall);
  };
  mkWall(ARENA * 2 + 2, 1, 0, -ARENA - 0.5);
  mkWall(ARENA * 2 + 2, 1, 0, ARENA + 0.5);
  mkWall(1, ARENA * 2 + 2, -ARENA - 0.5, 0);
  mkWall(1, ARENA * 2 + 2, ARENA + 0.5, 0);
  if (level === 2) buildForestProps();
  else if (level === 3) buildBaseProps();
  else buildCityProps();
}

/* Chapter 1: ruined city — buildings with window strips that glow at night */
function buildCityProps() {
  windowMats = [];
  const windowTex = mkLevelTex(makeWindowTexture());
  const buildingColors = [0x5a5560, 0x6a6058, 0x50556a];
  const buildingDefs = [
    { x: -34, z: -26, w: 10, d: 8,  h: 14 },
    { x: 26,  z: -30, w: 8,  d: 10, h: 11 },
    { x: 34,  z: 18,  w: 9,  d: 9,  h: 16 },
    { x: -28, z: 22,  w: 11, d: 7,  h: 12 },
    { x: -14, z: -38, w: 8,  d: 6,  h: 9 },
    { x: 6,   z: 36,  w: 7,  d: 9,  h: 13 },
    { x: -44, z: 2,   w: 8,  d: 12, h: 10 },
    { x: 44,  z: -6,  w: 9,  d: 10, h: 15 },
    { x: 8,   z: -14, w: 6,  d: 6,  h: 7 },
    { x: -10, z: 12,  w: 6,  d: 5,  h: 8 },
    { x: 24,  z: 10,  w: 5,  d: 7,  h: 6 },
    { x: -20, z: -8,  w: 5,  d: 5,  h: 7 },
    { x: 38,  z: 38,  w: 8,  d: 8,  h: 12 },
    { x: -38, z: -40, w: 9,  d: 7,  h: 13 },
  ];
  for (let i = 0; i < buildingDefs.length; i++) {
    const b = buildingDefs[i];
    const tex = windowTex.clone(); // per-building repeat keeps windows even as heights vary
    tex.needsUpdate = true;
    mkLevelTex(tex);
    tex.repeat.set(Math.max(1, Math.round(b.w / 4)), Math.max(1, Math.round(b.h / 6)));
    const mat = mkLevelMat({ color: buildingColors[i % 3], emissive: 0xffcc88, emissiveMap: tex, emissiveIntensity: 0 });
    windowMats.push(mat);
    const mesh = new THREE.Mesh(sharedGeos.unitBox, mat);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.userData.r = Math.max(b.w, b.d) / 2 + 0.4; // collision radius (same push-out style)
    mesh.userData.h = b.h;
    addLevelProp(mesh, true);
  }

  // Burnt-out cars (body + cabin + wheels; the group is the obstacle)
  const carMats = [0x2e2e33, 0x3a2a2a, 0x26303a].map(color => mkLevelMat({ color }));
  const carTopMat = mkLevelMat({ color: 0x1f1f24 });
  const wheelMat = mkLevelMat({ color: 0x141416 });
  const carDefs = [
    { x: -16, z: 4, ry: 0.4 }, { x: 10, z: -24, ry: 1.9 }, { x: 30, z: -16, ry: 0.1 },
    { x: -36, z: 30, ry: 2.8 }, { x: 16, z: 20, ry: 1.2 }, { x: 40, z: 28, ry: 0.7 },
  ];
  for (let i = 0; i < carDefs.length; i++) {
    const c = carDefs[i];
    const car = new THREE.Group();
    const body = new THREE.Mesh(sharedGeos.carBody, carMats[i % 3]); body.position.y = 0.62;
    const top = new THREE.Mesh(sharedGeos.carTop, carTopMat); top.position.set(0, 1.15, -0.4);
    car.add(body, top);
    for (const [wx, wz] of [[-1.1, 1.5], [1.1, 1.5], [-1.1, -1.5], [1.1, -1.5]] as [number, number][]) {
      const wheel = new THREE.Mesh(sharedGeos.wheel, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.34, wz);
      car.add(wheel);
    }
    car.position.set(c.x, 0, c.z);
    car.rotation.y = c.ry;
    car.userData.r = 2.4; car.userData.h = 1.7;
    addLevelProp(car, true);
  }

  // Crates + concrete blocks (shared unit box, scaled — same collision style)
  const crateMat = mkLevelMat({ color: 0x6b5a3a });
  const blockMat = mkLevelMat({ color: 0x555566 });
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
    const mesh = new THREE.Mesh(sharedGeos.unitBox, p.mat);
    mesh.scale.set(p.s, h, p.s);
    mesh.position.set(p.x, h / 2, p.z);
    mesh.userData.r = p.s * 0.72; mesh.userData.h = h;
    addLevelProp(mesh, true);
  }

  // Barrels (shared cylinder; a few knocked over for flavor)
  const barrelMat = mkLevelMat({ color: 0x6a4a32 });
  const burntBarrelMat = mkLevelMat({ color: 0x3a3a3a });
  const barrelDefs = [
    { x: -12, z: -16, rz: 0 }, { x: 6, z: 10, rz: 0 }, { x: 22, z: -12, rz: 0 },
    { x: -24, z: 8, rz: 0 }, { x: 32, z: 24, rz: 0 }, { x: -40, z: -12, rz: 1.5 },
    { x: 18, z: 28, rz: 0 }, { x: 42, z: 12, rz: 1.5 },
  ];
  for (let i = 0; i < barrelDefs.length; i++) {
    const b = barrelDefs[i];
    const barrel = new THREE.Mesh(sharedGeos.barrel, i % 3 === 2 ? burntBarrelMat : barrelMat);
    barrel.position.set(b.x, b.rz > 1 ? 0.42 : 0.53, b.z);
    barrel.rotation.z = b.rz;
    if (b.rz < 1) { // upright barrels block movement; tipped ones don't
      barrel.userData.r = 0.9; barrel.userData.h = 1.1;
      addLevelProp(barrel, true);
    } else addLevelProp(barrel);
  }

  // Broken fences (visual only)
  const fenceMat = mkLevelMat({ color: 0x4a4a52 });
  const fenceDefs = [
    { x: -26, z: -14, ry: 0 }, { x: -23, z: -14, ry: 0 }, { x: 30, z: -22, ry: Math.PI / 2 },
    { x: 30, z: -19, ry: Math.PI / 2 }, { x: -34, z: 14, ry: 0 }, { x: -31, z: 14, ry: 0 },
    { x: 16, z: 26, ry: Math.PI / 2 }, { x: 16, z: 23, ry: Math.PI / 2 }, { x: 40, z: 20, ry: 0 },
    { x: 43, z: 20, ry: 0 },
  ];
  for (const f of fenceDefs) {
    const fence = new THREE.Mesh(sharedGeos.fence, fenceMat);
    fence.position.set(f.x, 0.55, f.z);
    fence.rotation.y = f.ry;
    addLevelProp(fence);
  }

  // Street lamps: pole + emissive head; only 4 carry a real PointLight (low light count)
  const poleMat = mkLevelMat({ color: 0x2f2f35 });
  lampLights = [];
  const lampDefs = [
    { x: -20, z: -20 }, { x: 20, z: -20 }, { x: 20, z: 20 }, { x: -20, z: 20 },
    { x: 0, z: -32 }, { x: 0, z: 32 }, { x: -32, z: 0 }, { x: 32, z: 0 },
  ];
  lampDefs.forEach((l, i) => {
    const pole = new THREE.Mesh(sharedGeos.pole, poleMat);
    pole.position.set(l.x, 2.2, l.z);
    const head = new THREE.Mesh(sharedGeos.lampHead, lampMat);
    head.position.set(l.x, 4.5, l.z);
    addLevelProp(pole); addLevelProp(head);
    if (i < 4) { // only 4 real lamp lights for perf
      const pl = new THREE.PointLight(0xffdd99, 0, 16);
      pl.position.set(l.x, 4.3, l.z);
      addLevelProp(pl);
      lampLights.push(pl);
    }
  });

  // Scattered concrete debris + broken pipes (visual only)
  const debrisMat = mkLevelMat({ color: 0x3a3a42 });
  for (let i = 0; i < 26; i++) {
    const x = (Math.random() - 0.5) * (ARENA * 2 - 8), z = (Math.random() - 0.5) * (ARENA * 2 - 8);
    if (game.obstacles.some(o => Math.hypot(x - o.position.x, z - o.position.z) < ((o.userData.r as number) || 1) + 1)) continue;
    const d = new THREE.Mesh(Math.random() < 0.5 ? sharedGeos.debris : sharedGeos.pipe, debrisMat);
    d.position.set(x, 0.1, z);
    d.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
    addLevelProp(d);
  }
}

/* Chapter 2: dark forest — dense trees, fallen logs, rocks (fog closes in) */
function buildForestProps() {
  const trunkMat = mkLevelMat({ color: 0x4a3626 });
  const foliageMats = [0x2f5a2a, 0x3a6a34, 0x274d22].map(color => mkLevelMat({ color }));
  const deadMat = mkLevelMat({ color: 0x5a5048 }); // bare dead trunks
  const logMat = mkLevelMat({ color: 0x574435 });
  const rockMat = mkLevelMat({ color: 0x55565c });

  // ~72 trees: scaled trunk + cone crown; every 7th is a dead trunk (spawn center kept clear)
  for (let i = 0; i < 72; i++) {
    const x = (Math.random() - 0.5) * (ARENA * 2 - 6), z = (Math.random() - 0.5) * (ARENA * 2 - 6);
    if (Math.abs(x) < 9 && Math.abs(z) < 9) continue;
    if (game.obstacles.some(o => Math.hypot(x - o.position.x, z - o.position.z) < ((o.userData.r as number) || 1) + 1.5)) continue;
    const dead = i % 7 === 6;
    const trunkH = 2.2 + Math.random() * 1.8;
    const trunk = new THREE.Mesh(sharedGeos.trunk, dead ? deadMat : trunkMat);
    trunk.scale.set(1, trunkH, 1); // unit-height trunk scaled per tree
    trunk.position.set(x, trunkH / 2, z);
    trunk.userData.r = 0.75; trunk.userData.h = trunkH;
    addLevelProp(trunk, true);
    if (!dead) {
      const crownH = 1.2 + Math.random() * 0.9;
      const crown = new THREE.Mesh(sharedGeos.cone, foliageMats[i % 3]);
      crown.scale.set(1.5, crownH, 1.5); // cone height 2 scaled; base sits on the trunk top
      crown.position.set(x, trunkH + crownH, z);
      addLevelProp(crown);
    }
  }

  // Fallen logs (lying on the ground; blocking)
  for (let i = 0; i < 16; i++) {
    const x = (Math.random() - 0.5) * (ARENA * 2 - 6), z = (Math.random() - 0.5) * (ARENA * 2 - 6);
    if (Math.abs(x) < 9 && Math.abs(z) < 9) continue;
    if (game.obstacles.some(o => Math.hypot(x - o.position.x, z - o.position.z) < ((o.userData.r as number) || 1) + 1.5)) continue;
    const log = new THREE.Mesh(sharedGeos.log, logMat);
    log.rotation.z = Math.PI / 2; // cylinder lies along X
    log.rotation.y = Math.random() * Math.PI;
    log.position.set(x, 0.32, z);
    log.userData.r = 1.4; log.userData.h = 0.7;
    addLevelProp(log, true);
  }

  // Boulders (shared dodecahedron, randomly scaled)
  for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * (ARENA * 2 - 6), z = (Math.random() - 0.5) * (ARENA * 2 - 6);
    if (Math.abs(x) < 9 && Math.abs(z) < 9) continue;
    if (game.obstacles.some(o => Math.hypot(x - o.position.x, z - o.position.z) < ((o.userData.r as number) || 1) + 1.5)) continue;
    const rock = new THREE.Mesh(sharedGeos.rock, rockMat);
    rock.scale.setScalar(0.6 + Math.random() * 0.7);
    rock.position.set(x, 0.35, z);
    rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
    rock.userData.r = 1.0; rock.userData.h = 1;
    addLevelProp(rock, true);
  }
}

/* Chapter 3: military base — barriers, sandbags, towers, vehicles, floodlights */
function buildBaseProps() {
  const concreteMat = mkLevelMat({ color: 0x6a6a60 });
  const sandbagMat = mkLevelMat({ color: 0x8a7a5a });
  const crateMat = mkLevelMat({ color: 0x5a5a3a });
  const oliveMat = mkLevelMat({ color: 0x4a5236 });
  const darkOliveMat = mkLevelMat({ color: 0x3a4230 });
  const towerMat = mkLevelMat({ color: 0x55554a });
  const metalMat = mkLevelMat({ color: 0x3f4038 });
  const debrisMat = mkLevelMat({ color: 0x4a463c });

  // Concrete barrier segments
  const wallDefs = [
    { x: -24, z: -18, w: 10, d: 1.2, ry: 0 }, { x: 18, z: -26, w: 12, d: 1.2, ry: 0.3 },
    { x: 30, z: 12, w: 9, d: 1.2, ry: Math.PI / 2 }, { x: -30, z: 20, w: 11, d: 1.2, ry: -0.2 },
    { x: 10, z: 30, w: 10, d: 1.2, ry: 0 }, { x: -12, z: -34, w: 8, d: 1.2, ry: 0.15 },
  ];
  for (const w of wallDefs) {
    const mesh = new THREE.Mesh(sharedGeos.unitBox, concreteMat);
    mesh.scale.set(w.w, 3, w.d);
    mesh.position.set(w.x, 1.5, w.z);
    mesh.rotation.y = w.ry;
    mesh.userData.r = Math.max(w.w, w.d) / 2 + 0.4; mesh.userData.h = 3;
    addLevelProp(mesh, true);
  }

  // Sandbag rows (low cover walls)
  const sandbagDefs = [
    { x: -8, z: -12, ry: 0 }, { x: 8, z: 8, ry: Math.PI / 2 }, { x: 22, z: -8, ry: 0.6 },
    { x: -20, z: 6, ry: 0 }, { x: 14, z: 22, ry: Math.PI / 2 }, { x: -14, z: 26, ry: 0.4 },
    { x: 34, z: -20, ry: Math.PI / 2 }, { x: -34, z: -6, ry: 0 }, { x: 26, z: 30, ry: 0 },
    { x: -6, z: -30, ry: Math.PI / 2 },
  ];
  for (const s of sandbagDefs) {
    const row = new THREE.Mesh(sharedGeos.unitBox, sandbagMat);
    row.scale.set(4.5, 0.9, 1.2);
    row.position.set(s.x, 0.45, s.z);
    row.rotation.y = s.ry;
    row.userData.r = 1.7; row.userData.h = 1;
    addLevelProp(row, true);
  }

  // Supply crates
  const crateDefs = [
    { x: -16, z: -22, s: 1.8 }, { x: 12, z: -14, s: 2 }, { x: 24, z: 4, s: 1.6 },
    { x: -24, z: 14, s: 2.2 }, { x: 6, z: 18, s: 1.8 }, { x: -10, z: 34, s: 2 }, { x: 36, z: -30, s: 1.7 },
  ];
  for (const c of crateDefs) {
    const h = c.s * 1.2;
    const mesh = new THREE.Mesh(sharedGeos.unitBox, crateMat);
    mesh.scale.set(c.s, h, c.s);
    mesh.position.set(c.x, h / 2, c.z);
    mesh.userData.r = c.s * 0.72; mesh.userData.h = h;
    addLevelProp(mesh, true);
  }

  // Watchtowers: 4 legs + deck + roof (the group is the obstacle)
  const towerDefs = [
    { x: -40, z: -40, ry: 0.7 }, { x: 40, z: -40, ry: -0.7 }, { x: 40, z: 40, ry: 2.4 }, { x: -40, z: 40, ry: -2.4 },
  ];
  for (const t of towerDefs) {
    const tower = new THREE.Group();
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]] as [number, number][]) {
      const leg = new THREE.Mesh(sharedGeos.towerLeg, metalMat);
      leg.scale.set(1, 7.5, 1); // unit-height leg scaled to tower height
      leg.position.set(lx, 3.75, lz);
      tower.add(leg);
    }
    const deck = new THREE.Mesh(sharedGeos.unitBox, towerMat);
    deck.scale.set(3, 0.3, 3);
    deck.position.y = 7.5;
    const roof = new THREE.Mesh(sharedGeos.towerRoof, towerMat);
    roof.scale.set(2.2, 0.9, 2.2); // cone height 1 scaled; sits above the deck
    roof.position.y = 8.9;
    tower.add(deck, roof);
    tower.position.set(t.x, 0, t.z);
    tower.rotation.y = t.ry;
    tower.userData.r = 2.2; tower.userData.h = 7.5;
    addLevelProp(tower, true);
  }

  // Military vehicles (reuse car geometry in olive paint)
  const vehicleDefs = [
    { x: -16, z: -20, ry: 0.5 }, { x: 14, z: -30, ry: 2.1 }, { x: 28, z: 20, ry: 0.9 }, { x: -26, z: 30, ry: 2.6 },
  ];
  for (const v of vehicleDefs) {
    const veh = new THREE.Group();
    const body = new THREE.Mesh(sharedGeos.carBody, oliveMat); body.position.y = 0.62;
    const top = new THREE.Mesh(sharedGeos.carTop, darkOliveMat); top.position.set(0, 1.15, -0.4);
    veh.add(body, top);
    for (const [wx, wz] of [[-1.1, 1.5], [1.1, 1.5], [-1.1, -1.5], [1.1, -1.5]] as [number, number][]) {
      const wheel = new THREE.Mesh(sharedGeos.wheel, metalMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.34, wz);
      veh.add(wheel);
    }
    veh.position.set(v.x, 0, v.z);
    veh.rotation.y = v.ry;
    veh.userData.r = 2.4; veh.userData.h = 1.7;
    addLevelProp(veh, true);
  }

  // Floodlights: tall pole + big box head; only the first 4 carry a real PointLight (low light count)
  const floodDefs = [
    { x: -30, z: -30 }, { x: 30, z: -30 }, { x: 30, z: 30 }, { x: -30, z: 30 },
    { x: 0, z: -44 }, { x: 0, z: 44 },
  ];
  floodDefs.forEach((f, i) => {
    const pole = new THREE.Mesh(sharedGeos.pole, metalMat);
    pole.scale.y = 1.45; // taller than city lamp poles
    pole.position.set(f.x, 2.2 * 1.45, f.z);
    const head = new THREE.Mesh(sharedGeos.unitBox, lampMat); // shares the night-glow lamp material
    head.scale.set(0.7, 0.4, 0.5);
    head.position.set(f.x, 4.4 * 1.45 + 0.2, f.z);
    addLevelProp(pole); addLevelProp(head);
    if (i < 4) { // only 4 real flood lights for perf
      const pl = new THREE.PointLight(0xffdd99, 0, 20);
      pl.position.set(f.x, 4.4 * 1.45, f.z);
      addLevelProp(pl);
      lampLights.push(pl);
    }
  });

  // Scattered base debris (visual only)
  for (let i = 0; i < 22; i++) {
    const x = (Math.random() - 0.5) * (ARENA * 2 - 8), z = (Math.random() - 0.5) * (ARENA * 2 - 8);
    if (game.obstacles.some(o => Math.hypot(x - o.position.x, z - o.position.z) < ((o.userData.r as number) || 1) + 1)) continue;
    const d = new THREE.Mesh(Math.random() < 0.5 ? sharedGeos.debris : sharedGeos.pipe, debrisMat);
    d.position.set(x, 0.1, z);
    d.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
    addLevelProp(d);
  }
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
  const lvlMul = Math.pow(1.15, game.level - 1); // zombies get tougher each chapter
  const speed = v.speed + game.wave * 0.1 + Math.random() * 0.4;
  game.zombies.push({
    group, kind, hp: Math.ceil(v.hp * lvlMul), speed, damage: Math.round(v.damage * lvlMul),
    attackCD: 0, attackCDMax: v.attackCD,
    attackRange: ZOMBIE_ATTACK_RANGE * v.scale,
    radius: 1.1 * v.scale,
    alive: true, deathT: 0, hitFlash: 0,
    leftArm: group.children[4] as THREE.Mesh, rightArm: group.children[5] as THREE.Mesh,
    leftLeg: group.children[6] as THREE.Mesh, rightLeg: group.children[7] as THREE.Mesh,
    walkPhase: Math.random() * 10,
    eyeMat: (group.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial,
    eyeBase: new THREE.Color(v.eyes),
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

/* Apply damage to a zombie (shared by bullets and rocket splash) */
function damageZombie(z: Zombie, dmg: number) {
  z.hp -= dmg;
  z.hitFlash = 0.1;
  game.hitMarkerT = 0.12;
  if (z.hp <= 0) {
    z.alive = false;
    z.deathT = 0;
    game.zombiesKilled++;
    game.score += VARIANTS[z.kind].score;
    AudioSys.zombieDie();
  } else {
    AudioSys.zombieHit();
  }
  updateHUD();
}

/* Rocket detonation: splash damage + debris burst + flash (reuses muzzleLight) */
function explode(pos: THREE.Vector3, radius: number) {
  for (const z of game.zombies) {
    if (!z.alive) continue;
    const dx = z.group.position.x - pos.x;
    const dy = z.group.position.y + 1.2 * VARIANTS[z.kind].scale - pos.y;
    const dz = z.group.position.z - pos.z;
    if (dx * dx + dy * dy + dz * dz < radius * radius) damageZombie(z, ROCKET_SPLASH_DMG);
  }
  muzzleLight.position.copy(pos);
  muzzleLight.color.setHex(0xff7722);
  muzzleLight.intensity = 8;
  muzzleT = 0.18;
  for (let i = 0; i < 14; i++) { // ~14 debris chunks per blast
    const mesh = new THREE.Mesh(explosionGeo, explosionMats[i % 3]);
    mesh.position.copy(pos);
    scene.add(mesh);
    tmpAxis.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    game.fx.push({ mesh, vel: tmpAxis.multiplyScalar(6 + Math.random() * 8).clone(), life: 0.4 + Math.random() * 0.4 });
  }
  AudioSys.explosion();
}

/* ================= PICKUPS ================= */
type PickupKind = "shotgun" | "sniper" | "smg" | "rocket" | "ammo" | "health";
interface Pickup { mesh: THREE.Group; kind: PickupKind; bob: number; }

// Shared pickup geometry + one material pair per kind
let pickupGeos: { crate: THREE.BoxGeometry; band: THREE.BoxGeometry } | null = null;
const pickupMats: Record<PickupKind, THREE.MeshLambertMaterial> = {
  shotgun: new THREE.MeshLambertMaterial({ color: 0x8a5a2a }),
  sniper: new THREE.MeshLambertMaterial({ color: 0x2a4a7a }),
  smg: new THREE.MeshLambertMaterial({ color: 0x6a6a2a }),
  rocket: new THREE.MeshLambertMaterial({ color: 0x5a3a3a }),
  ammo: new THREE.MeshLambertMaterial({ color: 0x3a6a3a }),
  health: new THREE.MeshLambertMaterial({ color: 0xdddddd }),
};
const pickupBandMats: Record<PickupKind, THREE.MeshLambertMaterial> = {
  shotgun: new THREE.MeshLambertMaterial({ color: 0xff8833 }),
  sniper: new THREE.MeshLambertMaterial({ color: 0x66ddff }),
  smg: new THREE.MeshLambertMaterial({ color: 0xeeee55 }),
  rocket: new THREE.MeshLambertMaterial({ color: 0xff5533 }),
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
    if (d > 8 && game.obstacles.every(o => Math.hypot(x - o.position.x, z - o.position.z) > ((o.userData.r as number) || 1.2) + 1.5)) break;
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
  if (!game.weapons[3].owned && game.wave >= 2 && !game.pickups.some(p => p.kind === "smg")) spawnPickup("smg");
  if (!game.weapons[2].owned && game.wave >= 3 && !game.pickups.some(p => p.kind === "sniper")) spawnPickup("sniper");
  if (!game.weapons[4].owned && game.wave >= 5 && !game.pickups.some(p => p.kind === "rocket")) spawnPickup("rocket");
  spawnPickup("ammo");
  spawnPickup(game.hp < 60 || Math.random() < 0.5 ? "health" : "ammo");
}

// Crate kinds map to their weapon index in WEAPONS
const PICKUP_WEAPON: Partial<Record<PickupKind, number>> = { shotgun: 1, sniper: 2, smg: 3, rocket: 4 };

function applyPickup(kind: PickupKind) {
  AudioSys.pickup();
  const wi = PICKUP_WEAPON[kind];
  if (wi !== undefined) {
    const wasOwned = game.weapons[wi].owned;
    game.weapons[wi].owned = true;
    game.weapons[wi].reserve = Math.min(WEAPONS[wi].reserveMax, game.weapons[wi].reserve + WEAPONS[wi].magSize * 3);
    if (!wasOwned) { game.switchWeapon(wi); pickupMsg(`PICKED UP ${WEAPONS[wi].name} — PRESS ${wi + 1}`); }
    else pickupMsg(`+${WEAPONS[wi].magSize * 3} ${WEAPONS[wi].name} AMMO`);
  } else if (kind === "ammo") {
    for (let i = 0; i < WEAPONS.length; i++) {
      if (game.weapons[i].owned) game.weapons[i].reserve = Math.min(WEAPONS[i].reserveMax, game.weapons[i].reserve + WEAPONS[i].magSize * 2);
    }
    pickupMsg("+AMMO FOR ALL WEAPONS");
  } else {
    // Health crates now hand out a medkit instead of healing instantly
    game.medkits = Math.min(MEDKIT_MAX, game.medkits + 1);
    pickupMsg("+MEDKIT");
  }
  updateHUD();
}

/* ================= 7. HUD & OVERLAYS ================= */
const OVERLAY_CSS = `
.wwz-hud { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:center; padding:10px 16px; pointer-events:none; z-index:5; font-family:'Courier New',monospace; }
.wwz-hud-box { background:rgba(0,0,0,0.55); border:2px solid rgba(255,80,80,0.6); border-radius:8px; color:#fff; font-size:15px; font-weight:bold; padding:5px 14px; letter-spacing:1px; text-shadow:1px 1px 0 #000; display:flex; gap:16px; align-items:center; }
.wwz-daynight { color:#ffdd88; font-size:13px; letter-spacing:0; }
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
.wwz-inventory { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:7; pointer-events:auto; background:rgba(0,0,0,0.75); border:2px solid rgba(255,80,80,0.6); border-radius:8px; color:#fff; font-family:'Courier New',monospace; padding:14px 18px; min-width:280px; box-shadow:0 6px 0 rgba(0,0,0,0.4); }
.wwz-inventory.hidden { display:none; }
.wwz-inventory h3 { font-size:16px; letter-spacing:3px; color:#ff4444; text-align:center; margin-bottom:10px; text-shadow:1px 1px 0 #000; }
.wwz-inv-row { display:flex; justify-content:space-between; gap:28px; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:14px; font-weight:bold; letter-spacing:1px; text-shadow:1px 1px 0 #000; }
.wwz-inv-row:hover { background:rgba(255,255,255,0.12); }
.wwz-inv-row.active { background:rgba(255,170,100,0.35); color:#ffdd44; }
.wwz-inv-key { color:#ffaa66; margin-right:6px; }
.wwz-inv-hint { margin-top:10px; text-align:center; font-size:11px; color:#9aa5d1; }
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
      <span>WAVE <span id="wwz-wave">0/5</span></span>
      <span>SCORE <span id="wwz-score">0</span></span>
      <span id="wwz-level">BÖLÜM 1 — YIKIK ŞEHİR</span>
      <span id="wwz-daynight" class="wwz-daynight">&#9728;&#65039; DAWN</span>
    </div>
    <div class="wwz-weapon-box">
      <span class="wwz-weapon-name" id="wwz-weapon">RIFLE</span>
      <span id="wwz-ammo">30</span>
      <span class="wwz-weapon-slots">
        <span class="wwz-slot owned active" id="wwz-slot-0">1</span>
        <span class="wwz-slot" id="wwz-slot-1">2</span>
        <span class="wwz-slot" id="wwz-slot-2">3</span>
        <span class="wwz-slot" id="wwz-slot-3">4</span>
        <span class="wwz-slot" id="wwz-slot-4">5</span>
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

  const inv = document.createElement("div");
  inv.className = "wwz-inventory hidden";
  inv.id = "wwz-inventory";
  inv.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest("[data-inv]") as HTMLElement | null;
    if (!row) return;
    const v = row.dataset.inv!;
    if (v === "medkit") game.useMedkit();
    else game.switchWeapon(Number(v));
  });
  container.appendChild(inv);

  const aimHint = document.createElement("div");
  aimHint.className = "wwz-aim-hint";
  aimHint.id = "wwz-aim-hint";
  aimHint.textContent = "Click to start — WASD move, Mouse aim, Click shoot, R reload, 1-5 weapons, Q medkit, Tab inventory";
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
    <p>The horde is coming. Clear 5 waves in each of three levels: ruined city, dark forest, military base.</p>
    <p>Each wave brings more zombies — fast runners and armored brutes join later.</p>
    <p>Grab weapon crates, ammo and medkits between waves.</p>
    <button class="big-btn" id="wwz-btn-start">START</button>
    <div class="keys">
      <b>WASD / Arrows</b> move &nbsp; &middot; &nbsp; <b>Mouse</b> aim &nbsp; &middot; &nbsp; <b>Click</b> shoot<br>
      <b>Space</b> jump &nbsp; &middot; &nbsp; <b>R</b> reload &nbsp; &middot; &nbsp; <b>1-5 / Wheel</b> weapons &nbsp; &middot; &nbsp; <b>Q</b> medkit<br>
      <b>Tab / B</b> inventory &nbsp; &middot; &nbsp; <b>M</b> mute
    </div>`);

  mk("wwz-screen-gameover", `
    <h1>YOU DIED</h1>
    <p>The horde got you...</p>
    <div class="wwz-stats" id="wwz-stats"></div>
    <button class="big-btn" id="wwz-btn-retry">TRY AGAIN</button>`, true);

  mk("wwz-screen-victory", `
    <h1>ZAFER!</h1>
    <p>Üç bölüm de temizlendi!</p>
    <div class="wwz-stats" id="wwz-victory-stats"></div>
    <button class="big-btn" id="wwz-btn-victory-retry">TEKRAR OYNA</button>`, true);

  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  on("wwz-btn-start", () => { game.startGame(); canvasEl?.requestPointerLock(); });
  on("wwz-btn-retry", () => { game.startGame(); canvasEl?.requestPointerLock(); });
  on("wwz-btn-victory-retry", () => { game.startGame(); canvasEl?.requestPointerLock(); });
  on("wwz-mute", () => game.toggleMute());
}

let canvasEl: HTMLCanvasElement | null = null;

function show(id: string) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id: string) { document.getElementById(id)?.classList.add("hidden"); }
function hideAllScreens() {
  ["wwz-screen-start", "wwz-screen-gameover", "wwz-screen-victory"].forEach(hide);
}
function showBanner(text: string, ms = 2000) {
  const el = document.getElementById("wwz-wave-banner");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), ms);
}
function showWaveBanner(wave: number, incoming = false) {
  showBanner(incoming ? `WAVE ${wave} INCOMING` : `WAVE ${wave}`, 2000);
}
function pickupMsg(text: string) {
  const el = document.getElementById("wwz-pickup-msg");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}
/* Inventory panel rows: owned weapons + medkit (Tab/B toggles the panel) */
function updateInventory() {
  const el = document.getElementById("wwz-inventory");
  if (!el || !game.inventoryOpen) return;
  const rows = WEAPONS.map((w, i) => {
    const a = game.weapons[i];
    if (!a.owned) return "";
    const reserve = a.reserve === Infinity ? "\u221e" : a.reserve;
    return `<div class="wwz-inv-row${i === game.weapon ? " active" : ""}" data-inv="${i}"><span><span class="wwz-inv-key">${i + 1}</span>${w.name}</span><span>${a.mag}/${reserve}</span></div>`;
  }).join("");
  el.innerHTML = `<h3>INVENTORY</h3>${rows}<div class="wwz-inv-row" data-inv="medkit"><span><span class="wwz-inv-key">Q</span>MEDKIT</span><span>x${game.medkits}</span></div><div class="wwz-inv-hint">TAB / B close &middot; click canvas to resume</div>`;
}
function closeInventory() {
  if (!game.inventoryOpen) return;
  game.inventoryOpen = false;
  document.getElementById("wwz-inventory")?.classList.add("hidden");
}
function updateHUD() {
  const set = (id: string, v: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set("wwz-score", game.score);
  set("wwz-wave", `${game.levelWave}/${WAVES_PER_LEVEL}`);
  set("wwz-level", `BÖLÜM ${game.level} — ${LEVELS[game.level - 1].name}`);
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
  if (game.inventoryOpen) updateInventory(); // keep rows fresh while the panel is open
}

/* ================= 8. MAIN LOOP & PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  initWorld();
  applyLevel(1); // chapter 1 content (props/obstacles/fog/light)

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

  Input.init(canvas, (locked) => { if (locked) closeInventory(); updateHUD(); }); // hide panel when lock acquired
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
    updateDayNight(); // sun/sky/fog/lamps/moon/stars + HUD indicator
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