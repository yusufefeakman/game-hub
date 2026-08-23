/* =====================================================================
   NEON RIVALS — fighter mesh builder, pose system and per-fighter update
   ===================================================================== */
import * as THREE from "three";
import { buildHumanoid, type HumanoidPalette } from "../../lib/visuals";
import { G, ARENA_HALF, GRAVITY, clamp } from "./state";
import { Input } from "./input";
import { AudioSys } from "./audio";
import * as Combat from "./combat";
import { aiUpdate } from "./ai";
import type { FighterCfg, FighterState, Parts } from "./types";

/* ---------------- mesh builder (shared realistic humanoid) ---------------- */

function gearFor(cfg: FighterCfg) {
  return (headG: THREE.Group, _hip: THREE.Group, mats: THREE.Material[], _pal: HumanoidPalette) => {
    const mk = (color: number, rough = 0.8) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
      mats.push(m);
      return m;
    };
    if (cfg.id === "kairo") {
      // glowing visor band
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.05, 0.16), new THREE.MeshBasicMaterial({ color: 0x9deeff }));
      visor.position.set(0, 0.16, 0.05);
      headG.add(visor);
      const finR = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.12, 5), mk(cfg.colors.secondary));
      finR.position.set(0.13, 0.2, -0.02);
      finR.rotation.z = -0.5;
      headG.add(finR);
      const finL = finR.clone();
      finL.position.x = -0.13;
      finL.rotation.z = 0.5;
      headG.add(finL);
    } else if (cfg.id === "vexa") {
      // ponytail + side spikes
      const pony = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.26, 7), mk(cfg.colors.secondary));
      pony.position.set(0, 0.18, -0.12);
      pony.rotation.x = -0.55;
      headG.add(pony);
      const spikeR = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.1, 5), mk(cfg.colors.accent));
      spikeR.position.set(0.1, 0.21, 0);
      spikeR.rotation.z = -0.6;
      headG.add(spikeR);
      const spikeL = spikeR.clone();
      spikeL.position.x = -0.1;
      spikeL.rotation.z = 0.6;
      headG.add(spikeL);
    } else if (cfg.id === "rokan") {
      // heavy dome helmet + dark visor
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), mk(cfg.colors.accent, 0.5));
      helm.scale.set(1.02, 0.82, 1.04);
      helm.position.set(0, 0.14, 0);
      headG.add(helm);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.06), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      visor.position.set(0, 0.15, 0.115);
      visor.rotation.x = -0.15;
      headG.add(visor);
    } else {
      // nyra: tiara spikes + back crest
      for (const sx of [-1, 0, 1]) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.11, 5), mk(cfg.colors.trim, 0.6));
        spike.position.set(sx * 0.055, 0.215 + Math.abs(sx) * 0.02, 0);
        headG.add(spike);
      }
      const crest = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.24, 6), mk(cfg.colors.accent, 0.5));
      crest.position.set(0, 0.16, -0.13);
      crest.rotation.x = -0.6;
      headG.add(crest);
    }
  };
}

export function buildFighter(cfg: FighterCfg): { root: THREE.Group; parts: Parts; mats: THREE.MeshStandardMaterial[] } {
  const built = buildHumanoid(cfg.colors, {
    scale: cfg.id === "rokan" ? 1.08 : 1,
    gear: gearFor(cfg),
  });
  return {
    root: built.root,
    parts: built.parts as unknown as Parts,
    mats: built.mats as unknown as THREE.MeshStandardMaterial[],
  };
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
    f.mats.forEach((m) => {
      const std = m as THREE.MeshStandardMaterial;
      if (std.emissive) std.emissive.setRGB(0.55 * k, 0.3 * k, 0.08 * k);
    });
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
