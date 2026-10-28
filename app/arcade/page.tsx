"use client";

import Link from "next/link";
import { GAMES as GAMES_LIB } from "../lib/games";
import { recordPlay, getPlays } from "../lib/playtrack";
import { calcAvg, loadRatings } from "../lib/ratings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AmbientArcade from "../components/AmbientArcade";
import { getArcadeBests } from "../lib/hiscore";

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
  | "Platform" | "Strateji" | "Macera" | "Arcade" | "Simülasyon";

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

// Merkezi katalogdan beslenir — yeni oyun tek yerde (app/lib/games.ts) tanımlanır.
const GAMES: ArcadeGame[] = GAMES_LIB.map((g) => ({
  id: g.id, title: g.title, emoji: g.emoji, category: g.category, tags: g.tags,
  description: g.description, route: g.route, art: g.art, pop: g.pop,
  isNew: g.isNew, featured: g.featured, standalone: g.standalone,
}));


const CATEGORIES: Category[] = ["Aksiyon", "Bulmaca", "Dövüş", "Yarış", "Platform", "Strateji", "Macera", "Arcade", "Simülasyon"];
const FAV_TAB = "❤️ Favorilerim";
const BEST_TAB = "🏆 Rekorlarım";
const RECENT_TAB = "🕘 Son Oynananlar";
const LS = { favs: "arcade_favs", recent: "arcade_recent", plays: "arcade_plays", ratings: "arcade_ratings" };

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

/* Türkçe arama normalizasyonu:
   - I / İ / ı hepsi "i"ye katlanır (İngilizce layout'ta "I" yazan da bulsun)
   - ü/ö/ş/ç/ğ/ı işaretleri düşürülür: "kupu" → "Akıl Küpü", "dovus" → "Dövüş"
   Arama kutusuna işaretli veya işaretli girilip girilmediği fark etmez. */
const TR_LETTERS: Record<string, string> = { "ı": "i", "ç": "c", "ğ": "g", "ö": "o", "ş": "s", "ü": "u" };
function normalizeTr(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) out += TR_LETTERS[ch] ?? ch;
  return out;
}

export default function ArcadePage() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<string>("Tümü");
  const [sort, setSort] = useState<"pop" | "new" | "az" | "rate">("pop");
  const [favs, setFavs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [playTimes, setPlayTimes] = useState<Record<string, number>>({});
  const [plays, setPlays] = useState<Record<string, number>>({});
  const [ratings, setRatings] = useState<Record<string, { sum: number; count: number; mine: number }>>({});
  const [bests, setBests] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);

  /* --- kalıcı veriler (favoriler, son oynananlar, sayaç) --- */
  useEffect(() => {
    try {
      setFavs(JSON.parse(localStorage.getItem(LS.favs) || "[]") as string[]);
      setRecent(JSON.parse(localStorage.getItem(LS.recent) || "[]") as string[]);
      const pl: Record<string, number> = {};
      for (const e of getPlays()) pl[e.id] = e.t;
      setPlayTimes(pl);
      setPlays(JSON.parse(localStorage.getItem(LS.plays) || "{}") as Record<string, number>);
      setRatings(JSON.parse(localStorage.getItem(LS.ratings) || "{}") as Record<string, { sum: number; count: number; mine: number }>);
      setBests(getArcadeBests());
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

  /* --- puanlama: pop'tan türeyen taban puan + kullanıcının yıldızları --- */
  const avgOf = useCallback((g: ArcadeGame) => calcAvg(g, ratings), [ratings]);

  const rate = useCallback((id: string, stars: number) => {
    setRatings((prev) => {
      const cur = prev[id] ?? { sum: 0, count: 0, mine: 0 };
      const newMine = cur.mine === stars ? 0 : stars; // aynı yıldıza tekrar bas → puanı kaldır
      const sum = cur.sum - cur.mine + newMine;
      const count = cur.count + (cur.mine === 0 && newMine > 0 ? 1 : 0);
      const next = { ...prev, [id]: { sum, count, mine: newMine } };
      persist(LS.ratings, next);
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
      recordPlay(g.id); // portal içi oynama da ortak "son oynananlar"a yazılır
      return next;
    });
  }, [persist]);

  const closeGame = useCallback(() => {
    setOpenId(null);
    try { setBests(getArcadeBests()); } catch { /* yok */ }
  }, []);

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
    const needle = normalizeTr(q.trim());
    let list = GAMES.filter((g) => {
      if (tab === FAV_TAB) return favs.includes(g.id);
      if (tab === BEST_TAB) return Boolean(bests[g.id]);
      if (tab === RECENT_TAB) return playTimes[g.id] !== undefined;
      if (tab !== "Tümü" && g.category !== tab) return false;
      return true;
    });
    if (needle) {
      list = list.filter((g) =>
        normalizeTr(g.title + " " + g.category + " " + g.tags.join(" ") + " " + g.description)
          .includes(needle)
      );
    }
    list = [...list];
    if (tab === RECENT_TAB && sort === "pop") list.sort((a, b) => (playTimes[b.id] ?? 0) - (playTimes[a.id] ?? 0));
    if (sort === "az") list.sort((a, b) => a.title.localeCompare(b.title, "tr"));
    else if (sort === "new") list.sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || b.pop - a.pop);
    else if (sort === "rate") list.sort((a, b) => avgOf(b).avg - avgOf(a).avg || b.pop - a.pop);
    else list.sort((a, b) => score(b) - score(a));
    return list;
  }, [q, tab, sort, favs, bests, score, avgOf]);

  /* Filtre/arama aktifken vitrin satırları (Son Oynadıkların/Trend/Yeni)
     gizlenir — portal yalnızca sonuç listesini gösterir, böylece pillin
     etkisi anında ve açıkça görünür. */
  const isFiltering = tab !== "Tümü" || q.trim() !== "";

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
    const { avg, votes, mine: myStars } = avgOf(g);
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
          {bests[g.id] ? <span className="arc-best" title="Kişisel rekorun">🏆 {bests[g.id]}</span> : null}
        </div>
        {mine >= 3 ? <span className="arc-badge freq" title="En çok oynadıkların">🎮 {mine}× oynadın</span>
          : g.isNew ? <span className="arc-badge new">YENİ</span>
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
          <div className="arc-stars" onClick={(e) => e.stopPropagation()}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={myStars >= n ? "on" : ""}
                aria-label={`${n} yıldız ver`} title={`${n} yıldız`}
                onClick={(e) => { e.stopPropagation(); rate(g.id, n); }}>★</button>
            ))}
            <span className="avg">⭐ {avg.toFixed(1)} · {formatPlays(votes)}</span>
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
            placeholder="Oyun ara: kupu, dovus, bisiklet…"
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
        {Object.keys(bests).length > 0 ? (
          <button type="button" className={`arc-pill${tab === BEST_TAB ? " on" : ""}`} onClick={() => setTab(BEST_TAB)}>
            {BEST_TAB} <b>{Object.keys(bests).length}</b>
          </button>
        ) : null}
        {Object.keys(playTimes).length > 0 ? (
          <button type="button" className={`arc-pill${tab === RECENT_TAB ? " on" : ""}`} onClick={() => setTab(RECENT_TAB)}>
            {RECENT_TAB} <b>{Object.keys(playTimes).length}</b>
          </button>
        ) : null}
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
              {/* next/link basePath'i otomatik ekler; href'e elle eklemeyiz
                  (eklersek /game-hub/game-hub/... olur ve 404 verir). */}
              <Link href={featured[slide % featured.length].route + "/"} className="arc-btn big">
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

        {isFiltering ? null : (
          <>
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
          </>
        )}

        {/* ---------------- tüm oyunlar ---------------- */}
        <div className="arc-row-head">
          <h2>🎯 {tab === "Tümü" ? "Tüm Oyunlar" : tab}</h2>
          <span className="arc-sub">{filtered.length} sonuç</span>
          <select className="arc-sort" value={sort} onChange={(e) => setSort(e.target.value as "pop" | "new" | "az" | "rate")} aria-label="Sıralama">
            <option value="pop">Popülerlik</option>
            <option value="new">Yenilik</option>
            <option value="az">A → Z</option>
            <option value="rate">Puan ⭐</option>
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
                <span className="arc-tag">⭐ {avgOf(open).avg.toFixed(1)} ({formatPlays(avgOf(open).votes)} oy)</span>
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