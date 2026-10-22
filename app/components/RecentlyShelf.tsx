"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAMES_BY_ID } from "../lib/games";
import { getPlays, agoText, type PlayEntry } from "../lib/playtrack";

/** Ana sayfa: son oynanan oyun rafı (yerel depolamadan, tekilleştirilmiş) */
export default function RecentlyShelf() {
  const [plays, setPlays] = useState<PlayEntry[] | null>(null);

  useEffect(() => {
    setPlays(
      getPlays()
        .filter((p) => GAMES_BY_ID[p.id])
        .slice(0, 8)
    );
  }, []);

  if (!plays || plays.length === 0) return null;

  return (
    <section className="recent-shelf">
      <h2>🕐 Son Oynadıkların</h2>
      <div className="recent-chips">
        {plays.map((p) => {
          const g = GAMES_BY_ID[p.id];
          return (
            <Link key={p.id} href={g.route} className="recent-chip">
              <span className="recent-emoji">{g.emoji}</span>
              <span className="recent-meta">
                <b>{g.title}</b>
                <small>
                  {agoText(p.t)}
                  {p.count > 1 ? ` · ${p.count} oyun` : ""}
                </small>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
