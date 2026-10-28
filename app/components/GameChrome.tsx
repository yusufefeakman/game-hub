"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { recordPlay } from "../lib/playtrack";
import SimilarShelf from "./SimilarShelf";

/**
 * Oyun rotaları (/games/* ve /fighting) için ortak kabuk:
 *  - son oynananlar + oynama sayısı takibi (yerel depolama)
 *  - tam ekran (⛶) ve yeniden başlat (↻) düğmeleri — yalnız işaretçi
 *    cihazlarda görünür; dokunmatikte oyun kendi kontrollerini kullanır
 */
export default function GameChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [fsOn, setFsOn] = useState(false);

  useEffect(() => {
    const m = pathname.match(/(?:^|\/)(?:games|fighting)\/?([a-z0-9-]+)?/);
    const id = pathname === "/fighting" || pathname.endsWith("/fighting") ? "fighting" : m?.[1];
    if (id) recordPlay(id);
  }, [pathname]);

  useEffect(() => {
    const h = () => setFsOn(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <>
      {children}
      <SimilarShelf />
      <div className="gc-fab" role="group" aria-label="Oyun sayfası kontrolleri">
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={fsOn}
          title={fsOn ? "Tam ekrandan çık (Esc)" : "Tam ekran"}
        >
          {fsOn ? "🗗" : "⛶"}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          title="Oyunu yeniden başlat"
        >
          ↻
        </button>
      </div>
    </>
  );
}
