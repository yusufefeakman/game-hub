import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dövüş Arenası — Pixel Arcade",
  description: "4 efsane savaşçı (Kor, Bora, Çelik, Gölge), yumruk-tekme-blok ve enerjiyle güçlenen özel saldırılar. 1P vs CPU ya da 2 oyuncu.",
  openGraph: {
    title: "Dövüş Arenası — Pixel Arcade",
    description: "4 efsane savaşçı (Kor, Bora, Çelik, Gölge), yumruk-tekme-blok ve enerjiyle güçlenen özel saldırılar. 1P vs CPU ya da 2 oyuncu.",
    type: "website",
    url: "/game-hub/games/fighter",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/fighter.svg", width: 1200, height: 630, alt: "Dövüş Arenası — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dövüş Arenası — Pixel Arcade",
    description: "4 efsane savaşçı (Kor, Bora, Çelik, Gölge), yumruk-tekme-blok ve enerjiyle güçlenen özel saldırılar. 1P vs CPU ya da 2 oyuncu.",
    images: ["/game-hub/og/fighter.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
