import type { NextConfig } from "next";

// GitHub Pages serves this repo under /game-hub/, so the app needs a
// matching basePath. For local dev (npm run dev) you can temporarily set
// BASE_PATH="" in a .env.local file to disable it.
const basePath = process.env.BASE_PATH ?? "/game-hub";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;