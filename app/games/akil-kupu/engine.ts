/* =====================================================================
   AKIL KÜPÜ — SOMA Cube Puzzle — Game Engine
   Classic SOMA-brain-teaser: fit 7 colorful polycubes (27 cubes total)
   into a 3x3x3 cube. Fully DOM-based with CSS 3D transforms; touch-first.

   Controls:
     Tap a piece chip     select the piece
     Tap an empty cell    show a placement preview (centered on the tap)
     Tap the same cell    place the piece
     Hold a filled cell   remove that piece back to the tray
     🔄 Çevir             cycle the piece through all its rotations
     Drag on the 3D view  orbit the assembled cube

   Features: runtime orientation generation (24 rotation matrices),
   built-in backtracking solver (💡 Çözüm animasyonlu), timer + best
   time (localStorage), Web Audio SFX, win confetti.

   Public API:
     startGame(canvas) -> () => void   (returns a stop/cleanup function)
   ===================================================================== */

type Cell = [number, number, number];
interface Piece { name: string; color: string; cells: Cell[] }
interface Placement { piece: number; cells: number[] }
interface Preview { x: number; y: number; z: number }

const PIECES: Piece[] = [
  { name: "A", color: "#ef4444", cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] }, // kare
  { name: "L", color: "#3b82f6", cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]] }, // L
  { name: "T", color: "#f59e0b", cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0]] }, // T
  { name: "S", color: "#22c55e", cells: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0]] }, // S/zigzag
  { name: "P", color: "#a855f7", cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 1]] }, // 3D çıkıntı
  { name: "Z", color: "#ec4899", cells: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // 3D vidalı
  { name: "V", color: "#06b6d4", cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, // köşe (3 küp)
];

/* ================= 1. CORE: orientations + solver ================= */
function mulMat(a: number[][], b: number[][]): number[][] {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}
function allRotations(): number[][][] {
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const Ry = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]];
  const Rz = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
  const seen = new Map<string, number[][]>();
  const q: number[][][] = [I];
  while (q.length) {
    const m = q.shift() as number[][];
    const k = m.map((r) => r.join(",")).join(";");
    if (seen.has(k)) continue;
    seen.set(k, m);
    [Rx, Ry, Rz].forEach((r) => q.push(mulMat(r, m)));
  }
  return [...seen.values()];
}
function applyMat(m: number[][], v: Cell): Cell {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}
function normalize(cells: Cell[]): Cell[] {
  const mnX = Math.min(...cells.map((c) => c[0]));
  const mnY = Math.min(...cells.map((c) => c[1]));
  const mnZ = Math.min(...cells.map((c) => c[2]));
  return cells.map((c) => [c[0] - mnX, c[1] - mnY, c[2] - mnZ]);
}
function keyOf(cells: Cell[]): string {
  return cells.map((c) => c.join(",")).sort().join("|");
}
function generateOrientations(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  const seen = new Set<string>();
  for (const m of allRotations()) {
    const n = normalize(cells.map((c) => applyMat(m, c)));
    const k = keyOf(n);
    if (!seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}
const ORIENTATIONS: Cell[][][] = PIECES.map((p) => generateOrientations(p.cells));
function boundsOf(cells: Cell[]): { maxX: number; maxY: number; maxZ: number } {
  return {
    maxX: Math.max(...cells.map((c) => c[0])),
    maxY: Math.max(...cells.map((c) => c[1])),
    maxZ: Math.max(...cells.map((c) => c[2])),
  };
}
function idx(x: number, y: number, z: number): number { return x + y * 3 + z * 9; }

/** Backtracking SOMA solver: always fills the first empty cell. */
function solveSoma(ors: Cell[][][]): Placement[] | null {
  const occ = new Uint8Array(27);
  const result: Placement[] = [];
  const seen = new Set<string>();
  function firstEmpty(): number {
    for (let i = 0; i < 27; i++) if (!occ[i]) return i;
    return -1;
  }
  function mask(): number {
    let m = 0;
    for (let i = 0; i < 27; i++) if (occ[i]) m |= 1 << i;
    return m;
  }
  function dfs(remaining: number[]): boolean {
    const t = firstEmpty();
    if (t < 0) return true;
    const key = mask() + "|" + remaining.slice().sort((a, b) => a - b).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    for (const p of remaining) {
      for (const or of ors[p]) {
        for (const anchor of or) {
          const dx = (t % 3) - anchor[0];
          const dy = Math.floor(t / 3) % 3 - anchor[1];
          const dz = Math.floor(t / 9) - anchor[2];
          let ok = true;
          const cells: number[] = [];
          for (const c of or) {
            const x = c[0] + dx, y = c[1] + dy, z = c[2] + dz;
            if (x < 0 || x > 2 || y < 0 || y > 2 || z < 0 || z > 2) { ok = false; break; }
            const i = idx(x, y, z);
            if (occ[i]) { ok = false; break; }
            cells.push(i);
          }
          if (!ok) continue;
          cells.forEach((i) => (occ[i] = p + 1));
          result.push({ piece: p, cells });
          if (dfs(remaining.filter((r) => r !== p))) return true;
          result.pop();
          cells.forEach((i) => (occ[i] = 0));
        }
      }
    }
    return false;
  }
  return dfs(PIECES.map((_, i) => i)) ? result : null;
}

/* ================= 2. SCOPED STYLES ================= */
const CSS = `
.ak-root{--bg:#0b1220;--card:#151e31;--cell:#1e293b;--line:#334155;--txt:#e2e8f0;--muted:#94a3b8;--accent:#22d3ee;--cell-size:min(10.5vw,44px);--s:32px;--ms:13px;position:absolute;inset:0;z-index:10;overflow-y:auto;overflow-x:hidden;background:radial-gradient(1200px 800px at 50% -10%,#16233c,#0b1220);color:var(--txt);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
.ak-root *{box-sizing:border-box;margin:0;padding:0}
.ak-header{position:sticky;top:0;z-index:5;background:rgba(11,18,32,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:10px 12px}
.ak-hrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ak-title{font-size:18px;letter-spacing:.5px}
.ak-title span{color:var(--accent)}
.ak-stat{font-size:13px;color:var(--muted)}
.ak-stat b{color:var(--txt);font-variant-numeric:tabular-nums}
.ak-btns{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.ak-btns button{font:inherit;font-size:13px;color:var(--txt);background:var(--cell);border:1px solid var(--line);border-radius:10px;padding:7px 11px;cursor:pointer;transition:transform .08s,background .15s;touch-action:manipulation}
.ak-btns button:active{transform:scale(.94)}
.ak-btns button.primary{background:#0e7490;border-color:#155e75;font-weight:600}
.ak-btns button:disabled{opacity:.4;pointer-events:none}
.ak-hint{font-size:12px;color:var(--muted);margin-top:6px}
.ak-body{width:100%;max-width:520px;margin:0 auto;padding:12px 12px 24px;display:flex;flex-direction:column;gap:14px}
.ak-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px}
.ak-card h2{font-size:13px;margin:0 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.ak-tray{display:flex;gap:8px;overflow-x:auto;padding:4px 2px;touch-action:pan-x}
.ak-chip{min-width:74px;height:84px;flex:0 0 auto;position:relative;background:#101a2e;border:2px solid var(--line);border-radius:12px;perspective:260px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:border-color .15s,box-shadow .15s,opacity .2s}
.ak-chip.sel{border-color:var(--accent);box-shadow:0 0 14px rgba(34,211,238,.35)}
.ak-chip.done{opacity:.25;pointer-events:none}
.ak-chip .ak-pname{position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:11px;font-weight:700}
.ak-chip .ak-pname i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
.ak-board{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap}
.ak-layer{display:flex;flex-direction:column;align-items:center;gap:6px}
.ak-layer .ak-lab{font-size:11px;color:var(--muted);letter-spacing:1px}
.ak-grid{display:grid;grid-template-columns:repeat(3,var(--cell-size));gap:5px}
.ak-cell{width:var(--cell-size);height:var(--cell-size);border-radius:9px;background:var(--cell);border:1px solid var(--line);touch-action:manipulation;transition:transform .08s}
.ak-cell:active{transform:scale(.92)}
.ak-cell.filled{border-color:transparent}
.ak-cell.preview{outline:2px dashed #fff;outline-offset:-2px;opacity:.6}
.ak-cell.invalid{outline-color:#ef4444;background:rgba(239,68,68,.25)}
.ak-scene{height:240px;perspective:850px;touch-action:none;position:relative;overflow:hidden}
.ak-cubeWrap{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d;transform:rotateX(var(--rx,-26deg)) rotateY(var(--ry,-32deg))}
.ak-unit{position:absolute;width:var(--s);height:var(--s);transform-style:preserve-3d;transform:translate3d(calc(var(--x)*var(--s)),calc(var(--z)*var(--s)),calc(var(--y)*var(--s)))}
.ak-unit .ak-f{position:absolute;width:var(--s);height:var(--s);border:1px solid rgba(0,0,0,.35)}
.ak-f.front{transform:translateZ(calc(var(--s)/2))}
.ak-f.back{transform:rotateY(180deg) translateZ(calc(var(--s)/2))}
.ak-f.right{transform:rotateY(90deg) translateZ(calc(var(--s)/2))}
.ak-f.left{transform:rotateY(-90deg) translateZ(calc(var(--s)/2))}
.ak-f.top{transform:rotateX(90deg) translateZ(calc(var(--s)/2))}
.ak-f.bottom{transform:rotateX(-90deg) translateZ(calc(var(--s)/2))}
.ak-unit.ghost{opacity:.45}
.ak-mini{--s:var(--ms);width:calc(var(--ms)*3);height:calc(var(--ms)*3);transform-style:preserve-3d;transform:rotateX(-24deg) rotateY(-32deg)}
.ak-mini .ak-unit{width:var(--ms);height:var(--ms)}
.ak-mini .ak-unit .ak-f{width:var(--ms);height:var(--ms)}
.ak-sceneHint{position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:11px;color:var(--muted);pointer-events:none}
.ak-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);background:#0e7490;color:#fff;padding:8px 14px;border-radius:12px;font-size:13px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:30;white-space:nowrap}
.ak-toast.show{opacity:1}
.ak-overlay{position:absolute;inset:0;background:rgba(8,12,24,.8);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:20}
.ak-overlay.show{display:flex}
.ak-panel{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px 32px;text-align:center;max-width:320px}
.ak-panel .ak-big{font-size:44px}
.ak-panel h3{margin:8px 0 4px;font-size:22px}
.ak-panel p{margin:0 0 16px;color:var(--muted);font-size:14px}
.ak-conf{position:absolute;top:-24px;width:10px;height:16px;border-radius:3px;z-index:25;animation:ak-fall linear forwards}
@keyframes ak-fall{to{transform:translateY(110vh) rotate(720deg)}}
`;

/* ================= 3. ENGINE ================= */
export function startGame(canvas: HTMLCanvasElement): () => void {
  const host = canvas.parentElement ?? document.body;
  canvas.style.display = "none";

  let disposed = false;

  /* --- audio --- */
  let AC: AudioContext | null = null;
  function beep(freq: number, dur: number, type: OscillatorType, vol: number): void {
    try {
      const Ctor = window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      AC = AC ?? new Ctor();
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(AC.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
      o.stop(AC.currentTime + dur);
    } catch { /* audio unavailable */ }
  }
  const sndPlace = () => beep(520, 0.09, "triangle", 0.12);
  const sndPick = () => beep(720, 0.06, "sine", 0.08);
  const sndBad = () => beep(160, 0.15, "sawtooth", 0.06);
  const sndWin = () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.22, "triangle", 0.14), i * 140));

  /* --- colors --- */
  function shade(hex: string, f: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return `rgb(${r},${g},${b})`;
  }
  const FACE_F: Record<string, number> = { top: 1.3, front: 1, right: 0.82, left: 0.68, back: 0.75, bottom: 0.5 };
  function makeUnit(x: number, y: number, z: number, ghost: boolean): HTMLDivElement {
    const u = document.createElement("div");
    u.className = "ak-unit" + (ghost ? " ghost" : "");
    u.style.setProperty("--x", String(x - 1));
    u.style.setProperty("--y", String(y - 1));
    u.style.setProperty("--z", String(-(z - 1)));
    return u;
  }
  function addFaces(u: HTMLDivElement, color: string): void {
    for (const side in FACE_F) {
      const f = document.createElement("div");
      f.className = "ak-f " + side;
      f.style.background = shade(color, FACE_F[side]);
      u.appendChild(f);
    }
  }

  /* --- DOM skeleton --- */
  const root = document.createElement("div");
  root.className = "ak-root";
  const style = document.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);

  const header = document.createElement("div");
  header.className = "ak-header";
  header.innerHTML = `
    <div class="ak-hrow">
      <h1 class="ak-title">Akıl <span>Küpü</span></h1>
      <div class="ak-stat">⏱ <b class="ak-time">00:00</b></div>
      <div class="ak-stat">🏆 <b class="ak-best">—</b></div>
      <div class="ak-btns">
        <button class="ak-rotate">🔄 Çevir</button>
        <button class="ak-undo">↩ Geri Al</button>
        <button class="ak-reset">♻ Sıfırla</button>
        <button class="ak-solve primary">💡 Çözüm</button>
      </div>
    </div>
    <div class="ak-hint">Parçayı seç → boş kareye dokun (önizleme) → aynı kareye tekrar dokun (yerleştir). Dolu kareye basılı tut = parçayı geri al. 3D görünümü parmakla çevir.</div>
  `;
  root.appendChild(header);

  const body = document.createElement("div");
  body.className = "ak-body";
  body.innerHTML = `
    <section class="ak-card"><h2>Parçalar</h2><div class="ak-tray"></div></section>
    <section class="ak-card"><h2>Küp Katmanları</h2><div class="ak-board"></div></section>
    <section class="ak-card"><h2>3D Görünüm</h2><div class="ak-scene"><div class="ak-cubeWrap"></div><div class="ak-sceneHint">↔ parmakla çevir</div></div></section>
  `;
  root.appendChild(body);

  const toastEl = document.createElement("div");
  toastEl.className = "ak-toast";
  root.appendChild(toastEl);

  const overlay = document.createElement("div");
  overlay.className = "ak-overlay";
  overlay.innerHTML = `<div class="ak-panel">
    <div class="ak-big">🎉</div><h3>Tebrikler!</h3><p class="ak-winText">Küpü tamamladın.</p>
    <button class="ak-again primary">Tekrar Oyna</button>
  </div>`;
  root.appendChild(overlay);

  host.appendChild(root);

  const $q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const timeEl = $q<HTMLElement>(".ak-time");
  const bestEl = $q<HTMLElement>(".ak-best");
  const btnRotate = $q<HTMLButtonElement>(".ak-rotate");
  const btnUndo = $q<HTMLButtonElement>(".ak-undo");
  const btnReset = $q<HTMLButtonElement>(".ak-reset");
  const btnSolve = $q<HTMLButtonElement>(".ak-solve");
  const btnAgain = $q<HTMLButtonElement>(".ak-again");
  const trayEl = $q<HTMLElement>(".ak-tray");
  const boardEl = $q<HTMLElement>(".ak-board");
  const sceneEl = $q<HTMLElement>(".ak-scene");
  const cubeWrap = $q<HTMLElement>(".ak-cubeWrap");
  const winTextEl = $q<HTMLElement>(".ak-winText");

  /* --- state --- */
  const board = new Uint8Array(27);
  const orientIdx: number[] = PIECES.map(() => 0);
  const placed: boolean[] = PIECES.map(() => false);
  let selected: number | null = null;
  let preview: Preview | null = null;
  let placements: Placement[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let seconds = 0;
  let solving = false;
  let stepT: ReturnType<typeof setTimeout> | null = null;
  let toastT: ReturnType<typeof setTimeout> | null = null;

  /* --- toast --- */
  function toast(msg: string): void {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  /* --- mini piece render --- */
  function renderMini(el: HTMLElement, cells: Cell[], color: string): void {
    el.innerHTML = "";
    const m = document.createElement("div");
    m.className = "ak-mini";
    const b = boundsOf(cells);
    const cx = b.maxX / 2, cy = b.maxY / 2, cz = b.maxZ / 2;
    for (const c of cells) {
      const u = makeUnit(c[0] - cx, c[1] - cy, c[2] - cz, false);
      u.style.setProperty("--x", String(c[0] - cx));
      u.style.setProperty("--y", String(c[1] - cy));
      u.style.setProperty("--z", String(-(c[2] - cz)));
      addFaces(u, color);
      m.appendChild(u);
    }
    el.appendChild(m);
  }

  /* --- tray --- */
  const chips = PIECES.map((p, i) => {
    const d = document.createElement("div");
    d.className = "ak-chip";
    const mini = document.createElement("div");
    d.appendChild(mini);
    const lab = document.createElement("div");
    lab.className = "ak-pname";
    lab.innerHTML = `<i style="background:${p.color}"></i>${p.name}`;
    d.appendChild(lab);
    trayEl.appendChild(d);
    d.addEventListener("click", () => {
      if (disposed || placed[i] || solving) return;
      selected = selected === i ? null : i;
      sndPick();
      render();
    });
    return { el: d, mini };
  });

  /* --- layer grids --- */
  const cellEls: HTMLDivElement[] = [];
  for (let z = 2; z >= 0; z--) {
    const wrap = document.createElement("div");
    wrap.className = "ak-layer";
    const lab = document.createElement("div");
    lab.className = "ak-lab";
    lab.textContent = z === 2 ? "ÜST" : z === 1 ? "ORTA" : "ALT";
    wrap.appendChild(lab);
    const g = document.createElement("div");
    g.className = "ak-grid";
    for (let y = 2; y >= 0; y--)
      for (let x = 0; x < 3; x++) {
        const c = document.createElement("div");
        c.className = "ak-cell";
        cellEls[idx(x, y, z)] = c;
        g.appendChild(c);
        let lp: ReturnType<typeof setTimeout> | null = null;
        c.addEventListener("pointerdown", () => {
          if (disposed || solving) return;
          const i = idx(x, y, z);
          if (board[i]) lp = setTimeout(() => { lp = null; removePieceAt(i); }, 450);
        });
        c.addEventListener("pointerup", () => {
          if (disposed) return;
          if (lp) { clearTimeout(lp); lp = null; return; }
          if (solving) return;
          const i = idx(x, y, z);
          if (board[i]) return;
          if (selected === null) { toast("Önce bir parça seç 👆"); return; }
          const pv = computePreview(x, y, z);
          if (preview && preview.x === x && preview.y === y && preview.z === z && pv.valid) place(x, y, z);
          else { preview = { x, y, z }; if (!pv.valid) sndBad(); render(); }
        });
        c.addEventListener("pointerleave", () => { if (lp) { clearTimeout(lp); lp = null; } });
      }
    wrap.appendChild(g);
    boardEl.appendChild(wrap);
  }

  /* --- preview: piece centered on the tapped cell --- */
  function computePreview(x: number, y: number, z: number): { cells: Cell[]; valid: boolean } {
    const sel = selected as number;
    const or = ORIENTATIONS[sel][orientIdx[sel]];
    const b = boundsOf(or);
    const ox = x - Math.floor(b.maxX / 2);
    const oy = y - Math.floor(b.maxY / 2);
    const oz = z - Math.floor(b.maxZ / 2);
    const cells: Cell[] = or.map((c) => [c[0] + ox, c[1] + oy, c[2] + oz] as Cell);
    const valid = cells.every(
      (c) => c[0] >= 0 && c[0] <= 2 && c[1] >= 0 && c[1] <= 2 && c[2] >= 0 && c[2] <= 2 && !board[idx(c[0], c[1], c[2])]
    );
    return { cells, valid };
  }

  /* --- place / remove / undo --- */
  function place(x: number, y: number, z: number): void {
    const pv = computePreview(x, y, z);
    if (!pv.valid) { sndBad(); toast("Buraya sığmadı — çevir veya başka yere koy"); return; }
    const ids = pv.cells.map((c) => idx(c[0], c[1], c[2]));
    ids.forEach((i) => (board[i] = (selected as number) + 1));
    placed[selected as number] = true;
    placements.push({ piece: selected as number, cells: ids });
    sndPlace();
    selected = null;
    preview = null;
    if (!timer) startTimer();
    render();
    if (placements.length === PIECES.length) win();
  }
  function removePieceAt(i: number): void {
    const p = board[i] - 1;
    if (p < 0) return;
    let at = -1;
    for (let j = 0; j < placements.length; j++) if (placements[j].cells.includes(i)) at = j;
    if (at < 0) return;
    placements[at].cells.forEach((c) => (board[c] = 0));
    placements.splice(at, 1);
    placed[p] = false;
    preview = null;
    sndPick();
    toast(PIECES[p].name + " parçası geri alındı");
    render();
  }
  function undo(): void {
    const pl = placements.pop();
    if (!pl) return;
    pl.cells.forEach((c) => (board[c] = 0));
    placed[pl.piece] = false;
    preview = null;
    sndPick();
    render();
  }

  /* --- 3D scene --- */
  let rx = -26, ry = -32;
  function renderScene(): void {
    cubeWrap.innerHTML = "";
    for (let i = 0; i < 27; i++)
      if (board[i]) {
        const x = i % 3, y = Math.floor(i / 3) % 3, z = Math.floor(i / 9);
        const u = makeUnit(x, y, z, false);
        addFaces(u, PIECES[board[i] - 1].color);
        cubeWrap.appendChild(u);
      }
    const sel = selected;
    if (preview && sel !== null) {
      const pv = computePreview(preview.x, preview.y, preview.z);
      for (const c of pv.cells) {
        const u = makeUnit(c[0], c[1], c[2], true);
        addFaces(u, pv.valid ? PIECES[sel].color : "#ef4444");
        cubeWrap.appendChild(u);
      }
    }
  }
  let drag: { x: number; y: number } | null = null;
  sceneEl.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    sceneEl.setPointerCapture(e.pointerId);
  });
  sceneEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    ry += (e.clientX - drag.x) * 0.6;
    rx -= (e.clientY - drag.y) * 0.6;
    rx = Math.max(-85, Math.min(20, rx));
    drag = { x: e.clientX, y: e.clientY };
    cubeWrap.style.setProperty("--rx", rx + "deg");
    cubeWrap.style.setProperty("--ry", ry + "deg");
  });
  sceneEl.addEventListener("pointerup", () => { drag = null; });
  sceneEl.addEventListener("pointercancel", () => { drag = null; });

  /* --- render --- */
  function render(): void {
    chips.forEach((ch, i) => {
      ch.el.classList.toggle("sel", selected === i);
      ch.el.classList.toggle("done", placed[i]);
      renderMini(ch.mini, ORIENTATIONS[i][orientIdx[i]], PIECES[i].color);
    });
    const sel = selected;
    const pv = preview && sel !== null ? computePreview(preview.x, preview.y, preview.z) : null;
    const pvSet = new Map<number, boolean>();
    if (pv) pv.cells.forEach((c) => pvSet.set(idx(c[0], c[1], c[2]), pv.valid));
    cellEls.forEach((el, i) => {
      el.classList.toggle("filled", !!board[i]);
      el.style.background = board[i] ? PIECES[board[i] - 1].color : "";
      el.classList.toggle("preview", pvSet.has(i) && pvSet.get(i)!);
      el.classList.toggle("invalid", pvSet.has(i) && !pvSet.get(i)!);
    });
    btnUndo.disabled = !placements.length || solving;
    btnRotate.disabled = selected === null || solving;
    btnSolve.disabled = solving;
    renderScene();
  }

  /* --- buttons --- */
  btnRotate.addEventListener("click", () => {
    if (disposed || selected === null) return;
    orientIdx[selected] = (orientIdx[selected] + 1) % ORIENTATIONS[selected].length;
    sndPick();
    render();
  });
  btnUndo.addEventListener("click", () => { if (!disposed && !solving) undo(); });
  btnReset.addEventListener("click", () => { if (!disposed) reset(); });
  btnAgain.addEventListener("click", () => { overlay.classList.remove("show"); reset(); });

  /* --- timer --- */
  function fmt(s: number): string {
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function startTimer(): void {
    timer = setInterval(() => { seconds++; timeEl.textContent = fmt(seconds); }, 1000);
  }
  function stopTimer(): void {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function reset(): void {
    stopTimer();
    seconds = 0;
    timeEl.textContent = "00:00";
    board.fill(0);
    placed.fill(false);
    placements = [];
    selected = null;
    preview = null;
    solving = false;
    if (stepT) { clearTimeout(stepT); stepT = null; }
    btnSolve.disabled = false;
    render();
  }

  /* --- animated solution --- */
  btnSolve.addEventListener("click", () => {
    if (disposed || solving) return;
    const sol = solveSoma(ORIENTATIONS);
    if (!sol) { toast("Çözüm bulunamadı"); return; }
    solving = true;
    stopTimer();
    board.fill(0);
    placed.fill(false);
    placements = [];
    selected = null;
    preview = null;
    render();
    toast("Çözüm yükleniyor…");
    let k = 0;
    const step = (): void => {
      if (disposed) return;
      if (k >= sol.length) {
        solving = false;
        render();
        toast("İşte çözüm! Şimdi sıra sende 💪");
        return;
      }
      const pl = sol[k++];
      pl.cells.forEach((c) => (board[c] = pl.piece + 1));
      placed[pl.piece] = true;
      placements.push(pl);
      render();
      sndPick();
      stepT = setTimeout(step, 140);
    };
    step();
  });

  /* --- win --- */
  function win(): void {
    stopTimer();
    sndWin();
    let best = 0;
    try { best = Number(localStorage.getItem("akilkupu_best")) || 0; } catch { /* private mode */ }
    let msg = `Küpü ${fmt(seconds)} sürede tamamladın.`;
    if (!best || seconds < best) {
      try { localStorage.setItem("akilkupu_best", String(seconds)); } catch { /* private mode */ }
      msg += " 🏆 Yeni rekor!";
    } else msg += ` En iyi: ${fmt(best)}`;
    winTextEl.textContent = msg;
    bestEl.textContent = fmt(Math.min(best || seconds, seconds));
    overlay.classList.add("show");
    for (let i = 0; i < 36; i++) {
      const c = document.createElement("div");
      c.className = "ak-conf";
      c.style.left = Math.random() * 100 + "%";
      c.style.background = PIECES[i % PIECES.length].color;
      c.style.animationDuration = 1.6 + Math.random() * 1.8 + "s";
      c.style.animationDelay = Math.random() * 0.7 + "s";
      root.appendChild(c);
      setTimeout(() => c.remove(), 4200);
    }
  }

  /* --- init --- */
  let best0 = 0;
  try { best0 = Number(localStorage.getItem("akilkupu_best")) || 0; } catch { /* private mode */ }
  if (best0) bestEl.textContent = fmt(best0);
  render();
  toast("Hoş geldin! Bir parça seçerek başla 🧩");

  /* --- cleanup --- */
  return () => {
    disposed = true;
    stopTimer();
    if (stepT) clearTimeout(stepT);
    if (toastT) clearTimeout(toastT);
    try { AC?.close(); } catch { /* already closed */ }
    root.remove();
    canvas.style.display = "";
  };
}