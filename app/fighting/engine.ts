/* =====================================================================
   NEON RIVALS — game engine: scene, loop, state machine, camera.
   Route /game-hub/fighting. Modular logic lives in ./core/*.
   ===================================================================== */
import * as THREE from "three";
import { G, HP_MAX, ROUND_TIME, WINS_NEEDED, clamp } from "./core/state";
import { AudioSys } from "./core/audio";
import { Input } from "./core/input";
import { FX } from "./core/effects";
import { buildArena, type Arena } from "./core/arenas";
import { disposeFighter, makeFighter, updateFighter } from "./core/fighter";
import * as Combat from "./core/combat";
import { FIGHTERS } from "./core/characters";
import { HUD, hideScreens, showBanner, showHud, updateHud, initHud, loadSettings, showMenu, showSelect, showEnd, showPause, showSettings, updateSelectCursor, pickFighter, toggleSound } from "./core/hud";
import type { FighterCfg, GameStateName } from "./core/types";

let renderer: THREE.WebGLRenderer;
let canvasEl: HTMLCanvasElement | null = null;
let wrap: HTMLDivElement | null = null;
let arena: Arena | null = null;
let camZ = 9.6;
let raf = 0;
let lastTs = 0;
let pausePrev: GameStateName = "fight";

/* ---------------- arena ---------------- */
function resolveArena(): "neon" | "temple" | "cyber" {
  if (G.arena !== "random") return G.arena;
  const list: ("neon" | "temple" | "cyber")[] = ["neon", "temple", "cyber"];
  return list[Math.floor(Math.random() * list.length)];
}

function rebuildArena() {
  arena?.dispose();
  G.arenaKind = resolveArena();
  arena = buildArena(G.arenaKind);
}

/* ---------------- fighters / match flow ---------------- */
function spawnDemoFighters() {
  G.fighters.forEach(disposeFighter);
  G.fighters = [];
  const f0 = makeFighter(FIGHTERS[0], 0, false);
  const f1 = makeFighter(FIGHTERS[3], 1, false);
  G.fighters = [f0, f1];
}

function resetFighters() {
  G.fighters.forEach((f, i) => {
    f.x = i === 0 ? -2.2 : 2.2;
    f.y = 0;
    f.vy = 0;
    f.airborne = false;
    f.hp = HP_MAX;
    f.stamina = 100;
    f.state = "idle";
    f.attack = null;
    f.hitstunT = 0;
    f.stunT = 0;
    f.koT = 0;
    f.combo = 0;
    f.comboT = 0;
    f.armor = false;
    f.cooldowns = {};
    f.root.rotation.z = 0;
    f.root.position.set(f.x, 0, 0);
    f.facing = i === 0 ? 1 : -1;
    f.parts.face.rotation.y = f.facing > 0 ? 0 : Math.PI;
  });
  G.projectiles = [];
  G.waves = [];
  G.roundOver = false;
  G.roundTime = ROUND_TIME;
  G.koT = 0;
  G.timeScale = 1;
  G.slowmoT = 0;
  G.hitstop = 0;
  G.camZoom = 0;
  G.comboMilestone = 0;
}

function startRound(n: number) {
  G.round = n;
  resetFighters();
  G.state = "intro";
  G.introT = 2.0;
  showBanner("ROUND " + n, "READY...", 1.1);
  AudioSys.roundStart();
}

function startMatch(mode: "cpu" | "2p" | "training", p1Cfg: FighterCfg, p2Cfg: FighterCfg) {
  G.fighters.forEach(disposeFighter);
  G.fighters = [];
  G.mode = mode;
  G.training = mode === "training";
  rebuildArena();
  const f0 = makeFighter(p1Cfg, 0, false);
  const f1 = makeFighter(p2Cfg, 1, mode === "cpu", G.training);
  G.fighters = [f0, f1];
  hideScreens();
  showHud(true);
  if (G.training) {
    G.round = 1;
    resetFighters();
    G.state = "fight";
    G.roundOver = false;
    showBanner("TRAINING", "The dummy never attacks — test freely", 2.5);
    AudioSys.roundStart();
  } else {
    startRound(1);
  }
}

function endRound(winnerIdx: number, perfect: boolean) {
  G.roundOver = true;
  G.state = "roundEnd";
  G.roundEndT = winnerIdx >= 0 && G.fighters[winnerIdx].wins + 1 >= WINS_NEEDED ? 1.6 : 2.2;
  if (winnerIdx >= 0) {
    const w = G.fighters[winnerIdx];
    w.wins++;
    showBanner("ROUND WON", w.cfg.name + (perfect ? " — PERFECT!" : ""), 2.0);
    if (w.wins >= WINS_NEEDED) AudioSys.matchWin();
    else AudioSys.roundWin();
  } else {
    showBanner("DRAW", "ROUND REPLAYED", 2.0);
    AudioSys.roundWin();
  }
}

function toMenu() {
  G.state = "menu";
  G.fighters.forEach(disposeFighter);
  G.fighters = [];
  spawnDemoFighters();
  hideScreens();
  showHud(false);
  showMenu();
}

/* ---------------- select screen keyboard ---------------- */
function selectKeyboard() {
  if (!G.p1Picked) {
    if (Input.edge(0, "left")) {
      G.selectIdx = (G.selectIdx + 3) % FIGHTERS.length;
      AudioSys.uiMove();
    } else if (Input.edge(0, "right")) {
      G.selectIdx = (G.selectIdx + 1) % FIGHTERS.length;
      AudioSys.uiMove();
    } else if (Input.consume("Enter") || Input.consume("Space")) {
      AudioSys.uiSelect();
      pickFighter(G.selectIdx);
    }
    updateSelectCursor();
  } else if (G.mode === "2p") {
    for (let i = 0; i < FIGHTERS.length; i++) {
      if (Input.consume("Numpad" + (i + 1)) || Input.consume("Digit" + (i + 1))) {
        AudioSys.uiSelect();
        pickFighter(i);
        break;
      }
    }
  }
}

/* ---------------- update ---------------- */
function update(dt: number, rdt: number) {
  G.time += dt;
  arena?.update(dt, G.time);
  const idleStates = G.state === "menu" || G.state === "select" || G.state === "paused" || G.state === "matchEnd";

  if (G.state === "select") {
    selectKeyboard();
    if ((G.mode === "cpu" || G.mode === "training") && G.p1Picked && G.aiPickT > 0) {
      G.aiPickT -= rdt;
      if (G.aiPickT <= 0) {
        let aiIdx = Math.floor(Math.random() * FIGHTERS.length);
        if (FIGHTERS[aiIdx].id === G.p1Cfg!.id) aiIdx = (aiIdx + 1) % FIGHTERS.length;
        G.p2Cfg = FIGHTERS[aiIdx];
        document.getElementById("nr-card-" + aiIdx)?.classList.add("p2pick");
        startMatch(G.mode, G.p1Cfg!, G.p2Cfg!);
      }
    }
  }

  if (idleStates) {
    G.fighters.forEach((f, i) => {
      if (f) updateFighter(f, G.fighters[1 - i], dt, rdt);
    });
    updateHud(rdt);
    return;
  }

  if (G.state === "intro") {
    G.introT -= rdt;
    if (G.introT <= 1.0 && G.banner.main === "ROUND " + G.round) {
      showBanner("FIGHT!", "", 0.9);
      AudioSys.fight();
    }
    if (G.introT <= 0) G.state = "fight";
    G.fighters.forEach((f, i) => updateFighter(f, G.fighters[1 - i], dt, rdt));
    updateHud(rdt);
    return;
  }

  if (G.state === "roundEnd") {
    G.roundEndT -= rdt;
    G.fighters.forEach((f, i) => updateFighter(f, G.fighters[1 - i], dt, rdt));
    if (G.roundEndT <= 0) {
      const winner = G.fighters.find((f) => f.wins >= WINS_NEEDED);
      if (winner) {
        G.state = "matchEnd";
        showEnd(G.fighters.indexOf(winner));
      } else {
        startRound(G.round + 1);
      }
    }
    updateHud(rdt);
    return;
  }

  // ---- FIGHT / TRAINING ----
  if (G.training) {
    // dummy: regen hp, respawn after KO
    G.fighters.forEach((f) => {
      if (f.isDummy) {
        if (f.state === "ko") {
          if (f.koT > 1.4) {
            f.hp = HP_MAX;
            f.state = "idle";
            f.x = f.idx === 0 ? -2.2 : 2.2;
            f.y = 0;
            f.vy = 0;
            f.root.rotation.z = 0;
            f.root.position.set(f.x, 0, 0);
            G.roundOver = false;
            G.koT = 0;
            G.timeScale = 1;
          }
        } else if (f.hp > 0) {
          f.hp = Math.min(HP_MAX, f.hp + 6 * dt);
        }
      }
    });
  } else if (!G.roundOver) {
    G.roundTime -= dt;
    if (G.roundTime <= 0) {
      G.roundTime = 0;
      G.roundOver = true;
      const h0 = G.fighters[0].hp;
      const h1 = G.fighters[1].hp;
      showBanner("TIME UP", "", 1.2);
      if (h0 > h1) endRound(0, false);
      else if (h1 > h0) endRound(1, false);
      else endRound(-1, false);
    }
  } else if (G.koT > 0) {
    G.koT -= rdt;
    if (G.koT <= 0) {
      const ko0 = G.fighters[0].state === "ko";
      const ko1 = G.fighters[1].state === "ko";
      if (ko0 && ko1) endRound(-1, false);
      else if (ko0) endRound(1, G.fighters[1].hp === HP_MAX);
      else endRound(0, G.fighters[0].hp === HP_MAX);
    }
  }

  // hitstop / slow-mo (real time)
  if (G.hitstop > 0) {
    G.hitstop -= rdt;
    if (G.hitstop <= 0) G.timeScale = 1;
  }
  if (G.slowmoT > 0) {
    G.slowmoT -= rdt;
    if (G.slowmoT <= 0 && G.timeScale < 1) G.timeScale = 1;
  }

  G.fighters.forEach((f, i) => updateFighter(f, G.fighters[1 - i], dt, rdt));
  Combat.updateProjectiles(dt);
  Combat.updateWaves(dt);
  FX.update(dt);
  G.fighters.forEach((f) => {
    Combat.regenStamina(f, dt);
    if (f.comboT <= 0) f.combo = 0;
  });
  if (G.camZoom > 0) G.camZoom = Math.max(0, G.camZoom - rdt * 1.6);

  updateHud(rdt);
}

/* ---------------- camera ---------------- */
function updateCamera(rdt: number) {
  const f0 = G.fighters[0];
  const f1 = G.fighters[1];
  const cam = G.camera;
  if (!f0 || !f1 || !cam) return;
  const mid = (f0.x + f1.x) / 2;
  const dist = Math.abs(f0.x - f1.x);
  const targetZ = clamp(9.0 + dist * 0.28 - G.camZoom, 8.6, 11.6);
  camZ += (targetZ - camZ) * Math.min(1, rdt * 3);
  let sx = 0;
  let sy = 0;
  if (G.shakeT > 0) {
    G.shakeT -= rdt;
    const m = G.shakeMag * Math.max(0, G.shakeT / 0.4);
    sx = (Math.random() - 0.5) * 2 * m;
    sy = (Math.random() - 0.5) * 2 * m;
  }
  const follow = clamp(mid, -2.5, 2.5) * 0.4;
  cam.position.set(follow + sx, 3.05 + sy, camZ);
  cam.lookAt(follow, 1.35, 0);
}

function render() {
  updateCamera(1 / 60);
  renderer.render(G.scene!, G.camera!);
}

function loop(ts: number) {
  const rdt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  let dt = rdt;
  if (G.hitstop > 0) dt = 0;
  else dt = rdt * G.timeScale;
  update(dt, rdt);
  Input.endFrame();
  render();
  raf = requestAnimationFrame(loop);
}

/* ---------------- public API ---------------- */
export function startGame(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas;
  (window as unknown as { __nr?: unknown }).__nr = G; // QA debug hook
  canvas.style.imageRendering = "auto";
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(55, 960 / 540, 0.1, 100);
  G.camera.position.set(0, 3.1, 9.6);
  G.camera.lookAt(0, 1.35, 0);

  const ambient = new THREE.AmbientLight(0x55607a, 0.85);
  G.scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffe0c0, 1.15);
  dir.position.set(3, 8, 6);
  G.scene.add(dir);

  loadSettings();
  G.state = "menu";
  G.training = false;
  FX.init();
  rebuildArena();

  // wrap canvas for overlay UI
  wrap = document.createElement("div");
  wrap.id = "nr-wrap";
  wrap.style.cssText = "position:relative;display:inline-flex;";
  canvas.parentNode?.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  initHud(wrap, canvas);
  showMenu();
  spawnDemoFighters();

  const resize = () => {
    const scale = Math.min(window.innerWidth / 960, window.innerHeight / 540);
    canvas.style.width = 960 * scale + "px";
    canvas.style.height = 540 * scale + "px";
  };
  resize();
  window.addEventListener("resize", resize);

  // wire HUD actions
  HUD.actions.onMenuFight = () => {
    G.mode = "cpu";
    showSelect();
  };
  HUD.actions.onMenuTraining = () => {
    G.mode = "training";
    showSelect();
  };
  HUD.actions.onMenuSelect = () => {
    G.mode = "2p";
    showSelect();
  };
  HUD.actions.onMenuSettings = () => {
    showSettings("menu");
  };
  HUD.actions.onResume = () => {
    if (G.state === "paused") {
      G.state = pausePrev;
      hideScreens();
    }
  };
  HUD.actions.onQuitToMenu = () => toMenu();
  HUD.actions.onRematch = () => {
    if (G.p1Cfg && G.p2Cfg) startMatch(G.mode, G.p1Cfg, G.p2Cfg);
  };
  HUD.actions.onEndCharSelect = () => {
    G.mode = G.mode === "training" ? "training" : "cpu";
    showSelect();
  };
  HUD.actions.onStartMatch = () => {
    if (G.p1Cfg && G.p2Cfg) startMatch("2p", G.p1Cfg, G.p2Cfg);
  };
  HUD.actions.onSettingsBack = () => {
    if (G.state === "paused") showPause();
    else showMenu();
  };

  // unlock audio on first interaction
  const unlock = () => {
    AudioSys.init();
    AudioSys.resume();
    AudioSys.startMusic();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  Input.init(
    () => {
      if (G.state === "fight" || G.state === "intro") {
        pausePrev = G.state;
        G.state = "paused";
        showPause();
        AudioSys.uiSelect();
      } else if (G.state === "paused") {
        G.state = pausePrev;
        hideScreens();
        AudioSys.uiSelect();
      }
    },
    () => toggleSound()
  );

  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    Input.cleanup();
    AudioSys.stopMusic();
    G.fighters.forEach(disposeFighter);
    G.fighters = [];
    arena?.dispose();
    arena = null;
    wrap?.remove();
    renderer.dispose();
    G.scene = null;
    G.camera = null;
    canvasEl = null;
  };
}
