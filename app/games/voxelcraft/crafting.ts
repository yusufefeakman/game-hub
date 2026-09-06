/* =====================================================================
   VOXELCRAFT — crafting.ts
   Üretim (crafting) sistemi: eşya kimlikleri, 2×2/3×3 tarifler ve
   kalıp eşleştirici. Blok kimlikleri blocks.ts'teki B.*; blok olmayan
   ara eşyalar 1000+ aralığında tutulur (yerleştirilemezler).

   Tarifler ızgara (grid) üzerinde sol-üste hizalı aranır; boşluklar
   cropGrid ile temizlenir, böylece 2×2 alana 1×1 kalıp da sığar.
   ===================================================================== */
import { B, BLOCKS, ATLAS_CANVAS } from "./blocks";
import { ITEM_NAME } from "./inventory";

// Blok olmayan eşyalar (yerleştirilemez; 1000+ ayrı alan)
export const I = {
  STICK: 1000,
} as const;

export const ITEM_NAMES: Record<number, string> = {
  [I.STICK]: "Çubuk",
};

// Birleşik ad: blok → eşya → blok-tanımı
export function itemNameOf(id: number): string {
  return ITEM_NAME[id] ?? ITEM_NAMES[id] ?? "Eşya";
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

export const RECIPES: Recipe[] = [
  // 1 odun → 4 kalas
  rec(1, 1, [[B.WOOD]], B.PLANKS, 4),
  // 2 kalas (dikey) → 4 çubuk
  rec(1, 2, [[B.PLANKS], [B.PLANKS]], I.STICK, 4),
  // 2×2 kalas → üretim masası
  rec(2, 2, [[B.PLANKS, B.PLANKS], [B.PLANKS, B.PLANKS]], B.CRAFTING_TABLE, 1),
  // 3×3 tarifler (araçlar vb.) ilerleyen aşamalarda eklenir.
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
    const cols = 4, T = 16;
    const idx = d.tiles[0];
    c.imageSmoothingEnabled = false;
    c.drawImage(atlas, (idx % cols) * T, Math.floor(idx / cols) * T, T, T, 0, 0, 32, 32);
    url = cv.toDataURL();
  } else {
    url = itemIcon(id);
  }
  iconCache.set(id, url);
  return url;
}
