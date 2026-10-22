"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAMES_BY_ID } from "../lib/games";

/** Ana sayfa: arcade portalındaki favorilerden beslenen raf (arcade_favs) */
export default function FavShelf() {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let list: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem("arcade_favs") || "[]");
      list = Array.isArray(raw) ? raw.filter((x) => typeof x === "string" && GAMES_BY_ID[x]) : [];
    } catch {
      list = [];
    }
    setIds(list.slice(0, 12));
  }, []);

  if (!ids || ids.length === 0) return null;

  return (
    <section className="recent-shelf">
      <h2>⭐ Favorilerin</h2>
      <div className="recent-chips">
        {ids.map((id) => {
          const g = GAMES_BY_ID[id];
          return (
            <Link key={id} href={g.route} className="recent-chip">
              <span className="recent-emoji">{g.emoji}</span>
              <span className="recent-meta">
                <b>{g.title}</b>
                <small>{g.category}</small>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
