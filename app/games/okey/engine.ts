/*
 * 101 Okey — Türk okey (Rummikub tarzı) taşı oyunu, DOM tabanlı.
 * 108 taş: sayılar 1-9 × 6 renk × 2 adet.
 *  - Renk: aynı renkten üst üste 3+ sayı
 *  - Karma: aynı sayıdan 3+ farklı renk
 *  - İlk açılış toplamı 101+ olmalı (bu yüzden "101 Okey")
 *  - Sıradaki hamle: yeni set kurmak VEYA mevcut bir sete tek taş eklemek
 *  - Her tur 1 taş çekilir, oynanır veya geçilir; 3 ardışık geçiş = elenme
 *  - Turu ilk bitiren 0 ceza alır, kalanlar elindeki taşların toplamı kadar ceza alır
 *  - Toplam ceza -101'e ilk ulaşan maçı kazanır.
 */

type Tile = { id: number; c: number; n: number };
type TSet = { owner: number; tiles: Tile[] };
type Player = {
  name: string;
  isHuman: boolean;
  opened: boolean;
  out: boolean;
  passCount: number;
  score: number;
  penalty: number | null; // this round, when out early
};
type MoveSpec =
  | { kind: "sets"; sets: Tile[][] }
  | { kind: "extend"; tile: Tile; setIdx: number };
type Phase = "menu" | "play" | "roundEnd" | "matchEnd";

const COLOR_BG = ["#e5484d", "#3b82f6", "#16a34a", "#92610f", "#db2777", "#374151"];
const COLOR_NAME = ["Kırmızı", "Mavi", "Yeşil", "Kahve", "Pembe", "Siyah"];
const PLAYER_TAG = ["#fbbf24", "#94a3b8", "#c084fc", "#4ade80"];
const HUMAN_NAME = "Sen";
const BOT_NAMES = ["Bot", "Bot", "Bot"];
const OPENING_MIN = 101;
const MATCH_TARGET = -101;
const HAND_SIZE = 14;

function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}

/* ---------------- rules (pure) ---------------- */

function isRun(tiles: Tile[]): boolean {
  if (tiles.length < 3) return false;
  const c = tiles[0].c;
  if (!tiles.every((t) => t.c === c)) return false;
  const ns = tiles.map((t) => t.n).sort((a, b) => a - b);
  for (let i = 1; i < ns.length; i++) if (ns[i] !== ns[i - 1] + 1) return false;
  return true;
}

function isGroup(tiles: Tile[]): boolean {
  if (tiles.length < 3) return false;
  const n = tiles[0].n;
  if (!tiles.every((t) => t.n === n)) return false;
  return new Set(tiles.map((t) => t.c)).size === tiles.length;
}

const isValidSet = (t: Tile[]) => isRun(t) || isGroup(t);

function sortSetTiles(tiles: Tile[]): Tile[] {
  const run = isRun(tiles);
  return [...tiles].sort((a, b) =>
    run ? a.n - b.n : a.c - b.c || a.n - b.n
  );
}

/** Can `tile` be added to the existing set? */
function canExtend(set: TSet, tile: Tile): boolean {
  return isValidSet([...set.tiles, tile]);
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

/**
 * Partition tiles into valid sets (3+ each). Returns null if impossible.
 * Tries larger sets first so openings spread nicely.
 */
function partitionIntoSets(tiles: Tile[]): Tile[][] | null {
  if (tiles.length === 0) return [];
  if (tiles.length < 3) return null;
  const arr = [...tiles].sort((a, b) => a.n - b.n || a.c - b.c);
  const first = arr[0];
  const cands: Tile[][] = [];
  // runs containing `first`
  for (let len = 3; len <= 9; len++) {
    for (let off = 0; off < len; off++) {
      const startN = first.n - off;
      if (startN < 1 || startN + len - 1 > 9) continue;
      const need: Tile[] = [];
      let ok = true;
      for (let k = 0; k < len; k++) {
        const n = startN + k;
        const t =
          n === first.n ? first : arr.find((x) => x.n === n && x.c === first.c);
        if (!t) { ok = false; break; }
        need.push(t);
      }
      if (ok) cands.push(need);
    }
  }
  // groups containing `first`
  const others = arr.filter((t) => t.n === first.n && t.c !== first.c);
  for (let len = 3; len <= 6; len++) {
    const need = len - 1;
    if (need > others.length) continue;
    for (const combo of combinations(others, need)) cands.push([first, ...combo]);
  }
  cands.sort((a, b) => b.length - a.length);
  const ids = (c: Tile[]) => new Set(c.map((t) => t.id));
  for (const cand of cands) {
    const candIds = ids(cand);
    const rest = arr.filter((t) => !candIds.has(t.id));
    const sub = partitionIntoSets(rest);
    if (sub) return [cand, ...sub];
  }
  return null;
}

/** All valid sets fully contained in `hand` (runs + groups). */
function allSetsInHand(hand: Tile[]): Tile[][] {
  const out: Tile[][] = [];
  // runs
  for (let c = 0; c < 6; c++) {
    for (let startN = 1; startN <= 9; startN++) {
      for (let len = 3; len <= 9; len++) {
        if (startN + len - 1 > 9) break;
        const tiles: Tile[] = [];
        let ok = true;
        for (let k = 0; k < len; k++) {
          const t = hand.find((x) => x.c === c && x.n === startN + k);
          if (!t) { ok = false; break; }
          tiles.push(t);
        }
        if (ok) out.push(tiles);
      }
    }
  }
  // groups
  for (let n = 1; n <= 9; n++) {
    const byNum = hand.filter((t) => t.n === n);
    const distinct: Tile[] = [];
    const seenC = new Set<number>();
    for (const t of byNum) {
      if (!seenC.has(t.c)) { seenC.add(t.c); distinct.push(t); }
    }
    for (let len = 3; len <= Math.min(6, distinct.length); len++) {
      for (const combo of combinations(distinct, len)) out.push(combo);
    }
  }
  return out;
}

const sumOf = (tiles: Tile[]) => tiles.reduce((a, t) => a + t.n, 0);

/** Best opening combination (disjoint sets totalling >= 101, max total). */
function findBestOpening(hand: Tile[]): { sets: Tile[][]; sum: number } | null {
  const sets = allSetsInHand(hand);
  const sums = sets.map(sumOf);
  let best: { sets: Tile[][]; sum: number } | null = null;
  // id-tabanlı kaplılık (bitmask 32+ taşta çakışıyor — el zamanla büyür)
  const used = new Set<number>();
  // avoid duplicate combos: enforce ascending index order
  const recAsc = (start: number, total: number, chosen: number[]) => {
    if (total >= OPENING_MIN && (!best || total > best.sum)) {
      best = { sets: chosen.map((i) => sets[i]), sum: total };
    }
    let rem = 0;
    for (const t of hand) if (!used.has(t.id)) rem += t.n;
    if (total + rem <= (best?.sum ?? OPENING_MIN - 1)) return;
    for (let i = start; i < sets.length; i++) {
      if (sets[i].some((t) => used.has(t.id))) continue;
      for (const t of sets[i]) used.add(t.id);
      chosen.push(i);
      recAsc(i + 1, total + sums[i], chosen);
      chosen.pop();
      for (const t of sets[i]) used.delete(t.id);
    }
  };
  recAsc(0, 0, []);
  return best;
}

/** Best move for a player who already opened. */
function chooseFollowUp(hand: Tile[], table: TSet[]): MoveSpec | null {
  let bestScore = 0;
  let best: MoveSpec | null = null;
  // 1) best pair of new disjoint sets
  const sets = allSetsInHand(hand);
  for (let i = 0; i < sets.length; i++) {
    const idsI = new Set(sets[i].map((t) => t.id));
    for (let j = i + 1; j < sets.length; j++) {
      if (sets[j].some((t) => idsI.has(t.id))) continue;
      const sc = sumOf(sets[i]) + sumOf(sets[j]);
      if (sc > bestScore) {
        bestScore = sc;
        best = { kind: "sets", sets: [sets[i], sets[j]] };
      }
    }
  }
  // 2) single new set
  for (const s of sets) {
    const sc = sumOf(s);
    if (sc > bestScore) {
      bestScore = sc;
      best = { kind: "sets", sets: [s] };
    }
  }
  // 3) single-tile extension of a table set
  for (let si = 0; si < table.length; si++) {
    for (const t of hand) {
      if (canExtend(table[si], t)) {
        if (t.n > bestScore) {
          bestScore = t.n;
          best = { kind: "extend", tile: t, setIdx: si };
        }
      }
    }
  }
  return best;
}

/* ---------------- game ---------------- */

export function startGame(root: HTMLElement): () => void {
  let stopped = false;
  let phase: Phase = "menu";
  let players: Player[] = [];
  let hands: Tile[][] = [];
  let table: TSet[] = [];
  let pool: Tile[] = [];
  let turn = 0;
  let roundNum = 1;
  let passesSincePlay = 0;
  let selection = new Set<number>();
  let busy = true;
  let toastTimer: number | null = null;
  // Yeni maç/tur başladığında artar — bekleyen eski bot sleep'leri yeni
  // turda hayalet hamle yapmasın (MENÜ→BAŞLA hızlı tıklama yarışı).
  let matchGen = 0;

  /* ---------- DOM skeleton ---------- */
  const css = `
  .ok { position:absolute; inset:0; display:flex; flex-direction:column; color:#e5e7eb;
    font-family: ui-sans-serif, system-ui, sans-serif; background:
    radial-gradient(1200px 600px at 50% -10%, #1e3a5f55, transparent 60%),
    radial-gradient(900px 500px at 90% 110%, #3b1e5f44, transparent 60%), #0b1020;
    overflow:hidden; user-select:none; }
  .ok-top { display:flex; align-items:center; gap:14px; padding:10px 16px; border-bottom:1px solid #ffffff14; }
  .ok-title { font-weight:900; font-size:18px; letter-spacing:1px; color:#fbbf24; }
  .ok-stat { font-size:13px; background:#ffffff10; border:1px solid #ffffff18; padding:4px 10px; border-radius:999px; }
  .ok-status { margin-left:auto; font-size:14px; font-weight:700; color:#a5f3fc; }
  .ok-main { flex:1; display:flex; flex-direction:column; min-height:0; padding:8px 12px 4px; gap:6px; }
  .ok-opp { display:flex; gap:8px; justify-content:center; }
  .opp { display:flex; flex-direction:column; align-items:center; gap:3px; min-width:118px; padding:7px 10px;
    border-radius:12px; background:#ffffff08; border:2px solid #ffffff14; transition:box-shadow .2s, border-color .2s; }
  .opp.active { border-color:#fbbf24; box-shadow:0 0 18px #fbbf2455; }
  .opp-name { font-size:12px; font-weight:800; display:flex; align-items:center; gap:6px; }
  .opp-tag { width:9px; height:9px; border-radius:50%; display:inline-block; }
  .opp-meta { font-size:11px; color:#9ca3af; display:flex; gap:8px; }
  .opp-badge { font-size:10px; font-weight:800; padding:1px 7px; border-radius:999px; background:#ffffff14; color:#d1d5db; }
  .opp-badge.open { background:#16a34a33; color:#4ade80; }
  .opp-badge.outb { background:#e5484d33; color:#fca5a5; }
  .opp-score { font-size:13px; font-weight:900; color:#fbbf24; }
  .ok-table { flex:1; min-height:0; display:flex; flex-wrap:wrap; align-content:center; justify-content:center;
    gap:8px; padding:8px; border-radius:14px; background:#14532d22; border:1px dashed #22c55e33; overflow:auto; }
  .ok-table.empty::after { content:"Masaya ilk seti koy…"; color:#6b7280; font-size:13px; align-self:center; }
  .setrow { display:flex; align-items:center; gap:3px; padding:4px 8px; border-radius:10px;
    background:#0b1020aa; border:1.5px solid #ffffff22; }
  .setrow.canext { border-color:#fbbf24; box-shadow:0 0 12px #fbbf2466; cursor:pointer; animation:okpulse 1s infinite; }
  @keyframes okpulse { 0%,100% { box-shadow:0 0 6px #fbbf2433; } 50% { box-shadow:0 0 16px #fbbf24aa; } }
  .setowner { width:8px; height:8px; border-radius:50%; margin-right:4px; flex:none; }
  .tile { position:relative; width:44px; height:60px; border-radius:8px; flex:none; display:flex; align-items:center;
    justify-content:center; font-size:26px; font-weight:900; color:#fff; text-shadow:0 1px 2px #0008;
    background:linear-gradient(160deg, #ffffff2e, #ffffff05 40%), var(--tb);
    box-shadow:0 3px 6px #0007, inset 0 1px 0 #ffffff40; cursor:pointer; transition:transform .12s, box-shadow .12s; }
  .tile.small { width:32px; height:42px; font-size:18px; cursor:default; }
  .tile.sel { transform:translateY(-10px); box-shadow:0 0 0 3px #fbbf24, 0 8px 14px #000a; }
  .tile.drawn { animation:okdraw .3s ease-out; }
  @keyframes okdraw { from { transform:scale(.4); opacity:0; } to { transform:scale(1); opacity:1; } }
  .tile.pop { animation:okpop .25s ease-out; }
  @keyframes okpop { from { transform:scale(.5); } to { transform:scale(1); } }
  .ok-bottom { display:flex; align-items:flex-end; gap:12px; padding:6px 8px 12px; }
  .ok-hand { flex:1; display:flex; gap:5px; align-items:flex-end; flex-wrap:wrap; min-height:66px; padding:6px 8px;
    border-radius:12px; background:#ffffff08; border:1px solid #ffffff12; }
  .ok-ctl { display:flex; flex-direction:column; gap:6px; align-items:stretch; }
  .ok-btn { font:inherit; font-weight:900; font-size:14px; letter-spacing:.5px; padding:9px 18px; border-radius:10px;
    border:1px solid #ffffff26; background:#ffffff12; color:#e5e7eb; cursor:pointer; transition:transform .1s, background .15s; }
  .ok-btn:hover:not(:disabled) { background:#ffffff22; transform:translateY(-1px); }
  .ok-btn:disabled { opacity:.4; cursor:default; }
  .ok-btn.primary { background:linear-gradient(180deg,#f59e0b,#d97706); border-color:#fbbf24; color:#1f2937; }
  .ok-btn.danger { background:#e5484d22; border-color:#e5484d55; color:#fca5a5; }
  .ok-info { font-size:12px; color:#9ca3af; min-height:16px; text-align:right; }
  .ok-info.bad { color:#fca5a5; }
  .ok-info.good { color:#4ade80; }
  .ok-toast { position:absolute; left:50%; bottom:120px; transform:translateX(-50%); background:#111827ee;
    border:1px solid #fbbf2466; color:#fde68a; font-weight:700; font-size:14px; padding:8px 18px; border-radius:999px;
    opacity:0; pointer-events:none; transition:opacity .25s; z-index:30; }
  .ok-toast.show { opacity:1; }
  .ok-ov { position:absolute; inset:0; background:#0b1020dd; display:flex; align-items:center; justify-content:center; z-index:40; }
  .ok-card { width:min(560px, 92%); max-height:88%; overflow:auto; background:linear-gradient(180deg,#111a2e,#0d1424);
    border:1px solid #ffffff22; border-radius:18px; padding:26px 28px; text-align:center; box-shadow:0 20px 60px #000c; }
  .ok-card h1 { margin:0 0 4px; font-size:30px; font-weight:900; color:#fbbf24; letter-spacing:2px; }
  .ok-card h2 { margin:0 0 10px; font-size:15px; color:#9ca3af; font-weight:600; }
  .ok-pick { display:flex; gap:10px; justify-content:center; margin:18px 0; }
  .ok-pick .ok-btn { min-width:96px; }
  .ok-pick .ok-btn.on { background:linear-gradient(180deg,#f59e0b,#d97706); color:#1f2937; border-color:#fbbf24; }
  .ok-rules { text-align:left; font-size:13px; color:#d1d5db; line-height:1.65; background:#ffffff08;
    border:1px solid #ffffff14; border-radius:12px; padding:14px 16px; margin:14px 0; }
  .ok-rules b { color:#fbbf24; }
  .ok-scores { display:flex; flex-direction:column; gap:6px; margin:14px 0; }
  .ok-score-row { display:flex; align-items:center; gap:10px; justify-content:center; font-size:14px; }
  .ok-score-row .opp-tag { width:10px; height:10px; }
  .ok-score-row b { color:#fbbf24; }
  .ok-score-row .pen { color:#fca5a5; font-weight:800; }
  .ok-score-row .pen.zero { color:#4ade80; }
  .ok-menufoot { font-size:11px; color:#6b7280; margin-top:14px; }
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  root.appendChild(styleEl);

  const el = document.createElement("div");
  el.className = "ok";
  el.innerHTML = `
    <div class="ok-top">
      <span class="ok-title">🀄 101 OKEY</span>
      <span class="ok-stat" data-ok="round">Tur 1</span>
      <span class="ok-stat" data-ok="pool">Destek: 0</span>
      <span class="ok-status" data-ok="status">—</span>
      <button class="ok-btn" data-ok="sound" style="padding:4px 10px;font-size:13px" title="Ses aç/kapat">🔊</button>
    </div>
    <div class="ok-main">
      <div class="ok-opp" data-ok="opp"></div>
      <div class="ok-table empty" data-ok="table"></div>
      <div class="ok-bottom">
        <div class="ok-hand" data-ok="hand"></div>
        <div class="ok-ctl">
          <button class="ok-btn primary" data-ok="play" disabled>OYNA</button>
          <button class="ok-btn danger" data-ok="pass" disabled>GEÇ</button>
          <button class="ok-btn" data-ok="hint" disabled>💡 İPUCU</button>
          <button class="ok-btn" data-ok="menu">MENÜ</button>
          <div class="ok-info" data-ok="info"></div>
        </div>
      </div>
    </div>
    <div class="ok-toast" data-ok="toast"></div>
    <div class="ok-ov" data-ok="menuov">
      <div class="ok-card">
        <h1>🀄 101 OKEY</h1>
        <h2>Klasik Türk okeyi — 101 topla, aç ve kazan!</h2>
        <div class="ok-pick" data-ok="pick">
          <button class="ok-btn" data-n="2">2 OYUNCU</button>
          <button class="ok-btn on" data-n="3">3 OYUNCU</button>
          <button class="ok-btn" data-n="4">4 OYUNCU</button>
        </div>
        <button class="ok-btn primary" data-ok="start" style="min-width:160px">▶ BAŞLA</button>
        <div style="margin-top:10px"><button class="ok-btn" data-ok="rules" style="font-size:12px">📜 KURALLAR</button></div>
        <div class="ok-menufoot">Kazanan: -101 ceza puanına ilk ulaşan oyuncu</div>
      </div>
    </div>
    <div class="ok-ov" data-ok="modal" style="display:none"></div>
  `;
  root.appendChild(el);
  const $ = (d: string) => el.querySelector(d) as HTMLElement;
  const oppBox = $('[data-ok="opp"]');
  const tableBox = $('[data-ok="table"]');
  const handBox = $('[data-ok="hand"]');
  const menuOv = $('[data-ok="menuov"]');
  const modalOv = $('[data-ok="modal"]');

  let pickN = 3;
  const pickBox = $('[data-ok="pick"]');
  pickBox.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-n]") as HTMLElement | null;
    if (!b) return;
    pickN = +b.dataset.n!;
    pickBox.querySelectorAll("[data-n]").forEach((x) => x.classList.toggle("on", x === b));
  });
  $('[data-ok="start"]').addEventListener("click", () => newMatch(pickN));
  $('[data-ok="rules"]').addEventListener("click", () => showRules());
  $('[data-ok="menu"]').addEventListener("click", () => backToMenu());
  $('[data-ok="play"]').addEventListener("click", humanPlay);
  $('[data-ok="pass"]').addEventListener("click", () => {
    if (phase !== "play" || busy || turn !== humanIdx()) return;
    sfx("pass");
    doPass(turn, true);
  });
  $('[data-ok="hint"]').addEventListener("click", humanHint);
  $('[data-ok="sound"]').addEventListener("click", () => {
    soundOn = !soundOn;
    ($('[data-ok="sound"]') as HTMLButtonElement).textContent = soundOn ? "🔊" : "🔇";
  });
  tableBox.addEventListener("click", (e) => {
    if (phase !== "play" || busy || turn !== humanIdx()) return;
    const row = (e.target as HTMLElement).closest("[data-seti]") as HTMLElement | null;
    if (!row) return;
    const si = +row.dataset.seti!;
    if (!players[humanIdx()].opened) {
      // 101 Okey kuralı: açılış (101+) yapmadan masa setlerine dokunulamaz.
      toast("Önce 101+ açılış yapmalısın");
    } else if (selection.size === 1 && canExtend(table[si], selTile()!)) {
      sfx("play");
      applyPlay(humanIdx(), { kind: "extend", tile: selTile()!, setIdx: si });
    } else if (selection.size >= 1) {
      toast("Bir sete tek taş eklenebilir");
    }
  });

  /* ---------- helpers ---------- */
  const humanIdx = () => players.findIndex((p) => p.isHuman);
  const selTile = () => {
    const id = [...selection][0];
    return hands[humanIdx()].find((t) => t.id === id) ?? null;
  };

  function toast(msg: string) {
    const t = $('[data-ok="toast"]');
    t.textContent = msg;
    t.classList.add("show");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.remove("show"), 1800);
  }

  /* ---------- sound ---------- */
  let soundOn = true;
  let ac: AudioContext | null = null;
  function sfx(kind: "draw" | "play" | "pass" | "win") {
    if (!soundOn) return;
    try {
      ac ??= new AudioContext();
      const notes: Record<string, [number, number, OscillatorType, number][]> = {
        draw: [[520, 0.06, "sine", 0.09]],
        play: [[660, 0.07, "triangle", 0.11], [880, 0.09, "triangle", 0.1]],
        pass: [[220, 0.12, "sawtooth", 0.05]],
        win: [[523, 0.1, "triangle", 0.11], [659, 0.1, "triangle", 0.11], [784, 0.16, "triangle", 0.11]],
      };
      let at = ac.currentTime;
      for (const [f, d, type, g] of notes[kind]) {
        const o = ac.createOscillator();
        const gain = ac.createGain();
        o.type = type;
        o.frequency.value = f;
        gain.gain.setValueAtTime(g, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + d);
        o.connect(gain);
        gain.connect(ac.destination);
        o.start(at);
        o.stop(at + d + 0.02);
        at += d * 0.85;
      }
    } catch {
      /* ses yoksa oyun sessiz devam eder */
    }
  }

  function makeTiles(): Tile[] {
    const t: Tile[] = [];
    let id = 0;
    for (let c = 0; c < 6; c++)
      for (let n = 1; n <= 9; n++)
        for (let k = 0; k < 2; k++) t.push({ id: id++, c, n });
    return t;
  }
  function shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const handSum = (i: number) => sumOf(hands[i]);

  function newMatch(n: number) {
    players = [
      { name: HUMAN_NAME, isHuman: true, opened: false, out: false, passCount: 0, score: 0, penalty: null },
      ...[0, 1, 2].slice(0, n - 1).map((i) => ({
        name: BOT_NAMES[i], isHuman: false, opened: false, out: false, passCount: 0, score: 0, penalty: null,
      })),
    ];
    roundNum = 1;
    menuOv.style.display = "none";
    dealRound();
  }

  function dealRound() {
    matchGen++;
    const tiles = shuffle(makeTiles());
    hands = players.map(() => []);
    for (let i = 0; i < players.length; i++)
      hands[i] = tiles.splice(0, HAND_SIZE);
    pool = tiles;
    table = [];
    passesSincePlay = 0;
    selection = new Set();
    players.forEach((p) => { p.opened = false; p.out = false; p.passCount = 0; p.penalty = null; });
    phase = "play";
    turn = 0;
    modalOv.style.display = "none";
    startTurn(true);
  }

  function backToMenu() {
    // Menü her an tıklanabilir; bekleyen bot turları phase kontrolüyle kendiliğinden durur.
    phase = "menu";
    busy = true;
    menuOv.style.display = "flex";
    modalOv.style.display = "none";
  }

  function drawTile(i: number): Tile | null {
    if (!pool.length) return null;
    const t = pool.pop()!;
    hands[i].push(t);
    return t;
  }

  async function startTurn(isDeal = false) {
    if (stopped) return;
    const gen = matchGen;
    const fresh = () => !stopped && phase === "play" && gen === matchGen;
    selection = new Set();
    renderAll();
    if (players[turn].isHuman) {
      busy = true;
      const t = drawTile(turn);
      renderAll();
      if (t) { flashTile(t.id, handBox); sfx("draw"); }
      await sleep(isDeal ? 250 : 420);
      if (!fresh()) return;
      busy = false;
      renderAll();
    } else {
      busy = true;
      renderAll();
      await sleep(650);
      if (!fresh()) return;
      const t = drawTile(turn);
      renderAll();
      if (t) sfx("draw");
      await sleep(500);
      if (!fresh()) return;
      const spec = aiChoose(turn);
      if (spec) {
        applyPlay(turn, spec);
        sfx("play");
        await sleep(650);
        if (!fresh()) return;
        endTurn();
      } else {
        sfx("pass");
        doPass(turn, false);
        if (phase === "play") endTurn();
      }
    }
  }

  function aiChoose(i: number): MoveSpec | null {
    const hand = hands[i];
    if (!players[i].opened) {
      const combo = findBestOpening(hand);
      if (combo) return { kind: "sets", sets: combo.sets };
      return null;
    }
    // Açılmış bot: küçük eleme oyununda hemen oynar; aksi halde %50 elinde
    // tutar (gerçek oyuncular gibi) — turlar uzar, insan oyuncu elini
    // büyütmek için daha çok tur kazanır.
    if (hand.length > 5 && Math.random() < 0.5) return null;
    return chooseFollowUp(hand, table);
  }

  function applyPlay(i: number, spec: MoveSpec) {
    const remove = (t: Tile) => {
      hands[i] = hands[i].filter((x) => x.id !== t.id);
    };
    if (spec.kind === "extend") {
      remove(spec.tile);
      table[spec.setIdx].tiles.push(spec.tile);
      table[spec.setIdx].tiles = sortSetTiles(table[spec.setIdx].tiles);
    } else {
      for (const s of spec.sets) {
        for (const t of s) remove(t);
        table.push({ owner: i, tiles: sortSetTiles(s) });
      }
    }
    players[i].opened = true;
    players[i].passCount = 0;
    passesSincePlay = 0;
    selection = new Set();
    renderAll();
    // check round win
    if (hands[i].length === 0) {
      roundEnd(i, "empty");
      return;
    }
    // continue after short beat via endTurn caller (AI awaits) — for human we end immediately:
    if (players[i].isHuman) endTurn();
  }

  function doPass(i: number, byHuman: boolean) {
    players[i].passCount++;
    passesSincePlay++;
    selection = new Set();
    if (players[i].passCount >= 3) {
      players[i].out = true;
      players[i].penalty = handSum(i);
      toast(`${players[i].name} 3. geçişle elendi!`);
      if (players.filter((p) => !p.out).length <= 1) {
        renderAll();
        roundEnd(remainingWinner(), "out");
        return;
      }
    } else {
      toast(`${players[i].name} geçti`);
    }
    renderAll();
    if (byHuman) endTurn();
  }

  function remainingWinner(): number {
    // pool empty / all out: lowest remaining sum wins
    let best = -1;
    let bestSum = Infinity;
    players.forEach((p, i) => {
      if (p.out) return;
      const s = p.penalty ?? handSum(i);
      if (s < bestSum) { bestSum = s; best = i; }
    });
    return best;
  }

  function endTurn() {
    if (phase !== "play") return;
    // pool empty deadlock: everyone passed since last play
    const nonOut = players.filter((p) => !p.out).length;
    if (!pool.length && passesSincePlay >= Math.max(1, nonOut)) {
      roundEnd(remainingWinner(), "pool");
      return;
    }
    let next = turn;
    do {
      next = (next + 1) % players.length;
    } while (players[next].out && next !== turn);
    turn = next;
    startTurn();
  }

  function roundEnd(winner: number, why: "empty" | "out" | "pool") {
    if (phase !== "play") return;
    players.forEach((p, i) => {
      if (p.penalty === null) {
        // Turu ilk bitiren (empty), son kalan (out) veya destek bitiminde en
        // düşük toplamı olan (pool) 0 ceza alır; diğerleri el toplamını öder.
        p.penalty = i === winner ? 0 : handSum(i);
      }
      p.score -= p.penalty;
    });
    const matchOver = players.some((p) => p.score <= MATCH_TARGET);
    // Maç bittiğinde faz ayrıdır — test kancaları (state) maç sonunu görebilsin.
    phase = matchOver ? "matchEnd" : "roundEnd";
    busy = true;
    sfx("win");
    renderAll();
    showRoundModal(winner, why, matchOver);
  }

  function showRoundModal(winner: number, why: string, matchOver: boolean) {
    const title = matchOver ? "🏆 MAÇ BİTTİ!" : `🔥 TUR BİTTİ!`;
    const reason =
      why === "empty" ? `${players[winner].name} elini bitirdi!` :
      why === "pool" ? "Destek bitti — en düşük toplam kazandı." :
      "Son kalan oyuncu turu kazandı.";
    const rows = players
      .map((p, i) => {
        const win = i === winner && why !== "pool" ? " ⭐" : "";
        const penCls = (p.penalty ?? 0) === 0 ? "pen zero" : "pen";
        return `<div class="ok-score-row">
          <span class="opp-tag" style="background:${PLAYER_TAG[i % 4]}"></span>
          <span>${p.name}${win}</span>
          <span class="${penCls}">−${p.penalty}</span>
          <b>${p.score}</b>
        </div>`;
      })
      .join("");
    modalOv.innerHTML = `
      <div class="ok-card">
        <h1>${title}</h1>
        <h2>${reason}</h2>
        <div class="ok-scores">${rows}</div>
        <button class="ok-btn primary" data-ok="next" style="min-width:180px">
          ${matchOver ? "🔄 YENİ MAÇ" : "▶ SONRAKİ TUR"}
        </button>
        <div style="margin-top:10px"><button class="ok-btn" data-ok="menu2" style="font-size:12px">Ana Menü</button></div>
      </div>`;
    modalOv.style.display = "flex";
    modalOv.querySelector('[data-ok="next"]')!.addEventListener("click", () => {
      if (matchOver) {
        players.forEach((p) => (p.score = 0));
        roundNum = 1;
      } else {
        roundNum++;
      }
      dealRound();
    });
    modalOv.querySelector('[data-ok="menu2"]')!.addEventListener("click", () => {
      phase = "menu";
      modalOv.style.display = "none";
      menuOv.style.display = "flex";
    });
  }

  function showRules() {
    modalOv.innerHTML = `
      <div class="ok-card">
        <h1 style="font-size:22px">📜 KURALLAR</h1>
        <div class="ok-rules">
          • <b>108 taş:</b> 1-9 sayıları, 6 renk, 2'şer adet.<br>
          • <b>Renk:</b> aynı renkten üst üste 3+ sayı (örn. kırmızı 4-5-6).<br>
          • <b>Karma:</b> aynı sayıdan 3+ farklı renk (örn. 7 kırmızı + 7 mavi + 7 yeşil).<br>
          • <b>Açılış:</b> ilk masaya koyuşun toplamı <b>101+</b> olmalı.<br>
          • Açıldıktan sonra: yeni set kurabilir veya mevcut bir sete <b>tek taş</b> ekleyebilirsin.<br>
          • Sıran: otomatik 1 taş çekilir, oynarsın veya <b>GEÇ</b>ersin. 3 ardışık geçiş = elenme.<br>
          • Destek biterse en düşük toplamı olan turu kazanır.<br>
          • Ceza: elinde kalan taşların toplamı. <b>-101'e ilk ulaşan maçı kazanır.</b>
        </div>
        <button class="ok-btn primary" data-ok="close" style="min-width:140px">KAPAT</button>
      </div>`;
    modalOv.style.display = "flex";
    modalOv.querySelector('[data-ok="close"]')!.addEventListener("click", () => {
      modalOv.style.display = "none";
    });
  }

  /* ---------- human actions ---------- */
  function humanPlay() {
    if (phase !== "play" || busy || turn !== humanIdx()) return;
    const hi = humanIdx();
    const sel = hands[hi].filter((t) => selection.has(t.id));
    if (sel.length < 3) { toast("En az 3 taş seç"); return; }
    const parts = partitionIntoSets(sel);
    if (!parts) { toast("Seçim geçerli kombinasyon değil"); return; }
    const sum = sumOf(sel);
    if (!players[hi].opened && sum < OPENING_MIN) {
      toast(`Açılış 101+ olmalı (şu an ${sum})`);
      return;
    }
    sfx("play");
    applyPlay(hi, { kind: "sets", sets: parts });
  }

  /** 💡 Highlight the best legal move for the human (same heuristics as AI). */
  function humanHint() {
    if (phase !== "play" || busy || turn !== humanIdx()) return;
    const hi = humanIdx();
    if (!players[hi].opened) {
      const combo = findBestOpening(hands[hi]);
      if (!combo) { toast("Açılış için 101+ kombinasyon yok — GEÇ"); return; }
      selection = new Set(combo.sets.flat().map((t) => t.id));
      toast(`Açılış önerisi: ${combo.sets.length} set, toplam ${combo.sum}`);
    } else {
      const mv = chooseFollowUp(hands[hi], table);
      if (!mv) { toast("Oyuncak bir şey yok — GEÇ"); return; }
      if (mv.kind === "sets") {
        selection = new Set(mv.sets.flat().map((t) => t.id));
        toast("Önerilen setler seçildi — OYNA'ya bas");
      } else {
        selection = new Set([mv.tile.id]);
        toast("Taş seçildi — parladığı sete tıkla");
      }
    }
    renderAll();
  }

  /* ---------- rendering ---------- */
  function flashTile(id: number, box: HTMLElement) {
    window.setTimeout(() => {
      const t = box.querySelector(`[data-tid="${id}"]`);
      if (t) t.classList.add("drawn");
    }, 10);
  }

  function tileEl(t: Tile, small: boolean, extra = ""): HTMLElement {
    const d = document.createElement("div");
    d.className = `tile${small ? " small" : ""} ${extra}`;
    d.style.setProperty("--tb", COLOR_BG[t.c]);
    d.dataset.tid = String(t.id);
    d.textContent = String(t.n);
    return d;
  }

  function renderAll() {
    if (phase === "menu") return;
    const hi = humanIdx();
    $('[data-ok="round"]').textContent = `Tur ${roundNum}`;
    $('[data-ok="pool"]').textContent = `Destek: ${pool.length}`;
    const status =
      phase === "matchEnd" ? "Maç bitti" :
      phase === "roundEnd" ? "Tur bitti" :
      busy ? `${players[turn].name} düşünüyor…` :
      hi === turn ? "Sıra sende!" : `${players[turn].name} oynuyor…`;
    $('[data-ok="status"]').textContent = status;

    // opponents (all players except human, in order)
    oppBox.innerHTML = "";
    players.forEach((p, i) => {
      if (i === hi) return;
      const d = document.createElement("div");
      d.className = "opp" + (i === turn && phase === "play" ? " active" : "");
      const badges =
        (p.out ? `<span class="opp-badge outb">ÇIKTI</span>` :
         p.opened ? `<span class="opp-badge open">AÇILDI</span>` : `<span class="opp-badge">KAPALI</span>`);
      d.innerHTML = `
        <div class="opp-name"><span class="opp-tag" style="background:${PLAYER_TAG[i % 4]}"></span>${p.name}</div>
        <div class="opp-meta"><span>🎴 ${p.out ? "?" : hands[i].length}</span>${badges}</div>
        <div class="opp-score">${p.score}</div>`;
      oppBox.appendChild(d);
    });
    // human card inline in hand area header
    const hp = players[hi];
    let handHead = handBox.querySelector(".handhead") as HTMLElement | null;
    if (!handHead) {
      handHead = document.createElement("div");
      handHead.className = "handhead";
      handBox.style.flexDirection = "column";
      handBox.style.alignItems = "stretch";
      handBox.prepend(handHead);
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;color:#9ca3af";
      row.innerHTML = `<b style="color:#fbbf24">${hp.name}</b><span class="hh-meta"></span><span class="hh-score" style="margin-left:auto;font-weight:900;color:#fbbf24"></span>`;
      handHead.appendChild(row);
      const wrap = document.createElement("div");
      wrap.className = "handwrap";
      wrap.style.cssText = "display:flex;gap:5px;flex-wrap:wrap";
      handBox.appendChild(wrap);
    }
    const meta = handHead.querySelector(".hh-meta")!;
    meta.textContent = hp.out ? "çıkış" : hp.opened ? "açıldı" : `açılış ${OPENING_MIN}+ gerekli`;
    handHead.querySelector(".hh-score")!.textContent = String(hp.score);

    // hand tiles
    const wrap = handBox.querySelector(".handwrap")!;
    wrap.innerHTML = "";
    const sorted = [...hands[hi]].sort((a, b) => a.c - b.c || a.n - b.n);
    for (const t of sorted) {
      const isSel = selection.has(t.id);
      const d = tileEl(t, false, isSel ? "sel" : "");
      d.addEventListener("click", () => {
        if (phase !== "play" || busy || turn !== hi) return;
        if (selection.has(t.id)) selection.delete(t.id);
        else {
          // 16 taşlık sınır: 14 taşlık tam el bile seçilebilir (açılış setleri)
          if (selection.size >= 16) { toast("Çok fazla taş"); return; }
          selection.add(t.id);
        }
        renderAll();
      });
      wrap.appendChild(d);
    }

    // table
    tableBox.innerHTML = "";
    tableBox.classList.toggle("empty", table.length === 0);
    const single =
      selection.size === 1 && !busy && turn === hi && phase === "play" && players[hi].opened
        ? selTile() : null;
    table.forEach((s, si) => {
      const row = document.createElement("div");
      row.className = "setrow";
      row.dataset.seti = String(si);
      if (single && canExtend(s, single)) row.classList.add("canext");
      const own = document.createElement("span");
      own.className = "setowner";
      own.style.background = PLAYER_TAG[s.owner % 4];
      row.appendChild(own);
      for (const t of s.tiles) row.appendChild(tileEl(t, true, "pop"));
      tableBox.appendChild(row);
    });

    // controls
    const myTurn = phase === "play" && !busy && turn === hi;
    const sel = hands[hi].filter((t) => selection.has(t.id));
    const playBtn = $('[data-ok="play"]') as HTMLButtonElement;
    const passBtn = $('[data-ok="pass"]') as HTMLButtonElement;
    const hintBtn = $('[data-ok="hint"]') as HTMLButtonElement;
    playBtn.disabled = !myTurn || sel.length < 3;
    passBtn.disabled = !myTurn;
    hintBtn.disabled = !myTurn;
    const info = $('[data-ok="info"]');
    info.className = "ok-info";
    if (sel.length >= 3) {
      const parts = partitionIntoSets(sel);
      const sum = sumOf(sel);
      const needOpen = !players[hi].opened && sum < OPENING_MIN;
      if (parts && !needOpen) { info.textContent = `✓ ${sel.length} taş, toplam ${sum}`; info.classList.add("good"); }
      else if (!parts) { info.textContent = "Geçersiz kombinasyon"; info.classList.add("bad"); }
      else { info.textContent = `Açılış 101+ olmalı (şu an ${sum})`; info.classList.add("bad"); }
    } else if (sel.length === 1 && players[hi].opened) {
      info.textContent = "Eklenebilecek sete tıkla";
    } else {
      info.textContent = "";
    }
  }

  renderAll();
  void busy;

  /* ---------- debug/test hook ---------- */
  (window as unknown as Record<string, unknown>).__okey = {
    state: () => ({
      phase,
      roundNum,
      turn,
      humanIdx: humanIdx(),
      poolCount: pool.length,
      busy,
      selection: [...selection],
      players: players.map((p, i) => ({
        name: p.name, isHuman: p.isHuman, opened: p.opened, out: p.out,
        passCount: p.passCount, score: p.score, penalty: p.penalty, handSize: hands[i].length,
      })),
      table: table.map((s) => ({ owner: s.owner, tiles: s.tiles.map((t) => ({ c: t.c, n: t.n })) })),
    }),
    hand: () =>
      hands[humanIdx()].map((t) => ({ id: t.id, c: t.c, n: t.n })),
    /** Best legal move for the human (same heuristics as AI). */
    suggest: () => {
      const hi = humanIdx();
      if (phase !== "play") return null;
      if (!players[hi].opened) {
        const combo = findBestOpening(hands[hi]);
        return combo ? { kind: "sets", sets: combo.sets.map((s) => s.map((t) => t.id)) } : null;
      }
      const mv = chooseFollowUp(hands[hi], table);
      if (!mv) return null;
      return mv.kind === "sets"
        ? { kind: "sets", sets: mv.sets.map((s) => s.map((t) => t.id)) }
        : { kind: "extend", tile: mv.tile.id, setIdx: mv.setIdx };
    },
    /** Apply a move spec (ids) for the human — same code path as the UI. */
    doMove: (spec: { kind: "sets"; sets: number[][] } | { kind: "extend"; tile: number; setIdx: number }) => {
      const hi = humanIdx();
      if (phase !== "play" || busy || turn !== hi) return "not-your-turn";
      if (spec.kind === "extend") {
        if (!players[hi].opened) return "not-opened";
        const t = hands[hi].find((x) => x.id === spec.tile);
        if (!t) return "bad-tile";
        if (!canExtend(table[spec.setIdx], t)) return "cannot-extend";
        applyPlay(hi, { kind: "extend", tile: t, setIdx: spec.setIdx });
      } else {
        const sets = spec.sets.map((ids) => ids.map((id) => hands[hi].find((x) => x.id === id)!)).filter((s) => s.length);
        const all = sets.flat();
        const seen = new Set<number>();
        for (const t of all) { if (seen.has(t.id)) return "dup"; seen.add(t.id); }
        for (const s of sets) if (!isValidSet(s)) return "invalid-set";
        const sum = sumOf(all);
        if (!players[hi].opened && sum < OPENING_MIN) return "need-101";
        applyPlay(hi, { kind: "sets", sets });
      }
      return "ok";
    },
    pass: () => {
      const hi = humanIdx();
      if (phase !== "play" || busy || turn !== hi) return "not-your-turn";
      doPass(hi, true);
      return "ok";
    },
    next: () => {
      const b = modalOv.querySelector('[data-ok="next"]') as HTMLButtonElement | null;
      if (b) { b.click(); return "ok"; }
      return "no-modal";
    },
    /** Test-only knobs for headless verification. */
    debug: {
      /** Havuzu n taşa indir (destek tükenme akışını test et). */
      setPool: (n: number) => { pool.length = Math.max(0, n | 0); return `pool=${pool.length}`; },
      /** Oyuncu i'nin elini verilen taşlarla değiştir (test kurulumu). */
      deal: (i: number, tiles: { c: number; n: number }[]) => {
        let base = 9000 + matchGen * 100;
        hands[i] = tiles.map((t) => ({ id: base++, c: t.c, n: t.n }));
        return `el=${hands[i].length}`;
      },
      /** Bot i açılışını hemen masaya koyar (varsa). */
      openBot: (i: number) => {
        const s = aiChoose(i);
        if (!s) return "no-opening";
        applyPlay(i, s);
        return "ok";
      },
    },
  };

  const stop = () => {
    stopped = true;
    busy = true;
    if (toastTimer) window.clearTimeout(toastTimer);
    el.remove();
    styleEl.remove();
  };
  return stop;
}
