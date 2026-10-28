"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Pixel Tycoon — Neon Şehir İnşaatçısı
 * Oyunun tamamı tek dosyalık bağımsız HTML'dir (public/tycoon.html);
 * bu sayfa onu gömer. GitHub Pages /game-hub/ altında sunduğu için
 * base yolu çalışma zamanında çözülür.
 */
function withBase(path: string): string {
  if (typeof window === "undefined") return "/game-hub" + path;
  return (window.location.pathname.startsWith("/game-hub") ? "/game-hub" : "") + path;
}

export default function PixelTycoonPage() {
  const [src] = useState(() => withBase("/tycoon.html"));

  return (
    <div className="game-page">
      <Link href="/#katalog" className="game-back">← Tüm Oyunlar</Link>
      <iframe
        className="tycoon-frame"
        src={src}
        title="Pixel Tycoon — Neon Şehir İnşaatçısı"
        allow="autoplay"
      />
    </div>
  );
}
