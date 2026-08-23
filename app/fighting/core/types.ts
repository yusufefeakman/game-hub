/* =====================================================================
   NEON RIVALS — shared types (no runtime imports, types only)
   ===================================================================== */
import type { Group, Mesh, MeshStandardMaterial, Sprite } from "three";

export type SpecialKind = "dash" | "bolt" | "orb" | "slam" | "charge" | "flurry" | "blast";
export type FighterStateName =
  | "idle"
  | "walk"
  | "jump"
  | "crouch"
  | "block"
  | "attack"
  | "hitstun"
  | "stunned"
  | "ko";
export type GameStateName = "menu" | "select" | "intro" | "fight" | "roundEnd" | "matchEnd" | "paused";
export type AttackKind = "light" | "heavy" | "air" | "low" | "special";
export type AttackHeight = "high" | "mid" | "low";
export type Difficulty = "easy" | "normal" | "hard";
export type ArenaId = "neon" | "temple" | "cyber";

export interface SpecialDef {
  id: string;
  name: string;
  kind: SpecialKind;
  cost: number;
  cooldown: number;
  dmg: number;
  desc: string;
}

export interface FighterCfg {
  id: string;
  name: string;
  title: string;
  desc: string;
  colors: { primary: number; secondary: number; skin: number; trim: number; accent: number };
  stats: { speed: number; power: number; defense: number; reach: number };
  specials: [SpecialDef, SpecialDef];
}

export interface Limbs {
  up: Group;
  low: Group;
  tip: Mesh;
}

export interface Parts {
  face: Group;
  hip: Group;
  torso: Mesh;
  headG: Group;
  armR: Limbs;
  armL: Limbs;
  legR: Limbs;
  legL: Limbs;
}

export interface AttackState {
  kind: AttackKind;
  t: number;
  dur: number;
  active: boolean;
  hitDone: boolean;
  special: SpecialDef | null;
  chain: number;
  height: AttackHeight;
}

export interface AiState {
  t: number;
  plan: string;
}

export interface FighterState {
  cfg: FighterCfg;
  idx: number;
  isAI: boolean;
  isDummy: boolean;
  root: Group;
  parts: Parts;
  mats: MeshStandardMaterial[];
  walkDir: number;
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  stamina: number;
  wins: number;
  state: FighterStateName;
  attack: AttackState | null;
  hitstunT: number;
  stunT: number;
  koT: number;
  airborne: boolean;
  walkT: number;
  flashT: number;
  idleT: number;
  combo: number;
  comboT: number;
  specialFired: boolean;
  armor: boolean;
  cooldowns: Record<string, number>;
  ai: AiState | null;
}

export interface Projectile {
  mesh: Mesh;
  glow: Sprite;
  x: number;
  y: number;
  vx: number;
  dmg: number;
  owner: FighterState;
  trailT: number;
  dead: boolean;
  kind: "bolt" | "orb";
}

export interface Wave {
  x: number;
  vx: number;
  dmg: number;
  owner: FighterState;
  age: number;
  dead: boolean;
}

export interface Keybind {
  left: string;
  right: string;
  jump: string;
  crouch: string;
  light: string;
  heavy: string;
  special: string;
  block: string;
}
