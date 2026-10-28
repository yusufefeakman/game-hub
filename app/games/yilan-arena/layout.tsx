import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yılan Arena — Pixel Arcade",
  description: "Neon yılan arenasında klasik yılan: elmalar, altın elma + hayalet modu, hızlanma ve rekor takibi. Oklar/WASD veya kaydırma; mobilde ekran butonları.",
  openGraph: {
    title: "Yılan Arena — Pixel Arcade",
    description: "Neon yılan arenasında klasik yılan: elmalar, altın elma + hayalet modu, hızlanma ve rekor takibi. Oklar/WASD veya kaydırma; mobilde ekran butonları.",
    type: "website",
    url: "/game-hub/games/yilan-arena",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/yilan-arena.svg", width: 1200, height: 630, alt: "Yılan Arena — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Yılan Arena — Pixel Arcade",
    description: "Neon yılan arenasında klasik yılan: elmalar, altın elma + hayalet modu, hızlanma ve rekor takibi. Oklar/WASD veya kaydırma; mobilde ekran butonları.",
    images: ["/game-hub/og/yilan-arena.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
