/* =====================================================================
   NEON RIVALS — DOM overlay: HUD, main menu, character select,
   settings (key rebinding), pause, match end, damage numbers.
   ===================================================================== */
import * as THREE from "three";
import { G, DEFAULT_KEYS, HP_MAX, STAMINA_MAX, WINS_NEEDED } from "./state";
import { AudioSys } from "./audio";
import { Input } from "./input";
import { FIGHTERS } from "./characters";
import type { FighterCfg, Keybind } from "./types";

let ui: HTMLDivElement | null = null;
let canvasElRef: HTMLCanvasElement | null = null;
let milestoneT = 0;
let milestoneN = 0;
let settingsBack: "menu" | "pause" = "menu";
const dmgNums: { el: HTMLDivElement; life: number; vy: number }[] = [];

const KEY_NAMES: Record<string, string> = {
  KeyA: "A", KeyD: "D", KeyW: "W", KeyS: "S", KeyJ: "J", KeyK: "K", KeyL: "L", KeyU: "U",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  Numpad1: "Num1", Numpad2: "Num2", Numpad3: "Num3", Numpad4: "Num4",
  Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4",
};
const keyName = (c: string) => KEY_NAMES[c] ?? c.replace("Key", "").replace("Arrow", "");

const ACTIONS: (keyof Keybind)[] = ["left", "right", "jump", "crouch", "light", "heavy", "special", "block"];
const ACTION_LABEL: Record<keyof Keybind, string> = {
  left: "Move Left",
  right: "Move Right",
  jump: "Jump",
  crouch: "Crouch",
  light: "Light Attack",
  heavy: "Heavy Attack",
  special: "Special Attack",
  block: "Block",
};

function $id(id: string): HTMLElement | null {
  return document.getElementById("nr-" + id);
}

function saveSettings() {
  try {
    localStorage.setItem(
      "neon-rivals",
      JSON.stringify({ sound: G.settings.sound, difficulty: G.settings.difficulty, keys: G.settings.keys })
    );
  } catch {
    /* storage unavailable */
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem("neon-rivals");
    if (!raw) return;
    const d = JSON.parse(raw);
    if (typeof d.sound === "boolean") {
      G.settings.sound = d.sound;
      G.muted = !d.sound;
      AudioSys.muted = !d.sound;
    }
    if (d.difficulty === "easy" || d.difficulty === "normal" || d.difficulty === "hard") {
      G.settings.difficulty = d.difficulty;
      G.difficulty = d.difficulty;
    }
    if (Array.isArray(d.keys) && d.keys.length === 2) {
      const keys = d.keys as Keybind[];
      if (keys[0] && typeof keys[0].left === "string" && keys[1] && typeof keys[1].left === "string") {
        G.settings.keys = [keys[0], keys[1]];
      }
    }
  } catch {
    /* corrupted storage — keep defaults */
  }
}

/* ================= actions wired by engine ================= */
export const HUD = {
  actions: {
    onMenuFight: () => {},
    onMenuTraining: () => {},
    onMenuSelect: () => {},
    onMenuSettings: () => {},
    onResume: () => {},
    onQuitToMenu: () => {},
    onRematch: () => {},
    onEndCharSelect: () => {},
    onStartMatch: () => {},
    onSettingsBack: () => {},
  },
};

/* ================= banner ================= */
export function showBanner(main: string, sub: string, dur: number) {
  G.banner = { main, sub, t: dur, dur };
  const el = $id("banner");
  if (el) el.classList.add("show");
  const m = $id("banner-main");
  const s = $id("banner-sub");
  if (m) m.textContent = main;
  if (s) {
    s.textContent = sub;
    s.style.display = sub ? "block" : "none";
  }
}

/* ================= screens ================= */
export function hideScreens() {
  ["menu", "select", "settings", "pause", "end"].forEach((n) => {
    const el = $id(n);
    if (el) el.style.display = "none";
  });
}

export function showHud(v: boolean) {
  const el = $id("hud");
  if (el) el.style.display = v ? "block" : "none";
}

export function showMenu() {
  hideScreens();
  const el = $id("menu");
  if (el) el.style.display = "flex";
  showHud(false);
  syncSoundLabels();
  const mk = $id("menu-keys");
  if (mk) {
    mk.innerHTML = `P1: <b>${keyRow(0)}</b><br>P2: <b>${keyRow(1)}</b><br><b>S + special</b> = 2nd special &nbsp;·&nbsp; <b>M</b> sound &nbsp;·&nbsp; <b>Esc/P</b> pause`;
  }
}

export function showSettings(from: "menu" | "pause") {
  settingsBack = from;
  hideScreens();
  const el = $id("settings");
  if (el) el.style.display = "flex";
  renderSettingsTable();
  syncSoundLabels();
}

export function showPause() {
  hideScreens();
  const el = $id("pause");
  if (el) el.style.display = "flex";
  syncSoundLabels();
}

export function showEnd(winnerIdx: number) {
  hideScreens();
  const el = $id("end");
  if (el) el.style.display = "flex";
  const w = G.fighters[winnerIdx];
  const nm = $id("end-name");
  if (nm) {
    nm.textContent = "PLAYER " + (winnerIdx + 1) + " WINS";
    nm.style.color = "#" + w.cfg.colors.primary.toString(16).padStart(6, "0");
  }
  const sb = $id("end-sub");
  if (sb) sb.textContent = w.cfg.name + " — " + w.cfg.title + "  ·  " + w.wins + " ROUNDS";
}

export function showSelect() {
  G.state = "select";
  G.selectIdx = 0;
  G.p1Picked = false;
  G.aiPickT = 0;
  hideScreens();
  const el = $id("select");
  if (el) el.style.display = "flex";
  const cards = $id("cards");
  if (cards) cards.innerHTML = FIGHTERS.map(charCardHTML).join("");
  updateSelectSub();
  updateSelectCursor();
  renderArenaRow();
  renderDiffRow();
  cards?.querySelectorAll(".nr-card").forEach((c) => {
    (c as HTMLElement).addEventListener("click", () => {
      AudioSys.uiSelect();
      G.selectIdx = Number((c as HTMLElement).dataset.idx);
      pickFighter(G.selectIdx);
    });
  });
}

export function pickFighter(idx: number) {
  if (G.state !== "select") return;
  const cfg = FIGHTERS[idx];
  if (!G.p1Picked) {
    G.p1Picked = true;
    G.p1Cfg = cfg;
    const cards = $id("cards");
    cards?.querySelectorAll(".nr-card").forEach((c) => c.classList.remove("sel"));
    document.getElementById("nr-card-" + idx)?.classList.add("p1pick");
    const sub = $id("select-sub");
    if (G.mode === "cpu" || G.mode === "training") {
      if (sub) sub.textContent = G.mode === "training" ? "DUMMY SELECTING..." : "CPU SELECTING...";
      G.aiPickT = 0.55;
    } else {
      if (sub) sub.textContent = "PLAYER 2 — SELECT YOUR FIGHTER";
      const hint = $id("select-hint");
      if (hint) hint.textContent = "Click a card or press Num1-4";
    }
    return;
  }
  if (G.mode === "2p") {
    G.p2Cfg = cfg;
    document.getElementById("nr-card-" + idx)?.classList.add("p2pick");
    HUD.actions.onStartMatch();
  }
}

function updateSelectSub() {
  const sub = $id("select-sub");
  if (!sub) return;
  if (G.mode === "training") sub.textContent = "TRAINING — CHOOSE YOUR FIGHTER";
  else if (G.mode === "2p") sub.textContent = "PLAYER 1 — SELECT YOUR FIGHTER";
  else sub.textContent = "PLAYER 1 — SELECT YOUR FIGHTER";
  const hint = $id("select-hint");
  if (hint) {
    hint.innerHTML =
      "Click a card — or <b>A/D</b> + <b>Enter</b> (P1) · <b>Num1-4 / 1-4</b> (P2)";
  }
}

export function updateSelectCursor() {
  const cards = $id("cards");
  if (!cards) return;
  cards.querySelectorAll(".nr-card").forEach((c, i) => {
    c.classList.toggle("sel", i === G.selectIdx);
  });
}

/* ================= damage numbers ================= */
export function spawnDamageNumber(x: number, y: number, text: string, color: string) {
  const layer = $id("dmg");
  if (!layer) return;
  const cam = G.camera;
  if (!cam) return;
  const canvasW = parseFloat(canvasElRef?.style.width ?? "960") || 960;
  const canvasH = parseFloat(canvasElRef?.style.height ?? "540") || 540;
  const v = new THREE.Vector3(x, y, 0).project(cam);
  if (v.z > 1) return;
  const px = (v.x * 0.5 + 0.5) * canvasW;
  const py = (1 - (v.y * 0.5 + 0.5)) * canvasH;
  const el = document.createElement("div");
  el.className = "nr-dmg";
  el.textContent = text;
  el.style.color = color;
  el.style.left = px + "px";
  el.style.top = py + "px";
  layer.appendChild(el);
  dmgNums.push({ el, life: 0.7, vy: 34 });
}

/* ================= character card ================= */
function charCardHTML(cfg: FighterCfg, idx: number): string {
  const c = cfg.colors;
  const bar = (v: number) => `<i><b style="width:${Math.min(100, Math.round((v / 4.2) * 100))}%"></b></i>`;
  const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
  return `
  <div class="nr-card" data-idx="${idx}" id="nr-card-${idx}">
    <div class="nr-chip" style="background:linear-gradient(90deg,${hex(c.primary)},${hex(c.secondary)})"></div>
    <h3>${cfg.name}</h3>
    <div class="nr-t">${cfg.title}</div>
    <div class="nr-spec">✦ ${cfg.specials[0].name}<br>✦ ${cfg.specials[1].name}</div>
    <div class="nr-stat">SPD ${bar(cfg.stats.speed)}</div>
    <div class="nr-stat">PWR ${bar(cfg.stats.power)}</div>
    <div class="nr-stat">DEF ${bar(cfg.stats.defense)}</div>
    <div class="nr-stat">RNG ${bar(cfg.stats.reach)}</div>
    <div class="nr-desc">${cfg.desc}</div>
  </div>`;
}

/* ================= settings ================= */
function renderSettingsTable() {
  const wrap = $id("settings-keys");
  if (!wrap) return;
  let html = "";
  for (let p = 0; p < 2; p++) {
    html += `<div class="nr-kcol"><div class="nr-khead">PLAYER ${p + 1}</div>`;
    for (const a of ACTIONS) {
      html += `<div class="nr-krow" data-p="${p}" data-a="${a}">
        <span>${ACTION_LABEL[a]}</span>
        <button class="nr-kbtn" data-p="${p}" data-a="${a}">${keyName(G.settings.keys[p][a])}</button>
      </div>`;
    }
    html += `</div>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll(".nr-kbtn").forEach((b) => {
    (b as HTMLElement).addEventListener("click", () => {
      const p = Number((b as HTMLElement).dataset.p);
      const a = (b as HTMLElement).dataset.a as keyof Keybind;
      b.textContent = "PRESS KEY...";
      b.classList.add("capture");
      Input.captureKey((code) => {
        G.settings.keys[p][a] = code;
        saveSettings();
        renderSettingsTable();
        updateHint();
      });
    });
  });
}

function syncSoundLabels() {
  const label = G.settings.sound ? "🔊 SOUND: ON" : "🔇 SOUND: OFF";
  const b1 = $id("sound-menu");
  const b2 = $id("sound-pause");
  const b3 = $id("sound-settings");
  const mb = $id("mute");
  if (b1) b1.textContent = label;
  if (b2) b2.textContent = label;
  if (b3) b3.textContent = label;
  if (mb) mb.textContent = G.settings.sound ? "🔊" : "🔇";
}

export function toggleSound() {
  G.settings.sound = !G.settings.sound;
  G.muted = !G.settings.sound;
  AudioSys.setMuted(!G.settings.sound);
  saveSettings();
  syncSoundLabels();
}

function renderArenaRow() {
  const row = $id("arena-row");
  if (!row) return;
  const arenas: [string, string][] = [
    ["random", "🎲 RANDOM"],
    ["neon", "🌃 NEON CITY"],
    ["temple", "🏛 ANCIENT TEMPLE"],
    ["cyber", "💠 CYBER ARENA"],
  ];
  row.innerHTML = arenas
    .map(
      ([id, label]) =>
        `<button class="nr-chipbtn${G.arena === id ? " on" : ""}" data-arena="${id}">${label}</button>`
    )
    .join("");
  row.querySelectorAll(".nr-chipbtn").forEach((b) => {
    (b as HTMLElement).addEventListener("click", () => {
      G.arena = (b as HTMLElement).dataset.arena as typeof G.arena;
      AudioSys.uiMove();
      renderArenaRow();
    });
  });
}

function renderDiffRow() {
  const row = $id("diff-row");
  if (!row) return;
  if (G.mode === "2p") {
    row.style.display = "none";
    return;
  }
  row.style.display = "flex";
  row.innerHTML = (["easy", "normal", "hard"] as const)
    .map(
      (d) =>
        `<button class="nr-chipbtn${G.settings.difficulty === d ? " on" : ""}" data-diff="${d}">${d.toUpperCase()}</button>`
    )
    .join("");
  row.querySelectorAll(".nr-chipbtn").forEach((b) => {
    (b as HTMLElement).addEventListener("click", () => {
      G.settings.difficulty = (b as HTMLElement).dataset.diff as typeof G.settings.difficulty;
      G.difficulty = G.settings.difficulty;
      AudioSys.uiMove();
      saveSettings();
      renderDiffRow();
    });
  });
}

/* ================= hints ================= */
function keyRow(p: number) {
  const k = G.settings.keys[p];
  return `${keyName(k.left)}/${keyName(k.right)} move · ${keyName(k.jump)} jump · ${keyName(k.crouch)} crouch · ${keyName(k.light)} light · ${keyName(k.heavy)} heavy · ${keyName(k.special)} special · ${keyName(k.block)} block`;
}

function updateHint() {
  const el = $id("hint");
  if (el) {
    el.innerHTML = `P1: <b>${keyRow(0)}</b><br>P2: <b>${keyRow(1)}</b> · <b>S+special</b> = 2nd special`;
  }
}

/* ================= build ================= */
const CSS = `
#nr-ui * { box-sizing: border-box; -webkit-user-select: none; user-select: none; }
#nr-hud { position:absolute; inset:0; display:none; pointer-events:none; font-family:'Segoe UI', system-ui, sans-serif; }
#nr-top { position:absolute; top:10px; left:12px; right:12px; display:flex; align-items:flex-start; gap:10px; }
.nr-panel { flex:1; max-width:380px; }
.nr-p2 { text-align:right; }
.nr-name { color:#fff; font-weight:800; font-size:17px; letter-spacing:2px; text-shadow:0 2px 4px #000; display:flex; gap:8px; align-items:center; }
.nr-p2 .nr-name { justify-content:flex-end; }
.nr-np { font-size:11px; color:#ffd24a; }
.nr-hpbar { height:18px; background:rgba(15,6,10,0.88); border:2px solid rgba(255,255,255,0.4); border-radius:4px; overflow:hidden; }
.nr-hpfill { height:100%; width:100%; background:linear-gradient(180deg,#ff5a4a,#c81f10); transition:width 0.12s linear; }
.nr-p2 .nr-hpbar { transform:scaleX(-1); }
.nr-p2 .nr-hpfill { transform:scaleX(-1); }
.nr-stbar { height:8px; margin-top:4px; background:rgba(15,6,10,0.85); border:1px solid rgba(255,255,255,0.25); border-radius:3px; overflow:hidden; }
.nr-stfill { height:100%; width:100%; background:linear-gradient(90deg,#ffd24a,#ff9a2a); }
.nr-stfill.low { background:linear-gradient(90deg,#ff5a4a,#c81f10); }
.nr-pips { margin-top:4px; color:#ffd24a; font-size:14px; letter-spacing:4px; text-shadow:0 1px 2px #000; }
.nr-timerbox { min-width:90px; text-align:center; }
.nr-timer { font-size:32px; font-weight:900; color:#fff; text-shadow:0 0 12px rgba(255,120,60,0.8); line-height:1.05; }
.nr-timer.low { color:#ff5040; }
.nr-round { font-size:13px; font-weight:700; color:#ffd9a0; letter-spacing:3px; text-shadow:0 1px 3px #000; margin-top:2px; }
#nr-banner { position:absolute; top:33%; left:0; right:0; text-align:center; pointer-events:none; opacity:0; transform:scale(0.7); transition:opacity 0.12s, transform 0.15s; z-index:5; }
#nr-banner.show { opacity:1; transform:scale(1); }
#nr-banner-main { font-size:72px; font-weight:900; color:#fff; letter-spacing:10px; text-shadow:0 0 26px rgba(90,220,255,0.9), 0 4px 0 #0a2a3a; }
#nr-banner-sub { font-size:22px; font-weight:700; color:#ffd9a0; letter-spacing:4px; text-shadow:0 2px 6px #000; margin-top:6px; }
#nr-combo { position:absolute; top:19%; left:0; right:0; text-align:center; font-size:34px; font-weight:900; color:#ffe066; letter-spacing:3px; text-shadow:0 0 16px rgba(255,200,0,0.85); display:none; }
#nr-milestone { position:absolute; top:25%; left:0; right:0; text-align:center; font-size:52px; font-weight:900; color:#7ae8ff; letter-spacing:6px; text-shadow:0 0 30px rgba(122,232,255,0.9); opacity:0; transition:opacity 0.15s; }
#nr-guardflash { position:absolute; inset:0; background:radial-gradient(ellipse at center, rgba(255,240,120,0.4), rgba(200,120,0,0.12)); opacity:0; pointer-events:none; }
#nr-hint { position:absolute; bottom:6px; left:0; right:0; text-align:center; font-size:11px; color:rgba(255,255,255,0.65); line-height:1.5; text-shadow:0 1px 3px #000; }
#nr-mute { position:absolute; top:8px; right:8px; z-index:45; background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.4); color:#fff; border-radius:8px; font-size:16px; width:38px; height:34px; cursor:pointer; pointer-events:auto; }
#nr-mute:hover { background:rgba(255,255,255,0.2); }
#nr-dmg { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.nr-dmg { position:absolute; transform:translate(-50%,-50%); font-weight:900; font-size:22px; text-shadow:0 2px 6px #000, 0 0 12px rgba(0,0,0,0.6); z-index:6; }
#nr-training { position:absolute; top:12px; left:50%; transform:translateX(-50%); font-size:13px; font-weight:800; letter-spacing:4px; color:#7ae8ff; text-shadow:0 0 10px rgba(122,232,255,0.7); display:none; }
.nr-screen { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:radial-gradient(ellipse at 50% 30%, rgba(14,18,40,0.93), rgba(4,6,14,0.97)); font-family:'Segoe UI', system-ui, sans-serif; color:#fff; z-index:30; pointer-events:auto; }
.nr-title { font-size:54px; font-weight:900; letter-spacing:10px; color:#fff; text-shadow:0 0 34px rgba(90,220,255,0.85), 0 5px 0 #0a2a3a; margin-bottom:2px; }
.nr-subtitle { font-size:15px; color:#8fd8ff; letter-spacing:6px; margin-bottom:26px; }
.nr-btn { margin:7px 0; padding:13px 36px; font-size:17px; font-weight:800; letter-spacing:2px; color:#fff; background:linear-gradient(180deg,#123a55,#0a2436); border:2px solid rgba(140,220,255,0.45); border-radius:10px; cursor:pointer; min-width:320px; transition:transform 0.1s, box-shadow 0.15s; }
.nr-btn:hover { transform:translateY(-2px) scale(1.02); box-shadow:0 6px 22px rgba(90,200,255,0.4); }
.nr-btn.ghost { background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.35); min-width:320px; }
.nr-btn.small { min-width:0; padding:9px 20px; font-size:13px; }
.nr-linkbtn { margin:7px 0; padding:13px 36px; font-size:17px; font-weight:800; letter-spacing:2px; color:#ff9a8a; background:rgba(80,20,20,0.35); border:2px solid rgba(255,120,100,0.4); border-radius:10px; cursor:pointer; min-width:320px; text-align:center; text-decoration:none; transition:transform 0.1s, box-shadow 0.15s; }
.nr-linkbtn:hover { transform:translateY(-2px); box-shadow:0 6px 22px rgba(255,120,100,0.35); }
.nr-keys { font-size:12.5px; color:rgba(255,255,255,0.7); line-height:1.9; margin-top:18px; text-align:center; }
.nr-keys b { color:#ffd24a; }
#nr-select-title { font-size:38px; font-weight:900; letter-spacing:6px; text-shadow:0 0 24px rgba(90,220,255,0.7); }
#nr-select-sub { font-size:16px; color:#8fd8ff; margin-top:4px; letter-spacing:2px; }
#nr-cards { display:flex; gap:12px; margin-top:14px; flex-wrap:wrap; justify-content:center; }
.nr-card { width:188px; background:rgba(10,14,30,0.92); border:2px solid rgba(140,180,255,0.22); border-radius:12px; padding:11px; cursor:pointer; text-align:left; transition:transform 0.12s, border-color 0.12s, box-shadow 0.15s; }
.nr-card:hover { transform:translateY(-3px); border-color:rgba(140,220,255,0.6); }
.nr-card.sel { border-color:#fff; box-shadow:0 0 14px rgba(255,255,255,0.35); }
.nr-card.p1pick { border-color:#ff6a4a; box-shadow:0 0 18px rgba(255,106,74,0.5); }
.nr-card.p2pick { border-color:#7ae8ff; box-shadow:0 0 18px rgba(122,232,255,0.4); }
.nr-chip { height:13px; border-radius:4px; margin-bottom:8px; }
.nr-card h3 { margin:0 0 2px; font-size:19px; letter-spacing:2px; }
.nr-t { font-size:12px; color:#8fd8ff; margin-bottom:6px; }
.nr-spec { font-size:11.5px; color:#ffd24a; margin-bottom:8px; line-height:1.5; }
.nr-stat { display:flex; align-items:center; gap:6px; font-size:10px; color:rgba(255,255,255,0.65); margin-top:3px; }
.nr-stat i { flex:1; height:5px; background:rgba(255,255,255,0.14); border-radius:3px; overflow:hidden; display:block; }
.nr-stat i b { display:block; height:100%; background:linear-gradient(90deg,#22c8e8,#7ae8ff); }
.nr-desc { font-size:10.5px; color:rgba(255,255,255,0.6); line-height:1.4; margin-top:7px; min-height:44px; }
.nr-rows { display:flex; gap:26px; margin-top:14px; flex-wrap:wrap; justify-content:center; align-items:center; }
.nr-rowlabel { font-size:11px; color:rgba(255,255,255,0.6); letter-spacing:2px; margin-right:8px; }
.nr-chipbtn { padding:7px 14px; font-size:12px; font-weight:700; letter-spacing:1px; color:#bcd8ff; background:rgba(255,255,255,0.06); border:1px solid rgba(140,180,255,0.3); border-radius:8px; cursor:pointer; margin:3px; }
.nr-chipbtn.on { color:#06121f; background:#7ae8ff; border-color:#7ae8ff; box-shadow:0 0 12px rgba(122,232,255,0.5); }
#nr-select-hint { margin-top:14px; font-size:13px; color:rgba(255,255,255,0.75); letter-spacing:1px; }
.nr-settings-title { font-size:40px; font-weight:900; letter-spacing:6px; text-shadow:0 0 24px rgba(90,220,255,0.7); margin-bottom:14px; }
#nr-settings-keys { display:flex; gap:40px; margin:10px 0; }
.nr-kcol { min-width:230px; }
.nr-khead { font-size:13px; font-weight:800; letter-spacing:3px; color:#ffd24a; margin-bottom:8px; }
.nr-krow { display:flex; justify-content:space-between; align-items:center; margin:5px 0; font-size:13px; color:rgba(255,255,255,0.85); }
.nr-kbtn { min-width:86px; padding:5px 10px; font-size:12px; font-weight:700; color:#cfe8ff; background:rgba(255,255,255,0.08); border:1px solid rgba(140,180,255,0.35); border-radius:6px; cursor:pointer; }
.nr-kbtn:hover { background:rgba(255,255,255,0.18); }
.nr-kbtn.capture { color:#06121f; background:#ffe066; border-color:#ffe066; }
.nr-pause-title { font-size:42px; font-weight:900; letter-spacing:8px; text-shadow:0 0 24px rgba(90,220,255,0.7); margin-bottom:16px; }
#nr-end-name { font-size:48px; font-weight:900; letter-spacing:6px; text-shadow:0 0 30px rgba(90,220,255,0.8), 0 5px 0 #0a2a3a; margin:10px 0; }
#nr-end-sub { font-size:17px; color:#8fd8ff; letter-spacing:2px; margin-bottom:22px; }
`;

export function initHud(wrapEl: HTMLDivElement, canvasEl: HTMLCanvasElement) {
  canvasElRef = canvasEl;
  ui = document.createElement("div");
  ui.id = "nr-ui";
  ui.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  ui.innerHTML = `
<style>${CSS}</style>
<div id="nr-hud">
  <div id="nr-top">
    <div class="nr-panel nr-p1">
      <div class="nr-name"><span class="nr-np">P1</span> <span id="nr-name0">—</span></div>
      <div class="nr-hpbar"><div class="nr-hpfill" id="nr-hp0"></div></div>
      <div class="nr-stbar"><div class="nr-stfill" id="nr-st0"></div></div>
      <div class="nr-pips" id="nr-pips0"></div>
    </div>
    <div class="nr-timerbox">
      <div class="nr-timer" id="nr-timer">60</div>
      <div class="nr-round" id="nr-round">ROUND 1</div>
    </div>
    <div class="nr-panel nr-p2">
      <div class="nr-name"><span id="nr-name1">—</span> <span class="nr-np">P2</span></div>
      <div class="nr-hpbar"><div class="nr-hpfill" id="nr-hp1"></div></div>
      <div class="nr-stbar"><div class="nr-stfill" id="nr-st1"></div></div>
      <div class="nr-pips" id="nr-pips1"></div>
    </div>
  </div>
  <div id="nr-banner"><div id="nr-banner-main"></div><div id="nr-banner-sub"></div></div>
  <div id="nr-combo"></div>
  <div id="nr-milestone"></div>
  <div id="nr-guardflash"></div>
  <div id="nr-dmg"></div>
  <div id="nr-training">TRAINING</div>
  <div id="nr-hint"></div>
</div>
<div id="nr-menu" class="nr-screen">
  <div class="nr-title">NEON RIVALS</div>
  <div class="nr-subtitle">ORIGINAL 3D FIGHTING</div>
  <button class="nr-btn" id="nr-btn-fight">⚔ FIGHT</button>
  <button class="nr-btn" id="nr-btn-training">🎯 TRAINING</button>
  <button class="nr-btn" id="nr-btn-select">👤 CHARACTER SELECT</button>
  <button class="nr-btn" id="nr-btn-settings">⚙ SETTINGS</button>
  <a class="nr-linkbtn" href="/">🏠 BACK TO GAME HUB</a>
  <div class="nr-keys" id="nr-menu-keys"></div>
</div>
<div id="nr-select" class="nr-screen" style="display:none">
  <div id="nr-select-title">SELECT YOUR FIGHTER</div>
  <div id="nr-select-sub"></div>
  <div id="nr-cards"></div>
  <div class="nr-rows"><span class="nr-rowlabel">ARENA</span><div id="nr-arena-row"></div></div>
  <div class="nr-rows" id="nr-diff-wrap"><span class="nr-rowlabel">DIFFICULTY</span><div id="nr-diff-row"></div></div>
  <div id="nr-select-hint"></div>
  <button class="nr-btn ghost small" id="nr-btn-select-back">← BACK</button>
</div>
<div id="nr-settings" class="nr-screen" style="display:none">
  <div class="nr-settings-title">SETTINGS</div>
  <div id="nr-settings-keys"></div>
  <button class="nr-btn" id="nr-btn-sound-settings">🔊 SOUND: ON</button>
  <button class="nr-btn ghost" id="nr-btn-keys-reset">↺ RESET KEYS</button>
  <button class="nr-btn ghost" id="nr-btn-settings-back">← BACK</button>
</div>
<div id="nr-pause" class="nr-screen" style="display:none">
  <div class="nr-pause-title">PAUSED</div>
  <button class="nr-btn" id="nr-btn-resume">▶ RESUME</button>
  <button class="nr-btn ghost" id="nr-btn-pause-settings">⚙ SETTINGS</button>
  <button class="nr-btn ghost" id="nr-btn-sound-pause">🔊 SOUND: ON</button>
  <button class="nr-btn ghost" id="nr-btn-pause-menu">🏠 MAIN MENU</button>
  <div class="nr-keys"><b>Esc/P:</b> resume · <b>M:</b> sound</div>
</div>
<div id="nr-end" class="nr-screen" style="display:none">
  <div class="nr-title" style="font-size:34px;">MATCH OVER</div>
  <div id="nr-end-name"></div>
  <div id="nr-end-sub"></div>
  <button class="nr-btn" id="nr-btn-rematch">🔄 REMATCH</button>
  <button class="nr-btn" id="nr-btn-end-select">👤 CHARACTER SELECT</button>
  <button class="nr-btn ghost" id="nr-btn-end-menu">🏠 MAIN MENU</button>
</div>
`;
  wrapEl.appendChild(ui);

  const on = (id: string, fn: () => void) => {
    const el = document.getElementById("nr-" + id) as HTMLElement | null;
    if (el) el.addEventListener("click", fn);
  };
  on("btn-fight", () => { AudioSys.uiSelect(); HUD.actions.onMenuFight(); });
  on("btn-training", () => { AudioSys.uiSelect(); HUD.actions.onMenuTraining(); });
  on("btn-select", () => { AudioSys.uiSelect(); HUD.actions.onMenuSelect(); });
  on("btn-settings", () => { AudioSys.uiSelect(); HUD.actions.onMenuSettings(); });
  on("btn-select-back", () => { AudioSys.uiSelect(); HUD.actions.onQuitToMenu(); });
  on("btn-settings-back", () => { AudioSys.uiSelect(); HUD.actions.onSettingsBack(); });
  on("btn-keys-reset", () => {
    G.settings.keys = structuredClone(DEFAULT_KEYS);
    saveSettings();
    renderSettingsTable();
    updateHint();
    AudioSys.uiMove();
  });
  on("btn-sound-settings", toggleSound);
  on("btn-sound-pause", toggleSound);
  on("btn-resume", () => { AudioSys.uiSelect(); HUD.actions.onResume(); });
  on("btn-pause-settings", () => { AudioSys.uiSelect(); showSettings("pause"); });
  on("btn-pause-menu", () => { AudioSys.uiSelect(); HUD.actions.onQuitToMenu(); });
  on("btn-rematch", () => { AudioSys.uiSelect(); HUD.actions.onRematch(); });
  on("btn-end-select", () => { AudioSys.uiSelect(); HUD.actions.onEndCharSelect(); });
  on("btn-end-menu", () => { AudioSys.uiSelect(); HUD.actions.onQuitToMenu(); });

  const mb = document.createElement("button");
  mb.id = "nr-mute";
  mb.textContent = "🔊";
  mb.addEventListener("click", toggleSound);
  wrapEl.appendChild(mb);

  updateHint();
  syncSoundLabels();
}

/* ================= per-frame UI update ================= */
export function updateHud(rdt: number) {
  const set = (id: string, v: string) => {
    const el = $id(id);
    if (el) el.textContent = v;
  };
  const w = (id: string, pct: number, low = false) => {
    const el = $id(id);
    if (!el) return;
    el.style.width = Math.max(0, Math.min(100, pct)) + "%";
    el.classList.toggle("low", low);
  };
  if (G.fighters.length < 2) return;
  G.fighters.forEach((f, i) => {
    set("name" + i, f.cfg.name);
    w("hp" + i, (f.hp / HP_MAX) * 100);
    w("st" + i, (f.stamina / STAMINA_MAX) * 100, f.stamina < 25);
    set("pips" + i, "●".repeat(f.wins) + "○".repeat(Math.max(0, WINS_NEEDED - f.wins)));
  });
  const timer = $id("timer");
  if (timer) {
    if (G.training) {
      timer.textContent = "∞";
      timer.classList.remove("low");
    } else {
      const t = Math.ceil(G.roundTime);
      timer.textContent = String(Math.max(0, t));
      timer.classList.toggle("low", t <= 10);
    }
  }
  const round = $id("round");
  if (round) round.textContent = G.training ? "TRAINING" : "ROUND " + G.round;
  const tr = $id("training");
  if (tr) tr.style.display = G.training ? "block" : "none";

  // banner
  if (G.banner.t > 0) {
    G.banner.t -= rdt;
    if (G.banner.t <= 0) $id("banner")?.classList.remove("show");
  }

  // combo counter
  const comboEl = $id("combo");
  if (comboEl) {
    let show = "";
    for (const f of G.fighters) {
      if ((!f.isAI || G.training) && f.combo >= (G.training ? 1 : 2) && f.comboT > 0) {
        show = f.combo + " HIT";
        break;
      }
    }
    if (comboEl.textContent !== show) comboEl.textContent = show;
    comboEl.style.display = show ? "block" : "none";
  }

  // milestone flash
  if (G.comboMilestone > 0) {
    milestoneN = G.comboMilestone;
    milestoneT = 0.9;
    G.comboMilestone = 0;
  }
  const ms = $id("milestone");
  if (ms) {
    if (milestoneT > 0) {
      milestoneT -= rdt;
      ms.textContent = milestoneN + " HIT!";
      ms.style.opacity = "1";
      ms.style.transform = "scale(" + (1 + (0.9 - milestoneT) * 0.6) + ")";
    } else {
      ms.style.opacity = "0";
    }
  }

  // guard break flash
  const gf = $id("guardflash");
  if (gf) {
    if (G.guardBreakFlash > 0) {
      G.guardBreakFlash = Math.max(0, G.guardBreakFlash - rdt * 2.5);
      gf.style.opacity = G.guardBreakFlash.toFixed(2);
    }
  }

  // damage numbers
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i];
    d.life -= rdt;
    d.el.style.top = (parseFloat(d.el.style.top) - d.vy * rdt) + "px";
    d.el.style.opacity = Math.max(0, d.life / 0.7).toFixed(2);
    if (d.life <= 0) {
      d.el.remove();
      dmgNums.splice(i, 1);
    }
  }
}
