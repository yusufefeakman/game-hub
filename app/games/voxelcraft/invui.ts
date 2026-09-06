/* =====================================================================
   VOXELCRAFT — invui.ts
   Tam envanter + üretim ekranı. engine.ts'ye bağımlı DEĞİLDİR; tüm
   yan etkiler InvHost arayüzü üzerinden iletilir (böylece döngüsel
   import olmaz).

   Etkileşim (Minecraft tarzı):
     Sol tık slot        → stack'i kaldır / bırak / istifle / değiştir
     Sağ tık slot        → yarım al / birer birer koy
     Sonuç slotuna tık   → grid'deki kalıbı bir kez üret (imlece ekle)
     E / Esc / ✕         → kapat (grid + imleç envantere geri döner)
   ===================================================================== */
import { Inventory, STACK_MAX } from "./inventory";
import { matchRecipe, itemNameOf, iconDataUrl, type Recipe } from "./crafting";

export interface InvHost {
  inventory: Inventory;
  /** Envanter değişince HUD hotbar vb. tazele */
  onChanged(): void;
  toast(msg: string): void;
  click(): void;
  /** Ekran kapatıldıktan sonra çağrılır (pointer lock geri istenebilir) */
  closed(): void;
}

interface Cell { id: number | null; count: number; }
type Ref = { kind: "inv"; i: number } | { kind: "grid"; i: number };

function cellOf(id: number | null, count: number): Cell { return { id, count }; }

/**
 * wrap içinde envanter/üretim ekranını açar.
 * mode=2 → kişisel 2×2 üretim · mode=3 → üretim masası 3×3
 * Kapatma fonksiyonu döner.
 */
export function openInventoryScreen(wrap: HTMLElement, host: InvHost, mode: 2 | 3): () => void {
  const inv = host.inventory;
  const dims = mode;
  const nCells = dims * dims;
  const grid: Cell[] = Array.from({ length: nCells }, () => cellOf(null, 0));
  let cursor: Cell | null = null;

  /* ---------- DOM ---------- */
  const ov = document.createElement("div");
  ov.className = "vcx-ioverlay";
  ov.innerHTML = `
  <div class="vcx-iwindow">
    <div class="vcx-ihead">
      <span>${mode === 3 ? "🪵 Üretim Masası — 3×3" : "🎒 Envanter — Üretim 2×2"}</span>
      <button class="vcx-iclose" title="Kapat (E/Esc)">✕</button>
    </div>
    <div class="vcx-imain">
      <div class="vcx-icol">
        <div class="vcx-ilabel">Üretim (${dims}×${dims})</div>
        <div class="vcx-icraftrow">
          <div class="vcx-igrid" data-dim="${dims}"></div>
          <div class="vcx-arrow">➜</div>
          <div class="vcx-islot vcx-result" data-sl="r" title="Üret!"></div>
        </div>
      </div>
      <div class="vcx-icol">
        <div class="vcx-ilabel">Envanter</div>
        <div class="vcx-igrid9" data-kind="main"></div>
        <div class="vcx-ilabel">Sıcak Bar (1-9)</div>
        <div class="vcx-igrid9" data-kind="hot"></div>
      </div>
    </div>
    <div class="vcx-ifoot">Sol tık: taşı/istifle · Sağ tık: yarım veya 1'er · E/Esc: kapat</div>
  </div>`;
  wrap.appendChild(ov);

  // stiller (bir kez — her açılışta güvenli şekilde append edilir)
  const style = document.createElement("style");
  style.textContent = `
.vcx-ioverlay{position:absolute;inset:0;z-index:12;display:flex;align-items:center;justify-content:center;
  background:rgba(4,8,16,.62);backdrop-filter:blur(2px);font-family:'Segoe UI',system-ui,sans-serif}
.vcx-iwindow{background:linear-gradient(180deg,#2a2f3a,#1d2129);border:2px solid rgba(255,255,255,.25);
  border-radius:14px;padding:12px 16px 10px;box-shadow:0 10px 40px rgba(0,0,0,.6);color:#fff;max-height:92%;
  display:flex;flex-direction:column;gap:10px}
.vcx-ihead{display:flex;justify-content:space-between;align-items:center;font-weight:800;letter-spacing:.5px}
.vcx-iclose{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:8px;
  width:28px;height:28px;cursor:pointer;font-weight:900}
.vcx-iclose:hover{background:rgba(255,80,80,.5)}
.vcx-imain{display:flex;gap:24px;flex-wrap:wrap;justify-content:center;overflow:auto}
.vcx-icol{display:flex;flex-direction:column;gap:6px;align-items:center}
.vcx-ilabel{font-size:12px;color:#9fb6cc;font-weight:700;letter-spacing:.5px}
.vcx-icraftrow{display:flex;align-items:center;gap:12px}
.vcx-arrow{font-size:26px;color:#cfd8e3}
.vcx-igrid{display:grid;gap:4px;padding:6px;background:rgba(0,0,0,.42);border-radius:10px;border:1px solid rgba(255,255,255,.14)}
.vcx-igrid[data-dim="2"]{grid-template-columns:repeat(2,44px)}
.vcx-igrid[data-dim="3"]{grid-template-columns:repeat(3,44px)}
.vcx-igrid9{display:grid;grid-template-columns:repeat(9,38px);gap:3px;padding:5px;
  background:rgba(0,0,0,.42);border-radius:10px;border:1px solid rgba(255,255,255,.14)}
.vcx-islot{width:44px;height:44px;border-radius:7px;border:2px solid rgba(255,255,255,.22);position:relative;
  cursor:pointer;background-color:rgba(0,0,0,.4);background-size:cover;background-repeat:no-repeat;image-rendering:pixelated;
  display:flex;align-items:center;justify-content:center;transition:transform .05s,border-color .1s}
.vcx-igrid9 .vcx-islot{width:38px;height:38px}
.vcx-islot:hover{border-color:#ffd23f;transform:scale(1.06)}
.vcx-islot b{position:absolute;right:3px;bottom:1px;font-size:11px;color:#fff;text-shadow:0 1px 2px #000;font-weight:800}
.vcx-islot.hl{border-color:#ffd23f;box-shadow:0 0 10px rgba(255,210,63,.75)}
.vcx-result.hl{border-color:#7ee081;box-shadow:0 0 10px rgba(126,224,129,.8)}
.vcx-result:active{transform:scale(.94)}
.vcx-ifoot{font-size:11px;color:#8fa3b8;text-align:center}
.vcx-ighost{position:absolute;z-index:14;width:42px;height:42px;border-radius:7px;border:2px solid #ffd23f;
  background-color:rgba(0,0,0,.55);background-size:cover;background-repeat:no-repeat;image-rendering:pixelated;
  pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 4px 14px rgba(0,0,0,.6)}
.vcx-ighost b{position:absolute;right:2px;bottom:0;font-size:12px;color:#fff;text-shadow:0 1px 2px #000}
`;
  wrap.appendChild(style);

  const gridEl = ov.querySelector<HTMLElement>(".vcx-igrid")!;
  const resultEl = ov.querySelector<HTMLElement>(".vcx-result")!;
  const ghost = document.createElement("div");
  ghost.className = "vcx-ighost";
  ghost.style.display = "none";
  wrap.appendChild(ghost);

  // slot elementleri oluştur
  for (let i = 0; i < nCells; i++) {
    const s = document.createElement("div");
    s.className = "vcx-islot";
    s.dataset.sl = "g"; s.dataset.i = String(i);
    gridEl.appendChild(s);
  }
  const mkInvSlots = (kind: "main" | "hot") => {
    const c = ov.querySelector<HTMLElement>(`.vcx-igrid9[data-kind="${kind}"]`)!;
    const start = kind === "hot" ? 0 : 9;
    const end = kind === "hot" ? 9 : 36; // ana alan: 27 slot (9..35)
    for (let i = start; i < end; i++) {
      const s = document.createElement("div");
      s.className = "vcx-islot";
      s.dataset.sl = "i"; s.dataset.i = String(i);
      c.appendChild(s);
    }
  };
  mkInvSlots("main");
  mkInvSlots("hot");

  /* ---------- durum okuma / yazma ---------- */
  function getRef(r: Ref): Cell {
    if (r.kind === "inv") {
      const s = inv.slots[r.i];
      return s ? cellOf(s.id, s.count) : cellOf(null, 0);
    }
    return grid[r.i];
  }
  function setRef(r: Ref, id: number | null, count: number) {
    if (id === null || count <= 0) {
      if (r.kind === "inv") inv.slots[r.i] = null;
      else grid[r.i] = cellOf(null, 0);
    } else if (r.kind === "inv") inv.slots[r.i] = { id, count };
    else grid[r.i] = cellOf(id, count);
  }
  function rows2d(): (number | null)[][] {
    const rows: (number | null)[][] = [];
    for (let y = 0; y < dims; y++) {
      const row: (number | null)[] = [];
      for (let x = 0; x < dims; x++) row.push(grid[y * dims + x].id);
      rows.push(row);
    }
    return rows;
  }
  const recipe = (): Recipe | null => matchRecipe(rows2d());

  /* ---------- slot boyama ---------- */
  function paint(el: HTMLElement, c: Cell, result = false) {
    el.title = "";
    if (c.id === null || c.count <= 0) {
      el.style.backgroundImage = "none";
      el.style.backgroundColor = "rgba(0,0,0,.4)";
      el.innerHTML = "";
      el.classList.remove("hl");
      return;
    }
    el.style.backgroundImage = `url(${iconDataUrl(c.id)})`;
    el.style.backgroundColor = "rgba(0,0,0,.55)";
    const show = c.id >= 1000 || c.count > 1 || result;
    el.innerHTML = show ? `<b>${c.count}</b>` : "";
    el.title = `${itemNameOf(c.id)}${c.count > 1 ? ` ×${c.count}` : ""}`;
    el.classList.add("hl");
  }

  const invEls: HTMLElement[] = [];
  ov.querySelectorAll<HTMLElement>(".vcx-igrid9 .vcx-islot").forEach((e) => invEls.push(e));
  const gridEls: HTMLElement[] = [];
  gridEl.querySelectorAll<HTMLElement>(".vcx-islot").forEach((e) => gridEls.push(e));

  // invEls DOM sırası: slot 9..35 sonra 0..8
  function slotOf(k: number): number { return k < 27 ? k + 9 : k - 27; }

  function renderAll() {
    invEls.forEach((el, k) => paint(el, getRef({ kind: "inv", i: slotOf(k) })));
    for (let i = 0; i < nCells; i++) paint(gridEls[i], grid[i]);
    const rc = recipe();
    if (rc) paint(resultEl, cellOf(rc.outId, rc.outCount), true);
    else {
      resultEl.style.backgroundImage = "none";
      resultEl.style.backgroundColor = "rgba(0,0,0,.4)";
      resultEl.innerHTML = "";
      resultEl.title = "Kalıp eşleşmiyor";
      resultEl.classList.remove("hl");
    }
    // imleç hayaleti
    const cur = cursor;
    if (cur && cur.id !== null) {
      ghost.style.display = "block";
      ghost.style.backgroundImage = `url(${iconDataUrl(cur.id)})`;
      ghost.innerHTML = `<b>${cur.count}</b>`;
      ghost.title = `${itemNameOf(cur.id)} ×${cur.count}`;
    } else ghost.style.display = "none";
  }

  function refresh() {
    renderAll();
    host.onChanged();
  }

  /* ---------- slot etkileşimi ---------- */
  function slotMouse(r: Ref, right: boolean) {
    const src = getRef(r);
    if (!right) {
      // sol tık: kaldır / bırak / istifle / değiştir
      if (!cursor) {
        if (src.id !== null) { cursor = cellOf(src.id, src.count); setRef(r, null, 0); }
      } else if (src.id === null) {
        setRef(r, cursor.id, cursor.count); cursor = null;
      } else if (src.id === cursor.id) {
        const space = STACK_MAX - src.count;
        if (space > 0) {
          const m = Math.min(space, cursor.count);
          setRef(r, src.id, src.count + m);
          cursor.count -= m;
          if (cursor.count <= 0) cursor = null;
        }
      } else {
        const tmp = cellOf(cursor.id, cursor.count);
        setRef(r, src.id, src.count);
        cursor = tmp;
      }
      refresh();
      return;
    }
    // sağ tık: imleç boşsa yarım al; doluysa 1'er koy
    if (!cursor) {
      if (src.id !== null) {
        const half = Math.ceil(src.count / 2);
        cursor = cellOf(src.id, half);
        setRef(r, src.id, src.count - half);
      }
    } else if (src.id === null) {
      setRef(r, cursor.id, 1);
      cursor.count -= 1;
      if (cursor.count <= 0) cursor = null;
    } else if (src.id === cursor.id && src.count < STACK_MAX) {
      setRef(r, src.id, src.count + 1);
      cursor.count -= 1;
      if (cursor.count <= 0) cursor = null;
    }
    refresh();
  }

  function tryCraft(): boolean {
    const rc = recipe();
    if (!rc) return false;
    // imleçte ürün için yer yoksa üretme
    if (cursor && (cursor.id !== rc.outId || cursor.count + rc.outCount > STACK_MAX)) return false;
    // her grid hücresinden 1 tüket
    for (const g of grid) {
      if (g.id !== null && g.count > 0) {
        g.count -= 1;
        if (g.count <= 0) { g.id = null; g.count = 0; }
      }
    }
    if (!cursor) cursor = cellOf(rc.outId, 0);
    cursor.count += rc.outCount;
    refresh();
    return true;
  }

  /* ---------- kapatma: grid + imleç envantere geri döner ---------- */
  function teardown() {
    ov.remove();
    style.remove();
    ghost.remove();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mousedown", onDown);
  }

  function close() {
    const cur = cursor;
    if (cur && cur.id !== null) {
      const left = inv.add(cur.id, cur.count);
      if (left > 0) host.toast(`${itemNameOf(cur.id)} için yer yok — düştü!`);
    }
    for (const g of grid) {
      if (g.id !== null && g.count > 0) {
        const left = inv.add(g.id, g.count);
        if (left > 0) host.toast(`${itemNameOf(g.id)} için yer yok — düştü!`);
      }
    }
    teardown();
    host.onChanged();
    host.closed();
  }

  /* ---------- olaylar ---------- */
  const rectOf = () => wrap.getBoundingClientRect();
  function placeGhost(e: MouseEvent) {
    const r = rectOf();
    ghost.style.left = `${e.clientX - r.left}px`;
    ghost.style.top = `${e.clientY - r.top}px`;
  }
  function onMove(e: MouseEvent) { if (cursor) placeGhost(e); }
  function onDown(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest(".vcx-ioverlay")) placeGhost(e);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mousedown", onDown);

  ov.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = e.target as HTMLElement;
    const s = t.closest<HTMLElement>("[data-sl]");
    if (s && s.dataset.sl === "r") {
      if (e.button === 0 || e.button === 2) { if (tryCraft()) host.click(); }
      return;
    }
    if (s && (e.button === 0 || e.button === 2)) {
      const i = Number(s.dataset.i);
      slotMouse(s.dataset.sl === "g" ? { kind: "grid", i } : { kind: "inv", i }, e.button === 2);
      host.click();
    }
  });
  ov.addEventListener("contextmenu", (e) => e.preventDefault());
  ov.addEventListener("wheel", (e) => {
    e.preventDefault();
    const w = ov.querySelector<HTMLElement>(".vcx-imain");
    if (w) w.scrollTop += e.deltaY;
  }, { passive: false });
  ov.querySelector<HTMLElement>(".vcx-iclose")!.addEventListener("click", close);

  // başlangıçta imleç ortada dursun
  ghost.style.left = `${(rectOf().width - 40) / 2}px`;
  ghost.style.top = `${(rectOf().height - 40) / 2}px`;

  renderAll();
  return close;
}
