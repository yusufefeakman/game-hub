/* =====================================================================
   NEON RIVALS — 3 original arenas: Neon City, Ancient Temple, Cyber Arena
   Each arena is a THREE.Group with its own backdrop, lighting and a
   per-frame update(dt) for animated ambience.
   ===================================================================== */
import * as THREE from "three";
import { G } from "./state";
import { makeGlowTexture } from "./effects";
import type { ArenaId } from "./types";

export interface Arena {
  group: THREE.Group;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

function noiseTexture(base: string, spots: string, w = 256, h = 256): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 800; i++) {
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

function makePoints(n: number, box: [number, number, number, number, number, number], color: number, size: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = box[0] + Math.random() * (box[1] - box[0]);
    pos[i * 3 + 1] = box[2] + Math.random() * (box[3] - box[2]);
    pos[i * 3 + 2] = box[4] + Math.random() * (box[5] - box[4]);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size,
      map: makeGlowTexture(),
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  p.frustumCulled = false;
  return p;
}

function platform(): THREE.Mesh {
  const stone = noiseTexture("#4a3f4d", "#372e3b");
  const mat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 });
  mat.map!.repeat.set(4, 2);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.6, 6.2), mat);
  plat.position.y = -0.3;
  return plat;
}

function edgeBar(x: number, z: number, w: number, color: number, y = 0.02): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.05, 0.06),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
  );
  m.position.set(x, y, z);
  return m;
}

/* ---------------- NEON CITY ---------------- */
function buildNeon(): Arena {
  const group = new THREE.Group();
  G.scene!.background = new THREE.Color(0x0a0a1e);
  G.scene!.fog = new THREE.Fog(0x120a2a, 12, 36);

  group.add(platform());
  group.add(edgeBar(0, 3.05, 16.2, 0x55d0ff));
  group.add(edgeBar(0, -3.05, 16.2, 0xff55c8));

  // city silhouettes with window strips
  const bldgMat = new THREE.MeshStandardMaterial({ color: 0x141428, roughness: 1 });
  const winMat = new THREE.MeshBasicMaterial({ color: 0x44ccff });
  for (let i = 0; i < 14; i++) {
    const bw = 1.6 + Math.random() * 2.2;
    const bh = 3 + Math.random() * 5;
    const bz = -7 - Math.random() * 3;
    const bx = -11 + i * 1.7 + Math.random() * 0.6;
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 2), bldgMat);
    b.position.set(bx, bh / 2 - 1, bz);
    group.add(b);
    for (let wy = 0; wy < 4; wy++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.8, 0.07, 0.05), winMat);
      strip.position.set(bx, 0.4 + wy * (bh / 4), bz + 1.01);
      group.add(strip);
    }
  }
  // neon signs
  const signTex = makeGlowTexture();
  const signs: [number, number, string][] = [
    [0xff44aa, 0xff44aa, "0x1"],
    [0x44ddff, 0x44ddff, "0x2"],
    [0xffcc33, 0xffcc33, "0x3"],
  ];
  signs.forEach(([c], i) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: signTex, color: c, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    s.scale.set(2.4, 0.8, 1);
    s.position.set(-6 + i * 6, 4.2, -6.5);
    group.add(s);
  });
  // rain
  const rain = makePoints(320, [-9, 9, -1, 8, -5, -2], 0x88bbff, 0.05);
  group.add(rain);
  const rainPos = (rain.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const rainLight = new THREE.PointLight(0x66aaff, 0.6, 20);
  rainLight.position.set(0, 5, 2);
  group.add(rainLight);

  const update = (dt: number) => {
    for (let i = 0; i < rainPos.length; i += 3) {
      rainPos[i + 1] -= 14 * dt;
      rainPos[i] += Math.sin(G.time * 2 + i) * 0.01;
      if (rainPos[i + 1] < -1) {
        rainPos[i + 1] = 8;
        rainPos[i] = -9 + Math.random() * 18;
      }
    }
    (rain.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };
  return { group, update, dispose: () => disposeGroup(group) };
}

/* ---------------- ANCIENT TEMPLE ---------------- */
function buildTemple(): Arena {
  const group = new THREE.Group();
  G.scene!.background = new THREE.Color(0x1a0d08);
  G.scene!.fog = new THREE.Fog(0x2a1408, 10, 30);

  group.add(platform());
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a5344, roughness: 1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 1 });

  // pillars
  for (const px of [-6.5, 6.5]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5, 0.9), stoneMat);
    pillar.position.set(px, 1.9, -2.5);
    group.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 1.3), darkMat);
    cap.position.set(px, 4.5, -2.5);
    group.add(cap);
  }
  // back wall (temple ruins)
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshStandardMaterial({ map: noiseTexture("#4a352a", "#2e1f18"), roughness: 1 }));
  (wall.material as THREE.MeshStandardMaterial).map!.repeat.set(3, 2);
  wall.position.set(0, 4, -7);
  group.add(wall);
  // torches
  const torchLights: THREE.PointLight[] = [];
  const flames: THREE.Mesh[] = [];
  for (const tx of [-5.5, 5.5]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.35), darkMat);
    pole.position.set(tx, 1, -1.8);
    group.add(pole);
    const bowl = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.35, 6), darkMat);
    bowl.position.set(tx, 2.4, -1.8);
    group.add(bowl);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.65, 6), new THREE.MeshBasicMaterial({ color: 0xffa030 }));
    flame.position.set(tx, 2.85, -1.8);
    group.add(flame);
    flames.push(flame);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xff8822, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.scale.set(1.1, 1.6, 1);
    fl.position.set(tx, 2.85, -1.8);
    group.add(fl);
    const light = new THREE.PointLight(0xff9933, 1.1, 14);
    light.position.set(tx, 3, -1.8);
    group.add(light);
    torchLights.push(light);
  }
  // drifting mist
  const mist = makePoints(120, [-8, 8, 0.1, 1.4, -3, 1], 0xccaa88, 0.16);
  group.add(mist);
  const mistPos = (mist.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;

  const update = (dt: number, time: number) => {
    torchLights.forEach((l, i) => {
      l.intensity = 0.9 + Math.sin(time * 11 + i * 2.4) * 0.22 + Math.random() * 0.15;
    });
    flames.forEach((fl, i) => {
      fl.scale.set(1 + Math.sin(time * 13 + i * 3) * 0.15, 1 + Math.cos(time * 9 + i * 2) * 0.18, 1);
    });
    for (let i = 0; i < mistPos.length; i += 3) {
      mistPos[i] += Math.sin(time * 0.5 + i) * 0.25 * dt;
      if (mistPos[i] > 9) mistPos[i] = -9;
    }
    (mist.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };
  return { group, update, dispose: () => disposeGroup(group) };
}

/* ---------------- CYBER ARENA ---------------- */
function buildCyber(): Arena {
  const group = new THREE.Group();
  G.scene!.background = new THREE.Color(0x050a14);
  G.scene!.fog = new THREE.Fog(0x071226, 12, 34);

  group.add(platform());
  group.add(edgeBar(0, 3.05, 16.2, 0x22ffcc));
  group.add(edgeBar(0, -3.05, 16.2, 0x8855ff));

  // hologram rings behind
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x22ffcc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(2.2 + i * 1.3, 0.05, 8, 40), ringMat.clone());
    r.position.set(-5 + i * 5, 2.6, -5.5);
    r.rotation.x = Math.PI / 2.4;
    group.add(r);
    rings.push(r);
  }
  // floating hologram panels
  const panelTex = makeGlowTexture();
  const panels: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: panelTex, color: i % 2 ? 0x8855ff : 0x22ffcc, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    p.scale.set(1.6, 0.9, 1);
    p.position.set(-7 + i * 4.7, 3.4 + Math.sin(i * 2) * 0.8, -6.5);
    group.add(p);
    panels.push(p);
  }
  // grid floor glow
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 12, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x0e2a3a, transparent: true, opacity: 0.6 })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(0, -0.58, -3);
  group.add(grid);
  // moving light beams
  const beams: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 6, 0.12),
      new THREE.MeshBasicMaterial({ color: i === 1 ? 0x8855ff : 0x22ffcc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    b.position.set(-6 + i * 6, 3, -5.8);
    group.add(b);
    beams.push(b);
  }
  const cyLight = new THREE.PointLight(0x22aaff, 0.7, 20);
  cyLight.position.set(0, 5, 3);
  group.add(cyLight);

  const update = (dt: number, time: number) => {
    rings.forEach((r, i) => {
      r.rotation.z += dt * (0.4 + i * 0.25);
      r.rotation.y += dt * 0.2;
    });
    panels.forEach((p, i) => {
      p.position.y = 3.2 + Math.sin(time * 1.2 + i * 1.7) * 0.9;
      (p.material as THREE.SpriteMaterial).opacity = 0.25 + Math.sin(time * 2 + i) * 0.15;
    });
    beams.forEach((b, i) => {
      b.position.x = -7 + Math.sin(time * 0.9 + i * 2.1) * 3;
      (b.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(time * 3 + i * 2) * 0.25;
    });
  };
  return { group, update, dispose: () => disposeGroup(group) };
}

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
    else if (m) m.dispose();
  });
  G.scene?.remove(group);
}

export function buildArena(kind: ArenaId): Arena {
  let arena: Arena;
  switch (kind) {
    case "neon":
      arena = buildNeon();
      break;
    case "temple":
      arena = buildTemple();
      break;
    default:
      arena = buildCyber();
  }
  G.scene?.add(arena.group);
  return arena;
}
