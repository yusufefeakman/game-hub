import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Neon Rivals — Pixel Arcade",
  description: "4 savaşçı, 2'şer özel saldırı, 3 arena ve EASY/NORMAL/HARD yapay zekâ. Eğitim modu ve stamina sistemiyle tam bir dövüş deneyimi.",
  openGraph: {
    title: "Neon Rivals — Pixel Arcade",
    description: "4 savaşçı, 2'şer özel saldırı, 3 arena ve EASY/NORMAL/HARD yapay zekâ. Eğitim modu ve stamina sistemiyle tam bir dövüş deneyimi.",
    type: "website",
    url: "/game-hub/fighting",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/fighting.svg", width: 1200, height: 630, alt: "Neon Rivals — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Neon Rivals — Pixel Arcade",
    description: "4 savaşçı, 2'şer özel saldırı, 3 arena ve EASY/NORMAL/HARD yapay zekâ. Eğitim modu ve stamina sistemiyle tam bir dövüş deneyimi.",
    images: ["/game-hub/og/fighting.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
