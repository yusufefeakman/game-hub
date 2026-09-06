/* =====================================================================
   VOXELCRAFT — inventory.ts
   Stack'li envanter + eşya tanımları. Blok kırınca düşen eşyalar buraya
   eklenir; hotbar envanterin ilk 9 slotudur. UI (sürükle/bırak) engine
   tarafında DOM ile kurulur.
   ===================================================================== */
import { B } from "./blocks";

export interface ItemStack { id: number; count: number; }
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
};

// Bu bloklar kırılınca düşer; gerisi (bedrock, su, hava) düşürmez.
export function dropsFor(blockId: number): number | null {
  switch (blockId) {
    case B.AIR: case B.BEDROCK: case B.WATER: return null;
    case B.LEAVES: case B.TALL_GRASS: case B.FLOWER_RED: case B.FLOWER_YELLOW:
      return null; // doğada toplanamaz (ileride elma vb.)
    default:
      return blockId;
  }
}

export class Inventory {
  slots: (ItemStack | null)[];
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
  }
  get hotbar() { return this.slots.slice(0, 9); }
  get hotbarSize() { return 9; }

  /** Boş/aynı id'li bir slota ekler; tamamı sığmazsa artanı döner. */
  add(id: number, count: number): number {
    let remaining = count;
    // önce aynı id'li kısmi stack'ler
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < STACK_MAX) {
        const space = STACK_MAX - s.count;
        const put = Math.min(space, remaining);
        s.count += put;
        remaining -= put;
      }
    }
    // sonra boş slotlar
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (!this.slots[i]) {
        const put = Math.min(STACK_MAX, remaining);
        this.slots[i] = { id, count: put };
        remaining -= put;
      }
    }
    return remaining; // sığmayan miktar
  }

  remove(slotIndex: number, count: number): boolean {
    const s = this.slots[slotIndex];
    if (!s || s.count < count) return false;
    s.count -= count;
    if (s.count <= 0) this.slots[slotIndex] = null;
    return true;
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
