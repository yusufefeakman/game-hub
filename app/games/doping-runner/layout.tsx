import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Doping Runner — Pixel Arcade",
  description: "Neon şehirde sonsuz koşu: doping kapsüllerini topla, süper hıza ulaş, engellerden kaç ve rekor kır. Space ile zıpla (çift zıplama var).",
  openGraph: {
    title: "Doping Runner — Pixel Arcade",
    description: "Neon şehirde sonsuz koşu: doping kapsüllerini topla, süper hıza ulaş, engellerden kaç ve rekor kır. Space ile zıpla (çift zıplama var).",
    type: "website",
    url: "/game-hub/games/doping-runner",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/doping-runner.svg", width: 1200, height: 630, alt: "Doping Runner — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Doping Runner — Pixel Arcade",
    description: "Neon şehirde sonsuz koşu: doping kapsüllerini topla, süper hıza ulaş, engellerden kaç ve rekor kır. Space ile zıpla (çift zıplama var).",
    images: ["/game-hub/og/doping-runner.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
