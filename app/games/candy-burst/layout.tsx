import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Candy Burst — Pixel Arcade",
  description: "Şeker patlatma! 3+ aynı renkleri eşleştir, zincirleme patlamalar yap ve her 10 bölümde boss'u yen. Tıkla & sürükle ile takas et.",
  openGraph: {
    title: "Candy Burst — Pixel Arcade",
    description: "Şeker patlatma! 3+ aynı renkleri eşleştir, zincirleme patlamalar yap ve her 10 bölümde boss'u yen. Tıkla & sürükle ile takas et.",
    type: "website",
    url: "/game-hub/games/candy-burst",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/candy-burst.svg", width: 1200, height: 630, alt: "Candy Burst — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Candy Burst — Pixel Arcade",
    description: "Şeker patlatma! 3+ aynı renkleri eşleştir, zincirleme patlamalar yap ve her 10 bölümde boss'u yen. Tıkla & sürükle ile takas et.",
    images: ["/game-hub/og/candy-burst.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
