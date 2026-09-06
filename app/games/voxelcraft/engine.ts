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
const VIEW_DIST = 130;

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
  { id: B.COBBLE, name: "Arnavut", color: "#7a7a82" },
  { id: B.BRICK, name: "Tuğla", color: "#b04a3a" },
  { id: B.GLASS, name: "Cam", color: "#bfe8ef" },
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
  return noise2(x * 0.02, z * 0.02) * 0.6 + noise2(x * 0.06 + 40, z * 0.06 + 40) * 0.3 + noise2(x * 0.15, z * 0.15) * 0.1;
}
function heightAt(x: number, z: number): number {
  const n = fbm(x, z);
  return Math.max(4, Math.min(WORLD_Y - 6, Math.round(SEA_LEVEL + n * 22)));
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
          else if (n > 0.5 && h > 16) id = B.STONE;
          else id = B.GRASS;
        } else if (y >= h - 3) id = B.DIRT;
        world[idx(x, y, z)] = id;
      }
      // trees
      if (h > SEA_LEVEL + 2 && h < WORLD_Y - 8 && x > 4 && z > 4 && x < WORLD_X - 5 && z < WORLD_Z - 5 && hash2(x * 3 + 7, z * 3 + 13) < 0.012) {
        const th = 4 + Math.floor(hash2(x + 99, z + 99) * 3);
        for (let t = 1; t <= th; t++) world[idx(x, h + t, z)] = B.WOOD;
        const ly = h + th;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash2(x + dx * 5, z + dz * 7) < 0.4) continue;
          if (getBlock(x + dx, ly, z + dz) === B.AIR) world[idx(x + dx, ly, z + dz)] = B.LEAVES;
        }
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (getBlock(x + dx, ly + 1, z + dz) === B.AIR) world[idx(x + dx, ly + 1, z + dz)] = B.LEAVES;
        }
        world[idx(x, ly + 2, z)] = B.LEAVES;
      }
    }
  }
}

/* face colors: [top, bottom, +x, -x, +z, -z] */
function blockFaceColors(id: number): number[] {
  switch (id) {
    case B.GRASS: return [0x6fce52, 0x7a4a24, 0x79b85a, 0x79b85a, 0x79b85a, 0x79b85a];
    case B.DIRT: return [0x8a5a2b, 0x6e4520, 0x82532a, 0x82532a, 0x82532a, 0x82532a];
    case B.STONE: return [0x9a9aa2, 0x7a7a82, 0x8a8a92, 0x8a8a92, 0x8a8a92, 0x8a8a92];
    case B.SAND: return [0xe6d7a0, 0xcbb97f, 0xdccd9e, 0xdccd9e, 0xdccd9e, 0xdccd9e];
    case B.WOOD: return [0x8a6234, 0x5c3e1a, 0x6e4a23, 0x6e4a23, 0x6e4a23, 0x6e4a23];
    case B.LEAVES: return [0x57b457, 0x2f7f2f, 0x3f9443, 0x3f9443, 0x3f9443, 0x3f9443];
    case B.PLANKS: return [0xc89a5c, 0xa67a40, 0xb58a4f, 0xb58a4f, 0xb58a4f, 0xb58a4f];
    case B.GLASS: return [0xcfeef5, 0xcfeef5, 0xbfe0e8, 0xbfe0e8, 0xbfe0e8, 0xbfe0e8];
    case B.COBBLE: return [0x8e8e96, 0x6a6a72, 0x7a7a82, 0x7a7a82, 0x7a7a82, 0x7a7a82];
    case B.BRICK: return [0xc05a48, 0x8f3a2a, 0xb04a3a, 0xb04a3a, 0xb04a3a, 0xb04a3a];
    case B.BEDROCK: return [0x30303a, 0x20202a, 0x2a2a34, 0x2a2a34, 0x2a2a34, 0x2a2a34];
    default: return [0x111122, 0x111122, 0x111122, 0x111122, 0x111122, 0x111122];
  }
}

/* ================= 4. MESH BUILDER ================= */
const P = [] as number[], C = [] as number[], N = [] as number[], I = [] as number[];
function pushFace(x: number, y: number, z: number, dir: number, color: number, variant: number) {
  // dir: 0=+y 1=-y 2=+x 3=-x 4=+z 5=-z
  const j = 0.88 + (variant % 5) * 0.06;
  const r = ((color >> 16) & 255) / 255 * j;
  const g = ((color >> 8) & 255) / 255 * j;
  const b = (color & 255) / 255 * j;
  const base = P.length / 3;
  let c: number[][];
  if (dir === 0) c = [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]];
  else if (dir === 1) c = [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]];
  else if (dir === 2) c = [[x + 1, y, z], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]];
  else if (dir === 3) c = [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]];
  else if (dir === 4) c = [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]];
  else c = [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]];
  const nrm = dir === 0 ? [0, 1, 0] : dir === 1 ? [0, -1, 0] : dir === 2 ? [1, 0, 0] : dir === 3 ? [-1, 0, 0] : dir === 4 ? [0, 0, 1] : [0, 0, -1];
  for (const [cx, cy, cz] of c) {
    P.push(cx, cy, cz);
    C.push(r, g, b);
    N.push(nrm[0], nrm[1], nrm[2]);
  }
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function rebuildWorldGeometry(): THREE.BufferGeometry {
  P.length = 0; C.length = 0; N.length = 0; I.length = 0;
  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = 0; z < WORLD_Z; z++) {
      for (let x = 0; x < WORLD_X; x++) {
        const id = world[idx(x, y, z)];
        if (id === B.AIR || id === B.GLASS) continue; // glass handled separately? keep simple: skip glass in solid mesh
        const cols = blockFaceColors(id);
        const v = (x * 31 + y * 17 + z * 13);
        const nb = (dx: number, dy: number, dz: number) => getBlock(x + dx, y + dy, z + dz);
        if (nb(0, 1, 0) === B.AIR) pushFace(x, y, z, 0, cols[0], v);
        if (nb(0, -1, 0) === B.AIR) pushFace(x, y, z, 1, cols[1], v);
        if (nb(1, 0, 0) === B.AIR) pushFace(x, y, z, 2, cols[2], v);
        if (nb(-1, 0, 0) === B.AIR) pushFace(x, y, z, 3, cols[3], v);
        if (nb(0, 0, 1) === B.AIR) pushFace(x, y, z, 4, cols[4], v);
        if (nb(0, 0, -1) === B.AIR) pushFace(x, y, z, 5, cols[5], v);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  geo.setIndex(I);
  return geo;
}

/* ================= 5. SCENE ================= */
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let worldMesh: THREE.Mesh;
let canvasEl: HTMLCanvasElement;

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
    if (getBlock(x, y, z) !== B.AIR && getBlock(x, y, z) !== B.GLASS) {
      return { x, y, z, nx, ny, nz };
    }
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
    if (bits.length >= 100) break;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    scene.add(m);
    bits.push({ m, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 6 + 2, vz: (Math.random() - 0.5) * 5, life: 0.7 + Math.random() * 0.4 });
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

export function startGame(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 960, canvas.clientHeight || 540, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd0f5);
  scene.fog = new THREE.Fog(0xbfe6fb, VIEW_DIST * 0.55, VIEW_DIST * 1.5);

  camera = new THREE.PerspectiveCamera(70, (canvas.clientWidth || 960) / (canvas.clientHeight || 540), 0.1, VIEW_DIST * 2);

  scene.add(new THREE.HemisphereLight(0xdceeff, 0x8a6a4a, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
  sun.position.set(80, 160, 60);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.16));

  // world
  buildWorldData();
  worldMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  worldMesh.frustumCulled = false;
  worldMesh.geometry = rebuildWorldGeometry();
  scene.add(worldMesh);

  // spawn above terrain center
  const sx = Math.floor(WORLD_X / 2), sz = Math.floor(WORLD_Z / 2);
  let top = heightAt(sx, sz) + 1;
  for (let y = top; y < WORLD_Y; y++) if (world[idx(sx, y, sz)] !== B.AIR) { top = y + 1; break; }
  player.x = sx + 0.5; player.z = sz + 0.5; player.y = top + 0.1;
  camera.position.set(player.x, player.y + 1.6, player.z);
  camera.rotation.order = "YXZ";

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;";
  canvas.parentNode?.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
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
  canvas.addEventListener("click", () => {
    if (state === "menu") { startPlay(); return; }
    if (!pointerLocked) canvas.requestPointerLock?.();
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked && state === "play") {
      state = "menu";
      setMenuVisible(true);
    }
  });
  document.addEventListener("mousemove", (e) => {
    if (!pointerLocked || state !== "play") return;
    player.yaw -= e.movementX * 0.0023;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - e.movementY * 0.0023));
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
    // prevent placing into the player's box
    if (px + 1 > player.x - player.w / 2 && px < player.x + player.w / 2 &&
      pz + 1 > player.z - player.w / 2 && pz < player.z + player.w / 2 &&
      py + 1 > player.y && py < player.y + player.h) return;
    const id = HOTBAR[selectedSlot].id;
    setBlock(px, py, pz, id);
    AudioSys.place();
    spawnBits(px + 0.5, py + 0.5, pz + 0.5, blockFaceColors(id)[0]);
  }

  /* -------- physics -------- */
  function solidAt(x: number, y: number, z: number): boolean {
    const b = getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return b !== B.AIR && b !== B.GLASS;
  }
  function playerTouches(): boolean {
    const x0 = player.x - player.w / 2, x1 = player.x + player.w / 2;
    const y0 = player.y, y1 = player.y + player.h;
    const z0 = player.z - player.w / 2, z1 = player.z + player.w / 2;
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
        for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
          if (solidAt(x, y, z)) return true;
    return false;
  }
  function step(dt: number) {
    const p = player;
    // horizontal
    p.x += p.vx * dt;
    if (playerTouches()) { p.x -= p.vx * dt; p.vx = 0; }
    p.z += p.vz * dt;
    if (playerTouches()) { p.z -= p.vz * dt; p.vz = 0; }
    // vertical
    p.y += p.vy * dt;
    if (playerTouches()) {
      if (p.vy < 0) p.onGround = true;
      p.y -= p.vy * dt;
      p.vy = 0;
    } else {
      p.onGround = false;
    }
  }

  let stepT = 0;
  function updatePlayer(dt: number) {
    const p = player;
    const speed = keys.run ? 9 : 5;
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
    if (p.vy < -45) p.vy = -45;
    if (keys.jump && p.onGround) { p.vy = 9; p.onGround = false; keys.jump = false; AudioSys.jump(); }
    const moving = Math.hypot(p.vx, p.vz) > 0.5;
    stepT += dt * (keys.run ? 1.7 : 1);
    if (moving && p.onGround && stepT > 0.42) { stepT = 0; AudioSys.step(); }
    step(dt);
    if (p.y < -10) { // fell out — respawn
      const sx = Math.floor(WORLD_X / 2), sz = Math.floor(WORLD_Z / 2);
      let top = heightAt(sx, sz) + 2;
      p.x = sx + 0.5; p.z = sz + 0.5; p.y = top; p.vy = 0;
    }
    camera.position.set(p.x, p.y + 1.6, p.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;
  }

  // hotbar UI sync is handled by selectSlot (global). Rebuild every ~frame if dirty.
  let rebuildCooldown = 0;
  let raf = 0, last = 0;
  function loop(ts: number) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    if (state === "play") {
      updatePlayer(dt);
      updateBits(dt);
    }
    if (worldDirty && state === "play") {
      rebuildCooldown -= dt;
      if (rebuildCooldown <= 0) {
        rebuildCooldown = 0.06;
        const old = worldMesh.geometry;
        worldMesh.geometry = rebuildWorldGeometry();
        old.dispose();
        worldDirty = false;
      }
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
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.exitPointerLock?.();
    cleanupBits();
    worldMesh.geometry.dispose();
    wrap.querySelectorAll(".vcx-style,.vcx-hud-root,.vcx-menu").forEach((el) => el.remove());
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
  style.className = "vcx-style";
  style.textContent = `
.vcx-menu{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(6,14,26,.92),rgba(10,24,14,.9));color:#fff;z-index:10;text-align:center;font-family:'Segoe UI',system-ui,sans-serif}
.vcx-menu.hidden{display:none}
.vcx-menu h1{font-size:clamp(40px,9vw,72px);margin:0;letter-spacing:4px;color:#7ee081;text-shadow:0 0 24px rgba(126,224,129,.55),4px 4px 0 #0a3a14}
.vcx-menu h2{font-size:clamp(15px,3.6vw,20px);color:#8fd0f5;margin:6px 0 20px;font-weight:500}
.vcx-menu .row{font-size:clamp(13px,3vw,15px);color:#bcd4ee;line-height:2.1;margin:0}
.vcx-menu .k{display:inline-block;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:0 9px;font-weight:700;color:#fff;margin:0 1px}
.vcx-play{margin-top:26px;font-size:clamp(18px,4.6vw,26px);font-weight:800;padding:15px 48px;background:linear-gradient(#7ee081,#2f9e44);color:#04180a;border:none;border-radius:18px;box-shadow:0 6px 0 #1d6b2c;cursor:pointer;letter-spacing:1px}
.vcx-play:active{transform:translateY(4px);box-shadow:0 2px 0 #1d6b2c}
.vcx-hud-root{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
.vcx-hotbar{display:flex;gap:5px;background:rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.4);border-radius:10px;padding:5px;pointer-events:auto}
.vcx-slot{width:44px;height:44px;border-radius:7px;border:2px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;text-shadow:0 1px 3px #000;cursor:pointer;transition:transform .06s,border-color .06s;font-size:15px}
.vcx-slot.active{border-color:#ffd23f;transform:translateY(-3px);box-shadow:0 0 12px rgba(255,210,63,.9)}
.vcx-sel{font-size:13px;font-weight:700;color:#fff;background:rgba(0,0,0,.5);padding:2px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.3)}
.vcx-cross{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:16px;height:16px;z-index:5;pointer-events:none;opacity:.9}
.vcx-cross::before,.vcx-cross::after{content:"";position:absolute;background:#fff;box-shadow:0 0 4px #000}
.vcx-cross::before{left:50%;top:0;width:2px;height:100%;transform:translateX(-50%)}
.vcx-cross::after{top:50%;left:0;height:2px;width:100%;transform:translateY(-50%)}
.vcx-tip{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.7);font-size:12px;z-index:5;pointer-events:none;white-space:nowrap;text-shadow:0 1px 3px #000}
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
    // startPlay is registered on canvas click; simulate one
    const ev = new MouseEvent("click", { bubbles: true });
    canvasEl.dispatchEvent(ev);
  });
}
