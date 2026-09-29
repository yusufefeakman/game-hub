/* =====================================================================
   VOXELCRAFT — furnaceui.ts
   Fırın ekranı: girdi + yakıt slotları, çıktı slotu, yanma/pişirme
   çubukları ve envanter. engine.ts'ye bağımlı değildir (InvHost benzeri
   FurnaceHost). Fırın gerçek zamanlı çalışır; çubuklar her karede
   furnace.ts durumundan güncellenir.

   Etkileşim:
     Sol tık slot     → kaldır / bırak / istifle / değiştir
     Sağ tık slot     → yarım al / 1'er koy
     Çıktı slotu      → yalnızca al (koyulamaz)
     ✕               → kapat (slotlar + imleç envantere döner)
   ===================================================================== */
import { Inventory, stackLimitOf, toolMetaOf } from "./inventory";
import { itemNameOf, iconDataUrl } from "./crafting";
import { COOK_TIME, smeltResult, type FurnaceState } from "./furnace";

export interface FurnaceHost {
  inventory: Inventory;
  furnace: FurnaceState;
  onChanged(): void;
  toast(msg: string): void;
  click(): void;
  closed(): void;
}

interface Cell { id: number | null; count: number; dmg?: number; }
type FSlot = "in" | "fuel" | "out";
type Ref = { kind: "inv"; i: number } | { kind: "f"; slot: FSlot };
/** FSlot → FurnaceState alan adı eşlemesi (DOM 'in/out', state 'input/output'). */
const fKey: Record<FSlot, "input" | "fuel" | "output"> = { in: "input", fuel: "fuel", out: "output" };

function cellOf(id: number | null, count: number, dmg?: number): Cell { return { id, count, dmg }; }

export function openFurnaceScreen(wrap: HTMLElement, host: FurnaceHost): () => void {
  const inv = host.inventory;
  const f = host.furnace;
  let cursor: Cell | null = null;

  /* ---------- DOM ---------- */
  const ov = document.createElement("div");
  ov.className = "vcx-ioverlay";
  ov.innerHTML = `
  <div class="vcx-iwindow">
    <div class="vcx-ihead">
      <span>🔥 Fırın</span>
      <button class="vcx-iclose" title="Kapat (E/Esc)">✕</button>
    </div>
    <div class="vcx-imain">
      <div class="vcx-icol">
        <div class="vcx-ilabel">Pişir / Yak</div>
        <div class="vcx-frow">
          <div class="vcx-fcol">
            <div class="vcx-islot" data-sl="in" title="Pişirilecek"></div>
            <div class="vcx-flame"><i class="vcx-flame-fill"></i></div>
          </div>
          <div class="vcx-fcol">
            <div class="vcx-islot" data-sl="fuel" title="Yakıt (kömür / odun)"></div>
            <div class="vcx-arrow">➜</div>
          </div>
          <div class="vcx-fcol">
            <div class="vcx-islot vcx-result" data-sl="out" title="Çıktı — al"></div>
            <div class="vcx-cook"><i class="vcx-cook-fill"></i></div>
          </div>
        </div>
      </div>
      <div class="vcx-icol">
        <div class="vcx-ilabel">Envanter</div>
        <div class="vcx-igrid9" data-kind="main"></div>
        <div class="vcx-ilabel">Sıcak Bar (1-9)</div>
        <div class="vcx-igrid9" data-kind="hot"></div>
      </div>
    </div>
    <div class="vcx-ifoot">Sol tık: taşı/istifle · Sağ tık: yarım veya 1'er · Çıktı: yalnızca al · E/Esc: kapat</div>
  </div>`;
  wrap.appendChild(ov);

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
.vcx-frow{display:flex;align-items:center;gap:10px;padding:8px;background:rgba(0,0,0,.42);border-radius:10px;border:1px solid rgba(255,255,255,.14)}
.vcx-fcol{display:flex;flex-direction:column;align-items:center;gap:4px}
.vcx-arrow{font-size:26px;color:#cfd8e3}
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
.vcx-flame,.vcx-cook{width:44px;height:6px;border-radius:3px;background:rgba(0,0,0,.55);overflow:hidden}
.vcx-flame-fill{display:block;height:100%;width:0%;background:linear-gradient(90deg,#ff8a2a,#ffd23f);border-radius:3px}
.vcx-cook-fill{display:block;height:100%;width:0%;background:linear-gradient(90deg,#7ee081,#d8f5a0);border-radius:3px}
.vcx-ifoot{font-size:11px;color:#8fa3b8;text-align:center}
.vcx-ighost{position:absolute;z-index:14;width:42px;height:42px;border-radius:7px;border:2px solid #ffd23f;
  background-color:rgba(0,0,0,.55);background-size:cover;background-repeat:no-repeat;image-rendering:pixelated;
  pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 4px 14px rgba(0,0,0,.6)}
.vcx-ighost b{position:absolute;right:2px;bottom:0;font-size:12px;color:#fff;text-shadow:0 1px 2px #000}
`;
  wrap.appendChild(style);

  const ghost = document.createElement("div");
  ghost.className = "vcx-ighost";
  ghost.style.display = "none";
  wrap.appendChild(ghost);

  const flameFill = ov.querySelector<HTMLElement>(".vcx-flame-fill")!;
  const cookFill = ov.querySelector<HTMLElement>(".vcx-cook-fill")!;
  const inEl = ov.querySelector<HTMLElement>("[data-sl='in']")!;
  const fuelEl = ov.querySelector<HTMLElement>("[data-sl='fuel']")!;
  const outEl = ov.querySelector<HTMLElement>("[data-sl='out']")!;

  const mkInvSlots = (kind: "main" | "hot") => {
    const c = ov.querySelector<HTMLElement>(`.vcx-igrid9[data-kind="${kind}"]`)!;
    const start = kind === "hot" ? 0 : 9;
    const end = kind === "hot" ? 9 : 36;
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
      return s ? cellOf(s.id, s.count, s.dmg) : cellOf(null, 0);
    }
    const s = f[fKey[r.slot]];
    return s ? cellOf(s.id, s.count, s.dmg) : cellOf(null, 0);
  }
  function setRef(r: Ref, id: number | null, count: number, dmg?: number) {
    if (id === null || count <= 0) {
      if (r.kind === "inv") inv.slots[r.i] = null;
      else f[fKey[r.slot]] = null;
    } else if (r.kind === "inv") inv.slots[r.i] = { id, count, dmg };
    else f[fKey[r.slot]] = { id, count, dmg };
  }

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
    const meta = toolMetaOf(c.id);
    const showCount = c.id >= 1000 || c.count > 1 || result;
    let html = showCount && !meta ? `<b>${c.count}</b>` : "";
    let tip = itemNameOf(c.id);
    if (meta) {
      const dmg = c.dmg ?? meta.dur;
      const pct = dmg / meta.dur;
      html += `<span class="dbar"><i style="width:${Math.round(pct * 100)}%;background:${pct < 0.25 ? "#ff5d5d" : "#7ee081"}"></i></span>`;
      tip += ` (${dmg}/${meta.dur})`;
    } else if (c.count > 1) tip += ` ×${c.count}`;
    el.innerHTML = html;
    el.title = tip;
    if (result) el.classList.add("hl"); else el.classList.remove("hl");
  }

  const invEls: HTMLElement[] = [];
  ov.querySelectorAll<HTMLElement>(".vcx-igrid9 .vcx-islot").forEach((e) => invEls.push(e));
  function slotOf(k: number): number { return k < 27 ? k + 9 : k - 27; }

  function renderAll() {
    invEls.forEach((el, k) => paint(el, getRef({ kind: "inv", i: slotOf(k) })));
    paint(inEl, getRef({ kind: "f", slot: "in" }));
    paint(fuelEl, getRef({ kind: "f", slot: "fuel" }));
    paint(outEl, getRef({ kind: "f", slot: "out" }), true);
    const cur = cursor;
    if (cur && cur.id !== null) {
      ghost.style.display = "block";
      ghost.style.backgroundImage = `url(${iconDataUrl(cur.id)})`;
      ghost.innerHTML = toolMetaOf(cur.id) ? "" : `<b>${cur.count}</b>`;
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
    const isOut = r.kind === "f" && r.slot === "out";
    if (isOut && cursor) return; // çıktıya koyulamaz
    if (!right) {
      if (!cursor) {
        if (src.id !== null) { cursor = cellOf(src.id, src.count, src.dmg); setRef(r, null, 0); }
      } else if (src.id === null) {
        setRef(r, cursor.id, cursor.count, cursor.dmg); cursor = null;
      } else if (src.id === cursor.id) {
        const space = stackLimitOf(src.id) - src.count;
        if (space > 0) {
          const m = Math.min(space, cursor.count);
          setRef(r, src.id, src.count + m, src.dmg);
          cursor.count -= m;
          if (cursor.count <= 0) cursor = null;
        }
      } else {
        const tmp = cellOf(cursor.id, cursor.count, cursor.dmg);
        setRef(r, src.id, src.count, src.dmg);
        cursor = tmp;
      }
      refresh();
      return;
    }
    if (!cursor) {
      if (src.id !== null) {
        const half = isOut ? src.count : Math.ceil(src.count / 2); // çıktıdan tam al
        cursor = cellOf(src.id, half, src.dmg);
        setRef(r, src.id, src.count - half, src.dmg);
      }
    } else if (src.id === null) {
      setRef(r, cursor.id, 1, cursor.dmg);
      cursor.count -= 1;
      if (cursor.count <= 0) cursor = null;
    } else if (src.id === cursor.id && src.count < stackLimitOf(src.id)) {
      setRef(r, src.id, src.count + 1, src.dmg);
      cursor.count -= 1;
      if (cursor.count <= 0) cursor = null;
    }
    refresh();
  }

  /* ---------- çubuklar (gerçek zamanlı) ---------- */
  let raf = 0;
  let lastSig = "";
  function tickUI() {
    const burnPct = f.burn > 0 && f.burnMax > 0 ? Math.min(100, (f.burn / f.burnMax) * 100) : 0;
    const cookPct = f.burn > 0 ? Math.min(100, (f.cook / COOK_TIME) * 100) : 0;
    flameFill.style.width = burnPct + "%";
    cookFill.style.width = cookPct + "%";
    const sig = `${f.input?.id ?? 0}:${f.input?.count ?? 0}|${f.fuel?.id ?? 0}:${f.fuel?.count ?? 0}|${f.output?.id ?? 0}:${f.output?.count ?? 0}`;
    if (sig !== lastSig) { lastSig = sig; renderAll(); } // pişirme sonucu değişince tazelenir
    raf = requestAnimationFrame(tickUI);
  }
  raf = requestAnimationFrame(tickUI);

  /* ---------- kapatma ---------- */
  function teardown() {
    cancelAnimationFrame(raf);
    ov.remove();
    style.remove();
    ghost.remove();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mousedown", onDown);
  }

  function close() {
    const cur = cursor;
    if (cur && cur.id !== null) {
      const left = inv.addStack({ id: cur.id, count: cur.count, dmg: cur.dmg });
      if (left > 0) host.toast(`${itemNameOf(cur.id)} için yer yok — yok oldu!`);
    }
    for (const slot of ["in", "fuel", "out"] as FSlot[]) {
      const s = f[fKey[slot]];
      if (s && s.count > 0) {
        const left = inv.addStack({ id: s.id, count: s.count, dmg: s.dmg });
        if (left > 0) host.toast(`${itemNameOf(s.id)} için yer yok — yok oldu!`);
        f[fKey[slot]] = null;
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
    if (s) {
      const sl = s.dataset.sl;
      const r: Ref = sl === "i" ? { kind: "inv", i: Number(s.dataset.i) } : { kind: "f", slot: sl as FSlot };
      if (sl === "out" && (e.button === 0 || e.button === 2)) {
        // çıktı: yalnızca al (imleç boşsa)
        if (!cursor) { slotMouse(r, e.button === 2); host.click(); }
      } else if (e.button === 0 || e.button === 2) {
        slotMouse(r, e.button === 2);
        host.click();
      }
    }
  });
  ov.addEventListener("contextmenu", (e) => e.preventDefault());
  ov.addEventListener("wheel", (e) => {
    e.preventDefault();
    const w = ov.querySelector<HTMLElement>(".vcx-imain");
    if (w) w.scrollTop += e.deltaY;
  }, { passive: false });
  ov.querySelector<HTMLElement>(".vcx-iclose")!.addEventListener("click", close);

  ghost.style.left = `${(rectOf().width - 40) / 2}px`;
  ghost.style.top = `${(rectOf().height - 40) / 2}px`;

  renderAll();
  return close;
}