/* =====================================================================
   CUBE MASTER: Akıl Küpü — Game Engine
   A high-quality 3D Rubik's cube. Cinematic visuals: ACES tone
   mapping, soft shadows, bloom, PBR materials with clearcoat and
   environment reflections. Buttery-smooth animations: moves are queued
   and interpolated per-frame, so the cube never stutters.

   Controls:
     Left-drag            rotate the whole cube (orbit)
     Drag on a face       turn that face (drag direction picks layer)
     U/D/L/R/F/B          turn faces (Shift = reverse)
     X / Y / Z            rotate whole cube
     S                    scramble
     Space                solve (replays scramble in reverse)

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* ================= 1. CONSTANTS ================= */
const W = 960;
const H = 540;
const CUBE = 3; // 3x3x3
const GAP = 1.02; // spacing between cubies (slightly > 1 so faces read clearly)
const MOVE_TIME = 0.22; // seconds per quarter turn
const SCRAMBLE_MOVES = 22;

// classic face colors
const COLORS = {
  U: 0xf5f5f5, // white
  D: 0xffd23f, // yellow
  F: 0x2e9e44, // green
  B: 0x2b6de8, // blue
  R: 0xe53935, // red
  L: 0xff8f1f, // orange
  core: 0x14141c,
};

const FACE_AXIS: Record<string, [number, number, number]> = {
  U: [0, 1, 0], D: [0, -1, 0],
  F: [0, 0, 1], B: [0, 0, -1],
  R: [1, 0, 0], L: [-1, 0, 0],
};

/* ================= 2. SCENE ================= */
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let composer: EffectComposer;
let pmrem: THREE.PMREMGenerator;
let envTex: THREE.Texture;
let disposed = false;

/* ================= 3. CUBE ================= */
interface Cubie {
  group: THREE.Group; // positioned at integer grid coords
  meshes: THREE.Mesh[]; // per-face visible meshes
}

let cubies: Cubie[] = [];
let cubeRoot = new THREE.Group(); // whole cube (orbit rotation lives here)
let movePivot = new THREE.Group(); // temporary pivot during a face turn

// move queue
interface QueuedMove { axis: THREE.Vector3; layer: number; dir: number; }
let moveQueue: QueuedMove[] = [];
let activeMove: { axis: THREE.Vector3; layer: number; dir: number; angle: number; done: boolean } | null = null;
let solving = false;
let solveTimer = 0;
let scrambleHistory: QueuedMove[] = [];

// game stats
let moveCount = 0;
let elapsed = 0;
let started = false;
let solved = false;
let bestTime: number | null = null;

function buildCubie(x: number, y: number, z: number): Cubie {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const core = new THREE.MeshStandardMaterial({ color: COLORS.core, roughness: 0.5, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), core);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  meshes.push(body);

  // colored face stickers with clearcoat + slight bevel look
  const faceMat = (color: number) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.25, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 0.9,
  });
  const sticker = (dir: [number, number, number], color: number) => {
    const [dx, dy, dz] = dir;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.06), faceMat(color));
    m.position.set(dx * 0.5, dy * 0.5, dz * 0.5);
    if (dx) m.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (dz) m.rotation.y = 0;
    // orient sticker to face outward
    if (dx !== 0) m.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (dz !== 0) m.rotation.y = dz > 0 ? 0 : Math.PI;
    m.castShadow = true;
    group.add(m);
    meshes.push(m);
  };

  if (y === 1) sticker([0, 1, 0], COLORS.U);
  if (y === -1) sticker([0, -1, 0], COLORS.D);
  if (z === 1) sticker([0, 0, 1], COLORS.F);
  if (z === -1) sticker([0, 0, -1], COLORS.B);
  if (x === 1) sticker([1, 0, 0], COLORS.R);
  if (x === -1) sticker([-1, 0, 0], COLORS.L);

  group.position.set(x * GAP, y * GAP, z * GAP);
  return { group, meshes };
}

function buildCube() {
  cubeRoot = new THREE.Group();
  movePivot = new THREE.Group();
  scene.add(cubeRoot);
  scene.add(movePivot);
  cubies = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue; // hidden core
        const c = buildCubie(x, y, z);
        cubies.push(c);
        cubeRoot.add(c.group);
      }
  // spin the cube slightly for a nice initial view
  cubeRoot.rotation.set(0.55, -0.7, 0.15);
}

/** world-space grid coordinate of a cubie (rounded) */
function cubiePos(c: Cubie): THREE.Vector3 {
  const v = new THREE.Vector3();
  c.group.getWorldPosition(v);
  return v.multiplyScalar(1 / GAP).round();
}

/** collect cubies whose rounded coordinate has `value` on `axisIndex` */
function layerCubies(axis: THREE.Vector3, value: number): Cubie[] {
  const idx = axis.x !== 0 ? 0 : axis.y !== 0 ? 1 : 2;
  const want = Math.round(value);
  return cubies.filter((c) => {
    const p = cubiePos(c);
    const v = idx === 0 ? p.x : idx === 1 ? p.y : p.z;
    return Math.abs(v - want) < 0.6;
  });
}

/** detach layer cubies from cubeRoot into movePivot (keeping world transform) */
function gatherLayer(axis: THREE.Vector3, layer: number) {
  const list = layerCubies(axis, layer);
  for (const c of list) {
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    c.group.getWorldPosition(worldPos);
    c.group.getWorldQuaternion(worldQuat);
    cubeRoot.remove(c.group);
    movePivot.attach(c.group);
    // attach() preserves world transform; position now local to pivot
    void worldPos; void worldQuat;
  }
  return list;
}

function releaseLayer() {
  const children = [...movePivot.children];
  for (const child of children) {
    cubeRoot.attach(child);
  }
  movePivot.rotation.set(0, 0, 0);
  movePivot.quaternion.identity();
  movePivot.updateMatrixWorld(true);
}

/** push a move onto the queue */
function queueMove(axis: THREE.Vector3, layer: number, dir: number) {
  moveQueue.push({ axis: axis.clone().normalize(), layer, dir });
  if (!activeMove) pumpQueue();
}

function pumpQueue() {
  if (activeMove) return;
  const mv = moveQueue.shift();
  if (!mv) return;
  const list = layerCubies(mv.axis, mv.layer);
  if (list.length === 0) { pumpQueue(); return; }
  gatherLayer(mv.axis, mv.layer);
  activeMove = { axis: mv.axis, layer: mv.layer, dir: mv.dir, angle: 0, done: false };
  if (!started && !solving) { started = true; }
}

function updateMoves(dt: number) {
  if (!activeMove) {
    pumpQueue();
    return;
  }
  const am = activeMove;
  const target = (Math.PI / 2) * am.dir;
  am.angle += (dt / MOVE_TIME) * (Math.PI / 2) * Math.sign(target || 1);
  // clamp to target
  const sign = Math.sign(target);
  if (sign > 0 && am.angle >= target) am.angle = target;
  else if (sign < 0 && am.angle <= target) am.angle = target;

  const q = new THREE.Quaternion().setFromAxisAngle(am.axis, am.angle);
  movePivot.quaternion.copy(q);
  movePivot.updateMatrixWorld(true);

  if (Math.abs(am.angle - target) < 0.001) {
    // finish: re-parent, snap rotation
    releaseLayer();
    activeMove = null;
    moveCount++;
    if (solving) {
      solveTimer += MOVE_TIME;
      if (moveQueue.length === 0) {
        solving = false;
        solved = true;
        onSolved();
      }
    } else if (started) {
      elapsed += MOVE_TIME;
    }
    pumpQueue();
  }
}

/** do a face turn instantly (for scramble) — no animation */
function instantMove(axis: THREE.Vector3, layer: number, dir: number) {
  gatherLayer(axis, layer);
  const q = new THREE.Quaternion().setFromAxisAngle(axis, (Math.PI / 2) * dir);
  movePivot.quaternion.copy(q);
  movePivot.updateMatrixWorld(true);
  releaseLayer();
}

/* ================= 4. INPUT ================= */
interface DragState {
  active: boolean;
  px: number; py: number;
  sx: number; sy: number;
  moved: number;
  faceAxis: THREE.Vector3 | null;
  faceNormal: THREE.Vector3 | null;
  cubie: Cubie | null;
}
const drag: DragState = { active: false, px: 0, py: 0, sx: 0, sy: 0, moved: 0, faceAxis: null, faceNormal: null, cubie: null };
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickCubie(clientX: number, clientY: number): { cubie: Cubie | null; normal: THREE.Vector3 | null } {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const meshes: THREE.Object3D[] = [];
  for (const c of cubies) for (const m of c.meshes) meshes.push(m);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return { cubie: null, normal: null };
  const h = hits[0];
  // find owning cubie
  let owner: Cubie | null = null;
  for (const c of cubies) {
    if (c.meshes.includes(h.object as THREE.Mesh)) { owner = c; break; }
  }
  const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize() : null;
  return { cubie: owner, normal };
}

function bindControls(canvas: HTMLCanvasElement) {
  const rect = () => canvas.getBoundingClientRect();
  const local = (e: PointerEvent) => ({ x: e.clientX - rect().left, y: e.clientY - rect().top });

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    drag.active = true;
    drag.px = p.x; drag.py = p.y;
    drag.sx = p.x; drag.sy = p.y;
    drag.moved = 0;
    const picked = pickCubie(e.clientX, e.clientY);
    drag.cubie = picked.cubie;
    drag.faceNormal = picked.normal;
    drag.faceAxis = null;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag.active) return;
    const p = local(e);
    const dx = p.x - drag.px, dy = p.y - drag.py;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.px = p.x; drag.py = p.y;

    if (drag.moved > 5) {
      if (drag.cubie && drag.faceNormal) {
        const axis = faceTurnAxis(drag.faceNormal, dx, dy);
        if (axis) drag.faceAxis = axis;
      }
      if (drag.faceAxis && drag.cubie) {
        const ppos = cubiePos(drag.cubie);
        const idx = drag.faceAxis.x !== 0 ? 0 : drag.faceAxis.y !== 0 ? 1 : 2;
        const layer = idx === 0 ? ppos.x : idx === 1 ? ppos.y : ppos.z;
        const dir = turnDirection(drag.faceAxis, dx, dy);
        if (!activeMove && !solving) {
          queueMove(drag.faceAxis, layer, dir);
          drag.sx = p.x; drag.sy = p.y; // allow chaining
          drag.faceAxis = null;
          drag.cubie = null;
          drag.faceNormal = null;
        }
      } else {
        cubeRoot.rotation.y += dx * 0.008;
        cubeRoot.rotation.x += dy * 0.008;
        cubeRoot.rotation.x = Math.max(-1.4, Math.min(1.4, cubeRoot.rotation.x));
      }
    }
  });

  canvas.addEventListener("pointerup", () => { drag.active = false; drag.faceAxis = null; drag.cubie = null; });
  canvas.addEventListener("pointercancel", () => { drag.active = false; drag.faceAxis = null; drag.cubie = null; });
}

/** pick a turn axis based on the face normal and screen drag direction */
function faceTurnAxis(normal: THREE.Vector3, dx: number, dy: number): THREE.Vector3 | null {
  // drag direction in screen space
  const dragLen = Math.hypot(dx, dy);
  if (dragLen < 1) return null;
  const sd = new THREE.Vector2(dx / dragLen, dy / dragLen);

  // project world axes into screen space using the camera basis
  const camDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, camDir).normalize();

  const candidates = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  let best: THREE.Vector3 | null = null;
  let bestScore = -1;
  for (const cand of candidates) {
    // skip the axis parallel to the face normal (that axis would spin the face in place)
    if (Math.abs(cand.dot(normal)) > 0.85) continue;
    const sx = cand.dot(right), sy = cand.dot(up);
    const len = Math.hypot(sx, sy);
    if (len < 0.05) continue;
    const score = Math.abs(sd.x * (sx / len) + sd.y * (sy / len));
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

function turnDirection(axis: THREE.Vector3, dx: number, dy: number): number {
  // drag direction sign relative to the axis on screen
  const camDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, camDir).normalize();
  const sx = axis.dot(right), sy = axis.dot(up);
  const len = Math.hypot(sx, sy);
  if (len < 0.05) return 1;
  const dot = dx * (sx / len) + dy * (sy / len);
  return dot >= 0 ? 1 : -1;
}

/* ================= 5. KEYBOARD ================= */
function bindKeys() {
  const down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const rev = e.shiftKey ? -1 : 1;
    const faceMap: Record<string, keyof typeof COLORS> = { u: "U", d: "D", l: "L", r: "R", f: "F", b: "B" };
    if (faceMap[k]) {
      const axis = FACE_AXIS[faceMap[k]];
      queueMove(new THREE.Vector3(...axis), faceMap[k] === "D" || faceMap[k] === "U" ? (faceMap[k] === "U" ? 1 : -1) : faceMap[k] === "F" || faceMap[k] === "B" ? (faceMap[k] === "F" ? 1 : -1) : (faceMap[k] === "R" ? 1 : -1), rev);
      e.preventDefault();
    } else if (k === "x") { cubeRoot.rotation.x += 0.5; }
    else if (k === "y") { cubeRoot.rotation.y += 0.5; }
    else if (k === "z") { cubeRoot.rotation.z += 0.5; }
    else if (k === "s") { scramble(); }
    else if (k === " ") { solve(); e.preventDefault(); }
    else if (k === "p") { togglePause(); }
    else if (k === "m") { toggleMute(); }
  };
  window.addEventListener("keydown", down);
}

function faceMove(face: keyof typeof COLORS, rev: number) {
  const axis = FACE_AXIS[face];
  const layer = face === "U" || face === "D" ? (face === "U" ? 1 : -1) : face === "F" || face === "B" ? (face === "F" ? 1 : -1) : (face === "R" ? 1 : -1);
  queueMove(new THREE.Vector3(...axis), layer, rev);
}

/* ================= 6. GAME FLOW ================= */
function scramble() {
  if (activeMove || moveQueue.length > 0) return;
  // reset cube
  resetCube();
  const faces: (keyof typeof COLORS)[] = ["U", "D", "L", "R", "F", "B"];
  scrambleHistory = [];
  let last = "";
  for (let i = 0; i < SCRAMBLE_MOVES; i++) {
    let f = faces[Math.floor(Math.random() * faces.length)];
    if (f === last) { f = faces[Math.floor(Math.random() * faces.length)]; }
    last = f;
    const rev = Math.random() < 0.5 ? 1 : -1;
    instantMove(new THREE.Vector3(...FACE_AXIS[f]), f === "U" || f === "D" ? (f === "U" ? 1 : -1) : f === "F" || f === "B" ? (f === "F" ? 1 : -1) : (f === "R" ? 1 : -1), rev);
    scrambleHistory.push({ axis: new THREE.Vector3(...FACE_AXIS[f]), layer: f === "U" || f === "D" ? (f === "U" ? 1 : -1) : f === "F" || f === "B" ? (f === "F" ? 1 : -1) : (f === "R" ? 1 : -1), dir: rev });
  }
  elapsed = 0;
  moveCount = 0;
  started = true;
  solved = false;
  solving = false;
  updateHUD();
  flash("Küp karıştırıldı — çözmeye başla!");
}

function resetCube() {
  // rebuild in place: clear root children and rebuild cubies
  while (cubeRoot.children.length) {
    const ch = cubeRoot.children[0];
    cubeRoot.remove(ch);
  }
  while (movePivot.children.length) {
    const ch = movePivot.children[0];
    movePivot.remove(ch);
  }
  movePivot.quaternion.identity();
  cubies = [];
  moveQueue = [];
  activeMove = null;
  buildCube();
}

function solve() {
  if (solving || solved || activeMove || moveQueue.length > 0) return;
  if (scrambleHistory.length === 0) { flash("Önce küpü karıştır (S)"); return; }
  solving = true;
  solveTimer = 0;
  // replay scramble in reverse
  for (let i = scrambleHistory.length - 1; i >= 0; i--) {
    const m = scrambleHistory[i];
    queueMove(m.axis.clone(), m.layer, -m.dir);
  }
  flash("Çözülüyor...");
}

function onSolved() {
  const t = elapsed;
  if (bestTime === null || t < bestTime) {
    bestTime = t;
    try { localStorage.setItem("cube-master-best", String(bestTime)); } catch { /* ignore */ }
  }
  updateHUD();
  showWin(t);
}

function isSolved(): boolean {
  // check every face: 9 outward stickers share one color
  const faces: { axis: THREE.Vector3; expect: number }[] = [
    { axis: new THREE.Vector3(0, 1, 0), expect: COLORS.U },
    { axis: new THREE.Vector3(0, -1, 0), expect: COLORS.D },
    { axis: new THREE.Vector3(1, 0, 0), expect: COLORS.R },
    { axis: new THREE.Vector3(-1, 0, 0), expect: COLORS.L },
    { axis: new THREE.Vector3(0, 0, 1), expect: COLORS.F },
    { axis: new THREE.Vector3(0, 0, -1), expect: COLORS.B },
  ];
  for (const f of faces) {
    const found = new Set<number>();
    for (const c of cubies) {
      // world-space position of this cubie
      const wp = c.group.getWorldPosition(new THREE.Vector3());
      const p = wp.multiplyScalar(1 / GAP).round();
      // is this cubie on the face layer?
      const layerVal = f.axis.x !== 0 ? p.x : f.axis.y !== 0 ? p.y : p.z;
      const want = f.axis.x !== 0 ? f.axis.x : f.axis.y !== 0 ? f.axis.y : f.axis.z;
      if (Math.abs(layerVal - want) < 0.6) {
        // its outward sticker normal must match the face axis
        const q = c.group.getWorldQuaternion(new THREE.Quaternion());
        for (const m of c.meshes) {
          if (m.position.length() < 0.3) continue; // skip body
          const localN = m.position.clone().normalize();
          const worldN = localN.applyQuaternion(q);
          if (worldN.dot(f.axis) > 0.9) {
            const mat = m.material as THREE.MeshPhysicalMaterial;
            found.add(mat.color.getHex());
          }
        }
      }
    }
    if (found.size !== 1) return false;
  }
  return true;
}

/* ================= 7. AUDIO ================= */
const AudioSys = {
  ctx: null as AudioContext | null,
  muted: false,
  master: null as GainNode | null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.5, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master!);
    osc.start(t); osc.stop(t + dur + 0.02);
  },
  click() { this.tone("sine", 700, 500, 0.05, 0.25); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone("square", f, f, 0.15, 0.3, i * 0.11)); },
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.22; },
};

function toggleMute() {
  AudioSys.init();
  AudioSys.setMuted(!AudioSys.muted);
  const btn = document.getElementById("mute-btn");
  if (btn) btn.innerHTML = AudioSys.muted ? "&#128263;" : "&#128266;";
}

/* ================= 8. HUD & OVERLAY ================= */
function updateHUD() {
  const set = (id: string, v: string | number) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  set("hud-moves", moveCount);
  set("hud-time", formatTime(elapsed));
  set("hud-best", bestTime !== null ? formatTime(bestTime) : "—");
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function flash(text: string) {
  const el = document.getElementById("cube-toast");
  if (el) {
    el.textContent = text;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1800);
  }
}

function showWin(t: number) {
  const el = document.getElementById("screen-win");
  if (!el) return;
  el.classList.remove("hidden");
  const stats = document.getElementById("final-stats");
  if (stats) stats.innerHTML = `Süre: <b>${formatTime(t)}</b> &nbsp; Hamle: <b>${moveCount}</b>${bestTime === t ? " &nbsp; 🏆 YENİ REKOR!" : ""}`;
  AudioSys.win();
}

function togglePause() {
  const el = document.getElementById("screen-pause");
  if (!el) return;
  el.classList.toggle("hidden");
}

function buildOverlayUI(container: HTMLElement) {
  const css = document.createElement("style");
  css.textContent = `
.cm-hud { position:absolute; top:0; left:0; right:0; z-index:6; pointer-events:none; font-family:'Courier New',monospace; }
.cm-top { display:flex; justify-content:space-between; align-items:flex-start; padding:10px 14px; gap:10px; flex-wrap:wrap; }
.cm-panel { background:rgba(10,14,30,0.78); border:2px solid rgba(255,255,255,0.35); border-radius:12px; padding:8px 12px; backdrop-filter:blur(4px); pointer-events:auto; }
.cm-panel h3 { margin:0 0 6px; font-size:12px; letter-spacing:2px; color:#ffd23f; }
.cm-stats { font-size:14px; color:#fff; font-weight:bold; display:flex; gap:16px; }
.cm-stats b { color:#7ee081; }
.cm-btns { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
.cm-btn { font-family:inherit; font-size:12px; font-weight:bold; padding:6px 11px; border-radius:8px; border:2px solid rgba(255,255,255,0.45); background:rgba(255,255,255,0.12); color:#fff; cursor:pointer; letter-spacing:1px; }
.cm-btn:hover { background:rgba(255,255,255,0.25); }
.cm-btn.accent { background:linear-gradient(#ffd23f,#ff8c1a); border-color:#fff; color:#2a1a00; }
.cm-faces { display:flex; gap:4px; margin-top:6px; }
.cm-face { width:28px; height:28px; border-radius:6px; border:2px solid rgba(255,255,255,0.5); cursor:pointer; font-size:11px; font-weight:bold; color:#fff; text-shadow:0 1px 2px #000; display:flex; align-items:center; justify-content:center; }
.cm-help { font-size:11px; color:#b9c7ff; line-height:1.7; }
.cm-help b { color:#ffd23f; }
.cm-toast { position:absolute; top:64px; left:50%; transform:translateX(-50%) translateY(-8px); background:rgba(10,14,30,0.92); border:2px solid #7ee081; color:#7ee081; font-family:'Courier New',monospace; font-weight:bold; font-size:15px; padding:8px 20px; border-radius:10px; opacity:0; transition:opacity .2s, transform .2s; pointer-events:none; z-index:7; }
.cm-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
.cm-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(8,12,26,0.92); color:#fff; z-index:10; text-align:center; font-family:'Courier New',monospace; }
.cm-overlay.hidden { display:none; }
.cm-overlay h1 { font-size:clamp(30px,7vw,56px); letter-spacing:4px; color:#ffd23f; text-shadow:0 0 24px rgba(255,210,63,0.7),3px 3px 0 #7a3a1a; margin-bottom:6px; }
.cm-overlay h2 { font-size:clamp(22px,4vw,34px); color:#7ee081; margin-bottom:14px; }
.cm-overlay p { font-size:clamp(13px,2.2vw,16px); color:#c3d4ff; line-height:1.8; margin-bottom:6px; }
.cm-overlay .big-btn { margin-top:18px; font-family:inherit; font-size:clamp(16px,3vw,22px); font-weight:bold; padding:13px 36px; background:linear-gradient(#ffd23f,#ff8c1a); color:#2a1a00; border:3px solid #fff; border-radius:12px; cursor:pointer; box-shadow:0 5px 0 #8a4a00; letter-spacing:2px; }
.cm-overlay .big-btn:active { transform:translateY(4px); box-shadow:0 1px 0 #8a4a00; }
.cm-overlay .keys { margin-top:14px; font-size:12px; color:#8ea0d8; line-height:2; }
.cm-overlay .keys b { color:#ffd23f; }
`;
  container.appendChild(css);

  const hud = document.createElement("div");
  hud.className = "cm-hud";
  hud.innerHTML = `
  <div class="cm-top">
    <div class="cm-panel">
      <h3>İSTATİSTİK</h3>
      <div class="cm-stats">
        <span>HAMLE <b id="hud-moves">0</b></span>
        <span>SÜRE <b id="hud-time">0:00</b></span>
        <span>REKOR <b id="hud-best">—</b></span>
      </div>
      <div class="cm-btns">
        <button class="cm-btn accent" id="btn-scramble">🔀 Karıştır (S)</button>
        <button class="cm-btn" id="btn-solve">✨ Çöz (Space)</button>
        <button class="cm-btn" id="btn-pause">⏸ Durdur (P)</button>
      </div>
    </div>
    <div class="cm-panel">
      <h3>YÜZLER — <span id="cm-face-name" style="color:#fff">U</span></h3>
      <div class="cm-faces">
        <div class="cm-face" data-face="U" style="background:#f5f5f5;color:#222">U</div>
        <div class="cm-face" data-face="D" style="background:#ffd23f;color:#222">D</div>
        <div class="cm-face" data-face="L" style="background:#ff8f1f;color:#fff">L</div>
        <div class="cm-face" data-face="R" style="background:#e53935;color:#fff">R</div>
        <div class="cm-face" data-face="F" style="background:#2e9e44;color:#fff">F</div>
        <div class="cm-face" data-face="B" style="background:#2b6de8;color:#fff">B</div>
      </div>
      <div class="cm-help" style="margin-top:6px">
        <b>Yüz tuşlarına tıkla</b> döndürür &nbsp;·&nbsp; <b>Shift+harf</b> ters çevirir
      </div>
    </div>
    <div class="cm-panel">
      <h3>KONTROL</h3>
      <div class="cm-help">
        <b>Sol sürükle</b> küpü döndür &nbsp;·&nbsp; <b>Yüz üzerinde sürükle</b> katman çevir<br>
        <b>U/D/L/R/F/B</b> yüz &nbsp;·&nbsp; <b>Shift</b> ters &nbsp;·&nbsp; <b>S</b> karıştır &nbsp;·&nbsp; <b>Space</b> çöz<br>
        <b>X/Y/Z</b> küpü eksende döndür &nbsp;·&nbsp; <b>P</b> durdur &nbsp;·&nbsp; <b>M</b> sessiz
      </div>
    </div>
  </div>
  <div class="cm-toast" id="cube-toast"></div>`;
  container.appendChild(hud);

  const start = document.createElement("div");
  start.className = "cm-overlay";
  start.id = "screen-start";
  start.innerHTML = `
    <h1>CUBE MASTER</h1>
    <h2>Akıl Küpü 🧩</h2>
    <p>Klasik 3×3 Rubik küpü — yüksek kaliteli 3D grafiklerle,<br>akıcı animasyonlarla ve rekor takibiyle!</p>
    <p style="color:#7ee081">Küpü döndür, yüzleri çevir, karıştır ve çöz — en hızlı süren ne?</p>
    <button class="big-btn" id="btn-start">BAŞLA</button>
    <div class="keys">
      <b>Sol sürükle</b> küpü döndür &nbsp;·&nbsp; <b>Yüzde sürükle</b> katman çevir<br>
      <b>U/D/L/R/F/B</b> yüzler &nbsp;·&nbsp; <b>S</b> karıştır &nbsp;·&nbsp; <b>Space</b> çöz
    </div>`;
  container.appendChild(start);

  const pause = document.createElement("div");
  pause.className = "cm-overlay hidden";
  pause.id = "screen-pause";
  pause.innerHTML = `<h2>DURAKLATILDI</h2><button class="big-btn" id="btn-resume">DEVAM ET</button>`;
  container.appendChild(pause);

  const win = document.createElement("div");
  win.className = "cm-overlay hidden";
  win.id = "screen-win";
  win.innerHTML = `
    <h1>ÇÖZDÜN! 🎉</h1>
    <p style="color:#7ee081;font-size:clamp(16px,3vw,22px)" id="final-stats"></p>
    <button class="big-btn" id="btn-again">TEKRAR KARIŞTIR</button>`;
  container.appendChild(win);

  // wire buttons
  const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener("click", fn);
  on("btn-start", () => { start.classList.add("hidden"); AudioSys.init(); AudioSys.resume(); scramble(); });
  on("btn-scramble", () => scramble());
  on("btn-solve", () => solve());
  on("btn-pause", () => togglePause());
  on("btn-resume", () => togglePause());
  on("btn-again", () => { win.classList.add("hidden"); scramble(); });

  container.querySelectorAll<HTMLElement>(".cm-face").forEach((el) => {
    el.addEventListener("click", () => {
      const f = el.dataset.face as keyof typeof COLORS;
      faceMove(f, 1);
      const nameEl = document.getElementById("cm-face-name");
      if (nameEl) nameEl.textContent = f;
      AudioSys.click();
    });
  });
}

/* ================= 9. MAIN LOOP & PUBLIC API ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  // ---- renderer ----
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || W, canvas.clientHeight || H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0c1224, 26, 60);

  camera = new THREE.PerspectiveCamera(45, (canvas.clientWidth || W) / (canvas.clientHeight || H), 0.1, 200);
  camera.position.set(6.5, 5.5, 7.5);

  // ---- environment + lights ----
  pmrem = new THREE.PMREMGenerator(renderer);
  envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  // background gradient
  const bgCanvas = document.createElement("canvas");
  bgCanvas.width = 64; bgCanvas.height = 64;
  const bg = bgCanvas.getContext("2d")!;
  const grad = bg.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#0a0f24");
  grad.addColorStop(0.5, "#1a2150");
  grad.addColorStop(1, "#2c1a4a");
  bg.fillStyle = grad;
  bg.fillRect(0, 0, 64, 64);
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  scene.background = bgTex;

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x302040, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
  sun.position.set(5, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 20;
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5;
  sun.shadow.camera.bottom = -5;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fb8ff, 0.6);
  rim.position.set(-6, 3, -5);
  scene.add(rim);

  // soft floor shadow catcher
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6, 40),
    new THREE.MeshStandardMaterial({ color: 0x10142a, roughness: 0.6, metalness: 0.1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- composer + bloom ----
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth || W, canvas.clientHeight || H), 0.35, 0.7, 0.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- cube + ui ----
  buildCube();
  bindControls(canvas);
  bindKeys();
  buildOverlayUI(canvas.parentElement || canvas.parentNode as HTMLElement);

  try {
    const raw = localStorage.getItem("cube-master-best");
    if (raw) { bestTime = Number(raw); if (!isFinite(bestTime)) bestTime = null; }
  } catch { bestTime = null; }
  updateHUD();

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  };
  resize();
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  let raf = 0;
  let lastSolvedCheck = 0;

  const loop = () => {
    if (disposed) return;
    const dt = Math.min(0.05, clock.getDelta());

    // idle auto-spin for a lively look (pauses while you're solving)
    const paused = !document.getElementById("screen-pause")?.classList.contains("hidden");
    if (!paused && !activeMove && moveQueue.length === 0 && !solving && !started) {
      cubeRoot.rotation.y += 0.1 * dt;
    }

    // moves
    if (!paused) {
      updateMoves(dt);
      if (started && !solving && !solved) {
        elapsed += dt;
      }
      // solved check (every ~0.5s)
      lastSolvedCheck += dt;
      if (started && !solved && lastSolvedCheck > 0.5) {
        lastSolvedCheck = 0;
        if (isSolved()) { solved = true; onSolved(); }
      }
      updateHUD();
    }

    composer.render();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) m.dispose();
    });
    bgTex.dispose();
    envTex.dispose();
    pmrem.dispose();
    composer.dispose();
    renderer.dispose();
    canvas.parentElement?.querySelector(".cm-hud")?.remove();
    canvas.parentElement?.querySelectorAll(".cm-overlay").forEach((el) => el.remove());
    canvas.parentElement?.querySelector("style")?.remove();
  };
}
