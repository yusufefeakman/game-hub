/* =====================================================================
   VOXELCRAFT — save.ts
   Kayıt sistemi (localStorage).

   v2 (varsayılan): dünya tam kopya yerine seed + oyuncu düzenlemeleri
     (idx → blok) olarak saklanır → kayıt MB yerine birkaç KB olur.
   v1 (eski kayıtlar): tüm dünya base64 — okunabilirliği korunur.
   ===================================================================== */

const KEY = "voxelcraft_save_v1";
const PENDING_KEY = "voxelcraft_pending_seed";

export interface SavePlayer {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hp: number; hunger: number;
}

type SaveInv = ((number | undefined)[] | null)[];

/** Eski format: tüm dünya base64 gömülü. */
export interface SaveDataV1 {
  v: 1;
  world: string;
  time: number;
  player: SavePlayer;
  inv: SaveInv;
  slot: number;
  seed?: number;
}

/** Yeni format: seed + düzenleme günlüğü. */
export interface SaveDataV2 {
  v: 2;
  seed: number;
  edits: [number, number][];
  time: number;
  player: SavePlayer;
  inv: SaveInv;
  slot: number;
  renderRadius?: number;
}

export type SaveFile = SaveDataV1 | SaveDataV2;

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

/** v2 kaydı üretir (seed + düzenlemeler). */
export function makeSaveV2(
  seed: number,
  editList: Iterable<readonly [number, number]>,
  player: SavePlayer,
  time: number,
  inv: ({ id: number; count: number; dmg?: number } | null)[],
  slot: number,
  renderRadius: number,
): SaveDataV2 {
  return {
    v: 2,
    seed,
    edits: Array.from(editList, ([i, b]) => [i, b] as [number, number]),
    time,
    player: { ...player },
    inv: inv.map((s) => (s ? [s.id, s.count, s.dmg] : null)),
    slot,
    renderRadius,
  };
}

/** Eski tip kayıt (tam dünya) — uyumluluk için korunur. */
export function makeSave(
  world: Uint8Array,
  player: SavePlayer,
  time: number,
  inv: ({ id: number; count: number; dmg?: number } | null)[],
  slot: number,
  seed?: number,
): SaveDataV1 {
  return {
    v: 1,
    world: b64(world),
    time,
    player: { ...player },
    inv: inv.map((s) => (s ? [s.id, s.count, s.dmg] : null)),
    slot,
    seed,
  };
}

export function writeSave(data: SaveFile): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveFile;
    if (!d || !d.player) return null;
    if (d.v === 2 && Array.isArray(d.edits) && typeof d.seed === "number") return d;
    if (d.v === 1 && typeof d.world === "string") return d;
    return null;
  } catch {
    return null;
  }
}

/** v1 kayıtlardaki dünya bloklarını döndürür (uzunluk uyuşmazsa null). */
export function saveWorldBytes(data: SaveDataV1, expectedLen: number): Uint8Array | null {
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

/* ---------------- menüden yeni dünya seed'i ---------------- */

export function setPendingSeed(seed: string): void {
  try { localStorage.setItem(PENDING_KEY, seed); } catch { /* boş */ }
}

/** Bekleyen seed'i tüketir (yoksa null). Sayı değilse metinden türetilir. */
export function takePendingSeed(): number | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw === null) return null;
    localStorage.removeItem(PENDING_KEY);
    if (raw.trim() === "") return null;
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? (n | 0) || 1 : hashSeedText(raw.trim());
  } catch {
    return null;
  }
}

/** Metin seed'i (örn. "yusuf") kararlı bir sayıya çevirir. */
export function hashSeedText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h | 0) || 1;
}
