/* =====================================================================
   DÖVÜŞ ARENASI — Original 3D Fighting Game (Three.js)
   ------------------------------------------------
   A classic 2.5D fighting game with a fully original cast and arena:
     4 original fighters (KOR, BORA, ÇELİK, GÖLGE) — no copyrighted
     characters, names, logos, music, stages or visuals.
   All geometry is procedural; all audio is synthesized via Web Audio.

   Modes: 1P vs CPU, or 2P local.
   Round system: best of 3. Energy meter powers each fighter's special.

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */
import * as THREE from "three";
import { buildHumanoid, setupLights, createComposer, type HumanoidPalette, type ComposerWrap } from "../../lib/visuals";

/* ================= 1. CONSTANTS ================= */
const ARENA_HALF = 7.6;      // walkable x range
const GRAVITY = 22;
const JUMP_VEL = 7.6;
const HP_MAX = 100;
const ROUND_TIME = 60;       // seconds per round
const WINS_NEEDED = 2;       // best of 3
const METER_MAX = 100;
const SPECIAL_COST = 50;
const BODY_HALF = 0.26;      // half body width for hit tests

/* ================= 2. FIGHTER DEFINITIONS (all original) ================= */
type SpecialKind = "fireball" | "dash" | "slam" | "trap";

interface FighterCfg {
  id: string;
  name: string;
  title: string;
  desc: string;
  specialName: string;
  specialKind: SpecialKind;
  colors: { primary: number; secondary: number; skin: number; trim: number; accent: number };
  stats: { speed: number; power: number; reach: number };
}

const FIGHTERS: FighterCfg[] = [
  {
    id: "kor",
    name: "KOR",
    title: "Ateşin Oğlu",
    desc: "Volkanların kalbinden gelen öfkeli dövüşçü. Hızlı yumrukları ve alevli öfkesiyle rakibini kavurur.",
    specialName: "Alev Topu",
    specialKind: "fireball",
    colors: { primary: 0xd83020, secondary: 0xff6a1a, skin: 0xe0a06a, trim: 0xffd24a, accent: 0xff3c00 },
    stats: { speed: 3.7, power: 1.0, reach: 1.05 },
  },
  {
    id: "bora",
    name: "BORA",
    title: "Fırtına Avcısı",
    desc: "Gökyüzünün en hızlı savaşçısı. Yıldırım hızındaki adımları ve çelik gibi tekmeleriyle tanınır.",
    specialName: "Yıldırım Adımı",
    specialKind: "dash",
    colors: { primary: 0x1b5fd0, secondary: 0x35d0ff, skin: 0xc98a5e, trim: 0xdff6ff, accent: 0x7ae8ff },
    stats: { speed: 4.0, power: 0.92, reach: 1.0 },
  },
  {
    id: "celik",
    name: "ÇELİK",
    title: "Demir Kule",
    desc: "Demirden dövülmüş dev savaşçı. Yavaş ama ezici yumrukları ve yer sarsan gücüyle bilinir.",
    specialName: "Yer Sarsıntısı",
    specialKind: "slam",
    colors: { primary: 0x7a8794, secondary: 0xb9c6d2, skin: 0xd9a06a, trim: 0xe8c25a, accent: 0x39424d },
    stats: { speed: 2.8, power: 1.28, reach: 1.15 },
  },
  {
    id: "golge",
    name: "GÖLGE",
    title: "Gece Hayaleti",
    desc: "Karanlıktan doğan gizemli savaşçı. Rakibinin ayaklarının altından karanlık tuzaklar yükseltir.",
    specialName: "Gölge Tuzağı",
    specialKind: "trap",
    colors: { primary: 0x3a2a55, secondary: 0x8a5fd0, skin: 0xbfa188, trim: 0x27e8c0, accent: 0x6a4fb0 },
    stats: { speed: 3.35, power: 1.12, reach: 1.02 },
  },
];

/* ================= 3. AUDIO (synthesized) ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  master: null as GainNode | null,
  muted: false,
  musicTimer: 0 as number,
  musicStep: 0,
  musicNext: 0,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
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
    osc.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
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
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    src.start(t);
  },
  /* --- game sfx --- */
  uiMove() { this.tone("square", 300, 360, 0.05, 0.18); },
  uiSelect() { this.tone("square", 420, 620, 0.09, 0.25); },
  whoosh() { this.noise(0.14, 0.3, 0, 2400); this.tone("sine", 500, 900, 0.1, 0.12); },
  hit(power = 0) {
    this.noise(0.08 + power * 0.05, 0.45, 0, 500 - power * 150);
    this.tone("sine", 160 - power * 30, 50, 0.12 + power * 0.06, 0.5);
  },
  block() { this.tone("square", 900, 500, 0.07, 0.3); this.noise(0.06, 0.3, 0, 3200); },
  jump() { this.tone("sine", 260, 520, 0.12, 0.2); },
  land() { this.tone("sine", 130, 60, 0.1, 0.25); },
  fireball() { this.tone("sawtooth", 220, 880, 0.28, 0.32); this.noise(0.3, 0.22, 0, 900); },
  fireballHit() { this.noise(0.35, 0.5, 0, 700); this.tone("sawtooth", 300, 60, 0.35, 0.45); },
  dash() { this.noise(0.22, 0.35, 0, 3600); this.tone("sine", 400, 1400, 0.18, 0.2); },
  zap() { this.tone("square", 1500, 200, 0.18, 0.3); this.noise(0.1, 0.3, 0, 4000); },
  slam() { this.tone("sine", 90, 30, 0.5, 0.6); this.noise(0.4, 0.4, 0, 300); },
  waveHit() { this.tone("sine", 120, 40, 0.25, 0.5); this.noise(0.2, 0.4, 0, 500); },
  trap() { this.tone("sawtooth", 140, 70, 0.3, 0.3); },
  erupt() { this.noise(0.4, 0.5, 0, 800); this.tone("sawtooth", 200, 50, 0.4, 0.5); },
  meterFull() { [660, 880, 1100].forEach((f, i) => this.tone("square", f, f, 0.12, 0.25, i * 0.09)); },
  ko() { this.tone("sine", 200, 40, 1.0, 0.55); this.tone("sawtooth", 400, 60, 0.7, 0.3, 0.05); },
  roundStart() { this.tone("triangle", 523, 523, 0.35, 0.35); this.tone("triangle", 784, 784, 0.5, 0.35, 0.18); },
  fight() { this.tone("triangle", 392, 392, 0.3, 0.4); this.noise(0.25, 0.3, 0.05, 900); },
  roundWin() { [523, 659, 784].forEach((f, i) => this.tone("triangle", f, f, 0.22, 0.32, i * 0.13)); },
  matchWin() { [392, 523, 659, 784, 1047].forEach((f, i) => this.tone("triangle", f, f, 0.3, 0.35, i * 0.14)); },
  draw() { this.tone("sawtooth", 300, 220, 0.3, 0.3); },
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.42;
    if (!m) this.startMusic();
  },
  /* --- simple dark music loop (minor pentatonic pulse) --- */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicStep = 0;
    this.musicNext = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 120);
  },
  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = 0;
    }
  },
  scheduleMusic() {
    if (!this.ctx || this.muted) return;
    const stepDur = 0.21;
    const bass = [55, 55, 65.4, 55, 82.4, 55, 73.4, 55];
    const arp = [220, 261.6, 329.6, 440, 329.6, 261.6, 196, 220];
    while (this.musicNext < this.ctx.currentTime + 0.4) {
      const s = this.musicStep % 8;
      const t = this.musicNext;
      // bass pulse
      const bo = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bo.type = "sawtooth";
      bo.frequency.value = bass[s];
      bg.gain.setValueAtTime(0.055, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.9);
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 220;
      bo.connect(lp); lp.connect(bg); bg.connect(this.master!);
      bo.start(t); bo.stop(t + stepDur);
      // arp sparkle
      if (s % 2 === 1) {
        const ao = this.ctx.createOscillator();
        const ag = this.ctx.createGain();
        ao.type = "triangle";
        ao.frequency.value = arp[s];
        ag.gain.setValueAtTime(0.03, t);
        ag.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.6);
        ao.connect(ag); ag.connect(this.master!);
        ao.start(t); ao.stop(t + stepDur);
      }
      this.musicNext += stepDur;
      this.musicStep++;
    }
  },
};

/* ================= 4. INPUT ================= */
const P1 = { left: "KeyA", right: "KeyD", jump: "KeyW", block: "KeyS", punch: "KeyJ", kick: "KeyK", special: "KeyL" };
const P2 = { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", block: "ArrowDown", punch: "Digit1", kick: "Digit2", special: "Digit3" };

const Input = {
  keys: new Set<string>(),
  pressed: new Set<string>(),
  onPause: null as (() => void) | null,
  onMute: null as (() => void) | null,
  init(onPause: () => void, onMute: () => void) {
    this.onPause = onPause;
    this.onMute = onMute;
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.clear);
  },
  cleanup() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.clear);
  },
  down(e: KeyboardEvent) {
    const c = e.code;
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Digit1", "Digit2", "Digit3"].includes(c)
    ) {
      e.preventDefault();
    }
    if (c === "KeyM") Input.onMute?.();
    if (c === "Escape" || c === "KeyP") Input.onPause?.();
    if (!Input.keys.has(c)) Input.pressed.add(c);
    Input.keys.add(c);
  },
  up(e: KeyboardEvent) {
    Input.keys.delete(e.code);
  },
  clear() {
    Input.keys.clear();
  },
  isDown(code: string) {
    return Input.keys.has(code);
  },
  /** edge-triggered press (consumed once) */
  consume(code: string) {
    return Input.pressed.delete(code);
  },
  endFrame() {
    Input.pressed.clear();
  },
};

/* ================= 5. GAME STATE ================= */
interface AttackState {
  kind: "punch" | "kick" | "airkick" | "special";
  t: number;           // seconds elapsed
  dur: number;         // total seconds
  active: boolean;     // inside active window
  hitDone: boolean;
  special: SpecialKind | null;
}

interface Limbs {
  up: THREE.Group;
  low: THREE.Group;
  tip: THREE.Mesh;
}

interface Parts {
  face: THREE.Group;
  hip: THREE.Group;
  torso: THREE.Mesh;
  headG: THREE.Group;
  armR: Limbs;
  armL: Limbs;
  legR: Limbs;
  legL: Limbs;
}

interface FighterState {
  cfg: FighterCfg;
  idx: number;
  isAI: boolean;
  root: THREE.Group;
  parts: Parts;
  mats: THREE.MeshStandardMaterial[];
  walkDir: number;
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  meter: number;
  wins: number;
  state: "idle" | "walk" | "jump" | "block" | "attack" | "hitstun" | "ko";
  attack: AttackState | null;
  hitstunT: number;
  airborne: boolean;
  koT: number;
  walkT: number;
  flashT: number;
  combo: number;
  comboT: number;
  idleT: number;
  specialFired: boolean;
  ai: { t: number; plan: string; done: boolean } | null;
}

interface Projectile {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  x: number;
  y: number;
  vx: number;
  dmg: number;
  owner: FighterState;
  trailT: number;
  dead: boolean;
}

interface Wave {
  ring: THREE.Mesh;
  x: number;
  vx: number;
  dmg: number;
  owner: FighterState;
  age: number;
  dead: boolean;
}

interface Trap {
  disc: THREE.Mesh;
  x: number;
  timer: number;
  dmg: number;
  owner: FighterState;
  erupted: boolean;
  dead: boolean;
}

type GameState = "menu" | "select" | "intro" | "fight" | "roundEnd" | "matchEnd" | "paused";

const G = {
  state: "menu" as GameState,
  mode: "1p" as "1p" | "2p",
  fighters: [] as FighterState[],
  round: 1,
  roundTime: ROUND_TIME,
  roundOver: false,
  roundEndT: 0,
  introT: 0,
  koT: 0,
  banner: { main: "", sub: "", t: 0, dur: 0 },
  projectiles: [] as Projectile[],
  waves: [] as Wave[],
  traps: [] as Trap[],
  shakeT: 0,
  shakeMag: 0,
  camZoom: 0,
  timeScale: 1,
  slowmoT: 0,
  hitstop: 0,
  time: 0,
  muted: false,
  selectIdx: 0,
  p1Picked: false,
  aiPickT: 0,
  p1Cfg: null as FighterCfg | null,
  p2Cfg: null as FighterCfg | null,
  meterFullNotified: [false, false],
};

/* ================= 6. THREE SETUP ================= */
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let composerWrap: ComposerWrap | null = null;
let canvasEl: HTMLCanvasElement | null = null;
let ui: HTMLDivElement | null = null;
let wrap: HTMLDivElement | null = null;
let camDist = 9.6;

// shared glow / stone / lava textures
let glowTex: THREE.Texture;
let stoneTex: THREE.Texture;
let lavaTex: THREE.Texture;
let rockTex: THREE.Texture;

function makeRadialTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeNoiseTexture(base: string, spots: string, w = 256, h = 256): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = spots;
    const s = 1 + Math.random() * 3;
    ctx.globalAlpha = 0.12 + Math.random() * 0.2;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeLavaTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#3a0c05";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? "#c22c08" : "#ff7a1a";
    ctx.globalAlpha = 0.25 + Math.random() * 0.5;
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --- arena --- */
function buildWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15040c);
  scene.fog = new THREE.Fog(0x1a060e, 13, 34);

  camera = new THREE.PerspectiveCamera(55, 960 / 540, 0.1, 100);
  camera.position.set(0, 3.1, 9.6);
  camera.lookAt(0, 1.35, 0);

  glowTex = makeRadialTexture();
  stoneTex = makeNoiseTexture("#5a4a52", "#43363e");
  lavaTex = makeLavaTexture();
  rockTex = makeNoiseTexture("#24131c", "#150a10");

  // cinematic lighting: hemisphere + key (shadows) + rim + PBR environment
  setupLights(scene, renderer, {
    hemiSky: 0x7a5a68,
    hemiGround: 0x1a0a12,
    keyColor: 0xffd9b0,
    rimColor: 0x8855ff,
  });

  // ---- platform ----
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 });
  stoneMat.map!.repeat.set(4, 2);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.6, 6.2), stoneMat);
  plat.position.y = -0.3;
  plat.receiveShadow = true;
  scene.add(plat);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2c1c24, roughness: 1 });
  const front = new THREE.Mesh(new THREE.BoxGeometry(16.4, 1.2, 0.7), edgeMat);
  front.position.set(0, -0.95, 3.2);
  scene.add(front);
  const back = new THREE.Mesh(new THREE.BoxGeometry(16.4, 1.2, 0.7), edgeMat);
  back.position.set(0, -0.95, -3.2);
  scene.add(back);

  // ---- lava pit below ----
  const lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex });
  lavaMat.map!.repeat.set(5, 3);
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(0, -2.6, -2);
  scene.add(lava);
  const lavaGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff5522, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  lavaGlow.scale.set(20, 6, 1);
  lavaGlow.position.set(0, -1.4, -2);
  scene.add(lavaGlow);
  const lavaLight = new THREE.PointLight(0xff4411, 0.9, 18);
  lavaLight.position.set(0, 0.6, -2.5);
  scene.add(lavaLight);

  // ---- back wall + volcano silhouette ----
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex, roughness: 1 });
  rockMat.map!.repeat.set(3, 2);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), rockMat);
  wall.position.set(0, 4, -7.5);
  scene.add(wall);
  const volcMat = new THREE.MeshStandardMaterial({ color: 0x1d0f16, roughness: 1 });
  const volc = new THREE.Mesh(new THREE.ConeGeometry(6, 9, 7), volcMat);
  volc.position.set(-10.5, -0.2, -8);
  volc.castShadow = true;
  scene.add(volc);
  const volcGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff5511, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  volcGlow.scale.set(7, 2.4, 1);
  volcGlow.position.set(-10.5, 2.8, -7.4);
  scene.add(volcGlow);

  // ---- torch pillars ----
  const torchLight1 = new THREE.PointLight(0xff9933, 1.1, 14);
  torchLight1.position.set(-7.2, 3.2, -1.4);
  scene.add(torchLight1);
  const torchLight2 = new THREE.PointLight(0xff9933, 1.1, 14);
  torchLight2.position.set(7.2, 3.2, -1.4);
  scene.add(torchLight2);
  const torchMat = new THREE.MeshStandardMaterial({ color: 0x3a2b33, roughness: 1 });
  for (const tx of [-7.2, 7.2]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.6, 0.7), torchMat);
    pillar.position.set(tx, 1.1, -1.4);
    pillar.castShadow = true;
    scene.add(pillar);
    const bowl = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.4, 6), torchMat);
    bowl.position.set(tx, 3.2, -1.4);
    scene.add(bowl);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.7, 6),
      new THREE.MeshBasicMaterial({ color: 0xffa030 })
    );
    flame.position.set(tx, 3.7, -1.4);
    scene.add(flame);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8822, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.scale.set(1.1, 1.6, 1);
    fl.position.set(tx, 3.7, -1.4);
    scene.add(fl);
  }

  // ---- drifting embers ----
  const emberGeo = new THREE.BufferGeometry();
  const EN = 220;
  const ePos = new Float32Array(EN * 3);
  const eCol = new Float32Array(EN * 3);
  const eVel = new Float32Array(EN);
  for (let i = 0; i < EN; i++) {
    ePos[i * 3] = (Math.random() - 0.5) * 22;
    ePos[i * 3 + 1] = -1 + Math.random() * 9;
    ePos[i * 3 + 2] = -6 + Math.random() * 4;
    eVel[i] = 0.3 + Math.random() * 0.8;
    const c = new THREE.Color(Math.random() < 0.5 ? 0xffaa44 : 0xff5522);
    eCol[i * 3] = c.r;
    eCol[i * 3 + 1] = c.g;
    eCol[i * 3 + 2] = c.b;
  }
  emberGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
  emberGeo.setAttribute("color", new THREE.BufferAttribute(eCol, 3));
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({ size: 0.09, map: glowTex, transparent: true, opacity: 0.75, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  scene.add(embers);
  (embers as unknown as { userData: { vel: Float32Array } }).userData = { vel: eVel };
}

/* ================= 7. FIGHTER MESH BUILDER (shared realistic humanoid) ================= */
function gearFor(cfg: FighterCfg) {
  return (headG: THREE.Group, _hip: THREE.Group, mats: THREE.Material[], _pal: HumanoidPalette) => {
    const mk = (color: number, rough = 0.8) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
      mats.push(m);
      return m;
    };
    if (cfg.id === "kor") {
      // curved horns
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 7), mk(0xffd9a0, 0.6));
        horn.position.set(s * 0.09, 0.19, -0.02);
        horn.rotation.z = s * 0.55;
        horn.rotation.x = -0.25;
        headG.add(horn);
      }
      const browGlow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.1), new THREE.MeshBasicMaterial({ color: 0xff3c00 }));
      browGlow.position.set(0, 0.15, 0.06);
      headG.add(browGlow);
    } else if (cfg.id === "bora") {
      // lightning crest
      const crest = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 5), mk(cfg.colors.trim, 0.5));
      crest.position.set(0, 0.19, -0.08);
      crest.rotation.x = -0.4;
      headG.add(crest);
      const spikeR = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.12, 5), mk(cfg.colors.accent));
      spikeR.position.set(0.11, 0.2, 0);
      spikeR.rotation.z = -0.55;
      headG.add(spikeR);
      const spikeL = spikeR.clone();
      spikeL.position.x = -0.11;
      spikeL.rotation.z = 0.55;
      headG.add(spikeL);
    } else if (cfg.id === "celik") {
      // heavy knight helm
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.132, 16, 12), mk(cfg.colors.accent, 0.45));
      helm.scale.set(1.0, 0.84, 1.05);
      helm.position.set(0, 0.14, 0);
      headG.add(helm);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.04, 0.07), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      visor.position.set(0, 0.15, 0.112);
      visor.rotation.x = -0.12;
      headG.add(visor);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.14), mk(cfg.colors.trim, 0.5));
      crest.position.set(0, 0.21, -0.02);
      headG.add(crest);
    } else {
      // golge: shadow hood
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 12), mk(0x241a38, 0.95));
      hood.scale.set(1.1, 0.92, 1.05);
      hood.position.set(0, 0.1, -0.02);
      headG.add(hood);
      const glowEyes = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: cfg.colors.accent }));
      glowEyes.position.set(0, 0.1, 0.105);
      headG.add(glowEyes);
    }
  };
}

function buildFighter(cfg: FighterCfg): { root: THREE.Group; parts: Parts; mats: THREE.MeshStandardMaterial[] } {
  const built = buildHumanoid(cfg.colors, {
    scale: cfg.id === "celik" ? 1.07 : 1,
    gear: gearFor(cfg),
  });
  return {
    root: built.root,
    parts: built.parts as unknown as Parts,
    mats: built.mats as unknown as THREE.MeshStandardMaterial[],
  };
}

function disposeFighter(f: FighterState) {
  f.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  f.mats.forEach((m) => m.dispose());
  scene.remove(f.root);
}

function makeFighter(cfg: FighterCfg, idx: number, isAI: boolean): FighterState {
  const built = buildFighter(cfg);
  const f: FighterState = {
    cfg,
    idx,
    isAI,
    root: built.root,
    parts: built.parts,
    mats: built.mats,
    walkDir: 0,
    x: idx === 0 ? -2.2 : 2.2,
    y: 0,
    vy: 0,
    facing: idx === 0 ? 1 : -1,
    hp: HP_MAX,
    meter: 0,
    wins: 0,
    state: "idle",
    attack: null,
    hitstunT: 0,
    airborne: false,
    koT: 0,
    walkT: 0,
    flashT: 0,
    combo: 0,
    comboT: 0,
    idleT: Math.random() * 10,
    specialFired: false,
    ai: isAI ? { t: 0.5, plan: "idle", done: true } : null,
  };
  f.parts.face.rotation.y = f.facing > 0 ? 0 : Math.PI;
  scene.add(f.root);
  return f;
}

/* ================= 8. PARTICLES & EFFECTS ================= */
const FX = {
  parts: null as THREE.Points | null,
  pGeo: null as THREE.BufferGeometry | null,
  pPos: null as Float32Array | null,
  pCol: null as Float32Array | null,
  pVel: null as Float32Array | null,
  pLife: null as Float32Array | null,
  pMax: null as Float32Array | null,
  cursor: 0,
  N: 700,
  sprites: [] as { s: THREE.Sprite; life: number; max: number; grow: number }[],
  rings: [] as { r: THREE.Mesh; life: number; max: number; grow: number }[],
  bolts: [] as { l: THREE.LineSegments; life: number; max: number; geo: THREE.BufferGeometry }[],

  init() {
    const N = this.N;
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
    this.parts = new THREE.Points(
      this.pGeo,
      new THREE.PointsMaterial({ size: 0.11, map: glowTex, transparent: true, opacity: 0.9, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.parts.frustumCulled = false;
    scene.add(this.parts);
    this.sprites = [];
    this.rings = [];
    this.bolts = [];
  },

  burst(x: number, y: number, z: number, color: number, n: number, speed: number, life: number, up = 0) {
    if (!this.pPos || !this.pVel || !this.pLife || !this.pMax || !this.pCol) return;
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.N;
      this.pPos[idx * 3] = x;
      this.pPos[idx * 3 + 1] = y;
      this.pPos[idx * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.pVel[idx * 3] = Math.cos(a) * sp;
      this.pVel[idx * 3 + 1] = Math.sin(a) * sp * 0.8 + up + Math.random() * speed * 0.5;
      this.pVel[idx * 3 + 2] = (Math.random() - 0.5) * sp * 0.5;
      this.pLife[idx] = life * (0.5 + Math.random() * 0.5);
      this.pMax[idx] = this.pLife[idx];
      this.pCol[idx * 3] = c.r;
      this.pCol[idx * 3 + 1] = c.g;
      this.pCol[idx * 3 + 2] = c.b;
    }
  },

  update(dt: number) {
    if (!this.pPos || !this.pVel || !this.pLife || !this.pCol) return;
    for (let i = 0; i < this.N; i++) {
      if (this.pLife[i] > 0) {
        this.pLife[i] -= dt;
        this.pVel[i * 3 + 1] -= 6 * dt;
        this.pPos[i * 3] += this.pVel[i * 3] * dt;
        this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
        this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
        if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = -99;
      }
    }
    this.pGeo!.attributes.position.needsUpdate = true;
    this.pGeo!.attributes.color.needsUpdate = true;

    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life -= dt;
      if (s.life <= 0) {
        scene.remove(s.s);
        this.sprites.splice(i, 1);
        continue;
      }
      const k = s.life / s.max;
      (s.s.material as THREE.SpriteMaterial).opacity = k;
      const sc = 1 + (1 - k) * s.grow;
      s.s.scale.set(s.s.scale.x > 0 ? (s.s.userData.base as number) * sc : 1, (s.s.userData.base as number) * sc, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        scene.remove(r.r);
        this.rings.splice(i, 1);
        continue;
      }
      const k = r.life / r.max;
      (r.r.material as THREE.MeshBasicMaterial).opacity = k * 0.8;
      const sc = 1 + (1 - k) * r.grow;
      r.r.scale.set(sc, sc, sc);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      if (b.life <= 0) {
        scene.remove(b.l);
        b.geo.dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      (b.l.material as THREE.LineBasicMaterial).opacity = b.life / b.max;
    }
  },

  glow(x: number, y: number, z: number, color: number, base: number, life: number, grow = 2) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(base, base, 1);
    s.position.set(x, y, z);
    s.userData.base = base;
    scene.add(s);
    this.sprites.push({ s, life, max: life, grow });
  },

  ring(x: number, z: number, color: number, base: number, life: number, grow = 3) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 26),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    r.rotation.x = -Math.PI / 2;
    r.scale.set(base, base, base);
    r.position.set(x, 0.08, z);
    scene.add(r);
    this.rings.push({ r, life, max: life, grow });
  },

  lightning(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: number, life = 0.16) {
    const segs = 8;
    const pts: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const jx = (Math.random() - 0.5) * 0.5;
      const jy = (Math.random() - 0.5) * 0.5;
      pts.push(x1 + (x2 - x1) * t + jx, y1 + (y2 - y1) * t + jy, z1 + (z2 - z1) * t);
      if (i < segs) pts.push(x1 + (x2 - x1) * t + jx, y1 + (y2 - y1) * t + jy, z1 + (z2 - z1) * t);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    scene.add(l);
    this.bolts.push({ l, life, max: life, geo });
  },
};

/* ================= 9. POSE & ANIMATION ================= */
function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function setR(g: THREE.Object3D, axis: "x" | "y" | "z", v: number) {
  g.rotation[axis] = v;
}

function poseFighter(f: FighterState, dt: number, time: number) {
  const p = f.parts;

  // defaults (neutral guard)
  let torsoRx = 0, torsoRz = 0, torsoRy = 0, headRz = 0;
  let armRz = 0.42, armRelbow = 0.45, armRx = 0.16;
  let armLz = 0.42, armLelbow = 0.45, armLx = 0.16;
  let legRz = 0.06, legRknee = 0, legLz = -0.06, legLknee = 0;

  const s = f.state;
  if (s === "idle" || s === "walk") {
    const bob = Math.sin(time * 2.4 + f.idleT) * 0.03;
    torsoRz = -bob;
    armRz = 0.5; armRelbow = 0.55; armLz = 0.5; armLelbow = 0.55;
    if (s === "walk") {
      const sw = Math.sin(f.walkT * 9);
      legRz = sw * 0.42; legLz = -sw * 0.42;
      legRknee = Math.max(0, -sw) * 0.55;
      legLknee = Math.max(0, sw) * 0.55;
      armRz = 0.45 - sw * 0.35;
      armLz = 0.45 + sw * 0.35;
      torsoRz = -sw * 0.08;
    }
  } else if (s === "jump") {
    if (f.airborne) {
      legRz = 0.55; legRknee = 1.05; legLz = 0.45; legLknee = 0.85;
      armRx = 1.15; armRz = 0.25; armLx = 1.15; armLz = 0.25;
      torsoRz = -0.12;
    } else {
      torsoRz = 0.06;
    }
  } else if (s === "block") {
    armRz = 1.0; armRelbow = 0.8; armRx = 0.35;
    armLz = 1.0; armLelbow = 0.8; armLx = 0.35;
    torsoRz = 0.14; headRz = 0.08;
    legRz = 0.2; legLz = -0.2;
  } else if (s === "hitstun") {
    torsoRz = 0.38; headRz = 0.28;
    armRz = -0.55 + Math.sin(time * 26) * 0.12; armRelbow = 0.4;
    armLz = 0.95 + Math.sin(time * 22 + 1) * 0.15; armLelbow = 0.5;
    legRz = 0.15; legLz = -0.1;
  } else if (s === "ko") {
    // lying pose; root rotation handles the fall
    armRz = 0.25; armRelbow = 0.5; armLz = 0.2; armLelbow = 0.45;
    legRz = 0.15; legLz = -0.1;
  } else if (s === "attack" && f.attack) {
    const a = f.attack;
    const t = Math.min(1, a.t / a.dur);
    if (a.kind === "punch") {
      let e = 0;
      if (t < 0.32) e = t / 0.32;
      else if (t < 0.68) e = 1;
      else e = 1 - (t - 0.68) / 0.32;
      e = easeOutQuad(e);
      armRz = 0.5 + e * 1.12;
      armRelbow = 0.35 - e * 0.2;
      armRx = 0.1 - e * 0.06;
      torsoRz = -0.14 * e;
      torsoRy = 0.22 * e;
      armLz = 0.55; armLelbow = 0.6;
    } else if (a.kind === "kick" || a.kind === "airkick") {
      let e = 0;
      if (t < 0.34) e = t / 0.34;      // chamber
      else if (t < 0.62) e = 1 + (t - 0.34) / 0.28; // extend
      else e = 2 - (t - 0.62) / 0.38;  // retract 2->0
      const chamber = Math.min(1, t / 0.34);
      const ext = Math.max(0, Math.min(1, (t - 0.34) / 0.28));
      legRz = 0.75 * (1 - chamber) + 1.35 * chamber * (1 - ext) + 1.45 * ext;
      legRknee = 1.35 * (1 - ext);
      if (a.kind === "airkick") {
        legLz = 0.5; legLknee = 0.9;
      } else {
        legLz = -0.12;
      }
      torsoRz = -0.3 * e;
      armLz = 0.9 - 0.4 * ext; armRelbow = 0.5;
      armRz = 0.35; armRx = 0.25;
    } else if (a.kind === "special") {
      poseSpecial(f, t);
      return;
    }
  }

  // apply body
  setR(p.torso, "x", torsoRx);
  setR(p.torso, "z", torsoRz);
  setR(p.torso, "y", torsoRy);
  setR(p.headG, "z", headRz);

  setR(p.armR.up, "x", armRx);
  setR(p.armR.up, "z", armRz);
  setR(p.armR.low, "z", armRelbow);
  setR(p.armL.up, "x", armLx);
  setR(p.armL.up, "z", armLz);
  setR(p.armL.low, "z", armLelbow);
  setR(p.legR.up, "z", legRz);
  setR(p.legR.low, "z", legRknee);
  setR(p.legL.up, "z", legLz);
  setR(p.legL.low, "z", legLknee);
}

function poseSpecial(f: FighterState, t: number) {
  const p = f.parts;
  const kind = f.attack?.special ?? "fireball";
  if (kind === "fireball") {
    // pull back, thrust forward, recover
    let e = 0;
    if (t < 0.34) e = t / 0.34;
    else if (t < 0.6) e = 1;
    else e = 1 - (t - 0.6) / 0.4;
    e = easeOutQuad(e);
    setR(p.armR.up, "z", 0.5 + e * 1.15);
    setR(p.armR.low, "z", 0.5 - e * 0.55);
    setR(p.armL.up, "z", 0.5 + e * 0.7);
    setR(p.armL.low, "z", 0.5 - e * 0.3);
    setR(p.torso, "z", -0.2 * e);
    setR(p.legR.up, "z", 0.25); setR(p.legL.up, "z", -0.25);
  } else if (kind === "dash") {
    setR(p.torso, "z", -0.35);
    setR(p.torso, "x", 0.25);
    setR(p.armR.up, "z", 0.5); setR(p.armL.up, "z", 0.5);
    setR(p.armR.up, "x", -1.1); setR(p.armL.up, "x", -1.1);
    setR(p.armR.low, "z", 0.4); setR(p.armL.low, "z", 0.4);
    setR(p.legR.up, "z", 0.5); setR(p.legR.low, "z", 0.7);
    setR(p.legL.up, "z", 0.4); setR(p.legL.low, "z", 0.6);
  } else if (kind === "slam") {
    // raise both arms overhead, then smash down
    const up = Math.min(1, t / 0.42);
    const down = t > 0.42 ? Math.min(1, (t - 0.42) / 0.3) : 0;
    const upE = easeOutQuad(up);
    setR(p.armR.up, "z", 0.5 + upE * 2.35);
    setR(p.armL.up, "z", 0.5 + upE * 2.35);
    setR(p.armR.low, "z", 0.5 - upE * 0.4);
    setR(p.armL.low, "z", 0.5 - upE * 0.4);
    setR(p.torso, "z", -0.15 * upE + 0.3 * down);
    setR(p.torso, "x", 0.25 * down);
    setR(p.legR.up, "z", 0.35); setR(p.legL.up, "z", -0.35);
    setR(p.legR.low, "z", 0.5); setR(p.legL.low, "z", 0.5);
  } else if (kind === "trap") {
    // crouch, slam hand to the ground
    setR(p.torso, "z", 0.18);
    setR(p.legR.up, "z", 0.7); setR(p.legR.low, "z", 0.9);
    setR(p.legL.up, "z", 0.6); setR(p.legL.low, "z", 0.8);
    setR(p.armR.up, "z", 1.45); setR(p.armR.low, "z", 0.9);
    setR(p.armL.up, "z", 0.9); setR(p.armL.low, "z", 0.4);
    setR(p.armL.up, "x", 0.5);
  }
}

/* ================= 10. COMBAT ================= */
interface AtkDef {
  dur: number;
  active: [number, number];
  reach: number;
  dmg: number;
  knock: number;
  stun: number;
  launch: boolean;
  blockable: boolean;
  meter: number;
}

const ATK_DEFS: Record<string, AtkDef> = {
  punch: { dur: 0.36, active: [0.1, 0.24], reach: 1.05, dmg: 7, knock: 0.5, stun: 0.34, launch: false, blockable: true, meter: 9 },
  kick: { dur: 0.55, active: [0.2, 0.36], reach: 1.38, dmg: 13, knock: 0.95, stun: 0.5, launch: true, blockable: true, meter: 12 },
  airkick: { dur: 0.52, active: [0.12, 0.3], reach: 1.28, dmg: 12, knock: 0.7, stun: 0.45, launch: false, blockable: true, meter: 11 },
};

function specialDef(kind: SpecialKind): { dur: number; dmg: number; meter: number } {
  switch (kind) {
    case "fireball": return { dur: 0.6, dmg: 16, meter: 16 };
    case "dash": return { dur: 0.52, dmg: 18, meter: 18 };
    case "slam": return { dur: 0.9, dmg: 18, meter: 18 };
    case "trap": return { dur: 0.68, dmg: 16, meter: 16 };
  }
}

function startAttack(f: FighterState, kind: "punch" | "kick" | "airkick", opp: FighterState) {
  if (f.state !== "idle" && f.state !== "walk" && f.state !== "block" && f.state !== "jump") return;
  if (f.attack) return;
  const def = ATK_DEFS[kind];
  f.state = "attack";
  f.attack = { kind, t: 0, dur: def.dur, active: false, hitDone: false, special: null };
  // face the opponent
  const dx = opp.x - f.x;
  if (dx !== 0) f.facing = dx > 0 ? 1 : -1;
  f.parts.face.rotation.y = f.facing > 0 ? 0 : Math.PI;
  AudioSys.whoosh();
}

function startSpecial(f: FighterState, opp: FighterState) {
  if (f.state !== "idle" && f.state !== "walk" && f.state !== "block") return;
  if (f.attack) return;
  if (f.meter < SPECIAL_COST) return;
  f.meter -= SPECIAL_COST;
  G.meterFullNotified[f.idx] = false;
  const def = specialDef(f.cfg.specialKind);
  f.state = "attack";
  f.attack = { kind: "special", t: 0, dur: def.dur, active: false, hitDone: false, special: f.cfg.specialKind };
  const dx = opp.x - f.x;
  if (dx !== 0) f.facing = dx > 0 ? 1 : -1;
  f.parts.face.rotation.y = f.facing > 0 ? 0 : Math.PI;
}

function hitResolve(att: FighterState, def: FighterState, dmg: number, knock: number, stun: number, launch: boolean, blockable: boolean, heavy: boolean) {
  const dir = att.facing;
  const blocked = def.state === "block" && blockable && !def.airborne;
  const comboMult = Math.max(0.4, 1 - 0.18 * Math.max(0, att.combo - 1));
  const power = att.cfg.stats.power;
  let dmgFinal = Math.round(dmg * power * comboMult);
  const defPos = def.x + dir * 0.4;
  const attPos = att.x - dir * 0.12;

  if (blocked) {
    dmgFinal = Math.max(1, Math.round(dmgFinal * 0.15));
    def.hp = Math.max(1, def.hp - dmgFinal);
    def.meter = Math.min(METER_MAX, def.meter + 4);
    att.meter = Math.min(METER_MAX, att.meter + 4);
    def.x = clamp(defPos, -ARENA_HALF, ARENA_HALF);
    att.x = clamp(attPos, -ARENA_HALF, ARENA_HALF);
    FX.burst(defPos, 1.2, 0, 0xbfd8ff, 10, 3.2, 0.35);
    FX.glow(defPos, 1.2, 0, 0x9fb8ff, 0.3, 0.22);
    G.shakeT = Math.max(G.shakeT, 0.12);
    G.shakeMag = Math.max(G.shakeMag, 0.05);
    AudioSys.block();
    return;
  }

  // count combo
  const wasStunned = def.state === "hitstun" || def.airborne;
  att.combo = wasStunned ? att.combo + 1 : 1;
  att.comboT = 1.3;

  def.hp -= dmgFinal;
  def.meter = Math.min(METER_MAX, def.meter + 4);
  att.meter = Math.min(METER_MAX, att.meter + (heavy ? 18 : 11));
  def.x = clamp(defPos, -ARENA_HALF, ARENA_HALF);
  att.x = clamp(attPos, -ARENA_HALF, ARENA_HALF);

  if (def.hp <= 0) {
    def.hp = 0;
    def.state = "ko";
    def.koT = 0;
    def.airborne = false;
    def.y = 0;
    def.vy = 0;
    def.attack = null;
    def.hitstunT = 0;
    AudioSys.ko();
    G.hitstop = Math.max(G.hitstop, heavy ? 0.09 : 0.05);
    G.slowmoT = 0.9;
    G.timeScale = 0.3;
    G.koT = 1.7;
    G.roundOver = true;
    FX.burst(defPos, 1.3, 0, 0xffe0a0, 26, 6, 0.7, 3);
    FX.burst(defPos, 1.0, 0, 0xff5533, 20, 4.5, 0.6, 2);
    FX.ring(def.x, 0, 0xff8844, 1, 0.5, 4);
    G.shakeT = Math.max(G.shakeT, 0.55);
    G.shakeMag = Math.max(G.shakeMag, 0.28);
    G.camZoom = Math.max(G.camZoom, 1.1);
    showBanner("K.O.!", "", 1.3);
    return;
  }

  def.hitstunT = stun;
  def.state = "hitstun";
  def.attack = null;
  if (launch && !def.airborne) {
    def.airborne = true;
    def.vy = 6.5;
  }
  def.flashT = 0.16;
  FX.burst(defPos, 1.2, 0, heavy ? 0xffcc66 : 0xffe0a0, heavy ? 20 : 12, heavy ? 6 : 4.2, 0.4, 2);
  FX.glow(defPos, 1.2, 0, heavy ? 0xffaa44 : 0xffddaa, 0.4, 0.25);
  G.hitstop = Math.max(G.hitstop, heavy ? 0.07 : 0.045);
  G.shakeT = Math.max(G.shakeT, heavy ? 0.4 : 0.22);
  G.shakeMag = Math.max(G.shakeMag, heavy ? 0.18 : 0.1);
  AudioSys.hit(heavy ? 2 : launch ? 1 : 0);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* ================= 11. AI ================= */
function aiThink(f: FighterState, opp: FighterState) {
  const ai = f.ai!;
  const dx = opp.x - f.x;
  const adx = Math.abs(dx);
  const diff = 0.72;
  ai.plan = "idle";
  ai.done = true;
  const oppAttacking = opp.state === "attack";
  const specialReady = f.meter >= SPECIAL_COST;

  if (oppAttacking && adx < 2.0 && Math.random() < 0.4) {
    ai.plan = "block";
  } else if (adx > 1.6) {
    if (specialReady && Math.random() < 0.22 && f.cfg.specialKind === "fireball") ai.plan = "special";
    else if (Math.random() < 0.15) ai.plan = "jump";
    else ai.plan = "approach";
  } else if (adx < 1.12) {
    const r = Math.random();
    if (specialReady && r < 0.2) ai.plan = "special";
    else if (r < 0.62) ai.plan = "attackPunch";
    else if (r < 0.86) ai.plan = "attackKick";
    else ai.plan = "jump";
  } else {
    const r = Math.random();
    if (specialReady && r < 0.16) ai.plan = "special";
    else if (r < 0.45) ai.plan = "approach";
    else if (r < 0.72) ai.plan = "attackKick";
    else ai.plan = "block";
  }
  ai.done = false;
  ai.t = (0.16 + Math.random() * 0.2) * (2 - diff);
}

function aiUpdate(f: FighterState, opp: FighterState, dt: number) {
  const ai = f.ai!;
  if (f.state === "idle" || f.state === "walk" || f.state === "block") {
    ai.t -= dt;
    if (ai.t <= 0) aiThink(f, opp);
  }
  if (f.state === "idle" || f.state === "walk") {
    switch (ai.plan) {
      case "approach":
        f.walkDir = Math.sign(opp.x - f.x);
        break;
      case "retreat":
        f.walkDir = -Math.sign(opp.x - f.x);
        break;
      case "block":
        f.walkDir = 0;
        break;
      case "jump":
        f.walkDir = 0;
        if (Math.random() < 0.03) {
          doJump(f);
          ai.plan = "idle";
          ai.t = 0.25 + Math.random() * 0.3;
        }
        break;
      case "attackPunch":
        f.walkDir = 0;
        startAttack(f, "punch", opp);
        ai.plan = "idle";
        ai.t = 0.3 + Math.random() * 0.3;
        break;
      case "attackKick":
        f.walkDir = 0;
        startAttack(f, "kick", opp);
        ai.plan = "idle";
        ai.t = 0.4 + Math.random() * 0.3;
        break;
      case "special":
        f.walkDir = 0;
        startSpecial(f, opp);
        ai.plan = "idle";
        ai.t = 0.5;
        break;
      default:
        f.walkDir = 0;
    }
  }
}

/* ================= 12. FIGHTER UPDATE ================= */
function doJump(f: FighterState) {
  if (!f.airborne && f.state !== "hitstun" && f.state !== "ko" && f.state !== "attack") {
    f.vy = JUMP_VEL;
    f.airborne = true;
    f.state = "jump";
    AudioSys.jump();
  }
}

function updateFighter(f: FighterState, opp: FighterState, dt: number, rdt: number) {
  const p = f.parts;
  f.idleT += rdt;
  if (f.flashT > 0) {
    f.flashT -= rdt;
    const k = Math.max(0, f.flashT / 0.16);
    f.mats.forEach((m) => {
      const std = m as THREE.MeshStandardMaterial;
      if (std.emissive) std.emissive.setRGB(0.55 * k, 0.3 * k, 0.08 * k);
    });
  }
  if (f.comboT > 0) f.comboT -= rdt;

  if (f.state === "ko") {
    f.koT += rdt;
    // fall over
    const target = f.facing * 1.62;
    f.root.rotation.z += (target - f.root.rotation.z) * Math.min(1, rdt * 6);
    f.root.position.x = f.x;
    f.root.position.y = f.y;
    poseFighter(f, rdt, f.idleT);
    return;
  }

  // --- movement inputs ---
  f.walkDir = 0;
  let blockHeld = false;
  if (!f.isAI) {
    const keys = f.idx === 0 ? P1 : P2;
    if (Input.isDown(keys.left)) f.walkDir -= 1;
    if (Input.isDown(keys.right)) f.walkDir += 1;
    blockHeld = Input.isDown(keys.block);
    if (!f.airborne && f.state !== "hitstun") {
      if (Input.consume(keys.jump)) doJump(f);
    }
  } else {
    aiUpdate(f, opp, dt);
    blockHeld = f.ai!.plan === "block";
  }

  if (f.state === "hitstun") {
    f.hitstunT -= dt;
    if (f.airborne) {
      f.vy -= GRAVITY * dt;
      f.y += f.vy * dt;
      if (f.y <= 0) {
        f.y = 0;
        f.vy = 0;
        f.airborne = false;
        f.hitstunT = Math.max(f.hitstunT, 0.3); // knockdown recovery
        AudioSys.land();
        FX.ring(f.x, 0, 0xaaaaaa, 0.6, 0.3, 2);
      }
    }
    if (f.hitstunT <= 0 && !f.airborne) {
      f.state = "idle";
      f.combo = 0;
    }
    f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
    f.root.position.set(f.x, f.y, 0);
    poseFighter(f, rdt, f.idleT);
    return;
  }

  // --- attacks ---
  if (f.state === "attack" && f.attack) {
    f.attack.t += dt;
    updateAttack(f, opp, dt);
    const cur = f.attack;
    if (cur && cur.t >= cur.dur) {
      f.state = "idle";
      f.attack = null;
      f.specialFired = false;
    }
    f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
    f.root.position.set(f.x, f.y, 0);
    poseFighter(f, rdt, f.idleT);
    return;
  }

  // --- airborne physics ---
  if (f.airborne) {
    f.vy -= GRAVITY * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      f.airborne = false;
      f.state = "idle";
      AudioSys.land();
      FX.ring(f.x, 0, 0xaaaaaa, 0.6, 0.3, 2);
    } else {
      f.state = "jump";
    }
    // air kick
    if (!f.isAI && Input.consume(f.idx === 0 ? P1.kick : P2.kick)) {
      startAttack(f, "airkick", opp);
    } else if (f.isAI && f.ai!.plan === "attackKick" && Math.random() < 0.01) {
      startAttack(f, "airkick", opp);
    }
    f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
    f.root.position.set(f.x, f.y, 0);
    poseFighter(f, rdt, f.idleT);
    return;
  }

  // --- grounded movement / actions ---
  // (ko and hitstun states already returned above)
  const canAct = true;
  if (canAct) {
    // facing
    const dx = opp.x - f.x;
    if (dx !== 0) f.facing = dx > 0 ? 1 : -1;
    p.face.rotation.y = f.facing > 0 ? 0 : Math.PI;

    // block
    if (blockHeld) {
      f.state = "block";
      f.walkDir *= 0.45;
    }

    // attacks (player)
    if (!f.isAI) {
      const keys = f.idx === 0 ? P1 : P2;
      if (Input.consume(keys.punch)) startAttack(f, "punch", opp);
      else if (Input.consume(keys.kick)) startAttack(f, "kick", opp);
      else if (Input.consume(keys.special)) startSpecial(f, opp);
    } else if (f.ai!.plan === "special" && f.state === "idle") {
      startSpecial(f, opp);
    }

    if (f.state !== "attack") {
      // walk
      const spd = f.cfg.stats.speed * (blockHeld ? 0.45 : 1);
      if (f.walkDir !== 0 && !blockHeld) {
        f.x += f.walkDir * spd * dt;
        f.walkT += dt * Math.abs(f.walkDir);
        f.state = "walk";
      } else if (!blockHeld) {
        f.state = "idle";
      }
      f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
    }
  }

  f.root.position.set(f.x, f.y, 0);
  poseFighter(f, rdt, f.idleT);
}

function updateAttack(f: FighterState, opp: FighterState, dt: number) {
  const a = f.attack!;
  const dir = f.facing;

  if (a.kind === "special") {
    const kind = a.special!;
    if (kind === "fireball" && !f.specialFired && a.t >= 0.36) {
      f.specialFired = true;
      const fb = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xff7a2a })
      );
      fb.position.set(f.x + dir * 0.65, 1.0, 0);
      scene.add(fb);
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9922, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      gl.scale.set(1.1, 1.1, 1);
      gl.position.copy(fb.position);
      scene.add(gl);
      G.projectiles.push({ mesh: fb, glow: gl, x: fb.position.x, y: 1.0, vx: dir * 13, dmg: 16 * f.cfg.stats.power, owner: f, trailT: 0, dead: false });
      AudioSys.fireball();
    } else if (kind === "dash" && a.t >= 0.12 && a.t <= 0.42) {
      f.x += dir * 13.5 * dt;
      if (!a.hitDone && Math.abs(opp.x - f.x) < 0.85) {
        a.hitDone = true;
        FX.lightning(f.x + dir * 0.4, 1.3, 0, opp.x, 1.1, 0, 0x9fd8ff);
        FX.glow((f.x + opp.x) / 2, 1.2, 0, 0xbfe8ff, 0.8, 0.3);
        AudioSys.zap();
        hitResolve(f, opp, 18 * f.cfg.stats.power, 1.35, 0.62, false, true, true);
      } else if (a.t > 0.22 && Math.random() < 0.3) {
        FX.glow(f.x + dir * 0.3, 1.1 + Math.random() * 0.4, 0, 0x7ae8ff, 0.2, 0.12);
      }
    } else if (kind === "slam" && !f.specialFired && a.t >= 0.42) {
      f.specialFired = true;
      G.waves.push({ ring: null as unknown as THREE.Mesh, x: f.x + dir * 0.8, vx: dir * 8, dmg: 18 * f.cfg.stats.power, owner: f, age: 0, dead: false });
      FX.ring(f.x, 0, 0xffaa44, 1.2, 0.5, 3);
      FX.burst(f.x, 0.3, 0, 0xffcc88, 18, 5, 0.5, 4);
      G.shakeT = Math.max(G.shakeT, 0.5);
      G.shakeMag = Math.max(G.shakeMag, 0.22);
      AudioSys.slam();
    } else if (kind === "trap" && !f.specialFired && a.t >= 0.3) {
      f.specialFired = true;
      const tx = clamp(opp.x, -ARENA_HALF + 0.8, ARENA_HALF - 0.8);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 24),
        new THREE.MeshBasicMaterial({ color: 0x5a2fd0, transparent: true, opacity: 0.55, depthWrite: false })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(tx, 0.05, 0);
      scene.add(disc);
      G.traps.push({ disc, x: tx, timer: 0.85, dmg: 16 * f.cfg.stats.power, owner: f, erupted: false, dead: false });
      AudioSys.trap();
    }
    return;
  }

  // punch / kick / airkick hit window
  const def = ATK_DEFS[a.kind];
  if (!a.active && a.t >= def.active[0]) a.active = true;
  if (a.active && !a.hitDone && a.t <= def.active[1]) {
    const dx = Math.abs(opp.x - f.x);
    const inReach = dx <= def.reach + BODY_HALF * 2;
    const vertOk =
      a.kind === "airkick" ? Math.abs(f.y - opp.y) < 1.9 || opp.airborne : !opp.airborne;
    if (inReach && vertOk && opp.state !== "ko") {
      a.hitDone = true;
      hitResolve(f, opp, def.dmg * f.cfg.stats.power, def.knock, def.stun, def.launch, def.blockable, false);
    }
  }

  // punch -> kick cancel on connect
  if (a.kind === "punch" && a.hitDone && a.t > 0.22 && a.t < 0.42) {
    const kickEdge = f.isAI ? false : Input.consume(f.idx === 0 ? P1.kick : P2.kick);
    if (kickEdge) {
      f.attack = { kind: "kick", t: 0, dur: ATK_DEFS.kick.dur, active: false, hitDone: false, special: null };
      AudioSys.whoosh();
      return;
    }
  }
}

/* ================= 13. PROJECTILES / WAVES / TRAPS ================= */
function updateProjectiles(dt: number) {
  for (const pr of G.projectiles) {
    if (pr.dead) continue;
    pr.x += pr.vx * dt;
    pr.mesh.position.x = pr.x;
    pr.glow.position.x = pr.x;
    pr.trailT -= dt;
    if (pr.trailT <= 0) {
      pr.trailT = 0.035;
      FX.glow(pr.x - Math.sign(pr.vx) * 0.3, pr.y, 0, 0xff7722, 0.22, 0.25);
    }
    const opp = pr.owner.idx === 0 ? G.fighters[1] : G.fighters[0];
    // hit if the fireball crosses the opponent's chest height (jumping dodges it)
    if (opp.state !== "ko" && Math.abs(opp.x - pr.x) < 0.55 && Math.abs(pr.y - (opp.y + 1.0)) < 0.85) {
      pr.dead = true;
      FX.burst(pr.x, pr.y, 0, 0xff8833, 16, 5, 0.5, 2);
      FX.glow(pr.x, pr.y, 0, 0xffaa44, 0.7, 0.3);
      AudioSys.fireballHit();
      hitResolve(pr.owner, opp, pr.dmg, 0.9, 0.6, false, true, true);
    }
    if (Math.abs(pr.x) > ARENA_HALF + 1.5) pr.dead = true;
  }
  G.projectiles = G.projectiles.filter((p) => {
    if (p.dead) {
      scene.remove(p.mesh);
      scene.remove(p.glow);
      p.mesh.geometry.dispose();
    }
    return !p.dead;
  });
  for (const pr of G.projectiles) {
    pr.mesh.rotation.y += dt * 10;
  }
}

function updateWaves(dt: number) {
  for (const w of G.waves) {
    if (w.dead) continue;
    w.age += dt;
    w.x += w.vx * dt;
    // visual ring follows
    FX.ring(w.x, 0, 0xffaa55, 0.5 + w.age * 1.2, 0.3, 2.5);
    const opp = w.owner.idx === 0 ? G.fighters[1] : G.fighters[0];
    if (opp.state !== "ko" && !opp.airborne && Math.abs(opp.x - w.x) < 0.62) {
      w.dead = true;
      FX.burst(w.x, 0.8, 0, 0xffcc77, 18, 6, 0.5, 3);
      AudioSys.waveHit();
      hitResolve(w.owner, opp, w.dmg, 1.05, 0.68, true, false, true);
    }
    if (Math.abs(w.x) > ARENA_HALF + 1) w.dead = true;
  }
  G.waves = G.waves.filter((w) => !w.dead);
}

function updateTraps(dt: number) {
  for (const t of G.traps) {
    if (t.dead) continue;
    if (!t.erupted) {
      t.timer -= dt;
      const pulse = 0.45 + Math.sin(G.time * 14) * 0.2;
      (t.disc.material as THREE.MeshBasicMaterial).opacity = pulse;
      if (t.timer <= 0) {
        t.erupted = true;
        t.dead = true;
        const opp = t.owner.idx === 0 ? G.fighters[1] : G.fighters[0];
        FX.burst(t.x, 0.4, 0, 0x8a5fd0, 24, 7, 0.7, 5);
        FX.glow(t.x, 1.2, 0, 0xaa77ff, 1.0, 0.45, 2);
        FX.ring(t.x, 0, 0xaa77ff, 0.8, 0.4, 4);
        scene.remove(t.disc);
        t.disc.geometry.dispose();
        if (opp.state !== "ko" && !opp.airborne && Math.abs(opp.x - t.x) < 1.2) {
          AudioSys.erupt();
          hitResolve(t.owner, opp, t.dmg, 0.7, 0.7, true, false, true);
        } else {
          AudioSys.erupt();
        }
      }
    }
  }
  G.traps = G.traps.filter((t) => !t.dead);
}

/* ================= 14. ROUND / MATCH FLOW ================= */
function resetRoundFighters() {
  G.fighters.forEach((f, i) => {
    f.x = i === 0 ? -2.2 : 2.2;
    f.y = 0;
    f.vy = 0;
    f.airborne = false;
    f.hp = HP_MAX;
    f.meter = 0;
    f.state = "idle";
    f.attack = null;
    f.hitstunT = 0;
    f.koT = 0;
    f.combo = 0;
    f.comboT = 0;
    f.root.rotation.z = 0;
    f.root.position.set(f.x, 0, 0);
    f.facing = i === 0 ? 1 : -1;
    f.parts.face.rotation.y = f.facing > 0 ? 0 : Math.PI;
    f.specialFired = false;
  });
  G.meterFullNotified = [false, false];
  G.projectiles = [];
  G.waves = [];
  G.traps = [];
  G.roundOver = false;
  G.roundTime = ROUND_TIME;
  G.koT = 0;
  G.timeScale = 1;
  G.slowmoT = 0;
  G.hitstop = 0;
  G.camZoom = 0;
}

function startRound(n: number) {
  G.round = n;
  resetRoundFighters();
  G.state = "intro";
  G.introT = 2.0;
  showBanner("ROUND " + n, "HAZIR OL...", 1.1);
  AudioSys.roundStart();
}

function startMatch(mode: "1p" | "2p", p1Cfg: FighterCfg, p2Cfg: FighterCfg) {
  G.fighters.forEach(disposeFighter);
  G.fighters = [];
  G.mode = mode;
  const f0 = makeFighter(p1Cfg, 0, false);
  const f1 = makeFighter(p2Cfg, 1, mode === "1p");
  G.fighters = [f0, f1];
  G.meterFullNotified = [false, false];
  startRound(1);
  hideScreens();
  showHud(true);
}

function endRound(winnerIdx: number, perfect: boolean) {
  G.roundOver = true;
  G.state = "roundEnd";
  G.roundEndT = winnerIdx >= 0 && G.fighters[winnerIdx].wins + 1 >= WINS_NEEDED ? 1.6 : 2.4;
  if (winnerIdx >= 0) {
    const w = G.fighters[winnerIdx];
    w.wins++;
    showBanner("TUR KAZANILDI", w.cfg.name + (perfect ? " — MÜKEMMEL!" : ""), 2.0);
    if (w.wins >= WINS_NEEDED) AudioSys.matchWin();
    else AudioSys.roundWin();
  } else {
    showBanner("BERABERE", "TUR TEKRARLANACAK", 2.0);
    AudioSys.draw();
  }
}

/* ================= 15. HUD / DOM ================= */
function $id(id: string): HTMLElement | null {
  return document.getElementById("ft-" + id);
}

function showBanner(main: string, sub: string, dur: number) {
  G.banner = { main, sub, t: dur, dur };
  const el = $id("banner");
  if (el) {
    el.classList.add("show");
    const m = $id("banner-main");
    const s = $id("banner-sub");
    if (m) m.textContent = main;
    if (s) {
      s.textContent = sub;
      s.style.display = sub ? "block" : "none";
    }
  }
}

function hideScreens() {
  ["menu", "select", "pause", "end"].forEach((n) => {
    const el = $id(n);
    if (el) el.style.display = "none";
  });
}

function showHud(v: boolean) {
  const el = $id("hud");
  if (el) el.style.display = v ? "block" : "none";
}

const CSS = `
#ft-wrap * { box-sizing: border-box; -webkit-user-select: none; user-select: none; }
#ft-hud { position:absolute; inset:0; display:none; pointer-events:none; font-family: 'Segoe UI', system-ui, sans-serif; }
#ft-top { position:absolute; top:10px; left:12px; right:12px; display:flex; align-items:flex-start; gap:10px; }
.ft-panel { flex:1; max-width:360px; }
.ft-p2 { text-align:right; }
.ft-name { color:#fff; font-weight:800; font-size:17px; letter-spacing:2px; text-shadow:0 2px 4px #000; margin-bottom:3px; display:flex; gap:6px; align-items:center; }
.ft-p2 .ft-name { justify-content:flex-end; }
.ft-name .ft-np { font-size:11px; color:#ffd24a; }
.ft-hpbar { height:16px; background:rgba(20,5,8,0.85); border:2px solid rgba(255,255,255,0.35); border-radius:4px; overflow:hidden; }
.ft-hpfill { height:100%; width:100%; background:linear-gradient(180deg,#ff5a4a,#c81f10); transition:width 0.12s linear; }
.ft-p2 .ft-hpbar { transform:scaleX(-1); }
.ft-p2 .ft-hpfill { transform:scaleX(-1); }
.ft-meter { height:9px; margin-top:4px; background:rgba(20,5,8,0.8); border:1px solid rgba(255,255,255,0.22); border-radius:3px; overflow:hidden; }
.ft-meterfill { height:100%; width:0%; background:linear-gradient(90deg,#2fe0c8,#3ee8ff); }
.ft-meterfill.ready { background:linear-gradient(90deg,#ffe066,#ff9a2a); animation:ftpulse 0.8s infinite; }
@keyframes ftpulse { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.6); } }
.ft-pips { margin-top:4px; color:#ffd24a; font-size:13px; letter-spacing:4px; text-shadow:0 1px 2px #000; }
.ft-timer { font-size:30px; font-weight:900; color:#fff; text-shadow:0 0 12px rgba(255,120,60,0.8); min-width:64px; text-align:center; line-height:1.1; }
.ft-timer.low { color:#ff5040; }
#ft-banner { position:absolute; top:34%; left:0; right:0; text-align:center; pointer-events:none; opacity:0; transform:scale(0.7); transition:opacity 0.12s, transform 0.15s; }
#ft-banner.show { opacity:1; transform:scale(1); }
#ft-banner-main { font-size:74px; font-weight:900; color:#fff; letter-spacing:10px; text-shadow:0 0 24px rgba(255,90,30,0.9), 0 4px 0 #7a1508; }
#ft-banner-sub { font-size:24px; font-weight:700; color:#ffd9a0; letter-spacing:4px; text-shadow:0 2px 6px #000; margin-top:6px; }
#ft-combo { position:absolute; top:20%; left:0; right:0; text-align:center; font-size:30px; font-weight:900; color:#ffe066; letter-spacing:3px; text-shadow:0 0 14px rgba(255,200,0,0.8); display:none; }
#ft-flash { position:absolute; inset:0; background:radial-gradient(ellipse at center, rgba(255,40,20,0.55), rgba(120,0,0,0.2)); opacity:0; pointer-events:none; }
#ft-hint { position:absolute; bottom:6px; left:0; right:0; text-align:center; font-size:11.5px; color:rgba(255,255,255,0.6); letter-spacing:0.5px; text-shadow:0 1px 3px #000; }
#ft-mute { position:absolute; top:8px; right:8px; z-index:40; background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.4); color:#fff; border-radius:8px; font-size:16px; width:38px; height:34px; cursor:pointer; }
#ft-mute:hover { background:rgba(255,255,255,0.2); }
.ft-screen { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:radial-gradient(ellipse at 50% 30%, rgba(40,10,25,0.92), rgba(10,3,8,0.97)); font-family:'Segoe UI', system-ui, sans-serif; color:#fff; z-index:30; pointer-events:auto; }
.ft-btn { pointer-events:auto; }
.ft-title { font-size:52px; font-weight:900; letter-spacing:8px; color:#fff; text-shadow:0 0 30px rgba(255,90,30,0.8), 0 5px 0 #6e1408; margin-bottom:4px; }
.ft-subtitle { font-size:17px; color:#ffd9a0; letter-spacing:5px; margin-bottom:26px; }
.ft-btn { margin:8px 0; padding:13px 34px; font-size:17px; font-weight:800; letter-spacing:2px; color:#fff; background:linear-gradient(180deg,#a03020,#6e1408); border:2px solid rgba(255,255,255,0.35); border-radius:10px; cursor:pointer; min-width:300px; transition:transform 0.1s, box-shadow 0.15s; }
.ft-btn:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(255,90,30,0.45); }
.ft-btn.small { min-width:0; padding:10px 22px; font-size:14px; }
.ft-btn.ghost { background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.4); }
.ft-keys { font-size:13px; color:rgba(255,255,255,0.75); line-height:1.9; margin-top:22px; text-align:center; }
.ft-keys b { color:#ffd24a; }
.ft-cards { display:flex; gap:12px; margin-top:14px; flex-wrap:wrap; justify-content:center; }
.ft-card { width:196px; background:rgba(20,8,14,0.9); border:2px solid rgba(255,255,255,0.22); border-radius:12px; padding:12px; cursor:pointer; text-align:left; transition:transform 0.12s, border-color 0.12s, box-shadow 0.15s; }
.ft-card:hover { transform:translateY(-3px); border-color:rgba(255,255,255,0.6); }
.ft-card.sel { border-color:#fff; box-shadow:0 0 14px rgba(255,255,255,0.35); }
.ft-card.picked { border-color:#ffe066; box-shadow:0 0 18px rgba(255,224,102,0.5); }
.ft-card.p1pick { border-color:#ff6a4a; box-shadow:0 0 18px rgba(255,106,74,0.5); }
.ft-card.ai { border-color:#7ae8ff; box-shadow:0 0 18px rgba(122,232,255,0.4); }
.ft-chip { height:14px; border-radius:4px; margin-bottom:8px; }
.ft-card h3 { margin:0 0 2px; font-size:20px; letter-spacing:2px; }
.ft-card .ft-t { font-size:12px; color:#ffd9a0; margin-bottom:8px; }
.ft-card .ft-spec { font-size:12px; color:#8fe8ff; margin-bottom:8px; }
.ft-card .ft-desc { font-size:11.5px; color:rgba(255,255,255,0.7); line-height:1.45; min-height:52px; }
.ft-stat { display:flex; align-items:center; gap:6px; font-size:10.5px; color:rgba(255,255,255,0.65); margin-top:4px; }
.ft-stat i { flex:1; height:5px; background:rgba(255,255,255,0.15); border-radius:3px; overflow:hidden; display:block; }
.ft-stat i b { display:block; height:100%; background:#ffd24a; }
.ft-select-hint { margin-top:16px; font-size:13px; color:rgba(255,255,255,0.75); letter-spacing:1px; }
#ft-select-title { font-size:40px; font-weight:900; letter-spacing:6px; text-shadow:0 0 24px rgba(255,90,30,0.7); }
#ft-select-sub { font-size:16px; color:#ffd9a0; margin-top:2px; letter-spacing:2px; }
#ft-end-name { font-size:56px; font-weight:900; letter-spacing:8px; text-shadow:0 0 30px rgba(255,90,30,0.8), 0 5px 0 #6e1408; }
#ft-end-sub { font-size:18px; color:#ffd9a0; letter-spacing:3px; margin:8px 0 20px; }
.ft-pause-title { font-size:44px; font-weight:900; letter-spacing:8px; text-shadow:0 0 24px rgba(255,90,30,0.7); margin-bottom:18px; }
`;

function buildUI(wrapEl: HTMLDivElement) {
  ui = document.createElement("div");
  ui.id = "ft-ui";
  ui.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  ui.innerHTML = `
<style>${CSS}</style>
<div id="ft-hud">
  <div id="ft-top">
    <div class="ft-panel ft-p1">
      <div class="ft-name"><span class="ft-np">P1</span> <span id="ft-name0">—</span></div>
      <div class="ft-hpbar"><div class="ft-hpfill" id="ft-hp0"></div></div>
      <div class="ft-meter"><div class="ft-meterfill" id="ft-meter0"></div></div>
      <div class="ft-pips" id="ft-pips0"></div>
    </div>
    <div class="ft-timer" id="ft-timer">60</div>
    <div class="ft-panel ft-p2">
      <div class="ft-name"><span id="ft-name1">—</span> <span class="ft-np">P2</span></div>
      <div class="ft-hpbar"><div class="ft-hpfill" id="ft-hp1"></div></div>
      <div class="ft-meter"><div class="ft-meterfill" id="ft-meter1"></div></div>
      <div class="ft-pips" id="ft-pips1"></div>
    </div>
  </div>
  <div id="ft-banner"><div id="ft-banner-main"></div><div id="ft-banner-sub"></div></div>
  <div id="ft-combo"></div>
  <div id="ft-flash"></div>
  <div class="ft-hint">P1: <b>A/D</b> hareket · <b>W</b> zıpla · <b>S</b> blok · <b>J</b> yumruk · <b>K</b> tekme · <b>L</b> özel — P2: <b>←/→</b> · <b>↑</b> · <b>↓</b> · <b>1</b> · <b>2</b> · <b>3</b> — <b>M</b> ses</div>
</div>
<div id="ft-menu" class="ft-screen">
  <div class="ft-title">DÖVÜŞ ARENASI</div>
  <div class="ft-subtitle">EFSANE SAVAŞÇILAR</div>
  <button class="ft-btn" id="ft-btn-1p">⚔ 1 OYUNCU — BİLGİSAYARA KARŞI</button>
  <button class="ft-btn" id="ft-btn-2p">👥 2 OYUNCU — YEREL</button>
  <button class="ft-btn ghost small" id="ft-btn-mute-menu">🔊 SES: AÇIK</button>
  <div class="ft-keys">
    <b>P1:</b> A/D hareket · W zıpla · S blok · J yumruk · K tekme · L özel saldırı<br>
    <b>P2:</b> ←/→ hareket · ↑ zıpla · ↓ blok · 1 yumruk · 2 tekme · 3 özel saldırı<br>
    <b>Esc/P:</b> duraklat &nbsp;·&nbsp; <b>M:</b> ses aç/kapat
  </div>
</div>
<div id="ft-select" class="ft-screen" style="display:none">
  <div id="ft-select-title">SAVAŞÇI SEÇ</div>
  <div id="ft-select-sub">1. oyuncu savaşçını seç</div>
  <div class="ft-cards" id="ft-cards"></div>
  <div class="ft-select-hint" id="ft-select-hint"></div>
</div>
<div id="ft-pause" class="ft-screen" style="display:none">
  <div class="ft-pause-title">DURAKLATILDI</div>
  <button class="ft-btn" id="ft-btn-resume">▶ DEVAM ET</button>
  <button class="ft-btn ghost" id="ft-btn-pause-mute">🔊 SES: AÇIK</button>
  <button class="ft-btn ghost" id="ft-btn-quit">🏠 ANA MENÜ</button>
  <div class="ft-keys">
    <b>Esc/P:</b> devam et &nbsp;·&nbsp; <b>M:</b> ses &nbsp;·&nbsp; <b>Q:</b> ana menü
  </div>
</div>
<div id="ft-end" class="ft-screen" style="display:none">
  <div class="ft-title" style="font-size:34px;">MAÇ BİTTİ</div>
  <div id="ft-end-name"></div>
  <div id="ft-end-sub"></div>
  <button class="ft-btn" id="ft-btn-rematch">🔄 TEKRAR MAÇ</button>
  <button class="ft-btn ghost" id="ft-btn-end-menu">🏠 ANA MENÜ</button>
</div>
`;
  wrapEl.appendChild(ui);

  // wire buttons
  const on = (id: string, fn: () => void) => {
    const el = document.getElementById("ft-" + id) as HTMLButtonElement | null;
    if (el) el.addEventListener("click", fn);
  };
  on("btn-1p", () => { AudioSys.uiSelect(); AudioSys.resume(); showSelect("1p"); });
  on("btn-2p", () => { AudioSys.uiSelect(); AudioSys.resume(); showSelect("2p"); });
  on("btn-mute-menu", toggleMute);
  on("btn-resume", () => { if (G.state === "paused") { G.state = "fight"; hideScreens(); } AudioSys.uiSelect(); });
  on("btn-pause-mute", toggleMute);
  on("btn-quit", () => { AudioSys.uiSelect(); toMenu(); });
  on("btn-rematch", () => { AudioSys.uiSelect(); const a = G.fighters[0].cfg; const b = G.fighters[1].cfg; startMatch(G.mode, a, b); });
  on("btn-end-menu", () => { AudioSys.uiSelect(); toMenu(); });

  // mute button (in-hud)
  const mb = document.createElement("button");
  mb.id = "ft-mute";
  mb.textContent = "🔊";
  mb.style.pointerEvents = "auto";
  mb.addEventListener("click", toggleMute);
  wrapEl.appendChild(mb);
}

function toggleMute() {
  AudioSys.setMuted(!G.muted);
  G.muted = !G.muted;
  const label = G.muted ? "🔇 SES: KAPALI" : "🔊 SES: AÇIK";
  const b1 = document.getElementById("ft-btn-mute-menu") as HTMLButtonElement | null;
  const b2 = document.getElementById("ft-btn-pause-mute") as HTMLButtonElement | null;
  const b3 = document.getElementById("ft-mute") as HTMLButtonElement | null;
  if (b1) b1.textContent = label;
  if (b2) b2.textContent = label;
  if (b3) b3.textContent = G.muted ? "🔇" : "🔊";
}

function charCardHTML(cfg: FighterCfg, idx: number): string {
  const c = cfg.colors;
  const statBar = (v: number) => {
    const n = Math.round((v / 4) * 5);
    return `<i><b style="width:${(n / 5) * 100}%"></b></i>`;
  };
  return `
  <div class="ft-card" data-idx="${idx}" id="ft-card-${idx}">
    <div class="ft-chip" style="background:linear-gradient(90deg,#${c.primary.toString(16).padStart(6, "0")},#${c.secondary.toString(16).padStart(6, "0")})"></div>
    <h3>${cfg.name}</h3>
    <div class="ft-t">${cfg.title}</div>
    <div class="ft-spec">✦ ${cfg.specialName}</div>
    <div class="ft-desc">${cfg.desc}</div>
    <div class="ft-stat">HIZ ${statBar(cfg.stats.speed)}</div>
    <div class="ft-stat">GÜÇ ${statBar(cfg.stats.power)}</div>
    <div class="ft-stat">MENZİL ${statBar(cfg.stats.reach)}</div>
  </div>`;
}

function showSelect(mode: "1p" | "2p") {
  G.mode = mode;
  G.state = "select";
  G.selectIdx = 0;
  G.p1Picked = false;
  hideScreens();
  const el = $id("select");
  if (el) el.style.display = "flex";
  const cards = $id("cards");
  if (cards) cards.innerHTML = FIGHTERS.map(charCardHTML).join("");
  updateSelectCursor();
  const sub = $id("select-sub");
  if (sub) sub.textContent = "1. oyuncu savaşçını seç";
  const hint = $id("select-hint");
  if (hint) hint.innerHTML = "Fare ile tıkla — ya da <b>A/D</b> + <b>Enter</b> (P1) · <b>1-4</b> tuşları (P2)";
  cards?.querySelectorAll(".ft-card").forEach((c) => {
    (c as HTMLElement).addEventListener("click", () => {
      const idx = Number((c as HTMLElement).dataset.idx);
      AudioSys.uiSelect();
      pickFighter(idx);
    });
  });
}

function updateSelectCursor() {
  const cards = $id("cards");
  if (!cards) return;
  cards.querySelectorAll(".ft-card").forEach((c, i) => {
    c.classList.toggle("sel", i === G.selectIdx);
  });
}

function pickFighter(idx: number) {
  if (G.state !== "select") return;
  const cfg = FIGHTERS[idx];
  const cards = $id("cards");
  if (!cards) return;
  if (!G.p1Picked) {
    G.p1Picked = true;
    G.p1Cfg = cfg;
    cards.querySelectorAll(".ft-card").forEach((c) => c.classList.remove("picked"));
    const card = document.getElementById("ft-card-" + idx);
    card?.classList.add("p1pick");
    if (G.mode === "1p") {
      const sub = $id("select-sub");
      if (sub) sub.textContent = "Rakibin seçiliyor...";
      G.aiPickT = 0.55;
    } else {
      const sub = $id("select-sub");
      if (sub) sub.textContent = "2. oyuncu savaşçını seç";
      const hint = $id("select-hint");
      if (hint) hint.textContent = "Fare ile tıkla ya da 1-4 tuşlarına bas";
    }
    return;
  }
  if (G.mode === "2p") {
    G.p2Cfg = cfg;
    const card = document.getElementById("ft-card-" + idx);
    card?.classList.add("picked");
    startMatch("2p", G.p1Cfg!, G.p2Cfg!);
  }
}

function toMenu() {
  G.state = "menu";
  hideScreens();
  showHud(false);
  const el = $id("menu");
  if (el) el.style.display = "flex";
  // reset lingering fighters visually
  G.fighters.forEach((f) => {
    f.root.rotation.z = 0;
  });
}

/* ================= 16. UPDATE / LOOP / PUBLIC API ================= */
function update(dt: number, rdt: number) {
  G.time += dt;

  // banner countdown
  if (G.banner.t > 0) {
    G.banner.t -= rdt;
    if (G.banner.t <= 0) {
      const el = $id("banner");
      el?.classList.remove("show");
    }
  }

  // AI auto-pick in 1P select
  if (G.state === "select" && G.mode === "1p" && G.p1Picked && G.aiPickT > 0) {
    G.aiPickT -= rdt;
    if (G.aiPickT <= 0) {
      let aiIdx = Math.floor(Math.random() * FIGHTERS.length);
      if (FIGHTERS[aiIdx].id === G.p1Cfg!.id) aiIdx = (aiIdx + 1) % FIGHTERS.length;
      const card = document.getElementById("ft-card-" + aiIdx);
      card?.classList.add("ai");
      G.p2Cfg = FIGHTERS[aiIdx];
      startMatch("1p", G.p1Cfg!, G.p2Cfg!);
    }
  }

  // select-screen keyboard (P1: A/D + Enter, P2: 1-4)
  if (G.state === "select") {
    if (!G.p1Picked) {
      if (Input.consume("KeyA") || Input.consume("ArrowLeft")) {
        G.selectIdx = (G.selectIdx + 3) % FIGHTERS.length;
        AudioSys.uiMove();
      } else if (Input.consume("KeyD") || Input.consume("ArrowRight")) {
        G.selectIdx = (G.selectIdx + 1) % FIGHTERS.length;
        AudioSys.uiMove();
      } else if (Input.consume("Enter") || Input.consume("Space") || Input.consume("KeyJ")) {
        AudioSys.uiSelect();
        pickFighter(G.selectIdx);
      }
      updateSelectCursor();
    } else if (G.mode === "2p") {
      for (let i = 0; i < FIGHTERS.length; i++) {
        if (Input.consume("Digit" + (i + 1))) {
          AudioSys.uiSelect();
          pickFighter(i);
          break;
        }
      }
    }
  }

  if (G.state !== "fight" && G.state !== "intro" && G.state !== "roundEnd") {
    updateHud(rdt);
    return;
  }

  if (G.state === "intro") {
    G.introT -= rdt;
    if (G.introT <= 1.0 && G.banner.main === "ROUND " + G.round) {
      showBanner("DÖVÜŞ!", "", 0.9);
      AudioSys.fight();
    }
    if (G.introT <= 0) {
      G.state = "fight";
    }
    // fighters still animate during intro
    G.fighters.forEach((f, i) => {
      const opp = G.fighters[1 - i];
      updateFighter(f, opp, dt, rdt);
    });
    updateHud(rdt);
    return;
  }

  if (G.state === "roundEnd") {
    G.roundEndT -= rdt;
    G.fighters.forEach((f, i) => updateFighter(f, G.fighters[1 - i], dt, rdt));
    if (G.roundEndT <= 0) {
      const winner = G.fighters.find((f) => f.wins >= WINS_NEEDED);
      if (winner) {
        G.state = "matchEnd";
        const el = $id("end");
        if (el) el.style.display = "flex";
        const nm = $id("end-name");
        if (nm) {
          nm.textContent = winner.cfg.name;
          nm.style.color = "#" + winner.cfg.colors.primary.toString(16).padStart(6, "0");
        }
        const sb = $id("end-sub");
        if (sb) sb.textContent = winner.cfg.title + " — " + winner.wins + " tur kazandı!";
      } else {
        startRound(G.round + 1);
      }
    }
    updateHud(rdt);
    return;
  }

  // ---- FIGHT ----
  if (!G.roundOver) {
    G.roundTime -= dt;
    if (G.roundTime <= 0) {
      G.roundTime = 0;
      G.roundOver = true;
      G.roundEndT = 1.2;
      const h0 = G.fighters[0].hp;
      const h1 = G.fighters[1].hp;
      showBanner("SÜRE DOLDU", "", 1.2);
      if (h0 > h1) endRound(0, false);
      else if (h1 > h0) endRound(1, false);
      else endRound(-1, false);
    }
  } else if (G.koT > 0) {
    G.koT -= rdt;
    if (G.koT <= 0) {
      // decide round result (first KO'd loses; double KO = draw)
      const ko0 = G.fighters[0].state === "ko";
      const ko1 = G.fighters[1].state === "ko";
      if (ko0 && ko1) endRound(-1, false);
      else if (ko0) endRound(1, G.fighters[1].hp === HP_MAX);
      else endRound(0, G.fighters[0].hp === HP_MAX);
    }
  } else if (G.roundOver && G.state === "fight") {
    // safety: if koT already elapsed, move on
    G.state = "roundEnd";
    G.roundEndT = 0.01;
  }

  // hitstop / slow-mo timing (real time)
  if (G.hitstop > 0) {
    G.hitstop -= rdt;
    if (G.hitstop <= 0) G.timeScale = 1;
  }
  if (G.slowmoT > 0) {
    G.slowmoT -= rdt;
    if (G.slowmoT <= 0 && G.timeScale < 1) G.timeScale = 1;
  }

  // fighter updates
  G.fighters.forEach((f, i) => {
    const opp = G.fighters[1 - i];
    updateFighter(f, opp, dt, rdt);
  });

  // special systems
  updateProjectiles(dt);
  updateWaves(dt);
  updateTraps(dt);
  FX.update(dt);

  // meter-full notification
  G.fighters.forEach((f, i) => {
    if (f.meter >= METER_MAX && !G.meterFullNotified[i]) {
      G.meterFullNotified[i] = true;
      AudioSys.meterFull();
      showBanner(f.cfg.name + " — ENERJİ DOLDU!", "ÖZEL SALDIRI HAZIR", 1.2);
    }
  });

  updateHud(rdt);
}

function updateHud(rdt: number) {
  const set = (id: string, v: string) => {
    const el = $id(id);
    if (el) el.textContent = v;
  };
  const w = (id: string, pct: number, ready: boolean) => {
    const el = $id(id);
    if (!el) return;
    el.style.width = Math.max(0, Math.min(100, pct)) + "%";
    el.classList.toggle("ready", ready);
  };
  if (G.fighters.length < 2) return;
  G.fighters.forEach((f, i) => {
    set("name" + i, f.cfg.name);
    w("hp" + i, (f.hp / HP_MAX) * 100, false);
    w("meter" + i, (f.meter / METER_MAX) * 100, f.meter >= METER_MAX);
    set("pips" + i, "●".repeat(f.wins) + "○".repeat(Math.max(0, WINS_NEEDED - f.wins)));
  });
  const timer = $id("timer");
  if (timer) {
    const t = Math.ceil(G.roundTime);
    timer.textContent = String(Math.max(0, t));
    timer.classList.toggle("low", t <= 10);
  }
  // combo counter
  const comboEl = $id("combo");
  if (comboEl) {
    let show = "";
    for (const f of G.fighters) {
      if (!f.isAI && f.combo >= 2 && f.comboT > 0) {
        show = f.combo + " VURUŞLU KOMBO!";
        break;
      }
    }
    if (comboEl.textContent !== show) comboEl.textContent = show;
    comboEl.style.display = show ? "block" : "none";
  }
  // flash
  const flash = $id("flash");
  if (flash) {
    let op = 0;
    for (const f of G.fighters) {
      if (f.flashT > 0) op = Math.max(op, f.flashT / 0.16);
      if (!f.isAI && f.hp < 25 && f.hp > 0) op = Math.max(op, ((25 - f.hp) / 25) * 0.22);
    }
    flash.style.opacity = op.toFixed(2);
  }
  // KO camera zoom decay
  if (G.camZoom > 0) G.camZoom = Math.max(0, G.camZoom - rdt * 1.6);
}

function render() {
  // camera follow + shake + zoom
  const midX = ((G.fighters[0]?.x ?? 0) + (G.fighters[1]?.x ?? 0)) / 2;
  const follow = clamp(midX, -2.5, 2.5) * 0.35;
  camDist += ((9.6 - G.camZoom - camDist) / 2) * 0.12;
  let sx = 0;
  let sy = 0;
  if (G.shakeT > 0) {
    G.shakeT -= 1 / 60;
    const m = G.shakeMag * Math.max(0, G.shakeT / 0.4);
    sx = (Math.random() - 0.5) * 2 * m;
    sy = (Math.random() - 0.5) * 2 * m;
  }
  camera.position.set(follow + sx, 3.1 + sy, camDist);
  camera.lookAt(follow, 1.35, 0);
  if (composerWrap) composerWrap.composer.render();
  else renderer.render(scene, camera);
}

function loop(ts: number) {
  const rdt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  let dt = rdt;
  if (G.hitstop > 0) dt = 0;
  else dt = rdt * G.timeScale;
  update(dt, rdt);
  Input.endFrame();
  render();
  raf = requestAnimationFrame(loop);
}

let raf = 0;
let lastTs = 0;

export function startGame(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas;
  canvas.style.imageRendering = "auto";
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  buildWorld();
  FX.init();
  composerWrap = createComposer(renderer, scene, camera, 0.55, 0.5, 0.6);

  // wrap canvas for overlay UI
  wrap = document.createElement("div");
  wrap.id = "ft-wrap";
  wrap.style.cssText = "position:relative;display:inline-flex;";
  canvas.parentNode?.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  buildUI(wrap);

  const resize = () => {
    const scale = Math.min(window.innerWidth / 960, window.innerHeight / 540);
    canvas.style.width = 960 * scale + "px";
    canvas.style.height = 540 * scale + "px";
    composerWrap?.setSize(960, 540);
  };
  resize();
  window.addEventListener("resize", resize);

  // boot into menu
  G.state = "menu";
  hideScreens();
  showHud(false);
  const menuEl = $id("menu");
  if (menuEl) menuEl.style.display = "flex";
  G.fighters.forEach(disposeFighter);
  G.fighters = [];
  G.muted = false;

  // unlock audio on first interaction
  const unlock = () => {
    AudioSys.init();
    AudioSys.resume();
    AudioSys.startMusic();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  Input.init(
    () => {
      // pause toggle
      if (G.state === "fight") {
        G.state = "paused";
        const el = $id("pause");
        if (el) el.style.display = "flex";
        AudioSys.uiSelect();
      } else if (G.state === "paused") {
        G.state = "fight";
        hideScreens();
        AudioSys.uiSelect();
      }
    },
    () => toggleMute()
  );

  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    Input.cleanup();
    AudioSys.stopMusic();
    G.fighters.forEach(disposeFighter);
    G.fighters = [];
    wrap?.remove();
    composerWrap?.dispose();
    composerWrap = null;
    renderer.dispose();
    canvasEl = null;
  };
}
