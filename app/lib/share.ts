/* Oyun paylaşma: Web Share API varsa onu kullanır; yoksa (veya kullanıcı
   vazgeçerse) skorlu metni panoya kopyalar. Sonuç durumunu metin döner. */
import { getArcadeBests } from "./hiscore";

export function shareText(title: string, url: string, best?: string): string {
  const skor = best ? ` — kişisel rekorum: ${best}` : "";
  return `Pixel Arcade'da ${title} oyna${skor}! ${url}`;
}

/** @returns "share" | "copy" | "none" */
export async function shareOrCopy(id: string, title: string, url: string): Promise<string> {
  const best = getArcadeBests()[id] ?? undefined;
  const text = shareText(title, url, best);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: `Pixel Arcade — ${title}`, text, url });
      return "share";
    } catch {
      /* kullanıcı vazgeçti ya da share başarısız → panoya düş */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copy";
  } catch {
    return "none";
  }
}

/* Başlıktan kataloğun id'sine köprü (rekor metnini bulmak için) */
import { GAMES } from "./games";
export function findGame(title: string) {
  return GAMES.find((g) => g.title === title);
}
