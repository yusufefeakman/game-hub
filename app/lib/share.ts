/* Oyun paylaşma: Web Share API varsa onu kullanır; yoksa (veya kullanıcı
   vazgeçerse) skorlu metni panoya kopyalar. Sonuç durumunu metin döner. */
import { getArcadeBests } from "./hiscore";
import { makeCardFile } from "./sharecard";
import type { GameDef } from "./games";

export function shareText(title: string, url: string, best?: string): string {
  const skor = best ? ` — kişisel rekorum: ${best}` : "";
  return `Pixel Arcade'da ${title} oyna${skor}! ${url}`;
}

/**
 * Paylaşım hiyerarşisi:
 *  1) dosya paylaşabilen tarayıcıda skor kartı PNG'sini iliştirerek paylaş
 *  2) değilse düz metin+bağlantıyla paylaş
 *  3) share yoksa/vazgeçilirse skorlu metni panoya kopyala
 * @returns "share-file" | "share" | "copy" | "none"
 */
export async function shareGame(
  game: Pick<GameDef, "id" | "title" | "emoji" | "art" | "subtitle" | "category">,
  url: string
): Promise<string> {
  const best = getArcadeBests()[game.id] ?? undefined;
  const text = shareText(game.title, url, best);
  let file: File | undefined;
  try {
    file = (await makeCardFile(game, best)) ?? undefined;
  } catch {
    /* canvas kapalıysa kartsız devam */
  }
  const canFiles = Boolean(file) && typeof navigator.canShare === "function" && navigator.canShare({ files: [file as File] });
  if (typeof navigator.share === "function") {
    try {
      if (canFiles) await navigator.share({ files: [file as File], title: `Pixel Arcade — ${game.title}`, text });
      else await navigator.share({ title: `Pixel Arcade — ${game.title}`, text, url });
      return canFiles ? "share-file" : "share";
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
