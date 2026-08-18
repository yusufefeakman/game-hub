import type { NextConfig } from "next";

// Base path is set via NEXT_PUBLIC_BASE_PATH env var in the GitHub Actions
// workflow so the app works under https://<user>.github.io/game-hub/
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  ...(basePath ? { basePath, images: { unoptimized: true } } : {}),
};

export default nextConfig;