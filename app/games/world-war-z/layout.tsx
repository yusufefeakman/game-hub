import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "World War Z — Pixel Arcade",
  description: "3D birinci şahıs zombi hayatta kalma: karanlık arenada sonsuz dalgalara karşı koy. WASD + fare, ateş etmek için tıkla.",
  openGraph: {
    title: "World War Z — Pixel Arcade",
    description: "3D birinci şahıs zombi hayatta kalma: karanlık arenada sonsuz dalgalara karşı koy. WASD + fare, ateş etmek için tıkla.",
    type: "website",
    url: "/game-hub/games/world-war-z",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/world-war-z.svg", width: 1200, height: 630, alt: "World War Z — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "World War Z — Pixel Arcade",
    description: "3D birinci şahıs zombi hayatta kalma: karanlık arenada sonsuz dalgalara karşı koy. WASD + fare, ateş etmek için tıkla.",
    images: ["/game-hub/og/world-war-z.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
