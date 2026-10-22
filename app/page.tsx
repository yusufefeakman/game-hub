"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AmbientArcade from "./components/AmbientArcade";
import MembershipUI from "./components/MembershipUI";
import BestShelf from "./components/BestShelf";
import RecentlyShelf from "./components/RecentlyShelf";
import FavShelf from "./components/FavShelf";
import SiteFooter from "./components/SiteFooter";
import { GAMES, type GameCategory } from "./lib/games";

const ALL = "Tümü";

/** Türkçe karakter-duyarlı küçük harfe çevirme (İ/I → i) */
function trLower(s: string): string {
  return s.toLocaleLowerCase("tr");
}

export default function Home() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(ALL);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of GAMES) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c as GameCategory);
  }, []);

  const filtered = useMemo(() => {
    const needle = trLower(q.trim());
    return GAMES.filter((g) => {
      if (cat !== ALL && g.category !== cat) return false;
      if (!needle) return true;
      const hay = trLower(`${g.title} ${g.subtitle} ${g.description} ${g.tags.join(" ")}`);
      return hay.includes(needle);
    });
  }, [q, cat]);

  const bestGames: Record<string, { route: string; title: string }> = {};
  for (const g of GAMES) bestGames[g.id] = { route: g.route, title: g.title };

  return (
    <>
      <AmbientArcade />
      <MembershipUI />
      <main>
        <nav className="top-nav" aria-label="Ana menü">
          <Link href="/" className="top-nav-logo">
            PIXEL<span>ARCADE</span>
          </Link>
          <div className="top-nav-links">
            <Link href="#katalog">🕹️ Oyunlar</Link>
            <Link href="/arcade">🎮 Arcade</Link>
            <Link href="/about">ℹ️ Hakkımızda</Link>
          </div>
        </nav>

        <section className="hero">
          <h1>PIXEL ARCADE</h1>
          <p className="hero-sub">Kendi Dünyanı Oyna. Yeni Maceralara Katıl.</p>
          <p className="hero-desc">
            Pixel Arcade&apos;e hoş geldin! Birbirinden farklı tarayıcı oyunlarını
            keşfet, yeni maceralara katıl ve eğlenceli oyun deneyimlerinin tadını
            çıkar. Aksiyon, macera, yarış, bulmaca ve daha birçok türde oyun seni
            bekliyor. Oyunlarımızı doğrudan tarayıcından açabilir, yeni eklenen
            oyunları keşfedebilir ve kendi rekorlarını kırmaya çalışabilirsin.
          </p>
          <div className="hero-cta-row">
            <a href="#katalog" className="hero-cta">
              🕹️ Oyunları Keşfet
            </a>
            <Link href="/arcade" className="hero-cta ghost">
              🎮 Arcade Portal
            </Link>
          </div>
        </section>

        <BestShelf games={bestGames} />
        <FavShelf />
        <RecentlyShelf />

        <section className="catalog" id="katalog">
          <div className="catalog-toolbar">
            <h2 className="catalog-title">Oyunlar ({filtered.length}/{GAMES.length})</h2>
            <input
              type="search"
              className="catalog-search"
              placeholder="🔍 Oyun ara..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Oyun ara"
            />
            <div className="cat-chips" role="group" aria-label="Kategori filtresi">
              <button
                type="button"
                className={`cat-chip${cat === ALL ? " active" : ""}`}
                onClick={() => setCat(ALL)}
              >
                {ALL}
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`cat-chip${cat === c ? " active" : ""}`}
                  onClick={() => setCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {filtered.length > 0 ? (
            <div className="game-grid">
              {filtered.map((game) => (
                <Link key={game.id} href={game.route} className="game-card playable">
                  <div className={`card-art ${game.artClass}`}>
                    <span className="art-emoji">{game.emoji}</span>
                    <span className="card-badge">
                      {game.isNew ? "YENİ" : "OYNANABİLİR"}
                    </span>
                  </div>
                  <div className="card-body">
                    <h2>{game.title}</h2>
                    <p style={{ fontWeight: 600, color: "var(--accent)" }}>
                      {game.subtitle}
                    </p>
                    <p>{game.description}</p>
                    <div className="card-tags">
                      <span className="card-cat">{game.category}</span>
                      {game.tags.slice(0, 3).map((t) => (
                        <span key={t} className="card-tag">
                          {t}
                        </span>
                      ))}
                    </div>
                    <span className="card-play">▶ Şimdi Oyna</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="no-results">
              <p>
                😕 <b>«{q}»</b> için sonuç bulunamadı{cat !== ALL ? ` — ${cat} kategorisinde` : ""}.
              </p>
              <button
                type="button"
                className="hero-cta small"
                onClick={() => {
                  setQ("");
                  setCat(ALL);
                }}
              >
                Filtreleri Temizle
              </button>
            </div>
          )}
        </section>

        <SiteFooter />
      </main>
    </>
  );
}
