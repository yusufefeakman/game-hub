import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Anime Legends — Pixel Arcade",
  description: "24 karakterli dövüş turnuvası: karakterini seç, 8 rakibi yen ve şampiyon ol. A/D hareket, J/K/L saldırı, U ultimate.",
  openGraph: {
    title: "Anime Legends — Pixel Arcade",
    description: "24 karakterli dövüş turnuvası: karakterini seç, 8 rakibi yen ve şampiyon ol. A/D hareket, J/K/L saldırı, U ultimate.",
    type: "website",
    url: "/game-hub/games/anime-legends",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/anime-legends.svg", width: 1200, height: 630, alt: "Anime Legends — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Anime Legends — Pixel Arcade",
    description: "24 karakterli dövüş turnuvası: karakterini seç, 8 rakibi yen ve şampiyon ol. A/D hareket, J/K/L saldırı, U ultimate.",
    images: ["/game-hub/og/anime-legends.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
