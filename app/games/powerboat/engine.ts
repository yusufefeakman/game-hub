/* =====================================================================
   POWERBOAT RUSH — 3D Speedboat Race (Three.js)
   Third-person chase cam, WASD/arrows steer, Space = nitro boost.
   Procedural ocean, wake, spray, islands, birds, full obstacle course.
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
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      // Continuous engine hum (sawtooth through lowpass, pitch follows speed)
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 55;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 300;
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
    this.engineFilter.frequency.setTargetAtTime(250 + speed01 * 900, t, 0.08);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.05 + speed01 * 0.12, t, 0.1);
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
  crash() { this.noise(0.4, 0.6, 0, 500); this.tone("sawtooth", 120, 40, 0.4, 0.5); },
  splash() { this.noise(0.35, 0.45, 0, 900); },
  checkpoint() { this.tone("square", 660, 660, 0.1, 0.35); this.tone("square", 880, 880, 0.16, 0.35, 0.1); },
  boost() { this.tone("sawtooth", 200, 700, 0.3, 0.3); this.noise(0.25, 0.25, 0, 2000); },
  mine() { this.noise(0.6, 0.7, 0, 300); this.tone("sine", 80, 30, 0.6, 0.6); },
  gameover() { [330, 262, 196, 131].forEach((f, i) => this.tone("triangle", f, f, 0.35, 0.4, i * 0.28)); },
  victory() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => this.tone("square", f, f, 0.18, 0.32, i * 0.13)); },
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
    if (m) this.stopEngine();
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

const Course = {
  checkpoints: [] as Checkpoint[],
  rocks: [] as Rock[],
  mines: [] as Mine[],
  debris: [] as Debris[],
  barriers: [] as Barrier[],
  whirlpools: [] as Whirlpool[],
  ramps: [] as Ramp[],
  current: 0,          // index of next checkpoint to pass
  build(scene: THREE.Scene) {
    const postMat = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
    const postMat2 = new THREE.MeshLambertMaterial({ color: 0xff4444 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5, side: THREE.DoubleSide });

    const mkGate = (x: number, z: number, angle: number, type: Checkpoint["type"], gap = 14) => {
      const postGeo = new THREE.CylinderGeometry(0.6, 0.8, 8, 8);
      const postL = new THREE.Mesh(postGeo, type === "finish" ? postMat2 : postMat);
      const postR = new THREE.Mesh(postGeo, type === "finish" ? postMat2 : postMat);
      const half = gap / 2;
      const dx = Math.sin(angle) * half, dz = Math.cos(angle) * half;
      postL.position.set(x + dx, 4, z + dz);
      postR.position.set(x - dx, 4, z - dz);
      scene.add(postL, postR);
      // glowing ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(gap / 2, 0.35, 8, 24), ringMat);
      ring.position.set(x, 1.2, z);
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = angle;
      scene.add(ring);
      this.checkpoints.push({ x, z, angle, type, passed: false, postL, postR, ring });
    };

    // --- Course layout (snaking S-curve through the arena) ---
    // Start at south, head north, weave east/west, finish at north with big ramp.
    mkGate(0, 150, 0, "gate", 18);        // CP1
    mkGate(45, 95, Math.PI / 2, "gate", 16);   // CP2 (turn east)
    mkGate(70, 20, 0, "gate", 14);        // CP3
    mkGate(30, -50, -Math.PI / 2, "narrow", 10); // CP4 narrow passage
    mkGate(-30, -80, 0, "gate", 14);      // CP5
    mkGate(-70, -20, Math.PI / 2, "gate", 13);  // CP6
    mkGate(-45, 55, 0, "narrow", 9);      // CP7 narrow
    mkGate(0, 105, Math.PI, "ramp", 16);  // CP8 = final ramp gate
    mkGate(0, 175, 0, "finish", 20);      // FINISH (after big jump)

    // --- Rocks (static collision) ---
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x5a5a6a });
    const rockSpots: [number, number, number][] = [
      [20, 120, 3], [-25, 70, 2.5], [55, 55, 3.5], [10, 10, 2.5],
      [-15, -20, 3], [50, -70, 2.5], [-55, -50, 3], [-20, 30, 2.5],
      [15, -90, 3], [-60, 10, 2.5], [35, 130, 2.5], [-35, 110, 3],
    ];
    for (const [x, z, r] of rockSpots) {
      const geo = new THREE.DodecahedronGeometry(r, 0);
      const mesh = new THREE.Mesh(geo, rockMat);
      mesh.position.set(x, r * 0.4, z);
      mesh.rotation.set(Math.random(), Math.random(), Math.random());
      scene.add(mesh);
      this.rocks.push({ mesh, x, z, r: r + 1 });
    }

    // --- Mines (floating, pulsing red) ---
    const mineMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const mineLightMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const mineSpots: [number, number][] = [
      [30, 80], [-10, 40], [60, 30], [20, -30], [-40, -60],
      [-60, 0], [-30, 70], [10, 140], [-50, 90], [40, -10],
    ];
    for (const [x, z] of mineSpots) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), mineMat);
      group.add(body);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), mineLightMat);
      light.position.y = 1.1;
      group.add(light);
      // spikes
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 4), mineMat);
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0);
        spike.lookAt(new THREE.Vector3(Math.cos(a) * 2, Math.sin(a) * 2, 0));
        group.add(spike);
      }
      group.position.set(x, 0.5, z);
      scene.add(group);
      this.mines.push({ mesh: group, x, z, r: 2.2, alive: true, blinkT: Math.random() * 3 });
    }

    // --- Floating debris (wooden crates / barrels) ---
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x666677 });
    const debrisSpots: [number, number, boolean][] = [
      [15, 100, true], [-20, 85, false], [50, 70, true], [35, 20, false],
      [0, -60, true], [-45, -30, false], [-55, 40, true], [-10, 60, false],
      [25, 155, true], [-40, 130, false],
    ];
    for (const [x, z, isCrate] of debrisSpots) {
      const mesh = isCrate
        ? new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), crateMat)
        : new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2, 8), barrelMat);
      mesh.position.set(x, 0.6, z);
      mesh.rotation.y = Math.random() * Math.PI;
      scene.add(mesh);
      this.debris.push({ mesh, x, z, r: 2, bobT: Math.random() * 5 });
    }

    // --- Moving barriers (slide across the path) ---
    const barrierMat = new THREE.MeshLambertMaterial({ color: 0xcc3333 });
    const mkBarrier = (x: number, z: number, axis: "x" | "z", range: number, speed: number, w: number) => {
      const group = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(axis === "x" ? w : 1.2, 2.5, axis === "z" ? w : 1.2), barrierMat);
      group.add(bar);
      // warning stripes
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(axis === "x" ? w : 1.3, 0.5, axis === "z" ? w : 1.3), stripeMat);
      stripe.position.y = 0.8;
      group.add(stripe);
      group.position.set(x, 1.2, z);
      scene.add(group);
      this.barriers.push({ group, x, z, axis, range, speed, t: Math.random() * 10, w });
    };
    mkBarrier(45, 60, "x", 20, 1.2, 18);
    mkBarrier(-30, -55, "z", 18, 1.5, 16);
    mkBarrier(-70, 10, "x", 16, 1.8, 14);
    mkBarrier(0, 80, "z", 22, 2.0, 20);
    mkBarrier(0, 125, "x", 24, 2.2, 22);

    // --- Whirlpools (pull the boat in) ---
    const whirlMat = new THREE.MeshBasicMaterial({ color: 0x2244aa, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const whirlSpots: [number, number, number][] = [
      [10, -10, 12], [-40, 20, 10], [55, -40, 11],
    ];
    for (const [x, z, r] of whirlSpots) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(r * 0.3, r, 24), whirlMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.15, z);
      scene.add(mesh);
      this.whirlpools.push({ x, z, r, mesh });
    }

    // --- Ramps (launch the boat) ---
    const rampMat = new THREE.MeshLambertMaterial({ color: 0x44aacc });
    const mkRamp = (x: number, z: number, angle: number, len: number) => {
      const geo = new THREE.BoxGeometry(10, 0.5, len);
      const mesh = new THREE.Mesh(geo, rampMat);
      mesh.position.set(x, 0.5, z);
      mesh.rotation.y = angle;
      mesh.rotation.x = -0.18; // tilt up
      scene.add(mesh);
      this.ramps.push({ x, z, angle, mesh, len });
    };
    mkRamp(30, -50, -Math.PI / 2, 12);   // mid-course ramp
    mkRamp(0, 105, Math.PI, 16);         // FINAL BIG RAMP (dramatic jump)
  },
  reset() {
    for (const cp of this.checkpoints) cp.passed = false;
    for (const m of this.mines) { m.alive = true; (m.mesh.children[1] as THREE.Mesh).visible = true; }
    this.current = 0;
  },
};

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
  // visual refs
  hull: null as THREE.Mesh | null,
  cabin: null as THREE.Mesh | null,
  nitroGlow: null as THREE.Mesh | null,
  wakeTrail: [] as THREE.Mesh[],
  sprayParticles: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[],

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

    // --- Nitro glow (visible when boosting) ---
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x33ccff, transparent: true, opacity: 0 });
    const glow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 8), glowMat);
    glow.rotation.x = Math.PI / 2; // point backward
    glow.position.set(0, 0.6, -4.6);
    this.nitroGlow = glow;
    g.add(glow);

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
  reset() {
    this.pos.set(0, 0, -160);
    this.vel.set(0, 0, 0);
    this.heading = 0;
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    this.health = 100;
    this.boostEnergy = 100;
    this.invuln = 2;
    this.syncVisual();
  },
  damage(amount: number, source: string) {
    if (this.invuln > 0) return;
    this.health -= amount;
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
        this.boostEnergy = Math.max(0, this.boostEnergy - BOOST_DRAIN * dt);
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
    // heading 0 = +Z (north), forward dir = (sin h, cos h). Pressing D
    // (steer=+1) swings the bow toward +X (east) = DECREASING heading.
    this.heading -= Input.steer * TURN_RATE * turnEff * dt * (this.speed > 1 ? 1 : 0);

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

    // --- Wake trail ---
    if (this.speed > 5 && Math.random() < 0.6) {
      const wake = new THREE.Mesh(
        new THREE.CircleGeometry(0.5 + Math.random() * 0.5, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
      );
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(this.pos.x - dirX * 3.5, 0.12, this.pos.z - dirZ * 3.5);
      scene.add(wake);
      this.wakeTrail.push(wake);
      if (this.wakeTrail.length > 40) {
        const old = this.wakeTrail.shift()!;
        scene.remove(old);
      }
    }
    for (let i = this.wakeTrail.length - 1; i >= 0; i--) {
      const w = this.wakeTrail[i];
      (w.material as THREE.MeshBasicMaterial).opacity -= dt * 0.5;
      if ((w.material as THREE.MeshBasicMaterial).opacity <= 0) {
        scene.remove(w);
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
        scene.remove(p.mesh);
        this.sprayParticles.splice(i, 1);
      }
    }

    this.syncVisual();
    AudioSys.setEngine(this.speed / (MAX_SPEED * BOOST_MULT), boosting);
  },
};

function spawnSpray(x: number, y: number, z: number, n: number) {
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.15 + Math.random() * 0.2, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xcceeff, transparent: true, opacity: 1 })
    );
    mesh.position.set(x, y, z);
    scene.add(mesh);
    Boat.sprayParticles.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8),
      life: 0.6 + Math.random() * 0.4,
    });
  }
}

/* ================= 6. OCEAN ================= */
let oceanGeo: THREE.PlaneGeometry;
let oceanMat: THREE.MeshPhongMaterial;
const OCEAN_SEGS = 60;
const OCEAN_SIZE = ARENA * 2.4;

function buildOcean(scene: THREE.Scene) {
  oceanGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGS, OCEAN_SEGS);
  oceanMat = new THREE.MeshPhongMaterial({
    color: 0x1a6699,
    specular: 0x88ccff,
    shininess: 90,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);
}
// Simple analytical wave height (sum of sines) — used for both visual & physics
function waveH(x: number, z: number, t: number) {
  return (
    Math.sin(x * 0.08 + t * 1.2) * 0.5 +
    Math.sin(z * 0.1 + t * 0.9) * 0.4 +
    Math.sin((x + z) * 0.05 + t * 1.6) * 0.3
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

/* ================= 7. ENVIRONMENT (islands, birds, sky) ================= */
let birds: { mesh: THREE.Group; angle: number; radius: number; speed: number; y: number }[] = [];
function buildEnvironment(scene: THREE.Scene) {
  // Sky dome (gradient via large sphere with vertex colors)
  const skyGeo = new THREE.SphereGeometry(500, 16, 12);
  const skyColors: number[] = [];
  const pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 500; // -1..1
    const r = 0.4 + (1 - Math.abs(y)) * 0.2;
    const g = 0.6 + (1 - Math.abs(y)) * 0.25;
    const b = 0.9 + y * 0.1;
    skyColors.push(r, g, Math.min(1, b));
  }
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(skyColors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Sun
  const sun = new THREE.Mesh(new THREE.SphereGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffee88 }));
  sun.position.set(150, 120, -200);
  scene.add(sun);

  // Distant islands
  const islandMat = new THREE.MeshLambertMaterial({ color: 0x3a7a4a });
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xd4c088 });
  const islandSpots: [number, number, number][] = [
    [-280, -260, 40], [300, -200, 55], [-250, 280, 45], [280, 260, 60], [0, -320, 50],
  ];
  for (const [x, z, r] of islandSpots) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.3, 6, 10), sandMat);
    base.position.set(x, 2, z);
    scene.add(base);
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r * 0.7, r * 0.8, 8), islandMat);
    hill.position.set(x, 6 + r * 0.3, z);
    scene.add(hill);
  }

  // Birds (simple V-shapes circling)
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const wingGeo = new THREE.BoxGeometry(1.5, 0.05, 0.4);
    const w1 = new THREE.Mesh(wingGeo, birdMat);
    w1.position.x = 0.7;
    const w2 = new THREE.Mesh(wingGeo, birdMat);
    w2.position.x = -0.7;
    g.add(w1, w2);
    const radius = 60 + Math.random() * 80;
    g.position.set(Math.cos(i) * radius, 40 + Math.random() * 20, Math.sin(i) * radius);
    scene.add(g);
    birds.push({ mesh: g, angle: i, radius, speed: 0.15 + Math.random() * 0.1, y: 40 + Math.random() * 20 });
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

const game = {
  state: "start" as GameState,
  time: 0,
  penalty: 0,
  checkpointsPassed: 0,
  totalCheckpoints: 0,
  boostFlash: 0,

  startGame() {
    AudioSys.init(); AudioSys.resume();
    this.time = 0; this.penalty = 0; this.checkpointsPassed = 0;
    this.totalCheckpoints = Course.checkpoints.length;
    Boat.reset();
    Course.reset();
    this.state = "playing";
    hideAllScreens();
    updateHUD();
  },
  restart() { this.startGame(); },
  togglePause() {
    if (this.state === "playing") { this.state = "paused"; show("pb-screen-pause"); }
    else if (this.state === "paused") { this.state = "playing"; hide("pb-screen-pause"); }
  },
  toggleMute() {
    AudioSys.init();
    AudioSys.setMuted(!AudioSys.muted);
    const btn = document.getElementById("pb-mute");
    if (btn) btn.innerHTML = AudioSys.muted ? "&#128263;" : "&#128266;";
  },
  addPenalty(sec: number) {
    this.penalty += sec;
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
      Boat.pos.set(0, 0, -160);
      Boat.heading = 0;
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
    AudioSys.gameover();
    const el = document.getElementById("pb-stats");
    if (el) el.innerHTML = `Süre: ${(this.time + this.penalty).toFixed(1)}s &nbsp; Kontrol Noktası: ${this.checkpointsPassed}/${this.totalCheckpoints}`;
    show("pb-screen-gameover");
  },
  victory() {
    this.state = "victory";
    AudioSys.stopEngine();
    AudioSys.victory();
    const total = this.time + this.penalty;
    const el = document.getElementById("pb-stats-v");
    if (el) el.innerHTML = `Final Süre: ${total.toFixed(1)}s (ceza +${this.penalty.toFixed(1)}s)`;
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
          this.victory();
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
          showToast("KONTROL NOKTASI KAÇTI! -" + MISS_PENALTY + "s");
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
.pb-hud { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:flex-start; padding:10px 14px; pointer-events:none; z-index:5; font-family:'Courier New',monospace; }
.pb-hud-box { background:rgba(0,0,0,0.5); border:2px solid rgba(0,200,255,0.5); border-radius:8px; color:#fff; font-size:14px; font-weight:bold; padding:6px 12px; letter-spacing:1px; text-shadow:1px 1px 0 #000; display:flex; flex-direction:column; gap:4px; }
.pb-bar { width:130px; height:10px; background:rgba(255,255,255,0.2); border-radius:5px; overflow:hidden; }
.pb-bar-fill { height:100%; transition:width 0.15s; }
.pb-hp-fill { background:linear-gradient(90deg,#ff3333,#ff7755); }
.pb-boost-fill { background:linear-gradient(90deg,#00ccff,#66ffff); }
.pb-speedo { position:absolute; bottom:18px; right:18px; width:110px; height:110px; z-index:5; pointer-events:none; }
.pb-speedo svg { width:100%; height:100%; }
.pb-speedo .spd-num { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:'Courier New',monospace; font-size:26px; font-weight:bold; color:#fff; text-shadow:2px 2px 0 #000; }
.pb-speedo .spd-unit { position:absolute; bottom:22px; left:0; right:0; text-align:center; font-size:10px; color:#88ccff; font-family:'Courier New',monospace; }
.pb-minimap { position:absolute; bottom:18px; left:18px; width:130px; height:130px; background:rgba(0,20,40,0.7); border:2px solid rgba(0,200,255,0.5); border-radius:8px; z-index:5; pointer-events:none; }
.pb-mute { pointer-events:auto; cursor:pointer; background:rgba(0,0,0,0.5); border:2px solid rgba(255,255,255,0.6); border-radius:8px; color:#fff; font-size:16px; width:40px; height:36px; }
.pb-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,10,25,0.88); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.pb-overlay.hidden { display:none; }
.pb-overlay h1 { font-size:clamp(30px,7vw,58px); letter-spacing:4px; color:#00ddff; text-shadow:3px 3px 0 #004466,6px 6px 0 rgba(0,0,0,0.5); margin-bottom:12px; }
.pb-overlay h2 { font-size:clamp(18px,4vw,28px); margin-bottom:14px; color:#ffcc44; text-shadow:2px 2px 0 #000; }
.pb-overlay p { font-size:clamp(13px,2.2vw,17px); line-height:1.8; margin-bottom:8px; color:#cfe8ff; }
.pb-overlay .big-btn { margin-top:24px; font-family:inherit; font-size:clamp(16px,3vw,22px); font-weight:bold; padding:14px 38px; background:linear-gradient(#00ccff,#0088cc); color:#fff; border:3px solid #fff; border-radius:12px; cursor:pointer; box-shadow:0 5px 0 #004466; letter-spacing:2px; }
.pb-overlay .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #004466; }
.pb-overlay .keys { margin-top:18px; font-size:13px; color:#88aacc; line-height:2; }
.pb-overlay .keys b { color:#00ddff; }
.pb-stats { font-size:clamp(15px,2.6vw,20px); color:#ffdd44; margin:8px 0; }
.pb-toast { position:absolute; top:20%; left:0; right:0; text-align:center; font-family:'Courier New',monospace; font-size:clamp(20px,4vw,36px); font-weight:bold; color:#00ffcc; text-shadow:3px 3px 0 #000; z-index:6; pointer-events:none; opacity:0; transition:opacity 0.3s; letter-spacing:3px; }
.pb-toast.show { opacity:1; }
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
      <span>SÜRE <span id="pb-time">0.0</span>s</span>
      <span>KAPI <span id="pb-cp">0</span>/<span id="pb-cp-total">0</span></span>
      <span>CAN <span class="pb-bar"><span class="pb-bar-fill pb-hp-fill" id="pb-hp-fill" style="width:100%"></span></span></span>
      <span>NİTRO <span class="pb-bar"><span class="pb-bar-fill pb-boost-fill" id="pb-boost-fill" style="width:100%"></span></span></span>
    </div>
    <button id="pb-mute" class="pb-mute" title="Sesi kapat (M)">&#128266;</button>`;
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

  // Minimap
  const minimap = document.createElement("canvas");
  minimap.width = 130; minimap.height = 130;
  minimap.className = "pb-minimap";
  container.appendChild(minimap);
  minimapCtx = minimap.getContext("2d");

  const toast = document.createElement("div");
  toast.className = "pb-toast";
  toast.id = "pb-toast";
  container.appendChild(toast);

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
    <p>Okyanusta ilerle, mayınlardan ve kayalardan kaç, her kontrol kapısından geç.</p>
    <p>Final rampasına dikkat — o atlayış efsanedir.</p>
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
    <h1>BİTİŞ!</h1>
    <p>Parkuru fethettin. O final atlayışı efsaneydi.</p>
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
  on("pb-btn-start", () => game.startGame());
  on("pb-btn-resume", () => game.togglePause());
  on("pb-btn-restart", () => game.restart());
  on("pb-btn-retry", () => game.restart());
  on("pb-btn-again", () => game.restart());
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
function updateHUD() {
  const set = (id: string, v: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set("pb-time", (game.time + game.penalty).toFixed(1));
  set("pb-cp", game.checkpointsPassed);
  set("pb-cp-total", game.totalCheckpoints);
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
  const S = 130;
  const scale = S / (ARENA * 2);
  ctx.clearRect(0, 0, S, S);
  // Background
  ctx.fillStyle = "rgba(0,30,60,0.8)";
  ctx.fillRect(0, 0, S, S);
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
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x88bbee, 60, 320);

  camera = new THREE.PerspectiveCamera(70, 960 / 540, 0.1, 600);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lights
  const ambient = new THREE.AmbientLight(0x8899bb, 0.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffeecc, 1.4);
  sun.position.set(100, 150, -100);
  scene.add(sun);

  buildOcean(scene);
  buildEnvironment(scene);
  Course.build(scene);
  Boat.build(scene);
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
    game.update(dt);
    if (game.state === "playing") updateCamera(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    Input.cleanup();
    AudioSys.stopEngine();
    wrap.remove();
    renderer.dispose();
    canvasEl = null;
  };
}