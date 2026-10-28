import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yıldız Vurucu — Pixel Arcade",
  description: "Asteroid alanlarında hayatta kal: kayaları ve düşman filolarını patlat. WASD ile hareket, Space ile ateş, Shift ile hızlan.",
  openGraph: {
    title: "Yıldız Vurucu — Pixel Arcade",
    description: "Asteroid alanlarında hayatta kal: kayaları ve düşman filolarını patlat. WASD ile hareket, Space ile ateş, Shift ile hızlan.",
    type: "website",
    url: "/game-hub/games/spaceship",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/spaceship.svg", width: 1200, height: 630, alt: "Yıldız Vurucu — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Yıldız Vurucu — Pixel Arcade",
    description: "Asteroid alanlarında hayatta kal: kayaları ve düşman filolarını patlat. WASD ile hareket, Space ile ateş, Shift ile hızlan.",
    images: ["/game-hub/og/spaceship.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
