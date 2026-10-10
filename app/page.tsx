import Link from "next/link";
import AmbientArcade from "./components/AmbientArcade";
import MembershipUI from "./components/MembershipUI";

// Game catalog — add new games here as they are built.
// `route` is the Next.js route; `status` controls the card state.
const GAMES = [
  {
    id: "pixel-pals",
    title: "Pixel Pals",
    subtitle: "Quest for the Star",
    emoji: "🌟",
    artClass: "art-1",
    description:
      "Help Bloop the little blue critter cross the meadow, smash the grumps, grab every coin, and defeat the boss Gloom to claim the Golden Star.",
    route: "/games/pixel-pals",
    status: "playable" as const,
  },
  {
    id: "world-war-z",
    title: "World War Z",
    subtitle: "Zombie Survival",
    emoji: "🧟",
    artClass: "art-2",
    description:
      "3D FPS zombie shooter. Survive endless waves of the horde in a dark arena. WASD + mouse, click to shoot. How long can you last?",
    route: "/games/world-war-z",
    status: "playable" as const,
  },
  {
    id: "powerboat",
    title: "Sürat Teknesi Hücumu",
    subtitle: "Sürat Teknesi Engel Yarışı",
    emoji: "🚤",
    artClass: "art-4",
    description:
      "Okyanus üzerinde 3 boyutlu sürat teknesi yarışı. Mayınlardan, kayalardan ve girdaplardan kaçın, engelleri atlatarak yarışmayı tamamla. WASD + Uzay ile hareket/nitro.",
    route: "/games/powerboat",
    status: "playable" as const,
  },
  {
    id: "spaceship",
    title: "Yıldız Vurucu",
    subtitle: "Asteroid Saldırısı",
    emoji: "🚀",
    artClass: "art-6",
    description:
      "3D uzay nişancı oyunu. Uzay aracını asteroid alanlarında yönlendir, kayaları ve düşman filolarını patlat. WASD ile hareket, Space ile ateş, Shift ile hızlan.",
    route: "/games/spaceship",
    status: "playable" as const,
  },
  {
    id: "doping-runner",
    title: "Doping Runner",
    subtitle: "Sonsuz Koşu ⚡",
    emoji: "⚡",
    artClass: "art-7",
    description:
      "Neon şehirde sonsuz koşu! Doping kapsüllerini topla, süper hıza ulaş, engellerden kaç ve rekor kır. Space ile zıpla (çift zıplama var), mobilde butonlarla oyna.",
    route: "/games/doping-runner",
    status: "playable" as const,
  },
  {
    id: "anime-legends",
    title: "Anime Legends",
    subtitle: "Ultimate Arena",
    emoji: "🥷",
    artClass: "art-9",
    description:
      "24 ikonik anime karakteriyle dövüş turnuvası! Naruto, Goku, Luffy, Ichigo, Gojo ve daha fazlası. Karakterini seç, 8 rakibi yen, şampiyon ol. A/D hareket, J/K/L saldırı, U ultimate.",
    route: "/games/anime-legends",
    status: "playable" as const,
  },
  {
    id: "astro-blaster",
    title: "Astro Blaster",
    subtitle: "Uzay Blok Patlatma",
    emoji: "🛸",
    artClass: "art-10",
    description:
      "Uzay temalı blok kırma oyunu. Plazma gemini yönlendir, kozmik blokları parçala; altın bloklar ekstra puan, elmas bloklar kırılmaz. W genişletir, M çoklu top, S yavaşlatır, E ekstra can.",
    route: "/games/astro-blaster",
    status: "playable" as const,
  },
  {
    id: "chess",
    title: "Royal Chess",
    subtitle: "3D Strategy Classic",
    emoji: "♞",
    artClass: "art-11",
    description:
      "Full 3D chess with complete rules: castling, en passant, promotion, checkmate and draw detection. Play a friend locally or challenge the built-in computer. Drag to orbit, scroll to zoom, click to move.",
    route: "/games/chess",
    status: "playable" as const,
  },
  {
    id: "okey",
    title: "101 Okey",
    subtitle: "Klasik Türk Okeyi",
    emoji: "🀄",
    artClass: "art-8",
    description:
      "108 taşlık klasik Türk okeyi! Renk ve karma setler, 101+ açılış, 3 geçiş kuralı ve ceza puanları. 2-4 oyuncu, akıllı bot rakipler, -101 hedefli maçlar. Tamamen Türkçe.",
    route: "/games/okey",
    status: "playable" as const,
  },
  {
    id: "fighter",
    title: "Dövüş Arenası",
    subtitle: "Efsane Savaşçılar",
    emoji: "🥊",
    artClass: "art-12",
    description:
      "Özgün 3D dövüş arenası! 4 efsane savaşçıdan birini seç (Kor, Bora, Çelik, Gölge), bilgisayara ya da arkadaşına karşı dövüş. Yumruk, tekme, blok, kombo ve enerjiyle güçlenen özel saldırılar. P1: A/D + W/S + J/K/L — P2: Ok tuşları + 1/2/3.",
    route: "/games/fighter",
    status: "playable" as const,
  },
  {
    id: "fighting",
    title: "Neon Rivals",
    subtitle: "3D Dövüş Oyunu",
    emoji: "🥋",
    artClass: "art-13",
    description:
      "Özgün 3D dövüş oyunu! 4 savaşçı (Kairo, Vexa, Rokan, Nyra), 2'şer özel saldırı, 3 arena (Neon City, Antik Tapınak, Cyber Arena), kombo ve stamina sistemi, eğitim modu ve EASY/NORMAL/HARD yapay zekâ. P1: A/D + W/S + J/K/L/U — P2: Oklar + Num1-4.",
    route: "/fighting",
    status: "playable" as const,
  },
  {
    id: "lets-world",
    title: "Let's World",
    subtitle: "Platform Macerası",
    emoji: "🌍",
    artClass: "art-14",
    description:
      "Klasik platform oyunu! Yeşil şapkalı maceracınla koş, zıpla, jeton topla ve düşmanları ezip geç. Her 10 bölümde dev BOSS seni bekliyor. ← → hareket, SPACE zıpla.",
    route: "/games/lets-world",
    status: "playable" as const,
  },
  {
    id: "candy-burst",
    title: "Candy Burst",
    subtitle: "Eşleştirme Macerası",
    emoji: "🍬",
    artClass: "art-15",
    description:
      "Candy Crush tarzı eşleştirme! Renkli boncukları 3+ eşleştir, zincirleme patlamalar yap, 4 sıra → Çubuklu, 5 sıra → Renk Bombası, L/T → Sarmalı boncuklarla devasa patlamalar yarat. Her 10 bölümde BOSS'u yen. Tıkla & sürükle ile takas et.",
    route: "/games/candy-burst",
    status: "playable" as const,
  },
  {
    id: "sunny-side-ride",
    title: "Sunny Side Ride",
    subtitle: "3D Bisiklet Macerası",
    emoji: "🚲",
    artClass: "art-17",
    description:
      "Açık dünya 3D bisiklet macerası! Ağaç tünelleriyle kaplı kıvrımlı sokaklarda pedal çevir, rampalardan zıpla, tokenları topla ve checkpointleri geç. Prosedürel mahalle: tepeler, ahşap köprü, parklar, sokak lambaları, yayalar ve trafik. W/S pedal-fren, A/D direksiyon, Space zıplama, Shift sprint.",
    route: "/games/sunny-side-ride",
    status: "playable" as const,
  },
  {
    id: "akil-kupu",
    title: "Akıl Küpü",
    subtitle: "SOMA Parça Bulmacası",
    emoji: "🧩",
    artClass: "art-16",
    description:
      "SOMA tarzı 3D parça yerleştirme! 7 renkli parçayı 3×3×3 küpe yerleştirip tamamla. Parçayı seç, dokun, çevir — 3D önizleme, animasyonlu çözücü ve rekor takibi. Tamamen dokunmatik, mobil uyumlu.",
    route: "/games/akil-kupu",
    status: "playable" as const,
  },
  {
    id: "yilan-arena",
    title: "Yılan Arena",
    subtitle: "Neon Yılan Oyunu",
    emoji: "🐍",
    artClass: "art-18",
    description:
      "Neon yılan arenasında klasik yılan oyunu! Elmaları ye (+10), altın elmayı kap (+50 ve 6 sn hayalet modu), her elmada hızlan ve rekoru kır. Oklar/WASD veya kaydırma ile yönlendir; mobilde ekran butonları.",
    route: "/games/yilan-arena",
    status: "playable" as const,
  },
  {
    id: "mayin-tarlasi",
    title: "Mayın Tarlası",
    subtitle: "Neon Mayın Oyunu",
    emoji: "💣",
    artClass: "art-19",
    description:
      "Klasik mayın oyunu neon arena'da! İlk tık her zaman güvenli; komşu sayılarını oku, bayraklarla mayınları işaretle, tarlayı temizle. Kolay/Orta/Zor zorluklar ve zorluk başına en iyi süre takibi. Sağ tık veya 🚩 bayrak modu ile mobil dokunmatik.",
    route: "/games/mayin-tarlasi",
    status: "playable" as const,
  },
];

export default function Home() {
  return (
    <>
      <AmbientArcade />
      <MembershipUI />
      <main>
        <section className="hero">
        <h1>PIXEL ARCADE</h1>
        <p>
          A growing collection of original browser games. No downloads, no
          accounts — just play. New games added regularly.
        </p>
        <Link href="/arcade" className="hero-cta">
          🎮 Arcade Portal — Hemen Oyna
        </Link>
      </section>

      <section className="game-grid">
        {GAMES.map((game) =>
          game.status === "playable" ? (
            <Link
              key={game.id}
              href={game.route!}
              className="game-card playable"
            >
              <div className={`card-art ${game.artClass}`}>
                <span className="art-emoji">{game.emoji}</span>
                <span className="card-badge">OYNANABİLİR</span>
              </div>
              <div className="card-body">
                <h2>{game.title}</h2>
                <p style={{ fontWeight: 600, color: "var(--accent)" }}>
                  {game.subtitle}
                </p>
                <p>{game.description}</p>
                <span className="card-play">▶ Şimdi Oyna</span>
              </div>
            </Link>
          ) : (
            <div key={game.id} className="game-card locked">
              <div className={`card-art ${game.artClass}`}>
                <span className="art-emoji">{game.emoji}</span>
                <span className="card-badge soon">ÇOK YAKINDA</span>
              </div>
              <div className="card-body">
                <h2>{game.title}</h2>
                <p>{game.description}</p>
                <span className="card-locked-label">
                  🔒 Henüz mevcut değil
                </span>
              </div>
            </div>
          )
        )}
      </section>

      <footer className="footer">
        Pixel Arcade — original games, built with Next.js &amp; Canvas
      </footer>
      </main>
    </>
  );
}