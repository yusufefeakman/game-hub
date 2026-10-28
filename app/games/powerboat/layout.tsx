import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sürat Teknesi Hücumu — Pixel Arcade",
  description: "Okyanusta 3 boyutlu sürat teknesi yarışı: mayınlardan, kayalardan ve girdaplardan kaçın. WASD + Space ile hareket ve nitro.",
  openGraph: {
    title: "Sürat Teknesi Hücumu — Pixel Arcade",
    description: "Okyanusta 3 boyutlu sürat teknesi yarışı: mayınlardan, kayalardan ve girdaplardan kaçın. WASD + Space ile hareket ve nitro.",
    type: "website",
    url: "/game-hub/games/powerboat",
    siteName: "Pixel Arcade",
    images: [{ url: "/game-hub/og/powerboat.svg", width: 1200, height: 630, alt: "Sürat Teknesi Hücumu — Pixel Arcade oyun kartı" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sürat Teknesi Hücumu — Pixel Arcade",
    description: "Okyanusta 3 boyutlu sürat teknesi yarışı: mayınlardan, kayalardan ve girdaplardan kaçın. WASD + Space ile hareket ve nitro.",
    images: ["/game-hub/og/powerboat.svg"],
  },
};

export default function GameMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
