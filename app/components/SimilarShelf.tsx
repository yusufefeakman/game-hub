"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { GAMES_BY_ID, GAMES } from "../lib/games";

/**
 * Oyun sayfası altı öneri şeridi: önce aynı kategoriden oyunlar,
 * sonra etiketleri kesişenler, kota dolmazsa en popülerlerle tamamlanır.
 */
export default function SimilarShelf() {
  const pathname = usePathname();

  const items = useMemo(() => {
    const m = pathname.match(/(?:^|\/)(?:games|fighting)\/?([a-z0-9-]+)?/);
    const id = pathname === "/fighting" || pathname.endsWith("/fighting") ? "fighting" : m?.[1];
    const cur = id ? GAMES_BY_ID[id] : undefined;
    if (!cur) return [];
    const rest = GAMES.filter((g) => g.id !== cur.id);
    const same = rest.filter((g) => g.category === cur.category).sort((a, b) => b.pop - a.pop);
    const shared = rest
      .filter((g) => !same.includes(g))
      .map((g) => ({ g, n: g.tags.filter((t) => cur.tags.includes(t)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || b.g.pop - a.g.pop)
      .map((x) => x.g);
    const pop = rest.filter((g) => !same.includes(g) && !shared.includes(g)).sort((a, b) => b.pop - a.pop);
    return [...same, ...shared, ...pop].slice(0, 4);
  }, [pathname]);

  if (items.length === 0) return null;

  return (
    <section className="sim-shelf" aria-label="Benzer oyunlar">
      <h2>🎯 Benzer Oyunlar</h2>
      <div className="sim-row">
        {items.map((g) => (
          <Link key={g.id} href={g.route} className="sim-card playable" aria-label={`${g.title} oyununu dene`}>
            <span className="sim-art" style={{ background: g.art }}>{g.emoji}</span>
            <span className="sim-meta">
              <b>{g.title}</b>
              <small>{g.category}</small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
