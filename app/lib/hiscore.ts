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

/* ---- Arcade kart vitrini: oyun kimliği → rekor rozeti metni ----
   Her oyun rekorunu kendi (tarihsel) anahtarında tutuyor; burada tek
   yerden okunup tr-TR biçimli görüntü metnine çevrilir. */
const numFmt = new Intl.NumberFormat("tr-TR");
function rawKey(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function secs(v: number): string {
  return `${Math.round(v * 10) / 10} sn`;
}

export function getArcadeBests(): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (id: string, v: number | null, fmt: (n: number) => string = (n) => numFmt.format(Math.round(n))) => {
    if (v !== null) out[id] = fmt(v);
  };
  // skor tabanlı (büyük iyi)
  put("world-war-z", rawKey("hub-best:world-war-z"));
  put("lets-world", rawKey("hub-best:lets-world"));
  put("pixel-pals", rawKey("hub-best:pixel-pals"));
  put("yilan-arena", rawKey("yilan-arena-best"));
  put("spaceship", rawKey("ss-best"));
  put("candy-burst", rawKey("candy-burst-best"));
  put("astro-blaster", rawKey("astro-blaster-best"));
  put("doping-runner", rawKey("doping-best"), (n) => `${numFmt.format(Math.round(n))} m`);
  put("anime-legends", rawKey("hub-best:anime-legends"));
  put("fighter", rawKey("hub-best:fighter"), (n) => `${numFmt.format(Math.round(n))} galibiyet`);
  put("fighting", rawKey("hub-best:fighting"), (n) => `${numFmt.format(Math.round(n))} galibiyet`);
  put("okey", rawKey("hub-best:okey"), (n) => `${numFmt.format(Math.round(n))} maç galibiyeti`);
  put("chess", rawKey("hub-best:chess"), (n) => `${numFmt.format(Math.round(n))} galibiyet`);
  // sunny-side-ride: kendi HTML belgesinin JSON kaydı ({score, tokens})
  try {
    const ssr = JSON.parse(localStorage.getItem("sunnySideRide.best.v1") || "null") as { score?: number } | null;
    if (ssr && Number.isFinite(Number(ssr.score)) && Number(ssr.score) > 0)
      out["sunny-side-ride"] = `${numFmt.format(Math.round(Number(ssr.score)))} puan`;
  } catch { /* bozuk kayıt */ }
  // süre tabanlı (küçük iyi)
  put("powerboat", rawKey("hub-best:powerboat"), secs);
  put("akil-kupu", rawKey("akilkupu_best"), secs);
  // mayın: zorluk bazlı JSON — kayıtlı en hızlı süre
  try {
    const m = JSON.parse(localStorage.getItem("mayin-tarlasi-best") || "{}") as Record<string, number>;
    const vals = Object.values(m).map(Number).filter((v) => Number.isFinite(v) && v > 0);
    if (vals.length) out["mayin-tarlasi"] = secs(Math.min(...vals));
  } catch { /* bozuk kayıt */ }
  return out;
}
