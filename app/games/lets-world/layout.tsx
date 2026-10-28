import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Let's World — Pixel Arcade",
  description: "Klasik platform macerası: koş, zıpla, jeton topla ve düşmanları ezip geç. Her 10 bölümde dev boss seni bekliyor.",
  openGraph: {
    title: "Let's World — Pixel Arcade",
    description: "Klasik platform macerası: koş, zıpla, jeton topla ve düşmanları ezip geç. Her 10 bölümde dev boss seni bekliyor.",
    type: "website",
    url: "/game-hub/games/lets-world",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/lets-world.svg", width: 1200, height: 630, alt: "Let's World — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Let's World — Pixel Arcade",
    description: "Klasik platform macerası: koş, zıpla, jeton topla ve düşmanları ezip geç. Her 10 bölümde dev boss seni bekliyor.",
    images: ["/game-hub/og/lets-world.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
