/* =====================================================================
   VOXELCRAFT — blocks.ts
   Blok kayıt sistemi + prosedürel doku atlası. Mevcut çekirdek
   (fizik, raycast, kontroller) bu verilere dayanır. Harici asset yok:
   her blok dokusu 16×16 canvas ile çizilir.
   ===================================================================== */

// Blok kimlikleri (mevcut değerler korunarak genişletildi)
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  PLANKS: 7,
  GLASS: 8,
  COBBLE: 9,
  BRICK: 10,
  BEDROCK: 11,
  STONE_BRICKS: 12,
  GRAVEL: 13,
  CLAY: 14,
  SNOW: 15,
  ICE: 16,
  COAL_ORE: 17,
  IRON_ORE: 18,
  GOLD_ORE: 19,
  DIAMOND_ORE: 20,
  OBSIDIAN: 21,
  WATER: 22,
  SANDSTONE: 23,
  FLOWER_RED: 24,
  FLOWER_YELLOW: 25,
  TALL_GRASS: 26,
  MOSSY_COBBLE: 27,
  CRAFTING_TABLE: 28,
} as const;
export type BlockId = (typeof B)[keyof typeof B];

export const COUNT = 29;

/* ------------------- doku yardımcıları ------------------- */
// Deterministik 0..1
function h2(n: number): number {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function base(c: CanvasRenderingContext2D, rgb: [number, number, number]) {
  c.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  c.fillRect(0, 0, 16, 16);
}
function noise16(c: CanvasRenderingContext2D, amt: number, lo: number, hi: number, seed: number, rgb: [number, number, number]) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = h2(x * 13.37 + y * 7.31 + seed);
      if (n > amt) continue;
      const k = lo + n * (hi - lo);
      c.fillStyle = `rgba(${Math.min(255, rgb[0] * k)},${Math.min(255, rgb[1] * k)},${Math.min(255, rgb[2] * k)},1)`;
      c.fillRect(x, y, 1, 1);
    }
}

export interface BlockDef {
  name: string;
  // texture indices: [top, bottom, side...] +x -x +z -z → 0..5
  tiles: number[];
  solid: boolean;      // çarpışma var mı (su/hava hayır)
  transparent?: boolean; // cam/buz gibi — ayrı mesh
  liquid?: boolean;     // su
  hardness: number;     // kırılma süresi tabanı
  // texture atlas
}

/* ------------------- atlas üretici ------------------- */
export const ATLAS_TILES: HTMLCanvasElement[] = [];
export let ATLAS_CANVAS: HTMLCanvasElement | null = null;

// tile adları: önce kayıt sırasıyla eklenir
const tileNames: string[] = [];

function regTile(name: string, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = 16; cv.height = 16;
  const c = cv.getContext("2d")!;
  draw(c);
  ATLAS_TILES.push(cv);
  tileNames.push(name);
}
function tileIndex(name: string): number {
  const i = tileNames.indexOf(name);
  return i >= 0 ? i : 0;
}

export function buildAtlas() {
  ATLAS_TILES.length = 0;
  tileNames.length = 0;
  const T = 16;

  // helper: karışık gürültüyle dolu yüzey
  const speck = (rgb: [number, number, number], r1: [number, number, number], r2: [number, number, number], seed: number) => (c: CanvasRenderingContext2D) => {
    base(c, rgb);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const n = h2(x * 7.1 + y * 3.7 + seed);
        if (n > 0.55) { c.fillStyle = `rgb(${r1[0]},${r1[1]},${r1[2]})`; c.fillRect(x, y, 1, 1); }
        else if (n < 0.12) { c.fillStyle = `rgb(${r2[0]},${r2[1]},${r2[2]})`; c.fillRect(x, y, 1, 1); }
      }
  };

  regTile("grass_top", (c) => { base(c, [106, 190, 78]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 9.1 + y * 5.3 + 1); if (n > 0.6) { c.fillStyle = n > 0.8 ? "rgb(122,210,92)" : "rgb(88,168,64)"; c.fillRect(x, y, 1, 1); } } });
  regTile("grass_side", (c) => { base(c, [134, 96, 67]); c.fillStyle = "rgb(106,190,78)"; c.fillRect(0, 0, 16, 4); c.fillStyle = "rgb(92,170,66)"; for (let x = 0; x < 16; x++) { if (h2(x + 40) > 0.45) c.fillRect(x, 4, 1, 1); } noise16(c, 0.4, 0.92, 1.1, 77, [134, 96, 67]); });
  regTile("grass_bottom", (c) => { base(c, [134, 96, 67]); noise16(c, 0.5, 0.9, 1.12, 5, [134, 96, 67]); });

  regTile("dirt", (c) => { base(c, [134, 96, 67]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 4.7 + y * 8.3 + 3); if (n > 0.6) { c.fillStyle = n > 0.85 ? "rgb(150,110,80)" : "rgb(115,80,55)"; c.fillRect(x, y, 1, 1); } } });
  regTile("stone", (c) => { base(c, [127, 127, 127]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 5.1 + y * 9.7 + 11); if (n > 0.62) { c.fillStyle = n > 0.85 ? "rgb(150,150,150)" : "rgb(105,105,105)"; c.fillRect(x, y, 1, 1); } } });
  regTile("sand", (c) => { base(c, [219, 206, 158]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 11.3 + y * 4.1 + 21); if (n > 0.7) { c.fillStyle = n > 0.9 ? "rgb(233,222,180)" : "rgb(200,186,140)"; c.fillRect(x, y, 1, 1); } } });
  regTile("sandstone", (c) => { base(c, [222, 210, 160]); for (let y = 4; y < 16; y += 4) { c.fillStyle = "rgb(200,188,140)"; c.fillRect(0, y, 16, 1); } });

  regTile("log_top", (c) => { base(c, [150, 111, 70]); c.fillStyle = "rgb(190,150,100)"; c.beginPath(); c.arc(8, 8, 5, 0, 7); c.fill(); c.fillStyle = "rgb(120,85,50)"; c.beginPath(); c.arc(8, 8, 3, 0, 7); c.fill(); });
  regTile("log_side", (c) => { base(c, [110, 80, 50]); for (let y = 0; y < 16; y += 4) { c.fillStyle = "rgb(145,110,70)"; c.fillRect(0, y + 1, 16, 1); } for (let x = 2; x < 16; x += 5) { c.fillStyle = "rgb(90,62,38)"; c.fillRect(x, 0, 1, 16); } });
  regTile("leaves", (c) => { base(c, [58, 132, 50]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 3.3 + y * 7.9 + 30); if (n > 0.4) { c.fillStyle = n > 0.75 ? "rgb(92,170,80)" : "rgb(36,96,34)"; c.fillRect(x, y, 1, 1); } } });
  regTile("planks", (c) => { base(c, [176, 136, 90]); for (let y = 0; y < 16; y += 4) { c.fillStyle = "rgb(120,88,55)"; c.fillRect(0, y, 16, 1); } c.fillStyle = "rgb(200,160,110)"; for (let x = 0; x < 16; x += 4) { c.fillRect(x, 2, 1, 2); c.fillRect(x + 2, 6, 1, 2); c.fillRect(x, 10, 1, 2); c.fillRect(x + 2, 14, 1, 2); } });
  // Üretim masası: üst yüzde iş kılavuzu, yanda çekiç/testere izlenimi
  regTile("craft_top", (c) => { base(c, [176, 136, 90]); c.fillStyle = "rgb(120,88,55)"; for (let y = 0; y < 16; y += 4) c.fillRect(0, y, 16, 1); c.fillStyle = "rgb(200,160,110)"; for (let x = 0; x < 16; x += 4) { c.fillRect(x, 2, 1, 2); c.fillRect(x + 2, 6, 1, 2); c.fillRect(x, 10, 1, 2); c.fillRect(x + 2, 14, 1, 2); } c.fillStyle = "rgba(96,66,38,.8)"; c.fillRect(1, 1, 14, 1); c.fillRect(1, 14, 14, 1); c.fillRect(1, 1, 1, 14); c.fillRect(14, 1, 1, 14); c.fillRect(6, 6, 4, 1); c.fillRect(6, 9, 4, 1); });
  regTile("craft_side", (c) => { base(c, [156, 116, 72]); c.fillStyle = "rgb(110,80,50)"; for (let y = 0; y < 16; y += 4) c.fillRect(0, y, 16, 1); c.fillStyle = "rgb(96,66,38)"; c.fillRect(0, 0, 16, 2); c.fillStyle = "rgb(196,160,112)"; c.fillRect(2, 6, 12, 4); c.fillStyle = "rgb(120,88,55)"; c.fillRect(6, 10, 4, 6); c.fillStyle = "rgb(90,62,38)"; c.fillRect(7, 11, 2, 4); });

  regTile("glass", (c) => { base(c, [210, 240, 245]); c.fillStyle = "rgba(255,255,255,0.5)"; c.fillRect(0, 0, 16, 2); c.fillRect(0, 0, 2, 16); c.strokeStyle = "rgb(170,215,225)"; c.strokeRect(0.5, 0.5, 15, 15); });

  regTile("cobble", (c) => { base(c, [120, 120, 120]); const blobs = [[0, 0], [8, 0], [2, 8], [9, 8], [4, 4], [12, 4], [0, 12], [9, 12]]; for (const [bx, by] of blobs) { c.fillStyle = h2(bx + by * 3) > 0.5 ? "rgb(138,138,138)" : "rgb(104,104,104)"; for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 7; xx++) if ((xx === 0 || yy === 0 || xx === 6 || yy === 5) || h2(xx * 9 + yy * 5 + bx) > 0.4) c.fillRect((bx + xx) % 16, (by + yy) % 16, 1, 1); } });
  regTile("brick", (c) => { base(c, [155, 84, 72]); c.fillStyle = "rgb(188,112,96)"; for (let row = 0; row < 8; row++) { const y = row * 2; const off = row % 2 === 0 ? 0 : 4; for (let x = -off; x < 16; x += 8) c.fillRect(x, y, 7, 1); } c.fillStyle = "rgb(120,58,50)"; for (let row = 0; row < 8; row++) { const y = row * 2; c.fillRect(0, y + 1, 16, 1); } });
  regTile("stone_bricks", (c) => { base(c, [140, 140, 140]); c.fillStyle = "rgb(118,118,118)"; for (let y = 0; y < 16; y += 4) c.fillRect(0, y, 16, 1); c.fillStyle = "rgb(118,118,118)"; for (let row = 0; row < 4; row++) { const off = row % 2 === 0 ? 0 : 8; c.fillRect((off) % 16, row * 4, 1, 4); c.fillRect((off + 8) % 16, row * 4, 1, 4); } });

  regTile("bedrock", (c) => { base(c, [48, 48, 48]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 9.9 + y * 3.1 + 7); if (n > 0.4) c.fillStyle = n > 0.7 ? "rgb(70,70,70)" : "rgb(28,28,28)"; else c.fillStyle = "rgb(48,48,48)"; c.fillRect(x, y, 1, 1); } });

  regTile("gravel", (c) => { base(c, [126, 116, 110]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 13.1 + y * 6.7 + 4); if (n > 0.5) { c.fillStyle = n > 0.8 ? "rgb(150,140,132)" : "rgb(100,92,88)"; c.fillRect(x, y, 1, 1); } } });
  regTile("clay", (c) => { base(c, [148, 152, 168]); noise16(c, 0.4, 0.92, 1.1, 91, [148, 152, 168]); });

  regTile("snow", (c) => { base(c, [238, 244, 250]); noise16(c, 0.35, 0.94, 1.1, 12, [238, 244, 250]); });
  regTile("ice", (c) => { base(c, [140, 205, 235]); c.strokeStyle = "rgba(255,255,255,0.5)"; c.strokeRect(0.5, 0.5, 15, 15); });

  regTile("coal_ore", (c) => { speck([110, 110, 110], [140, 140, 140], [88, 88, 88], 44)(c); c.fillStyle = "rgb(24,24,24)"; for (const [x, y] of [[4, 4], [11, 5], [6, 10], [12, 12], [3, 12]]) c.fillRect(x, y, 4, 3); });
  regTile("iron_ore", (c) => { speck([120, 120, 120], [150, 150, 150], [95, 95, 95], 45)(c); c.fillStyle = "rgb(214,150,110)"; for (const [x, y] of [[3, 4], [10, 3], [5, 10], [12, 9]]) c.fillRect(x, y, 4, 3); });
  regTile("gold_ore", (c) => { speck([120, 120, 120], [150, 150, 150], [95, 95, 95], 46)(c); c.fillStyle = "rgb(245,220,80)"; for (const [x, y] of [[2, 3], [10, 8], [5, 13], [12, 2]]) c.fillRect(x, y, 3, 2); });
  regTile("diamond_ore", (c) => { speck([120, 120, 120], [150, 150, 150], [95, 95, 95], 47)(c); c.fillStyle = "rgb(95,225,225)"; for (const [x, y] of [[3, 3], [11, 9], [4, 12], [12, 4]]) c.fillRect(x, y, 3, 3); });

  regTile("obsidian", (c) => { base(c, [24, 18, 38]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 7.3 + y * 11.1 + 90); if (n > 0.72) { c.fillStyle = n > 0.9 ? "rgb(70,55,110)" : "rgb(14,10,24)"; c.fillRect(x, y, 1, 1); } } });

  regTile("water", (c) => { base(c, [52, 110, 200]); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 8.1 + y * 4.9 + 70); if (n > 0.6) { c.fillStyle = n > 0.85 ? "rgb(70,140,220)" : "rgb(34,88,170)"; c.fillRect(x, y, 1, 1); } } });

  regTile("flower_red", (c) => { base(c, [52, 120, 60]); c.fillStyle = "rgb(40,96,44)"; c.fillRect(7, 6, 2, 9); c.fillStyle = "rgb(220,60,60)"; for (const [x, y] of [[6, 6], [10, 6], [8, 4], [8, 8]]) { c.fillRect(x, y, 2, 2); c.fillRect(x + 1, y - 1, 1, 1); } });
  regTile("flower_yellow", (c) => { base(c, [52, 120, 60]); c.fillStyle = "rgb(40,96,44)"; c.fillRect(7, 6, 2, 9); c.fillStyle = "rgb(245,220,80)"; for (const [x, y] of [[5, 5], [8, 3], [10, 7], [7, 7]]) c.fillRect(x, y, 3, 2); });
  regTile("tall_grass", (c) => { base(c, [52, 120, 60]); c.fillStyle = "rgb(70,150,70)"; for (let x = 3; x < 14; x += 3) { c.fillRect(x, 4, 1, 11); c.fillStyle = "rgb(96,180,90)"; c.fillRect(x + 1, 4, 1, 6); c.fillRect(x - 1, 6, 1, 8); c.fillStyle = "rgb(70,150,70)"; } });
  regTile("mossy_cobble", (c) => { const cv2 = document.createElement("canvas"); cv2.width = 16; cv2.height = 16; const cc = cv2.getContext("2d")!; speck([120, 120, 120], [138, 138, 138], [104, 104, 104], 48)(cc); // moss patches
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = h2(x * 3.7 + y * 6.1 + 200); if (n > 0.72) { cc.fillStyle = "rgb(80,140,80)"; cc.fillRect(x, y, 1, 1); } } c.drawImage(cv2, 0, 0); });

  // ---- atlas'ı derle: 4×N grid (16px tile) ----
  const cols = 4, rows = Math.ceil(ATLAS_TILES.length / cols);
  ATLAS_CANVAS = document.createElement("canvas");
  ATLAS_CANVAS.width = cols * T;
  ATLAS_CANVAS.height = rows * T;
  const actx = ATLAS_CANVAS.getContext("2d")!;
  ATLAS_TILES.forEach((cv, i) => {
    actx.drawImage(cv, (i % cols) * T, Math.floor(i / cols) * T);
  });
}

/* atlas UV → 0..1 */
export function tileUV(index: number): [number, number, number, number] {
  const cols = 4, T = 16;
  const x = (index % cols) * T;
  const y = Math.floor(index / cols) * T;
  const W = ATLAS_CANVAS ? ATLAS_CANVAS.width : 64;
  const H = ATLAS_CANVAS ? ATLAS_CANVAS.height : 112;
  return [x / W, y / H, (x + T) / W, (y + T) / H];
}

/* ------------------- blok tanımları ------------------- */
export const BLOCKS: BlockDef[] = [];
function def(id: number, name: string, tiles: number[], solid: boolean, hardness: number, extra?: { transparent?: boolean; liquid?: boolean }) {
  BLOCKS[id] = { name, tiles, solid, hardness, ...extra };
}

export function initBlocks() {
  buildAtlas();
  const T = tileIndex;
  const ti = (name: string) => T(name);

  def(B.AIR, "Hava", [0, 0, 0, 0, 0, 0], false, 0);
  def(B.GRASS, "Çimen", [ti("grass_top"), ti("grass_bottom"), ti("grass_side"), ti("grass_side"), ti("grass_side"), ti("grass_side")], true, 0.6);
  def(B.DIRT, "Toprak", [ti("dirt"), ti("dirt"), ti("dirt"), ti("dirt"), ti("dirt"), ti("dirt")], true, 0.5);
  def(B.STONE, "Taş", [ti("stone"), ti("stone"), ti("stone"), ti("stone"), ti("stone"), ti("stone")], true, 1.5);
  def(B.SAND, "Kum", [ti("sand"), ti("sand"), ti("sand"), ti("sand"), ti("sand"), ti("sand")], true, 0.5);
  def(B.WOOD, "Odun", [ti("log_top"), ti("log_top"), ti("log_side"), ti("log_side"), ti("log_side"), ti("log_side")], true, 2.0);
  def(B.LEAVES, "Yaprak", [ti("leaves"), ti("leaves"), ti("leaves"), ti("leaves"), ti("leaves"), ti("leaves")], true, 0.2, { transparent: true });
  def(B.PLANKS, "Kalas", [ti("planks"), ti("planks"), ti("planks"), ti("planks"), ti("planks"), ti("planks")], true, 2.0);
  def(B.GLASS, "Cam", [ti("glass"), ti("glass"), ti("glass"), ti("glass"), ti("glass"), ti("glass")], true, 0.3, { transparent: true });
  def(B.COBBLE, "Arnavut", [ti("cobble"), ti("cobble"), ti("cobble"), ti("cobble"), ti("cobble"), ti("cobble")], true, 2.0);
  def(B.BRICK, "Tuğla", [ti("brick"), ti("brick"), ti("brick"), ti("brick"), ti("brick"), ti("brick")], true, 2.0);
  def(B.BEDROCK, "Ana Kaya", [ti("bedrock"), ti("bedrock"), ti("bedrock"), ti("bedrock"), ti("bedrock"), ti("bedrock")], true, -1);
  def(B.STONE_BRICKS, "Taş Tuğla", [ti("stone_bricks"), ti("stone_bricks"), ti("stone_bricks"), ti("stone_bricks"), ti("stone_bricks"), ti("stone_bricks")], true, 1.5);
  def(B.GRAVEL, "Çakıl", [ti("gravel"), ti("gravel"), ti("gravel"), ti("gravel"), ti("gravel"), ti("gravel")], true, 0.6);
  def(B.CLAY, "Kil", [ti("clay"), ti("clay"), ti("clay"), ti("clay"), ti("clay"), ti("clay")], true, 0.6);
  def(B.SNOW, "Kar", [ti("snow"), ti("dirt"), ti("snow"), ti("snow"), ti("snow"), ti("snow")], true, 0.4);
  def(B.ICE, "Buz", [ti("ice"), ti("ice"), ti("ice"), ti("ice"), ti("ice"), ti("ice")], true, 0.5, { transparent: true });
  def(B.COAL_ORE, "Kömür Cevheri", [ti("coal_ore"), ti("coal_ore"), ti("coal_ore"), ti("coal_ore"), ti("coal_ore"), ti("coal_ore")], true, 3.0);
  def(B.IRON_ORE, "Demir Cevheri", [ti("iron_ore"), ti("iron_ore"), ti("iron_ore"), ti("iron_ore"), ti("iron_ore"), ti("iron_ore")], true, 3.0);
  def(B.GOLD_ORE, "Altın Cevheri", [ti("gold_ore"), ti("gold_ore"), ti("gold_ore"), ti("gold_ore"), ti("gold_ore"), ti("gold_ore")], true, 3.0);
  def(B.DIAMOND_ORE, "Elmas Cevheri", [ti("diamond_ore"), ti("diamond_ore"), ti("diamond_ore"), ti("diamond_ore"), ti("diamond_ore"), ti("diamond_ore")], true, 3.0);
  def(B.OBSIDIAN, "Obsidyen", [ti("obsidian"), ti("obsidian"), ti("obsidian"), ti("obsidian"), ti("obsidian"), ti("obsidian")], true, 6.0);
  def(B.WATER, "Su", [ti("water"), ti("water"), ti("water"), ti("water"), ti("water"), ti("water")], false, 0, { liquid: true });
  def(B.SANDSTONE, "Kumtaşı", [ti("sandstone"), ti("sandstone"), ti("sandstone"), ti("sandstone"), ti("sandstone"), ti("sandstone")], true, 0.8);
  def(B.FLOWER_RED, "Kırmızı Çiçek", [ti("flower_red"), ti("flower_red"), ti("flower_red"), ti("flower_red"), ti("flower_red"), ti("flower_red")], false, 0, { transparent: true });
  def(B.FLOWER_YELLOW, "Sarı Çiçek", [ti("flower_yellow"), ti("flower_yellow"), ti("flower_yellow"), ti("flower_yellow"), ti("flower_yellow"), ti("flower_yellow")], false, 0, { transparent: true });
  def(B.TALL_GRASS, "Uzun Çimen", [ti("tall_grass"), ti("tall_grass"), ti("tall_grass"), ti("tall_grass"), ti("tall_grass"), ti("tall_grass")], false, 0, { transparent: true });
  def(B.MOSSY_COBBLE, "Yosunlu Arnavut", [ti("mossy_cobble"), ti("mossy_cobble"), ti("mossy_cobble"), ti("mossy_cobble"), ti("mossy_cobble"), ti("mossy_cobble")], true, 2.0);
  def(B.CRAFTING_TABLE, "Üretim Masası", [ti("craft_top"), ti("planks"), ti("craft_side"), ti("craft_side"), ti("craft_side"), ti("craft_side")], true, 2.5);
}

export function blockName(id: number): string {
  const d = BLOCKS[id];
  return d ? d.name : "?";
}
export function isSolid(id: number): boolean {
  const d = BLOCKS[id];
  return !!d && d.solid && !d.liquid;
}
export function isTransparent(id: number): boolean {
  const d = BLOCKS[id];
  return !!d && !!d.transparent && !d.liquid;
}
export function isLiquid(id: number): boolean {
  const d = BLOCKS[id];
  return !!d && !!d.liquid;
}
export function isBreakable(id: number): boolean {
  const d = BLOCKS[id];
  return !!d && d.hardness >= 0 && id !== B.AIR;
}
