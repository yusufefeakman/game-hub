import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Akıl Küpü — Pixel Arcade",
  description: "Klasik SOMA bulmacası: 7 renkli parçayı 3×3×3 küpe yerleştirip tamamla. Dokunmatik kontroller, 3D önizleme, animasyonlu çözücü ve en iyi süre takibi.",
  openGraph: {
    title: "Akıl Küpü — Pixel Arcade",
    description: "Klasik SOMA bulmacası: 7 renkli parçayı 3×3×3 küpe yerleştirip tamamla. Dokunmatik kontroller, 3D önizleme, animasyonlu çözücü ve en iyi süre takibi.",
    type: "website",
    url: "/game-hub/games/akil-kupu",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/akil-kupu.svg", width: 1200, height: 630, alt: "Akıl Küpü — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Akıl Küpü — Pixel Arcade",
    description: "Klasik SOMA bulmacası: 7 renkli parçayı 3×3×3 küpe yerleştirip tamamla. Dokunmatik kontroller, 3D önizleme, animasyonlu çözücü ve en iyi süre takibi.",
    images: ["/game-hub/og/akil-kupu.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
