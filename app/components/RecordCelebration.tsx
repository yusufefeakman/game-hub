"use client";

/* Oyun sayfasında canlı rekor takibi: oyun kendi rekor anahtarını
   iyileştirdiğinde (hiscore deposunda değer değişince) tek seferlik
   "🏆 YENİ REKOR" kutlaması + skor kartı önizlemesi + paylaşma.
   Not: oyunlar rekor anahtarına yalnızca daha iyi skoru yazar, bu
   yüzden anahtardaki herhangi bir değişme iyileşme demektir. */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getArcadeBests } from "../lib/hiscore";
import { GAMES_BY_ID, type GameDef } from "../lib/games";
import { shareGame } from "../lib/share";
import { drawScoreCard } from "../lib/sharecard";
import { playFanfare } from "../lib/fanfare";
import { loadSettings } from "../lib/settings";

const POLL_MS = 1500;

export default function RecordCelebration() {
  const pathname = usePathname();
  const [party, setParty] = useState<{ game: GameDef; best: string; cardUrl: string } | null>(null);
  const snapshotRef = useRef<Record<string, string>>({});
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const id = (() => {
    if (pathname === "/fighting" || pathname.endsWith("/fighting")) return "fighting";
    const m = pathname.match(/(?:^|\/)(?:games|fighting)\/?([a-z0-9-]+)?/);
    return m?.[1];
  })();
  const game = id ? GAMES_BY_ID[id] : undefined;

  useEffect(() => {
    if (!game) return;
    try {
      snapshotRef.current = getArcadeBests();
    } catch {
      snapshotRef.current = {};
    }
    const t = setInterval(() => {
      let cur: Record<string, string>;
      try {
        cur = getArcadeBests();
      } catch {
        return;
      }
      const now = cur[game.id];
      const before = snapshotRef.current[game.id];
      if (now && now !== before) {
        snapshotRef.current = cur;
        const canvas = drawScoreCard(game, now);
        const cardUrl = canvas.toDataURL("image/png");
        setParty({ game, best: now, cardUrl });
        if (loadSettings().fanfare) playFanfare();
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => setParty(null), 8000);
      } else {
        snapshotRef.current = cur;
      }
    }, POLL_MS);
    return () => {
      clearInterval(t);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [game]);

  useEffect(() => {
    if (!party) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setParty(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [party]);

  if (!party) return null;
  const share = () =>
    void shareGame(
      party.game,
      new URL((typeof window !== "undefined" && window.location.pathname.startsWith("/game-hub") ? "/game-hub" : "") + party.game.route, window.location.origin).href
    );
  return (
    <div className="rc-overlay" role="alertdialog" aria-label="Yeni rekor">
      <div className="rc-card">
        <div className="rc-title">🏆 YENİ REKOR!</div>
        <div className="rc-score">{party.best}</div>
        <img className="rc-img" src={party.cardUrl} alt={`${party.game.title} skor kartı`} />
        <div className="rc-actions">
          <button type="button" className="rc-btn share" onClick={share}>📤 Paylaş</button>
          <button type="button" className="rc-btn close" onClick={() => setParty(null)} aria-label="Kapat">✕</button>
        </div>
      </div>
    </div>
  );
}
