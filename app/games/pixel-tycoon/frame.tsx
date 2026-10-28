"use client";

import { useState } from "react";

/**
 * Pixel Tycoon çerçevesi: public/tycoon.html'i gömer.
 * GitHub Pages /game-hub/ altında sunduğu için base yolu çalışma
 * zamanında çözülür.
 */
function withBase(path: string): string {
  if (typeof window === "undefined") return "/game-hub" + path;
  return (window.location.pathname.startsWith("/game-hub") ? "/game-hub" : "") + path;
}

export default function TycoonFrame() {
  const [src] = useState(() => withBase("/tycoon.html"));
  return (
    <iframe
      className="tycoon-frame"
      src={src}
      title="Pixel Tycoon — Neon Şehir İnşaatçısı"
      allow="autoplay"
    />
  );
}
