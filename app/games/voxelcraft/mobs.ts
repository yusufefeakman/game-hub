/* =====================================================================
   VOXELCRAFT — mobs.ts
   Canlılar: pasif (koyun/inek/domuz/tavuk) + düşman (zombi/iskelet).
   Her tür tek birleşik geometri + ortak malzeme ile çizilir (performans).
   Motor etkileşimi MobCtx arayüzü üzerinden yapılır; engine.ts'ye
   bağımlılık yoktur.

   - Pasifler gündüz yakınlarda ürer, amaçsızca dolaşır.
   - Düşmanlar yalnız GECE ürer, oyuncuyu görünce kovalar.
   - Gündüz düşmanlar yanar ve ölür.
   - Oyuncu sol tık ile vurabilir; ölünce et/yün düşer.
   ===================================================================== */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { I } from "./inventory";

export type MobKind = "sheep" | "cow" | "pig" | "chicken" | "zombie" | "skeleton";

export interface MobCtx {
  solidAt(x: number, y: number, z: number): boolean;
  isLiquidId(b: number): boolean;
  getBlock(x: number, y: number, z: number): number;
  /** (x,z) kolonunda zemin üstü y (ayak için) — uygun değilse -1 */
  groundY(x: number, z: number): number;
  sunLevel(): number; // gün ışığı 0..1 (0 = gece)
  playerPos(): [number, number, number]; // ayak pozisyonu
  damagePlayer(amount: number, cause: string): void;
  /** Düşen eşya: tamamı sığmazsa true döner (motor toast basar) */
  addDrop(id: number, count: number): boolean;
  particles(x: number, y: number, z: number, color: number): void;
  sfx(kind: "hit" | "die" | "burn"): void;
}

interface MobDef {
  hp: number; w: number; h: number;
  speed: number; chase: number;
  hostile: boolean; dmg: number; drop: [number, number, number][];
}

const DEFS: Record<MobKind, MobDef> = {
  sheep:   { hp: 10, w: 0.9,  h: 1.2, speed: 0.7,  chase: 0,   hostile: false, dmg: 0, drop: [[I.WOOL, 1, 2], [I.MEAT, 1, 1]] },
  cow:     { hp: 20, w: 1.1,  h: 1.5, speed: 0.6,  chase: 0,   hostile: false, dmg: 0, drop: [[I.MEAT, 2, 3]] },
  pig:     { hp: 10, w: 0.95, h: 1.1, speed: 0.85, chase: 0,   hostile: false, dmg: 0, drop: [[I.MEAT, 1, 2]] },
  chicken: { hp: 4,  w: 0.65, h: 0.9, speed: 1.1,  chase: 0,   hostile: false, dmg: 0, drop: [[I.MEAT, 1, 1]] },
  zombie:  { hp: 22, w: 0.75, h: 1.9, speed: 1.0,  chase: 1.75, hostile: true,  dmg: 3, drop: [[I.MEAT, 0, 1]] },
  skeleton:{ hp: 16, w: 0.7,  h: 1.9, speed: 0.95, chase: 1.9,  hostile: true,  dmg: 2, drop: [[I.STICK, 0, 2]] },
};

export interface Mob {
  kind: MobKind;
  mesh: THREE.Mesh;
  x: number; y: number; z: number; // ayak pozisyonu
  vy: number;
  hp: number; yaw: number;
  timer: number; dirX: number; dirZ: number;
  atkCd: number; burnT: number; hurtT: number;
  alive: boolean;
  def: MobDef;
}

function rnd(a: number, b: number): number { return a + Math.random() * (b - a); }
function rint(a: number, b: number): number { return Math.floor(rnd(a, b + 1)); }

/* ---------------- geometri üretici (tür başına 1 birleşik geometri) ---------------- */
type Part = [number, number, number, number, number, number, number]; // w,h,l,ox,oy,oz,color

function partsOf(kind: MobKind): Part[] {
  const P = (w: number, h: number, l: number, ox: number, oy: number, oz: number, col: number): Part =>
    [w, h, l, ox, oy, oz, col];
  switch (kind) {
    case "sheep":
      return [
        P(0.85, 0.8, 1.25, 0, 0.75, 0, 0xf2f2f2),      // gövde
        P(0.45, 0.4, 0.5, 0, 1.22, -0.82, 0xd9d9d9),   // kafa
        P(0.18, 0.72, 0.18, -0.3, 0.36, -0.45, 0xbdbdbd),
        P(0.18, 0.72, 0.18, 0.3, 0.36, -0.45, 0xbdbdbd),
        P(0.18, 0.72, 0.18, -0.3, 0.36, 0.45, 0xbdbdbd),
        P(0.18, 0.72, 0.18, 0.3, 0.36, 0.45, 0xbdbdbd),
      ];
    case "cow":
      return [
        P(1.0, 0.95, 1.6, 0, 0.95, 0, 0x7a4a2a),
        P(0.6, 0.55, 0.75, 0, 1.5, -1.15, 0x9c6b3f),
        P(0.2, 0.2, 0.55, 0, 1.95, -1.05, 0xe8e0d0),  // boynuz
        P(0.22, 0.85, 0.22, -0.38, 0.43, -0.6, 0x5f3a20),
        P(0.22, 0.85, 0.22, 0.38, 0.43, -0.6, 0x5f3a20),
        P(0.22, 0.85, 0.22, -0.38, 0.43, 0.6, 0x5f3a20),
        P(0.22, 0.85, 0.22, 0.38, 0.43, 0.6, 0x5f3a20),
      ];
    case "pig":
      return [
        P(0.9, 0.8, 1.3, 0, 0.8, 0, 0xeda6a6),
        P(0.55, 0.55, 0.55, 0, 1.08, -0.85, 0xeda6a6),
        P(0.34, 0.16, 0.14, 0, 1.02, -1.16, 0xc97f7f), // burun
        P(0.18, 0.75, 0.18, -0.33, 0.38, -0.5, 0xcc8f8f),
        P(0.18, 0.75, 0.18, 0.33, 0.38, -0.5, 0xcc8f8f),
        P(0.18, 0.75, 0.18, -0.33, 0.38, 0.5, 0xcc8f8f),
        P(0.18, 0.75, 0.18, 0.33, 0.38, 0.5, 0xcc8f8f),
      ];
    case "chicken":
      return [
        P(0.55, 0.6, 0.85, 0, 0.55, 0, 0xf6f1e2),      // gövde
        P(0.34, 0.34, 0.34, 0, 0.98, -0.45, 0xf6f1e2), // kafa
        P(0.2, 0.12, 0.12, 0, 1.22, -0.5, 0xd84343),   // ibik
        P(0.12, 0.1, 0.16, 0, 0.92, -0.68, 0xe8a33d),  // gaga
        P(0.14, 0.5, 0.14, -0.17, 0.25, 0.12, 0xd8a648),
        P(0.14, 0.5, 0.14, 0.17, 0.25, 0.12, 0xd8a648),
      ];
    case "zombie":
      return [
        P(0.18, 0.72, 0.22, -0.19, 0.36, 0, 0x2f5d3a), // bacaklar
        P(0.18, 0.72, 0.22, 0.19, 0.36, 0, 0x2f5d3a),
        P(0.68, 0.72, 0.4, 0, 1.08, 0, 0x3f8f4a),      // gövde
        P(0.2, 0.66, 0.22, -0.45, 1.08, 0, 0x7fae63),  // kollar
        P(0.2, 0.66, 0.22, 0.45, 1.08, 0, 0x7fae63),
        P(0.6, 0.55, 0.55, 0, 1.72, 0, 0x6fa05a),      // kafa
        P(0.28, 0.1, 0.1, -0.13, 1.72, 0.29, 0x3a2f2f),
        P(0.28, 0.1, 0.1, 0.13, 1.72, 0.29, 0x3a2f2f),
      ];
    case "skeleton":
      return [
        P(0.16, 0.74, 0.2, -0.18, 0.37, 0, 0xe8e8e8),
        P(0.16, 0.74, 0.2, 0.18, 0.37, 0, 0xe8e8e8),
        P(0.62, 0.74, 0.36, 0, 1.1, 0, 0xcfcfcf),
        P(0.2, 0.68, 0.2, -0.41, 1.1, 0, 0xe0e0e0),
        P(0.2, 0.68, 0.2, 0.41, 1.1, 0, 0xe0e0e0),
        P(0.58, 0.56, 0.54, 0, 1.76, 0, 0xd6d6d6),
        P(0.5, 0.12, 0.06, 0, 1.82, 0.3, 0x222222),
      ];
  }
}

const geoCache = new Map<MobKind, THREE.BufferGeometry>();
const matCache = new Map<MobKind, THREE.MeshLambertMaterial>();
function disposeKind(kind: MobKind) {
  geoCache.get(kind)?.dispose();
  geoCache.delete(kind);
  const m = matCache.get(kind);
  if (m) { m.dispose(); matCache.delete(kind); }
}

function geometryOf(kind: MobKind): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (g) return g;
  const parts = partsOf(kind);
  const geos: THREE.BufferGeometry[] = [];
  for (const [w, h, l, ox, oy, oz, col] of parts) {
    const bg = new THREE.BoxGeometry(w, h, l);
    bg.translate(ox, oy, oz);
    const n = bg.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const r = ((col >> 16) & 255) / 255, gg = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
    for (let i = 0; i < n; i++) { arr[i * 3] = r; arr[i * 3 + 1] = gg; arr[i * 3 + 2] = b; }
    bg.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    geos.push(bg);
  }
  const merged = mergeGeometries(geos, false);
  for (const geo of geos) geo.dispose();
  const finalGeo = merged ?? new THREE.BoxGeometry(1, 1, 1);
  geoCache.set(kind, finalGeo);
  return finalGeo;
}
function materialOf(kind: MobKind): THREE.MeshLambertMaterial {
  let m = matCache.get(kind);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    matCache.set(kind, m);
  }
  return m;
}

/* ---------------- canlı sistemi ---------------- */
export class Mobs {
  group = new THREE.Group();
  list: Mob[] = [];
  private ctx: MobCtx;
  private upkeepT = 0;
  private maxPassive = 12;
  private maxHostile = 4;

  constructor(ctx: MobCtx) {
    this.ctx = ctx;
  }

  spawn(kind: MobKind, x: number, z: number): boolean {
    const y = this.ctx.groundY(x, z);
    if (y < 1) return false;
    const def = DEFS[kind];
    const mesh = new THREE.Mesh(geometryOf(kind), materialOf(kind));
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.list.push({
      kind, mesh, x, y, z, vy: 0,
      hp: def.hp, yaw: rnd(0, Math.PI * 2),
      timer: rnd(1, 4), dirX: 0, dirZ: 0,
      atkCd: 0, burnT: 0, hurtT: 0, alive: true, def,
    });
    return true;
  }

  count(kind: MobKind): number {
    let n = 0;
    for (const m of this.list) if (m.alive && m.kind === kind) n++;
    return n;
  }

  private feetSolid(cx: number, fy: number, cz: number, w: number, h: number): boolean {
    const hw = w / 2;
    const x0 = Math.floor(cx - hw + 0.03), x1 = Math.floor(cx + hw - 0.03);
    const y0 = Math.floor(fy + 0.05), y1 = Math.floor(fy + h - 0.02);
    const z0 = Math.floor(cz - hw + 0.03), z1 = Math.floor(cz + hw - 0.03);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++)
          if (this.ctx.solidAt(bx, by, bz)) return true;
    return false;
  }

  private inWater(m: Mob): boolean {
    const b = this.ctx.getBlock(Math.floor(m.x), Math.floor(m.y + m.def.h * 0.5), Math.floor(m.z));
    return this.ctx.isLiquidId(b);
  }

  private canSee(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): boolean {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return true;
    const steps = Math.ceil(dist / 0.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.floor(x1 + dx * t), y = Math.floor(y1 + dy * t), z = Math.floor(z1 + dz * t);
      const b = this.ctx.getBlock(x, y, z);
      if (b !== 0 && !this.ctx.isLiquidId(b)) return false;
    }
    return true;
  }

  private killMob(m: Mob) {
    if (!m.alive) return;
    m.alive = false;
    this.group.remove(m.mesh);
    this.ctx.sfx("die");
    for (const [id, min, max] of m.def.drop) {
      const n = rint(min, max);
      if (n > 0 && this.ctx.addDrop(id, n)) {
        // envanter doldu — motor toast'u gösterir
      }
    }
    this.ctx.particles(m.x, m.y + m.def.h * 0.5, m.z, m.kind === "zombie" ? 0x3f8f4a : m.kind === "skeleton" ? 0xcfcfcf : 0xffffff);
  }

  damage(m: Mob, amount: number): boolean {
    if (!m.alive) return false;
    m.hp -= amount;
    m.hurtT = 0.18;
    this.ctx.sfx("hit");
    if (m.hp <= 0) { this.killMob(m); return true; }
    return false;
  }

  /** Oyuncunun sol tık menzilinde canlı var mı? Varsa vurur. */
  tryPlayerHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, dmg: number): boolean {
    let best: Mob | null = null;
    let bestT = range;
    for (const m of this.list) {
      if (!m.alive) continue;
      const cx = m.x, cy = m.y + m.def.h * 0.5, cz = m.z;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz;
      const t = vx * dx + vy * dy + vz * dz;
      if (t < 0 || t > bestT) continue;
      const px = vx - dx * t, py = vy - dy * t, pz = vz - dz * t;
      const perp = Math.hypot(px, py, pz);
      const rad = m.def.w * 0.6;
      if (perp < rad) { best = m; bestT = t; }
    }
    if (!best) return false;
    // vuruş yolu üstünde blok varsa (arkasında canlı) engelle
    if (!this.canSee(ox, oy, oz, best.x, best.y + best.def.h * 0.5, best.z)) return false;
    const m = best;
    if (this.damage(m, dmg)) return true;
    // küçük geri tepme
    const k = 2.2;
    m.dirX = dx * k; m.dirZ = dz * k;
    m.timer = 0.4;
    return true;
  }

  private moveMob(m: Mob, mvx: number, mvz: number, dt: number) {
    const w = m.def.w, h = m.def.h;
    if (this.inWater(m)) {
      m.vy += 10 * dt;
      if (m.vy > 1.4) m.vy = 1.4;
      mvx *= 0.6; mvz *= 0.6;
    } else {
      m.vy -= 24 * dt;
      if (m.vy < -40) m.vy = -40;
    }
    let blockedH = false;
    if (mvx !== 0) {
      const nx = m.x + mvx * dt;
      if (!this.feetSolid(nx, m.y, m.z, w, h)) m.x = nx;
      else { blockedH = true; m.dirX = -m.dirX; }
    }
    if (mvz !== 0) {
      const nz = m.z + mvz * dt;
      if (!this.feetSolid(m.x, m.y, nz, w, h)) m.z = nz;
      else { blockedH = true; m.dirZ = -m.dirZ; }
    }
    m.x = Math.max(1.5, Math.min(126.5, m.x));
    m.z = Math.max(1.5, Math.min(126.5, m.z));

    // dikey
    const ny = m.y + m.vy * dt;
    if (!this.feetSolid(m.x, ny, m.z, w, h)) {
      m.y = ny;
    } else if (m.vy <= 0) {
      m.y = Math.floor(ny) + 1;
      m.vy = 0;
    } else {
      m.vy = 0;
    }
    // engele takılıp karada kaldıysa zıpla (düşmanlar/çiftlik hayvanları merdiven çıksın)
    if (blockedH && m.vy === 0 && Math.abs(m.vy) < 0.01 && Math.random() < dt * 1.6) m.vy = 5.2;
  }

  private updateMob(m: Mob, dt: number) {
    if (!m.alive) return;
    const ctx = this.ctx;
    const dl = ctx.sunLevel();
    const [px, py, pz] = ctx.playerPos();

    // yanma (gündüz düşmanlar)
    if (m.def.hostile && dl > 0.25) {
      m.burnT += dt;
      if (m.burnT > 0.5) {
        m.burnT = 0;
        m.hp -= 2;
        ctx.particles(m.x, m.y + m.def.h, m.z, 0xff8800);
        if (m.hp <= 0) { this.killMob(m); return; }
      }
    }
    // hasar kızarıklığı süresi
    if (m.hurtT > 0) m.hurtT -= dt;

    let mvx = 0, mvz = 0;
    m.timer -= dt;
    const d2p = Math.hypot(px - m.x, pz - m.z);

    if (m.def.hostile) {
      const night = dl < 0.08;
      if (night && d2p < 16 && this.canSee(m.x, m.y + m.def.h * 0.7, m.z, px, py + 1, pz)) {
        // kovala
        const dist = Math.max(0.01, d2p);
        mvx = ((px - m.x) / dist) * m.def.chase;
        mvz = ((pz - m.z) / dist) * m.def.chase;
        m.yaw = Math.atan2(mvx, mvz);
        m.timer = Math.max(m.timer, 0.2);
      } else if (m.timer <= 0) {
        m.timer = rnd(1.5, 4);
        const a = rnd(0, Math.PI * 2);
        m.dirX = Math.cos(a); m.dirZ = Math.sin(a);
      }
      mvx = mvx || (m.dirX * m.def.speed);
      mvz = mvz || (m.dirZ * m.def.speed);
      // saldırı
      m.atkCd -= dt;
      if (m.atkCd <= 0 && d2p < 1.6 && Math.abs(py - m.y) < 2) {
        m.atkCd = 1.15;
        ctx.damagePlayer(m.def.dmg, m.kind === "zombie" ? "🧟 Zombi saldırısı!" : "💀 İskelet saldırısı!");
        ctx.sfx("hit");
      }
    } else {
      if (m.timer <= 0) {
        m.timer = rnd(1.5, 4.5);
        const a = rnd(0, Math.PI * 2);
        m.dirX = Math.cos(a); m.dirZ = Math.sin(a);
      }
      // oyuncu çok yaklaşırsa kaç (tavuk/domuz)
      if (d2p < 3.2 && (m.kind === "chicken" || m.kind === "pig")) {
        const dist = Math.max(0.01, d2p);
        m.dirX = ((m.x - px) / dist) * 1.5;
        m.dirZ = ((m.z - pz) / dist) * 1.5;
      }
      mvx = m.dirX * m.def.speed;
      mvz = m.dirZ * m.def.speed;
      m.yaw = Math.atan2(m.dirX, m.dirZ);
    }

    // zıplama (tavuklar hoplar)
    if (m.kind === "chicken" && Math.random() < dt * 1.4) m.vy = Math.max(m.vy, 3.4);

    this.moveMob(m, mvx, mvz, dt);
    m.mesh.position.set(m.x, m.y, m.z);
    m.mesh.rotation.y = m.yaw;
    if (m.hurtT > 0) m.mesh.visible = Math.floor(m.hurtT * 30) % 2 === 0;
    else m.mesh.visible = true;
  }

  /** Her kare çağrılır: canlıları güncelle + üremeyi yönet */
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      if (!m.alive) { this.list.splice(i, 1); continue; }
      this.updateMob(m, dt);
    }
    this.upkeepT -= dt;
    if (this.upkeepT > 0) return;
    this.upkeepT = 3;

    const [px, , pz] = this.ctx.playerPos();
    const dl = this.ctx.sunLevel();
    // pasif üretimi
    let passive = 0;
    for (const k of ["sheep", "cow", "pig", "chicken"] as MobKind[]) passive += this.count(k);
    if (passive < this.maxPassive) {
      const kinds: MobKind[] = ["sheep", "cow", "pig", "chicken"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      for (let tries = 0; tries < 5; tries++) {
        const a = rnd(0, Math.PI * 2);
        const r = rnd(16, 46);
        const x = Math.round(px + Math.cos(a) * r);
        const z = Math.round(pz + Math.sin(a) * r);
        if (x < 2 || x > 125 || z < 2 || z > 125) continue;
        if (this.spawn(kind, x, z)) break;
      }
    }
    // düşman üretimi (sadece gece)
    if (dl < 0.05) {
      let hostile = 0;
      for (const k of ["zombie", "skeleton"] as MobKind[]) hostile += this.count(k);
      if (hostile < this.maxHostile) {
        const kind: MobKind = Math.random() < 0.55 ? "zombie" : "skeleton";
        for (let tries = 0; tries < 5; tries++) {
          const a = rnd(0, Math.PI * 2);
          const r = rnd(12, 30);
          const x = Math.round(px + Math.cos(a) * r);
          const z = Math.round(pz + Math.sin(a) * r);
          if (x < 2 || x > 125 || z < 2 || z > 125) continue;
          if (this.spawn(kind, x, z)) break;
        }
      }
    }
  }

  /** Grup içindeki mesafeyi döner (üretim yakınlık kontrolü için). */
  nearPlayerCount(radius: number): number {
    const [px, , pz] = this.ctx.playerPos();
    let n = 0;
    for (const m of this.list) {
      if (m.alive && Math.hypot(m.x - px, m.z - pz) < radius) n++;
    }
    return n;
  }

  clear() {
    for (const m of this.list) {
      this.group.remove(m.mesh);
    }
    this.list = [];
    geoCache.forEach((_, kind) => disposeKind(kind));
    this.group.clear();
  }
}
