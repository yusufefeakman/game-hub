/* =====================================================================
   VOXELCRAFT — Minecraft-benzeri blok dünyası (Three.js)
   Prosedürel arazi, WASD + fare (pointer lock) ile gezinme, blok
   kırma / yerleştirme ve hotbar. Tüm grafikler prosedürel; sesler
   Web Audio ile sentezlenir. Harici asset yok.

   Çekirdek sistemler (fizik, raycast, kontroller, pointer-lock, UI)
   mevcut mimari korunarak blocks.ts modülüne bağlanmıştır.

   Kontroller:
     Oyna'ya tıkla  → pointer lock (fare bakışı)
     WASD / Oklar   hareket · Space zıpla · Shift koş
     1-9 / tekerlek hotbar'dan blok seç
     Sol tık (basılı tut) bloğu kaz — doğru alet hızlandırır
     Sağ tık        seçili bloğu yerleştir (üretim masasına = 3×3 aç)
     E              envanter + üretim (2×2) aç/kapat
     Esc            pointer lock'tan çık (menü)
     M              ses aç/kapat

   Public API:
     startGame(canvas) -> () => void
   ===================================================================== */
import * as THREE from "three";
import {
  B, BLOCKS, ATLAS_CANVAS, tileUV,
  isSolid, isTransparent, isLiquid, isBreakable, initBlocks,
} from "./blocks";
import { Inventory, dropsFor, toolMetaOf, foodOf, I } from "./inventory";
import { iconDataUrl, itemNameOf } from "./crafting";
import { openInventoryScreen, type InvHost } from "./invui";
import { Mobs, type MobCtx } from "./mobs";
import { makeSaveV2, writeSave, readSave, saveWorldBytes, clearSave, setPendingSeed, takePendingSeed } from "./save";

/* ================= 1. CONSTANTS ================= */
const WORLD_X = 128;
const WORLD_Z = 128;
const WORLD_Y = 56;
const SEA_LEVEL = 13;
const CHUNK = 16; // chunk genişliği (x/z)

/* gündüz/gece döngüsü: 0=şafak · 0.25=öğlen · 0.5=gün batımı · 0.75=gece yarısı */
const DAY_LEN = 720; // sn (6 dk gündüz + 6 dk gece)
let worldTime = 0;

/* dünya seed'i: aynı seed → aynı dünya. Gürültü fonksiyonları seed'e bağlıdır. */
let worldSeed = 1;
export function setWorldSeed(s: number) { worldSeed = (Math.floor(s) | 0) || 1; }
export function getWorldSeed() { return worldSeed; }

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
const solidAt = (bx: number, by: number, bz: number) => isSolid(getBlock(bx, by, bz));

function hash2(x: number, z: number): number {
  let n = (x + worldSeed * 131) * 374761393 + (z - worldSeed * 977) * 668265263 + worldSeed * 2654435761;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}
function hash3(x: number, y: number, z: number): number {
  let n = (x + worldSeed * 131) * 374761393 + (y - worldSeed * 313) * 668265263 + (z + worldSeed * 977) * 2147483647;
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
  return noise2(x * 0.014, z * 0.014) * 0.55
    + noise2(x * 0.05 + 40, z * 0.05 + 40) * 0.3
    + noise2(x * 0.13, z * 0.13) * 0.15;
}
/* Yükseklik: geniş düzlükler + tepeler + vadiler (düşük frekanslı maske) */
function heightAt(x: number, z: number): number {
  const n = fbm(x, z);
  const base = SEA_LEVEL + 1 + n * 26;
  const region = noise2(x * 0.008 + 100, z * 0.008 - 60); // 0..1 bölge maskesi
  let h = base;
  if (region > 0.62) {
    // düzlük/ova: yüksekliği deniz seviyesine yakın sıkıştır
    h = base * 0.5 + (SEA_LEVEL + 2.5) * 0.5;
  } else if (region < 0.32) {
    // yükselti/dağlık bölge: kabart
    h = base * 1.18 + 2;
  }
  return Math.max(5, Math.min(WORLD_Y - 12, Math.round(h)));
}

// 3D gürültü (mağaralar için)
function noise3(x: number, y: number, z: number): number {
  return (noise2(x * 0.09, z * 0.09) + noise2(z * 0.09 + 7, y * 0.11 + 3)) * 0.5;
}

function buildWorldData() {
  world = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
  edits.clear(); // yeni üretim: düzenleme günlüğü sıfırlanır
  // terrain columns
  for (let x = 0; x < WORLD_X; x++) {
    for (let z = 0; z < WORLD_Z; z++) {
      const h = heightAt(x, z);
      const isBeach = h <= SEA_LEVEL + 1;
      for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
        let id: number;
        if (y === 0) id = B.BEDROCK;
        else if (y <= 1) id = B.STONE;
        else if (y === h) {
          if (isBeach) id = B.SAND;
          else if (noise2(x * 0.3 + 5, z * 0.3 + 9) > 0.55 && h > 18) id = B.STONE;
          else id = B.GRASS;
        } else if (y >= h - 3) {
          id = isBeach ? B.SAND : B.DIRT;
          if (isBeach && y >= h - 1) id = B.SAND;
        } else if (y < h - 8 && y > 2 && noise2(x * 0.2, z * 0.2) > 0.78 && y >= h - 12 && h > SEA_LEVEL + 6) {
          id = B.GRAVEL; // gravel pockets below surface
        } else {
          id = B.STONE;
        }
        if (y > h && y <= SEA_LEVEL) id = B.WATER;
        if (y > h) continue;
        world[idx(x, y, z)] = id;
      }
      // water fill handled by loop above (y<=SEA_LEVEL & y>h)
    }
  }
  // --- ores & caves (3D pass) ---
  for (let x = 0; x < WORLD_X; x++) {
    for (let z = 0; z < WORLD_Z; z++) {
      for (let y = 2; y < WORLD_Y - 4; y++) {
        const id = world[idx(x, y, z)];
        if (id !== B.STONE) continue;
        const cave = noise3(x, y, z);
        if (cave > 0.58) { world[idx(x, y, z)] = B.AIR; continue; }
        const r = hash3(x, y, z);
        // ores by depth
        const ore = r > 0.985 && y < 14 ? B.DIAMOND_ORE
          : r > 0.96 && y < 22 ? B.GOLD_ORE
            : r > 0.90 && y < 34 ? B.IRON_ORE
              : r > 0.80 ? B.COAL_ORE : 0;
        if (ore) world[idx(x, y, z)] = ore;
      }
    }
  }
  // --- surface features: trees, flowers, clay under water, snow peaks ---
  for (let x = 3; x < WORLD_X - 3; x++) {
    for (let z = 3; z < WORLD_Z - 3; z++) {
      const h = heightAt(x, z);
      const top = getBlock(x, h, z);
      // replace grassy caps of tall peaks with snow/stone
      if (h > SEA_LEVEL + 9 && top === B.GRASS) {
        const n = fbm(x * 0.4 + 3, z * 0.4 + 3);
        world[idx(x, h, z)] = n > 0.35 ? B.SNOW : B.STONE;
        if (n > 0.35 && getBlock(x, h + 1, z) === B.AIR) world[idx(x, h + 1, z)] = B.SNOW;
      }
      // underwater clay
      if (top === B.WATER && h >= SEA_LEVEL - 2) {
        for (let yy = h - 1; yy >= Math.max(1, h - 3); yy--) {
          if (getBlock(x, yy, z) === B.SAND) { world[idx(x, yy, z)] = B.CLAY; break; }
        }
      }
      // flowers / tall grass on grass
      if (top === B.GRASS && getBlock(x, h + 1, z) === B.AIR) {
        const rr = hash2(x * 7 + 3, z * 13 + 5);
        if (rr < 0.02) world[idx(x, h + 1, z)] = B.FLOWER_RED;
        else if (rr < 0.05) world[idx(x, h + 1, z)] = B.FLOWER_YELLOW;
        else if (rr < 0.16) world[idx(x, h + 1, z)] = B.TALL_GRASS;
      }
      // --- kaya kümeleri (küçük taş parçaları, performans dostu: 2-4 blok) ---
      if (top === B.GRASS && getBlock(x, h + 1, z) === B.AIR && hash2(x * 91 + 17, z * 53 + 29) > 0.988) {
        const mossy = hash2(x * 13 + 5, z * 41 + 11) > 0.55;
        const rock = mossy ? B.MOSSY_COBBLE : B.COBBLE;
        const size = 1 + Math.floor(hash2(x + 7, z + 3) * 3); // 1..3 yükseklik
        for (let t = 1; t <= size; t++) world[idx(x, h + t, z)] = rock;
        if (size > 1) {
          world[idx(x + 1, h + 1, z)] = rock;
          if (hash2(x + 21, z + 9) > 0.5) world[idx(x, h + 1, z + 1)] = rock;
        }
      }
      // --- ağaçlar: meşe / huş / çam (bölgeye göre tür seçimi) ---
      if (top === B.GRASS && h > SEA_LEVEL + 1 && h < WORLD_Y - 14) {
        const region = noise2(x * 0.012 + 300, z * 0.012 - 200); // orman bölgesi
        const forestChance = region > 0.55 ? 0.055 : 0.024;      // sık/seyrek orman
        const tr = hash2(x * 31 + 7, z * 57 + 13);
        if (tr > forestChance) continue;
        let clash = false;
        for (let dx = -2; dx <= 2 && !clash; dx++)
          for (let dz = -2; dz <= 2 && !clash; dz++)
            if (getBlock(x + dx, h + 1, z + dz) !== B.AIR) clash = true;
        if (clash) continue;

        const species = hash2(x * 17 + 3, z * 23 + 91); // 0..1 → tür
        const isBirch = species > 0.72;
        const isPine = species <= 0.42;
        const logId = isBirch ? B.BIRCH_WOOD : isPine ? B.PINE_WOOD : B.WOOD;
        const leafId = isBirch ? B.BIRCH_LEAVES : isPine ? B.PINE_LEAVES : B.LEAVES;

        if (isPine) {
          // çam: uzun gövde + konik katmanlar
          const trunk = 6 + Math.floor(hash2(x + 41, z + 77) * 4);
          const topY = h + trunk;
          if (topY + 2 >= WORLD_Y) continue;
          for (let t = 1; t <= trunk; t++) world[idx(x, h + t, z)] = logId;
          for (let layer = 0; layer <= 3; layer++) {
            const yy = topY - layer;
            const rad = layer === 0 ? 0 : layer === 1 ? 1 : layer === 2 ? 2 : 1;
            if (yy < 1 || yy >= WORLD_Y) continue;
            for (let dx = -rad; dx <= rad; dx++)
              for (let dz = -rad; dz <= rad; dz++) {
                if (rad > 1 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
                if (dx === 0 && dz === 0 && layer > 0) continue;
                const bx = x + dx, bz = z + dz;
                if (getBlock(bx, yy, bz) === B.AIR) world[idx(bx, yy, bz)] = leafId;
              }
          }
        } else {
          const trunk = (isBirch ? 5 : 4) + Math.floor(hash2(x + 99, z + 99) * 3);
          const topY = h + trunk;
          if (topY + 2 >= WORLD_Y) continue;
          for (let t = 1; t <= trunk; t++) world[idx(x, h + t, z)] = logId;
          const canopy = isBirch
            ? [{ off: 2, rad: 1 }, { off: 1, rad: 2 }, { off: 0, rad: 1 }]
            : [{ off: 2, rad: 1 }, { off: 1, rad: 2 }, { off: 0, rad: 2 }, { off: -1, rad: 1 }];
          for (const layer of canopy) {
            const yy = topY + layer.off;
            if (yy < 1 || yy >= WORLD_Y) continue;
            for (let dx = -layer.rad; dx <= layer.rad; dx++)
              for (let dz = -layer.rad; dz <= layer.rad; dz++) {
                if (Math.abs(dx) === layer.rad && Math.abs(dz) === layer.rad && layer.rad > 1) continue;
                if (dx === 0 && dz === 0 && layer.off === 0) continue;
                const bx = x + dx, bz = z + dz;
                if (getBlock(bx, yy, bz) === B.AIR) world[idx(bx, yy, bz)] = leafId;
              }
          }
          // elma veren meşe: bazı ağaçlar "çiçekli" varyant değil, sadece yoğun yaprak
        }
      }
    }
  }
}

/* ================= 4. MESH BUILDER (chunk'lı, atlas UV) =================
   Yüzler CCW; atlas UV'leri blocks.ts'ten gelir. Su/cam ayrı geometry. */
const SP = [] as number[], SU = [] as number[], SI = [] as number[];
const WP = [] as number[], WU = [] as number[], WI = [] as number[];

const FACE_VERTS: number[][][] = [
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const FACE_UV: number[][][] = [
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
  [[0, 1], [1, 1], [1, 0], [0, 0]],
];
const FACE_NRM: number[][] = [
  [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];
const FACE_DIR: number[][] = [
  [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
];

function pushQuad(
  P: number[], U: number[], I: number[],
  x: number, y: number, z: number, face: number, tile: number, ao: number,
  topY = 1
) {
  const base = P.length / 3;
  const v = FACE_VERTS[face];
  const uv = FACE_UV[face];
  const [u0, v0, u1, v1] = tileUV(tile);
  for (let k = 0; k < 4; k++) {
    const vy = v[k][1] === 1 && topY !== 1 ? topY : v[k][1];
    P.push(x + v[k][0], y + vy, z + v[k][2]);
    const u = uv[k][0] === 0 ? u0 : u1;
    const vt = uv[k][1] === 0 ? v0 : v1;
    U.push(u, vt);
  }
  // vertex AO: brighten/darken per corner via vertex colors is complex;
  // we approximate AO by pushing a tiny per-face brightness into U channel? no.
  // AO handled via second attribute below — see buildChunkGeometry.
  void ao;
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Chunk'ın solid (ve yarı saydam yaprak) + su geometrisini üretir. */
function buildChunkGeometries(cx0: number, cz0: number): { solid: THREE.BufferGeometry | null; water: THREE.BufferGeometry | null } {
  SP.length = 0; SU.length = 0; SI.length = 0;
  WP.length = 0; WU.length = 0; WI.length = 0;
  const SOL = [] as number[]; // per-vertex brightness (AO)
  const WBR = [] as number[];

  for (let y = 0; y < WORLD_Y; y++) {
    for (let z = cz0; z < cz0 + CHUNK; z++) {
      for (let x = cx0; x < cx0 + CHUNK; x++) {
        const id = world[idx(x, y, z)];
        if (id === B.AIR) continue;
        const isWater = isLiquid(id);
        const isTrans = isTransparent(id) || isWater;
        const def = BLOCKS[id];
        const nbr = [
          getBlock(x, y + 1, z), getBlock(x, y - 1, z),
          getBlock(x + 1, y, z), getBlock(x - 1, y, z),
          getBlock(x, y, z + 1), getBlock(x, y, z - 1),
        ];
        for (let f = 0; f < 6; f++) {
          const nb = nbr[f];
          const nbWater = isLiquid(nb);
          // OPAK blok: yüz, yalnızca komşu "opak katı" DEĞİLSE çizilir.
          // (hava, su, cam, yaprak, çiçek komşuluğunda yüz gereklidir — aksi
          //  hâlde cam altından/agac altından dünyanın içi görünür)
          const nbOpaque = isSolid(nb) && !isTransparent(nb) && !nbWater;
          let draw: boolean;
          if (isWater) {
            // su: opak katı ve diğer su komşularında yüz çizilmez
            draw = !nbOpaque && !nbWater;
          } else if (isTrans) {
            // cam/yaprak/çiçek: aynı türle birleşir, diğer her şeye karşı çizilir
            draw = !nbOpaque && nb !== id;
          } else {
            draw = !nbOpaque;
          }
          if (!draw) continue;
          const tile = def.tiles[f];
          const [dx, dy, dz] = FACE_DIR[f];
          // ambient occlusion: karşılıklı köşe komşulukları
          const x2 = x + dx, y2 = y + dy, z2 = z + dz;
          const bright =
            0.62 // bottom ambient
            + (dy > 0 ? 0.55 : 0) // full sun top
            + (dy < 0 ? 0.15 : 0)
            + (dx !== 0 ? 0.3 : 0) + (dz !== 0 ? 0.3 : 0)
            - (isWater ? 0.35 : 0)
            + (isTransparent(id) ? -0.1 : 0);
          // corner AO: count solid diagonal neighbours to darken edges
          let aoV = bright;
          void x2; void y2; void z2;
          if (f === 0 || f === 1) {
            // top/bottom face: check 4 side-neighbours of the block
            const sideSolid =
              (solidAt(x + 1, y, z) ? 1 : 0) + (solidAt(x - 1, y, z) ? 1 : 0) +
              (solidAt(x, y, z + 1) ? 1 : 0) + (solidAt(x, y, z - 1) ? 1 : 0);
            aoV = bright * (1 - sideSolid * 0.06);
          }
          if (isWater) {
            // su yüzeyi: blok üstünde su yoksa yüzey 0.86'da biter
            const surface = getBlock(x, y + 1, z) !== B.WATER;
            const topY = surface ? 0.86 : 1;
            const baseY = f === 0 ? y + 0.86 : y;
            pushQuad(WP, WU, WI, x, baseY, z, f, tile, aoV, f === 0 ? 1 : topY);
            for (let k = 0; k < 4; k++) WBR.push(0.72);
          } else {
            pushQuad(isTrans ? WP : SP, isTrans ? WU : SU, isTrans ? WI : SI, x, y, z, f, tile, aoV);
            if (isTrans) for (let k = 0; k < 4; k++) WBR.push(aoV);
            else for (let k = 0; k < 4; k++) SOL.push(aoV);
          }
        }
      }
    }
  }

  const mkSolid = () => {
    if (SI.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(SP, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(SU, 2));
    // vertex colors carry the baked lighting (top bright, sides mid, AO shading)
    const cols: number[] = [];
    for (const a of SOL) cols.push(a, a, a);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    geo.setIndex(SI);
    geo.computeVertexNormals();
    return geo;
  };
  const mkWater = () => {
    if (WI.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(WP, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(WU, 2));
    const cols: number[] = [];
    for (const a of WBR) cols.push(a, a, a);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    geo.setIndex(WI);
    geo.computeVertexNormals();
    return geo;
  };
  return { solid: mkSolid(), water: mkWater() };
}

/* ================= 5. SCENE ================= */
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let worldRoot: THREE.Group; // chunk mesh'leri burada
let atlasTex: THREE.CanvasTexture;

/* Tüm chunklar aynı iki materyali paylaşır (draw call ve program sayısını düşürür) */
let solidMat: THREE.MeshLambertMaterial | null = null;
let waterMat: THREE.MeshLambertMaterial | null = null;

interface ChunkMeshes { cx: number; cz: number; solid: THREE.Mesh | null; water: THREE.Mesh | null; }
const chunks = new Map<string, ChunkMeshes>();

const player = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  w: 0.6, h: 1.8,
  onGround: false,
  yaw: 0, pitch: 0,
  hp: 20,
  hunger: 20,
  fallStart: -1, // yüksekten düşme başlangıcı
};

const inventory = new Inventory();

// başlangıç envanteri: herkese biraz blok
function starterInventory() {
  inventory.add(B.WOOD, 12);
  inventory.add(B.PLANKS, 16);
  inventory.add(B.DIRT, 32);
  inventory.add(B.COBBLE, 24);
  inventory.add(B.GLASS, 8);
  inventory.add(B.CRAFTING_TABLE, 1);
  inventory.add(I.APPLE, 3);
}

let selectedSlot = 0;
const keys = { f: false, b: false, l: false, r: false, jump: false, run: false };
/* dokunmatik (mobil) giriş eksenleri — masaüstünde 0 kalır */
let tMoveX = 0, tMoveZ = 0;
let touchMode = false;
let pointerLocked = false;
let worldDirty = true;             // tüm chunkları yeniden ör (yükleme/ayar değişimi)
let state: "menu" | "play" | "dead" = "menu";
let playerChunkX = 0, playerChunkZ = 0;

/* yalnızca değişen chunklar yeniden örülür (tek blok düzenlemesi → 1-5 chunk) */
const dirtyChunks = new Set<string>();
/* oyuncunun düzenlemeleri: idx → blok kimliği (kayıtta seed ile birlikte saklanır) */
const edits = new Map<number, number>();

let renderRadius = 5; // chunk cinsinden görüş yarıçapı (menüden ayarlanabilir)
const RENDER_RADIUS_MIN = 2, RENDER_RADIUS_MAX = 8;

/* ================= 5.5 MADENCİLİK YARDIMCILARI ================= */
// Blok hangi alet türüyle hızlı kırılır?
function mineClassOf(id: number): "pickaxe" | "axe" | "shovel" | "hand" | null {
  if (id === B.AIR || id === B.WATER || id === B.BEDROCK) return null;
  switch (id) {
    case B.STONE: case B.COBBLE: case B.BRICK: case B.STONE_BRICKS:
    case B.MOSSY_COBBLE: case B.SANDSTONE: case B.OBSIDIAN:
    case B.COAL_ORE: case B.IRON_ORE: case B.GOLD_ORE: case B.DIAMOND_ORE:
      return "pickaxe";
    case B.WOOD: case B.BIRCH_WOOD: case B.PINE_WOOD:
    case B.PLANKS: case B.CRAFTING_TABLE:
    case B.LEAVES: case B.BIRCH_LEAVES: case B.PINE_LEAVES:
      return "axe";
    case B.DIRT: case B.GRASS: case B.SAND: case B.GRAVEL: case B.CLAY:
    case B.SNOW: case B.ICE:
      return "shovel";
    default: // çiçekler, uzun çimen — el ile
      return "hand";
  }
}
function tierRank(t: "wood" | "stone"): number { return t === "stone" ? 1 : 0; }
// cevher → gereken minimum kazma seviyesi (-1 = cevher değil)
function oreTierOf(id: number): number {
  switch (id) {
    case B.COAL_ORE: return 0;
    case B.IRON_ORE: case B.GOLD_ORE: case B.DIAMOND_ORE: return 1;
    default: return -1;
  }
}

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
    if (blk !== B.AIR && !isLiquid(blk)) return { x, y, z, nx, ny, nz };
    if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; nx = -stepX; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -stepZ; }
  }
  return null;
}

/* ================= 7. CHUNK MANAGEMENT ================= */
function chunkKey(cx: number, cz: number) { return cx + "," + cz; }

/** Bir bloğun dokunduğu chunkı (+ kenardaysa komşularını) kirli işaretler. */
function markChunkDirtyAt(x: number, z: number) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  dirtyChunks.add(chunkKey(cx, cz));
  const lx = ((x % CHUNK) + CHUNK) % CHUNK, lz = ((z % CHUNK) + CHUNK) % CHUNK;
  if (lx === 0) dirtyChunks.add(chunkKey(cx - 1, cz));
  if (lx === CHUNK - 1) dirtyChunks.add(chunkKey(cx + 1, cz));
  if (lz === 0) dirtyChunks.add(chunkKey(cx, cz - 1));
  if (lz === CHUNK - 1) dirtyChunks.add(chunkKey(cx, cz + 1));
}

function refreshChunks() {
  const pcx = Math.floor(player.x / CHUNK);
  const pcz = Math.floor(player.z / CHUNK);
  const moved = pcx !== playerChunkX || pcz !== playerChunkZ;
  if (!moved && !worldDirty && dirtyChunks.size === 0) return;
  playerChunkX = pcx; playerChunkZ = pcz;
  const want = new Set<string>();
  for (let dx = -renderRadius; dx <= renderRadius; dx++) {
    for (let dz = -renderRadius; dz <= renderRadius; dz++) {
      const cx = pcx + dx, cz = pcz + dz;
      if (cx < 0 || cz < 0) continue;
      const x0 = cx * CHUNK, z0 = cz * CHUNK;
      if (x0 >= WORLD_X || z0 >= WORLD_Z) continue;
      want.add(chunkKey(cx, cz));
    }
  }
  // menzil dışındaki chunkları kaldır (uzaktakiler render edilmez)
  for (const [k, cm] of chunks) {
    if (!want.has(k)) {
      if (cm.solid) { worldRoot.remove(cm.solid); cm.solid.geometry.dispose(); }
      if (cm.water) { worldRoot.remove(cm.water); cm.water.geometry.dispose(); }
      chunks.delete(k);
    }
  }
  if (!solidMat) solidMat = new THREE.MeshLambertMaterial({ map: atlasTex, vertexColors: true });
  if (!waterMat) {
    waterMat = new THREE.MeshLambertMaterial({
      map: atlasTex, vertexColors: true, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide,
    });
  }
  // yalnızca eksik / kirli chunkları ör
  for (const k of want) {
    const needsBuild = worldDirty || !chunks.has(k) || dirtyChunks.has(k);
    if (!needsBuild) continue;
    const [cxs, czs] = k.split(",");
    const cx = Number(cxs), cz = Number(czs);
    const g = buildChunkGeometries(cx * CHUNK, cz * CHUNK);
    const existing = chunks.get(k);
    if (existing) {
      if (existing.solid) { worldRoot.remove(existing.solid); existing.solid.geometry.dispose(); }
      if (existing.water) { worldRoot.remove(existing.water); existing.water.geometry.dispose(); }
    }
    const entry: ChunkMeshes = { cx, cz, solid: null, water: null };
    if (g.solid) {
      g.solid.computeBoundingSphere();
      const m = new THREE.Mesh(g.solid, solidMat);
      m.frustumCulled = true; // görüş dışındaki chunklar çizilmez
      worldRoot.add(m);
      entry.solid = m;
    }
    if (g.water) {
      g.water.computeBoundingSphere();
      const m = new THREE.Mesh(g.water, waterMat);
      m.frustumCulled = true;
      m.renderOrder = 1;
      worldRoot.add(m);
      entry.water = m;
    }
    chunks.set(k, entry);
  }
  dirtyChunks.clear();
  worldDirty = false;
}

/* ================= 8. MAIN ================= */
let bits: { m: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[] = [];
function spawnBits(x: number, y: number, z: number, color: number) {
  for (let i = 0; i < 5; i++) {
    if (bits.length >= 110) break;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    scene.add(m);
    bits.push({ m, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 6 + 2.5, vz: (Math.random() - 0.5) * 5, life: 0.6 + Math.random() * 0.35 });
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
  for (let r = 0; r < 60; r++) {
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * r);
      const z = Math.round(cz + Math.sin(ang) * r);
      if (x < 3 || x >= WORLD_X - 3 || z < 3 || z >= WORLD_Z - 3) continue;
      const h = heightAt(x, z);
      if (getBlock(x, h, z) === B.GRASS && getBlock(x, h + 1, z) === B.AIR) {
        return { x: x + 0.5, y: h + 0.02, z: z + 0.5 };
      }
    }
  }
  const h0 = heightAt(cx, cz);
  return { x: cx + 0.5, y: Math.max(h0 + 1, SEA_LEVEL + 2), z: cz + 0.5 };
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

  // mobil / düşük güçlü cihazlarda daha düşük render yükü
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
  const lowPower = isMobile || (navigator.hardwareConcurrency || 4) <= 4;
  touchMode = isMobile; // dokunmatik kontroller yalnızca mobilde

  renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : 2));

  scene = new THREE.Scene();
  const bgCol = new THREE.Color(0x8fd0f5);
  scene.background = bgCol;
  const fog = new THREE.Fog(0xbfe2f8, 60, 170);
  scene.fog = fog;

  camera = new THREE.PerspectiveCamera(74, 1, 0.08, 400);
  // görüş mesafesi render yarıçapına bağlı
  function applyViewDistance() {
    const dist = renderRadius * CHUNK;
    fog.near = dist * 0.45;
    fog.far = dist * 1.06;
    // gökyüzü kubbesi kırpılmasın (dome yarıçapı en fazla ~410)
    camera.far = Math.max(dist * 2.4, 520);
    camera.updateProjectionMatrix();
  }
  renderRadius = lowPower ? 3 : 5;
  applyViewDistance();

  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x8a6a4a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.35);
  sun.position.set(90, 220, 60);
  scene.add(sun);
  const amb = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(amb);

  // gökyüzü paleti (gündüz/gece/alacakaranlık + güneş/ay renkleri)
  const skyDay = new THREE.Color(0x8fd0f5);
  const skyNight = new THREE.Color(0x0a1226);
  const skyDusk = new THREE.Color(0xf09a52);
  const sunWhite = new THREE.Color(0xfff2d8);
  const sunOrange = new THREE.Color(0xff9a4d);
  const moonCol = new THREE.Color(0x7d92cc);
  // kubbe gradyan renkleri (her karede yeni nesne üretmemek için sabit)
  const skyTopDay = new THREE.Color(0x2f7fd6), skyTopNight = new THREE.Color(0x081026);
  const skyBotDay = new THREE.Color(0xbfe2f8), skyBotNight = new THREE.Color(0x111c33);
  const skyWarm = new THREE.Color(0xf0a45e);

  // gündüz/gece: gökyüzü, sis, ışık yoğunlukları ve güneş yönü
  function updateSky() {
    const p = (worldTime % DAY_LEN) / DAY_LEN;
    const ang = (p - 0.25) * Math.PI * 2;
    const e = Math.cos(ang); // güneş yüksekliği: öğlen +1, gece -1
    const dl = Math.max(0, e);
    const tw = e > 0 && e < 0.45 ? (0.45 - e) / 0.45 : 0; // alacakaranlık katsayısı
    bgCol.copy(skyNight).lerp(skyDay, Math.min(1, dl * 1.25));
    if (tw > 0) bgCol.lerp(skyDusk, tw * 0.7);
    fog.color.copy(bgCol);
    // güneş gökyüzünde dolaşır (doğu → batı)
    sun.position.set(60 + Math.sin(ang) * 140, 40 + Math.max(0.08, e) * 230, 70 + Math.cos(ang) * 60);
    sun.intensity = 0.04 + 1.3 * dl;
    if (dl < 0.08) sun.color.copy(moonCol);
    else { sun.color.copy(sunWhite); sun.color.lerp(sunOrange, tw * 0.65); }
    hemi.intensity = 0.34 + 0.62 * dl;
    amb.intensity = 0.08 + 0.2 * dl;

    /* --- gökyüzü kubbesi + yıldızlar + güneş/ay --- */
    const topC = skyMat.uniforms.topColor.value as THREE.Color;
    const botC = skyMat.uniforms.bottomColor.value as THREE.Color;
    topC.copy(skyTopNight).lerp(skyTopDay, Math.min(1, dl * 1.25));
    botC.copy(skyBotNight).lerp(skyBotDay, Math.min(1, dl * 1.3));
    if (tw > 0) { topC.lerp(skyWarm, tw * 0.35); botC.lerp(skyWarm, tw * 0.8); }
    starMat.opacity = Math.max(0, Math.min(1, -e * 1.5));
    stars.rotation.y = worldTime * 0.004;
    stars.position.copy(camera.position);
    skyDome.position.copy(camera.position);

    // güneş/ay diskleri gökyüzünde
    const R = skyRadius * 0.82;
    sunDisc.position.set(
      camera.position.x + Math.sin(ang) * R,
      camera.position.y + e * R,
      camera.position.z + Math.cos(ang) * R * 0.35,
    );
    moonDisc.position.set(
      camera.position.x - Math.sin(ang) * R,
      camera.position.y - e * R,
      camera.position.z - Math.cos(ang) * R * 0.35,
    );
    sunDisc.visible = e > -0.12;
    moonDisc.visible = e < 0.12;
    const icon = e > 0.06 ? "☀️" : e < -0.06 ? "🌙" : p < 0.5 ? "🌅" : "🌇";
    const phaseTxt = e > 0.06 ? "Gündüz" : e < -0.06 ? "Gece" : p < 0.5 ? "Gündoğumu" : "Gün batımı";
    const dayNo = Math.floor(worldTime / DAY_LEN) + 1;
    const ce = document.getElementById("vcx-clock");
    if (ce) ce.textContent = `${icon} ${phaseTxt} · Gün ${dayNo}`;
  }

  worldRoot = new THREE.Group();
  scene.add(worldRoot);

  /* ---- gökyüzü kubbesi (gradyan) + yıldızlar + güneş/ay ---- */
  const skyRadius = renderRadius * CHUNK * 3.2;
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x2f7fd6) },
      bottomColor: { value: new THREE.Color(0xbfe2f8) },
      offset: { value: 24 },
      exponent: { value: 0.75 },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(max(h, 0.0), exponent)), 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(skyRadius, 20, 14), skyMat);
  skyDome.frustumCulled = false;
  scene.add(skyDome);

  // yıldızlar (gece görünür) — tek Points nesnesi, düşük maliyet
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const R = skyRadius * 0.94;
    starPos[i * 3] = Math.cos(a) * r * R;
    starPos[i * 3 + 1] = Math.abs(u) * R * 0.9 + 10;
    starPos[i * 3 + 2] = Math.sin(a) * r * R;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 2, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // güneş ve ay diskleri
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff6cf, fog: false }));
  const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 10), new THREE.MeshBasicMaterial({ color: 0xe4eaff, fog: false }));
  sunDisc.frustumCulled = false;
  moonDisc.frustumCulled = false;
  scene.add(sunDisc);
  scene.add(moonDisc);

  // bakılan/kazılan blok vurgusu
  const hlGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
  const hlMat = new THREE.LineBasicMaterial({ color: 0x0c0c0c, transparent: true, opacity: 0.9 });
  const targetHL = new THREE.LineSegments(hlGeo, hlMat);
  targetHL.visible = false;
  scene.add(targetHL);

  function resize() {
    const w = wrap.clientWidth || 960;
    const h = wrap.clientHeight || 540;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // init blocks & atlas
  initBlocks();
  if (ATLAS_CANVAS) {
    atlasTex = new THREE.CanvasTexture(ATLAS_CANVAS);
    // yakında keskin (Nearest), uzakta mipmap ile yumuşak → titreme/bozulma azalır
    atlasTex.magFilter = THREE.NearestFilter;
    atlasTex.minFilter = THREE.NearestMipmapLinearFilter;
    atlasTex.generateMipmaps = true;
    atlasTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  } else {
    throw new Error("Atlas üretilemedi");
  }

  // world — seed: kayıt > menüden girilen bekleyen seed > rastgele
  worldTime = 0;
  const loaded = readSave();
  if (loaded) {
    if (typeof loaded.seed === "number") worldSeed = loaded.seed | 0 || 1;
    if (loaded.v === 2 && typeof loaded.renderRadius === "number") {
      renderRadius = Math.max(RENDER_RADIUS_MIN, Math.min(RENDER_RADIUS_MAX, Math.round(loaded.renderRadius)));
      applyViewDistance();
    }
  } else {
    const pending = takePendingSeed();
    worldSeed = pending ?? (((Math.random() * 2_000_000_000) | 0) || 1);
  }
  buildWorldData();
  const sp = findSpawn();
  player.x = sp.x; player.y = sp.y; player.z = sp.z;
  player.yaw = Math.PI * 0.25;
  player.hp = 20;
  player.hunger = 20;
  player.fallStart = -1;
  camera.position.set(player.x, player.y + 1.6, player.z);
  camera.rotation.order = "YXZ";

  // kayıt varsa geri yükle (v2: seed + düzenlemeler · v1: tam dünya)
  let hasSave = false;
  if (loaded) {
    if (loaded.v === 2) {
      hasSave = true;
      for (const [i, b] of loaded.edits) {
        if (i >= 0 && i < world.length) { world[i] = b; edits.set(i, b); }
      }
      worldDirty = true;
    } else {
      const wb = saveWorldBytes(loaded, WORLD_X * WORLD_Y * WORLD_Z);
      if (wb) {
        hasSave = true;
        world.set(wb);
        worldDirty = true;
      }
    }
  }
  if (hasSave) {
    const P = loaded!.player;
    player.x = Math.max(1.5, Math.min(WORLD_X - 1.5, P.x));
    player.y = Math.max(2, Math.min(WORLD_Y - 2, P.y));
    player.z = Math.max(1.5, Math.min(WORLD_Z - 1.5, P.z));
    player.yaw = P.yaw;
    player.pitch = Math.max(-1.5, Math.min(1.5, P.pitch));
    player.hp = Math.max(1, Math.min(20, P.hp));
    player.hunger = Math.max(0, Math.min(20, P.hunger));
    player.fallStart = -1;
    worldTime = Number.isFinite(loaded!.time) ? loaded!.time : 0;
    inventory.slots.fill(null);
    if (Array.isArray(loaded!.inv)) {
      loaded!.inv.forEach((entry, i) => {
        if (entry && i < inventory.slots.length) {
          const id = entry[0], count = entry[1];
          if (typeof id === "number" && typeof count === "number" && count > 0) {
            inventory.slots[i] = { id, count, dmg: typeof entry[2] === "number" ? entry[2] : undefined };
          }
        }
      });
    }
    selectedSlot = Math.max(0, Math.min(8, loaded!.slot || 0));
    camera.position.set(player.x, player.y + 1.6, player.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
  }
  buildUI(wrap);
  if (!hasSave) starterInventory();
  refreshHotbarUI();
  updatePlayerUI();
  document.querySelectorAll<HTMLElement>(".vcx-slot").forEach((el, k) => el.classList.toggle("active", k === selectedSlot));

  /* -------- envanter ekranı (E) & üretim masası (sağ tık) -------- */
  let invOpen = false;
  let invCleanup: (() => void) | null = null;
  let disposed = false;
  const invHost: InvHost = {
    inventory,
    onChanged() { refreshHotbarUI(); },
    toast: (m) => showToast(m),
    click: () => AudioSys.click(),
    closed() { if (!disposed && !touchMode) canvas.requestPointerLock?.(); },
  };
  function openInv(mode: 2 | 3) {
    if (invOpen || disposed) return;
    invOpen = true;
    stopMining();
    keys.f = keys.b = keys.l = keys.r = keys.jump = keys.run = false;
    tMoveX = 0; tMoveZ = 0;
    if (!touchMode) document.exitPointerLock?.();
    invCleanup = openInventoryScreen(wrap, invHost, mode);
  }
  function closeInv() {
    if (!invOpen) return;
    invOpen = false;
    const fn = invCleanup;
    invCleanup = null;
    if (fn) fn(); // grid+imleç envantere döner; closed() pointer lock'u geri ister
  }

  /* -------- canlılar (mobs.ts) -------- */
  let eatCd = 0;
  let meleeCd = 0;
  const mobCtx: MobCtx = {
    solidAt: (x, y, z) => solidAt(x, y, z),
    isLiquidId: (b) => isLiquid(b),
    getBlock: (x, y, z) => getBlock(x, y, z),
    groundY(x, z) {
      const xi = Math.floor(x), zi = Math.floor(z);
      for (let y = WORLD_Y - 3; y >= 2; y--) {
        const b = getBlock(xi, y, zi);
        if (b !== B.AIR && !isLiquid(b)) {
          if (getBlock(xi, y + 1, zi) === B.AIR && getBlock(xi, y + 2, zi) === B.AIR) return y + 1;
          return -1;
        }
      }
      return -1;
    },
    sunLevel: () => Math.max(0, Math.cos(((worldTime % DAY_LEN) / DAY_LEN - 0.25) * Math.PI * 2)),
    playerPos: () => [player.x, player.y, player.z],
    damagePlayer: (a, c) => hurt(a, c),
    addDrop(id, n) {
      const left = inventory.add(id, n);
      if (left > 0) showToast("Envanter dolu — düşen eşya kayboldu!");
      return left > 0;
    },
    particles: (x, y, z, col) => spawnBits(x, y, z, col),
    sfx(k) {
      if (k === "hit") AudioSys.tone("square", 170, 90, 0.09, 0.28);
      else if (k === "die") AudioSys.tone("sawtooth", 320, 60, 0.28, 0.32);
      else AudioSys.tone("sawtooth", 130, 40, 0.45, 0.25);
    },
  };
  const mobs = new Mobs(mobCtx);
  scene.add(mobs.group);

  function seedMobs() {
    const kinds = ["sheep", "cow", "pig", "chicken"] as const;
    for (let i = 0; i < 9; i++) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      for (let t = 0; t < 6; t++) {
        const a = Math.random() * Math.PI * 2;
        const r = 12 + Math.random() * 34;
        const x = Math.round(player.x + Math.cos(a) * r);
        const z = Math.round(player.z + Math.sin(a) * r);
        if (x < 2 || x > 125 || z < 2 || z > 125) continue;
        if (mobs.spawn(kind, x, z)) break;
      }
    }
  }
  seedMobs();

  function dmgForSelected(): number {
    const s = inventory.slots[selectedSlot];
    if (!s) return 2;
    const meta = toolMetaOf(s.id);
    if (!meta) return 2;
    return meta.type === "axe" ? 4 : 3;
  }

  function eatSelected() {
    if (eatCd > 0) return;
    const s = inventory.slots[selectedSlot];
    if (!s) return;
    const f = foodOf(s.id);
    if (f <= 0) { showToast("Bu yenmez"); return; }
    if (player.hunger >= 20 && player.hp >= 20) { showToast("Toksun, yiyemezsin"); return; }
    inventory.remove(selectedSlot, 1);
    player.hunger = Math.min(20, player.hunger + f);
    eatCd = 0.7;
    AudioSys.tone("square", 210, 130, 0.08, 0.3);
    window.setTimeout(() => AudioSys.tone("square", 150, 95, 0.1, 0.3), 140);
    updatePlayerUI();
    refreshHotbarUI();
    showToast(`🍎 ${itemNameOf(s.id)} yedin (+${f} açlık)`);
  }

  function updateCombat(dt: number) {
    if (eatCd > 0) eatCd -= dt;
    if (!mining) return; // mining = sol tık basılı
    if (meleeCd > 0) { meleeCd -= dt; return; }
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const hit = mobs.tryPlayerHit(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, 3.4, dmgForSelected());
    if (hit) meleeCd = 0.4;
  }

  /* -------- kayıt sistemi -------- */
  let autoSaveT = 0;
  function persist(notify: boolean): void {
    const data = makeSaveV2(
      worldSeed,
      edits,
      { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, hp: player.hp, hunger: player.hunger },
      worldTime,
      inventory.slots.map((s) => (s ? { id: s.id, count: s.count, dmg: s.dmg } : null)),
      selectedSlot,
      renderRadius,
    );
    if (writeSave(data) && notify) showToast("💾 Kaydedildi");
    else if (notify) showToast("⚠️ Kayıt başarısız (depolama dolu olabilir)");
  }
  (window as unknown as { __vcxSave?: () => void }).__vcxSave = () => persist(true);
  // görüş mesafesini çalışma anında değiştir (chunklar yeniden düzenlenir)
  (window as unknown as { __vcxSetRender?: (n: number) => void }).__vcxSetRender = (n: number) => {
    const v = Math.max(RENDER_RADIUS_MIN, Math.min(RENDER_RADIUS_MAX, Math.round(n)));
    if (v === renderRadius) return;
    renderRadius = v;
    applyViewDistance();
    worldDirty = true;
    persist(false);
  };
  (window as unknown as { __vcxSeed?: () => number }).__vcxSeed = () => worldSeed;
  (window as unknown as { __vcxRender?: () => number }).__vcxRender = () => renderRadius;

  /* -------- dokunmatik kontrol API'si (mobil) -------- */
  const touchApi = {
    move(x: number, z: number) { tMoveX = Math.max(-1, Math.min(1, x)); tMoveZ = Math.max(-1, Math.min(1, z)); },
    look(dx: number, dy: number) {
      player.yaw -= dx * 0.0035;
      player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - dy * 0.0035));
    },
    jump() { if (state === "play" && !invOpen) keys.jump = true; },
    sprint(on: boolean) { keys.run = on; },
    mine(on: boolean) {
      if (state !== "play" || invOpen) { if (!on) stopMining(); return; }
      if (on) { mineWarned = ""; mining = true; mineKey = ""; mineT = 0; }
      else stopMining();
    },
    place() { if (state === "play" && !invOpen) onInteract(); },
    inventory() { if (invOpen) closeInv(); else openInv(2); },
    isTouch: () => touchMode,
  };
  (window as unknown as { __vcxTouch?: typeof touchApi }).__vcxTouch = touchApi;
  (window as unknown as { __vcxNewWorld?: (seed?: string) => void }).__vcxNewWorld = (seed?: string) => {
    if (!window.confirm("Kayıtlı dünyayı sil ve yepyeni bir dünya başlat? Bu işlem geri alınamaz.")) return;
    if (seed && seed.trim() !== "") setPendingSeed(seed.trim());
    clearSave();
    window.location.reload();
  };

  /* -------- input -------- */
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (invOpen) {
      if (k === "e" || k === "escape") { e.preventDefault(); closeInv(); }
      else if (k === "m") { AudioSys.setMuted(!AudioSys.muted); setMuteUI(); }
      return; // ekran açıkken hareket/işlem tuşları çalışmaz
    }
    if (k === "e" && state === "play") { openInv(2); return; }
    if (k === "f" && state === "play") { eatSelected(); return; }
    if (["w", "a", "s", "d", " ", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    if (k === "w" || k === "arrowup") keys.f = true;
    if (k === "s" || k === "arrowdown") keys.b = true;
    if (k === "a" || k === "arrowleft") keys.l = true;
    if (k === "d" || k === "arrowright") keys.r = true;
    if (k === " ") { if (!keys.jump) keys.jump = true; }
    if (k === "shift") keys.run = true;
    if (k === "m") { AudioSys.setMuted(!AudioSys.muted); setMuteUI(); }
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
    const m = document.getElementById("vcx-menu");
    const h = m?.querySelector("h2");
    if (h) h.textContent = "Minecraft benzeri blok dünyası";
    canvas.requestPointerLock?.();
  };
  (window as unknown as { __vcxStart?: () => void }).__vcxStart = startPlay;
  const onCanvasClick = () => {
    if (touchMode) { if (state === "menu") startPlay(); return; }
    if (state === "menu") { startPlay(); return; }
    if (!pointerLocked) canvas.requestPointerLock?.();
  };
  canvas.addEventListener("click", onCanvasClick);
  document.addEventListener("pointerlockchange", () => {
    if (touchMode) return; // dokunmatikte pointer lock kullanılmaz
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked) stopMining();
    // Envanter açıkken lock düşmesi menüye atmaz (bilerek çıkıldı)
    if (!pointerLocked && state === "play" && !invOpen) {
      persist(false); // menüye dönünce sessizce kaydet
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
    if (e.button === 0) {
      // önce yakındaki canlıya vur; yoksa kazmaya başla
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const hitMob = mobs.tryPlayerHit(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, 3.4, dmgForSelected());
      if (!hitMob) { mineWarned = ""; mining = true; mineKey = ""; mineT = 0; }
    }
    else if (e.button === 2) onInteract();
  });
  const onMouseUp = (e: MouseEvent) => { if (e.button === 0) stopMining(); };
  document.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    if (state !== "play" || invOpen) return;
    e.preventDefault();
    selectSlot((selectedSlot + (e.deltaY > 0 ? 1 : 9)) % 10);
  }, { passive: false });

  // Sağ tık: bakılan blok üretim masasıysa 3×3 aç; değilse blok yerleştir
  function onInteract() {
    const hit = raycast(5.5);
    if (hit && getBlock(hit.x, hit.y, hit.z) === B.CRAFTING_TABLE) {
      openInv(3);
      return;
    }
    placeBlock();
  }

  function setBlock(x: number, y: number, z: number, id: number) {
    if (x < 0 || x >= WORLD_X || y < 1 || y >= WORLD_Y || z < 0 || z >= WORLD_Z) return;
    const i = idx(x, y, z);
    if (world[i] === id) return;
    world[i] = id;
    edits.set(i, id);       // kayıt için düzenleme günlüğü
    markChunkDirtyAt(x, z); // yalnızca ilgili chunk(lar) yeniden örülür
  }
  /* -------- kazma: sol tık basılı tut → süre sonunda kırılır -------- */
  let mining = false;
  let mineKey = "";
  let mineT = 0;
  let mineWarned = "";

  function currentTool(): number | null {
    const s = inventory.slots[selectedSlot];
    return s ? s.id : null;
  }
  function stopMining() {
    mining = false;
    mineKey = "";
    mineT = 0;
    targetHL.visible = false;
  }

  function doBreakBlock(hit: { x: number; y: number; z: number }) {
    const b = getBlock(hit.x, hit.y, hit.z);
    if (b === B.BEDROCK || b === B.AIR || isLiquid(b)) return;
    if (!isBreakable(b)) return;
    setBlock(hit.x, hit.y, hit.z, B.AIR);
    AudioSys.break();
    spawnBits(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0xcccccc);

    const toolId = currentTool();
    const meta = toolId !== null ? toolMetaOf(toolId) : undefined;
    let drop: number | null = dropsFor(b);
    const need = oreTierOf(b);
    if (need >= 0) {
      // cevher: uygun kazma şartı
      const ok = !!meta && meta.type === "pickaxe" && tierRank(meta.tier) >= need;
      if (!ok) {
        drop = null;
        showToast(need === 0 ? "Cevher için kazma gerek!" : "Bu cevher için taş kazma gerek!");
      }
    } else if (b === B.OBSIDIAN) {
      const ok = !!meta && meta.type === "pickaxe" && tierRank(meta.tier) >= 1;
      if (!ok) drop = null;
    }
    if (drop !== null) {
      const left = inventory.add(drop, 1);
      if (left > 0) showToast("Envanter dolu!");
    }
    if (meta) {
      if (inventory.damageSlot(selectedSlot)) showToast("💥 Aletin kırıldı!");
    }
    if (b === B.LEAVES || b === B.BIRCH_LEAVES || b === B.PINE_LEAVES) {
      if (Math.random() < 0.07) {
        const left = inventory.add(I.APPLE, 1);
        if (left > 0) showToast("Envanter dolu!");
      }
    }
    refreshHotbarUI();
  }

  function updateMining(dt: number) {
    if (!mining) return;
    const hit = raycast(7);
    if (!hit) { if (targetHL.visible) targetHL.visible = false; mineKey = ""; return; }
    const b = getBlock(hit.x, hit.y, hit.z);
    if (b === B.AIR || isLiquid(b) || !isBreakable(b)) { if (targetHL.visible) targetHL.visible = false; mineKey = ""; return; }
    const key = hit.x + "," + hit.y + "," + hit.z;
    const toolId = currentTool();
    const meta = toolId !== null ? toolMetaOf(toolId) : undefined;
    const need = oreTierOf(b);

    // Obsidyen: taş kazma yoksa kazma ilerlemez (tutma sürer, melee çalışabilir)
    if (b === B.OBSIDIAN && !(meta?.type === "pickaxe" && tierRank(meta.tier) >= 1)) {
      if (mineWarned !== key) { mineWarned = key; showToast("Obsidyen için taş kazma gerek!"); }
      targetHL.visible = false;
      mineKey = "";
      return;
    }
    if (need >= 0 && !(meta?.type === "pickaxe" && tierRank(meta.tier) >= need)) {
      if (mineWarned !== key) { mineWarned = key; showToast("Cevher için uygun kazma gerek!"); }
    }

    if (key !== mineKey) {
      mineKey = key;
      mineT = 0;
      targetHL.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      targetHL.visible = true;
    }
    const cls = mineClassOf(b);
    const speed = meta && cls === meta.type ? meta.speed : 1;
    const hard = BLOCKS[b]?.hardness ?? 1;
    const req = Math.max(0.12, (hard * 1.7 + 0.08) / speed);
    mineT += dt;
    if (mineT >= req) {
      doBreakBlock(hit);
      mineKey = "";
      mineT = 0;
    }
  }
  function placeBlock() {
    const hit = raycast(7);
    if (!hit) return;
    const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
    if (py < 1 || py >= WORLD_Y) return;
    if (getBlock(px, py, pz) !== B.AIR && !isLiquid(getBlock(px, py, pz))) return;
    if (px + 1 > player.x - player.w / 2 && px < player.x + player.w / 2 &&
      pz + 1 > player.z - player.w / 2 && pz < player.z + player.w / 2 &&
      py + 1 > player.y && py < player.y + player.h) return;
    const id = inventory.peek(selectedSlot);
    if (id === null || id === B.WATER || !BLOCKS[id]) return;
    if (isLiquid(id) || id === B.AIR) return;
    setBlock(px, py, pz, id);
    inventory.remove(selectedSlot, 1);
    AudioSys.place();
    spawnBits(px + 0.5, py + 0.5, pz + 0.5, 0xcccccc);
    refreshHotbarUI();
  }

  /* -------- physics (with 1-block step-up) -------- */
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
  function tryStepUp(dx: number, dz: number): boolean {
    const p = player;
    const nx = p.x + dx, nz = p.z + dz;
    if (!playerTouches(nx, p.y, nz)) { p.x = nx; p.z = nz; return true; }
    if (!p.onGround) return false;
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
    if (!tryStepUp(p.vx * dt, 0)) p.vx = 0;
    if (!tryStepUp(0, p.vz * dt)) p.vz = 0;
    const ny = p.y + p.vy * dt;
    if (!playerTouches(p.x, ny, p.z)) {
      p.y = ny;
      if (p.vy < 0) p.onGround = false;
    } else if (p.vy <= 0) {
      p.y = Math.floor(ny) + 1;
      while (playerTouches(p.x, p.y, p.z)) p.y += 0.01;
      p.onGround = true;
      p.vy = 0;
    } else {
      while (playerTouches(p.x, p.y, p.z)) p.y -= 0.01;
      p.vy = 0;
    }
  }

  let stepT = 0;
  let inWater = false;
  let hungerTick = 0;
  let regenTick = 0;

  function hurt(amount: number, cause: string) {
    if (state !== "play") return;
    player.hp = Math.max(0, player.hp - amount);
    AudioSys.tone("sawtooth", 95, 55, 0.22, 0.45);
    showToast(cause);
    updatePlayerUI();
    if (player.hp <= 0) {
      state = "dead";
      document.exitPointerLock?.();
      setMenuVisible(true);
      showDeathScreen();
    }
  }

  function heal(amount: number) {
    player.hp = Math.min(20, player.hp + amount);
    updatePlayerUI();
  }

  function updatePlayer(dt: number) {
    const p = player;
    if (state !== "play" || invOpen) return; // envanter açıkken dünya duraklar
    worldTime += dt;
    autoSaveT += dt;
    if (autoSaveT >= 25) { autoSaveT = 0; persist(false); }
    const wasOnGround = p.onGround;
    const fallStartY = p.fallStart;
    const prevY = p.y;
    const fw = getBlock(Math.floor(p.x), Math.floor(p.y + 0.3), Math.floor(p.z));
    inWater = isLiquid(fw);
    const speed = (keys.run ? 8.5 : 4.6) * (inWater ? 0.55 : 1);
    const sinY = Math.sin(p.yaw), cosY = Math.cos(p.yaw);
    let mx = 0, mz = 0;
    if (keys.f) { mx -= sinY; mz -= cosY; }
    if (keys.b) { mx += sinY; mz += cosY; }
    if (keys.l) { mx -= cosY; mz += sinY; }
    if (keys.r) { mx += cosY; mz -= sinY; }
    // dokunmatik joystick: analog yön (masaüstünde 0 — klavye vektörü kullanılır)
    if (tMoveX !== 0 || tMoveZ !== 0) {
      mx = tMoveZ * -sinY + tMoveX * cosY;
      mz = tMoveZ * -cosY + tMoveX * -sinY;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; } // klavye çaprazı ~1.41 → birim vektör
    // ivme/yumuşatma: ani hız değişimi yerine yumuşak hızlanma-yavaşlama
    const targetVx = mx * speed, targetVz = mz * speed;
    const accel = Math.min(1, (p.onGround ? 16 : 6) * dt);
    p.vx += (targetVx - p.vx) * accel;
    p.vz += (targetVz - p.vz) * accel;
    if (Math.abs(p.vx) < 0.02 && targetVx === 0) p.vx = 0;
    if (Math.abs(p.vz) < 0.02 && targetVz === 0) p.vz = 0;
    p.vy -= (inWater ? 10 : 26) * dt;
    if (p.vy < -(inWater ? 12 : 48)) p.vy = inWater ? -12 : -48;
    if (inWater && keys.jump) { p.vy = 4.5; keys.jump = false; AudioSys.jump(); }
    else if (keys.jump && p.onGround) { p.vy = 8.8; p.onGround = false; keys.jump = false; AudioSys.jump(); }
    const moving = Math.hypot(p.vx, p.vz) > 0.5;
    stepT += dt * (keys.run ? 1.7 : 1);
    if (moving && p.onGround && !inWater && stepT > 0.42) { stepT = 0; AudioSys.step(); }

    // fall tracking
    if (!p.onGround && !inWater) {
      if (p.fallStart < 0) p.fallStart = prevY;
    }
    if (p.onGround && fallStartY >= 0) {
      const fell = fallStartY - p.y;
      if (fell > 3.2) {
        const dmg = Math.min(16, Math.floor((fell - 3.2) * 1.8));
        if (dmg >= 1) hurt(dmg, `Düşme hasarı -${dmg}`);
      }
      p.fallStart = -1;
    }
    void wasOnGround;

    step(dt);
    if (p.y < -6) {
      const s = findSpawn();
      p.x = s.x; p.z = s.z; p.y = s.y; p.vy = 0;
      p.fallStart = -1;
    }

    // hunger: koşmak açlığı yavaş azaltır
    hungerTick += dt * (keys.run && moving ? 1.6 : 0.5);
    if (hungerTick > 12) {
      hungerTick = 0;
      player.hunger = Math.max(0, player.hunger - 1);
      updatePlayerUI();
    }
    // regen when full hunger
    if (player.hunger >= 18 && player.hp < 20) {
      regenTick += dt;
      if (regenTick > 2) { regenTick = 0; heal(1); }
    }
    camera.position.set(p.x, p.y + 1.6, p.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;

    // coords hud
    const cd = document.getElementById("vcx-coords");
    if (cd) cd.textContent = `X ${Math.floor(p.x)}  Y ${Math.floor(p.y)}  Z ${Math.floor(p.z)}`;
  }

  let raf = 0, last = 0;
  let fpsN = 0, fpsAcc = 0, lastAim = "", aimT = 0;
  function updateAimUI() {
    const el = document.getElementById("vcx-aim");
    if (!el) return;
    if (state !== "play" || invOpen || (!pointerLocked && !touchMode)) {
      if (lastAim !== "") { lastAim = ""; el.textContent = ""; }
      return;
    }
    const hit = raycast(6);
    let txt = "";
    if (hit) {
      const b = getBlock(hit.x, hit.y, hit.z);
      const def = BLOCKS[b];
      if (def && b !== B.AIR && !isLiquid(b)) txt = def.name + (isBreakable(b) ? "" : " · kırılamaz");
    }
    if (txt !== lastAim) { lastAim = txt; el.textContent = txt; }
  }
  function loop(ts: number) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    fpsN += 1; fpsAcc += dt;
    if (fpsAcc >= 0.5) {
      const fpsEl = document.getElementById("vcx-fps");
      if (fpsEl) fpsEl.textContent = `⚡ ${Math.round(fpsN / fpsAcc)} FPS`;
      fpsN = 0; fpsAcc = 0;
    }
    if (state === "play") {
      updatePlayer(dt);
      if (!invOpen) {
        updateMining(dt);
        updateCombat(dt);
        mobs.update(dt);
      }
      updateBits(dt);
    }
    // hedef blok bilgisi: raycast'i her karede değil, 10 kez/sn çalıştır
    aimT += dt;
    if (aimT >= 0.1) { aimT = 0; updateAimUI(); }
    refreshChunks();
    updateSky();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  const cleanupBits = () => {
    for (const p of bits) { scene.remove(p.m); (p.m.material as THREE.Material).dispose(); p.m.geometry.dispose(); }
    bits = [];
  };
  return () => {
    disposed = true;
    if (invOpen) closeInv();
    persist(false); // ayrılırken son durumu sakla
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("mouseup", onMouseUp);
    targetHL.visible = false;
    scene.remove(targetHL);
    hlGeo.dispose();
    hlMat.dispose();
    // gökyüzü nesneleri
    scene.remove(skyDome); scene.remove(stars); scene.remove(sunDisc); scene.remove(moonDisc);
    skyDome.geometry.dispose();
    (skyDome.material as THREE.Material).dispose();
    starGeo.dispose();
    starMat.dispose();
    sunDisc.geometry.dispose(); (sunDisc.material as THREE.Material).dispose();
    moonDisc.geometry.dispose(); (moonDisc.material as THREE.Material).dispose();
    document.exitPointerLock?.();
    cleanupBits();
    chunks.forEach((cm) => {
      if (cm.solid) { cm.solid.geometry.dispose(); }
      if (cm.water) { cm.water.geometry.dispose(); }
    });
    chunks.clear();
    mobs.clear();
    scene.remove(mobs.group);
    worldRoot.removeFromParent();
    atlasTex.dispose();
    solidMat?.dispose();
    waterMat?.dispose();
    solidMat = null;
    waterMat = null;
    wrap.remove();
    renderer.dispose();
  };
}

/* ================= 9. UI ================= */
let hotbarRoot: HTMLElement | null = null;
let healthFill: HTMLElement | null = null;
let hungerFill: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;
let toastTimer = 0;

function showToast(text: string) {
  const el = toastEl;
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2200);
}

function updatePlayerUI() {
  if (healthFill) healthFill.style.width = Math.max(0, (player.hp / 20) * 100) + "%";
  if (hungerFill) hungerFill.style.width = Math.max(0, (player.hunger / 20) * 100) + "%";
}

function setMuteUI() {
  const el = document.getElementById("vcx-sound");
  if (el) el.textContent = AudioSys.muted ? "🔇" : "🔊";
}

function refreshHotbarUI() {
  if (!hotbarRoot) return;
  const kids = hotbarRoot.children;
  for (let i = 0; i < 9 && i < kids.length; i++) {
    const el = kids[i] as HTMLElement;
    const slot = inventory.slots[i];
    const id = slot ? slot.id : null;
    if (id !== null) {
      el.style.backgroundImage = `url(${iconDataUrl(id)})`;
      el.style.backgroundColor = "rgba(0,0,0,.55)";
      el.style.opacity = "1";
      const meta = toolMetaOf(id);
      let bar = "";
      let tip = itemNameOf(id);
      if (meta) {
        const dmg = slot!.dmg ?? meta.dur;
        const pct = dmg / meta.dur;
        bar = `<span class="dbar"><i style="width:${Math.round(pct * 100)}%;background:${pct < 0.25 ? "#ff5d5d" : "#7ee081"}"></i></span>`;
        tip += ` (${dmg}/${meta.dur})`;
      } else tip += ` ×${slot!.count}`;
      el.innerHTML = `${i + 1}<span class="cnt">${slot!.count}</span>${bar}`;
      el.title = tip;
    } else {
      el.style.backgroundImage = "none";
      el.style.backgroundColor = "rgba(0,0,0,.35)";
      el.style.opacity = "0.4";
      el.innerHTML = `${i + 1}`;
      el.title = "Boş";
    }
  }
  // seçili slot adı
  const sel = inventory.slots[selectedSlot];
  const nm = document.getElementById("vcx-sel-name");
  if (nm) nm.textContent = sel ? itemNameOf(sel.id) : "Boş";
}

function selectSlot(i: number) {
  if (i < 0 || i > 8) return;
  selectedSlot = i;
  AudioSys.click();
  document.querySelectorAll<HTMLElement>(".vcx-slot").forEach((el, k) => {
    el.classList.toggle("active", k === i);
  });
  refreshHotbarUI();
}

function setMenuVisible(v: boolean) {
  const m = document.getElementById("vcx-menu");
  if (m) m.classList.toggle("hidden", !v);
}

function showDeathScreen() {
  // ölünce envanteri sıfırla ve başlangıca dön
  inventory.slots.fill(null);
  starterInventory();
  player.hp = 20;
  player.hunger = 20;
  player.fallStart = -1;
  const s = findSpawn();
  player.x = s.x; player.y = s.y; player.z = s.z; player.vy = 0;
  refreshHotbarUI();
  updatePlayerUI();
  const nm = document.getElementById("vcx-sel-name");
  if (nm) nm.textContent = "—";
  document.querySelectorAll<HTMLElement>(".vcx-slot").forEach((el, k) => el.classList.toggle("active", k === 0));
  selectedSlot = 0;
  refreshHotbarUI();
  const m = document.getElementById("vcx-menu");
  if (m) {
    const h = m.querySelector("h2");
    if (h) h.textContent = "💀 Öldün — dünya sıfırlandı, tekrar dene!";
  }
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
.vcx-row{display:flex;gap:12px;margin-top:18px}
.vcx-mini{font-size:clamp(12px,2.6vw,15px);font-weight:700;padding:10px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:#eaf4ff;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.35);transition:transform .06s}
.vcx-mini:active{transform:translateY(3px)}
.vcx-mini.danger{border-color:rgba(255,120,110,.6);background:rgba(160,40,40,.35);color:#ffd9d6}
.vcx-mini.saved{margin-top:10px;font-size:12px;padding:8px 14px;border-radius:20px;background:rgba(0,0,0,.45);color:#9fe6a8;cursor:default;border-color:rgba(126,224,129,.4)}
.vcx-input{font-size:clamp(12px,2.6vw,14px);font-family:inherit;padding:9px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.45);color:#eaf4ff;outline:none;min-width:150px}
.vcx-input:focus{border-color:#7ee081;box-shadow:0 0 0 2px rgba(126,224,129,.25)}
.vcx-input::placeholder{color:rgba(234,244,255,.45)}
select.vcx-input{cursor:pointer;min-width:110px}
.vcx-hud-root{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;align-items:center;gap:5px;pointer-events:none}
.vcx-hotbar{display:flex;gap:4px;background:rgba(0,0,0,.6);border:2px solid rgba(255,255,255,.45);border-radius:10px;padding:4px;pointer-events:auto}
.vcx-slot{width:46px;height:46px;border-radius:7px;border:2px solid rgba(255,255,255,.25);position:relative;font-weight:800;color:#fff;text-shadow:0 1px 3px #000;cursor:pointer;transition:transform .06s,border-color .06s;font-size:13px;display:flex;align-items:center;justify-content:center;background-size:cover;background-repeat:no-repeat;image-rendering:pixelated}
.vcx-slot .cnt{position:absolute;right:3px;bottom:2px;font-size:11px;color:#fff;text-shadow:0 1px 2px #000}
.dbar{position:absolute;left:2px;right:2px;bottom:0;height:3px;border-radius:2px;background:rgba(0,0,0,.6);overflow:hidden;pointer-events:none}
.dbar i{display:block;height:100%;border-radius:2px;background:#7ee081}
.vcx-slot.active{border-color:#ffd23f;transform:translateY(-3px);box-shadow:0 0 12px rgba(255,210,63,.9)}
.vcx-sel{font-size:13px;font-weight:700;color:#fff;background:rgba(0,0,0,.6);padding:2px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.3)}
.vcx-bars{display:flex;gap:8px;align-items:center;background:rgba(0,0,0,.55);padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,.25)}
.vcx-bar{width:74px;height:8px;border-radius:5px;background:rgba(255,255,255,.18);overflow:hidden}
.vcx-bar-fill{height:100%;border-radius:5px;transition:width .2s}
.vcx-hp{background:linear-gradient(90deg,#ff4d4d,#ff8a6a)}
.vcx-hg{background:linear-gradient(90deg,#e0a030,#f5d060)}
.vcx-coords{position:absolute;top:10px;right:12px;z-index:6;font-family:'Consolas',monospace;font-size:12px;color:rgba(255,255,255,.85);background:rgba(0,0,0,.5);padding:3px 10px;border-radius:6px;pointer-events:none}
.vcx-clock{position:absolute;top:10px;left:12px;z-index:6;font-size:13px;font-weight:700;color:#fff;background:rgba(0,0,0,.5);padding:3px 12px;border-radius:20px;pointer-events:none;letter-spacing:.3px;white-space:nowrap}
.vcx-fps{position:absolute;top:38px;right:12px;z-index:6;font-family:'Consolas',monospace;font-size:11px;color:#aef0b2;background:rgba(0,0,0,.45);padding:2px 8px;border-radius:6px;pointer-events:none}
.vcx-sound{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;font-size:14px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:2px 10px;cursor:pointer;color:#fff}
.vcx-sound:hover{background:rgba(255,255,255,.2)}
.vcx-aim{position:absolute;top:calc(50% + 18px);left:50%;transform:translateX(-50%);z-index:5;pointer-events:none;color:#fff;background:rgba(0,0,0,.55);padding:2px 12px;border-radius:14px;font-size:12px;font-weight:700;white-space:nowrap;text-shadow:0 1px 2px #000;letter-spacing:.3px}
/* --- dokunmatik kontroller (mobil) --- */
.vcx-look{position:absolute;top:12%;left:35%;right:0;bottom:26%;z-index:7;touch-action:none}
.vcx-stick{position:absolute;left:18px;bottom:96px;width:110px;height:110px;border-radius:50%;z-index:8;
  background:rgba(0,0,0,.32);border:2px solid rgba(255,255,255,.35);touch-action:none;display:flex;align-items:center;justify-content:center}
.vcx-knob{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.72);box-shadow:0 2px 8px rgba(0,0,0,.5);pointer-events:none}
.vcx-tbtns{position:absolute;right:14px;bottom:96px;z-index:8;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;touch-action:none}
.vcx-tbtn{width:56px;height:56px;border-radius:14px;font-size:22px;background:rgba(0,0,0,.42);color:#fff;
  border:2px solid rgba(255,255,255,.35);touch-action:none;cursor:pointer}
.vcx-tbtn.big{width:64px;height:64px;font-size:26px}
.vcx-tbtn.on{background:rgba(126,224,129,.55);border-color:#7ee081}
@media (pointer:coarse){ .vcx-tip{display:none} }
.vcx-cross{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:16px;height:16px;z-index:5;pointer-events:none;opacity:.9}
.vcx-cross::before,.vcx-cross::after{content:"";position:absolute;background:#fff;box-shadow:0 0 4px #000}
.vcx-cross::before{left:50%;top:0;width:2px;height:100%;transform:translateX(-50%)}
.vcx-cross::after{top:50%;left:0;height:2px;width:100%;transform:translateY(-50%)}
.vcx-tip{position:absolute;bottom:150px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.8);font-size:12px;z-index:5;pointer-events:none;white-space:nowrap;text-shadow:0 1px 3px #000}
.vcx-toast{position:absolute;top:22%;left:50%;transform:translateX(-50%);color:#ffe066;font-size:22px;font-weight:800;text-shadow:2px 2px 0 #000;z-index:8;pointer-events:none;opacity:0;transition:opacity .25s;font-family:'Segoe UI',sans-serif}
.vcx-toast.show{opacity:1}
/* küçük ekran / mobil: UI taşmasın, daha az yer kaplasın */
@media (max-width:760px){
  .vcx-slot{width:34px;height:34px;font-size:11px;border-width:1px}
  .vcx-slot .cnt{font-size:9px;right:2px}
  .vcx-hotbar{gap:3px;padding:3px;border-width:1px}
  .vcx-bars{gap:6px;padding:3px 9px}
  .vcx-bar{width:52px;height:7px}
  .vcx-sel{font-size:11px;padding:1px 10px}
  .vcx-tip{display:none}
  .vcx-coords{font-size:10px;top:6px;right:8px;padding:2px 6px}
  .vcx-clock{font-size:11px;top:6px;left:8px;padding:2px 8px}
  .vcx-fps{font-size:10px;top:30px;right:8px}
  .vcx-sound{font-size:12px;padding:1px 8px}
  .vcx-aim{font-size:11px;top:calc(50% + 14px)}
  .vcx-menu h1{letter-spacing:2px}
  .vcx-menu .row{font-size:12px;line-height:1.8}
  .vcx-play{padding:12px 32px}
  .vcx-input{min-width:120px;padding:8px 10px}
}
@media (max-height:520px){
  .vcx-menu h2{display:none}
  .vcx-menu .row{display:none}
  .vcx-tip{display:none}
}
`;
  container.appendChild(style);

  // --- üst: koordinat + saat rozeti ---
  const coords = document.createElement("div");
  coords.className = "vcx-coords";
  coords.id = "vcx-coords";
  container.appendChild(coords);

  const clock = document.createElement("div");
  clock.className = "vcx-clock";
  clock.id = "vcx-clock";
  clock.textContent = "☀️ Gündüz · Gün 1";
  container.appendChild(clock);

  // --- FPS + ses + hedef blok bilgisi ---
  const fps = document.createElement("div");
  fps.className = "vcx-fps";
  fps.id = "vcx-fps";
  fps.textContent = "⚡ -- FPS";
  container.appendChild(fps);

  const sound = document.createElement("button");
  sound.className = "vcx-sound";
  sound.id = "vcx-sound";
  sound.title = "Ses aç/kapat (M)";
  sound.addEventListener("click", () => { AudioSys.setMuted(!AudioSys.muted); setMuteUI(); });
  container.appendChild(sound);

  const aim = document.createElement("div");
  aim.className = "vcx-aim";
  aim.id = "vcx-aim";
  container.appendChild(aim);
  setMuteUI();

  /* ---- dokunmatik kontroller (yalnızca mobil) ---- */
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) {
    type TouchApi = {
      move(x: number, z: number): void;
      look(dx: number, dy: number): void;
      jump(): void;
      sprint(on: boolean): void;
      mine(on: boolean): void;
      place(): void;
      inventory(): void;
      isTouch(): boolean;
    };
    const call = () => (window as unknown as { __vcxTouch?: Partial<TouchApi> }).__vcxTouch;
    // bakış alanı (ekranın sağ-orta kısmı)
    const look = document.createElement("div");
    look.className = "vcx-look";
    container.appendChild(look);

    // hareket joystick'i
    const stick = document.createElement("div");
    stick.className = "vcx-stick";
    const knob = document.createElement("div");
    knob.className = "vcx-knob";
    stick.appendChild(knob);
    container.appendChild(stick);

    // aksiyon tuşları
    const btns = document.createElement("div");
    btns.className = "vcx-tbtns";
    btns.innerHTML = `
      <button class="vcx-tbtn" data-act="jump" title="Zıpla">⤒</button>
      <button class="vcx-tbtn" data-act="run" title="Koş">🏃</button>
      <button class="vcx-tbtn" data-act="inv" title="Envanter">🎒</button>
      <button class="vcx-tbtn big" data-act="mine" title="Kaz (basılı tut)">⛏️</button>
      <button class="vcx-tbtn big" data-act="place" title="Yerleştir">🧱</button>`;
    container.appendChild(btns);

    // --- joystick olayları ---
    let stickId: number | null = null;
    const R = 46;
    const stickMove = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      call()?.move?.(dx / R, -dy / R);
    };
    stick.addEventListener("pointerdown", (e) => {
      stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      stickMove(e);
    });
    stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) stickMove(e); });
    const stickEnd = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = "translate(0px, 0px)";
      call()?.move?.(0, 0);
    };
    stick.addEventListener("pointerup", stickEnd);
    stick.addEventListener("pointercancel", stickEnd);

    // --- bakış olayları ---
    let lookId: number | null = null, lx = 0, ly = 0;
    look.addEventListener("pointerdown", (e) => {
      lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
      look.setPointerCapture(e.pointerId);
    });
    look.addEventListener("pointermove", (e) => {
      if (e.pointerId !== lookId) return;
      call()?.look?.(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    const lookEnd = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = null; };
    look.addEventListener("pointerup", lookEnd);
    look.addEventListener("pointercancel", lookEnd);

    // --- tuş olayları ---
    btns.querySelectorAll<HTMLElement>(".vcx-tbtn").forEach((b) => {
      const act = b.dataset.act;
      if (act === "mine") {
        b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.classList.add("on"); call()?.mine?.(true); });
        const up = () => { b.classList.remove("on"); call()?.mine?.(false); };
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("pointerleave", up);
      } else if (act === "run") {
        let on = false;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          on = !on;
          b.classList.toggle("on", on);
          call()?.sprint?.(on);
        });
      } else {
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          if (act === "jump") call()?.jump?.();
          else if (act === "place") call()?.place?.();
          else if (act === "inv") call()?.inventory?.();
        });
      }
    });
  }

  // --- alt HUD: can/açlık + hotbar ---
  const hud = document.createElement("div");
  hud.className = "vcx-hud-root";
  hud.innerHTML = `
    <div class="vcx-bars">
      <div class="vcx-bar"><div class="vcx-bar-fill vcx-hp" id="vcx-hp" style="width:100%"></div></div>
      <div class="vcx-bar"><div class="vcx-bar-fill vcx-hg" id="vcx-hg" style="width:100%"></div></div>
    </div>
    <div class="vcx-sel" id="vcx-sel-name">—</div>
    <div class="vcx-hotbar" id="vcx-hotbar"></div>`;
  container.appendChild(hud);
  hotbarRoot = document.getElementById("vcx-hotbar");
  healthFill = document.getElementById("vcx-hp");
  hungerFill = document.getElementById("vcx-hg");

  // --- crosshair ---
  const cross = document.createElement("div");
  cross.className = "vcx-cross";
  container.appendChild(cross);

  // --- toast ---
  toastEl = document.createElement("div");
  toastEl.className = "vcx-toast";
  toastEl.id = "vcx-toast";
  container.appendChild(toastEl);

  const tip = document.createElement("div");
  tip.className = "vcx-tip";
  tip.textContent = "Sol tık: kaz / canlıya vur · Sağ tık: yerleştir · E: envanter · F: ye · Esc: menü";
  container.appendChild(tip);

  // hotbar'ı 9 boş slot ile kur (içerik refreshHotbarUI ile dolar)
  if (hotbarRoot) {
    hotbarRoot.innerHTML = Array.from({ length: 9 }, (_, i) =>
      `<div class="vcx-slot ${i === 0 ? "active" : ""}" data-i="${i}" title="Boş">${i + 1}</div>`
    ).join("");
    hotbarRoot.querySelectorAll<HTMLElement>(".vcx-slot").forEach((el) => {
      el.addEventListener("click", () => selectSlot(Number(el.dataset.i)));
    });
    refreshHotbarUI();
  }

  const menu = document.createElement("div");
  menu.className = "vcx-menu";
  menu.id = "vcx-menu";
  menu.innerHTML = `
    <h1>VOXELCRAFT</h1>
    <h2>Minecraft benzeri blok dünyası</h2>
    <p class="row"><span class="k">W A S D</span> hareket &nbsp;&nbsp;<span class="k">Space</span> zıpla &nbsp;&nbsp;<span class="k">Shift</span> koş</p>
    <p class="row"><span class="k">Sol tık</span> (basılı tut) kaz &nbsp;&nbsp;<span class="k">Sağ tık</span> yerleştir &nbsp;&nbsp;<span class="k">1-9</span>/tekerlek blok</p>
    <p class="row"><span class="k">E</span> envanter+üretim &nbsp;&nbsp;<span class="k">F</span> ye (seçili yiyecek) &nbsp;&nbsp;<span class="k">Sağ tık</span> masada: 3×3</p>
    <p class="row">Koyun/inek/domuz/tavuk bul, gece zombi ve iskelet gelir — avlan, et topla!</p>
    <button class="vcx-play" id="vcx-play">▶ OYNA</button>
    <div class="vcx-row">
      <input class="vcx-input" id="vcx-seed" type="text" inputmode="numeric" placeholder="seed (örn. 12345 / yusuf)" />
      <select class="vcx-input" id="vcx-render" title="Görüş mesafesi (chunk)">
        <option value="2">Menzil 2</option>
        <option value="3">Menzil 3</option>
        <option value="4">Menzil 4</option>
        <option value="5">Menzil 5</option>
        <option value="6">Menzil 6</option>
        <option value="7">Menzil 7</option>
        <option value="8">Menzil 8</option>
      </select>
    </div>
    <div class="vcx-row">
      <button class="vcx-mini" id="vcx-save">💾 Kaydet</button>
      <button class="vcx-mini danger" id="vcx-new">🔄 Yeni Dünya</button>
    </div>
    <p class="vcx-mini saved" id="vcx-seed-info">Seed: —</p>`;
  container.appendChild(menu);
  document.getElementById("vcx-play")!.addEventListener("click", () => {
    const fn = (window as unknown as { __vcxStart?: () => void }).__vcxStart;
    if (fn) fn();
  });
  document.getElementById("vcx-save")!.addEventListener("click", () => {
    (window as unknown as { __vcxSave?: () => void }).__vcxSave?.();
  });
  const seedInput = document.getElementById("vcx-seed") as HTMLInputElement | null;
  document.getElementById("vcx-new")!.addEventListener("click", () => {
    (window as unknown as { __vcxNewWorld?: (s?: string) => void }).__vcxNewWorld?.(seedInput?.value ?? "");
  });
  // görüş mesafesi seçici (mevcut değeri göster, değişince uygula)
  const renderSel = document.getElementById("vcx-render") as HTMLSelectElement | null;
  if (renderSel) {
    const cur = (window as unknown as { __vcxRender?: () => number }).__vcxRender?.();
    renderSel.value = String(cur ?? 5);
    renderSel.addEventListener("change", () => {
      (window as unknown as { __vcxSetRender?: (n: number) => void }).__vcxSetRender?.(Number(renderSel.value));
    });
  }
  const seedInfo = document.getElementById("vcx-seed-info");
  if (seedInfo) {
    const s = (window as unknown as { __vcxSeed?: () => number }).__vcxSeed?.();
    seedInfo.textContent = `Seed: ${s ?? "—"} · 💾 Otomatik kayıt (25 sn)`;
  }
}
