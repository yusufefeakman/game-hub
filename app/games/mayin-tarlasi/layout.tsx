import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mayın Tarlası — Pixel Arcade",
  description: "Klasik mayın oyunu neon arena'da! İlk tık her zaman güvenli; komşu sayılarını oku, bayraklarla mayınları işaretle, tarlayı temizle. Kolay/Orta/Zor ve süre rekorları.",
  openGraph: {
    title: "Mayın Tarlası — Pixel Arcade",
    description: "Klasik mayın oyunu neon arena'da! İlk tık her zaman güvenli; komşu sayılarını oku, bayraklarla mayınları işaretle, tarlayı temizle. Kolay/Orta/Zor ve süre rekorları.",
    type: "website",
    url: "/game-hub/games/mayin-tarlasi",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/mayin-tarlasi.svg", width: 1200, height: 630, alt: "Mayın Tarlası — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mayın Tarlası — Pixel Arcade",
    description: "Klasik mayın oyunu neon arena'da! İlk tık her zaman güvenli; komşu sayılarını oku, bayraklarla mayınları işaretle, tarlayı temizle. Kolay/Orta/Zor ve süre rekorları.",
    images: ["/game-hub/og/mayin-tarlasi.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
