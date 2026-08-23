/* =====================================================================
   NEON RIVALS — global state singleton + constants
   All modules import G from here (no circular imports).
   ===================================================================== */
import * as THREE from "three";
import type {
  ArenaId,
  Difficulty,
  FighterCfg,
  FighterState,
  GameStateName,
  Keybind,
  Projectile,
  Wave,
} from "./types";

export const ARENA_HALF = 7.6;
export const GRAVITY = 22;
export const JUMP_VEL = 7.6;
export const HP_MAX = 100;
export const STAMINA_MAX = 100;
export const ROUND_TIME = 60;
export const WINS_NEEDED = 2;

export const DEFAULT_KEYS: [Keybind, Keybind] = [
  {
    left: "KeyA",
    right: "KeyD",
    jump: "KeyW",
    crouch: "KeyS",
    light: "KeyJ",
    heavy: "KeyK",
    special: "KeyL",
    block: "KeyU",
  },
  {
    left: "ArrowLeft",
    right: "ArrowRight",
    jump: "ArrowUp",
    crouch: "ArrowDown",
    light: "Numpad1",
    heavy: "Numpad2",
    special: "Numpad3",
    block: "Numpad4",
  },
];

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const G = {
  state: "menu" as GameStateName,
  mode: "cpu" as "cpu" | "2p" | "training",
  difficulty: "normal" as Difficulty,
  arena: "random" as ArenaId | "random",
  arenaKind: "neon" as ArenaId,
  scene: null as THREE.Scene | null,
  camera: null as THREE.PerspectiveCamera | null,
  fighters: [] as FighterState[],
  round: 1,
  roundTime: ROUND_TIME,
  roundOver: false,
  roundEndT: 0,
  introT: 0,
  koT: 0,
  banner: { main: "", sub: "", t: 0, dur: 0 },
  projectiles: [] as Projectile[],
  waves: [] as Wave[],
  shakeT: 0,
  shakeMag: 0,
  camZoom: 0,
  timeScale: 1,
  slowmoT: 0,
  hitstop: 0,
  time: 0,
  muted: false,
  selectIdx: 0,
  p1Picked: false,
  aiPickT: 0,
  p1Cfg: null as FighterCfg | null,
  p2Cfg: null as FighterCfg | null,
  training: false,
  guardBreakFlash: 0,
  comboMilestone: 0,
  settings: {
    sound: true,
    difficulty: "normal" as Difficulty,
    keys: structuredClone(DEFAULT_KEYS),
  },
};
