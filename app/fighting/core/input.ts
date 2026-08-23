/* =====================================================================
   NEON RIVALS — rebindable keyboard input
   Bindings live in G.settings.keys[playerIndex]. The SETTINGS screen can
   call Input.captureKey(callback) to grab the next physical key press.
   ===================================================================== */
import { G } from "./state";
import type { Keybind } from "./types";

export type KeyAction = keyof Keybind;

const BLOCKED_CODES = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
  "Enter",
  "Tab",
]);

export const Input = {
  keys: new Set<string>(),
  pressed: new Set<string>(),
  onPause: null as (() => void) | null,
  onMute: null as (() => void) | null,
  captureFn: null as ((code: string) => void) | null,

  init(onPause: () => void, onMute: () => void) {
    this.onPause = onPause;
    this.onMute = onMute;
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.clear);
  },
  cleanup() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.clear);
  },
  down(e: KeyboardEvent) {
    const c = e.code;
    if (BLOCKED_CODES.has(c)) e.preventDefault();
    if (c === "KeyM") Input.onMute?.();
    if (c === "Escape" || c === "KeyP") Input.onPause?.();
    if (Input.captureFn) {
      const fn = Input.captureFn;
      Input.captureFn = null;
      if (c !== "Escape") {
        e.preventDefault();
        fn(c);
      }
      return;
    }
    if (!Input.keys.has(c)) Input.pressed.add(c);
    Input.keys.add(c);
  },
  up(e: KeyboardEvent) {
    Input.keys.delete(e.code);
  },
  clear() {
    Input.keys.clear();
  },

  /** accept Numpad1 as Digit1 too (laptops without numpad) */
  matches(code: string, bind: string): boolean {
    if (code === bind) return true;
    if (bind.startsWith("Numpad")) {
      const digit = "Digit" + bind.slice(-1);
      if (code === digit) return true;
    }
    return false;
  },

  codeFor(player: number, action: KeyAction): string {
    return G.settings.keys[player][action];
  },

  held(player: number, action: KeyAction): boolean {
    const bind = this.codeFor(player, action);
    for (const c of this.keys) if (this.matches(c, bind)) return true;
    return false;
  },

  edge(player: number, action: KeyAction): boolean {
    const bind = this.codeFor(player, action);
    for (const c of this.pressed) {
      if (this.matches(c, bind)) {
        this.pressed.delete(c);
        return true;
      }
    }
    return false;
  },

  /** raw edge trigger for a specific physical code (menu keys) */
  consume(code: string): boolean {
    return this.pressed.delete(code);
  },

  captureKey(fn: (code: string) => void) {
    this.captureFn = fn;
  },
  endFrame() {
    this.pressed.clear();
  },
};
