/* =====================================================================
   NEON RIVALS — combat core: attacks, specials, hit resolution,
   stamina, combos, projectiles and ground waves.
   ===================================================================== */
import * as THREE from "three";
import { G, ARENA_HALF, JUMP_VEL, GRAVITY, clamp } from "./state";
import { AudioSys } from "./audio";
import { FX, makeGlowTexture } from "./effects";
import { spawnDamageNumber } from "./hud";
import { Input } from "./input";
import type { AttackHeight, AttackState, FighterState, SpecialDef } from "./types";

/* ---------------- attack definitions ---------------- */
interface AtkDef {
  dur: number;
  active: [number, number];
  reach: number;
  dmg: number;
  knock: number;
  stun: number;
  launch: boolean;
  height: AttackHeight;
  stamina: number;
}

const LIGHT: AtkDef = { dur: 0.34, active: [0.09, 0.2], reach: 1.0, dmg: 6, knock: 0.45, stun: 0.32, launch: false, height: "mid", stamina: 4 };
const HEAVY: AtkDef = { dur: 0.52, active: [0.17, 0.31], reach: 1.3, dmg: 12, knock: 0.95, stun: 0.5, launch: true, height: "high", stamina: 8 };
const AIR: AtkDef = { dur: 0.48, active: [0.12, 0.28], reach: 1.25, dmg: 7, knock: 0.6, stun: 0.4, launch: false, height: "mid", stamina: 4 };
const LOW: AtkDef = { dur: 0.32, active: [0.08, 0.18], reach: 0.95, dmg: 5, knock: 0.4, stun: 0.28, launch: false, height: "low", stamina: 3 };

function specialDur(kind: string): number {
  switch (kind) {
    case "dash": return 0.5;
    case "bolt": return 0.55;
    case "orb": return 0.62;
    case "slam": return 0.85;
    case "charge": return 0.72;
    case "flurry": return 0.75;
    case "blast": return 0.6;
  }
  return 0.6;
}

/* ---------------- jump ---------------- */
export function doJump(f: FighterState) {
  if (!f.airborne && f.state !== "hitstun" && f.state !== "stunned" && f.state !== "ko" && f.state !== "attack") {
    f.vy = JUMP_VEL;
    f.airborne = true;
    f.state = "jump";
    AudioSys.jump();
  }
}

/* ---------------- attack startup ---------------- */
function faceOpp(f: FighterState, opp: FighterState) {
  const dx = opp.x - f.x;
  if (dx !== 0) f.facing = dx > 0 ? 1 : -1;
  f.parts.face.rotation.y = f.facing > 0 ? 0 : Math.PI;
}

export function startLight(f: FighterState, opp: FighterState): boolean {
  if (f.attack || f.state === "hitstun" || f.state === "stunned" || f.state === "ko") return false;
  const low = f.state === "crouch";
  const def = low ? LOW : LIGHT;
  if (f.stamina < def.stamina) return false;
  f.stamina -= def.stamina;
  f.state = "attack";
  f.attack = { kind: low ? "low" : "light", t: 0, dur: def.dur, active: false, hitDone: false, special: null, chain: 0, height: def.height };
  faceOpp(f, opp);
  AudioSys.whoosh(0.2);
  return true;
}

export function startHeavy(f: FighterState, opp: FighterState): boolean {
  if (f.attack || f.state === "hitstun" || f.state === "stunned" || f.state === "ko") return false;
  if (f.stamina < HEAVY.stamina) return false;
  f.stamina -= HEAVY.stamina;
  f.state = "attack";
  f.attack = { kind: "heavy", t: 0, dur: HEAVY.dur, active: false, hitDone: false, special: null, chain: 0, height: "high" };
  faceOpp(f, opp);
  AudioSys.whoosh(0.26);
  return true;
}

export function startAir(f: FighterState, opp: FighterState): boolean {
  if (f.attack || f.state === "hitstun" || f.state === "stunned" || f.state === "ko") return false;
  if (f.stamina < AIR.stamina) return false;
  f.stamina -= AIR.stamina;
  f.state = "attack";
  f.attack = { kind: "air", t: 0, dur: AIR.dur, active: false, hitDone: false, special: null, chain: 0, height: "mid" };
  faceOpp(f, opp);
  AudioSys.whoosh(0.2);
  return true;
}

export function specialReady(f: FighterState, sd: SpecialDef): boolean {
  return f.stamina >= sd.cost && (f.cooldowns[sd.id] ?? 0) <= 0;
}

/** Player path: standing = specials[0], crouching (S held) = specials[1]. AI passes sd explicitly. */
export function startSpecial(f: FighterState, opp: FighterState, sd?: SpecialDef): boolean {
  if (f.attack || f.state === "hitstun" || f.state === "stunned" || f.state === "ko") return false;
  const chosen = sd ?? (f.isAI || f.isDummy ? undefined : f.cfg.specials[0]);
  if (!chosen) return false;
  if (!specialReady(f, chosen)) return false;
  f.cooldowns[chosen.id] = chosen.cooldown;
  f.stamina -= chosen.cost;
  f.state = "attack";
  f.attack = { kind: "special", t: 0, dur: specialDur(chosen.kind), active: false, hitDone: false, special: chosen, chain: 0, height: "mid" };
  faceOpp(f, opp);
  if (chosen.kind === "dash") AudioSys.dash();
  else if (chosen.kind === "bolt") AudioSys.bolt();
  else if (chosen.kind === "orb") AudioSys.orb();
  else if (chosen.kind === "slam") AudioSys.slam();
  else if (chosen.kind === "charge") AudioSys.charge();
  else if (chosen.kind === "blast") AudioSys.blast();
  else AudioSys.whoosh(0.3);
  return true;
}

/* ---------------- block / stamina ---------------- */
export function drainBlockStamina(f: FighterState, dt: number) {
  f.stamina -= 13 * dt;
  if (f.stamina <= 0) {
    f.stamina = 0;
    guardBreak(f);
  }
}

function guardBreak(f: FighterState) {
  f.state = "stunned";
  f.stunT = 0.9;
  G.guardBreakFlash = 1;
  G.shakeT = Math.max(G.shakeT, 0.4);
  G.shakeMag = Math.max(G.shakeMag, 0.18);
  G.banner = { main: "GUARD BREAK!", sub: "", t: 1.1, dur: 1.1 };
  AudioSys.guardBreak();
}

export function regenStamina(f: FighterState, dt: number) {
  if (f.state === "block" || f.state === "attack" || f.state === "stunned") return;
  f.stamina = Math.min(100, f.stamina + 17 * dt);
}

/* ---------------- hit resolution ---------------- */
export function hitResolve(
  att: FighterState,
  def: FighterState,
  dmg: number,
  knock: number,
  stun: number,
  launch: boolean,
  blockable: boolean,
  height: AttackHeight,
  heavy: boolean
) {
  const dir = att.facing;
  const blocked = def.state === "block" && blockable && !def.airborne;
  const dmgMult = 1 / (0.5 + def.cfg.stats.defense * 0.5);
  const comboMult = Math.max(0.35, 1 - 0.15 * Math.max(0, att.combo - 1));
  let dmgFinal = Math.round(dmg * dmgMult * comboMult);

  // armor (Rokan's Heavy Charge) shrugs off regular hits
  if (def.armor && !blocked) {
    def.hp = Math.max(1, def.hp - Math.max(1, Math.round(dmgFinal * 0.35)));
    def.flashT = 0.12;
    FX.burst(def.x - dir * 0.3, 1.2, 0, 0xffcc66, 8, 4, 0.3);
    AudioSys.hit(false);
    return;
  }

  if (blocked) {
    dmgFinal = Math.max(1, Math.round(dmgFinal * 0.12));
    def.hp = Math.max(1, def.hp - dmgFinal);
    def.stamina = Math.max(0, def.stamina - 8);
    att.stamina = Math.max(0, att.stamina - 2);
    def.x = clamp(def.x + dir * 0.75, -ARENA_HALF, ARENA_HALF);
    att.x = clamp(att.x - dir * 0.1, -ARENA_HALF, ARENA_HALF);
    FX.burst(def.x + dir * 0.3, 1.2, 0, 0x9fd8ff, 10, 3.4, 0.3);
    FX.glow(def.x + dir * 0.3, 1.2, 0, 0x9fd8ff, 0.35, 0.2);
    G.shakeT = Math.max(G.shakeT, 0.12);
    G.shakeMag = Math.max(G.shakeMag, 0.05);
    AudioSys.block();
    spawnDamageNumber(def.x, def.y + 1.7, String(dmgFinal), "#8fd8ff");
    if (def.stamina <= 0) guardBreak(def);
    return;
  }

  const wasStunned = def.state === "hitstun" || def.airborne;
  att.combo = wasStunned ? att.combo + 1 : 1;
  att.comboT = 1.3;
  if (att.combo === 2 || att.combo === 5 || att.combo === 8 || att.combo === 12) {
    G.comboMilestone = att.combo;
    AudioSys.combo(att.combo);
  }

  def.hp -= dmgFinal;
  def.flashT = 0.16;
  def.x = clamp(def.x + dir * knock, -ARENA_HALF, ARENA_HALF);
  att.x = clamp(att.x - dir * 0.12, -ARENA_HALF, ARENA_HALF);
  spawnDamageNumber(def.x, def.y + 1.7, String(dmgFinal), "#ffddaa");
  FX.burst(def.x + dir * 0.2, 1.2, 0, heavy ? 0xffcc66 : 0xffe0a0, heavy ? 18 : 11, heavy ? 6 : 4.2, 0.4, 2);
  FX.glow(def.x + dir * 0.2, 1.2, 0, heavy ? 0xffaa44 : 0xffddaa, 0.4, 0.22);
  G.hitstop = Math.max(G.hitstop, heavy ? 0.06 : 0.04);
  G.shakeT = Math.max(G.shakeT, heavy ? 0.32 : 0.18);
  G.shakeMag = Math.max(G.shakeMag, heavy ? 0.14 : 0.08);
  AudioSys.hit(heavy);

  if (def.hp <= 0) {
    ko(def, att);
    return;
  }
  def.hitstunT = stun;
  def.state = "hitstun";
  def.attack = null;
  def.armor = false;
  if (launch && !def.airborne) {
    def.airborne = true;
    def.vy = 6.2;
  }
}

function ko(def: FighterState, att: FighterState) {
  def.hp = 0;
  def.state = "ko";
  def.koT = 0;
  def.airborne = false;
  def.y = 0;
  def.vy = 0;
  def.attack = null;
  def.hitstunT = 0;
  def.armor = false;
  G.hitstop = Math.max(G.hitstop, 0.08);
  G.slowmoT = 0.9;
  G.timeScale = 0.3;
  G.koT = 1.7;
  G.roundOver = true;
  G.banner = { main: "K.O.!", sub: "", t: 1.3, dur: 1.3 };
  FX.burst(def.x, 1.3, 0, 0xffe0a0, 26, 6, 0.7, 3);
  FX.burst(def.x, 1.0, 0, 0xff5533, 20, 4.5, 0.6, 2);
  FX.ring(def.x, 0, 0xff8844, 1, 0.5, 4);
  G.shakeT = Math.max(G.shakeT, 0.55);
  G.shakeMag = Math.max(G.shakeMag, 0.28);
  G.camZoom = Math.max(G.camZoom, 1.1);
  AudioSys.ko();
  void att;
}

/* ---------------- attack / special update ---------------- */
export function updateAttack(f: FighterState, opp: FighterState, dt: number) {
  const a = f.attack!;
  const dir = f.facing;

  if (a.kind === "special" && a.special) {
    updateSpecial(f, opp, dt, a, dir);
    return;
  }

  const def = a.kind === "light" ? LIGHT : a.kind === "heavy" ? HEAVY : a.kind === "air" ? AIR : LOW;
  if (!a.active && a.t >= def.active[0]) a.active = true;
  if (a.active && !a.hitDone && a.t <= def.active[1]) {
    const dx = Math.abs(opp.x - f.x);
    const inReach = dx <= def.reach + 0.52;
    const vertOk = a.kind === "air" ? true : !opp.airborne;
    const heightOk = !(opp.state === "crouch" && def.height === "high");
    if (inReach && vertOk && heightOk && opp.state !== "ko") {
      a.hitDone = true;
      hitResolve(f, opp, def.dmg * f.cfg.stats.power, def.knock, def.stun, def.launch, true, def.height, a.kind === "heavy");
    }
  }

  // light -> light -> light chain + light -> heavy launcher (human players only)
  if (a.kind === "light" && a.hitDone && !f.isAI && !f.isDummy && a.t > 0.18 && a.t < 0.44) {
    if (Input.edge(f.idx, "light") && a.chain < 2 && f.stamina >= 2) {
      f.attack = { kind: "light", t: 0, dur: 0.3, active: false, hitDone: false, special: null, chain: a.chain + 1, height: "mid" };
      f.stamina -= 2;
      AudioSys.whoosh(0.2);
      return;
    }
    if (Input.edge(f.idx, "heavy") && a.chain >= 1 && f.stamina >= HEAVY.stamina) {
      f.attack = { kind: "heavy", t: 0, dur: HEAVY.dur, active: false, hitDone: false, special: null, chain: 0, height: "high" };
      f.stamina -= HEAVY.stamina;
      AudioSys.whoosh(0.26);
      return;
    }
  }
}

function updateSpecial(f: FighterState, opp: FighterState, dt: number, a: AttackState, dir: 1 | -1) {
  const sd = a.special!;
  const dmg = sd.dmg * f.cfg.stats.power;

  if (sd.kind === "dash") {
    if (a.t >= 0.12 && a.t <= 0.4) {
      f.x += dir * 13.5 * dt;
      if (!a.hitDone && Math.abs(opp.x - f.x) < 0.85) {
        a.hitDone = true;
        FX.lightning(f.x + dir * 0.4, 1.3, 0, opp.x, 1.1, 0, f.cfg.colors.accent);
        FX.glow((f.x + opp.x) / 2, 1.2, 0, f.cfg.colors.accent, 0.8, 0.3);
        AudioSys.zap();
        hitResolve(f, opp, dmg, 1.35, 0.62, false, true, "mid", true);
      } else if (a.t > 0.2 && Math.random() < 0.35) {
        FX.glow(f.x + dir * 0.3, 1.0 + Math.random() * 0.5, 0, f.cfg.colors.accent, 0.2, 0.12);
      }
    }
  } else if (sd.kind === "bolt" || sd.kind === "orb") {
    if (!f.specialFired && a.t >= (sd.kind === "bolt" ? 0.32 : 0.42)) {
      f.specialFired = true;
      spawnProjectile(f, dir, sd.kind, dmg);
    }
  } else if (sd.kind === "slam") {
    if (!f.specialFired && a.t >= 0.42) {
      f.specialFired = true;
      G.waves.push({ x: f.x + dir * 0.8, vx: dir * 8, dmg, owner: f, age: 0, dead: false });
      FX.ring(f.x, 0, 0xffaa44, 1.2, 0.5, 3);
      FX.burst(f.x, 0.3, 0, 0xffcc88, 18, 5, 0.5, 4);
      G.shakeT = Math.max(G.shakeT, 0.5);
      G.shakeMag = Math.max(G.shakeMag, 0.22);
      AudioSys.slam();
    }
  } else if (sd.kind === "charge") {
    if (a.t >= 0.15 && a.t <= 0.5) {
      f.armor = true;
      f.x += dir * 10 * dt;
      if (!a.hitDone && Math.abs(opp.x - f.x) < 0.9) {
        a.hitDone = true;
        FX.burst(f.x + dir * 0.5, 1.0, 0, 0xffcc77, 16, 6, 0.5, 2);
        AudioSys.chargeHit();
        hitResolve(f, opp, dmg, 1.5, 0.65, true, true, "mid", true);
      }
      if (Math.random() < 0.3) FX.glow(f.x + dir * 0.2, 1.2, 0, 0xffaa44, 0.25, 0.12);
    }
  } else if (sd.kind === "flurry") {
    const waves = [0.14, 0.3, 0.46, 0.62];
    if (a.chain < 4 && a.t >= waves[a.chain]) {
      if (Math.abs(opp.x - f.x) <= 1.15 + 0.52 && opp.state !== "ko") {
        FX.glow(f.x + dir * 0.5, 1.15, 0, f.cfg.colors.accent, 0.3, 0.15);
        AudioSys.flurryHit();
        hitResolve(f, opp, dmg, 0.12, 0.2, false, true, "mid", false);
      }
      a.chain++;
    }
  } else if (sd.kind === "blast") {
    if (!f.specialFired && a.t >= 0.4) {
      f.specialFired = true;
      const inRange = Math.abs(opp.x - f.x) < 2.9;
      const ducked = opp.state === "crouch";
      FX.lightning(f.x + dir * 0.6, 1.1, 0, f.x + dir * 3.2, 1.0, 0, f.cfg.colors.accent, 0.3);
      FX.glow(f.x + dir * 1.6, 1.1, 0, f.cfg.colors.accent, 1.3, 0.4, 2);
      G.shakeT = Math.max(G.shakeT, 0.45);
      G.shakeMag = Math.max(G.shakeMag, 0.2);
      G.hitstop = Math.max(G.hitstop, 0.06);
      AudioSys.blast();
      if (inRange && !opp.airborne && !ducked && opp.state !== "ko") {
        hitResolve(f, opp, dmg, 1.2, 0.7, false, true, "mid", true);
      }
    }
  }
}

function spawnProjectile(f: FighterState, dir: 1 | -1, kind: "bolt" | "orb", dmg: number) {
  const size = kind === "bolt" ? 0.18 : 0.34;
  const y = 1.0;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, kind === "bolt" ? 10 : 14, kind === "bolt" ? 8 : 12),
    new THREE.MeshBasicMaterial({ color: f.cfg.colors.accent })
  );
  mesh.position.set(f.x + dir * 0.7, y, 0);
  G.scene!.add(mesh);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: f.cfg.colors.accent,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.scale.set(size * 5, size * 5, 1);
  glow.position.copy(mesh.position);
  G.scene!.add(glow);
  G.projectiles.push({ mesh, glow, x: mesh.position.x, y, vx: dir * (kind === "bolt" ? 15 : 8), dmg, owner: f, trailT: 0, dead: false, kind });
}

/* ---------------- projectiles / waves ---------------- */
export function updateProjectiles(dt: number) {
  for (const pr of G.projectiles) {
    if (pr.dead) continue;
    pr.x += pr.vx * dt;
    pr.mesh.position.x = pr.x;
    pr.glow.position.x = pr.x;
    pr.trailT -= dt;
    if (pr.trailT <= 0) {
      pr.trailT = 0.04;
      FX.glow(pr.x - Math.sign(pr.vx) * 0.3, pr.y, 0, pr.owner.cfg.colors.accent, 0.22, 0.25);
    }
    const opp = pr.owner.idx === 0 ? G.fighters[1] : G.fighters[0];
    const grounded = !opp.airborne;
    const ducked = opp.state === "crouch";
    const jumpLow = opp.airborne && opp.y < 1.25;
    if (opp.state !== "ko" && Math.abs(opp.x - pr.x) < 0.55 && (grounded && !ducked ? true : jumpLow)) {
      pr.dead = true;
      FX.burst(pr.x, pr.y, 0, pr.owner.cfg.colors.accent, 16, 5, 0.5, 2);
      FX.glow(pr.x, pr.y, 0, pr.owner.cfg.colors.accent, 0.7, 0.3);
      AudioSys.orbHit();
      hitResolve(pr.owner, opp, pr.dmg, 0.9, 0.6, false, true, "mid", true);
    }
    if (Math.abs(pr.x) > ARENA_HALF + 1.5) pr.dead = true;
  }
  G.projectiles = G.projectiles.filter((p) => {
    if (p.dead) {
      G.scene?.remove(p.mesh);
      G.scene?.remove(p.glow);
      p.mesh.geometry.dispose();
    }
    return !p.dead;
  });
  for (const pr of G.projectiles) {
    pr.mesh.rotation.y += dt * 10;
  }
}

export function updateWaves(dt: number) {
  for (const w of G.waves) {
    if (w.dead) continue;
    w.age += dt;
    w.x += w.vx * dt;
    FX.ring(w.x, 0, 0xffaa55, 0.5 + w.age * 1.2, 0.3, 2.5);
    const opp = w.owner.idx === 0 ? G.fighters[1] : G.fighters[0];
    if (opp.state !== "ko" && !opp.airborne && Math.abs(opp.x - w.x) < 0.62) {
      w.dead = true;
      FX.burst(w.x, 0.8, 0, 0xffcc77, 18, 6, 0.5, 3);
      AudioSys.waveHit();
      hitResolve(w.owner, opp, w.dmg, 1.05, 0.68, true, false, "low", true);
    }
    if (Math.abs(w.x) > ARENA_HALF + 1) w.dead = true;
  }
  G.waves = G.waves.filter((w) => !w.dead);
}
