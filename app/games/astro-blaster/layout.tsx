import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Astro Blaster — Pixel Arcade",
  description: "Uzay temalı blok kırma: 5 seviye, 4 blok tipi ve güçlendirmeler. Altın bloklar ekstra puan, elmas bloklar kırılmaz.",
  openGraph: {
    title: "Astro Blaster — Pixel Arcade",
    description: "Uzay temalı blok kırma: 5 seviye, 4 blok tipi ve güçlendirmeler. Altın bloklar ekstra puan, elmas bloklar kırılmaz.",
    type: "website",
    url: "/game-hub/games/astro-blaster",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/astro-blaster.svg", width: 1200, height: 630, alt: "Astro Blaster — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Astro Blaster — Pixel Arcade",
    description: "Uzay temalı blok kırma: 5 seviye, 4 blok tipi ve güçlendirmeler. Altın bloklar ekstra puan, elmas bloklar kırılmaz.",
    images: ["/game-hub/og/astro-blaster.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
