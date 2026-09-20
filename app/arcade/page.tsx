"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AmbientArcade from "../components/AmbientArcade";

/* =====================================================================
   PIXEL ARCADE — Lagged tarzı oyun portalı
   Hero slider, kategori filtreleri, anlık arama, trend/yeni satırları,
   favoriler, oynanma sayacı ve portal içi oynatıcı (iframe + tam ekran).

   Not: `pop` alanı kartlardaki "oynanma" rozetini besleyen dekoratif bir
   tohumdur (0-100). Kullanıcının kendi oynama sayısı localStorage'da
   tutulur ve sıralamaya eklenir — istediğin gibi değiştirebilirsin.
   ===================================================================== */

type Category =
  | "Aksiyon" | "Bulmaca" | "Dövüş" | "Yarış"
  | "Platform" | "Strateji" | "Macera" | "Arcade";

interface ArcadeGame {
  id: string;
  title: string;
  emoji: string;
  category: Category;
  tags: string[];
  description: string;
  route: string;
  art: string;
  pop: number;
  isNew?: boolean;
  featured?: boolean;
  standalone?: string;
}

const GAMES: ArcadeGame[] = [
  {
    id: "sunny-side-ride", title: "Sunny Side Ride", emoji: "🚲", category: "Yarış",
    tags: ["3D", "Bisiklet", "Keşif"], route: "/games/sunny-side-ride", pop: 92, isNew: true, featured: true,
    standalone: "/sunny-side-ride.html",
    description: "Açık dünya 3D bisiklet macerası! Ağaç tünelleriyle kaplı kıvrımlı sokaklarda pedal çevir, rampalardan zıpla, tokenları topla ve checkpointleri geç. Prosedürel mahalle: tepeler, ahşap köprü, parklar, yayalar ve trafik.",
    art: "linear-gradient(135deg,#7dd3fc 0%,#22c55e 100%)",
  },
  {
    id: "akil-kupu", title: "Akıl Küpü", emoji: "🧠", category: "Bulmaca",
    tags: ["SOMA", "3D", "Dokunmatik"], route: "/games/akil-kupu", pop: 86, isNew: true, featured: true,
    standalone: "/akil-kupu.html",
    description: "Klasik SOMA bulmacası: 7 renkli parçayı 3×3×3 küpe yerleştirip tamamla. Dokunmatik kontroller, 3D önizleme, animasyonlu çözücü ve en iyi süre takibi.",
    art: "linear-gradient(135deg,#22d3ee 0%,#a855f7 100%)",
  },
  {
    id: "voxelcraft", title: "VoxelCraft", emoji: "⛏️", category: "Macera",
    tags: ["Sandbox", "Hayatta Kalma", "Üretim"], route: "/games/voxelcraft", pop: 95, featured: true,
    description: "Minecraft benzeri hayatta kalma: seed'li prosedürel dünya, mağaralar ve cevherler, gündüz/gece döngüsü, envanter, üretim, aletler ve canlılar. Mobilde dokunmatik kontroller.",
    art: "linear-gradient(135deg,#66bb6a 0%,#33691e 100%)",
  },
  {
    id: "anime-legends", title: "Anime Legends", emoji: "🥷", category: "Dövüş",
    tags: ["Turnuva", "Combo", "1P"], route: "/games/anime-legends", pop: 93,
    standalone: "/anime-legends.html",
    description: "24 karakterli dövüş turnuvası: karakterini seç, 8 rakibi yen ve şampiyon ol. A/D hareket, J/K/L saldırı, U ultimate.",
    art: "linear-gradient(135deg,#ff6f00 0%,#c62828 100%)",
  },
  {
    id: "world-war-z", title: "World War Z", emoji: "🧟", category: "Aksiyon",
    tags: ["FPS", "3D", "Zombi"], route: "/games/world-war-z", pop: 91,
    description: "3D birinci şahıs zombi hayatta kalma: karanlık arenada sonsuz dalgalara karşı koy. WASD + fare, ateş etmek için tıkla.",
    art: "linear-gradient(135deg,#2d2d44 0%,#4a4a6a 100%)",
  },
  {
    id: "chess", title: "Royal Chess", emoji: "♞", category: "Strateji",
    tags: ["Satranç", "3D", "2P"], route: "/games/chess", pop: 90,
    description: "Tam kurallı 3D satranç: rok, en passant, terfi ve şah mat. Arkadaşınla ya da dahili bilgisayara karşı oyna. Döndürmek için sürükle, hamle için tıkla.",
    art: "linear-gradient(135deg,#a1887f 0%,#5d4037 100%)",
  },
  {
    id: "doping-runner", title: "Doping Runner", emoji: "⚡", category: "Arcade",
    tags: ["Sonsuz Koşu", "Refleks", "Mobil"], route: "/games/doping-runner", pop: 89,
    description: "Neon şehirde sonsuz koşu: doping kapsüllerini topla, süper hıza ulaş, engellerden kaç ve rekor kır. Space ile zıpla (çift zıplama var).",
    art: "linear-gradient(135deg,#ff2d78 0%,#7a1fa2 100%)",
  },
  {
    id: "fighting", title: "Neon Rivals", emoji: "🥋", category: "Dövüş",
    tags: ["3D", "Yapay Zekâ", "Kombo"], route: "/fighting", pop: 88,
    description: "4 savaşçı, 2'şer özel saldırı, 3 arena ve EASY/NORMAL/HARD yapay zekâ. Eğitim modu ve stamina sistemiyle tam bir dövüş deneyimi.",
    art: "linear-gradient(135deg,#00e5ff 0%,#004d40 100%)",
  },
  {
    id: "candy-burst", title: "Candy Burst", emoji: "🍬", category: "Bulmaca",
    tags: ["Eşleştirme", "Zincir", "Mobil"], route: "/games/candy-burst", pop: 87,
    description: "Şeker patlatma! 3+ aynı renkleri eşleştir, zincirleme patlamalar yap ve her 10 bölümde boss'u yen. Tıkla & sürükle ile takas et.",
    art: "linear-gradient(135deg,#ff4081 0%,#4a148c 100%)",
  },
  {
    id: "fighter", title: "Dövüş Arenası", emoji: "🥊", category: "Dövüş",
    tags: ["2P", "Enerji", "3D"], route: "/games/fighter", pop: 85,
    description: "4 efsane savaşçı (Kor, Bora, Çelik, Gölge), yumruk-tekme-blok ve enerjiyle güçlenen özel saldırılar. 1P vs CPU ya da 2 oyuncu.",
    art: "linear-gradient(135deg,#ff1744 0%,#880e4f 100%)",
  },
  {
    id: "spaceship", title: "Yıldız Vurucu", emoji: "🚀", category: "Aksiyon",
    tags: ["Uzay", "Nişancı", "3D"], route: "/games/spaceship", pop: 84,
    description: "Asteroid alanlarında hayatta kal: kayaları ve düşman filolarını patlat. WASD ile hareket, Space ile ateş, Shift ile hızlan.",
    art: "linear-gradient(135deg,#0b0b2b 0%,#3a1a6a 100%)",
  },
  {
    id: "astro-blaster", title: "Astro Blaster", emoji: "🛸", category: "Arcade",
    tags: ["Breakout", "5 Seviye", "Güçlendirme"], route: "/games/astro-blaster", pop: 82,
    standalone: "/astro-blaster.html",
    description: "Uzay temalı blok kırma: 5 seviye, 4 blok tipi ve güçlendirmeler. Altın bloklar ekstra puan, elmas bloklar kırılmaz.",
    art: "linear-gradient(135deg,#5e35b1 0%,#1a237e 100%)",
  },
  {
    id: "powerboat", title: "Sürat Teknesi Hücumu", emoji: "🚤", category: "Yarış",
    tags: ["3D", "Engel", "Nitro"], route: "/games/powerboat", pop: 80,
    description: "Okyanusta 3 boyutlu sürat teknesi yarışı: mayınlardan, kayalardan ve girdaplardan kaçın. WASD + Space ile hareket ve nitro.",
    art: "linear-gradient(135deg,#1e88e5 0%,#0d47a1 100%)",
  },
  {
    id: "lets-world", title: "Let's World", emoji: "🌍", category: "Platform",
    tags: ["Macera", "Boss", "Klasik"], route: "/games/lets-world", pop: 79,
    description: "Klasik platform macerası: koş, zıpla, jeton topla ve düşmanları ezip geç. Her 10 bölümde dev boss seni bekliyor.",
    art: "linear-gradient(135deg,#42a5f5 0%,#1b5e20 100%)",
  },
  {
    id: "pixel-pals", title: "Pixel Pals", emoji: "🌟", category: "Platform",
    tags: ["Retro", "Boss", "Macera"], route: "/games/pixel-pals", pop: 76,
    description: "Küçük mavi yaratık Bloop ile çayırı geç, grump'ları ez, tüm paraları topla ve boss Gloom'u yenerek Altın Yıldız'ı kazan.",
    art: "linear-gradient(135deg,#6fc3e8 0%,#5cb874 100%)",
  },
];

const CATEGORIES: Category[] = ["Aksiyon", "Bulmaca", "Dövüş", "Yarış", "Platform", "Strateji", "Macera", "Arcade"];
const FAV_TAB = "❤️ Favorilerim";
const LS = { favs: "arcade_favs", recent: "arcade_recent", plays: "arcade_plays" };

/** GitHub Pages bu repoyu /game-hub/ altında sunar; iframe/standalone
 *  linkleri için basePath'i çalışma anında tespit ediyoruz. */
function basePath(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.startsWith("/game-hub") ? "/game-hub" : "";
}
function withBase(path: string): string {
  return basePath() + path;
}
function playUrl(g: ArcadeGame): string {
  return withBase(g.route + "/");
}
function formatPlays(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + "K";
  return String(n);
}

export default function ArcadePage() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<string>("Tümü");
  const [sort, setSort] = useState<"pop" | "new" | "az">("pop");
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [plays, setPlays] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);

  /* --- kalıcı veriler (favoriler, son oynananlar, sayaç) --- */
  useEffect(() => {
    try {
      setFavs(JSON.parse(localStorage.getItem(LS.favs) || "[]") as string[]);
      setRecent(JSON.parse(localStorage.getItem(LS.recent) || "[]") as string[]);
      setPlays(JSON.parse(localStorage.getItem(LS.plays) || "{}") as Record<string, number>);
    } catch { /* localStorage kapalı olabilir */ }
  }, []);

  const persist = useCallback((key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* yoksay */ }
  }, []);

  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persist(LS.favs, next);
      return next;
    });
  }, [persist]);

  const openGame = useCallback((g: ArcadeGame) => {
    setOpenId(g.id);
    setPlays((prev) => {
      const next = { ...prev, [g.id]: (prev[g.id] ?? 0) + 1 };
      persist(LS.plays, next);
      return next;
    });
    setRecent((prev) => {
      const next = [g.id, ...prev.filter((x) => x !== g.id)].slice(0, 12);
      persist(LS.recent, next);
      return next;
    });
  }, [persist]);

  const closeGame = useCallback(() => setOpenId(null), []);

  /* --- hero slider otomatik geçiş --- */
  const featured = useMemo(() => GAMES.filter((g) => g.featured), []);
  useEffect(() => {
    if (openId) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % featured.length), 6500);
    return () => clearInterval(t);
  }, [openId, featured.length]);

  /* --- ESC ile oynatıcıyı kapat --- */
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeGame(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, closeGame]);

  const score = useCallback((g: ArcadeGame) => g.pop + (plays[g.id] ?? 0) * 3, [plays]);

  const trending = useMemo(() => [...GAMES].sort((a, b) => score(b) - score(a)).slice(0, 10), [score]);
  const newest = useMemo(() => [...GAMES].sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || b.pop - a.pop).slice(0, 10), []);
  const recentGames = useMemo(
    () => recent.map((id) => GAMES.find((g) => g.id === id)).filter((g): g is ArcadeGame => Boolean(g)),
    [recent]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    let list = GAMES.filter((g) => {
      if (tab === FAV_TAB) return favs.includes(g.id);
      if (tab !== "Tümü" && g.category !== tab) return false;
      return true;
    });
    if (needle) {
      list = list.filter((g) =>
        (g.title + " " + g.category + " " + g.tags.join(" ") + " " + g.description)
          .toLocaleLowerCase("tr")
          .includes(needle)
      );
    }
    list = [...list];
    if (sort === "az") list.sort((a, b) => a.title.localeCompare(b.title, "tr"));
    else if (sort === "new") list.sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || b.pop - a.pop);
    else list.sort((a, b) => score(b) - score(a));
    return list;
  }, [q, tab, sort, favs, score]);

  const open = openId ? GAMES.find((g) => g.id === openId) ?? null : null;
  const related = useMemo(
    () => (open ? GAMES.filter((g) => g.id !== open.id && g.category === open.category).slice(0, 6) : []),
    [open]
  );

  const goFullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  }, []);

  const randomGame = useCallback(() => {
    openGame(GAMES[Math.floor(Math.random() * GAMES.length)]);
  }, [openGame]);

  /* ---------------------------- kart ---------------------------- */
  function Card({ g, wide }: { g: ArcadeGame; wide?: boolean }) {
    const fav = favs.includes(g.id);
    const mine = plays[g.id] ?? 0;
    return (
      <div
        className={`arc-card${wide ? " wide" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => openGame(g)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGame(g); } }}
        aria-label={`${g.title} oyununu oyna`}
      >
        <div className="arc-thumb" style={{ background: g.art }}>
          <span className="arc-emoji">{g.emoji}</span>
          <span className="arc-play">▶ OYNA</span>
        </div>
        {g.isNew ? <span className="arc-badge new">YENİ</span>
          : g.pop >= 90 ? <span className="arc-badge hot">🔥 POPÜLER</span> : null}
        <button
          type="button"
          className={`arc-fav${fav ? " on" : ""}`}
          aria-label={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
          aria-pressed={fav}
          onClick={(e) => { e.stopPropagation(); toggleFav(g.id); }}
        >
          {fav ? "❤️" : "🤍"}
        </button>
        <div className="arc-meta">
          <h3>{g.title}</h3>
          <div className="arc-sub">
            <span>{g.category}</span>
            <span>▶ {formatPlays(g.pop * 137 + mine * 9)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="arc-wrap">
      <AmbientArcade />
      {/* ---------------- üst bar ---------------- */}
      <header className="arc-top">
        <Link href="/" className="arc-logo">PIXEL<span>ARCADE</span></Link>
        <div className="arc-search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Oyun ara: rubik, dövüş, yarış…"
            aria-label="Oyun ara"
          />
        </div>
        <button type="button" className="arc-btn primary" onClick={randomGame}>🎲 Rastgele</button>
        <Link href="/" className="arc-btn arc-nav-link">📚 Katalog</Link>
      </header>

      {/* ---------------- kategoriler ---------------- */}
      <nav className="arc-cats" aria-label="Kategoriler">
        <button type="button" className={`arc-pill${tab === "Tümü" ? " on" : ""}`} onClick={() => setTab("Tümü")}>
          🎮 Tümü <b>{GAMES.length}</b>
        </button>
        <button type="button" className={`arc-pill${tab === FAV_TAB ? " on" : ""}`} onClick={() => setTab(FAV_TAB)}>
          {FAV_TAB} <b>{favs.length}</b>
        </button>
        {CATEGORIES.map((c) => {
          const n = GAMES.filter((g) => g.category === c).length;
          return (
            <button key={c} type="button" className={`arc-pill${tab === c ? " on" : ""}`} onClick={() => setTab(c)}>
              {c} <b>{n}</b>
            </button>
          );
        })}
      </nav>

      <main className="arc-main">
        {/* ---------------- hero slider ---------------- */}
        <section className="arc-hero" aria-label="Öne çıkan oyun">
          <div className="arc-hero-art" style={{ background: featured[slide % featured.length].art }}>
            <span>{featured[slide % featured.length].emoji}</span>
          </div>
          <div className="arc-hero-body">
            <span className="arc-tag">⭐ ÖNE ÇIKAN</span>
            <span className="arc-tag">{featured[slide % featured.length].category}</span>
            <h1>{featured[slide % featured.length].title}</h1>
            <p>{featured[slide % featured.length].description}</p>
            <div className="arc-hero-actions">
              <button type="button" className="arc-btn primary big" onClick={() => openGame(featured[slide % featured.length])}>
                ▶ Hemen Oyna
              </button>
              <Link href={playUrl(featured[slide % featured.length])} className="arc-btn big">
                ↗ Tam Sayfa
              </Link>
            </div>
          </div>
          <div className="arc-dots">
            {featured.map((g, i) => (
              <button
                key={g.id}
                type="button"
                className={`arc-dot${i === slide % featured.length ? " on" : ""}`}
                aria-label={`${g.title} vitrine getir`}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
        </section>

        {/* ---------------- son oynadıkların ---------------- */}
        {recentGames.length > 0 && (
          <>
            <div className="arc-row-head">
              <h2>🕹️ Son Oynadıkların</h2>
              <span className="arc-sub">{recentGames.length} oyun</span>
            </div>
            <div className="arc-row">
              {recentGames.map((g) => <Card key={g.id} g={g} />)}
            </div>
          </>
        )}

        {/* ---------------- trend ---------------- */}
        <div className="arc-row-head">
          <h2>🔥 Trend Olanlar</h2>
          <span className="arc-sub">şu an en çok oynananlar</span>
        </div>
        <div className="arc-row">
          {trending.map((g) => <Card key={g.id} g={g} />)}
        </div>

        {/* ---------------- yeni ---------------- */}
        <div className="arc-row-head">
          <h2>🆕 Yeni Eklenenler</h2>
          <span className="arc-sub">taze oyunlar</span>
        </div>
        <div className="arc-row">
          {newest.map((g) => <Card key={g.id} g={g} />)}
        </div>

        {/* ---------------- tüm oyunlar ---------------- */}
        <div className="arc-row-head">
          <h2>🎯 {tab === "Tümü" ? "Tüm Oyunlar" : tab}</h2>
          <span className="arc-sub">{filtered.length} sonuç</span>
          <select className="arc-sort" value={sort} onChange={(e) => setSort(e.target.value as "pop" | "new" | "az")} aria-label="Sıralama">
            <option value="pop">Popülerlik</option>
            <option value="new">Yenilik</option>
            <option value="az">A → Z</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="arc-empty">
            <div style={{ fontSize: 42 }}>🕳️</div>
            <p>
              {tab === FAV_TAB
                ? "Henüz favori oyunun yok. Kartlardaki 🤍 simgesine dokunarak ekleyebilirsin."
                : `"${q}" için oyun bulunamadı.`}
            </p>
          </div>
        ) : (
          <div className="arc-grid">
            {filtered.map((g) => <Card key={g.id} g={g} wide />)}
          </div>
        )}
      </main>

      <footer className="arc-foot">
        Pixel Arcade — {GAMES.length} özgün tarayıcı oyunu · Next.js + Canvas/WebGL · GitHub Pages
      </footer>

      {/* ---------------- oynatıcı ---------------- */}
      {open && (
        <div className="arc-modal" role="dialog" aria-modal="true" aria-label={`${open.title} oynatıcı`}>
          <div className="arc-modal-box">
            <div className="arc-modal-top">
              <span className="arc-modal-emoji" style={{ background: open.art }}>{open.emoji}</span>
              <h3>{open.title}</h3>
              <button
                type="button"
                className={`arc-fav inline${favs.includes(open.id) ? " on" : ""}`}
                aria-label="Favorilere ekle"
                onClick={() => toggleFav(open.id)}
              >
                {favs.includes(open.id) ? "❤️" : "🤍"}
              </button>
              <button type="button" className="arc-btn" onClick={goFullscreen}>⛶ Tam Ekran</button>
              <a className="arc-btn" href={playUrl(open)} target="_blank" rel="noreferrer">↗ Yeni Sekme</a>
              <button type="button" className="arc-btn close" onClick={closeGame}>✕</button>
            </div>
            <div className="arc-frame-wrap" ref={frameRef}>
              <iframe
                key={open.id}
                src={playUrl(open)}
                title={open.title}
                allow="fullscreen; autoplay; gamepad; accelerometer; gyroscope"
              />
            </div>
            <div className="arc-modal-info">
              <p>{open.description}</p>
              <div className="arc-tags">
                <span className="arc-tag">{open.category}</span>
                {open.tags.map((t) => <span className="arc-tag" key={t}>{t}</span>)}
                <span className="arc-tag">▶ {formatPlays(open.pop * 137 + (plays[open.id] ?? 0) * 9)} oynanma</span>
                {open.standalone && (
                  <a className="arc-tag link" href={withBase(open.standalone)} target="_blank" rel="noreferrer">
                    📱 tek dosya sürüm
                  </a>
                )}
              </div>
              {related.length > 0 && (
                <div className="arc-related">
                  <span className="arc-sub">Benzer oyunlar:</span>
                  {related.map((g) => (
                    <button key={g.id} type="button" className="arc-pill" onClick={() => openGame(g)}>
                      {g.emoji} {g.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}