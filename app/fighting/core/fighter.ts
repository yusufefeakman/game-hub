/* =====================================================================
   NEON RIVALS — fighter mesh builder, pose system and per-fighter update
   ===================================================================== */
import * as THREE from "three";
import { G, ARENA_HALF, GRAVITY, clamp } from "./state";
import { Input } from "./input";
import { AudioSys } from "./audio";
import * as Combat from "./combat";
import { aiUpdate } from "./ai";
import type { FighterCfg, FighterState, Limbs, Parts } from "./types";

/* ---------------- mesh builder ---------------- */
function buildLimbs(
  parent: THREE.Object3D,
  upLen: number,
  upW: number,
  lowLen: number,
  lowW: number,
  tipSize: number,
  mat: THREE.Material,
  pos: [number, number, number]
): Limbs {
  const up = new THREE.Group();
  up.position.set(pos[0], pos[1], pos[2]);
  const upMesh = new THREE.Mesh(new THREE.BoxGeometry(upW, upLen, upW * 0.85), mat);
  upMesh.position.y = -upLen / 2;
  up.add(upMesh);
  const low = new THREE.Group();
  low.position.y = -upLen;
  const lowMesh = new THREE.Mesh(new THREE.BoxGeometry(lowW, lowLen, lowW * 0.85), mat);
  lowMesh.position.y = -lowLen / 2;
  low.add(lowMesh);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(tipSize, tipSize * 0.8, tipSize), mat);
  tip.position.y = -lowLen - tipSize * 0.4;
  low.add(tip);
  up.add(low);
  parent.add(up);
  return { up, low, tip };
}

export function buildFighter(cfg: FighterCfg): { root: THREE.Group; parts: Parts; mats: THREE.MeshStandardMaterial[] } {
  const root = new THREE.Group();
  const face = new THREE.Group();
  root.add(face);

  const mats: THREE.MeshStandardMaterial[] = [];
  const mat = (color: number, rough = 0.85, metal = 0.08) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    mats.push(m);
    return m;
  };

  if (cfg.id === "rokan") face.scale.setScalar(1.08);
  const primary = mat(cfg.colors.primary);
  const secondary = mat(cfg.colors.secondary);
  const skin = mat(cfg.colors.skin);
  const trim = mat(cfg.colors.trim, 0.6, 0.5);
  const accent = mat(cfg.colors.accent, 0.7, 0.2);

  const hip = new THREE.Group();
  hip.position.y = 0.96;
  face.add(hip);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.54, 0.28), primary);
  torso.position.y = 0.3;
  hip.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.3), secondary);
  chest.position.y = 0.52;
  hip.add(chest);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.3), trim);
  belt.position.y = 0.08;
  hip.add(belt);

  // head
  const headG = new THREE.Group();
  headG.position.y = 0.62;
  hip.add(headG);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.28, 0.27), skin);
  head.position.y = 0.16;
  headG.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: cfg.colors.accent });
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.02), eyeMat);
  eye.position.set(0.135, 0.19, 0.07);
  head.add(eye);
  const eye2 = eye.clone();
  eye2.position.x = -0.135;
  head.add(eye2);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.07, 0.29), trim);
  band.position.y = 0.24;
  headG.add(band);

  // unique headgear per fighter
  if (cfg.id === "kairo") {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.06, 0.31), new THREE.MeshBasicMaterial({ color: 0x9deeff }));
    visor.position.y = 0.3;
    headG.add(visor);
  } else if (cfg.id === "vexa") {
    const pony = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 5), secondary);
    pony.position.set(-0.14, 0.3, 0);
    pony.rotation.z = 0.4;
    headG.add(pony);
    const padR = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 4), accent);
    padR.position.set(0.34, 0.46, 0);
    padR.rotation.z = -0.6;
    hip.add(padR);
  } else if (cfg.id === "rokan") {
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), accent);
    helm.position.y = 0.3;
    headG.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
    visor.position.set(0, 0.25, 0.15);
    headG.add(visor);
    const bigPadR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.3), accent);
    bigPadR.position.set(0.36, 0.44, 0);
    hip.add(bigPadR);
    const bigPadL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.3), accent);
    bigPadL.position.set(-0.36, 0.44, 0);
    hip.add(bigPadL);
  } else {
    // nyra: tiara + back crest
    for (const s of [-1, 1]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), trim);
      spike.position.set(s * 0.11, 0.34, 0);
      headG.add(spike);
    }
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 5), accent);
    crest.position.set(0, 0.36, -0.1);
    crest.rotation.x = 0.3;
    headG.add(crest);
  }

  const armR = buildLimbs(hip, 0.34, 0.15, 0.32, 0.13, 0.14, skin, [0.3, 0.44, 0]);
  const armL = buildLimbs(hip, 0.34, 0.15, 0.32, 0.13, 0.14, skin, [-0.3, 0.44, 0]);
  const legR = buildLimbs(hip, 0.46, 0.17, 0.46, 0.15, 0.17, secondary, [0.14, 0, 0]);
  const legL = buildLimbs(hip, 0.46, 0.17, 0.46, 0.15, 0.17, secondary, [-0.14, 0, 0]);
  armR.tip.material = trim as THREE.MeshStandardMaterial;
  armL.tip.material = trim as THREE.MeshStandardMaterial;
  legR.tip.material = trim as THREE.MeshStandardMaterial;
  legL.tip.material = trim as THREE.MeshStandardMaterial;

  const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.02), new THREE.MeshBasicMaterial({ color: cfg.colors.accent }));
  emblem.position.set(0, 0.34, 0.145);
  hip.add(emblem);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);
  (root.userData as { shadow?: THREE.Mesh }).shadow = shadow;

  const parts: Parts = { face, hip, torso, headG, armR, armL, legR, legL };
  return { root, parts, mats };
}

export function disposeFighter(f: FighterState) {
  f.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  f.mats.forEach((m) => m.dispose());
  G.scene?.remove(f.root);
}

export function makeFighter(cfg: FighterCfg, idx: number, isAI: boolean, isDummy = false): FighterState {
  const built = buildFighter(cfg);
  const f: FighterState = {
    cfg,
    idx,
    isAI,
    isDummy,
    root: built.root,
    parts: built.parts,
    mats: built.mats,
    walkDir: 0,
    x: idx === 0 ? -2.2 : 2.2,
    y: 0,
    vy: 0,
    facing: idx === 0 ? 1 : -1,
    hp: 100,
    stamina: 100,
    wins: 0,
    state: "idle",
    attack: null,
    hitstunT: 0,
    stunT: 0,
    koT: 0,
    airborne: false,
    walkT: 0,
    flashT: 0,
    idleT: Math.random() * 10,
    combo: 0,
    comboT: 0,
    specialFired: false,
    armor: false,
    cooldowns: {},
    ai: isAI ? { t: 0.6, plan: "idle" } : null,
  };
  f.parts.face.rotation.y = f.facing > 0 ? 0 : Math.PI;
  G.scene?.add(f.root);
  return f;
}

/* ---------------- pose system ---------------- */
function setR(g: THREE.Object3D, axis: "x" | "y" | "z", v: number) {
  g.rotation[axis] = v;
}
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

function poseSpecial(f: FighterState, t: number) {
  const p = f.parts;
  const kind = f.attack?.special?.kind ?? "bolt";
  if (kind === "dash") {
    setR(p.torso, "z", -0.35);
    setR(p.torso, "x", 0.25);
    setR(p.armR.up, "z", 0.5);
    setR(p.armL.up, "z", 0.5);
    setR(p.armR.up, "x", -1.1);
    setR(p.armL.up, "x", -1.1);
    setR(p.armR.low, "z", 0.4);
    setR(p.armL.low, "z", 0.4);
    setR(p.legR.up, "z", 0.5);
    setR(p.legR.low, "z", 0.7);
    setR(p.legL.up, "z", 0.4);
    setR(p.legL.low, "z", 0.6);
  } else if (kind === "bolt" || kind === "orb") {
    const e = easeOut(Math.min(1, t / 0.45));
    setR(p.armR.up, "z", 0.5 + e * 1.15);
    setR(p.armR.low, "z", 0.5 - e * 0.55);
    setR(p.armL.up, "z", 0.5 + e * 0.7);
    setR(p.armL.low, "z", 0.5 - e * 0.3);
    setR(p.torso, "z", -0.2 * e);
    setR(p.legR.up, "z", 0.25);
    setR(p.legL.up, "z", -0.25);
  } else if (kind === "slam") {
    const up = Math.min(1, t / 0.42);
    const down = t > 0.42 ? Math.min(1, (t - 0.42) / 0.3) : 0;
    const upE = easeOut(up);
    setR(p.armR.up, "z", 0.5 + upE * 2.35);
    setR(p.armL.up, "z", 0.5 + upE * 2.35);
    setR(p.armR.low, "z", 0.5 - upE * 0.4);
    setR(p.armL.low, "z", 0.5 - upE * 0.4);
    setR(p.torso, "z", -0.15 * upE + 0.3 * down);
    setR(p.torso, "x", 0.25 * down);
    setR(p.legR.up, "z", 0.35);
    setR(p.legL.up, "z", -0.35);
    setR(p.legR.low, "z", 0.5);
    setR(p.legL.low, "z", 0.5);
  } else if (kind === "charge") {
    setR(p.torso, "z", -0.3);
    setR(p.torso, "x", 0.35);
    setR(p.armR.up, "z", -0.2);
    setR(p.armL.up, "z", -0.2);
    setR(p.armR.up, "x", -1.3);
    setR(p.armL.up, "x", -1.3);
    setR(p.armR.low, "z", 0.5);
    setR(p.armL.low, "z", 0.5);
    setR(p.legR.up, "z", 0.6);
    setR(p.legR.low, "z", 0.9);
    setR(p.legL.up, "z", 0.55);
    setR(p.legL.low, "z", 0.8);
  } else if (kind === "flurry") {
    const w = Math.sin(f.attack!.t * 26);
    setR(p.armR.up, "z", 0.5 + Math.max(0, w) * 1.0);
    setR(p.armL.up, "z", 0.5 + Math.max(0, -w) * 1.0);
    setR(p.armR.low, "z", 0.4 - Math.max(0, w) * 0.2);
    setR(p.armL.low, "z", 0.4 - Math.max(0, -w) * 0.2);
    setR(p.torso, "z", -w * 0.15);
    setR(p.legR.up, "z", 0.3);
    setR(p.legL.up, "z", -0.3);
  } else if (kind === "blast") {
    const e = easeOut(Math.min(1, t / 0.4));
    setR(p.torso, "z", 0.25);
    setR(p.torso, "x", -0.15);
    setR(p.armR.up, "z", 1.25);
    setR(p.armL.up, "z", 1.25);
    setR(p.armR.up, "x", 0.25);
    setR(p.armL.up, "x", 0.25);
    setR(p.armR.low, "z", -0.15 * e);
    setR(p.armL.low, "z", -0.15 * e);
    setR(p.legR.up, "z", 0.25);
    setR(p.legL.up, "z", -0.25);
  }
}

export function poseFighter(f: FighterState, dt: number, time: number) {
  const p = f.parts;
  let torsoRx = 0, torsoRz = 0, torsoRy = 0, headRz = 0;
  let armRz = 0.42, armRelbow = 0.45, armRx = 0.16;
  let armLz = 0.42, armLelbow = 0.45, armLx = 0.16;
  let legRz = 0.06, legRknee = 0, legLz = -0.06, legLknee = 0;

  const s = f.state;
  if (s === "idle" || s === "walk") {
    const bob = Math.sin(time * 2.4 + f.idleT) * 0.03;
    torsoRz = -bob;
    armRz = 0.5;
    armRelbow = 0.55;
    armLz = 0.5;
    armLelbow = 0.55;
    if (s === "walk") {
      const sw = Math.sin(f.walkT * 9);
      legRz = sw * 0.42;
      legLz = -sw * 0.42;
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
    }
  } else if (s === "crouch") {
    torsoRz = 0.3; headRz = 0.12;
    legRz = 0.75; legRknee = 1.05; legLz = 0.75; legLknee = 1.05;
    armRz = 0.7; armRelbow = 0.5; armLz = 0.7; armLelbow = 0.5;
    armRx = 0.35; armLx = 0.35;
  } else if (s === "block") {
    armRz = 1.05; armRelbow = 0.8; armRx = 0.4;
    armLz = 1.05; armLelbow = 0.8; armLx = 0.4;
    torsoRz = 0.16; headRz = 0.1;
    legRz = 0.22; legLz = -0.22;
  } else if (s === "hitstun") {
    torsoRz = 0.38; headRz = 0.28;
    armRz = -0.55 + Math.sin(time * 26) * 0.12; armRelbow = 0.4;
    armLz = 0.95 + Math.sin(time * 22 + 1) * 0.15; armLelbow = 0.5;
    legRz = 0.15; legLz = -0.1;
  } else if (s === "stunned") {
    torsoRz = 0.5; headRz = 0.35;
    armRz = -0.9; armLz = 0.9;
    legRz = 0.2; legLz = -0.2;
    armRelbow = 0.5; armLelbow = 0.5;
  } else if (s === "ko") {
    armRz = 0.25; armRelbow = 0.5; armLz = 0.2; armLelbow = 0.45;
    legRz = 0.15; legLz = -0.1;
  } else if (s === "attack" && f.attack) {
    const a = f.attack;
    const t = Math.min(1, a.t / a.dur);
    if (a.kind === "light") {
      const ch = a.chain % 3;
      const side = ch === 1 ? -1 : 1;
      let e = 0;
      if (t < 0.32) e = t / 0.32;
      else if (t < 0.68) e = 1;
      else e = 1 - (t - 0.68) / 0.32;
      e = easeOut(e);
      if (side > 0) {
        armRz = 0.5 + e * 1.12;
        armRelbow = 0.35 - e * 0.2;
      } else {
        armLz = 0.5 + e * 1.12;
        armLelbow = 0.35 - e * 0.2;
      }
      torsoRz = -0.14 * e * side;
      torsoRy = 0.22 * e * side;
      if (ch === 2) torsoRz = -0.3 * e; // third hit leans in harder
    } else if (a.kind === "heavy") {
      let e = 0;
      if (t < 0.3) e = t / 0.3;
      else if (t < 0.62) e = 1;
      else e = 1 - (t - 0.62) / 0.38;
      e = easeOut(e);
      armRz = 0.4 + e * 1.5;
      armRelbow = 0.5 - e * 0.35;
      armLz = 0.5;
      torsoRz = -0.35 * e;
      torsoRx = 0.2 * e;
      legRz = 0.4;
      legLz = -0.4;
    } else if (a.kind === "air") {
      const ext = Math.max(0, Math.min(1, (t - 0.12) / 0.22));
      legRz = 0.7 + ext * 0.9;
      legRknee = 1.2 - ext * 1.1;
      legLz = 0.45; legLknee = 0.85;
      torsoRz = -0.2 * ext;
      armLz = 0.9 - 0.4 * ext;
      armRz = 0.35; armRx = 0.25;
    } else if (a.kind === "low") {
      let e = 0;
      if (t < 0.3) e = t / 0.3;
      else if (t < 0.66) e = 1;
      else e = 1 - (t - 0.66) / 0.34;
      e = easeOut(e);
      torsoRz = 0.3;
      legRz = 0.75; legRknee = 1.05; legLz = 0.75; legLknee = 1.05;
      armRz = 0.9 + e * 0.8;
      armRelbow = 0.4 - e * 0.2;
    } else if (a.kind === "special") {
      poseSpecial(f, t);
      return;
    }
  }

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
  void dt;
}

/* ---------------- fighter update ---------------- */
export function updateFighter(f: FighterState, opp: FighterState, dt: number, rdt: number) {
  const p = f.parts;
  f.idleT += rdt;
  for (const k in f.cooldowns) {
    if (f.cooldowns[k] > 0) f.cooldowns[k] -= dt;
  }
  if (f.flashT > 0) {
    f.flashT -= rdt;
    const k = Math.max(0, f.flashT / 0.16);
    f.mats.forEach((m) => m.emissive.setRGB(0.55 * k, 0.3 * k, 0.08 * k));
  }
  if (f.comboT > 0) f.comboT -= rdt;

  if (f.state === "ko") {
    f.koT += rdt;
    const target = f.facing * 1.62;
    f.root.rotation.z += (target - f.root.rotation.z) * Math.min(1, rdt * 6);
    f.root.position.set(f.x, f.y, 0);
    poseFighter(f, rdt, f.idleT);
    return;
  }

  // ---- inputs ----
  f.walkDir = 0;
  let crouchHeld = false;
  let blockHeld = false;
  if (!f.isAI && !f.isDummy) {
    if (Input.held(f.idx, "left")) f.walkDir -= 1;
    if (Input.held(f.idx, "right")) f.walkDir += 1;
    crouchHeld = Input.held(f.idx, "crouch");
    blockHeld = Input.held(f.idx, "block");
    if (!f.airborne && f.state !== "hitstun" && f.state !== "stunned") {
      if (Input.edge(f.idx, "jump")) Combat.doJump(f);
    }
  } else if (f.isAI) {
    aiUpdate(f, opp, dt);
    blockHeld = f.ai!.plan === "block";
    crouchHeld = f.ai!.plan === "crouch";
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
        f.hitstunT = Math.max(f.hitstunT, 0.28);
        AudioSys.land();
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

  if (f.state === "stunned") {
    f.stunT -= dt;
    if (f.stunT <= 0) f.state = "idle";
    f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
    f.root.position.set(f.x, f.y, 0);
    poseFighter(f, rdt, f.idleT);
    return;
  }

  if (f.state === "attack" && f.attack) {
    f.attack.t += dt;
    Combat.updateAttack(f, opp, dt);
    const cur = f.attack;
    if (cur && cur.t >= cur.dur) {
      f.state = "idle";
      f.attack = null;
      f.specialFired = false;
      f.armor = false;
    }
    f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
    f.root.position.set(f.x, f.y, 0);
    poseFighter(f, rdt, f.idleT);
    return;
  }

  if (f.airborne) {
    f.vy -= GRAVITY * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      f.airborne = false;
      f.state = "idle";
      AudioSys.land();
    } else {
      f.state = "jump";
    }
    if (!f.isAI && !f.isDummy && Input.edge(f.idx, "light")) {
      Combat.startAir(f, opp);
    }
    f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
    f.root.position.set(f.x, f.y, 0);
    poseFighter(f, rdt, f.idleT);
    return;
  }

  // ---- grounded ----
  const dx = opp.x - f.x;
  if (dx !== 0) f.facing = dx > 0 ? 1 : -1;
  p.face.rotation.y = f.facing > 0 ? 0 : Math.PI;

  if (blockHeld && !crouchHeld) {
    f.state = "block";
    f.walkDir *= 0.4;
    Combat.drainBlockStamina(f, dt);
  } else if (crouchHeld) {
    f.state = "crouch";
    f.walkDir *= 0.3;
  }

  if (!f.isAI && !f.isDummy) {
    if (Input.edge(f.idx, "light")) Combat.startLight(f, opp);
    else if (Input.edge(f.idx, "heavy")) Combat.startHeavy(f, opp);
    else if (Input.edge(f.idx, "special")) Combat.startSpecial(f, opp);
  }

  if (f.state !== "attack") {
    const spd = f.cfg.stats.speed;
    if (f.walkDir !== 0 && f.state !== "block" && f.state !== "crouch") {
      f.x += f.walkDir * spd * dt;
      f.walkT += dt * Math.abs(f.walkDir);
      f.state = "walk";
    } else if (f.state !== "block" && f.state !== "crouch") {
      f.state = "idle";
    }
    f.x = clamp(f.x, -ARENA_HALF, ARENA_HALF);
  }

  f.root.position.set(f.x, f.y, 0);
  poseFighter(f, rdt, f.idleT);
}
