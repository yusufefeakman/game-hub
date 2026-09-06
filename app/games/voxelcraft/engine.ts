/* =====================================================================
   VOXELCRAFT — Minecraft-benzeri blok dünyası (Three.js)
   Prosedürel arazi, WASD + fare (pointer lock) ile gezinme, blok
   kırma / yerleştirme ve hotbar. Tüm grafikler prosedürel; sesler
   Web Audio ile sentezlenir. Harici asset yok.

   Kontroller:
     Oyna'ya tıkla  → pointer lock (fare bakışı)
     WASD / Oklar   hareket · Space zıpla · Shift koş
     1-9 / tekerlek hotbar'dan blok seç
     Sol tık        bloğu kır
     Sağ tık        seçili bloğu yerleştir
     Esc            pointer lock'tan çık (menü)
     M              ses aç/kapat

   Public API:
     startGame(canvas) -> () => void
   ===================================================================== */
import * as THREE from "three";

/* ================= 1. CONSTANTS ================= */
const WORLD_X = 96;
const WORLD_Z = 96;
const WORLD_Y = 48;
const SEA_LEVEL = 12;
const VIEW_DIST = 150;

const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  PLANKS: 7,
  GLASS: 8,
  COBBLE: 9,
  BRICK: 10,
  BEDROCK: 11,
};

const HOTBAR: { id: number; name: string; color: string }[] = [
  { id: B.GRASS, name: "Çimen", color: "#5fae4a" },
  { id: B.DIRT, name: "Toprak", color: "#8a5a2b" },
  { id: B.STONE, name: "Taş", color: "#8f8f96" },
  { id: B.SAND, name: "Kum", color: "#e6d7a0" },
  { id: B.WOOD, name: "Odun", color: "#6e4a23" },
  { id: B.LEAVES, name: "Yaprak", color: "#3f8f3f" },
  { id: B.PLANKS, name: "Kalas", color: "#b58a4f" },
  { id: B.GLASS, name: "Cam", color: "#aee8f2" },
  { id: B.COBBLE, name: "Arnavut", color: "#7a7a82" },
  { id: B.BRICK, name: "Tuğla", color: "#b04a3a" },
];

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
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.4) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
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
  break() { this.tone("square", 240, 90, 0.09, 0.22); },
  place() { this.tone("square", 140, 260, 0.07, 0.22); },
  step() { this.tone("sine", 100, 70, 0.05, 0.06); },
  jump() { this.tone("sine", 200, 430, 0.12, 0.16); },
  click() { this.tone("square", 900, 680, 0.04, 0.16); },
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.3; },
};

/* ================= 3. WORLD DATA & NOISE ================= */
let world: Uint8Array;
function idx(x: number, y: number, z: number) {
  return (y * WORLD_Z + z) * WORLD_X + x;
}
function getBlock(x: number, y: number, z: number): number {
  if (y < 0) return B.BEDROCK;
  if (y >= WORLD_Y) return B.AIR;
  if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return B.AIR;
  return world[idx(x, y, z)];
}
const isSolid = (id: number) => id !== B.AIR; // used for collisions & picking (glass counts solid)

function hash2(x: number, z: number): number {
  let n = x * 374761393 + z * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
function noise2(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  const ux = smooth(xf), uz = smooth(zf);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x: number, z: number): number {
  return noise2(x * 0.02, z * 0.02) * 0.6 + noise2(x * 0.07 + 40, z * 0.07 + 40) * 0.3 + noise2(x * 0.16, z * 0.16) * 0.1;
}
function heightAt(x: number, z: number): number {
  const n = fbm(x, z);
  return Math.max(4, Math.min(WORLD_Y - 8, Math.round(SEA_LEVEL + n * 22)));
}

function buildWorldData() {
  world = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
  for (let x = 0; x < WORLD_X; x++) {
    for (let z = 0; z < WORLD_Z; z++) {
      const h = heightAt(x, z);
      for (let y = 0; y <= h; y++) {
        let id = B.STONE;
        if (y === 0) id = B.BEDROCK;
        else if (y === h) {
          const n = noise2(x * 0.3, z * 0.3);
          if (h <= SEA_LEVEL + 1) id = B.SAND;
          else if (n > 0.55 && h > 17) id = B.STONE;
          else id = B.GRASS;
        } else if (y >= h - 3) id = B.DIRT;
        world[idx(x, y, z)] = id;
      }
    }
  }
  // trees (second pass so terrain heights are final)
  for (let x = 3; x < WORLD_X - 3; x++) {
    for (let z = 3; z < WORLD_Z - 3; z++) {
      const h = heightAt(x, z);
      if (h <= SEA_LEVEL + 2 || h >= WORLD_Y - 10) continue;
      if (getBlock(x, h, z) !== B.GRASS) continue; // only on grass
      if (hash2(x * 31 + 7, z * 57 + 13) > 0.014) continue;
      // canopy must not collide with another tree's trunk zone
      let clash = false;
      for (let dx = -2; dx <= 2 && !clash; dx++)
        for (let dz = -2; dz <= 2 && !clash; dz++)
          if (getBlock(x + dx, h + 1, z + dz) !== B.AIR) clash = true;
      if (clash) continue;
      const trunk = 4 + Math.floor(hash2(x + 99, z + 99) * 3); // 4..6
      const topY = h + trunk;
      for (let t = 1; t <= trunk; t++) world[idx(x, h + t, z)] = B.WOOD;
      // classic canopy: layers of leaves, widening then closing at the top
      const canopy = [
        { off: 2, rad: 1 }, // top cap
        { off: 1, rad: 2 }, // wide layer
        { off: 0, rad: 2 }, // widest layer
        { off: -1, rad: 1 }, // skirt, leaves trunk base clear
      ];
      for (const layer of canopy) {
        const yy = topY + layer.off;
        if (yy >= WORLD_Y) continue;
        for (let dx = -layer.rad; dx <= layer.rad; dx++)
          for (let dz = -layer.rad; dz <= layer.rad; dz++) {
            // rounded corners
            if (Math.abs(dx) === layer.rad && Math.abs(dz) === layer.rad && layer.rad > 1) continue;
            // keep the trunk column wood-visible on the widest layer centre
            if (dx === 0 && dz === 0 && layer.off === 0) continue;
            const bx = x + dx, bz = z + dz;
            if (getBlock(bx, yy, bz) === B.AIR) world[idx(bx, yy, bz)] = B.LEAVES;
          }
      }
    }
  }
}

/* face colors: [top, bottom, +x, -x, +z, -z] */
function blockFaceColors(id: number): number[] {
  switch (id) {
    case B.GRASS: return [0x6fce52, 0x7a4a24, 0x6c7a3f, 0x6c7a3f, 0x6c7a3f, 0x6c7a3f]; // grass sides slightly green-brown
    case B.DIRT: return [0x96683a, 0x6e4520, 0x82532a, 0x82532a, 0x82532a, 0x82532a];
    case B.STONE: return [0xa2a2aa, 0x7a7a82, 0x8f8f97, 0x8f8f97, 0x8f8f97, 0x8f8f97];
    case B.SAND: return [0xeadca4, 0xcbb97f, 0xdfd2a0, 0xdfd2a0, 0xdfd2a0, 0xdfd2a0];
    case B.WOOD: return [0xa8844f, 0x6e4a23, 0x7d5528, 0x7d5528, 0x7d5528, 0x7d5528];
    case B.LEAVES: return [0x55b255, 0x2c7a2c, 0x3e9142, 0x3e9142, 0x3e9142, 0x3e9142];
    case B.PLANKS: return [0xd0a262, 0xa67a40, 0xb58a4f, 0xb58a4f, 0xb58a4f, 0xb58a4f];
    case B.GLASS: return [0xdff6fb, 0xdff6fb, 0xaee8f2, 0xaee8f2, 0xaee8f2, 0xaee8f2];
    case B.COBBLE: return [0x92929a, 0x6a6a72, 0x7e7e86, 0x7e7e86, 0x7e7e86, 0x7e7e86];
    case B.BRICK: return [0xc95f4c, 0x8f3a2a, 0xb3503e, 0xb3503e, 0xb3503e, 0xb3503e];
    case B.BEDROCK: return [0x383842, 0x20202a, 0x2c2c36, 0x2c2c36, 0x2c2c36, 0x2c2c36];
    default: return [0x111122, 0x111122, 0x111122, 0x111122, 0x111122, 0x111122];
  }
}

/* ================= 4. MESH BUILDER =================
   Uses correct CCW winding (viewed from outside) so faces face outward.
   Face layout: 0:+y(top) 1:-y 2:+x 3:-x 4:+z 5:-z. */
const OP = [] as number[], OC = [] as number[], OI = [] as number[];
const GP = [] as number[], GC = [] as number[], GI = [] as number[];

// corner tables (x,y,z local 0/1), wound CCW from the outside of that face
const FACE_VERTS: number[][][] = [
  // +y (looking down from above): counter-clockwise in xz
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  // -y (looking up from below): CCW when viewed from below (mirror)
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  // +x
  [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
  // -x
  [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]],
  // +z
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  // -z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const FACE_NRM: number[][] = [
  [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];

function pushFaceTo(P: number[], C: number[], N: number[], I: number[], x: number, y: number, z: number, face: number, color: number, variant: number) {
  const j = 0.9 + (variant % 7) * 0.045; // subtle per-block brightness
  const r = ((color >> 16) & 255) / 255 * j;
  const g = ((color >> 8) & 255) / 255 * j;
  const b = (color & 255) / 255 * j;
  const base = P.length / 3;
  const verts = FACE_VERTS[face];
  const nrm = FACE_NRM[face];
  for (const v of verts) {
    P.push(x + v[0], y + v[1], z + v[2]);
    C.push(r, g, b);
    N.push(nrm[0], nrm[1], nrm[2]);
  }
  // triangle fan, outward winding already encoded in FACE_VERTS order
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildGeometries(): { solid: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  OP.length = 0; OC.length = 0; OI.length = 0;
  GP.length = 0; GC.length = 0; GI.length = 0;
  const ON = [] as number[], GN = [] as number[];
  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const id = world[idx(x, y, z)];
        if (id === B.AIR) continue;
        const glass = id === B.GLASS;
        const cols = blockFaceColors(id);
        const v = x * 31 + y * 17 + z * 13;
        const faces = [
          getBlock(x, y + 1, z), getBlock(x, y - 1, z),
          getBlock(x + 1, y, z), getBlock(x - 1, y, z),
          getBlock(x, y, z + 1), getBlock(x, y, z - 1),
        ];
        for (let f = 0; f < 6; f++) {
          const nb = faces[f];
          // draw this face if neighbour is empty OR neighbour is glass (see-through)
          const draw = nb === B.AIR || nb === B.GLASS;
          if (!draw) continue;
          if (glass) pushFaceTo(GP, GC, GN, GI, x, y, z, f, cols[f], v);
          else pushFaceTo(OP, OC, ON, OI, x, y, z, f, cols[f], v);
        }
      }
    }
  }
  const mk = (P: number[], C: number[], N: number[], I: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    geo.setIndex(I);
    geo.computeBoundingSphere();
    return geo;
  };
  return { solid: mk(OP, OC, ON, OI), glass: mk(GP, GC, GN, GI) };
}

/* ================= 5. SCENE ================= */
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let solidMesh: THREE.Mesh;
let glassMesh: THREE.Mesh;

const player = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  w: 0.6, h: 1.8,
  onGround: false,
  yaw: 0, pitch: 0,
};

let selectedSlot = 0;
const keys = { f: false, b: false, l: false, r: false, jump: false, run: false };
let pointerLocked = false;
let worldDirty = true;
let state: "menu" | "play" = "menu";

/* ================= 6. RAYCAST (DDA) ================= */
function raycast(maxDist: number): { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null {
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tdx = Math.abs(1 / (dir.x || 1e-9)), tdy = Math.abs(1 / (dir.y || 1e-9)), tdz = Math.abs(1 / (dir.z || 1e-9));
  let tmx = dir.x !== 0 ? (dir.x > 0 ? (x + 1 - ox) * tdx : (ox - x) * tdx) : Infinity;
  let tmy = dir.y !== 0 ? (dir.y > 0 ? (y + 1 - oy) * tdy : (oy - y) * tdy) : Infinity;
  let tmz = dir.z !== 0 ? (dir.z > 0 ? (z + 1 - oz) * tdz : (oz - z) * tdz) : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  while (t <= maxDist) {
    const blk = getBlock(x, y, z);
    if (blk !== B.AIR) return { x, y, z, nx, ny, nz };
    if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; nx = -stepX; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -stepZ; }
  }
  return null;
}

/* ================= 7. MAIN ================= */
let bits: { m: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[] = [];
function spawnBits(x: number, y: number, z: number, color: number) {
  for (let i = 0; i < 6; i++) {
    if (bits.length >= 120) break;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    scene.add(m);
    bits.push({ m, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 6 + 2.5, vz: (Math.random() - 0.5) * 5, life: 0.7 + Math.random() * 0.4 });
  }
}
function updateBits(dt: number) {
  for (let i = bits.length - 1; i >= 0; i--) {
    const p = bits[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); (p.m.material as THREE.Material).dispose(); p.m.geometry.dispose(); bits.splice(i, 1); continue; }
    p.vy -= 16 * dt;
    p.m.position.x += p.vx * dt;
    p.m.position.y += p.vy * dt;
    p.m.position.z += p.vz * dt;
  }
}

function findSpawn(): { x: number; y: number; z: number } {
  const cx = Math.floor(WORLD_X / 2), cz = Math.floor(WORLD_Z / 2);
  for (let r = 0; r < 30; r++) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * r);
      const z = Math.round(cz + Math.sin(ang) * r);
      if (x < 2 || x >= WORLD_X - 2 || z < 2 || z >= WORLD_Z - 2) continue;
      if (getBlock(x, heightAt(x, z), z) === B.GRASS && getBlock(x, heightAt(x, z) + 1, z) === B.AIR) {
        return { x: x + 0.5, y: heightAt(x, z) + 0.02, z: z + 0.5 };
      }
    }
  }
  return { x: cx + 0.5, y: heightAt(cx, cz) + 0.02, z: cz + 0.5 };
}

export function startGame(canvas: HTMLCanvasElement): () => void {
  // Wrap: position the canvas & UI inside a full-size relative container.
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;";
  canvas.parentNode?.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd0f5);
  scene.fog = new THREE.Fog(0xb5dcf5, VIEW_DIST * 0.5, VIEW_DIST * 1.25);

  camera = new THREE.PerspectiveCamera(72, 1, 0.1, VIEW_DIST * 2);

  scene.add(new THREE.HemisphereLight(0xdff0ff, 0x8a6a4a, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.position.set(90, 200, 70);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  function resize() {
    const w = wrap.clientWidth || 960;
    const h = wrap.clientHeight || 540;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // world
  buildWorldData();
  const geos = buildGeometries();
  solidMesh = new THREE.Mesh(geos.solid, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide,
  }));
  solidMesh.frustumCulled = false;
  scene.add(solidMesh);
  glassMesh = new THREE.Mesh(geos.glass, new THREE.MeshLambertMaterial({
    vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
  }));
  glassMesh.frustumCulled = false;
  glassMesh.renderOrder = 1;
  scene.add(glassMesh);

  const sp = findSpawn();
  player.x = sp.x; player.y = sp.y; player.z = sp.z;
  player.yaw = Math.PI * 0.25;
  camera.position.set(player.x, player.y + 1.6, player.z);
  camera.rotation.order = "YXZ";

  buildUI(wrap);

  /* -------- input -------- */
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", " ", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    if (k === "w" || k === "arrowup") keys.f = true;
    if (k === "s" || k === "arrowdown") keys.b = true;
    if (k === "a" || k === "arrowleft") keys.l = true;
    if (k === "d" || k === "arrowright") keys.r = true;
    if (k === " ") { if (!keys.jump) keys.jump = true; }
    if (k === "shift") keys.run = true;
    if (k === "m") AudioSys.setMuted(!AudioSys.muted);
    const n = "1234567890".indexOf(k);
    if (n >= 0) selectSlot(n);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") keys.f = false;
    if (k === "s" || k === "arrowdown") keys.b = false;
    if (k === "a" || k === "arrowleft") keys.l = false;
    if (k === "d" || k === "arrowright") keys.r = false;
    if (k === " ") keys.jump = false;
    if (k === "shift") keys.run = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const startPlay = () => {
    AudioSys.init(); AudioSys.resume();
    state = "play";
    setMenuVisible(false);
    canvas.requestPointerLock?.();
  };
  (window as unknown as { __vcxStart?: () => void }).__vcxStart = startPlay;
  const onCanvasClick = () => {
    if (state === "menu") { startPlay(); return; }
    if (!pointerLocked) canvas.requestPointerLock?.();
  };
  canvas.addEventListener("click", onCanvasClick);
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked && state === "play") {
      state = "menu";
      setMenuVisible(true);
    }
  });
  document.addEventListener("mousemove", (e) => {
    if (!pointerLocked || state !== "play") return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - e.movementY * 0.0022));
  });
  canvas.addEventListener("mousedown", (e) => {
    if (state !== "play" || !pointerLocked) return;
    e.preventDefault();
    if (e.button === 0) breakBlock();
    else if (e.button === 2) placeBlock();
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    if (state !== "play") return;
    e.preventDefault();
    selectSlot((selectedSlot + (e.deltaY > 0 ? 1 : 9)) % 10);
  }, { passive: false });

  function setBlock(x: number, y: number, z: number, id: number) {
    world[idx(x, y, z)] = id;
    worldDirty = true;
  }
  function breakBlock() {
    const hit = raycast(7);
    if (!hit) return;
    const b = getBlock(hit.x, hit.y, hit.z);
    if (b === B.BEDROCK || b === B.AIR) return;
    setBlock(hit.x, hit.y, hit.z, B.AIR);
    AudioSys.break();
    spawnBits(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, blockFaceColors(b)[0]);
  }
  function placeBlock() {
    const hit = raycast(7);
    if (!hit) return;
    const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
    if (py < 1 || py >= WORLD_Y) return;
    if (getBlock(px, py, pz) !== B.AIR) return;
    // never place inside the player's feet/head box
    if (px + 1 > player.x - player.w / 2 && px < player.x + player.w / 2 &&
      pz + 1 > player.z - player.w / 2 && pz < player.z + player.w / 2 &&
      py + 1 > player.y && py < player.y + player.h) return;
    const id = HOTBAR[selectedSlot].id;
    setBlock(px, py, pz, id);
    AudioSys.place();
    spawnBits(px + 0.5, py + 0.5, pz + 0.5, blockFaceColors(id)[0]);
  }

  /* -------- physics (with 1-block step-up) -------- */
  function solidAt(bx: number, by: number, bz: number): boolean {
    const id = getBlock(Math.floor(bx), Math.floor(by), Math.floor(bz));
    return isSolid(id);
  }
  function playerTouches(px: number, py: number, pz: number): boolean {
    const x0 = px - player.w / 2, x1 = px + player.w / 2;
    const y0 = py + 0.02, y1 = py + player.h - 0.02;
    const z0 = pz - player.w / 2, z1 = pz + player.w / 2;
    for (let by = Math.floor(y0); by <= Math.floor(y1); by++)
      for (let bz = Math.floor(z0); bz <= Math.floor(z1); bz++)
        for (let bx = Math.floor(x0); bx <= Math.floor(x1); bx++)
          if (solidAt(bx, by, bz)) return true;
    return false;
  }
  // Minecraft-style physics: axis-separated movement with 1-block step-up.
  function tryStepUp(dx: number, dz: number): boolean {
    const p = player;
    const nx = p.x + dx, nz = p.z + dz;
    if (!playerTouches(nx, p.y, nz)) { p.x = nx; p.z = nz; return true; }
    if (!p.onGround) return false;
    // try to climb a 1-block step
    for (let lift = 0.55; lift <= 1.05; lift += 0.1) {
      if (!playerTouches(nx, p.y + lift, nz)) {
        p.x = nx; p.z = nz; p.y += lift;
        return true;
      }
    }
    return false;
  }
  function step(dt: number) {
    const p = player;
    // X
    if (!tryStepUp(p.vx * dt, 0)) {
      p.vx = 0;
    }
    // Z
    if (!tryStepUp(0, p.vz * dt)) {
      p.vz = 0;
    }
    // Y (vertical)
    const ny = p.y + p.vy * dt;
    if (!playerTouches(p.x, ny, p.z)) {
      p.y = ny;
      if (p.vy < 0) p.onGround = false;
    } else if (p.vy <= 0) {
      // landing — snap feet onto the top of the block we hit
      p.y = Math.floor(ny) + 1;
      while (playerTouches(p.x, p.y, p.z)) p.y += 0.01;
      p.onGround = true;
      p.vy = 0;
    } else {
      // hit ceiling — push down out of it
      while (playerTouches(p.x, p.y, p.z)) p.y -= 0.01;
      p.vy = 0;
    }
  }

  let stepT = 0;
  function updatePlayer(dt: number) {
    const p = player;
    const speed = keys.run ? 8.5 : 4.6;
    const sinY = Math.sin(p.yaw), cosY = Math.cos(p.yaw);
    let mx = 0, mz = 0;
    if (keys.f) { mx -= sinY; mz -= cosY; }
    if (keys.b) { mx += sinY; mz += cosY; }
    if (keys.l) { mx -= cosY; mz += sinY; }
    if (keys.r) { mx += cosY; mz -= sinY; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    p.vx = mx * speed;
    p.vz = mz * speed;
    p.vy -= 26 * dt;
    if (p.vy < -48) p.vy = -48;
    if (keys.jump && p.onGround) { p.vy = 8.8; p.onGround = false; keys.jump = false; AudioSys.jump(); }
    const moving = Math.hypot(p.vx, p.vz) > 0.5;
    stepT += dt * (keys.run ? 1.7 : 1);
    if (moving && p.onGround && stepT > 0.4) { stepT = 0; AudioSys.step(); }
    step(dt);
    if (p.y < -8) {
      const s = findSpawn();
      p.x = s.x; p.z = s.z; p.y = s.y; p.vy = 0;
    }
    camera.position.set(p.x, p.y + 1.6, p.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;
  }

  let raf = 0, last = 0;
  function loop(ts: number) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    if (state === "play") {
      updatePlayer(dt);
      updateBits(dt);
    }
    if (worldDirty) {
      worldDirty = false;
      const oldS = solidMesh.geometry, oldG = glassMesh.geometry;
      const ng = buildGeometries();
      solidMesh.geometry = ng.solid;
      glassMesh.geometry = ng.glass;
      oldS.dispose(); oldG.dispose();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  const cleanupBits = () => {
    for (const p of bits) { scene.remove(p.m); (p.m.material as THREE.Material).dispose(); p.m.geometry.dispose(); }
    bits = [];
  };
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.exitPointerLock?.();
    cleanupBits();
    solidMesh.geometry.dispose(); glassMesh.geometry.dispose();
    wrap.remove();
    renderer.dispose();
  };
}

/* ================= 8. UI ================= */
function selectSlot(i: number) {
  if (i < 0 || i >= HOTBAR.length) return;
  selectedSlot = i;
  AudioSys.click();
  document.querySelectorAll<HTMLElement>(".vcx-slot").forEach((el, k) => {
    el.classList.toggle("active", k === i);
  });
  const nm = document.getElementById("vcx-sel-name");
  if (nm) nm.textContent = HOTBAR[i].name;
}

function setMenuVisible(v: boolean) {
  const m = document.getElementById("vcx-menu");
  if (m) m.classList.toggle("hidden", !v);
}

function buildUI(container: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = `
.vcx-menu{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(8,18,32,.93),rgba(12,28,18,.9));color:#fff;z-index:10;text-align:center;font-family:'Segoe UI',system-ui,sans-serif}
.vcx-menu.hidden{display:none}
.vcx-menu h1{font-size:clamp(38px,8vw,64px);margin:0;letter-spacing:4px;color:#7ee081;text-shadow:0 0 22px rgba(126,224,129,.55),4px 4px 0 #0a3a14}
.vcx-menu h2{font-size:clamp(14px,3.4vw,19px);color:#8fd0f5;margin:6px 0 20px;font-weight:500}
.vcx-menu .row{font-size:clamp(13px,3vw,15px);color:#c6dcf2;line-height:2.1;margin:0}
.vcx-menu .k{display:inline-block;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:0 9px;font-weight:700;color:#fff;margin:0 1px}
.vcx-play{margin-top:24px;font-size:clamp(18px,4.6vw,25px);font-weight:800;padding:15px 48px;background:linear-gradient(#7ee081,#2f9e44);color:#04180a;border:none;border-radius:18px;box-shadow:0 6px 0 #1d6b2c;cursor:pointer;letter-spacing:1px}
.vcx-play:active{transform:translateY(4px);box-shadow:0 2px 0 #1d6b2c}
.vcx-hud-root{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
.vcx-hotbar{display:flex;gap:4px;background:rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.4);border-radius:10px;padding:4px;pointer-events:auto}
.vcx-slot{width:42px;height:42px;border-radius:7px;border:2px solid rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;text-shadow:0 1px 3px #000;cursor:pointer;transition:transform .06s,border-color .06s;font-size:14px}
.vcx-slot.active{border-color:#ffd23f;transform:translateY(-3px);box-shadow:0 0 12px rgba(255,210,63,.9)}
.vcx-sel{font-size:13px;font-weight:700;color:#fff;background:rgba(0,0,0,.55);padding:2px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.3)}
.vcx-cross{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:16px;height:16px;z-index:5;pointer-events:none;opacity:.9}
.vcx-cross::before,.vcx-cross::after{content:"";position:absolute;background:#fff;box-shadow:0 0 4px #000}
.vcx-cross::before{left:50%;top:0;width:2px;height:100%;transform:translateX(-50%)}
.vcx-cross::after{top:50%;left:0;height:2px;width:100%;transform:translateY(-50%)}
.vcx-tip{position:absolute;bottom:78px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.75);font-size:12px;z-index:5;pointer-events:none;white-space:nowrap;text-shadow:0 1px 3px #000}
`;
  container.appendChild(style);

  const hud = document.createElement("div");
  hud.className = "vcx-hud-root";
  hud.innerHTML = `
    <div class="vcx-sel" id="vcx-sel-name">Çimen</div>
    <div class="vcx-hotbar">${HOTBAR.map((b, i) =>
      `<div class="vcx-slot ${i === 0 ? "active" : ""}" data-i="${i}" title="${b.name}" style="background:${b.color}">${i + 1}</div>`
    ).join("")}</div>`;
  container.appendChild(hud);

  const cross = document.createElement("div");
  cross.className = "vcx-cross";
  container.appendChild(cross);
  const tip = document.createElement("div");
  tip.className = "vcx-tip";
  tip.textContent = "Sol tık: kır · Sağ tık: yerleştir · Esc: menü";
  container.appendChild(tip);

  container.querySelectorAll<HTMLElement>(".vcx-slot").forEach((el) => {
    el.addEventListener("click", () => selectSlot(Number(el.dataset.i)));
  });

  const menu = document.createElement("div");
  menu.className = "vcx-menu";
  menu.id = "vcx-menu";
  menu.innerHTML = `
    <h1>VOXELCRAFT</h1>
    <h2>Minecraft benzeri blok dünyası</h2>
    <p class="row"><span class="k">W A S D</span> hareket &nbsp;&nbsp;<span class="k">Space</span> zıpla &nbsp;&nbsp;<span class="k">Shift</span> koş</p>
    <p class="row"><span class="k">Sol tık</span> kır &nbsp;&nbsp;<span class="k">Sağ tık</span> yerleştir &nbsp;&nbsp;<span class="k">1-9</span>/tekerlek blok</p>
    <p class="row">Tepeleri aş, ağaçları kes, kendi yapını kur!</p>
    <button class="vcx-play" id="vcx-play">▶ OYNA</button>`;
  container.appendChild(menu);
  document.getElementById("vcx-play")!.addEventListener("click", () => {
    // menu overlay sits above the canvas, so ask the engine to start directly
    const fn = (window as unknown as { __vcxStart?: () => void }).__vcxStart;
    if (fn) fn();
  });
}
