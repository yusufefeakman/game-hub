import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Royal Chess — Pixel Arcade",
  description: "Tam kurallı 3D satranç: rok, en passant, terfi ve şah mat. Arkadaşınla ya da dahili bilgisayara karşı oyna. Döndürmek için sürükle, hamle için tıkla.",
  openGraph: {
    title: "Royal Chess — Pixel Arcade",
    description: "Tam kurallı 3D satranç: rok, en passant, terfi ve şah mat. Arkadaşınla ya da dahili bilgisayara karşı oyna. Döndürmek için sürükle, hamle için tıkla.",
    type: "website",
    url: "/game-hub/games/chess",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/chess.svg", width: 1200, height: 630, alt: "Royal Chess — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Royal Chess — Pixel Arcade",
    description: "Tam kurallı 3D satranç: rok, en passant, terfi ve şah mat. Arkadaşınla ya da dahili bilgisayara karşı oyna. Döndürmek için sürükle, hamle için tıkla.",
    images: ["/game-hub/og/chess.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
