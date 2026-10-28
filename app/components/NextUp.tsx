"use client";

/* Oyun sayfasının altında "Sıradaki ne oynasan?" şeridi:
   hiç oynanmadıkların öncelikli 3 öneri + sürpriz düğmesi. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pickNextUp, surprisePick } from "../lib/surprise";
import type { GameDef } from "../lib/games";

export default function NextUp({ currentId }: { currentId?: string }) {
  // seçim rastgele olduğu için SSR/istemci uyuşmazlığına düşürme: mount sonrası hesapla
  const [picks, setPicks] = useState<GameDef[]>([]);
  useEffect(() => {
    if (currentId) setPicks(pickNextUp(currentId));
  }, [currentId]);
  const router = useRouter();
  if (!currentId || picks.length === 0) return null;
  return (
    <section className="nq-shelf" aria-label="Sıradaki oyunlar">
      <div className="nq-head">
        <h2>🎮 Sıradaki ne oynasan?</h2>
        <button
          type="button"
          className="nq-dice"
          onClick={() => router.push(surprisePick())}
          title="Karışık bir oyun seçelim"
        >
          🎲 Sen karıştır
        </button>
      </div>
      <div className="nq-row">
        {picks.map((g) => (
          <Link key={g.id} href={g.route} className="nq-card playable">
            <span className={`card-art nq-art art-${String(GAMES_ART_INDEX(g.id))}`} />
            <span className="nq-meta">
              <span className="nq-emoji">{g.emoji}</span>
              <span className="nq-title">{g.title}</span>
              <span className="nq-sub">{g.subtitle}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

import { GAMES_BY_ID } from "../lib/games";
function GAMES_ART_INDEX(id: string): number {
  const m = (GAMES_BY_ID[id]?.artClass || "art-1").match(/art-(\d+)/);
  return m ? Number(m[1]) : 1;
}
