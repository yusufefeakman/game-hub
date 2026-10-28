import type { Metadata, Viewport } from "next";
import MotionBootstrap from "./components/MotionBootstrap";
import Hotkeys from "./components/Hotkeys";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_NAME = "Pixel Arcade — Game Hub";

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Orijinal tarayıcı oyunları koleksiyonu: 101 Okey, Anime Legends, Doping Runner, Akıl Küpü ve daha fazlası. Ana ekranına kurulabilen mobil oyun merkezi.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pixel Arcade",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0e28",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body>
        <MotionBootstrap />
        <Hotkeys />
        {children}
        {/* Register the service worker for offline + installable PWA */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('/game-hub/sw.js').catch(function () {}); }); }`,
          }}
        />
      </body>
    </html>
  );
}
