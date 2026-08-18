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
    id: "coming-soon-2",
    title: "Coming Soon",
    subtitle: "Game #2",
    emoji: "🎮",
    artClass: "art-2",
    description: "A new original game is in the works. Check back later!",
    route: null,
    status: "locked" as const,
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
    id: "coming-soon-3",
    title: "Coming Soon",
    subtitle: "Game #3",
    emoji: "🕹️",
    artClass: "art-3",
    description: "Another adventure will land here. Stay tuned!",
    route: null,
    status: "locked" as const,
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
                <span className="card-badge">PLAYABLE</span>
              </div>
              <div className="card-body">
                <h2>{game.title}</h2>
                <p style={{ fontWeight: 600, color: "var(--accent)" }}>
                  {game.subtitle}
                </p>
                <p>{game.description}</p>
                <span className="card-play">▶ Play Now</span>
              </div>
            </Link>
          ) : (
            <div key={game.id} className="game-card locked">
              <div className={`card-art ${game.artClass}`}>
                <span className="art-emoji">{game.emoji}</span>
                <span className="card-badge soon">COMING SOON</span>
              </div>
              <div className="card-body">
                <h2>{game.title}</h2>
                <p>{game.description}</p>
                <span className="card-locked-label">
                  🔒 Not available yet
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