import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "101 Okey — Pixel Arcade",
  description: "Klasik Türk okeyi: 108 taş, renk ve karma setler, 101+ açılış, 3 geçiş kuralı, akıllı bot rakipler ve -101 hedefli maçlar. Tamamen Türkçe.",
  openGraph: {
    title: "101 Okey — Pixel Arcade",
    description: "Klasik Türk okeyi: 108 taş, renk ve karma setler, 101+ açılış, 3 geçiş kuralı, akıllı bot rakipler ve -101 hedefli maçlar. Tamamen Türkçe.",
    type: "website",
    url: "/game-hub/games/okey",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/okey.svg", width: 1200, height: 630, alt: "101 Okey — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "101 Okey — Pixel Arcade",
    description: "Klasik Türk okeyi: 108 taş, renk ve karma setler, 101+ açılış, 3 geçiş kuralı, akıllı bot rakipler ve -101 hedefli maçlar. Tamamen Türkçe.",
    images: ["/game-hub/og/okey.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
