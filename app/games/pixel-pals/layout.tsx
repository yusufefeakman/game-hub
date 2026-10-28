import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pixel Pals — Pixel Arcade",
  description: "Küçük mavi yaratık Bloop ile çayırı geç, grump'ları ez, tüm paraları topla ve boss Gloom'u yenerek Altın Yıldız'ı kazan.",
  openGraph: {
    title: "Pixel Pals — Pixel Arcade",
    description: "Küçük mavi yaratık Bloop ile çayırı geç, grump'ları ez, tüm paraları topla ve boss Gloom'u yenerek Altın Yıldız'ı kazan.",
    type: "website",
    url: "/game-hub/games/pixel-pals",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/pixel-pals.svg", width: 1200, height: 630, alt: "Pixel Pals — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pixel Pals — Pixel Arcade",
    description: "Küçük mavi yaratık Bloop ile çayırı geç, grump'ları ez, tüm paraları topla ve boss Gloom'u yenerek Altın Yıldız'ı kazan.",
    images: ["/game-hub/og/pixel-pals.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
