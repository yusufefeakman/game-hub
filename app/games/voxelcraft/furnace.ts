/* =====================================================================
   VOXELCRAFT — furnace.ts
   Fırın durumu: blok idx → {girdi, yakıt, çıktı, yanma/pişirme}.
   Fırınlar gerçek zamanlı işler — envanter/fırın ekranı açıkken de
   çalışmaya devam ederler. Kayıt için serialize/restore sağlanır.
   ===================================================================== */
import { B } from "./blocks";
import { I, fuelOf, type ItemStack } from "./inventory";

export interface FurnaceState {
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  burn: number;    // kalan yanma süresi (sn)
  burnMax: number; // bu yakıt turunda toplam yanma (UI çubuğu için)
  cook: number;    // mevcut pişirme ilerlemesi (sn)
}

/** idx → fırın durumu */
export const furnaces = new Map<number, FurnaceState>();
/** idx → fırının baktığı yüz (FACE_DIR indeksi 2..5) */
export const furnaceDirs = new Map<number, number>();

export const COOK_TIME = 6; // sn / adet

/** Pişirme sonucu: null = bu eşya pişirilemez. */
export function smeltResult(id: number): { id: number; count: number } | null {
  switch (id) {
    case B.IRON_ORE: return { id: I.IRON, count: 1 };
    case B.GOLD_ORE: return { id: I.GOLD, count: 1 };
    case B.CLAY: return { id: I.BRICK_ITEM, count: 1 };
    case B.SAND: return { id: B.GLASS, count: 1 };
    case B.COBBLE: return { id: B.STONE, count: 1 };
    case I.MEAT: return { id: I.COOKED, count: 1 };
    default: return null;
  }
}

export function openFurnace(i: number): FurnaceState {
  let f = furnaces.get(i);
  if (!f) {
    f = { input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
    furnaces.set(i, f);
  }
  return f;
}

/** Fırını sök: durum döner (içerik düşürülmek üzere), haritalardan silinir. */
export function removeFurnace(i: number): FurnaceState | null {
  const f = furnaces.get(i) ?? null;
  furnaces.delete(i);
  furnaceDirs.delete(i);
  return f;
}

function canCook(f: FurnaceState): boolean {
  const inS = f.input;
  if (!inS) return false;
  const r = smeltResult(inS.id);
  if (!r) return false;
  if (f.output && (f.output.id !== r.id || f.output.count + r.count > 64)) return false;
  return true;
}

/** Tüm fırınları dt saniye işletir. */
export function tickFurnaces(dt: number): void {
  for (const f of furnaces.values()) {
    if (f.burn > 0) f.burn = Math.max(0, f.burn - dt);
    // yakıt bitmiş / yeni yakıt gerekir ve pişirme mümkünse → yak
    if (f.burn <= 0 && f.fuel && canCook(f)) {
      const fs = fuelOf(f.fuel.id);
      if (fs > 0) {
        f.burn = fs;
        f.burnMax = fs;
        f.fuel.count -= 1;
        if (f.fuel.count <= 0) f.fuel = null;
      }
    }
    if (f.burn > 0 && canCook(f)) {
      f.cook += dt;
      if (f.cook >= COOK_TIME) {
        const r = smeltResult(f.input!.id)!;
        f.input!.count -= 1;
        if (f.input!.count <= 0) f.input = null;
        if (f.output) f.output.count += r.count;
        else f.output = { id: r.id, count: r.count };
        f.cook = 0;
      }
    } else if (f.burn <= 0) {
      f.cook = 0; // ateş sönerse pişirme ilerlemesi sıfırlanır
    }
  }
}

/* ---------------- kayıt ---------------- */
type SerStack = [number, number, number | undefined] | null;
type FSer = [number, number, SerStack, SerStack, SerStack, number, number];

const serStack = (s: ItemStack | null): SerStack => (s ? [s.id, s.count, s.dmg] : null);
const desStack = (s: unknown): ItemStack | null => {
  if (Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "number" && s[1] > 0) {
    return { id: s[0], count: s[1], dmg: typeof s[2] === "number" ? s[2] : undefined };
  }
  return null;
};

export function serializeFurnaces(): FSer[] {
  const out: FSer[] = [];
  for (const [i, f] of furnaces) {
    out.push([i, furnaceDirs.get(i) ?? 2, serStack(f.input), serStack(f.fuel), serStack(f.output), Math.round(f.burn), Math.round(f.cook)]);
  }
  return out;
}

export function restoreFurnaces(list: unknown): void {
  furnaces.clear();
  furnaceDirs.clear();
  if (!Array.isArray(list)) return;
  for (const e of list as FSer[]) {
    if (!Array.isArray(e)) continue;
    const [i, dir, inS, fuel, out, burn, cook] = e;
    if (typeof i !== "number" || i < 0) continue;
    furnaces.set(i, {
      input: desStack(inS), fuel: desStack(fuel), output: desStack(out),
      burn: Number(burn) || 0, burnMax: Number(burn) || 0, cook: Number(cook) || 0,
    });
    if (typeof dir === "number" && dir >= 2 && dir <= 5) furnaceDirs.set(i, dir);
  }
}

export function clearFurnaces(): void {
  furnaces.clear();
  furnaceDirs.clear();
}