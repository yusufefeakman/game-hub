import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pixel Arcade — Game Hub",
    short_name: "Pixel Arcade",
    description:
      "A growing collection of original browser games: Doping Runner, Anime Legends, Astro Blaster, Cube Master and more. Installable mobile app.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e28",
    theme_color: "#0a0e28",
    orientation: "landscape",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
