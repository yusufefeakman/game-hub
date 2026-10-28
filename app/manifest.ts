import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pixel Arcade — Game Hub",
    short_name: "Pixel Arcade",
    description:
      "A growing collection of original browser games: Doping Runner, Anime Legends, Astro Blaster, Akıl Küpü and more. Installable mobile app.",
    // GitHub Pages bu repoyu /game-hub/ altında sunuyor; manifest
    // yolları taban yolunu içermeli (yoksa kurulum 404'e düşer).
    start_url: "/game-hub/",
    scope: "/game-hub/",
    display: "standalone",
    background_color: "#0a0e28",
    theme_color: "#0a0e28",
    orientation: "landscape",
    icons: [
      { src: "/game-hub/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/game-hub/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/game-hub/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Ana ekran kısayolları (Android Chrome): uzun bas → doğrudan oyun
    shortcuts: [
      { name: "Pixel Tycoon", short_name: "Tycoon", url: "/game-hub/games/pixel-tycoon/", description: "Neon Şehir İnşaatçısı", icons: [{ src: "/game-hub/icons/icon-192.png", sizes: "192x192" }] },
      { name: "101 Okey", short_name: "Okey", url: "/game-hub/games/okey/", description: "Klasik okey masası", icons: [{ src: "/game-hub/icons/icon-192.png", sizes: "192x192" }] },
      { name: "World War Z", short_name: "WWZ", url: "/game-hub/games/world-war-z/", description: "Zombi hayatta kalma", icons: [{ src: "/game-hub/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Royal Chess", short_name: "Satranç", url: "/game-hub/games/chess/", description: "Neon satranç", icons: [{ src: "/game-hub/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
