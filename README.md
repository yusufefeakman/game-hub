# Pixel Arcade — Game Hub

Next.js 16 ile geliştirilmiş, tarayıcıda oynanabilen **özgün oyunlar koleksiyonu**. Tüm oyunlar
sıfırdan yazılmıştır: telifli karakter, görsel, müzik veya varlık kullanılmaz. Grafikler
prosedürel Three.js geometrisi, sesler Web Audio API ile sentezlenir.

## 🎮 Oyunlar

| Oyun | Açıklama | Route |
|---|---|---|
| **Anime Legends** 🥷 | 24 ikonik anime karakteriyle dövüş turnuvası: Naruto, Goku, Luffy, Gojo, Saitama... 8 rakibi yen, şampiyon ol | `/game-hub/games/anime-legends` |
| **Astro Blaster** 🛸 | Uzay temalı blok kırma (Breakout): 5 seviye, 4 blok tipi, güçlendirmeler | `/game-hub/games/astro-blaster` |
| **Neon Rivals** 🥋 | 3D dövüş oyunu: 4 karakter (Kairo, Vexa, Rokan, Nyra), 2'şer özel saldırı, 3 arena, training modu, tuş yeniden atama, EASY/NORMAL/HARD yapay zekâ | `/game-hub/fighting` |
| **Dövüş Arenası** 🥊 | 3D dövüş oyunu: 4 savaşçı (Kor, Bora, Çelik, Gölge), enerji sistemi, 1P vs CPU / 2P | `/game-hub/games/fighter` |
| **Royal Chess** ♞ | Tam kurallı 3D satranç (rok, en passant, terfi, şah mat) — yerel 2P veya bilgisayar | `/game-hub/games/chess` |
| **Yıldız Vurucu** 🚀 | 3D uzay nişancısı: asteroid alanlarında savaş | `/game-hub/games/spaceship` |
| **Sürat Teknesi Hücumu** 🚤 | 3D sürat teknesi yarışı | `/game-hub/games/powerboat` |
| **World War Z** 🧟 | 3D FPS zombi hayatta kalma | `/game-hub/games/world-war-z` |
| **Pixel Pals** 🌟 | Platform macerası | `/game-hub/games/pixel-pals` |

## 🚀 Tek tıkla yayınla (Vercel / Netlify)

Bu repoyu kendi hesabına **tek tıkla** dağıtabilirsin — token gerekmez, buton hesabına yönlendirir:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyusufefeakman%2Fgame-hub)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/yusufefeakman/game-hub)

> Not: Vercel/Netlify'da `basePath` uyumsuzluğu yaşarsan `Environment Variables` kısmına `BASE_PATH=""` ekle.

## 🕹️ itch.io'ya yükleme

Oyunların tek dosyalık oynanabilir sürümleri (GitHub Pages'te canlı):
- **Anime Legends:** `public/anime-legends.html` → [anime-legends.html](https://yusufefeakman.github.io/game-hub/anime-legends.html)
- **Astro Blaster:** `public/astro-blaster.html` → [astro-blaster.html](https://yusufefeakman.github.io/game-hub/astro-blaster.html)

itch.io'ya yüklemek için:
1. itch.io'da yeni proje oluştur → **Kind: HTML** seç.
2. İlgili `.html` dosyasını **Uploads** alanına sürükle.
3. (İsteğe bağlı) Çözünürlük: 960×540, **Embed options** → **Fullscreen** aç.
4. Yayınla! 🎉

## 🚀 Çalıştırma

```bash
npm install
npm run dev
```

Tarayıcıda aç: [http://localhost:3000/game-hub](http://localhost:3000)

> Not: `next.config.ts` içinde `basePath` `/game-hub` olarak sabittir (GitHub Pages dağıtımı için).
> Yerel geliştirmede basePath'i kaldırmak isterseniz `.env.local` içinde `BASE_PATH=""` tanımlayın.

## 📦 Üretim derlemesi (GitHub Pages)

Proje statik export kullanır; çıktı `out/` klasörüne yazılır:

```bash
npm run build
# çıktı: out/ — bu klasörü GitHub Pages'e yayınlayın
```

## 🧱 Proje yapısı

```
app/
├── page.tsx              # Oyun kataloğu (GAMES dizisi — yeni oyun buraya eklenir)
├── globals.css
├── fighting/             # Neon Rivals (modüler motor)
│   ├── page.tsx          # "use client" + dinamik import
│   ├── engine.ts         # startGame(canvas) -> stop() — döngü/durum makinesi/kamera
│   └── core/             # types, state, audio, input, characters, fighter,
│                         # combat, ai, arenas, effects, hud
└── games/<oyun>/         # Diğer oyunların deseni
    ├── page.tsx          # "use client" + dinamik import
    └── engine.ts         # startGame(canvas) -> stop()
```

Oyun deseni: her oyun kendi klasöründe, `startGame(canvas)` döndüren bir motor
(`engine.ts`) ve onu monte eden bir sayfadan (`page.tsx`) oluşur. Motorlar kendi
DOM overlay'lerini (menü/HUD) kurar; sesler Web Audio ile sentezlenir.

## 🧪 Doğrulama

- `npm run build` — TypeScript + statik export kontrolü
- Headless Chrome CDP QA: menü akışları, oynanış, sıfır konsol hatası

## ⚙️ Teknolojiler

Next.js 16 (Turbopack) · React 19 · TypeScript (strict) · Three.js (r185) · Web Audio API
