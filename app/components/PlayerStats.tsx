"use client";

/* Hakkımızda "Oyuncu Salonu": kullanıcının kendi yerel verilerinden
   (son oynananlar, rekorlar, favoriler) kişisel istatistik şeridi. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getPlays } from "../lib/playtrack";
import { getArcadeBests } from "../lib/hiscore";

export default function PlayerStats() {
  const [stats, setStats] = useState<{ opens: number; distinct: number; bests: number; favs: number } | null>(null);

  useEffect(() => {
    try {
      const plays = getPlays();
      let favs: string[] = [];
      try {
        favs = JSON.parse(localStorage.getItem("arcade_favs") || "[]") as string[];
      } catch { /* bozuk kayıt */ }
      setStats({
        opens: plays.reduce((s, e) => s + (e.count || 0), 0),
        distinct: plays.length,
        bests: Object.keys(getArcadeBests()).length,
        favs: Array.isArray(favs) ? favs.length : 0,
      });
    } catch {
      /* localStorage kapalı olabilir */
    }
  }, []);

  if (!stats) return null;
  if (stats.opens === 0) {
    return (
      <section className="player-stats" aria-label="Oyuncu salonu">
        <h2>🕹️ Oyuncu Salonu</h2>
        <p className="ps-empty">
          Henüz hiç oyun açmadın — salon burası. İlk oyununu açtığın an
          istatistiklerin burada belirmeye başlar. <Link href="/arcade">Arcade&apos;e git →</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="player-stats" aria-label="Oyuncu salonu">
      <h2>🕹️ Oyuncu Salonu</h2>
      <div className="ps-grid">
        <div className="ps-tile"><b>{stats.opens}</b><span>toplam oyun açılışı</span></div>
        <div className="ps-tile"><b>{stats.distinct}</b><span>farklı oyun denedin</span></div>
        <div className="ps-tile"><b>{stats.bests}</b><span>kişisel rekorun</span></div>
        <div className="ps-tile"><b>{stats.favs}</b><span>favori oyunun</span></div>
      </div>
      <p className="ps-note">Bu sayılar yalnızca senin tarayıcında durur — sunucu görmez.</p>
    </section>
  );
}
