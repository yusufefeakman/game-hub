import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sunny Side Ride — Pixel Arcade",
  description: "Açık dünya 3D bisiklet macerası! Ağaç tünelleriyle kaplı kıvrımlı sokaklarda pedal çevir, rampalardan zıpla, tokenları topla ve checkpointleri geç.",
  openGraph: {
    title: "Sunny Side Ride — Pixel Arcade",
    description: "Açık dünya 3D bisiklet macerası! Ağaç tünelleriyle kaplı kıvrımlı sokaklarda pedal çevir, rampalardan zıpla, tokenları topla ve checkpointleri geç.",
    type: "website",
    url: "/game-hub/games/sunny-side-ride",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/sunny-side-ride.svg", width: 1200, height: 630, alt: "Sunny Side Ride — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sunny Side Ride — Pixel Arcade",
    description: "Açık dünya 3D bisiklet macerası! Ağaç tünelleriyle kaplı kıvrımlı sokaklarda pedal çevir, rampalardan zıpla, tokenları topla ve checkpointleri geç.",
    images: ["/game-hub/og/sunny-side-ride.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
