/* =====================================================================
   NEON RIVALS — particle / glow / ring / lightning effect pools
   ===================================================================== */
import * as THREE from "three";
import { G } from "./state";

let glowTex: THREE.Texture | null = null;

export function makeGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export const FX = {
  parts: null as THREE.Points | null,
  pGeo: null as THREE.BufferGeometry | null,
  pPos: null as Float32Array | null,
  pCol: null as Float32Array | null,
  pVel: null as Float32Array | null,
  pLife: null as Float32Array | null,
  pMax: null as Float32Array | null,
  cursor: 0,
  N: 800,
  sprites: [] as { s: THREE.Sprite; life: number; max: number; base: number; grow: number }[],
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
      new THREE.PointsMaterial({
        size: 0.11,
        map: makeGlowTexture(),
        transparent: true,
        opacity: 0.9,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.parts.frustumCulled = false;
    G.scene?.add(this.parts);
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
        G.scene?.remove(s.s);
        this.sprites.splice(i, 1);
        continue;
      }
      const k = s.life / s.max;
      (s.s.material as THREE.SpriteMaterial).opacity = k;
      const sc = 1 + (1 - k) * s.grow;
      s.s.scale.set(s.base * sc, s.base * sc, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        G.scene?.remove(r.r);
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
        G.scene?.remove(b.l);
        b.geo.dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      (b.l.material as THREE.LineBasicMaterial).opacity = b.life / b.max;
    }
  },

  glow(x: number, y: number, z: number, color: number, base: number, life: number, grow = 2) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    s.scale.set(base, base, 1);
    s.position.set(x, y, z);
    G.scene?.add(s);
    this.sprites.push({ s, life, max: life, base, grow });
  },

  ring(x: number, z: number, color: number, base: number, life: number, grow = 3) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 26),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    r.rotation.x = -Math.PI / 2;
    r.scale.set(base, base, base);
    r.position.set(x, 0.08, z);
    G.scene?.add(r);
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
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    G.scene?.add(l);
    this.bolts.push({ l, life, max: life, geo });
  },
};
