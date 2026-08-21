/* =====================================================================
   STARSTRIKER — 3D Space Shooter (Three.js)
   Endless rail-shooter: your fighter auto-flies into an asteroid field.
   WASD/arrows steer, Space fires lasers, Shift boosts (score bonus).
   Asteroids split when shot, enemy squadrons shoot back, power-ups
   drop from wreckage. All graphics procedural, all audio synthesized
   with the Web Audio API. No external assets.

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */
import * as THREE from "three";

/* ================= 1. CONSTANTS ================= */
const CRUISE = 55;            // world base speed (m/s), ship flies -z
const BOOST_MULT = 1.7;
const STEER_ACCEL = 240;      // lateral acceleration (m/s^2)
const STEER_DAMP = 6;         // lateral damping (1/s) -> ~40 m/s terminal
const MAX_LATERAL = 95;       // x clamp
const MAX_VERT = 52;          // y clamp
const FIRE_RATE = 0.16;       // seconds between shots
const FIRE_RATE_RAPID = 0.07;
const LASER_SPEED = 380;
const LASER_DAMAGE = 1;
const BOLT_SPEED = 150;
const SHIP_RADIUS = 2.2;
const SPAWN_Z = -760;         // objects spawn far ahead
const KILL_Z = 220;           // recycle/remove past the camera
const WAVE_TIME = 25;         // seconds per wave
const COMBO_WINDOW = 4;       // seconds before kill-streak decays

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
      this.master.connect(this.ctx.destination);
      // Continuous engine hum (sawtooth through lowpass, pitch follows speed)
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 40;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 220;
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
    const f = 38 + speed01 * 130 + (boosting ? 45 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.1);
    this.engineFilter.frequency.setTargetAtTime(180 + speed01 * 700, t, 0.1);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.03 + speed01 * 0.09, t, 0.12);
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
  laser() { this.tone("square", 950, 260, 0.12, 0.22); },
  laserRapid() { this.tone("square", 1250, 400, 0.09, 0.18); },
  explosion(big = false) {
    this.noise(big ? 0.7 : 0.45, big ? 0.7 : 0.5, 0, big ? 350 : 600);
    this.tone("sine", big ? 120 : 180, 30, big ? 0.7 : 0.4, big ? 0.6 : 0.4);
  },
  hullHit() { this.noise(0.25, 0.5, 0, 800); this.tone("sawtooth", 220, 60, 0.25, 0.4); },
  shieldHit() { this.tone("square", 400, 900, 0.15, 0.3); },
  powerup() { [660, 880, 1320].forEach((f, i) => this.tone("square", f, f, 0.12, 0.3, i * 0.07)); },
  boost() { this.tone("sawtooth", 180, 640, 0.35, 0.25); },
  wave() { [523, 659, 784].forEach((f, i) => this.tone("triangle", f, f, 0.16, 0.35, i * 0.11)); },
  gameover() { [330, 262, 196, 131, 98].forEach((f, i) => this.tone("triangle", f, f, 0.4, 0.4, i * 0.26)); },
  fanfare() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => this.tone("square", f, f, 0.18, 0.3, i * 0.13)); },
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.4;
    if (m) this.stopEngine();
  },
};

/* ================= 3. INPUT ================= */
const Input = {
  up: false, down: false, left: false, right: false,
  fire: false, boost: false,
  tUp: false, tDown: false, tLeft: false, tRight: false, tFire: false, tBoost: false,
  init() {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", " ", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
      if (k === "w" || k === "arrowup") this.up = true;
      if (k === "s" || k === "arrowdown") this.down = true;
      if (k === "a" || k === "arrowleft") this.left = true;
      if (k === "d" || k === "arrowright") this.right = true;
      if (k === " ") this.fire = true;
      if (k === "shift") this.boost = true;
      if (k === "p") game.togglePause();
      if (k === "m") game.toggleMute();
      if (k === "r") game.restart();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") this.up = false;
      if (k === "s" || k === "arrowdown") this.down = false;
      if (k === "a" || k === "arrowleft") this.left = false;
      if (k === "d" || k === "arrowright") this.right = false;
      if (k === " ") this.fire = false;
      if (k === "shift") this.boost = false;
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
    bind("ss-t-left", "tLeft");
    bind("ss-t-right", "tRight");
    bind("ss-t-up", "tUp");
    bind("ss-t-down", "tDown");
    bind("ss-t-fire", "tFire");
    bind("ss-t-boost", "tBoost");
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
  get x() { return (this.right || this.tRight ? 1 : 0) + (this.left || this.tLeft ? -1 : 0); },
  get y() { return (this.up || this.tUp ? 1 : 0) + (this.down || this.tDown ? -1 : 0); },
  get firing() { return this.fire || this.tFire; },
  get boosting() { return (this.boost || this.tBoost) && Ship.boostEnergy > 2; },
};

/* ================= 4. SHIP ================= */
const Ship = {
  mesh: null as THREE.Group | null,
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  bank: 0,
  pitch: 0,
  bobT: 0,
  boostEnergy: 100,
  engineGlow: null as THREE.Mesh | null,
  engineLight: null as THREE.PointLight | null,
  speed() { return game.cruise; },
  build(scene: THREE.Scene) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xcfd8ea });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x4a5568 });
    const redMat = new THREE.MeshLambertMaterial({ color: 0xcc3344 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x88ccff });
    const cockpitMat = new THREE.MeshBasicMaterial({ color: 0x99eeff });

    // Fuselage (cone points -z)
    const fuselage = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5, 10), bodyMat);
    fuselage.rotation.x = -Math.PI / 2;
    g.add(fuselage);
    // Nose tip
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 8), redMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -3.2;
    g.add(nose);
    // Cockpit
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), cockpitMat);
    cockpit.position.set(0, 0.42, -1.2);
    g.add(cockpit);
    // Main wing
    const wing = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.18, 2.6), darkMat);
    wing.position.set(0, -0.15, 0.7);
    g.add(wing);
    // Wingtip fins
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 1.8), redMat);
      fin.position.set(s * 3.2, 0.2, 1.0);
      fin.rotation.z = s * -0.35;
      g.add(fin);
    }
    // Twin tail fins
    for (const s of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 1.1), darkMat);
      tail.position.set(s * 0.85, 0.8, 2.0);
      tail.rotation.z = s * 0.3;
      g.add(tail);
    }
    // Engine glow (additive, pulses)
    const glow = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 2.2, 10),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.rotation.x = Math.PI / 2; // point +z
    glow.position.z = 2.9;
    g.add(glow);
    const core = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    core.rotation.x = Math.PI / 2;
    core.position.z = 3.4;
    g.add(core);
    // Engine light
    const light = new THREE.PointLight(0x66ccff, 2.2, 40);
    light.position.z = 4;
    g.add(light);

    scene.add(g);
    this.mesh = g;
    this.engineGlow = glow;
    this.engineLight = light;
  },
  reset() {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.bank = 0;
    this.pitch = 0;
    this.boostEnergy = 100;
  },
  update(dt: number) {
    const ax = Input.x * STEER_ACCEL;
    const ay = Input.y * STEER_ACCEL;
    this.vel.x += (ax - this.vel.x * STEER_DAMP) * dt;
    this.vel.y += (ay - this.vel.y * STEER_DAMP) * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.x = Math.max(-MAX_LATERAL, Math.min(MAX_LATERAL, this.pos.x));
    this.pos.y = Math.max(-MAX_VERT, Math.min(MAX_VERT, this.pos.y));
    // Boost energy
    const draining = Input.boosting && game.state === "playing";
    this.boostEnergy = Math.max(0, Math.min(100, this.boostEnergy + (draining ? -30 : 14) * dt));
    // Bank / pitch animation
    const tBank = -Input.x * 0.55;
    const tPitch = Input.y * 0.35;
    this.bank += (tBank - this.bank) * Math.min(1, dt * 7);
    this.pitch += (tPitch - this.pitch) * Math.min(1, dt * 7);
    this.bobT += dt * 2.2;
    if (this.mesh) {
      this.mesh.position.set(this.pos.x, this.pos.y + Math.sin(this.bobT) * 0.35, 0);
      this.mesh.rotation.z = this.bank;
      this.mesh.rotation.x = this.pitch;
      // Engine glow pulse scales with boost
      const boost = this.boostEnergy / 100;
      const s = 1 + boost * 0.5 + Math.sin(this.bobT * 3) * 0.12;
      if (this.engineGlow) this.engineGlow.scale.set(s, s, 1 + boost * 0.8);
      if (this.engineLight) this.engineLight.intensity = 1.6 + boost * 2.4;
    }
  },
  hitFlash: 0,
};

/* ================= 5. PROJECTILES ================= */
interface Laser {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  prev: THREE.Vector3;
  target: Asteroid | Enemy | null;
}
const Lasers = {
  list: [] as Laser[],
  mat: new THREE.MeshBasicMaterial({ color: 0x66ffff }),
  cool: 0,
  build(scene: THREE.Scene) {
    // Pre-build a few laser meshes (pooled)
    const geo = new THREE.BoxGeometry(0.24, 0.24, 3.2);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      m.visible = false;
      scene.add(m);
      this.list.push({ mesh: m, vx: 0, vy: 0, prev: new THREE.Vector3(), target: null });
    }
  },
  fire() {
    // Pick the nearest target ahead (enemies weighted higher than rocks)
    let best: Asteroid | Enemy | null = null;
    let bestD = Infinity;
    const sx = Ship.pos.x, sy = Ship.pos.y, sz = Ship.pos.z;
    for (const a of Asteroids.list) {
      if (!a.mesh.visible || !a.alive || a.mesh.position.z > sz - 8) continue;
      const d = (a.mesh.position.x - sx) * (a.mesh.position.x - sx) + (a.mesh.position.y - sy) * (a.mesh.position.y - sy) + (a.mesh.position.z - sz) * (a.mesh.position.z - sz);
      if (d < bestD) { bestD = d; best = a; }
    }
    for (const e of Enemies.list) {
      if (!e.group.visible || !e.alive || e.group.position.z > sz - 8) continue;
      const dx = e.group.position.x - sx, dy = e.group.position.y - sy, dz = e.group.position.z - sz;
      const d = (dx * dx + dy * dy + dz * dz) * 0.7; // prefer enemies
      if (d < bestD) { bestD = d; best = e; }
    }
    // Two wing cannons, slight spread
    const sides = [-0.9, 0.9];
    let used = 0;
    for (const sx2 of sides) {
      const l = this.list.find((x) => !x.mesh.visible);
      if (!l) continue;
      l.mesh.visible = true;
      l.mesh.position.set(Ship.pos.x + sx2 * 1.6, Ship.pos.y - 0.1, -3.2);
      l.vx = 0;
      l.vy = Math.sin(Ship.pitch) * 6;
      l.target = best;
      used++;
    }
    if (used > 0) {
      if (game.rapidTimer > 0) AudioSys.laserRapid(); else AudioSys.laser();
    }
  },
  update(dt: number) {
    const speed = LASER_SPEED + Ship.speed();
    for (const l of this.list) {
      if (!l.mesh.visible) continue;
      l.prev.copy(l.mesh.position);
      // Homing: steer laterally toward the assigned target (proportional nav)
      const t = l.target;
      if (t && "alive" in t && t.alive) {
        const tm = "mesh" in t ? t.mesh : t.group;
        if (tm.visible) {
          const errX = tm.position.x - l.mesh.position.x;
          const errY = tm.position.y - l.mesh.position.y;
          const distZ = Math.max(12, Math.abs(tm.position.z - l.mesh.position.z));
          const tti = distZ / speed;
          l.vx = Math.max(-95, Math.min(95, errX / Math.max(0.12, tti)));
          l.vy = Math.max(-95, Math.min(95, errY / Math.max(0.12, tti)));
        }
      } else {
        l.vx *= (1 - dt * 4);
        l.vy *= (1 - dt * 4);
      }
      l.mesh.position.z += -(speed) * dt;
      l.mesh.position.x += l.vx * dt;
      l.mesh.position.y += l.vy * dt;
      if (l.mesh.position.z < -950) l.mesh.visible = false;
    }
  },
};

/* ================= 6. ASTEROIDS ================= */
interface Asteroid {
  mesh: THREE.Mesh;
  r: number;
  vx: number; vy: number; vz: number;
  spin: THREE.Vector3;
  size: number;   // 2 big, 1 medium, 0 small
  alive: boolean;
  t: number;
}
const Asteroids = {
  list: [] as Asteroid[],
  matBig: new THREE.MeshLambertMaterial({ color: 0x9a8f78, flatShading: true }),
  matMed: new THREE.MeshLambertMaterial({ color: 0x7d735f, flatShading: true }),
  matSmall: new THREE.MeshLambertMaterial({ color: 0x645c4b, flatShading: true }),
  geo: null as THREE.BufferGeometry | null,
  build(scene: THREE.Scene) {
    // Rockier-looking icosahedron: displace vertices once
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const f = 0.75 + Math.random() * 0.5;
      arr[i] *= f; arr[i + 1] *= f; arr[i + 2] *= f;
    }
    geo.computeVertexNormals();
    this.geo = geo;
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(geo, this.matBig);
      m.visible = false;
      scene.add(m);
      this.list.push({
        mesh: m, r: 2, vx: 0, vy: 0, vz: 0,
        spin: new THREE.Vector3(), size: 2, alive: false, t: 0,
      });
    }
  },
  spawn(count = 1, forceSize = -1) {
    for (let n = 0; n < count; n++) {
      const a = this.list.find((x) => !x.mesh.visible);
      if (!a) return;
      const size = forceSize >= 0 ? forceSize : (Math.random() < 0.5 ? 2 : 1 + (Math.random() < 0.3 ? 0 : 1));
      const scale = size === 2 ? 2.6 + Math.random() * 2.2 : size === 1 ? 1.5 + Math.random() * 0.9 : 0.7 + Math.random() * 0.5;
      a.size = size;
      a.r = scale * 1.12;
      a.mesh.geometry = this.geo!;
      (a.mesh.material as THREE.MeshLambertMaterial).color.copy(
        size === 2 ? this.matBig.color : size === 1 ? this.matMed.color : this.matSmall.color
      );
      a.mesh.scale.set(scale, scale, scale);
      // Spawn ahead, keeping a soft corridor around the ship's lane
      const side = Math.random() < 0.5 ? -1 : 1;
      a.mesh.position.set(
        side * (20 + Math.random() * 100),
        (Math.random() * 2 - 1) * 70,
        SPAWN_Z - Math.random() * 120
      );
      a.vx = (Math.random() * 2 - 1) * 8;
      a.vy = (Math.random() * 2 - 1) * 8;
      a.vz = CRUISE + (Math.random() * 2 - 1) * 6;
      a.spin.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.6 + Math.random());
      a.alive = true;
      a.t = Math.random() * 10;
      a.mesh.visible = true;
    }
  },
  update(dt: number, cruise: number) {
    for (const a of this.list) {
      if (!a.mesh.visible || !a.alive) continue;
      a.t += dt;
      a.mesh.position.x += a.vx * dt + Math.sin(a.t * 0.7) * 0.4;
      a.mesh.position.y += a.vy * dt + Math.cos(a.t * 0.6) * 0.4;
      a.mesh.position.z += a.vz * dt;
      a.mesh.rotation.x += a.spin.x * dt;
      a.mesh.rotation.y += a.spin.y * dt;
      a.mesh.rotation.z += a.spin.z * dt;
      if (a.mesh.position.z > KILL_Z) {
        // Flew past — recycle as a fresh rock ahead
        const side = Math.random() < 0.5 ? -1 : 1;
        a.mesh.position.set(side * (20 + Math.random() * 100), (Math.random() * 2 - 1) * 70, SPAWN_Z - Math.random() * 200);
        a.mesh.visible = true;
      }
    }
  },
  hit(index: number) {
    const a = this.list[index];
    a.alive = false;
    a.mesh.visible = false;
  },
  destroy(index: number) {
    const a = this.list[index];
    const p = a.mesh.position.clone();
    a.alive = false;
    a.mesh.visible = false;
    Explosions.burst(p, a.size === 2 ? 26 : 16);
    AudioSys.explosion(a.size === 2);
    if (a.size > 0) {
      // Split into two smaller rocks
      for (let i = 0; i < 2; i++) {
        const sm = this.list.find((x) => !x.mesh.visible);
        if (!sm) break;
        const scale = a.size === 2 ? 1.3 + Math.random() * 0.7 : 0.7 + Math.random() * 0.4;
        sm.size = a.size - 1;
        sm.r = scale * 1.12;
        sm.mesh.geometry = this.geo!;
        (sm.mesh.material as THREE.MeshLambertMaterial).color.copy(
          sm.size === 1 ? this.matMed.color : this.matSmall.color
        );
        sm.mesh.scale.set(scale, scale, scale);
        sm.mesh.position.copy(p);
        sm.mesh.position.x += (Math.random() * 2 - 1) * 2;
        sm.mesh.position.y += (Math.random() * 2 - 1) * 2;
        sm.vx = (Math.random() * 2 - 1) * 14;
        sm.vy = (Math.random() * 2 - 1) * 14;
        sm.vz = CRUISE + (Math.random() * 2 - 1) * 8;
        sm.spin.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(1.4);
        sm.alive = true;
        sm.mesh.visible = true;
      }
    }
    return a.size;
  },
};

/* ================= 7. ENEMIES ================= */
interface Enemy {
  group: THREE.Group;
  hp: number;
  r: number;
  vx: number; vy: number;
  fireT: number;
  alive: boolean;
  t: number;
  baseX: number;
}
const Enemies = {
  list: [] as Enemy[],
  matBody: new THREE.MeshLambertMaterial({ color: 0xcc3344 }),
  matDark: new THREE.MeshLambertMaterial({ color: 0x662233 }),
  build(scene: THREE.Scene) {
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3.4, 8), this.matBody);
      body.rotation.x = -Math.PI / 2;
      g.add(body);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.14, 1.6), this.matDark);
      wing.position.set(0, 0.05, 0.4);
      g.add(wing);
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffcc66 })
      );
      core.position.set(0, 0.3, -0.6);
      g.add(core);
      g.visible = false;
      scene.add(g);
      this.list.push({ group: g, hp: 2, r: 2.2, vx: 0, vy: 0, fireT: 2, alive: false, t: 0, baseX: 0 });
    }
  },
  spawn() {
    const e = this.list.find((x) => !x.group.visible);
    if (!e) return;
    e.hp = 2;
    e.baseX = (Math.random() * 2 - 1) * 70;
    e.group.position.set(e.baseX, (Math.random() * 2 - 1) * 45, SPAWN_Z);
    e.group.rotation.set(0, 0, 0);
    e.vx = (Math.random() * 2 - 1) * 10;
    e.vy = (Math.random() * 2 - 1) * 6;
    e.fireT = 1.6 + Math.random() * 1.6;
    e.alive = true;
    e.t = 0;
    e.group.visible = true;
  },
  update(dt: number, cruise: number) {
    for (const e of this.list) {
      if (!e.group.visible || !e.alive) continue;
      e.t += dt;
      // Weave toward the player lane
      e.group.position.x += e.vx * dt + Math.sin(e.t * 1.4) * 5 * dt;
      e.group.position.y += e.vy * dt + Math.cos(e.t * 1.1) * 4 * dt;
      e.group.position.z += (cruise + 10) * dt;
      e.group.rotation.z = Math.sin(e.t * 1.4) * 0.3;
      e.group.rotation.x = Math.sin(e.t * 1.1) * 0.2;
      // Fire at the player
      e.fireT -= dt;
      if (e.fireT <= 0 && e.group.position.z < -60) {
        e.fireT = 1.8 + Math.random() * 1.4 + Math.max(0, 3 - game.wave) * 0.1;
        Bolts.fire(e.group.position, Ship.pos);
        AudioSys.tone("sawtooth", 300, 140, 0.12, 0.15);
      }
      if (e.group.position.z > KILL_Z) e.group.visible = false;
    }
  },
  hurt(index: number, dmg: number) {
    const e = this.list[index];
    e.hp -= dmg;
    if (e.hp <= 0) {
      const p = e.group.position.clone();
      e.alive = false;
      e.group.visible = false;
      Explosions.burst(p, 24);
      AudioSys.explosion(true);
      game.addKill(500, p);
    }
  },
};

/* ================= 8. ENEMY BOLTS ================= */
interface Bolt { mesh: THREE.Mesh; vx: number; vy: number; vz: number; prev: THREE.Vector3; }
const Bolts = {
  list: [] as Bolt[],
  mat: new THREE.MeshBasicMaterial({ color: 0xff6644 }),
  build(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.32, 8, 6);
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      m.visible = false;
      scene.add(m);
      this.list.push({ mesh: m, vx: 0, vy: 0, vz: 0, prev: new THREE.Vector3() });
    }
  },
  fire(from: THREE.Vector3, target: THREE.Vector3) {
    const b = this.list.find((x) => !x.mesh.visible);
    if (!b) return;
    b.mesh.position.copy(from);
    const dir = new THREE.Vector3().subVectors(target, from);
    dir.z = Math.max(dir.z, 60); // mostly toward the player
    dir.normalize();
    b.vx = dir.x * BOLT_SPEED;
    b.vy = dir.y * BOLT_SPEED;
    b.vz = dir.z * BOLT_SPEED + CRUISE * 0.6;
    b.mesh.visible = true;
  },
  update(dt: number) {
    for (const b of this.list) {
      if (!b.mesh.visible) continue;
      b.prev.copy(b.mesh.position);
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      b.mesh.rotation.x += dt * 8;
      if (b.mesh.position.z > KILL_Z || b.mesh.position.z < -950) b.mesh.visible = false;
    }
  },
};

/* ================= 9. POWER-UPS ================= */
interface PowerUp { mesh: THREE.Group; type: string; t: number; vz: number; alive: boolean; }
const POWERUP_COLORS: Record<string, number> = {
  shield: 0x66ccff,
  rapid: 0xffcc44,
  repair: 0x66ff88,
  star: 0xff77ff,
};
const PowerUps = {
  list: [] as PowerUp[],
  build(scene: THREE.Scene) {
    for (const type of Object.keys(POWERUP_COLORS)) {
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Group();
        const gem = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.85, 0),
          new THREE.MeshBasicMaterial({ color: POWERUP_COLORS[type], transparent: true, opacity: 0.9 })
        );
        g.add(gem);
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(1.25, 10, 8),
          new THREE.MeshBasicMaterial({ color: POWERUP_COLORS[type], transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        g.add(halo);
        g.visible = false;
        scene.add(g);
        this.list.push({ mesh: g, type, t: Math.random() * 10, vz: CRUISE + 4, alive: false });
      }
    }
  },
  drop(pos: THREE.Vector3) {
    const roll = Math.random();
    const type = roll < 0.34 ? "shield" : roll < 0.6 ? "rapid" : roll < 0.84 ? "repair" : "star";
    const p = this.list.find((x) => !x.mesh.visible && x.type === type);
    if (!p) return;
    p.mesh.position.copy(pos);
    p.alive = true;
    p.t = 0;
    p.mesh.visible = true;
  },
  update(dt: number) {
    for (const p of this.list) {
      if (!p.mesh.visible || !p.alive) continue;
      p.t += dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.position.y += Math.sin(p.t * 2.4) * 0.02;
      p.mesh.rotation.y += dt * 2.4;
      p.mesh.rotation.x += dt * 1.2;
      const bob = 1 + Math.sin(p.t * 3) * 0.12;
      p.mesh.scale.set(bob, bob, bob);
      if (p.mesh.position.z > KILL_Z) {
        p.mesh.visible = false;
        p.alive = false;
      }
    }
  },
  collect(index: number) {
    const p = this.list[index];
    p.mesh.visible = false;
    p.alive = false;
    const pos = p.mesh.position.clone();
    Explosions.burst(pos, 14, 0x88ddff);
    AudioSys.powerup();
    switch (p.type) {
      case "shield":
        ShipShield.value = Math.min(60, ShipShield.value + 35);
        showToast("KALKAN +35");
        break;
      case "rapid":
        game.rapidTimer = 6;
        showToast("SERİ ATEŞ!");
        break;
      case "repair":
        game.hull = Math.min(100, game.hull + 25);
        showToast("GÖVDE +25");
        break;
      case "star":
        game.addScore(300, pos);
        showToast("+300");
        break;
    }
  },
};
const ShipShield = { value: 0 };

/* ================= 10. EXPLOSIONS (particle pool) ================= */
const Explosions = {
  parts: [] as { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; maxLife: number }[],
  flashMat: null as THREE.MeshBasicMaterial | null,
  flashMesh: null as THREE.Mesh | null,
  build(scene: THREE.Scene) {
    const geo = new THREE.TetrahedronGeometry(0.55, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 1 });
    for (let i = 0; i < 260; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.parts.push({ mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: 1 });
    }
    // Big flash sphere (shared)
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), this.flashMat);
    this.flashMesh.visible = false;
    scene.add(this.flashMesh);
  },
  burst(pos: THREE.Vector3, count: number, color = 0xffaa44) {
    const mat = (this.parts[0]?.mesh.material ?? null) as THREE.MeshBasicMaterial | null;
    if (mat) mat.color.setHex(color);
    let spawned = 0;
    for (const p of this.parts) {
      if (spawned >= count) break;
      if (p.mesh.visible) continue;
      p.mesh.visible = true;
      p.mesh.position.copy(pos);
      p.mesh.position.x += (Math.random() * 2 - 1) * 0.6;
      p.mesh.position.y += (Math.random() * 2 - 1) * 0.6;
      p.mesh.position.z += (Math.random() * 2 - 1) * 0.6;
      const sp = 14 + Math.random() * 26;
      p.vel.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(sp);
      p.maxLife = 0.5 + Math.random() * 0.45;
      p.life = p.maxLife;
      p.mesh.scale.set(1, 1, 1);
      spawned++;
    }
    if (this.flashMesh && this.flashMat) {
      this.flashMesh.position.copy(pos);
      this.flashMesh.visible = true;
      this.flashMat.opacity = 0.9;
      this.flashMesh.scale.set(1, 1, 1);
    }
  },
  update(dt: number) {
    for (const p of this.parts) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 2.6);
      const s = Math.max(0.02, p.life / p.maxLife);
      p.mesh.scale.set(s, s, s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = s;
    }
    if (this.flashMesh && this.flashMesh.visible && this.flashMat) {
      this.flashMat.opacity -= dt * 3.2;
      this.flashMesh.scale.multiplyScalar(1 + dt * 14);
      if (this.flashMat.opacity <= 0.02) this.flashMesh.visible = false;
    }
  },
};

/* ================= 11. STARFIELD & NEBULA ================= */
let stars: THREE.Points | null = null;
let starPos: Float32Array | null = null;
let nebulas: THREE.Mesh[] = [];
function buildSpace(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x04040f);
  const n = 1400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 420;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * 260;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * 900 - 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  stars = new THREE.Points(geo, mat);
  scene.add(stars);
  starPos = pos;
  // Distant colored nebulas
  const nebMat = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide });
  const mkNeb = (x: number, y: number, z: number, r: number, c: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), nebMat(c));
    m.position.set(x, y, z);
    scene.add(m);
    nebulas.push(m);
  };
  mkNeb(-260, 60, -500, 190, 0x4422aa);
  mkNeb(280, -70, -700, 220, 0x2244aa);
  mkNeb(0, 140, -300, 160, 0x7722aa);
  mkNeb(-100, -120, -900, 240, 0x116644);
}
function updateSpace(dt: number, cruise: number) {
  if (!starPos) return;
  for (let i = 0; i < starPos.length; i += 3) {
    starPos[i + 2] += cruise * 0.85 * dt;
    if (starPos[i + 2] > 80) starPos[i + 2] = -820 - Math.random() * 200;
  }
  if (stars) (stars.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  for (const n of nebulas) n.rotation.y += dt * 0.008;
}

/* ================= 12. CAMERA ================= */
let camera: THREE.PerspectiveCamera;
let shake = 0;
function updateCamera(dt: number) {
  const tx = Ship.pos.x * 0.55;
  const ty = Ship.pos.y * 0.55 + 3.4;
  const sx = shake * (Math.random() * 2 - 1);
  const sy = shake * (Math.random() * 2 - 1);
  camera.position.lerp(new THREE.Vector3(tx + sx, ty + sy, 13.5), Math.min(1, dt * 6));
  camera.lookAt(Ship.pos.x * 0.8, Ship.pos.y * 0.8, -60);
  shake = Math.max(0, shake - dt * 6);
}

/* ================= 13. HUD & OVERLAYS ================= */
const OVERLAY_CSS = `
.ss-hud { position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:flex-start; padding:10px 14px; pointer-events:none; z-index:5; font-family:'Courier New',monospace; }
.ss-hud-box { background:rgba(0,0,0,0.55); border:2px solid rgba(0,200,255,0.45); border-radius:8px; color:#fff; font-size:14px; font-weight:bold; padding:6px 12px; letter-spacing:1px; text-shadow:1px 1px 0 #000; display:flex; flex-direction:column; gap:4px; }
.ss-bar { width:130px; height:10px; background:rgba(255,255,255,0.2); border-radius:5px; overflow:hidden; }
.ss-bar-fill { height:100%; transition:width 0.15s; }
.ss-hull-fill { background:linear-gradient(90deg,#ff3333,#ff7755); }
.ss-shield-fill { background:linear-gradient(90deg,#3399ff,#66ddff); }
.ss-combo { position:absolute; top:14px; left:50%; transform:translateX(-50%); font-family:'Courier New',monospace; font-size:18px; font-weight:bold; color:#ffcc44; text-shadow:2px 2px 0 #000; pointer-events:none; z-index:6; }
.ss-combo.hidden { display:none; }
.ss-cross { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:26px; height:26px; pointer-events:none; z-index:5; opacity:0.7; }
.ss-cross .bar { position:absolute; background:#66ffff; box-shadow:0 0 6px #66ffff; }
.ss-cross .h { left:0; right:0; top:12px; height:2px; }
.ss-cross .v { top:0; bottom:0; left:12px; width:2px; }
.ss-cross .dot { position:absolute; left:11px; top:11px; width:4px; height:4px; border-radius:50%; background:#66ffff; box-shadow:0 0 8px #66ffff; }
.ss-mute { pointer-events:auto; cursor:pointer; background:rgba(0,0,0,0.5); border:2px solid rgba(255,255,255,0.6); border-radius:8px; color:#fff; font-size:16px; width:40px; height:36px; }
.ss-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(2,2,14,0.9); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.ss-overlay.hidden { display:none; }
.ss-overlay h1 { font-size:clamp(30px,7vw,58px); letter-spacing:4px; color:#66ddff; text-shadow:3px 3px 0 #003366,6px 6px 0 rgba(0,0,0,0.5); margin-bottom:12px; }
.ss-overlay h2 { font-size:clamp(18px,4vw,28px); margin-bottom:14px; color:#ffcc44; text-shadow:2px 2px 0 #000; }
.ss-overlay p { font-size:clamp(13px,2.2vw,17px); line-height:1.8; margin-bottom:8px; color:#cfe8ff; }
.ss-overlay .big-btn { margin-top:24px; font-family:inherit; font-size:clamp(16px,3vw,22px); font-weight:bold; padding:14px 38px; background:linear-gradient(#33bbff,#0077cc); color:#fff; border:3px solid #fff; border-radius:12px; cursor:pointer; box-shadow:0 5px 0 #003355; letter-spacing:2px; }
.ss-overlay .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #003355; }
.ss-overlay .keys { margin-top:18px; font-size:13px; color:#88aacc; line-height:2; }
.ss-overlay .keys b { color:#66ddff; }
.ss-stats { font-size:clamp(15px,2.6vw,20px); color:#ffdd44; margin:8px 0; }
.ss-toast { position:absolute; top:24%; left:0; right:0; text-align:center; font-family:'Courier New',monospace; font-size:clamp(22px,4.4vw,40px); font-weight:bold; color:#66ffff; text-shadow:3px 3px 0 #000; z-index:6; pointer-events:none; opacity:0; transition:opacity 0.3s; letter-spacing:3px; }
.ss-toast.show { opacity:1; }
.ss-dmg { position:absolute; inset:0; pointer-events:none; z-index:7; opacity:0; background:radial-gradient(ellipse at center, transparent 40%, rgba(255,30,30,0.55) 100%); }
.ss-dmg.show { opacity:1; transition:opacity 0.25s; }
.ss-touch { position:absolute; bottom:0; left:0; right:0; display:none; justify-content:space-between; align-items:flex-end; padding:14px 16px; z-index:8; pointer-events:none; }
body.touch .ss-touch { display:flex; }
.ss-tbtn { pointer-events:auto; width:64px; height:64px; border-radius:50%; background:rgba(255,255,255,0.13); border:3px solid rgba(255,255,255,0.5); color:#fff; font-size:24px; font-weight:bold; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; }
.ss-tbtn.pressed { background:rgba(255,255,255,0.4); }
.ss-tbtn.ss-fire { width:84px; height:84px; font-size:13px; background:rgba(255,100,80,0.25); border-color:rgba(255,120,100,0.7); }
.ss-tbtn.ss-boost { width:70px; height:70px; font-size:12px; background:rgba(0,200,255,0.22); border-color:rgba(0,200,255,0.7); }
.ss-tcluster { display:flex; gap:10px; }
`;

function buildOverlayUI(container: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "ss-hud";
  hud.innerHTML = `
    <div class="ss-hud-box">
      <span>SKOR <span id="ss-score">0</span></span>
      <span>REKOR <span id="ss-best">0</span></span>
      <span>DALGA <span id="ss-wave">1</span></span>
      <span>İMHA <span id="ss-kills">0</span></span>
    </div>
    <div style="display:flex;gap:10px;align-items:flex-start">
      <button id="ss-mute" class="ss-mute" title="Sesi kapat (M)">&#128266;</button>
    </div>`;
  container.appendChild(hud);

  // Combo indicator
  const combo = document.createElement("div");
  combo.className = "ss-combo hidden";
  combo.id = "ss-combo";
  container.appendChild(combo);

  // Hull / shield bars
  const bars = document.createElement("div");
  bars.className = "ss-hud";
  bars.style.cssText = "top:auto;bottom:16px;left:16px;right:auto;flex-direction:column;gap:6px;";
  bars.innerHTML = `
    <div class="ss-hud-box">
      <span>GÖVDE <span class="ss-bar"><span class="ss-bar-fill ss-hull-fill" id="ss-hull-fill" style="width:100%"></span></span></span>
      <span>KALKAN <span class="ss-bar"><span class="ss-bar-fill ss-shield-fill" id="ss-shield-fill" style="width:0%"></span></span></span>
    </div>`;
  container.appendChild(bars);

  // Crosshair
  const cross = document.createElement("div");
  cross.className = "ss-cross";
  cross.innerHTML = `<span class="bar h"></span><span class="bar v"></span><span class="dot"></span>`;
  container.appendChild(cross);

  // Damage vignette
  const dmg = document.createElement("div");
  dmg.className = "ss-dmg";
  dmg.id = "ss-dmg";
  container.appendChild(dmg);

  const toast = document.createElement("div");
  toast.className = "ss-toast";
  toast.id = "ss-toast";
  container.appendChild(toast);

  const mk = (id: string, inner: string, hidden = false) => {
    const el = document.createElement("div");
    el.className = "ss-overlay" + (hidden ? " hidden" : "");
    el.id = id;
    el.innerHTML = inner;
    container.appendChild(el);
    return el;
  };

  mk("ss-screen-start", `
    <h1>YILDIZ VURUCU</h1>
    <h2>Asteroid Saldırısı</h2>
    <p>Sınır filosunun son savaşçısısın. Asteroid alanlarını patlat,</p>
    <p>düşman filolarını avla, güçlendirmeleri kap ve skorunu yıldızlara taşı.</p>
    <button class="big-btn" id="ss-btn-start">BAŞLAT</button>
    <div class="keys">
      <b>W A S D / &#8592; &#8593; &#8595; &#8594;</b> yönlen &nbsp; <b>Space</b> ateş &nbsp; <b>Shift</b> hızlan<br>
      <b>P</b> duraklat &nbsp; <b>R</b> yeniden başlat &nbsp; <b>M</b> ses kapat
    </div>`);

  mk("ss-screen-pause", `
    <h2>DURAKLATILDI</h2>
    <p>Boşluk nefesini tutuyor...</p>
    <button class="big-btn" id="ss-btn-resume">DEVAM ET</button>
    <button class="big-btn" id="ss-btn-restart" style="background:linear-gradient(#88aacc,#446688);box-shadow:0 5px 0 #223344">YENİDEN BAŞLAT</button>`, true);

  mk("ss-screen-gameover", `
    <h1 style="color:#ff4444;text-shadow:3px 3px 0 #440000">GEMİ İMHA EDİLDİ</h1>
    <p>Yıldızlar bir pilotu daha aldı...</p>
    <div class="ss-stats" id="ss-stats"></div>
    <button class="big-btn" id="ss-btn-retry">TEKRAR UÇ</button>`, true);

  // Touch controls
  const touch = document.createElement("div");
  touch.className = "ss-touch";
  touch.innerHTML = `
    <div class="ss-tcluster">
      <div class="ss-tbtn" id="ss-t-left">&#9664;</div>
      <div class="ss-tbtn" id="ss-t-right">&#9654;</div>
      <div class="ss-tbtn" id="ss-t-up">&#9650;</div>
      <div class="ss-tbtn" id="ss-t-down">&#9660;</div>
    </div>
    <div class="ss-tcluster">
      <div class="ss-tbtn ss-boost" id="ss-t-boost">HIZLAN</div>
      <div class="ss-tbtn ss-fire" id="ss-t-fire">ATEŞ</div>
    </div>`;
  container.appendChild(touch);

  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  on("ss-btn-start", () => game.start());
  on("ss-btn-resume", () => game.togglePause());
  on("ss-btn-restart", () => game.restart());
  on("ss-btn-retry", () => game.restart());
  on("ss-mute", () => game.toggleMute());
}

function show(id: string) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id: string) { document.getElementById(id)?.classList.add("hidden"); }
function hideAllScreens() {
  ["ss-screen-start", "ss-screen-pause", "ss-screen-gameover"].forEach(hide);
}
let toastTimer = 0;
function showToast(text: string) {
  const el = document.getElementById("ss-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 1500);
}
function flashDamage() {
  const el = document.getElementById("ss-dmg");
  if (!el) return;
  el.classList.remove("show");
  void el.offsetWidth; // restart transition
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 250);
}

function updateHUD() {
  const set = (id: string, v: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set("ss-score", game.score);
  set("ss-best", game.best);
  set("ss-wave", game.wave);
  set("ss-kills", game.kills);
  const hull = document.getElementById("ss-hull-fill");
  if (hull) hull.style.width = Math.max(0, game.hull) + "%";
  const shield = document.getElementById("ss-shield-fill");
  if (shield) shield.style.width = Math.max(0, ShipShield.value) + "%";
  const comboEl = document.getElementById("ss-combo");
  if (comboEl) {
    if (game.multiplier > 1) {
      comboEl.classList.remove("hidden");
      comboEl.textContent = `x${game.multiplier} KOMBO`;
    } else {
      comboEl.classList.add("hidden");
    }
  }
}

/* ================= 14. GAME STATE ================= */
const game = {
  state: "menu" as "menu" | "playing" | "paused" | "over",
  score: 0,
  best: 0,
  wave: 1,
  kills: 0,
  combo: 0,
  comboTimer: 0,
  hull: 100,
  rapidTimer: 0,
  time: 0,
  astroTimer: 0,
  enemyTimer: 0,
  powerTimer: 0,
  waveTimer: 0,
  get multiplier() { return Math.min(5, 1 + Math.floor(this.combo / 3)); },
  get cruise() { return CRUISE * (Input.boosting ? BOOST_MULT : 1) * (1 + Math.min(0.5, (this.wave - 1) * 0.06)); },
  start() {
    AudioSys.init();
    AudioSys.resume();
    this.resetRun();
    hideAllScreens();
    this.state = "playing";
  },
  resetRun() {
    this.score = 0;
    this.wave = 1;
    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.hull = 100;
    this.rapidTimer = 0;
    this.time = 0;
    this.astroTimer = 0.4;
    this.enemyTimer = 4;
    this.powerTimer = 7;
    this.waveTimer = 0;
    ShipShield.value = 0;
    Ship.reset();
    for (const a of Asteroids.list) { a.alive = false; a.mesh.visible = false; }
    for (const e of Enemies.list) { e.alive = false; e.group.visible = false; }
    for (const b of Bolts.list) b.mesh.visible = false;
    for (const p of PowerUps.list) { p.alive = false; p.mesh.visible = false; }
    for (const l of Lasers.list) l.mesh.visible = false;
    try {
      this.best = Number(localStorage.getItem("ss-best") || 0) || 0;
    } catch { this.best = 0; }
    updateHUD();
  },
  restart() {
    if (this.state === "playing") {
      this.resetRun();
      hideAllScreens();
      this.state = "playing";
    } else {
      show("ss-screen-start");
      this.state = "menu";
      this.resetRun();
    }
  },
  togglePause() {
    if (this.state === "playing") {
      this.state = "paused";
      show("ss-screen-pause");
      AudioSys.stopEngine();
    } else if (this.state === "paused") {
      this.state = "playing";
      hide("ss-screen-pause");
      AudioSys.resume();
    }
  },
  toggleMute() {
    AudioSys.setMuted(!AudioSys.muted);
  },
  addScore(base: number, pos?: THREE.Vector3) {
    const pts = Math.round(base * this.multiplier);
    this.score += pts;
    if (pos) {
      // floating score text (CSS-free: reuse toast, short)
      showToast(`+${pts}`);
    }
    if (this.score > this.best) this.best = this.score;
  },
  addKill(base: number, pos: THREE.Vector3) {
    this.kills++;
    this.combo++;
    this.comboTimer = COMBO_WINDOW;
    this.addScore(base, pos);
    // Drop chance for power-up from asteroids/rock debris
    if (Math.random() < 0.13) PowerUps.drop(pos);
  },
  damage(amount: number) {
    if (ShipShield.value > 0) {
      ShipShield.value = Math.max(0, ShipShield.value - amount);
      AudioSys.shieldHit();
      showToast("KALKAN VURULDU");
    } else {
      this.hull -= amount;
      AudioSys.hullHit();
      flashDamage();
      shake = 0.9;
      showToast("GÖVDE HASARI");
    }
    if (this.hull <= 0) this.gameOver();
  },
  gameOver() {
    this.state = "over";
    AudioSys.stopEngine();
    AudioSys.gameover();
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem("ss-best", String(this.best)); } catch { /* ignore */ }
      showToast("YENİ REKOR!");
      AudioSys.fanfare();
    }
    const stats = document.getElementById("ss-stats");
    if (stats) {
      stats.textContent = `Skor ${this.score}  •  Dalga ${this.wave}  •  İmha ${this.kills}`;
    }
    show("ss-screen-gameover");
  },
  update(dt: number) {
    if (this.state !== "playing") return;
    this.time += dt;
    const cruise = this.cruise;

    // Boost audio + engine
    AudioSys.setEngine((cruise / (CRUISE * BOOST_MULT)) * 0.85, Input.boosting);

    // Wave progression
    this.waveTimer += dt;
    if (this.waveTimer >= WAVE_TIME) {
      this.waveTimer = 0;
      this.wave++;
      AudioSys.wave();
      showToast(`DALGA ${this.wave}`);
      if (this.wave >= 3) this.enemyTimer = Math.min(this.enemyTimer, 2.2);
    }

    // Spawning
    this.astroTimer -= dt;
    if (this.astroTimer <= 0) {
      const rate = Math.max(0.32, 0.85 - this.wave * 0.05);
      this.astroTimer = rate * (0.6 + Math.random() * 0.8);
      const n = 1 + (this.wave >= 3 && Math.random() < 0.35 ? 1 : 0);
      Asteroids.spawn(n);
    }
    this.enemyTimer -= dt;
    if (this.enemyTimer <= 0 && this.wave >= 2) {
      this.enemyTimer = Math.max(2.2, 7 - this.wave * 0.8) * (0.6 + Math.random() * 0.8);
      Enemies.spawn();
    }
    this.powerTimer -= dt;
    if (this.powerTimer <= 0) {
      this.powerTimer = 9 + Math.random() * 5;
      const p = PowerUps.list.find((x) => !x.mesh.visible);
      if (p) {
        p.mesh.position.set((Math.random() * 2 - 1) * 80, (Math.random() * 2 - 1) * 45, SPAWN_Z);
        p.alive = true;
        p.mesh.visible = true;
      }
    }

    // Rapid fire timer
    if (this.rapidTimer > 0) this.rapidTimer = Math.max(0, this.rapidTimer - dt);

    // Firing
    Lasers.cool -= dt;
    if (Input.firing && Lasers.cool <= 0) {
      Lasers.cool = this.rapidTimer > 0 ? FIRE_RATE_RAPID : FIRE_RATE;
      Lasers.fire();
    }

    // Update entities
    Ship.update(dt);
    Asteroids.update(dt, cruise);
    Enemies.update(dt, cruise);
    Bolts.update(dt);
    Lasers.update(dt);
    PowerUps.update(dt);
    Explosions.update(dt);
    updateSpace(dt, cruise);

    // Combo decay
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.collide();
    updateHUD();
  },
  collide() {
    const sp = Ship.pos;
    // Lasers vs asteroids & enemies (segment test: no tunneling through fast projectiles)
    for (let i = 0; i < Lasers.list.length; i++) {
      const l = Lasers.list[i];
      if (!l.mesh.visible) continue;
      const p0 = l.prev, p1 = l.mesh.position;
      // vs asteroids
      for (let j = 0; j < Asteroids.list.length; j++) {
        const a = Asteroids.list[j];
        if (!a.mesh.visible || !a.alive) continue;
        if (segDistSq(p0, p1, a.mesh.position) < (a.r + 0.8) * (a.r + 0.8)) {
          l.mesh.visible = false;
          const pos = a.mesh.position.clone();
          const size = Asteroids.destroy(j);
          const pts = size === 2 ? 100 : size === 1 ? 150 : 200;
          this.addKill(pts, pos);
          break;
        }
      }
      if (!l.mesh.visible) continue;
      // vs enemies
      for (let j = 0; j < Enemies.list.length; j++) {
        const e = Enemies.list[j];
        if (!e.group.visible || !e.alive) continue;
        if (segDistSq(p0, p1, e.group.position) < (e.r + 0.8) * (e.r + 0.8)) {
          l.mesh.visible = false;
          Enemies.hurt(j, LASER_DAMAGE);
          break;
        }
      }
    }
    // Enemy bolts vs ship (segment test)
    for (const b of Bolts.list) {
      if (!b.mesh.visible) continue;
      const rr = SHIP_RADIUS + 0.5;
      if (segDistSq(b.prev, b.mesh.position, sp) < rr * rr) {
        b.mesh.visible = false;
        Explosions.burst(b.mesh.position, 10, 0xff6644);
        this.damage(12);
        if (this.state !== "playing") return;
      }
    }
    // Asteroids vs ship
    for (const a of Asteroids.list) {
      if (!a.mesh.visible || !a.alive) continue;
      const dx = a.mesh.position.x - sp.x, dy = a.mesh.position.y - sp.y, dz = a.mesh.position.z - sp.z;
      const rr = a.r + SHIP_RADIUS;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        Asteroids.destroy(Asteroids.list.indexOf(a));
        this.damage(a.size === 2 ? 26 : a.size === 1 ? 20 : 14);
        if (this.state !== "playing") return;
      }
    }
    // Enemies vs ship (ram)
    for (const e of Enemies.list) {
      if (!e.group.visible || !e.alive) continue;
      const dx = e.group.position.x - sp.x, dy = e.group.position.y - sp.y, dz = e.group.position.z - sp.z;
      const rr = e.r + SHIP_RADIUS;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        const p = e.group.position.clone();
        e.alive = false;
        e.group.visible = false;
        Explosions.burst(p, 22);
        AudioSys.explosion(true);
        this.damage(22);
        if (this.state !== "playing") return;
      }
    }
    // Power-ups vs ship
    for (let i = 0; i < PowerUps.list.length; i++) {
      const p = PowerUps.list[i];
      if (!p.mesh.visible || !p.alive) continue;
      const dx = p.mesh.position.x - sp.x, dy = p.mesh.position.y - sp.y, dz = p.mesh.position.z - sp.z;
      const rr = 3.4;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        PowerUps.collect(i);
      }
    }
  },
};

/* ================= 15. COLLISION HELPERS ================= */
// Squared distance from point c to segment p0->p1 (anti-tunneling).
function segDistSq(p0: THREE.Vector3, p1: THREE.Vector3, c: THREE.Vector3): number {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return c.distanceToSquared(p0);
  let t = ((c.x - p0.x) * dx + (c.y - p0.y) * dy + (c.z - p0.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = p0.x + dx * t, cy = p0.y + dy * t, cz = p0.z + dz * t;
  const ex = c.x - cx, ey = c.y - cy, ez = c.z - cz;
  return ex * ex + ey * ey + ez * ez;
}

/* ================= 16. MAIN LOOP & PUBLIC API ================= */
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;

export function startGame(canvas: HTMLCanvasElement): () => void {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 960 / 540, 0.1, 1200);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lights
  const ambient = new THREE.AmbientLight(0x5566aa, 1.1);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(80, 120, 60);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4466ff, 0.5);
  fill.position.set(-60, -40, -100);
  scene.add(fill);

  buildSpace(scene);
  Ship.build(scene);
  Lasers.build(scene);
  Asteroids.build(scene);
  Enemies.build(scene);
  Bolts.build(scene);
  PowerUps.build(scene);
  Explosions.build(scene);
  Ship.reset();

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
  game.resetRun();
  updateHUD();

  let raf = 0;
  let lastTime = 0;
  const loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0.016);
    lastTime = ts;
    if (game.state === "playing") {
      game.update(dt);
      updateCamera(dt);
    } else if (game.state === "menu" || game.state === "over") {
      // Keep the world alive behind the menus (slow drift)
      Explosions.update(dt);
      updateSpace(dt, CRUISE * 0.5);
      Ship.update(dt);
    }
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
  };
}
