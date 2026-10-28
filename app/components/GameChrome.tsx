"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { recordPlay } from "../lib/playtrack";
import SimilarShelf from "./SimilarShelf";
import { shareGame } from "../lib/share";
import { GAMES_BY_ID } from "../lib/games";
import RecordCelebration from "./RecordCelebration";

/**
 * Oyun rotaları (/games/* ve /fighting) için ortak kabuk:
 *  - son oynananlar + oynama sayısı takibi (yerel depolama)
 *  - tam ekran (⛶) ve yeniden başlat (↻) düğmeleri — yalnız işaretçi
 *    cihazlarda görünür; dokunmatikte oyun kendi kontrollerini kullanır
 */
export default function GameChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [fsOn, setFsOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const doShare = async () => {
    const m = pathname.match(/(?:^|\/)\/?(?:games|fighting)\/?([a-z0-9-]+)?/);
    const id = pathname === "/fighting" || pathname.endsWith("/fighting") ? "fighting" : m?.[1];
    if (!id) return;
    const g = GAMES_BY_ID[id];
    const base = window.location.pathname.startsWith("/game-hub") ? "/game-hub" : "";
    const url = g ? new URL(base + g.route, window.location.origin).href : window.location.href;
    if (!g) {
      const res = await navigator.clipboard.writeText(url).then(() => "copy").catch(() => "none");
      if (res === "copy") setToast("🔗 Bağlantı panoya kopyalandı");
      setTimeout(() => setToast(null), 2200);
      return;
    }
    const res = await shareGame(g, url);
    if (res === "copy") setToast("🔗 Bağlantı panoya kopyalandı");
    else if (res === "none") setToast("Paylaşım desteklenmiyor");
    setTimeout(() => setToast(null), 2200);
  };

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
      <RecordCelebration />
      {toast ? <div className="gc-toast" role="status">{toast}</div> : null}
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
        <button
          type="button"
          onClick={doShare}
          title="Oyunu paylaş"
        >
          📤
        </button>
      </div>
    </>
  );
}
