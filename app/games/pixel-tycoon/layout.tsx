import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pixel Tycoon — Pixel Arcade",
  description: "Neon şehir tycoon: ev, dükkan ve fabrika inşa et; dayanıklılık ve tamir yönet, müşteri akını ile belediye denetimi gibi rastgele olaylara dayan; şehrin otomatik kaydedilir.",
  openGraph: {
    title: "Pixel Tycoon — Pixel Arcade",
    description: "Neon şehir tycoon: ev, dükkan ve fabrika inşa et; dayanıklılık ve tamir yönet, müşteri akını ile belediye denetimi gibi rastgele olaylara dayan; şehrin otomatik kaydedilir.",
    type: "website",
    url: "/game-hub/games/pixel-tycoon",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/pixel-tycoon.svg", width: 1200, height: 630, alt: "Pixel Tycoon — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pixel Tycoon — Pixel Arcade",
    description: "Neon şehir tycoon: ev, dükkan ve fabrika inşa et; dayanıklılık ve tamir yönet, müşteri akını ile belediye denetimi gibi rastgele olaylara dayan; şehrin otomatik kaydedilir.",
    images: ["/game-hub/og/pixel-tycoon.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
