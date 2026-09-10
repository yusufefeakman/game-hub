/* =====================================================================
   VOXELCRAFT — inventory.ts
   Stack'li envanter + eşya tanımları. Blok kırınca düşen eşyalar buraya
   eklenir; hotbar envanterin ilk 9 slotudur.

   Eşya kimlikleri:
     < 1000  → bloklar (blocks.ts'teki B.*)
     >= 1000 → blok olmayan eşyalar (I.*) — yerleştirilemez.
   Aletler stack başına 1 adet tutar ve `dmg` (kalan dayanıklılık)
   taşır; bloklar/ara eşyalar 64'lük stack olur.
   ===================================================================== */
import { B } from "./blocks";

export interface ItemStack { id: number; count: number; dmg?: number; }
export const STACK_MAX = 64;

export const ITEM_NAME: Record<number, string> = {
  [B.GRASS]: "Çimen", [B.DIRT]: "Toprak", [B.STONE]: "Taş", [B.SAND]: "Kum",
  [B.WOOD]: "Odun", [B.LEAVES]: "Yaprak", [B.PLANKS]: "Kalas", [B.GLASS]: "Cam",
  [B.COBBLE]: "Arnavut", [B.BRICK]: "Tuğla", [B.STONE_BRICKS]: "Taş Tuğla",
  [B.GRAVEL]: "Çakıl", [B.CLAY]: "Kil", [B.SNOW]: "Kar", [B.ICE]: "Buz",
  [B.COAL_ORE]: "Kömür Cevheri", [B.IRON_ORE]: "Demir Cevheri",
  [B.GOLD_ORE]: "Altın Cevheri", [B.DIAMOND_ORE]: "Elmas Cevheri",
  [B.OBSIDIAN]: "Obsidyen", [B.SANDSTONE]: "Kumtaşı",
  [B.FLOWER_RED]: "Kırmızı Çiçek", [B.FLOWER_YELLOW]: "Sarı Çiçek",
  [B.TALL_GRASS]: "Uzun Çimen", [B.MOSSY_COBBLE]: "Yosunlu Arnavut",
  [B.CRAFTING_TABLE]: "Üretim Masası",
  [B.BIRCH_WOOD]: "Huş Odun", [B.BIRCH_LEAVES]: "Huş Yaprağı",
  [B.PINE_WOOD]: "Çam Odun", [B.PINE_LEAVES]: "Çam Yaprağı",
};

// Bu bloklar kırılınca düşer; gerisi (bedrock, su, hava) düşürmez.
export function dropsFor(blockId: number): number | null {
  switch (blockId) {
    case B.AIR: case B.BEDROCK: case B.WATER: return null;
    case B.LEAVES: case B.BIRCH_LEAVES: case B.PINE_LEAVES:
    case B.TALL_GRASS: case B.FLOWER_RED: case B.FLOWER_YELLOW:
      return null; // yapraklar/bitkiler doğrudan düşmez (elma şansı ayrı)
    default:
      return blockId;
  }
}

/* ------------------- blok olmayan eşyalar (1000+) ------------------- */
export const I = {
  STICK: 1000,
  APPLE: 1002, MEAT: 1003, WOOL: 1004, // yemekler / yün
  // aletler (üretim masası 3×3 ile yapılır)
  WPICK: 1010, SPICK: 1011,
  WAXE: 1012, SAXE: 1013,
  WSHOV: 1014, SSHOV: 1015,
} as const;

export type ToolType = "pickaxe" | "axe" | "shovel";
export interface ToolMeta {
  type: ToolType;
  tier: "wood" | "stone";
  dur: number;   // toplam dayanıklılık
  speed: number; // kırma hızı çarpanı (doğru blok türünde)
}
export interface ItemDef {
  name: string;
  stack: number;
  tool?: ToolMeta;
  food?: number; // açlık geri kazanımı (yenilebilir)
}

export const ITEM_DEFS: Record<number, ItemDef> = {
  [I.STICK]: { name: "Çubuk", stack: 64 },
  [I.APPLE]: { name: "Elma", stack: 64, food: 3 },
  [I.MEAT]: { name: "Çiğ Et", stack: 64, food: 4 },
  [I.WOOL]: { name: "Yün", stack: 64 },
  [I.WPICK]: { name: "Tahta Kazma", stack: 1, tool: { type: "pickaxe", tier: "wood", dur: 60, speed: 3.0 } },
  [I.SPICK]: { name: "Taş Kazma", stack: 1, tool: { type: "pickaxe", tier: "stone", dur: 132, speed: 4.5 } },
  [I.WAXE]: { name: "Tahta Balta", stack: 1, tool: { type: "axe", tier: "wood", dur: 60, speed: 3.0 } },
  [I.SAXE]: { name: "Taş Balta", stack: 1, tool: { type: "axe", tier: "stone", dur: 132, speed: 4.5 } },
  [I.WSHOV]: { name: "Tahta Kürek", stack: 1, tool: { type: "shovel", tier: "wood", dur: 60, speed: 3.0 } },
  [I.SSHOV]: { name: "Taş Kürek", stack: 1, tool: { type: "shovel", tier: "stone", dur: 132, speed: 4.5 } },
};

export function itemNameOfItem(id: number): string | undefined {
  return ITEM_DEFS[id]?.name;
}
export function foodOf(id: number): number {
  return ITEM_DEFS[id]?.food ?? 0;
}
export function toolMetaOf(id: number): ToolMeta | undefined {
  return ITEM_DEFS[id]?.tool;
}
export function stackLimitOf(id: number): number {
  return ITEM_DEFS[id]?.stack ?? STACK_MAX;
}
/** Alet ise tam dayanıklılıkla yeni stack üretir. */
export function newStack(id: number, count = 1): ItemStack {
  const tool = ITEM_DEFS[id]?.tool;
  return tool ? { id, count, dmg: tool.dur } : { id, count };
}

export class Inventory {
  slots: (ItemStack | null)[];
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
  }
  get hotbar() { return this.slots.slice(0, 9); }
  get hotbarSize() { return 9; }

  /** Yeni bir stack ekler (aletler tam dayanıklılıkla). */
  add(id: number, count: number): number {
    return this.addStack(newStack(id, count));
  }

  /** Mevcut stack'i (dmg dahil) olduğu gibi ekler; sığmayan miktarı döner. */
  addStack(s: ItemStack): number {
    let remaining = s.count;
    const tool = toolMetaOf(s.id);
    // 1) kısmi stack'lere birleştir (yalnız stack'lenebilir eşyalar)
    if (!tool) {
      for (let i = 0; i < this.slots.length && remaining > 0; i++) {
        const cur = this.slots[i];
        if (cur && cur.id === s.id && cur.count < STACK_MAX) {
          const space = STACK_MAX - cur.count;
          const put = Math.min(space, remaining);
          cur.count += put;
          remaining -= put;
        }
      }
    }
    // 2) boş slotlara koy (alet: her slotta 1, dmg korunur)
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (!this.slots[i]) {
        if (tool) {
          this.slots[i] = { id: s.id, count: 1, dmg: s.dmg ?? tool.dur };
          remaining -= 1;
        } else {
          const put = Math.min(STACK_MAX, remaining);
          this.slots[i] = { id: s.id, count: put };
          remaining -= put;
        }
      }
    }
    return remaining;
  }

  remove(slotIndex: number, count: number): boolean {
    const s = this.slots[slotIndex];
    if (!s || s.count < count) return false;
    s.count -= count;
    if (s.count <= 0) this.slots[slotIndex] = null;
    return true;
  }

  /** Alete 1 hasar verir; kırıldıysa true döner (slot boşalır). */
  damageSlot(slotIndex: number): boolean {
    const s = this.slots[slotIndex];
    if (!s || s.dmg === undefined) return false;
    s.dmg -= 1;
    if (s.dmg <= 0) { this.slots[slotIndex] = null; return true; }
    return false;
  }

  /** Hotbar slotundaki ilk kullanılabilir eşyayı döndürür. */
  peek(slotIndex: number): number | null {
    const s = this.slots[slotIndex];
    return s ? s.id : null;
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  has(id: number, n = 1): boolean { return this.count(id) >= n; }

  take(id: number, n = 1): boolean {
    let need = n;
    for (let i = 0; i < this.slots.length && need > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, need);
        s.count -= take;
        need -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return need === 0;
  }
}
