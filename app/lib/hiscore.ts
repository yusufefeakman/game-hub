/**
 * Ortak yerel rekor (high-score) altyapısı.
 * Supabase profil skorlarından (auth.saveScore) bağımsız, anlık localStorage:
 * oyunlar offline/oturumsuz da "REKOR: n" gösterebilsin diye.
 */
export type BestKind = "high" | "low"; // high: büyük iyi (skor), low: küçük iyi (süre)

const KEY = "hub-best:";

export function loadBest(gameId: string, kind: BestKind = "high"): number | null {
  try {
    const raw = localStorage.getItem(KEY + gameId);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : null;
  } catch {
    return null; // private mode vb.
  }
}

/** Rekoru denemek için günceller. Döner: { best, isNew }. */
export function submitBest(gameId: string, value: number, kind: BestKind = "high"): { best: number; isNew: boolean } {
  const prev = loadBest(gameId, kind);
  if (prev !== null && (kind === "high" ? value <= prev : value >= prev)) return { best: prev, isNew: false };
  try {
    localStorage.setItem(KEY + gameId, String(value));
  } catch {
    /* yazamasak da ekranda göstermeye devam et */
  }
  return { best: value, isNew: true };
}

/** Oyun içi "REKOR" satırı metni (yoksa boş string). */
export function bestText(gameId: string, label: string, kind: BestKind = "high", unit = ""): string {
  const b = loadBest(gameId, kind);
  if (b === null) return "";
  return `${label}: ${b}${unit}`;
}
