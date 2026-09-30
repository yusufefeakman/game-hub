/* =====================================================================
   POWERBOAT RUSH — 3D Speedboat Race (Three.js)
   Third-person chase cam, WASD/arrows steer, Space = nitro boost.
   Procedural ocean, wake, spray, islands, birds, full obstacle course.
   Rival AI boats, nitro boost rings, and oil-slip hazards.
   All graphics procedural, all audio synthesized (Web Audio API).

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */
import * as THREE from "three";

/* ================= 1. CONSTANTS ================= */
const ARENA = 220;             // playable half-size (square bounds)
const BOAT_ACCEL = 26;         // engine thrust
const BOAT_BRAKE = 30;
const MAX_SPEED = 42;          // m/s (~150 km/h)
const BOOST_MULT = 1.55;
const DRAG = 0.55;             // water resistance coefficient
const TURN_RATE = 1.9;         // rad/s at full lock
const TURN_EFF_MIN = 0.35;     // turning effectiveness at low speed
const WAVE_BOUNCE = 6.5;       // vertical impulse from wave crests
const BOOST_DRAIN = 34;        // energy/s while boosting
const BOOST_REGEN = 12;        // energy/s while not boosting
const CRASH_PENALTY = 3;       // seconds added to race time
const MISS_PENALTY = 5;
const MINE_DAMAGE = 34;
const DEBRIS_DAMAGE = 18;
const ROCK_DAMAGE = 26;
const BARRIER_DAMAGE = 20;
const WHIRL_PULL = 26;
const BOAT_RADIUS = 2.2;
const RIVAL_COUNT = 3;           // AI boats racing the same course
const RIVAL_ACCEL = 21;          // AI thrust (slightly weaker than the player)
const RIVAL_MAX_SPEED = 39;      // AI top speed (the player can out-run them)
const RING_REFILL = 35;          // boost energy restored per ring pass
const RING_COOLDOWN = 5;         // seconds before a ring recharges
const OIL_SLIP_TIME = 1.8;       // seconds of reduced grip after an oil slick
const GRIP_LOSS = 0.35;          // steering multiplier while slippery

/* ================= 2. AUDIO (synthesized) ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  engineOsc: null as OscillatorNode | null,
  engineGain: null as GainNode | null,
  engineFilter: null as BiquadFilterNode | null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      // Gentle master lowpass takes the harsh edge off all synthesized sounds
      const masterTone = this.ctx.createBiquadFilter();
      masterTone.type = "lowpass";
      masterTone.frequency.value = 6500;
      masterTone.Q.value = 0.3;
      this.master.connect(masterTone);
      masterTone.connect(this.ctx.destination);
      // Continuous engine hum (sawtooth through gentle lowpass, pitch follows speed)
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 55;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 240;
      this.engineFilter.Q.value = 0.4;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;
      this.engineOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
    } catch { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  setEngine(speed01: number, boosting: boolean) {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const f = 50 + speed01 * 160 + (boosting ? 40 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(200 + speed01 * 550, t, 0.08);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.035 + speed01 * 0.085, t, 0.1);
  },
  stopEngine() { if (this.engineGain) this.engineGain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.1); },
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
  crash() { this.noise(0.4, 0.45, 0, 420); this.tone("sawtooth", 120, 40, 0.4, 0.35); },
  splash() { this.noise(0.35, 0.45, 0, 900); },
  checkpoint() { this.tone("square", 660, 660, 0.1, 0.35); this.tone("square", 880, 880, 0.16, 0.35, 0.1); },
  boost() { this.tone("sawtooth", 200, 700, 0.3, 0.3); this.noise(0.25, 0.25, 0, 2000); },
  ring() { this.tone("sine", 880, 1320, 0.22, 0.4); this.tone("sine", 1320, 1760, 0.28, 0.3, 0.09); },
  oil() { this.noise(0.5, 0.35, 0, 240); this.tone("sine", 90, 55, 0.4, 0.25); },
  overtake() { this.tone("square", 520, 780, 0.16, 0.3); this.tone("square", 780, 1040, 0.18, 0.28, 0.1); },
  mine() { this.noise(0.6, 0.5, 0, 260); this.tone("sine", 80, 30, 0.6, 0.45); },
  gameover() { [330, 262, 196, 131].forEach((f, i) => this.tone("triangle", f, f, 0.35, 0.4, i * 0.28)); },
  victory() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => this.tone("square", f, f, 0.18, 0.32, i * 0.13)); },
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.4; // also silences music (shared master)
    if (m) this.stopEngine();
  },
};

/* ================= 2.5 PIRATE MUSIC (synthesized sea shanty) =================
   32-bar loop at 112 BPM: bouncy square/triangle melody, triangle bass on
   beats 1 & 3, stomping noise percussion on every beat. Lookahead scheduler
   keeps timing tight; runs only while the race is live. */
const MusicSys = {
  ctx: null as AudioContext | null,
  bus: null as GainNode | null,
  noiseBuf: null as AudioBuffer | null,
  timer: 0,
  step: 0,
  nextTime: 0,
  BPM: 112,
  // One melody note per beat, 32 bars (128 steps). 0 = rest. (D-minor shanty)
  melody: [
    294, 294, 262, 294, 220, 0, 294, 0, 294, 294, 262, 294, 440, 294, 0, 0,
    294, 294, 262, 294, 220, 0, 294, 0, 350, 294, 262, 294, 220, 294, 0, 0,
    440, 440, 350, 440, 294, 0, 440, 0, 440, 440, 350, 440, 587, 440, 0, 0,
    440, 440, 350, 440, 294, 0, 440, 0, 350, 440, 350, 440, 294, 0, 0, 0,
    294, 294, 262, 294, 220, 0, 294, 0, 294, 294, 262, 294, 440, 294, 0, 0,
    294, 294, 262, 294, 220, 0, 294, 0, 350, 294, 262, 294, 220, 294, 0, 0,
    440, 440, 350, 440, 294, 0, 440, 0, 440, 440, 350, 440, 587, 440, 0, 0,
    440, 440, 350, 440, 294, 0, 440, 0, 350, 440, 350, 440, 220, 294, 0, 0,
  ],
  // Bass root per bar (beats 1 & 3 alternate root / fifth). 32 bars.
  bass: [
    73, 110, 73, 110, 73, 110, 73, 110, 73, 110, 73, 110, 73, 110, 73, 110,
    73, 110, 73, 110, 73, 110, 73, 110, 73, 110, 73, 110, 73, 110, 73, 110,
  ],
  init() {
    this.ctx = AudioSys.ctx;
    if (!this.ctx || this.bus || !AudioSys.master) return;
    try {
      this.bus = this.ctx.createGain();
      this.bus.gain.value = 0.18; // modest music level so SFX stay audible
      this.bus.connect(AudioSys.master);
      // One shared noise buffer for all percussion hits
      const len = Math.floor(this.ctx.sampleRate * 0.2);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    } catch { this.ctx = null; this.bus = null; }
  },
  note(freq: number, t: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx || !this.bus) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.bus);
    osc.start(t); osc.stop(t + dur + 0.02);
  },
  perc(t: number, low: boolean) {
    if (!this.ctx || !this.bus || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = low ? 130 : 1100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(low ? 0.5 : 0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (low ? 0.16 : 0.09));
    src.connect(filter); filter.connect(g); g.connect(this.bus);
    src.start(t); src.stop(t + 0.2);
  },
  tick() {
    if (!this.ctx || !this.bus || this.timer === 0) return;
    const beat = 60 / this.BPM;
    while (this.nextTime < this.ctx.currentTime + 0.7) {
      const s = this.step % 128;
      const f = this.melody[s];
      if (f > 0) this.note(f, this.nextTime, beat * 0.85, s < 64 ? "triangle" : "square", 0.16);
      const bar = s >> 2;
      if (s % 4 === 0) this.note(this.bass[bar], this.nextTime, beat * 1.6, "triangle", 0.2);
      else if (s % 4 === 2) this.note(this.bass[bar] * 1.5, this.nextTime, beat * 1.6, "triangle", 0.16);
      this.perc(this.nextTime, s % 2 === 0);
      this.nextTime += beat;
      this.step++;
    }
  },
  start() {
    this.init();
    if (!this.ctx || !this.bus || this.timer !== 0) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.bus.gain.setTargetAtTime(0.18, this.ctx.currentTime, 0.05);
    this.timer = window.setInterval(() => this.tick(), 200);
    this.tick();
  },
  stop() {
    if (this.timer !== 0) { clearInterval(this.timer); this.timer = 0; }
    if (this.ctx && this.bus) this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  },
  dispose() {
    this.stop();
    if (this.bus) { this.bus.disconnect(); this.bus = null; }
    this.ctx = null; this.noiseBuf = null;
  },
};

/* ================= 3. INPUT ================= */
const Input = {
  forward: false, back: false, left: false, right: false, boost: false,
  touchLeft: false, touchRight: false, touchThrottle: false, touchBoost: false,
  init() {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
      if (k === "w" || k === "arrowup") this.forward = true;
      if (k === "s" || k === "arrowdown") this.back = true;
      if (k === "a" || k === "arrowleft") this.left = true;
      if (k === "d" || k === "arrowright") this.right = true;
      if (k === " ") this.boost = true;
      if (k === "p") game.togglePause();
      if (k === "m") game.toggleMute();
      if (k === "r") game.restart();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") this.forward = false;
      if (k === "s" || k === "arrowdown") this.back = false;
      if (k === "a" || k === "arrowleft") this.left = false;
      if (k === "d" || k === "arrowright") this.right = false;
      if (k === " ") this.boost = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    // Touch buttons
    const bind = (id: string, prop: keyof typeof this) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e: Event) => { e.preventDefault(); el.classList.add("pressed"); (this as any)[prop] = true; };
      const off = (e: Event) => { e.preventDefault(); el.classList.remove("pressed"); (this as any)[prop] = false; };
      el.addEventListener("touchstart", on, { passive: false });
      el.addEventListener("touchend", off, { passive: false });
      el.addEventListener("touchcancel", off, { passive: false });
      el.addEventListener("mousedown", on);
      el.addEventListener("mouseup", off);
      el.addEventListener("mouseleave", off);
    };
    bind("pb-t-left", "touchLeft");
    bind("pb-t-right", "touchRight");
    bind("pb-t-gas", "touchThrottle");
    bind("pb-t-boost", "touchBoost");
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
      document.body.classList.add("touch");
    }
    this.cleanup = () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.body.classList.remove("touch");
    };
  },
  cleanup: () => {},
  get throttle() { return this.forward || this.touchThrottle; },
  get brake() { return this.back; },
  get steer() { return (this.right || this.touchRight ? 1 : 0) + (this.left || this.touchLeft ? -1 : 0); },
  get boosting() { return (this.boost || this.touchBoost) && Boat.boostEnergy > 1; },
};

/* ================= 4. COURSE DEFINITION =================
   Checkpoints are gates the boat must pass through in order.
   Each: { x, z, angle (gate orientation), type } */
interface Checkpoint {
  x: number; z: number; angle: number;
  type: "gate" | "narrow" | "ramp" | "finish";
  passed: boolean;
  // gate posts
  postL: THREE.Mesh; postR: THREE.Mesh;
  ring: THREE.Mesh;
}
interface Rock { mesh: THREE.Mesh; x: number; z: number; r: number; }
interface Mine { mesh: THREE.Group; x: number; z: number; r: number; alive: boolean; blinkT: number; }
interface Debris { mesh: THREE.Mesh; x: number; z: number; r: number; bobT: number; }
interface Barrier { group: THREE.Group; x: number; z: number; axis: "x" | "z"; range: number; speed: number; t: number; w: number; }
interface Whirlpool { x: number; z: number; r: number; mesh: THREE.Mesh; }
interface Ramp { x: number; z: number; angle: number; mesh: THREE.Mesh; len: number; }
interface BoostRing { mesh: THREE.Mesh; x: number; z: number; r: number; cooldown: number; pulse: number; }
interface OilSlick { mesh: THREE.Mesh; x: number; z: number; r: number; pulse: number; }
interface Rival {
  group: THREE.Group; pos: THREE.Vector3; heading: number; speed: number;
  waypoint: number;      // index of the next checkpoint to reach
  skill: number;         // per-rival speed/steering variance
  finished: boolean;
  progress: number;      // checkpoints passed + fraction of current segment
}

/* --- Level definitions: gates, hazards, rings, oils, islands & static mood ---
   Gates: [x, z, angle (travel direction into the gate), type, gap].
   Barriers: [x, z, axis, range, speed, width]. Ramps: [x, z, angle, len]. */
interface LevelDef {
  name: string;
  start: [number, number]; startHeading: number;
  gates: [number, number, number, Checkpoint["type"], number][];
  rocks: [number, number, number][];
  mines: [number, number][];
  debris: [number, number, boolean][];
  barriers: [number, number, "x" | "z", number, number, number][];
  whirlpools: [number, number, number][];
  ramps: [number, number, number, number][];
  rings: [number, number][];
  oils: [number, number][];
  islands: [number, number, number][];
  mood: {
    zenith: number; horizon: number; shallow: number; deep: number; fog: number;
    waveAmp: number; cloudTint: number; cloudOpacity: number; cloudCount: number;
    hemiSky: number; hemiGround: number; hemiInt: number; sunColor: number; sunInt: number; sunDisc: number;
  };
}

const LEVELS: LevelDef[] = [
  { // L1 — Sunny Bay: the classic serpentine sprint
    name: "Sunny Bay", start: [0, -160], startHeading: 0,
    gates: [
      [0, -124, 0, "gate", 18], [0, -88, 0, "gate", 16], [25, -62, 0.767, "gate", 14],
      [50, -38, 0.767, "gate", 14], [62, -2, 0.322, "gate", 13], [50, 32, -0.322, "narrow", 10],
      [25, 56, -0.803, "gate", 14], [0, 80, -0.803, "gate", 14], [-25, 104, -0.803, "narrow", 10],
      [-50, 128, -0.803, "gate", 14], [-22, 150, 0.906, "ramp", 16], [0, 176, 0.646, "finish", 20],
    ],
    rocks: [
      [88, -12, 3], [96, -28, 2.5], [84, -32, 3.5], [92, 4, 2.5],
      [-88, 10, 3], [-96, -6, 2.5], [-84, -14, 3.5], [-92, 24, 2.5],
      [18, -150, 3], [26, -138, 2.5], [14, -132, 3], [22, -158, 2.5],
    ],
    mines: [
      [74, -12], [82, 2], [70, 10], [78, -22], [68, -20],
      [-12, 110], [-5, 122], [-18, 118], [-22, 90], [-38, 104],
    ],
    debris: [
      [32, -78, true], [40, -68, false], [42, -58, true], [50, -66, false], [24, -92, true],
      [-24, 72, true], [-32, 84, false], [-36, 96, true], [-44, 102, false], [-4, 66, true],
    ],
    barriers: [[56, 15, "x", 8, 1.4, 12], [-37.5, 116, "x", 10, 1.6, 12]],
    whirlpools: [[20, -10, 12], [-15, 60, 10], [-8, 140, 11]],
    ramps: [[56, -20, 0.322, 12], [-22, 150, 0.906, 16]],
    rings: [[0, -142], [0, -106], [12.5, -75], [37.5, -50], [37.5, 44], [12.5, 68], [-12.5, 92], [-36, 139], [-11, 163]],
    oils: [[24, -82], [44, 10], [24, 74], [-28, 124], [-24, 168]],
    islands: [[-280, -260, 40], [300, -200, 55], [-250, 280, 45], [280, 260, 60], [0, -320, 50]],
    mood: {
      zenith: 0x1e5fb8, horizon: 0xf0d9b0, shallow: 0x2a88b8, deep: 0x0a3a63, fog: 0x88bbee,
      waveAmp: 1, cloudTint: 0xffffff, cloudOpacity: 0.75, cloudCount: 8,
      hemiSky: 0xbfe3ff, hemiGround: 0x2a5a7a, hemiInt: 0.75, sunColor: 0xfff2d0, sunInt: 1.2, sunDisc: 0xfff3b0,
    },
  },
  { // L2 — Adalar Kanalı: tighter S-curve threading between islands,
    // narrower lanes, more rock clusters
    name: "Adalar Kanalı", start: [0, -176], startHeading: 0,
    gates: [
      [0, -150, 0, "gate", 16], [0, -112, 0, "gate", 12], [26, -84, 0.748, "narrow", 10],
      [34, -40, 0.18, "gate", 12], [14, -6, -0.536, "narrow", 10], [-18, 26, -0.785, "gate", 12],
      [-38, 66, -0.464, "narrow", 10], [-24, 104, 0.354, "gate", 12], [6, 132, 0.816, "gate", 12],
      [32, 158, 0.785, "narrow", 10], [18, 186, -0.464, "ramp", 14], [0, 208, -0.688, "finish", 18],
    ],
    rocks: [
      [92, -20, 3], [100, -36, 2.5], [88, -42, 3.5], [96, -8, 2.5],
      [-92, 20, 3], [-100, 4, 2.5], [-88, -4, 3.5], [-96, 34, 2.5],
      [52, -60, 2.5], [60, -48, 3], [48, -46, 2.5],
      [-60, 150, 3], [-52, 162, 2.5], [-64, 140, 2.5],
      [20, -166, 3], [28, -154, 2.5], [16, -146, 3],
    ],
    mines: [
      [52, -18], [60, -4], [48, 8], [56, -28], [44, -26],
      [-58, 80], [-52, 94], [-64, 88], [-48, 70], [-60, 64],
    ],
    debris: [
      [44, -74, true], [52, -64, false], [58, -54, true], [40, -92, false], [24, -104, true],
      [-52, 58, true], [-60, 70, false], [-66, 82, true], [-74, 90, false], [-44, 52, true],
    ],
    barriers: [[30, -70, "x", 8, 1.4, 12], [-31, 85, "x", 9, 1.5, 12]],
    whirlpools: [[54, 20, 10], [-52, 120, 10], [10, 168, 10]],
    ramps: [[18, 186, -0.464, 14]],
    rings: [[0, -163], [0, -131], [13, -98], [30, -52], [24, -23], [-28, 46], [-9, 118], [19, 145], [25, 172]],
    oils: [[-26, -96], [40, -24], [-40, 44], [16, 110], [44, 170]],
    islands: [
      [-280, -260, 40], [300, -200, 55], [-250, 280, 45], [280, 260, 60], [0, -320, 50],
      [-270, -40, 34], [272, 60, 36], [-264, 120, 28], [274, -120, 30],
    ],
    mood: {
      zenith: 0x2a6fc8, horizon: 0xf0d9b0, shallow: 0x2a88b8, deep: 0x0a3a63, fog: 0x88bbee,
      waveAmp: 1.15, cloudTint: 0xffffff, cloudOpacity: 0.7, cloudCount: 9,
      hemiSky: 0xbfe3ff, hemiGround: 0x2a5a7a, hemiInt: 0.75, sunColor: 0xfff2d0, sunInt: 1.2, sunDisc: 0xfff3b0,
    },
  },
  { // L3 — Fırtına Kanalı: longer storm loop, heavy seas, more mines & debris
    name: "Fırtına Kanalı", start: [0, -170], startHeading: 0,
    gates: [
      [0, -140, 0, "gate", 16], [30, -110, 0.785, "gate", 14], [60, -80, 0.785, "gate", 14],
      [84, -40, 0.54, "narrow", 12], [88, 4, 0.09, "gate", 12], [70, 44, -0.42, "narrow", 10],
      [34, 70, -0.95, "gate", 12], [-6, 88, -1.19, "gate", 12], [-48, 104, -1.21, "narrow", 10],
      [-84, 130, -0.95, "gate", 14], [-50, 160, 0.85, "ramp", 16], [-14, 186, 0.95, "finish", 18],
    ],
    rocks: [
      [150, -6, 3], [158, -20, 2.5], [146, -26, 3.5], [154, 8, 2.5],
      [-150, 60, 3], [-158, 46, 2.5], [-146, 74, 3.5], [-154, 36, 2.5],
      [20, -180, 3], [28, -168, 2.5], [14, -162, 3],
    ],
    mines: [
      [104, -14], [112, 0], [100, 10], [108, -26], [98, -32], [114, -8],
      [-70, 84], [-62, 96], [-78, 92], [-84, 72], [-58, 74],
      [-34, 140], [-26, 150], [-42, 148],
    ],
    debris: [
      [120, -40, true], [128, -28, false], [116, -18, true], [124, -52, false], [110, -8, true],
      [-104, 96, true], [-112, 108, false], [-98, 116, true], [-108, 84, false], [-92, 74, true],
      [44, -118, true], [54, -102, false], [60, -94, true], [56, -122, false], [66, -108, true],
    ],
    barriers: [[86, -18, "z", 8, 1.5, 12], [-27, 96, "x", 8, 1.6, 12]],
    whirlpools: [[46, -132, 10], [-20, 52, 10], [-64, 176, 10]],
    ramps: [[78, -46, 0.54, 12], [-50, 160, 0.85, 16]],
    rings: [[0, -155], [15, -125], [45, -95], [72, -60], [87, 24], [52, 57], [14, 79], [-66, 117], [-32, 173]],
    oils: [[-24, -120], [100, -46], [104, 20], [-90, 120], [-6, 156]],
    islands: [[-280, -260, 40], [300, -200, 55], [-250, 280, 45], [280, 260, 60], [0, -320, 50]],
    mood: {
      zenith: 0x1a2438, horizon: 0x4a5a72, shallow: 0x1c4a63, deep: 0x06223a, fog: 0x3a4a5e,
      waveAmp: 1.7, cloudTint: 0x556070, cloudOpacity: 0.85, cloudCount: 12,
      hemiSky: 0x6a7a9a, hemiGround: 0x1a2a3a, hemiInt: 0.55, sunColor: 0xb0bccf, sunInt: 0.7, sunDisc: 0x99aabb,
    },
  },
];

const Course = {
  checkpoints: [] as Checkpoint[],
  rocks: [] as Rock[],
  mines: [] as Mine[],
  debris: [] as Debris[],
  barriers: [] as Barrier[],
  whirlpools: [] as Whirlpool[],
  ramps: [] as Ramp[],
  boostRings: [] as BoostRing[],
  oils: [] as OilSlick[],
  current: 0,          // index of next checkpoint to pass
  geos: [] as THREE.BufferGeometry[], // course-owned geos/mats (disposed on rebuild)
  mats: [] as THREE.Material[],
  clear(scene: THREE.Scene) {
    // Tear down the previous course: remove meshes, dispose owned geos/mats
    for (const cp of this.checkpoints) scene.remove(cp.postL, cp.postR, cp.ring);
    for (const r of this.rocks) scene.remove(r.mesh);
    for (const m of this.mines) scene.remove(m.mesh);
    for (const d of this.debris) scene.remove(d.mesh);
    for (const b of this.barriers) scene.remove(b.group);
    for (const w of this.whirlpools) scene.remove(w.mesh);
    for (const r of this.ramps) scene.remove(r.mesh);
    for (const r of this.boostRings) scene.remove(r.mesh);
    for (const o of this.oils) scene.remove(o.mesh);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0; this.mats.length = 0;
    this.checkpoints.length = 0; this.rocks.length = 0; this.mines.length = 0;
    this.debris.length = 0; this.barriers.length = 0; this.whirlpools.length = 0;
    this.ramps.length = 0; this.boostRings.length = 0; this.oils.length = 0;
  },
  build(scene: THREE.Scene, def: LevelDef) {
    const postMat = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
    const postMat2 = new THREE.MeshLambertMaterial({ color: 0xff4444 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    this.mats.push(postMat, postMat2, ringMat);

    const mkGate = (x: number, z: number, angle: number, type: Checkpoint["type"], gap = 14) => {
      const postGeo = new THREE.CylinderGeometry(0.6, 0.8, 8, 8);
      this.geos.push(postGeo);
      const postL = new THREE.Mesh(postGeo, type === "finish" ? postMat2 : postMat);
      const postR = new THREE.Mesh(postGeo, type === "finish" ? postMat2 : postMat);
      const half = gap / 2;
      const dx = Math.sin(angle) * half, dz = Math.cos(angle) * half;
      postL.position.set(x + dx, 4, z + dz);
      postR.position.set(x - dx, 4, z - dz);
      scene.add(postL, postR);
      // glowing ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(gap / 2, 0.35, 8, 24), ringMat);
      this.geos.push(ring.geometry);
      ring.position.set(x, 1.2, z);
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = angle;
      scene.add(ring);
      this.checkpoints.push({ x, z, angle, type, passed: false, postL, postR, ring });
    };

    // --- Course layout: gates come from the level definition ---
    // Gates are spaced so the "missed gate" penalty only fires when the boat
    // genuinely overshoots a gate instead of passing it. angle = travel
    // direction toward the gate.
    for (const [x, z, angle, type, gap] of def.gates) mkGate(x, z, angle, type, gap);

    // --- Rocks (static collision) — grouped in deliberate clusters, each
    // well clear of the racing line, gates and rings ---
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x5a5a6a });
    this.mats.push(rockMat);
    for (const [x, z, r] of def.rocks) {
      const geo = new THREE.DodecahedronGeometry(r, 0);
      this.geos.push(geo);
      const mesh = new THREE.Mesh(geo, rockMat);
      mesh.position.set(x, r * 0.4, z);
      mesh.rotation.set(Math.random(), Math.random(), Math.random());
      scene.add(mesh);
      this.rocks.push({ mesh, x, z, r: r + 1 });
    }

    // --- Mines (floating, pulsing red) — tight minefields inside the course
    // bends; tempting shortcut lines, easy to spot ---
    const mineMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const mineLightMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const mineBodyGeo = new THREE.SphereGeometry(0.9, 8, 8);
    const mineLightGeo = new THREE.SphereGeometry(0.3, 6, 6);
    const mineSpikeGeo = new THREE.ConeGeometry(0.15, 0.5, 4);
    this.mats.push(mineMat, mineLightMat);
    this.geos.push(mineBodyGeo, mineLightGeo, mineSpikeGeo);
    for (const [x, z] of def.mines) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(mineBodyGeo, mineMat);
      group.add(body);
      const light = new THREE.Mesh(mineLightGeo, mineLightMat);
      light.position.y = 1.1;
      group.add(light);
      // spikes
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(mineSpikeGeo, mineMat);
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0);
        spike.lookAt(new THREE.Vector3(Math.cos(a) * 2, Math.sin(a) * 2, 0));
        group.add(spike);
      }
      group.position.set(x, 0.5, z);
      scene.add(group);
      this.mines.push({ mesh: group, x, z, r: 2.2, alive: true, blinkT: Math.random() * 3 });
    }

    // --- Floating debris (wooden crates / barrels) — flotillas adrift
    // just off the racing line, with clear gaps to steer through ---
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x666677 });
    const crateGeo = new THREE.BoxGeometry(2.2, 1.6, 2.2);
    const barrelGeo = new THREE.CylinderGeometry(0.9, 0.9, 2, 8);
    this.mats.push(crateMat, barrelMat);
    this.geos.push(crateGeo, barrelGeo);
    for (const [x, z, isCrate] of def.debris) {
      const mesh = isCrate
        ? new THREE.Mesh(crateGeo, crateMat)
        : new THREE.Mesh(barrelGeo, barrelMat);
      mesh.position.set(x, 0.6, z);
      mesh.rotation.y = Math.random() * Math.PI;
      scene.add(mesh);
      this.debris.push({ mesh, x, z, r: 2, bobT: Math.random() * 5 });
    }

    // --- Moving barriers (slide across the path) — placed on open stretches
    // between gates so they are visible early and dodgeable ---
    const barrierMat = new THREE.MeshLambertMaterial({ color: 0xcc3333 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    this.mats.push(barrierMat, stripeMat);
    const mkBarrier = (x: number, z: number, axis: "x" | "z", range: number, speed: number, w: number) => {
      const group = new THREE.Group();
      const barGeo = new THREE.BoxGeometry(axis === "x" ? w : 1.2, 2.5, axis === "z" ? w : 1.2);
      const bar = new THREE.Mesh(barGeo, barrierMat);
      group.add(bar);
      // warning stripes
      const stripeGeo = new THREE.BoxGeometry(axis === "x" ? w : 1.3, 0.5, axis === "z" ? w : 1.3);
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.y = 0.8;
      group.add(stripe);
      this.geos.push(barGeo, stripeGeo);
      group.position.set(x, 1.2, z);
      scene.add(group);
      this.barriers.push({ group, x, z, axis, range, speed, t: Math.random() * 10, w });
    };
    for (const [x, z, axis, range, speed, w] of def.barriers) mkBarrier(x, z, axis, range, speed, w);

    // --- Whirlpools (pull the boat in) — side eddies beside the racing line ---
    const whirlMat = new THREE.MeshBasicMaterial({ color: 0x2244aa, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    this.mats.push(whirlMat);
    for (const [x, z, r] of def.whirlpools) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(r * 0.3, r, 24), whirlMat);
      this.geos.push(mesh.geometry);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.15, z);
      scene.add(mesh);
      this.whirlpools.push({ x, z, r, mesh });
    }

    // --- Ramps (launch the boat) ---
    const rampMat = new THREE.MeshLambertMaterial({ color: 0x44aacc });
    this.mats.push(rampMat);
    const mkRamp = (x: number, z: number, angle: number, len: number) => {
      const geo = new THREE.BoxGeometry(10, 0.5, len);
      this.geos.push(geo);
      const mesh = new THREE.Mesh(geo, rampMat);
      mesh.position.set(x, 0.5, z);
      mesh.rotation.y = angle;
      mesh.rotation.x = -0.18; // tilt up
      scene.add(mesh);
      this.ramps.push({ x, z, angle, mesh, len });
    };
    for (const [x, z, angle, len] of def.ramps) mkRamp(x, z, angle, len);

    // --- Boost rings (glowing hoops between gates; refill nitro when passed) ---
    // Centered on the racing line at segment midpoints, clear of ramps/barriers.
    const ringGeo = new THREE.TorusGeometry(5.5, 0.5, 8, 24);
    this.geos.push(ringGeo);
    for (const [x, z] of def.rings) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
      this.mats.push(mat);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.6, z);
      scene.add(mesh);
      this.boostRings.push({ mesh, x, z, r: 5.5, cooldown: 0, pulse: 0 });
    }

    // --- Oil slicks (dark patches that steal steering grip) — clearly
    // visible side traps ~12 units off the racing line, never blocking a lane ---
    const slickGeo = new THREE.CircleGeometry(6, 20);
    this.geos.push(slickGeo);
    for (const [x, z] of def.oils) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x14100a, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
      this.mats.push(mat);
      const mesh = new THREE.Mesh(slickGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.14, z);
      scene.add(mesh);
      this.oils.push({ mesh, x, z, r: 6, pulse: 0 });
    }
  },
  reset() {
    for (const cp of this.checkpoints) cp.passed = false;
    for (const m of this.mines) { m.alive = true; (m.mesh.children[1] as THREE.Mesh).visible = true; }
    for (const r of this.boostRings) { r.cooldown = 0; r.pulse = 0; r.mesh.scale.setScalar(1); }
    for (const o of this.oils) { o.pulse = 0; o.mesh.scale.setScalar(1); }
    this.current = 0;
  },
};

/* Rebuild the scene course for a level: clear the old course objects, build
   the new one, move the start line and restyle the world (ocean/sky/lights). */
function buildCourse(scene: THREE.Scene, level: number) {
  const def = LEVELS[level - 1];
  Course.clear(scene);
  Course.build(scene, def);
  START_POS.x = def.start[0];
  START_POS.z = def.start[1];
  applyMood(scene, def.mood);
  rebuildEnvironment(scene, level);
}

/* ================= 5. BOAT ================= */
const Boat = {
  group: new THREE.Group(),
  pos: new THREE.Vector3(0, 0, -160),
  vel: new THREE.Vector3(),
  heading: 0,            // radians, 0 = +Z (north)
  speed: 0,
  vy: 0,
  airborne: false,
  airTime: 0,
  health: 100,
  boostEnergy: 100,
  invuln: 0,
  slippery: 0,           // seconds of reduced grip left (oil slick)
  // visual refs
  hull: null as THREE.Mesh | null,
  cabin: null as THREE.Mesh | null,
  nitroGlow: null as THREE.Mesh | null,
  flameGeo: null as THREE.BufferGeometry | null, // shared boost-flame geometry
  wakeGeo: null as THREE.CircleGeometry | null,  // shared wake-ring geometry
  sprayGeo: null as THREE.SphereGeometry | null, // shared spray-particle geometry
  wakePool: [] as THREE.Mesh[],   // pre-built wake meshes (recycled, no churn)
  sprayPool: [] as THREE.Mesh[],  // pre-built spray meshes
  flamePool: [] as THREE.Mesh[],  // pre-built flame meshes
  wakeTrail: [] as THREE.Mesh[],
  sprayParticles: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[],
  flameParticles: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[],

  build(scene: THREE.Scene) {
    const g = this.group;
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x1e5eff, side: THREE.DoubleSide });
    const deckMat = new THREE.MeshLambertMaterial({ color: 0xf2f4f8 });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a2230 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55 });

    // --- Sleek hull: a tapered, pointed planing hull (custom geometry) ---
    // Cross-sections from stern (z=-3.5) to bow (z=+4.2). Width narrows to a point.
    const sections: { z: number; halfW: number; yBot: number; yTop: number }[] = [
      { z: -3.5, halfW: 0.55, yBot: -0.5, yTop: 0.7 },   // stern (narrow, flat)
      { z: -2.0, halfW: 1.05, yBot: -0.6, yTop: 0.9 },
      { z: -0.5, halfW: 1.25, yBot: -0.7, yTop: 1.0 },   // widest
      { z: 1.0, halfW: 1.15, yBot: -0.6, yTop: 1.05 },
      { z: 2.5, halfW: 0.85, yBot: -0.4, yTop: 1.1 },
      { z: 4.2, halfW: 0.05, yBot: 0.1, yTop: 1.25 },    // bow point (raked up)
    ];
    const n = sections.length;
    const verts: number[] = [];
    const idx: number[] = [];
    // Build a strip: for each section, 4 verts (left-bot, right-bot, right-top, left-top)
    for (const s of sections) {
      verts.push(-s.halfW, s.yBot, s.z); // 0 left-bot
      verts.push(s.halfW, s.yBot, s.z);  // 1 right-bot
      verts.push(s.halfW, s.yTop, s.z);  // 2 right-top
      verts.push(-s.halfW, s.yTop, s.z); // 3 left-top
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 4, b = (i + 1) * 4;
      // bottom
      idx.push(a, b, b + 1, a, b + 1, a + 1);
      // right side
      idx.push(b + 1, b + 2, b + 5, b + 1, b + 5, b + 4);
      // left side
      idx.push(a + 1, a + 4, a + 5, a + 1, a + 5, a + 2);
      // top (deck)
      idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
    }
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    hullGeo.setIndex(idx);
    hullGeo.computeVertexNormals();
    this.hull = new THREE.Mesh(hullGeo, hullMat);
    this.hull.position.y = 0.7;
    g.add(this.hull);

    // --- Flat bottom cap (closes the hull so it's not see-through) ---
    const bottomGeo = new THREE.BufferGeometry();
    const bottomVerts: number[] = [];
    const bottomIdx: number[] = [];
    for (const s of sections) {
      bottomVerts.push(-s.halfW, s.yBot, s.z);
      bottomVerts.push(s.halfW, s.yBot, s.z);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = (i + 1) * 2;
      bottomIdx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    bottomGeo.setAttribute("position", new THREE.Float32BufferAttribute(bottomVerts, 3));
    bottomGeo.setIndex(bottomIdx);
    bottomGeo.computeVertexNormals();
    const bottomCap = new THREE.Mesh(bottomGeo, hullMat);
    bottomCap.position.y = 0.7;
    g.add(bottomCap);

    // --- Deck strip (white racing stripe running down the center) ---
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 7.2), deckMat);
    stripe.position.set(0, 1.72, 0.2);
    g.add(stripe);

    // --- Accent side stripes ---
    const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 6.4), accentMat);
    stripeL.position.set(-0.95, 1.5, 0.1);
    const stripeR = stripeL.clone();
    stripeR.position.x = 0.95;
    g.add(stripeL, stripeR);

    // --- Cabin / console (sleek, low) ---
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 2.2), darkMat);
    cabin.position.set(0, 1.9, -0.6);
    this.cabin = cabin;
    g.add(cabin);
    // Cabin roof accent
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 2.3), accentMat);
    roof.position.set(0, 2.4, -0.6);
    g.add(roof);
    // Windshield (angled)
    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.08), glassMat);
    ws.position.set(0, 2.0, 0.62);
    ws.rotation.x = -0.5;
    g.add(ws);
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.7), accentMat);
    seat.position.set(0, 1.85, -0.9);
    g.add(seat);

    // --- Outboard motor (stern) ---
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.5), darkMat);
    motor.position.set(0, 0.7, -3.7);
    g.add(motor);
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 8), new THREE.MeshLambertMaterial({ color: 0x888899 }));
    prop.rotation.x = Math.PI / 2;
    prop.position.set(0, 0.35, -3.95);
    g.add(prop);

    // --- Railings (thin stanchion lines along the deck edges + bow rail) ---
    const railMat = new THREE.MeshLambertMaterial({ color: 0xdfe6ee });
    const railGeo = new THREE.BoxGeometry(0.08, 0.08, 6.6);
    const railL = new THREE.Mesh(railGeo, railMat);
    railL.position.set(-1.12, 1.16, 0.1);
    const railR = railL.clone();
    railR.position.x = 1.12;
    g.add(railL, railR);
    const bowRail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), railMat);
    bowRail.position.set(0, 1.2, 2.9);
    g.add(bowRail);
    // Stanchions
    const stGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4);
    for (const sz of [-2.6, -0.9, 0.9, 2.4]) {
      const sL = new THREE.Mesh(stGeo, railMat); sL.position.set(-1.12, 0.9, sz);
      const sR = new THREE.Mesh(stGeo, railMat); sR.position.set(1.12, 0.9, sz);
      g.add(sL, sR);
    }

    // --- Flag on a stern pole (fluttering pennant) ---
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), railMat);
    pole.position.set(0.55, 1.5, -3.2);
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.04), new THREE.MeshLambertMaterial({ color: 0xdd2233 }));
    flag.position.set(0.9, 2.15, -3.2);
    g.add(flag);

    // --- Nitro glow (visible when boosting) ---
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x33ccff, transparent: true, opacity: 0 });
    const glow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 8), glowMat);
    glow.rotation.x = Math.PI / 2; // point backward
    glow.position.set(0, 0.6, -4.6);
    this.nitroGlow = glow;
    g.add(glow);

    // Shared geometries for particles (one geo, pooled meshes — no per-frame churn)
    this.flameGeo = new THREE.SphereGeometry(0.22, 6, 6);
    this.wakeGeo = new THREE.CircleGeometry(0.6, 6);
    this.sprayGeo = new THREE.SphereGeometry(0.18, 4, 4);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(this.wakeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
      this.wakePool.push(m);
    }
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(this.sprayGeo, new THREE.MeshBasicMaterial({ color: 0xcceeff, transparent: true, opacity: 0 }));
      m.visible = false; scene.add(m);
      this.sprayPool.push(m);
    }
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(this.flameGeo, new THREE.MeshBasicMaterial({ color: 0x33ccff, transparent: true, opacity: 0 }));
      m.visible = false; scene.add(m);
      this.flamePool.push(m);
    }

    scene.add(g);
    this.syncVisual();
  },
  syncVisual() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    // Tilt: pitch up when airborne, roll when turning
    const roll = -Input.steer * Math.min(1, Math.abs(this.speed) / MAX_SPEED) * 0.35;
    const pitch = this.airborne ? -0.25 : 0;
    this.group.rotation.z = roll;
    this.group.rotation.x = pitch;
  },
  reset(keepHealth = false) {
    const def = LEVELS[game.level - 1];
    this.pos.set(def.start[0], 0, def.start[1]);
    this.vel.set(0, 0, 0);
    this.heading = def.startHeading;
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    if (!keepHealth) this.health = 100; // health carries over between levels
    this.boostEnergy = 100;
    this.invuln = 2;
    this.slippery = 0;
    this.syncVisual();
  },
  damage(amount: number, source: string) {
    if (this.invuln > 0) return;
    this.health -= amount * DIFFICULTIES[game.difficulty].damage;
    this.invuln = 1.2;
    AudioSys.crash();
    game.addPenalty(source === "mine" ? CRASH_PENALTY : CRASH_PENALTY);
    spawnSpray(this.pos.x, this.pos.y + 1, this.pos.z, 14);
    if (this.health <= 0) {
      this.health = 0;
      game.gameOver();
    }
    updateHUD();
  },
  update(dt: number, waveH: (x: number, z: number) => number) {
    if (game.state !== "playing") return;
    if (this.invuln > 0) this.invuln -= dt;

    // --- Throttle / brake ---
    const boosting = Input.boosting;
    const accel = boosting ? BOAT_ACCEL * BOOST_MULT : BOAT_ACCEL;
    if (Input.throttle) {
      this.speed += accel * dt;
      if (boosting) {
        this.boostEnergy = Math.max(0, this.boostEnergy - BOOST_DRAIN * DIFFICULTIES[game.difficulty].boost * dt);
        if (this.boostEnergy <= 0) AudioSys.boost();
      }
    } else {
      this.boostEnergy = Math.min(100, this.boostEnergy + BOOST_REGEN * dt);
    }
    if (Input.brake) this.speed -= BOAT_BRAKE * dt;
    // Water drag (quadratic)
    this.speed -= this.speed * DRAG * dt * (this.airborne ? 0.15 : 1);
    this.speed = Math.max(0, Math.min(boosting ? MAX_SPEED * BOOST_MULT : MAX_SPEED, this.speed));

    // --- Nitro glow (flares when boosting) ---
    if (this.nitroGlow) {
      const target = boosting && Input.throttle ? 0.85 : 0;
      const m = this.nitroGlow.material as THREE.MeshBasicMaterial;
      m.opacity += (target - m.opacity) * Math.min(1, dt * 12);
      this.nitroGlow.scale.set(1, 1, 0.6 + Math.random() * 0.5);
    }

    // --- Steering (more effective at speed) ---
    const turnEff = TURN_EFF_MIN + (1 - TURN_EFF_MIN) * Math.min(1, this.speed / (MAX_SPEED * 0.5));
    // Oil slick: steering barely bites while slippery, plus a slack wobble
    const grip = this.slippery > 0 ? GRIP_LOSS : 1;
    if (this.slippery > 0) {
      this.slippery -= dt;
      this.heading += (Math.random() - 0.5) * 0.9 * dt * Math.min(1, this.speed / MAX_SPEED);
    }
    // heading 0 = +Z (north), forward dir = (sin h, cos h). Pressing D
    // (steer=+1) swings the bow toward +X (east) = DECREASING heading.
    this.heading -= Input.steer * TURN_RATE * turnEff * grip * dt * (this.speed > 1 ? 1 : 0);

    // --- Move forward ---
    const dirX = Math.sin(this.heading), dirZ = Math.cos(this.heading);
    this.pos.x += dirX * this.speed * dt;
    this.pos.z += dirZ * this.speed * dt;
    // Apply bounce velocity (set by collision response), then decay it
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.vel.x *= (1 - 6 * dt);
    this.vel.z *= (1 - 6 * dt);
    if (Math.abs(this.vel.x) < 0.05) this.vel.x = 0;
    if (Math.abs(this.vel.z) < 0.05) this.vel.z = 0;

    // --- Whirlpool pull ---
    for (const w of Course.whirlpools) {
      const dx = w.x - this.pos.x, dz = w.z - this.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < w.r && dist > 0.5) {
        const pull = WHIRL_PULL * (1 - dist / w.r) * dt;
        this.pos.x += (dx / dist) * pull;
        this.pos.z += (dz / dist) * pull;
        this.speed *= (1 - 0.4 * dt);
      }
    }

    // --- Arena bounds (soft push back) ---
    if (Math.abs(this.pos.x) > ARENA) { this.pos.x = Math.sign(this.pos.x) * ARENA; this.speed *= 0.5; }
    if (Math.abs(this.pos.z) > ARENA) { this.pos.z = Math.sign(this.pos.z) * ARENA; this.speed *= 0.5; }

    // --- Ramp launch ---
    if (!this.airborne) {
      for (const r of Course.ramps) {
        const dx = this.pos.x - r.x, dz = this.pos.z - r.z;
        if (dx * dx + dz * dz < (r.len / 2 + 2) ** 2) {
          // On ramp: launch if moving fast enough and roughly aligned
          const align = Math.abs(this.heading - r.angle);
          const aligned = Math.min(align, Math.PI * 2 - align) < 1.0;
          if (this.speed > 18 && aligned) {
            this.airborne = true;
            this.airTime = 0;
            this.vy = this.speed * 0.22;
            AudioSys.splash();
          }
        }
      }
    }

    // --- Airborne / landing ---
    if (this.airborne) {
      this.airTime += dt;
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.airborne = false;
        // Landing effect
        const impact = Math.abs(this.vy);
        spawnSpray(this.pos.x, 0.5, this.pos.z, Math.min(24, 8 + impact));
        AudioSys.splash();
        if (impact > 8) this.speed *= 0.85; // hard landing slows you
      }
    } else {
      // Ride the waves
      const h = waveH(this.pos.x, this.pos.z);
      this.pos.y = h * 0.5;
      // Wave bounce: if moving fast over a crest, small hop
      if (this.speed > 25) {
        const hAhead = waveH(this.pos.x + dirX * 3, this.pos.z + dirZ * 3);
        if (hAhead - h > 0.6) {
          this.airborne = true;
          this.vy = WAVE_BOUNCE * (hAhead - h);
          this.airTime = 0;
        }
      }
    }

    // --- Boost flame particles (polish: trail behind the stern, pooled meshes) ---
    if (boosting && Input.throttle && this.speed > 5 && this.flameGeo) {
      for (let i = 0; i < 2; i++) {
        const mesh = this.flamePool.pop();
        if (!mesh) break;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(Math.random() < 0.5 ? 0x33ccff : 0xffaa33);
        mat.opacity = 0.9;
        mesh.scale.setScalar(1);
        mesh.visible = true;
        mesh.position.set(
          this.pos.x - dirX * 4.4 + (Math.random() - 0.5) * 0.8,
          this.pos.y + 0.6 + Math.random() * 0.4,
          this.pos.z - dirZ * 4.4 + (Math.random() - 0.5) * 0.8
        );
        this.flameParticles.push({
          mesh,
          vel: new THREE.Vector3(
            -dirX * (6 + this.speed * 0.25) + (Math.random() - 0.5) * 3,
            2 + Math.random() * 3,
            -dirZ * (6 + this.speed * 0.25) + (Math.random() - 0.5) * 3
          ),
          life: 0.35 + Math.random() * 0.25,
        });
      }
    }

    // --- Wake trail (pooled foam rings spreading behind the stern) ---
    if (this.speed > 5 && Math.random() < 0.6) {
      const wake = this.wakePool.pop();
      if (wake) {
        (wake.material as THREE.MeshBasicMaterial).opacity = 0.5;
        wake.scale.setScalar(0.8 + Math.random() * 0.7);
        wake.visible = true;
        wake.position.set(this.pos.x - dirX * 3.5, 0.12, this.pos.z - dirZ * 3.5);
        this.wakeTrail.push(wake);
      }
    }
    for (let i = this.wakeTrail.length - 1; i >= 0; i--) {
      const w = this.wakeTrail[i];
      const wm = w.material as THREE.MeshBasicMaterial;
      wm.opacity -= dt * 0.5;
      w.scale.multiplyScalar(1 + dt * 0.8); // foam spreads as it fades
      if (wm.opacity <= 0) {
        w.visible = false;
        w.scale.setScalar(1);
        this.wakePool.push(w);
        this.wakeTrail.splice(i, 1);
      }
    }
    // Spray particles
    for (let i = this.sprayParticles.length - 1; i >= 0; i--) {
      const p = this.sprayParticles[i];
      p.life -= dt;
      p.vel.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life;
      if (p.life <= 0) {
        p.mesh.visible = false;
        p.mesh.scale.setScalar(1);
        this.sprayPool.push(p.mesh);
        this.sprayParticles.splice(i, 1);
      }
    }
    // Boost flame particles fade & shrink
    for (let i = this.flameParticles.length - 1; i >= 0; i--) {
      const p = this.flameParticles[i];
      p.life -= dt;
      p.vel.y -= 6 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life * 2.5);
      p.mesh.scale.setScalar(Math.max(0.2, p.life * 2));
      if (p.life <= 0) {
        p.mesh.visible = false;
        p.mesh.scale.setScalar(1);
        this.flamePool.push(p.mesh);
        this.flameParticles.splice(i, 1);
      }
    }

    this.syncVisual();
    AudioSys.setEngine(this.speed / (MAX_SPEED * BOOST_MULT), boosting);
  },
};

function spawnSpray(x: number, y: number, z: number, n: number) {
  for (let i = 0; i < n; i++) {
    const mesh = Boat.sprayPool.pop();
    if (!mesh) return; // pool exhausted: cap the spray, no allocation churn
    mesh.visible = true;
    mesh.scale.setScalar(0.8 + Math.random() * 0.8);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    mesh.position.set(x, y, z); // pooled meshes are already in the scene (hidden)
    Boat.sprayParticles.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8),
      life: 0.6 + Math.random() * 0.4,
    });
  }
}

/* ================= 5.5 RIVAL AI BOATS =================
   Simple waypoint racers: steer toward the next checkpoint gate,
   accelerate, and bleed speed through sharp turns. Progress =
   checkpoints passed + fraction of the current segment, used to
   compute the player's race position (P1/P2/...). */
const START_POS = { x: 0, z: -160 }; // start line, moved by buildCourse per level
const RIVAL_OFFSETS: [number, number][] = [[-7, -2], [7, -4], [14, -6]]; // relative to START_POS
const RIVAL_COLORS = [0xcc2244, 0xffaa22, 0x9944dd];
const RIVAL_CSS = ["#cc2244", "#ffaa22", "#9944dd"];

const Rivals = {
  boats: [] as Rival[],

  build(scene: THREE.Scene) {
    // Reuse the player hull geometry; only the paint differs per rival.
    const hullGeo = Boat.hull!.geometry;
    const cabinGeo = new THREE.BoxGeometry(1.3, 0.9, 2.2);
    const roofGeo = new THREE.BoxGeometry(1.4, 0.1, 2.3);
    const stripeGeo = new THREE.BoxGeometry(0.5, 0.06, 7.2);
    const motorGeo = new THREE.BoxGeometry(0.9, 0.9, 0.5);
    const propGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.15, 8);
    const wsGeo = new THREE.BoxGeometry(1.2, 0.7, 0.08);
    const railGeo = new THREE.BoxGeometry(0.08, 0.08, 6.6);
    const flagGeo = new THREE.BoxGeometry(0.7, 0.42, 0.04);
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a2230 });
    const deckMat = new THREE.MeshLambertMaterial({ color: 0xf2f4f8 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55 });
    const propMat = new THREE.MeshLambertMaterial({ color: 0x888899 });

    for (let i = 0; i < RIVAL_COUNT; i++) {
      const g = new THREE.Group();
      const hullMat = new THREE.MeshLambertMaterial({ color: RIVAL_COLORS[i % RIVAL_COLORS.length], side: THREE.DoubleSide });
      const hull = new THREE.Mesh(hullGeo, hullMat);
      hull.position.y = 0.7;
      g.add(hull);
      const cabin = new THREE.Mesh(cabinGeo, darkMat);
      cabin.position.set(0, 1.9, -0.6);
      g.add(cabin);
      // Cabin roof tinted with the rival's paint color
      const roof = new THREE.Mesh(roofGeo, hullMat);
      roof.position.set(0, 2.4, -0.6);
      g.add(roof);
      const ws = new THREE.Mesh(wsGeo, glassMat);
      ws.position.set(0, 2.0, 0.62);
      ws.rotation.x = -0.5;
      g.add(ws);
      const stripe = new THREE.Mesh(stripeGeo, deckMat);
      stripe.position.set(0, 1.72, 0.2);
      g.add(stripe);
      const motor = new THREE.Mesh(motorGeo, darkMat);
      motor.position.set(0, 0.7, -3.7);
      g.add(motor);
      const prop = new THREE.Mesh(propGeo, propMat);
      prop.rotation.x = Math.PI / 2;
      prop.position.set(0, 0.35, -3.95);
      g.add(prop);
      const railL = new THREE.Mesh(railGeo, deckMat);
      railL.position.set(-1.12, 1.16, 0.1);
      const railR = railL.clone();
      railR.position.x = 1.12;
      g.add(railL, railR);
      const flag = new THREE.Mesh(flagGeo, hullMat);
      flag.position.set(0.9, 2.15, -3.2);
      g.add(flag);
      scene.add(g);
      this.boats.push({
        group: g,
        pos: new THREE.Vector3(START_POS.x + RIVAL_OFFSETS[i][0], 0, START_POS.z + RIVAL_OFFSETS[i][1]),
        heading: LEVELS[game.level - 1].startHeading, speed: 0, waypoint: 0,
        skill: 0.9 + i * 0.06, finished: false, progress: 0,
      });
    }
  },

  reset() {
    const def = LEVELS[game.level - 1];
    for (let i = 0; i < this.boats.length; i++) {
      const r = this.boats[i];
      r.pos.set(START_POS.x + RIVAL_OFFSETS[i][0], 0, START_POS.z + RIVAL_OFFSETS[i][1]);
      r.heading = def.startHeading; r.speed = 0; r.waypoint = 0;
      r.finished = false; r.progress = 0;
      r.group.position.copy(r.pos);
      r.group.rotation.set(0, 0, 0);
    }
  },

  update(dt: number, waveH: (x: number, z: number) => number) {
    if (game.state !== "playing") return;
    const rivalMult = DIFFICULTIES[game.difficulty].rival; // difficulty scales AI speed/skill
    for (const r of this.boats) {
      const cp = Course.checkpoints[Math.min(r.waypoint, Course.checkpoints.length - 1)];
      const dx = cp.x - r.pos.x, dz = cp.z - r.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      let steer = 0;

      if (!r.finished) {
        // Reached the gate: advance the waypoint
        if (dist < 9) {
          r.waypoint++;
          if (r.waypoint >= Course.checkpoints.length) r.finished = true;
        }
        // Steer toward the target gate (heading 0 = +Z, dir = (sin h, cos h))
        const target = Math.atan2(dx, dz);
        let diff = target - r.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        steer = Math.max(-1, Math.min(1, diff * 2.5));
        r.heading += steer * TURN_RATE * 0.85 * r.skill * rivalMult * dt;
        r.speed += RIVAL_ACCEL * rivalMult * dt;
        // Bleed speed through sharp turns so gates stay passable
        if (Math.abs(diff) > 0.7) r.speed *= (1 - 1.1 * dt);
        r.speed = Math.min(r.speed, RIVAL_MAX_SPEED * r.skill * rivalMult);
      } else {
        r.speed *= (1 - DRAG * dt); // drifting past the finish line
      }
      r.speed -= r.speed * DRAG * dt; // water drag
      r.pos.x += Math.sin(r.heading) * r.speed * dt;
      r.pos.z += Math.cos(r.heading) * r.speed * dt;
      r.pos.y = waveH(r.pos.x, r.pos.z) * 0.5;

      // Progress: checkpoints passed + fraction of the current segment
      const prev = r.waypoint > 0 ? Course.checkpoints[Math.min(r.waypoint - 1, Course.checkpoints.length - 1)] : START_POS;
      const segLen = Math.max(20, Math.sqrt((cp.x - prev.x) ** 2 + (cp.z - prev.z) ** 2));
      const frac = r.finished ? 0 : Math.max(0, Math.min(1, 1 - dist / segLen));
      r.progress = Math.min(r.waypoint, Course.checkpoints.length) + frac;

      r.group.position.copy(r.pos);
      r.group.rotation.y = r.heading;
      r.group.rotation.z = -steer * Math.min(1, r.speed / MAX_SPEED) * 0.3;
    }
  },

  playerProgress(): number {
    const cp = Course.checkpoints[Math.min(Course.current, Course.checkpoints.length - 1)];
    const prev = Course.current > 0 ? Course.checkpoints[Course.current - 1] : START_POS;
    const segLen = Math.max(20, Math.sqrt((cp.x - prev.x) ** 2 + (cp.z - prev.z) ** 2));
    const dist = Math.sqrt((Boat.pos.x - cp.x) ** 2 + (Boat.pos.z - cp.z) ** 2);
    if (Course.current >= Course.checkpoints.length) return Course.checkpoints.length;
    return Course.current + Math.max(0, Math.min(1, 1 - dist / segLen));
  },

  position(): number {
    const pp = this.playerProgress();
    let ahead = 0;
    for (const r of this.boats) if (r.progress > pp) ahead++;
    return 1 + ahead;
  },

  collide() {
    // Rivals are racers, not hazards: soft push-out, no damage.
    for (const r of this.boats) {
      const dx = Boat.pos.x - r.pos.x, dz = Boat.pos.z - r.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = BOAT_RADIUS + 2.4;
      if (dist < minDist && dist > 0.01) {
        const push = (minDist - dist) / dist;
        Boat.pos.x += dx * push;
        Boat.pos.z += dz * push;
        Boat.speed *= 0.55;
        Boat.vel.set((dx / dist) * 3.5, 0, (dz / dist) * 3.5);
        AudioSys.splash();
      }
    }
  },
};

/* ================= 6. OCEAN ================= */
let oceanGeo: THREE.PlaneGeometry;
let oceanMat: THREE.MeshPhongMaterial;
const OCEAN_SEGS = 60;
const OCEAN_SIZE = ARENA * 2.4;

// Canvas texture: subtle wave ripples + scattered sun glints (procedural)
function makeOceanTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  // Soft diagonal ripple streaks
  g.strokeStyle = "rgba(210,230,255,0.5)";
  g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 20, y - 12, x + 42, y - 4);
    g.stroke();
  }
  // Sun glints: tiny bright sparkles
  g.fillStyle = "rgba(255,255,240,0.85)";
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, s = 1 + Math.random() * 2;
    g.fillRect(x, y, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

function buildOcean(scene: THREE.Scene) {
  oceanGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGS, OCEAN_SEGS);
  // Depth color gradient: shallow teal inside the arena, deep blue toward the rim
  const colors: number[] = [];
  const pos = oceanGeo.attributes.position;
  const deep = new THREE.Color(0x0a3a63), shallow = new THREE.Color(0x2a88b8);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const d = Math.min(1, Math.sqrt(x * x + y * y) / (ARENA * 1.2));
    col.copy(shallow).lerp(deep, d * d);
    colors.push(col.r, col.g, col.b);
  }
  oceanGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  oceanMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    map: makeOceanTexture(),
    specular: 0x9fdcff,
    shininess: 60,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);
}
// Simple analytical wave height (sum of sines) — used for both visual & physics.
// waveAmp scales the sea state per level (storm levels run bigger waves).
let waveAmp = 1;
function waveH(x: number, z: number, t: number) {
  return (
    (Math.sin(x * 0.08 + t * 1.2) * 0.5 +
    Math.sin(z * 0.1 + t * 0.9) * 0.4 +
    Math.sin((x + z) * 0.05 + t * 1.6) * 0.3) * waveAmp
  );
}
function updateOcean(t: number) {
  const pos = oceanGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i); // this is actually Z in world (plane rotated)
    pos.setZ(i, waveH(x, -y, t));
  }
  pos.needsUpdate = true;
  oceanGeo.computeVertexNormals();
}

/* ================= 7. ENVIRONMENT (islands, birds, sky, clouds) ================= */
let birds: { mesh: THREE.Group; angle: number; radius: number; speed: number; y: number }[] = [];
let clouds: THREE.Sprite[] = [];
let envGroup: THREE.Group;                    // all level scenery lives here (rebuilt per level)
let envGeos: THREE.BufferGeometry[] = [];     // env-owned geos/mats (disposed on rebuild)
let envMats: THREE.Material[] = [];
let cloudTex: THREE.CanvasTexture | null = null; // shared cloud texture (built once)
let hemiLight: THREE.HemisphereLight;         // recolored by applyMood per level
let sunLight: THREE.DirectionalLight;

// Canvas texture: soft blobby cloud (procedural)
function makeCloudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.55, "rgba(250,252,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  // Three overlapping blobs for a puffy silhouette
  for (const [bx, by, br] of [[52, 66, 34], [78, 58, 30], [64, 78, 26]] as [number, number, number][]) {
    const rg = g.createRadialGradient(bx, by, 2, bx, by, br);
    rg.addColorStop(0, "rgba(255,255,255,0.85)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

/* Restyle the world for a level's mood: sky dome colors, ocean depth gradient,
   fog, lights & wave amplitude. Static per level (no day cycle). */
function applyMood(scene: THREE.Scene, mood: LevelDef["mood"]) {
  waveAmp = mood.waveAmp;
  // Recolor the ocean depth gradient (shallow teal → deep blue, darker in storms)
  const pos = oceanGeo.attributes.position;
  const colors = oceanGeo.getAttribute("color") as THREE.BufferAttribute;
  const deep = new THREE.Color(mood.deep), shallow = new THREE.Color(mood.shallow);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const d = Math.min(1, Math.sqrt(x * x + y * y) / (ARENA * 1.2));
    col.copy(shallow).lerp(deep, d * d);
    colors.setXYZ(i, col.r, col.g, col.b);
  }
  colors.needsUpdate = true;
  if (scene.fog) (scene.fog as THREE.Fog).color.setHex(mood.fog);
  hemiLight.color.setHex(mood.hemiSky);
  hemiLight.groundColor.setHex(mood.hemiGround);
  hemiLight.intensity = mood.hemiInt;
  sunLight.color.setHex(mood.sunColor);
  sunLight.intensity = mood.sunInt;
}

function rebuildEnvironment(scene: THREE.Scene, level: number) {
  const def = LEVELS[level - 1];
  const mood = def.mood;
  // Tear down the previous scenery (dispose only env-owned geos/mats)
  for (const c of envGroup.children) envGroup.remove(c);
  for (const g of envGeos) g.dispose();
  for (const m of envMats) m.dispose();
  envGeos.length = 0; envMats.length = 0;
  birds.length = 0; clouds.length = 0;

  // Sky dome (gradient via large sphere with vertex colors: horizon → zenith)
  const skyGeo = new THREE.SphereGeometry(500, 16, 12);
  const skyColors: number[] = [];
  const pos = skyGeo.attributes.position;
  const zenith = new THREE.Color(mood.zenith), horizon = new THREE.Color(mood.horizon);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 500; // -1..1
    col.copy(horizon).lerp(zenith, Math.max(0, Math.min(1, y * 1.4 + 0.1)));
    skyColors.push(col.r, col.g, col.b);
  }
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(skyColors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  envGroup.add(new THREE.Mesh(skyGeo, skyMat));
  envGeos.push(skyGeo); envMats.push(skyMat);

  // Sun disc + soft additive halo (dimmer behind storm clouds)
  const sunPos = new THREE.Vector3(150, 120, -200);
  const sunGeo = new THREE.SphereGeometry(12, 12, 12);
  const sunMat = new THREE.MeshBasicMaterial({ color: mood.sunDisc });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.copy(sunPos);
  envGroup.add(sun);
  const haloGeo = new THREE.SphereGeometry(20, 12, 12);
  const haloMat = new THREE.MeshBasicMaterial({ color: mood.sunDisc, transparent: true, opacity: mood.sunInt < 1 ? 0.12 : 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(sunPos);
  envGroup.add(halo);
  envGeos.push(sunGeo, haloGeo); envMats.push(sunMat, haloMat);

  // Drifting cloud sprites (shared texture, gentle eastward drift; gloomier in storms)
  if (!cloudTex) cloudTex = makeCloudTexture();
  for (let i = 0; i < mood.cloudCount; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, color: mood.cloudTint, transparent: true, opacity: mood.cloudOpacity, depthWrite: false });
    envMats.push(mat);
    const sp = new THREE.Sprite(mat);
    sp.scale.set(60 + Math.random() * 50, 22 + Math.random() * 16, 1);
    sp.position.set(-380 + Math.random() * 760, 70 + Math.random() * 90, -300 + Math.random() * 500);
    envGroup.add(sp);
    clouds.push(sp);
  }

  // Distant islands: sand base + green hill + surf ring + palms + rocks
  const islandMat = new THREE.MeshLambertMaterial({ color: 0x3a7a4a });
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xd4c088 });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f8a44 });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x6a6a78 });
  const surfMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 7, 6);
  const frondGeo = new THREE.ConeGeometry(0.55, 3.6, 4);
  const isRockGeo = new THREE.DodecahedronGeometry(2.2, 0);
  envMats.push(islandMat, sandMat, trunkMat, frondMat, rockMat, surfMat);
  envGeos.push(trunkGeo, frondGeo, isRockGeo);
  for (const [x, z, r] of def.islands) {
    const baseGeo = new THREE.CylinderGeometry(r, r * 1.3, 6, 10);
    const hillGeo = new THREE.ConeGeometry(r * 0.7, r * 0.8, 8);
    const surfGeo = new THREE.RingGeometry(r * 1.02, r * 1.22, 24);
    envGeos.push(baseGeo, hillGeo, surfGeo);
    const base = new THREE.Mesh(baseGeo, sandMat);
    base.position.set(x, 2, z);
    envGroup.add(base);
    const hill = new THREE.Mesh(hillGeo, islandMat);
    hill.position.set(x, 6 + r * 0.3, z);
    envGroup.add(hill);
    // Surf ring: white foam band hugging the shoreline
    const surf = new THREE.Mesh(surfGeo, surfMat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(x, 0.3, z);
    envGroup.add(surf);
    // Palms (trunk + 5 fronds), rocks on the beach
    for (let p = 0; p < 2; p++) {
      const a = Math.random() * Math.PI * 2;
      const px = x + Math.cos(a) * r * 0.55, pz = z + Math.sin(a) * r * 0.55;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(px, 6.5, pz);
      trunk.rotation.z = (Math.random() - 0.5) * 0.3;
      envGroup.add(trunk);
      for (let f = 0; f < 5; f++) {
        const fr = new THREE.Mesh(frondGeo, frondMat);
        const fa = (f / 5) * Math.PI * 2;
        fr.position.set(px + Math.cos(fa) * 1.1, 10.2, pz + Math.sin(fa) * 1.1);
        fr.rotation.set(Math.cos(fa) * 1.25, 0, -Math.sin(fa) * 1.25);
        envGroup.add(fr);
      }
    }
    for (let k = 0; k < 2; k++) {
      const a = Math.random() * Math.PI * 2;
      const rk = new THREE.Mesh(isRockGeo, rockMat);
      rk.position.set(x + Math.cos(a) * r * 0.8, 1.2, z + Math.sin(a) * r * 0.8);
      rk.rotation.set(Math.random(), Math.random(), Math.random());
      rk.scale.setScalar(0.6 + Math.random() * 0.8);
      envGroup.add(rk);
    }
  }

  // Birds (simple V-shapes circling; fewer in the storm)
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  envMats.push(birdMat);
  const wingGeo = new THREE.BoxGeometry(1.5, 0.05, 0.4);
  envGeos.push(wingGeo);
  const birdCount = level === 3 ? 3 : 6;
  for (let i = 0; i < birdCount; i++) {
    const g = new THREE.Group();
    const w1 = new THREE.Mesh(wingGeo, birdMat);
    w1.position.x = 0.7;
    const w2 = new THREE.Mesh(wingGeo, birdMat);
    w2.position.x = -0.7;
    g.add(w1, w2);
    const radius = 60 + Math.random() * 80;
    g.position.set(Math.cos(i) * radius, 40 + Math.random() * 20, Math.sin(i) * radius);
    envGroup.add(g);
    birds.push({ mesh: g, angle: i, radius, speed: 0.15 + Math.random() * 0.1, y: 40 + Math.random() * 20 });
  }
}
function updateClouds(dt: number) {
  for (const c of clouds) {
    c.position.x += dt * 3.5;
    if (c.position.x > 420) c.position.x = -420;
  }
}
function updateBirds(dt: number) {
  for (const b of birds) {
    b.angle += b.speed * dt;
    b.mesh.position.x = Math.cos(b.angle) * b.radius;
    b.mesh.position.z = Math.sin(b.angle) * b.radius;
    b.mesh.position.y = b.y + Math.sin(b.angle * 3) * 2;
    b.mesh.rotation.y = -b.angle;
    // Flap
    const flap = Math.sin(Date.now() * 0.01) * 0.4;
    (b.mesh.children[0] as THREE.Mesh).rotation.z = flap;
    (b.mesh.children[1] as THREE.Mesh).rotation.z = -flap;
  }
}

/* ================= 8. GAME STATE ================= */
type GameState = "start" | "playing" | "paused" | "gameover" | "victory";

/* Difficulty modes: rival speed/skill, damage taken, penalty time & boost drain. */
type DifficultyKey = "easy" | "normal" | "hard";
const DIFFICULTIES: Record<DifficultyKey, { label: string; rival: number; damage: number; penalty: number; boost: number }> = {
  easy: { label: "KOLAY", rival: 0.85, damage: 0.6, penalty: 0.6, boost: 0.7 },
  normal: { label: "NORMAL", rival: 1.0, damage: 1.0, penalty: 1.0, boost: 1.0 },
  hard: { label: "ZOR", rival: 1.15, damage: 1.4, penalty: 1.4, boost: 1.3 },
};
let levelBannerTimer = 0; // pending "next level" banner (cleared on stop)

const game = {
  state: "start" as GameState,
  time: 0,
  penalty: 0,
  checkpointsPassed: 0,
  totalCheckpoints: 0,
  boostFlash: 0,
  position: 1,           // race position (1 = P1)
  difficulty: "normal" as DifficultyKey, // chosen on the start screen
  level: 1,              // current level (1..LEVELS.length)

  startGame() {
    AudioSys.init(); AudioSys.resume();
    MusicSys.start(); // pirate shanty loops while the race is live
    this.time = 0; this.penalty = 0; this.checkpointsPassed = 0;
    buildCourse(scene, this.level); // rebuild the current level fresh
    this.totalCheckpoints = Course.checkpoints.length;
    this.position = 1;
    Boat.reset();
    Course.reset();
    Rivals.reset();
    this.state = "playing";
    hideAllScreens();
    updateHUD();
  },
  restart() { this.startGame(); },
  togglePause() {
    if (this.state === "playing") { this.state = "paused"; MusicSys.stop(); show("pb-screen-pause"); }
    else if (this.state === "paused") { this.state = "playing"; MusicSys.start(); hide("pb-screen-pause"); }
  },
  toggleMute() {
    AudioSys.init();
    AudioSys.setMuted(!AudioSys.muted);
    const btn = document.getElementById("pb-mute");
    if (btn) btn.innerHTML = AudioSys.muted ? "&#128263;" : "&#128266;";
  },
  addPenalty(sec: number) {
    this.penalty += sec * DIFFICULTIES[this.difficulty].penalty;
    updateHUD();
  },
  resetBoatSafe() {
    // Place boat just before the current checkpoint
    const cp = Course.checkpoints[Course.current];
    if (cp) {
      const back = 18;
      Boat.pos.x = cp.x - Math.sin(cp.angle) * back;
      Boat.pos.z = cp.z - Math.cos(cp.angle) * back;
      Boat.heading = cp.angle;
    } else {
      const def = LEVELS[this.level - 1];
      Boat.pos.set(def.start[0], 0, def.start[1]);
      Boat.heading = def.startHeading;
    }
    Boat.vel.set(0, 0, 0);
    Boat.speed = 0;
    Boat.vy = 0;
    Boat.airborne = false;
    Boat.invuln = 2;
    Boat.syncVisual();
  },
  gameOver() {
    this.state = "gameover";
    AudioSys.stopEngine();
    MusicSys.stop();
    AudioSys.gameover();
    const el = document.getElementById("pb-stats");
    if (el) el.innerHTML = `Süre: ${(this.time + this.penalty).toFixed(1)}s &nbsp; Kontrol Noktası: ${this.checkpointsPassed}/${this.totalCheckpoints}`;
    show("pb-screen-gameover");
  },
  levelComplete() {
    // Finished a race: advance to the next level, or take the overall victory
    if (this.level < LEVELS.length) {
      AudioSys.victory();
      showToast("BÖLÜM " + this.level + " TAMAMLANDI");
      levelBannerTimer = window.setTimeout(() => {
        levelBannerTimer = 0;
        this.advanceLevel();
      }, 1600);
    } else {
      this.victory();
    }
  },
  advanceLevel() {
    this.level++;
    buildCourse(scene, this.level); // fresh course + mood for the new level
    this.time = 0; this.penalty = 0; this.checkpointsPassed = 0;
    this.totalCheckpoints = Course.checkpoints.length;
    this.position = 1;
    Boat.reset(true); // health & difficulty carry over between levels
    Course.reset();
    Rivals.reset();
    showToast("BÖLÜM " + this.level + " — " + LEVELS[this.level - 1].name);
    updateHUD();
  },
  victory() {
    this.state = "victory";
    AudioSys.stopEngine();
    MusicSys.stop();
    AudioSys.victory();
    const total = this.time + this.penalty;
    const el = document.getElementById("pb-stats-v");
    if (el) el.innerHTML = `Final Süre: ${total.toFixed(1)}s (ceza +${this.penalty.toFixed(1)}s) &nbsp; Sıra: P${this.position}/${RIVAL_COUNT + 1}`;
    show("pb-screen-victory");
  },
  update(dt: number) {
    if (this.state !== "playing") return;
    this.time += dt;
    if (this.boostFlash > 0) this.boostFlash -= dt;

    const t = this.time;
    Boat.update(dt, (x, z) => waveH(x, z, t));

    // --- Obstacle collisions ---
    const bp = Boat.pos;
    // Rocks
    for (const r of Course.rocks) {
      const dx = bp.x - r.x, dz = bp.z - r.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = r.r + BOAT_RADIUS;
      if (dist < minDist && dist > 0.01) {
        // Push boat OUT of the rock (away from rock center)
        const push = (minDist - dist) / dist;
        bp.x += dx * push;
        bp.z += dz * push;
        // Kill most forward speed so the boat doesn't re-collide next frame
        Boat.speed *= 0.3;
        // Bounce: reflect velocity away from the rock
        const nx = dx / dist, nz = dz / dist;
        Boat.vel.set(nx * 4, 0, nz * 4);
        Boat.damage(ROCK_DAMAGE, "rock");
      }
    }
    // Mines
    for (const m of Course.mines) {
      if (!m.alive) continue;
      const dx = bp.x - m.x, dz = bp.z - m.z;
      if (dx * dx + dz * dz < (m.r + BOAT_RADIUS) ** 2) {
        m.alive = false;
        (m.mesh.children[1] as THREE.Mesh).visible = false;
        AudioSys.mine();
        Boat.damage(MINE_DAMAGE, "mine");
        spawnSpray(m.x, 1, m.z, 20);
      }
    }
    // Debris
    for (const d of Course.debris) {
      const dx = bp.x - d.x, dz = bp.z - d.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = d.r + BOAT_RADIUS;
      if (dist < minDist && dist > 0.01) {
        const push = (minDist - dist) / dist;
        bp.x += dx * push;
        bp.z += dz * push;
        Boat.speed *= 0.3;
        const nx = dx / dist, nz = dz / dist;
        Boat.vel.set(nx * 4, 0, nz * 4);
        Boat.damage(DEBRIS_DAMAGE, "debris");
      }
    }
    // Barriers
    for (const b of Course.barriers) {
      const bx = b.group.position.x, bz = b.group.position.z;
      const halfW = b.w / 2;
      if (b.axis === "x") {
        if (Math.abs(bp.z - bz) < 1.5 && bp.x > bx - halfW - BOAT_RADIUS && bp.x < bx + halfW + BOAT_RADIUS) {
          bp.z = bz + Math.sign(bp.z - bz || 1) * (1.5 + BOAT_RADIUS);
          Boat.speed *= 0.3;
          Boat.vel.set(0, 0, Math.sign(bp.z - bz || 1) * 4);
          Boat.damage(BARRIER_DAMAGE, "barrier");
        }
      } else {
        if (Math.abs(bp.x - bx) < 1.5 && bp.z > bz - halfW - BOAT_RADIUS && bp.z < bz + halfW + BOAT_RADIUS) {
          bp.x = bx + Math.sign(bp.x - bx || 1) * (1.5 + BOAT_RADIUS);
          Boat.speed *= 0.3;
          Boat.vel.set(Math.sign(bp.x - bx || 1) * 4, 0, 0);
          Boat.damage(BARRIER_DAMAGE, "barrier");
        }
      }
    }

    // --- Checkpoint detection ---
    const cp = Course.checkpoints[Course.current];
    if (cp && !cp.passed) {
      const dx = bp.x - cp.x, dz = bp.z - cp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const gateHalf = cp.type === "narrow" ? 6 : 10;
      // Passed the checkpoint
      if (dist < gateHalf + 4) {
        cp.passed = true;
        this.checkpointsPassed++;
        Course.current++;
        AudioSys.checkpoint();
        if (Course.current >= Course.checkpoints.length) {
          this.levelComplete();
        }
        updateHUD();
      }
      // Missed the checkpoint: boat is far behind it (went past without passing through)
      // Check if boat is more than 40 units away AND behind the checkpoint plane
      else if (dist > 40) {
        // Determine if boat is "behind" the checkpoint (dot product of boat->cp with cp's forward)
        const cpForwardX = Math.sin(cp.angle), cpForwardZ = Math.cos(cp.angle);
        const toBoatX = bp.x - cp.x, toBoatZ = bp.z - cp.z;
        const dot = toBoatX * cpForwardX + toBoatZ * cpForwardZ;
        // If dot < -10, boat is behind the checkpoint (missed it)
        if (dot < -10) {
          this.addPenalty(MISS_PENALTY);
          this.resetBoatSafe();
          showToast("KONTROL NOKTASI KAÇTI! -" + (MISS_PENALTY * DIFFICULTIES[this.difficulty].penalty).toFixed(1) + "s");
        }
      }
    }

    // --- Update dynamic obstacles ---
    for (const b of Course.barriers) {
      b.t += dt * b.speed;
      const off = Math.sin(b.t) * b.range;
      if (b.axis === "x") b.group.position.x = b.x + off;
      else b.group.position.z = b.z + off;
    }
    for (const m of Course.mines) {
      if (!m.alive) continue;
      m.blinkT += dt;
      const light = m.mesh.children[1] as THREE.Mesh;
      (light.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(m.blinkT * 6) > 0 ? 0xff2222 : 0x661111);
      m.mesh.position.y = 0.5 + Math.sin(m.blinkT * 2) * 0.2;
    }
    for (const d of Course.debris) {
      d.bobT += dt;
      d.mesh.position.y = 0.6 + Math.sin(d.bobT * 1.5) * 0.25;
      d.mesh.rotation.y += dt * 0.3;
    }
    for (const w of Course.whirlpools) {
      w.mesh.rotation.z += dt * 2;
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t * 3) * 0.2;
    }
    // Checkpoint rings pulse
    for (const c of Course.checkpoints) {
      const mat = c.ring.material as THREE.MeshBasicMaterial;
      mat.opacity = c.passed ? 0.15 : 0.35 + Math.sin(t * 4) * 0.2;
      mat.color.setHex(c.passed ? 0x44ff44 : (Course.current === Course.checkpoints.indexOf(c) ? 0x00ffcc : 0x4488aa));
    }

    // --- Rival AI boats & race position ---
    Rivals.update(dt, (x, z) => waveH(x, z, t));
    Rivals.collide();
    const pos = Rivals.position();
    if (pos !== this.position) {
      if (pos < this.position) {
        AudioSys.overtake();
        showToast("ÖNÜNE GEÇTİN! P" + pos);
      }
      this.position = pos;
      updatePositionHUD();
    }

    // --- Boost rings (refill nitro when driven through) ---
    for (const ring of Course.boostRings) {
      if (ring.cooldown > 0) { ring.cooldown -= dt; continue; }
      const dx = bp.x - ring.x, dz = bp.z - ring.z;
      if (dx * dx + dz * dz < (ring.r + BOAT_RADIUS * 0.5) ** 2) {
        ring.cooldown = RING_COOLDOWN;
        ring.pulse = 1;
        Boat.boostEnergy = Math.min(100, Boat.boostEnergy + RING_REFILL);
        this.boostFlash = 0.5;
        AudioSys.ring();
        spawnSpray(ring.x, 1, ring.z, 8);
        updateHUD();
      }
    }
    // Boost ring visuals: pass pulse + recharge glow
    for (const ring of Course.boostRings) {
      const mat = ring.mesh.material as THREE.MeshBasicMaterial;
      if (ring.pulse > 0) {
        ring.pulse = Math.max(0, ring.pulse - dt * 2);
        ring.mesh.scale.setScalar(1 + ring.pulse * 0.5);
        mat.opacity = 0.3 + ring.pulse * 0.6;
      } else {
        ring.mesh.scale.setScalar(1);
        mat.opacity = ring.cooldown > 0 ? 0.12 : 0.4 + Math.sin(t * 3 + ring.x * 0.1) * 0.15;
      }
    }

    // --- Oil slicks (lose steering grip when driven over) ---
    for (const o of Course.oils) {
      const dx = bp.x - o.x, dz = bp.z - o.z;
      if (dx * dx + dz * dz < (o.r + BOAT_RADIUS) ** 2) {
        if (Boat.slippery <= 0) AudioSys.oil();
        Boat.slippery = OIL_SLIP_TIME;
        o.pulse = 1;
      }
    }
    // Oil slick visuals: slow shimmer, ripple when hit
    for (const o of Course.oils) {
      const mat = o.mesh.material as THREE.MeshBasicMaterial;
      if (o.pulse > 0) {
        o.pulse = Math.max(0, o.pulse - dt * 1.5);
        o.mesh.scale.setScalar(1 + o.pulse * 0.2);
      } else o.mesh.scale.setScalar(1);
      mat.opacity = 0.7 + Math.sin(t * 2 + o.x * 0.1) * 0.1 + o.pulse * 0.2;
    }

    // Ring-pass screen flash (decays with game.boostFlash)
    const flashEl = document.getElementById("pb-flash");
    if (flashEl) flashEl.style.opacity = String(Math.max(0, Math.min(0.7, this.boostFlash * 1.4)));
  },
};

/* ================= 9. CAMERA ================= */
let camera: THREE.PerspectiveCamera;
let camPos = new THREE.Vector3(0, 8, -175);
function updateCamera(dt: number) {
  const target = new THREE.Vector3(
    Boat.pos.x - Math.sin(Boat.heading) * 14,
    Boat.pos.y + 6.5,
    Boat.pos.z - Math.cos(Boat.heading) * 14
  );
  camPos.lerp(target, Math.min(1, dt * 4));
  camera.position.copy(camPos);
  camera.lookAt(Boat.pos.x, Boat.pos.y + 2, Boat.pos.z);
}

/* ================= 10. HUD & OVERLAYS ================= */
const OVERLAY_CSS = `
.pb-hud { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:flex-start; padding:12px 16px; pointer-events:none; z-index:5; font-family:'Courier New',monospace; }
.pb-hud-box { background:rgba(0,0,0,0.5); border:2px solid rgba(0,200,255,0.5); border-radius:8px; color:#fff; font-size:14px; font-weight:bold; padding:8px 12px; letter-spacing:1px; text-shadow:1px 1px 0 #000; display:flex; flex-direction:column; gap:6px; }
.pb-hud-row { display:flex; align-items:center; gap:8px; min-height:16px; }
.pb-hud-label { width:52px; flex:none; color:#88ccff; }
.pb-hud-val { min-width:52px; }
.pb-bar { width:130px; height:10px; background:rgba(255,255,255,0.2); border-radius:5px; overflow:hidden; flex:none; }
.pb-bar-fill { height:100%; transition:width 0.15s; display:block; }
.pb-hp-fill { background:linear-gradient(90deg,#ff3333,#ff7755); }
.pb-boost-fill { background:linear-gradient(90deg,#00ccff,#66ffff); }
.pb-speedo { position:absolute; bottom:18px; right:18px; width:130px; height:130px; background:rgba(0,20,40,0.7); border:2px solid rgba(0,200,255,0.5); border-radius:8px; box-shadow:0 0 0 2px rgba(0,0,0,0.35); z-index:5; pointer-events:none; box-sizing:border-box; padding:8px; }
.pb-speedo svg { width:100%; height:100%; }
.pb-speedo .spd-num { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:'Courier New',monospace; font-size:26px; font-weight:bold; color:#fff; text-shadow:2px 2px 0 #000; }
.pb-speedo .spd-unit { position:absolute; bottom:22px; left:0; right:0; text-align:center; font-size:10px; color:#88ccff; font-family:'Courier New',monospace; }
.pb-minimap { position:absolute; bottom:18px; left:18px; width:130px; height:130px; background:rgba(0,20,40,0.7); border:2px solid rgba(0,200,255,0.5); border-radius:8px; box-shadow:0 0 0 2px rgba(0,0,0,0.35); z-index:5; pointer-events:none; box-sizing:border-box; }
.pb-mute { pointer-events:auto; cursor:pointer; background:rgba(0,0,0,0.5); border:2px solid rgba(0,200,255,0.5); border-radius:8px; color:#fff; font-size:16px; width:40px; height:36px; }
.pb-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,10,25,0.88); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.pb-overlay.hidden { display:none; }
.pb-overlay h1 { font-size:clamp(30px,7vw,58px); letter-spacing:4px; color:#00ddff; text-shadow:3px 3px 0 #004466,6px 6px 0 rgba(0,0,0,0.5); margin-bottom:12px; }
.pb-overlay h2 { font-size:clamp(18px,4vw,28px); margin-bottom:14px; color:#ffcc44; text-shadow:2px 2px 0 #000; }
.pb-overlay p { font-size:clamp(13px,2.2vw,17px); line-height:1.8; margin-bottom:8px; color:#cfe8ff; }
.pb-overlay .big-btn { margin-top:24px; font-family:inherit; font-size:clamp(16px,3vw,22px); font-weight:bold; padding:14px 38px; background:linear-gradient(#00ccff,#0088cc); color:#fff; border:3px solid #fff; border-radius:12px; cursor:pointer; box-shadow:0 5px 0 #004466; letter-spacing:2px; }
.pb-overlay .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #004466; }
.pb-overlay .keys { margin-top:18px; font-size:13px; color:#88aacc; line-height:2; }
.pb-overlay .keys b { color:#00ddff; }
.pb-diffrow { display:flex; gap:12px; margin-top:16px; }
.pb-diff-btn { font-family:inherit; font-size:clamp(13px,2.2vw,16px); font-weight:bold; padding:10px 22px; background:linear-gradient(#335577,#223344); color:#cfe8ff; border:2px solid rgba(0,200,255,0.4); border-radius:10px; cursor:pointer; box-shadow:0 4px 0 #112233; letter-spacing:2px; }
.pb-diff-btn.sel { background:linear-gradient(#00ccff,#0088cc); color:#fff; border-color:#fff; box-shadow:0 4px 0 #004466; }
.pb-diff-btn:active { transform:translateY(3px); box-shadow:0 1px 0 #112233; }
.pb-stats { font-size:clamp(15px,2.6vw,20px); color:#ffdd44; margin:8px 0; }
.pb-toast { position:absolute; top:20%; left:0; right:0; text-align:center; font-family:'Courier New',monospace; font-size:clamp(20px,4vw,36px); font-weight:bold; color:#00ffcc; text-shadow:3px 3px 0 #000; z-index:6; pointer-events:none; opacity:0; transition:opacity 0.3s; letter-spacing:3px; }
.pb-toast.show { opacity:1; }
.pb-flash { position:absolute; inset:0; background:radial-gradient(circle,rgba(0,255,200,0.35),rgba(0,120,255,0.15) 60%,transparent); z-index:6; pointer-events:none; opacity:0; }
.pb-touch { position:absolute; bottom:0; left:0; right:0; display:none; justify-content:space-between; align-items:flex-end; padding:14px 16px; z-index:8; pointer-events:none; }
body.touch .pb-touch { display:flex; }
.pb-tbtn { pointer-events:auto; width:70px; height:70px; border-radius:50%; background:rgba(255,255,255,0.15); border:3px solid rgba(255,255,255,0.5); color:#fff; font-size:26px; font-weight:bold; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; }
.pb-tbtn.pressed { background:rgba(255,255,255,0.4); }
.pb-tbtn.pb-boost { width:84px; height:84px; font-size:16px; background:rgba(0,200,255,0.25); border-color:rgba(0,200,255,0.7); }
.pb-tcluster { display:flex; gap:12px; }
`;

let canvasEl: HTMLCanvasElement | null = null;
let minimapCtx: CanvasRenderingContext2D | null = null;

function buildOverlayUI(container: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "pb-hud";
  hud.innerHTML = `
    <div class="pb-hud-box">
      <div class="pb-hud-row"><span class="pb-hud-label">SÜRE</span><span class="pb-hud-val"><span id="pb-time">0.0</span>s</span></div>
      <div class="pb-hud-row"><span class="pb-hud-label">KAPI</span><span class="pb-hud-val"><span id="pb-cp">0</span>/<span id="pb-cp-total">0</span></span></div>
      <div class="pb-hud-row"><span class="pb-hud-label">SIRA</span><span class="pb-hud-val" id="pb-pos">P1</span></div>
      <div class="pb-hud-row"><span class="pb-hud-label">BÖLÜM</span><span class="pb-hud-val" id="pb-level">1 — Sunny Bay</span></div>
      <div class="pb-hud-row"><span class="pb-hud-label">ZORLUK</span><span class="pb-hud-val" id="pb-diff">NORMAL</span></div>
      <div class="pb-hud-row"><span class="pb-hud-label">CAN</span><span class="pb-bar"><span class="pb-bar-fill pb-hp-fill" id="pb-hp-fill" style="width:100%"></span></span></div>
      <div class="pb-hud-row"><span class="pb-hud-label">NİTRO</span><span class="pb-bar"><span class="pb-bar-fill pb-boost-fill" id="pb-boost-fill" style="width:100%"></span></span></div>
    </div>
    <button id="pb-mute" class="pb-mute" title="Sesi ve müziği kapat (M)">&#128266;</button>`;
  container.appendChild(hud);

  // Speedometer (SVG arc)
  const speedo = document.createElement("div");
  speedo.className = "pb-speedo";
  speedo.innerHTML = `
    <svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="8"/>
      <circle id="pb-speed-arc" cx="50" cy="50" r="44" fill="none" stroke="#00ddff" stroke-width="8"
        stroke-dasharray="276" stroke-dashoffset="276" stroke-linecap="round" transform="rotate(135 50 50)"/>
    </svg>
    <div class="spd-num" id="pb-speed">0</div>
    <div class="spd-unit">km/sa</div>`;
  container.appendChild(speedo);

  // Minimap (126px buffer inside the 130px border-box frame)
  const minimap = document.createElement("canvas");
  minimap.width = 126; minimap.height = 126;
  minimap.className = "pb-minimap";
  container.appendChild(minimap);
  minimapCtx = minimap.getContext("2d");

  const toast = document.createElement("div");
  toast.className = "pb-toast";
  toast.id = "pb-toast";
  container.appendChild(toast);

  // Ring-pass flash overlay
  const flash = document.createElement("div");
  flash.className = "pb-flash";
  flash.id = "pb-flash";
  container.appendChild(flash);

  const mk = (id: string, inner: string, hidden = false) => {
    const el = document.createElement("div");
    el.className = "pb-overlay" + (hidden ? " hidden" : "");
    el.id = id;
    el.innerHTML = inner;
    container.appendChild(el);
    return el;
  };

  mk("pb-screen-start", `
    <h1>SÜRAT TEKNESİ HÜCUMU</h1>
    <h2>Sürat Teknesi Engel Yarışı</h2>
    <p>Üç bölüm: Sunny Bay, Adalar Kanalı ve Fırtına Kanalı. Her kontrol kapısından geç, mayınlardan ve kayalardan kaç.</p>
    <p>Rakip tekneleri geç, parlak halkalardan geçerek nitrounu doldur, yağ lekelerinden kaç.</p>
    <p>Final rampasına dikkat — o atlayış efsanedir.</p>
    <div class="pb-diffrow">
      <button class="pb-diff-btn" id="pb-btn-diff-easy">KOLAY</button>
      <button class="pb-diff-btn" id="pb-btn-diff-normal">NORMAL</button>
      <button class="pb-diff-btn" id="pb-btn-diff-hard">ZOR</button>
    </div>
    <button class="big-btn" id="pb-btn-start">YARIŞI BAŞLAT</button>
    <div class="keys">
      <b>W / &#8593;</b> gaz &nbsp; <b>S / &#8595;</b> fren &nbsp; <b>A D / &#8592; &#8594;</b> direksiyon<br>
      <b>Space</b> nitro &nbsp; <b>P</b> duraklat &nbsp; <b>R</b> yeniden başlat &nbsp; <b>M</b> ses kapat
    </div>`);

  mk("pb-screen-pause", `
    <h2>DURAKLATILDI</h2>
    <p>Okyanus kimseyi beklemez.</p>
    <button class="big-btn" id="pb-btn-resume">DEVAM ET</button>
    <button class="big-btn" id="pb-btn-restart" style="background:linear-gradient(#88aacc,#446688);box-shadow:0 5px 0 #223344">YENİDEN BAŞLAT</button>`, true);

  mk("pb-screen-gameover", `
    <h1 style="color:#ff4444;text-shadow:3px 3px 0 #440000">ENKAZ</h1>
    <p>Teknen okyanusun dibinde...</p>
    <div class="pb-stats" id="pb-stats"></div>
    <button class="big-btn" id="pb-btn-retry">TEKRAR DENE</button>`, true);

  mk("pb-screen-victory", `
    <h1>ZAFER!</h1>
    <p>Üç bölümü de bitirdin: Sunny Bay, Adalar Kanalı ve Fırtına Kanalı senin. O final atlayışı efsaneydi.</p>
    <div class="pb-stats" id="pb-stats-v"></div>
    <button class="big-btn" id="pb-btn-again">TEKRAR YARIŞ</button>`, true);

  // Touch controls
  const touch = document.createElement("div");
  touch.className = "pb-touch";
  touch.innerHTML = `
    <div class="pb-tcluster">
      <div class="pb-tbtn" id="pb-t-left">&#9664;</div>
      <div class="pb-tbtn" id="pb-t-right">&#9654;</div>
    </div>
    <div class="pb-tcluster">
      <div class="pb-tbtn" id="pb-t-gas">GAZ</div>
      <div class="pb-tbtn pb-boost" id="pb-t-boost">NİTRO</div>
    </div>`;
  container.appendChild(touch);

  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  // Difficulty picker: highlight the selected mode (default NORMAL)
  const pickDiff = (k: DifficultyKey) => {
    game.difficulty = k;
    for (const key of ["easy", "normal", "hard"] as DifficultyKey[]) {
      document.getElementById("pb-btn-diff-" + key)?.classList.toggle("sel", key === k);
    }
    updateHUD();
  };
  on("pb-btn-diff-easy", () => pickDiff("easy"));
  on("pb-btn-diff-normal", () => pickDiff("normal"));
  on("pb-btn-diff-hard", () => pickDiff("hard"));
  pickDiff(game.difficulty); // sync highlight with the stored difficulty
  on("pb-btn-start", () => { game.level = 1; game.startGame(); }); // start screen resets to L1
  on("pb-btn-resume", () => game.togglePause());
  on("pb-btn-restart", () => game.restart());
  on("pb-btn-retry", () => game.restart()); // retry: current level, same difficulty
  on("pb-btn-again", () => { game.level = 1; game.restart(); }); // full restart from L1
  on("pb-mute", () => game.toggleMute());
}

function show(id: string) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id: string) { document.getElementById(id)?.classList.add("hidden"); }
function hideAllScreens() {
  ["pb-screen-start", "pb-screen-pause", "pb-screen-gameover", "pb-screen-victory"].forEach(hide);
}
function showToast(text: string) {
  const el = document.getElementById("pb-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1500);
}
function updatePositionHUD() {
  const el = document.getElementById("pb-pos");
  if (el) el.textContent = "P" + game.position + "/" + (RIVAL_COUNT + 1);
}
function updateHUD() {
  const set = (id: string, v: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set("pb-time", (game.time + game.penalty).toFixed(1));
  set("pb-cp", game.checkpointsPassed);
  set("pb-cp-total", game.totalCheckpoints);
  set("pb-level", game.level + " — " + LEVELS[game.level - 1].name);
  set("pb-diff", DIFFICULTIES[game.difficulty].label);
  updatePositionHUD();
  const hp = document.getElementById("pb-hp-fill");
  if (hp) hp.style.width = Math.max(0, Boat.health) + "%";
  const boost = document.getElementById("pb-boost-fill");
  if (boost) boost.style.width = Boat.boostEnergy + "%";
  // Speedometer
  const kmh = Math.round(Boat.speed * 3.6);
  set("pb-speed", kmh);
  const arc = document.getElementById("pb-speed-arc");
  if (arc) {
    const frac = Math.min(1, Boat.speed / (MAX_SPEED * BOOST_MULT));
    const circ = 276 * 0.75; // 270 degree arc
    arc.setAttribute("stroke-dasharray", String(circ));
    arc.setAttribute("stroke-dashoffset", String(circ * (1 - frac)));
  }
  // Minimap
  drawMinimap();
}
function drawMinimap() {
  if (!minimapCtx) return;
  const ctx = minimapCtx;
  const S = 126;
  const scale = S / (ARENA * 2);
  ctx.clearRect(0, 0, S, S);
  // Background
  ctx.fillStyle = "rgba(0,30,60,0.8)";
  ctx.fillRect(0, 0, S, S);
  // Course line: start → gates in order (faint racing line)
  ctx.strokeStyle = "rgba(0,200,255,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo((START_POS.x + ARENA) * scale, (START_POS.z + ARENA) * scale);
  for (const cp of Course.checkpoints) ctx.lineTo((cp.x + ARENA) * scale, (cp.z + ARENA) * scale);
  ctx.stroke();
  // Checkpoints
  for (let i = 0; i < Course.checkpoints.length; i++) {
    const cp = Course.checkpoints[i];
    const x = (cp.x + ARENA) * scale, y = (cp.z + ARENA) * scale;
    ctx.fillStyle = cp.passed ? "#44ff44" : (i === Course.current ? "#00ffcc" : "#4488aa");
    ctx.beginPath();
    ctx.arc(x, y, i === Course.current ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mines
  ctx.fillStyle = "#ff4444";
  for (const m of Course.mines) {
    if (!m.alive) continue;
    const x = (m.x + ARENA) * scale, y = (m.z + ARENA) * scale;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  // Boost rings
  ctx.strokeStyle = "#66ffcc";
  ctx.lineWidth = 1;
  for (const ring of Course.boostRings) {
    const x = (ring.x + ARENA) * scale, y = (ring.z + ARENA) * scale;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, ring.r * scale), 0, Math.PI * 2);
    ctx.stroke();
  }
  // Oil slicks
  ctx.fillStyle = "rgba(30,25,10,0.9)";
  for (const o of Course.oils) {
    const x = (o.x + ARENA) * scale, y = (o.z + ARENA) * scale;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, o.r * scale), 0, Math.PI * 2);
    ctx.fill();
  }
  // Rival boats (colored dots)
  for (let i = 0; i < Rivals.boats.length; i++) {
    const r = Rivals.boats[i];
    const x = (r.pos.x + ARENA) * scale, y = (r.pos.z + ARENA) * scale;
    ctx.fillStyle = RIVAL_CSS[i % RIVAL_CSS.length];
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Boat (triangle)
  const bx = (Boat.pos.x + ARENA) * scale, by = (Boat.pos.z + ARENA) * scale;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(Boat.heading);
  ctx.fillStyle = "#00ddff";
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ================= 11. MAIN LOOP & PUBLIC API ================= */
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;

export function startGame(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas;
  game.state = "start";
  game.level = 1; // a fresh session always begins at L1
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x88bbee, 60, 320);

  camera = new THREE.PerspectiveCamera(70, 960 / 540, 0.1, 600);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lights: hemisphere sky/ground fill + one warm sun (low light count)
  hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x2a5a7a, 0.75);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xfff2d0, 1.2);
  sunLight.position.set(150, 120, -200); // matches the visible sun disc
  scene.add(sunLight);

  envGroup = new THREE.Group(); // level scenery (sky/sun/clouds/islands/birds)
  scene.add(envGroup);
  buildOcean(scene);
  buildCourse(scene, game.level); // course + per-level mood & scenery
  Boat.build(scene);
  Rivals.build(scene);
  Boat.reset();
  Course.reset();
  game.totalCheckpoints = Course.checkpoints.length;

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

  Input.init();
  updateHUD();

  let raf = 0;
  let lastTime = 0;
  const loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0.016);
    lastTime = ts;
    const t = ts / 1000;
    updateOcean(t);
    updateBirds(dt);
    updateClouds(dt);
    game.update(dt);
    if (game.state === "playing") updateCamera(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    if (levelBannerTimer !== 0) { clearTimeout(levelBannerTimer); levelBannerTimer = 0; }
    window.removeEventListener("resize", resize);
    Input.cleanup();
    AudioSys.stopEngine();
    MusicSys.dispose(); // stop scheduler + release music nodes
    wrap.remove();
    renderer.dispose();
    canvasEl = null;
  };
}