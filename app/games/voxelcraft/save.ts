/* =====================================================================
   VOXELCRAFT — save.ts
   Kayıt sistemi (localStorage): dünya bloğu (base64), oyuncu, saat,
   envanter (dmg dahil) ve seçili slot tek anahtarda saklanır.
   Dünya ~0.9MB ham → ~1.2MB base64; localStorage için uygundur.
   ===================================================================== */

const KEY = "voxelcraft_save_v1";

export interface SavePlayer {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hp: number; hunger: number;
}

export interface SaveData {
  v: 1;
  world: string;       // base64 (Uint8Array)
  time: number;        // worldTime
  player: SavePlayer;
  inv: ((number | undefined)[] | null)[]; // her slot: [id,count,dmg?] | null
  slot: number;
}

function b64(buf: Uint8Array): string {
  let bin = "";
  const chunk = 0x4000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Veriyi kaydetmeye hazır SaveData'ya çevirir. */
export function makeSave(
  world: Uint8Array,
  player: SavePlayer,
  time: number,
  inv: ({ id: number; count: number; dmg?: number } | null)[],
  slot: number,
): SaveData {
  return {
    v: 1,
    world: b64(world),
    time,
    player: { ...player },
    inv: inv.map((s) => (s ? [s.id, s.count, s.dmg] : null)),
    slot,
  };
}

export function writeSave(data: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d && d.v === 1 && typeof d.world === "string" && d.player) return d;
    return null;
  } catch {
    return null;
  }
}

/** Kayıtlı dünya bloklarını döndürür (uzunluk uyuşmazsa null). */
export function saveWorldBytes(data: SaveData, expectedLen: number): Uint8Array | null {
  try {
    const b = unb64(data.world);
    return b.length === expectedLen ? b : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* boş */ }
}
