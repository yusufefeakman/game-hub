import type { Metadata } from "next";
import Link from "next/link";
import TycoonFrame from "./frame";

/**
 * Pixel Tycoon — Neon Şehir İnşaatçısı
 * Oyunun tamamı tek dosyalık bağımsız HTML'dir (public/tycoon.html);
 * bu sayfa onu gömer ve sayfaya kendi başlığını verir.
 */
export const metadata: Metadata = {
  title: "Pixel Tycoon — Pixel Arcade",
  description: "Neon şehir tycoon: ev, dükkan ve fabrika inşa et; dayanıklılık, tamir ve rastgele olaylarla şehrini yönet.",
};

export default function PixelTycoonPage() {
  return (
    <div className="game-page">
      <Link href="/#katalog" className="game-back">← Tüm Oyunlar</Link>
      <TycoonFrame />
    </div>
  );
}
