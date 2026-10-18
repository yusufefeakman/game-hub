"use client";

/* Ana sayfa "🏆 Rekorların" rafı: kullanıcının kişisel rekorlarını
   tek şeritte gösterir. Rekor yoksa hiçbir şey render edilmez. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getArcadeBests } from "../lib/hiscore";

type BestGame = { route: string; title: string };

export default function BestShelf({ games }: { games: Record<string, BestGame> }) {
  const [bests, setBests] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      setBests(getArcadeBests());
    } catch {
      /* localStorage kapalı olabilir */
    }
  }, []);

  const entries = Object.entries(bests);
  if (entries.length === 0) return null;

  return (
    <section className="best-shelf" aria-label="Kişisel rekorların">
      <h2>🏆 Rekorların <span className="best-count">{entries.length}</span></h2>
      <div className="best-chips">
        {entries.map(([id, text]) => {
          const g = games[id];
          return (
            <Link key={id} className="best-chip" href={g ? g.route : "/arcade"}>
              <b>{g ? g.title : id}</b>
              <span>🏆 {text}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
