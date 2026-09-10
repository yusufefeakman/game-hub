/* =====================================================================
   VOXELCRAFT — crafting.ts
   Üretim (crafting) sistemi: 2×2/3×3 tarifler ve kalıp eşleştirici.
   Eşya kimlikleri blocks.ts/inventory.ts'ten gelir (bloklar B.*,
   blok-dışı eşyalar I.*). Tarifler grid üzerinde sol-üste hizalı
   aranır; boşluklar cropGrid ile temizlenir.
   ===================================================================== */
import { B, BLOCKS, ATLAS_CANVAS, ATLAS_PAD, ATLAS_CELL, tileRect } from "./blocks";
import { I, ITEM_NAME, itemNameOfItem, toolMetaOf } from "./inventory";
export { I }; // dış kullanım için tekrar ihraç

// Birleşik ad: blok → eşya → varsayılan
export function itemNameOf(id: number): string {
  return ITEM_NAME[id] ?? itemNameOfItem(id) ?? "Eşya";
}

export interface Recipe {
  w: number; // kalıp genişliği (sütun)
  h: number; // kalıp yüksekliği (satır)
  rows: (number | null)[][]; // h×w
  outId: number;
  outCount: number;
}

function rec(w: number, h: number, rows: number[][], outId: number, outCount: number): Recipe {
  const r: (number | null)[][] = [];
  for (let y = 0; y < h; y++) {
    r.push(rows[y].slice(0, w).map((v) => (v === 0 ? null : v)));
  }
  return { w, h, rows: r, outId, outCount };
}

const P = B.PLANKS;   // kalas
const C = B.COBBLE;   // arnavut
const S = I.STICK;    // çubuk

export const RECIPES: Recipe[] = [
  // ---- 2×2 / kişisel üretim ----
  rec(1, 1, [[B.WOOD]], B.PLANKS, 4),                                   // odun → kalas
  rec(1, 1, [[B.BIRCH_WOOD]], B.PLANKS, 4),                             // huş odun → kalas
  rec(1, 1, [[B.PINE_WOOD]], B.PLANKS, 4),                              // çam odun → kalas
  rec(1, 2, [[P], [P]], S, 4),                                          // 2 kalas (dikey) → çubuk
  rec(2, 2, [[P, P], [P, P]], B.CRAFTING_TABLE, 1),                      // kalas² → üretim masası

  // ---- 3×3 / üretim masası — tahta aletler ----
  rec(3, 3, [[P, P, P], [0, S, 0], [0, S, 0]], I.WPICK, 1),              // tahta kazma
  rec(3, 3, [[P, P, 0], [P, S, 0], [0, S, 0]], I.WAXE, 1),               // tahta balta
  rec(3, 3, [[P, 0, 0], [S, 0, 0], [S, 0, 0]], I.WSHOV, 1),              // tahta kürek

  // ---- 3×3 — taş aletler ----
  rec(3, 3, [[C, C, C], [0, S, 0], [0, S, 0]], I.SPICK, 1),              // taş kazma
  rec(3, 3, [[C, C, 0], [C, S, 0], [0, S, 0]], I.SAXE, 1),               // taş balta
  rec(3, 3, [[C, 0, 0], [S, 0, 0], [S, 0, 0]], I.SSHOV, 1),              // taş kürek
];

/** Izgaradaki boş satır/sütunları atarak sol-üste hizalı içerik kutusu döner. */
export function cropGrid(rows: (number | null)[][]): (number | null)[][] {
  const h = rows.length, w = rows[0]?.length || 0;
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (rows[y][x] !== null && rows[y][x] !== undefined && rows[y][x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return [];
  const out: (number | null)[][] = [];
  for (let y = minY; y <= maxY; y++) {
    const row: (number | null)[] = [];
    for (let x = minX; x <= maxX; x++) row.push(rows[y][x]);
    out.push(row);
  }
  return out;
}

/** Grid içeriğiyle eşleşen tarifi döner (yoksa null). */
export function matchRecipe(rows: (number | null)[][]): Recipe | null {
  const g = cropGrid(rows);
  if (g.length === 0) return null;
  for (const rc of RECIPES) {
    if (rc.rows.length !== g.length || rc.rows[0]?.length !== g[0]?.length) continue;
    let ok = true;
    for (let y = 0; y < g.length && ok; y++)
      for (let x = 0; x < g[y].length; x++)
        if (g[y][x] !== rc.rows[y][x]) { ok = false; break; }
    if (ok) return rc;
  }
  return null;
}

/* ---------------- eşya ikonları (dataURL) ---------------- */
const iconCache = new Map<number, string>();

function fallbackIcon(c: CanvasRenderingContext2D, rgb: [number, number, number]) {
  c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  c.fillRect(0, 0, 32, 32);
  c.fillStyle = "rgba(0,0,0,.28)";
  c.fillRect(2, 2, 28, 2); c.fillRect(2, 28, 28, 2); c.fillRect(2, 2, 2, 28); c.fillRect(28, 2, 2, 28);
}

function toolIcon(id: number, c: CanvasRenderingContext2D) {
  const meta = toolMetaOf(id);
  if (!meta) { fallbackIcon(c, [140, 140, 150]); return; }
  const stone = meta.tier === "stone";
  const head = stone ? "rgb(150,150,158)" : "rgb(168,128,78)";
  const headDark = stone ? "rgb(96,96,104)" : "rgb(118,86,52)";
  fallbackIcon(c, stone ? [96, 98, 106] : [150, 120, 82]);
  c.save();
  c.translate(16, 18);
  c.rotate(-Math.PI / 4);
  // sap
  c.fillStyle = stone ? "#6e5b3c" : "#8a5a2b";
  c.fillRect(-3, -16, 6, 32);
  c.fillStyle = head;
  if (meta.type === "pickaxe") {
    c.fillRect(-9, -15, 18, 4);  // kafa
    c.fillStyle = headDark; c.fillRect(-8, -16, 16, 1); c.fillRect(-9, -12, 18, 1);
  } else if (meta.type === "axe") {
    c.fillRect(-2, -17, 12, 5);
    c.fillStyle = headDark; c.fillRect(8, -17, 2, 5);
  } else { // shovel
    c.fillRect(-6, -15, 12, 2);
    c.fillStyle = headDark;
    c.beginPath();
    c.arc(0, -13, 5, 0, Math.PI);
    c.closePath();
    c.fill();
  }
  c.restore();
}

function itemIcon(id: number): string {
  const cv = document.createElement("canvas");
  cv.width = 32; cv.height = 32;
  const c = cv.getContext("2d")!;
  if (id === I.STICK) {
    fallbackIcon(c, [168, 128, 78]);
    c.save();
    c.translate(16, 16); c.rotate(-Math.PI / 4);
    c.fillStyle = "#9a6b33"; c.fillRect(-3, -12, 6, 24);
    c.fillStyle = "#b98a4f"; c.fillRect(-2, -11, 2, 22);
    c.fillStyle = "#6e4a23"; c.fillRect(0, -9, 1, 18);
    c.restore();
  } else if (id === I.APPLE) {
    fallbackIcon(c, [80, 160, 80]);
    c.fillStyle = "#d64040";
    c.beginPath(); c.arc(16, 19, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#b52a2a";
    c.beginPath(); c.arc(13, 21, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#5b3a1a"; c.fillRect(15, 6, 2, 5);
    c.fillStyle = "#4c9a45"; c.fillRect(17, 6, 5, 3);
  } else if (id === I.MEAT) {
    fallbackIcon(c, [120, 60, 40]);
    c.fillStyle = "#c75b4a";
    c.beginPath(); c.moveTo(8, 26); c.lineTo(10, 8); c.lineTo(18, 6); c.lineTo(24, 12); c.lineTo(22, 26); c.closePath(); c.fill();
    c.fillStyle = "#f0c8a8"; c.fillRect(11, 14, 4, 3); c.fillRect(17, 10, 3, 3);
    c.fillStyle = "#8a3328"; c.fillRect(8, 21, 14, 2);
  } else if (id === I.WOOL) {
    fallbackIcon(c, [200, 200, 200]);
    c.fillStyle = "#fdfdfd";
    for (const [x, y, r] of [[10, 10, 6], [22, 12, 5], [16, 22, 6], [26, 24, 4], [6, 24, 4]] as const) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  } else if (toolMetaOf(id)) {
    toolIcon(id, c);
  } else {
    fallbackIcon(c, [140, 140, 150]);
  }
  return cv.toDataURL();
}

/** Blok ya da eşya için UI ikon dataURL'i (32px, cache'li). */
export function iconDataUrl(id: number): string {
  const hit = iconCache.get(id);
  if (hit) return hit;
  let url: string;
  const d = BLOCKS[id];
  const atlas = ATLAS_CANVAS;
  if (d && atlas && d.tiles.length > 0) {
    const cv = document.createElement("canvas");
    cv.width = 32; cv.height = 32;
    const c = cv.getContext("2d")!;
    const r = tileRect(d.tiles[0]);
    c.imageSmoothingEnabled = false;
    // padding dahil hücreyi çiz: kenar pikselleri ikonu tam doldurur
    c.drawImage(atlas, r.x - ATLAS_PAD, r.y - ATLAS_PAD, ATLAS_CELL, ATLAS_CELL, 0, 0, 32, 32);
    url = cv.toDataURL();
  } else {
    url = itemIcon(id);
  }
  iconCache.set(id, url);
  return url;
}
