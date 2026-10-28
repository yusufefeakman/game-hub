/* Oyun puanları: arcade'da yıldız verildiğinde arcade_ratings anahtarına
   yazılır; ana sayfa kartları aynı kaynağı okur (tek doğruluk kaynağı). */

export interface RatingRec { sum: number; count: number; mine: number }
export type RatingsMap = Record<string, RatingRec>;

export function loadRatings(): RatingsMap {
  try {
    return JSON.parse(localStorage.getItem("arcade_ratings") || "{}") as RatingsMap;
  } catch {
    return {};
  }
}

/** Popülerliğe dayalı sanal taban + gerçek kullanıcı puanlarını harmanlar. */
export function calcAvg(
  g: { id: string; pop: number },
  ratings: RatingsMap
): { avg: number; votes: number; mine: number } {
  const base = 4 + Math.max(0, Math.min(0.8, ((g.pop - 76) / 19) * 0.8));
  const baseVotes = g.pop * 37;
  const r = ratings[g.id];
  if (!r || r.count === 0) return { avg: base, votes: baseVotes, mine: 0 };
  return { avg: (baseVotes * base + r.sum) / (baseVotes + r.count), votes: baseVotes + r.count, mine: r.mine };
}

/** 12235 → "12.2K" (arcade ve ana sayfa aynı biçim) */
export function fmtVotes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + "K";
  return String(n);
}
