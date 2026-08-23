/* =====================================================================
   NEON RIVALS — CPU opponent with EASY / NORMAL / HARD difficulty.
   The training dummy has no AI at all (never acts).
   ===================================================================== */
import { G } from "./state";
import * as Combat from "./combat";
import type { FighterState, SpecialDef } from "./types";

interface Diff {
  react: [number, number];
  block: number;
  special: number;
  aggression: number;
  retreat: number;
}

const DIFF: Record<"easy" | "normal" | "hard", Diff> = {
  easy: { react: [0.4, 0.7], block: 0.22, special: 0.08, aggression: 0.45, retreat: 0.35 },
  normal: { react: [0.22, 0.45], block: 0.4, special: 0.18, aggression: 0.7, retreat: 0.2 },
  hard: { react: [0.1, 0.26], block: 0.55, special: 0.3, aggression: 0.92, retreat: 0.1 },
};

function pickSpecial(f: FighterState): SpecialDef | undefined {
  const usable = f.cfg.specials.filter((sd) => Combat.specialReady(f, sd));
  if (!usable.length) return undefined;
  return usable[Math.floor(Math.random() * usable.length)];
}

function aiThink(f: FighterState, opp: FighterState, d: Diff) {
  const ai = f.ai!;
  const dx = opp.x - f.x;
  const adx = Math.abs(dx);
  const r = Math.random();
  ai.plan = "idle";

  const oppAttacking = opp.state === "attack";
  if (oppAttacking && adx < 2.1) {
    if (r < d.block) ai.plan = "block";
    else if (opp.attack?.height === "high" && Math.random() < 0.5) ai.plan = "crouch";
    else if (Math.random() < 0.5) ai.plan = "retreat";
  } else if (adx > 1.6) {
    if (r < 0.12) ai.plan = "jump";
    else ai.plan = "approach";
  } else if (adx < 1.15) {
    if (pickSpecial(f) && r < d.special) ai.plan = "special";
    else if (r < 0.45 * d.aggression) ai.plan = "light";
    else if (r < 0.72 * d.aggression) ai.plan = "heavy";
    else if (r < 0.82) ai.plan = "block";
    else ai.plan = "jump";
  } else {
    if (pickSpecial(f) && r < d.special) ai.plan = "special";
    else if (r < 0.4) ai.plan = "approach";
    else if (r < 0.62) ai.plan = "heavy";
    else ai.plan = "block";
  }
  if (f.hp < 25 && Math.random() < d.retreat) ai.plan = "retreat";
  ai.t = d.react[0] + Math.random() * (d.react[1] - d.react[0]);
}

export function aiUpdate(f: FighterState, opp: FighterState, dt: number) {
  const ai = f.ai!;
  const d = DIFF[G.difficulty];
  if (f.state === "idle" || f.state === "walk" || f.state === "block" || f.state === "crouch") {
    ai.t -= dt;
    if (ai.t <= 0) aiThink(f, opp, d);
  }
  if (f.state === "idle" || f.state === "walk") {
    switch (ai.plan) {
      case "approach":
        f.walkDir = Math.sign(opp.x - f.x);
        break;
      case "retreat":
        f.walkDir = -Math.sign(opp.x - f.x);
        break;
      case "block":
      case "crouch":
        f.walkDir = 0;
        break;
      case "jump":
        f.walkDir = 0;
        if (Math.random() < 0.06) {
          Combat.doJump(f);
          ai.plan = "idle";
          ai.t = 0.3;
        }
        break;
      case "light":
        f.walkDir = 0;
        Combat.startLight(f, opp);
        ai.plan = "idle";
        ai.t = 0.3 + Math.random() * 0.3;
        break;
      case "heavy":
        f.walkDir = 0;
        Combat.startHeavy(f, opp);
        ai.plan = "idle";
        ai.t = 0.42 + Math.random() * 0.3;
        break;
      case "special":
        f.walkDir = 0;
        Combat.startSpecial(f, opp, pickSpecial(f));
        ai.plan = "idle";
        ai.t = 0.6;
        break;
      default:
        f.walkDir = 0;
    }
  }
}
