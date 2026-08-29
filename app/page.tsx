import Link from "next/link";

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
    artClass: "art-1",
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
    artClass: "art-3",
    description:
      "3D uzay nişancı oyunu. Uzay aracını asteroid alanlarında yönlendir, kayaları ve düşman filolarını patlat. WASD ile hareket, Space ile ateş, Shift ile hızlan.",
    route: "/games/spaceship",
    status: "playable" as const,
  },
  {
    id: "cube-master",
    title: "Cube Master",
    subtitle: "Akıl Küpü",
    emoji: "🧩",
    artClass: "art-1",
    description:
      "Yüksek kaliteli 3D Rubik küpü! Akıcı animasyonlarla yüzleri çevir, karıştır, çöz ve rekorunu kır. Fareyle küpü döndür, yüzlerde sürükleyerek katman çevir, U/D/L/R/F/B tuşlarıyla hamle yap.",
    route: "/games/cube-master",
    status: "playable" as const,
  },
  {
    id: "anime-legends",
    title: "Anime Legends",
    subtitle: "Ultimate Arena",
    emoji: "🥷",
    artClass: "art-2",
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
    artClass: "art-3",
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
    artClass: "art-2",
    description:
      "Full 3D chess with complete rules: castling, en passant, promotion, checkmate and draw detection. Play a friend locally or challenge the built-in computer. Drag to orbit, scroll to zoom, click to move.",
    route: "/games/chess",
    status: "playable" as const,
  },
  {
    id: "fighter",
    title: "Dövüş Arenası",
    subtitle: "Efsane Savaşçılar",
    emoji: "🥊",
    artClass: "art-3",
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
    artClass: "art-1",
    description:
      "Özgün 3D dövüş oyunu! 4 savaşçı (Kairo, Vexa, Rokan, Nyra), 2'şer özel saldırı, 3 arena (Neon City, Antik Tapınak, Cyber Arena), kombo ve stamina sistemi, eğitim modu ve EASY/NORMAL/HARD yapay zekâ. P1: A/D + W/S + J/K/L/U — P2: Oklar + Num1-4.",
    route: "/fighting",
    status: "playable" as const,
  },
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <h1>PIXEL ARCADE</h1>
        <p>
          A growing collection of original browser games. No downloads, no
          accounts — just play. New games added regularly.
        </p>
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
  );
}