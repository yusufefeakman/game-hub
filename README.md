# Pixel Arcade — Game Hub

Next.js 16 ile geliştirilmiş, tarayıcıda oynanabilen **özgün oyunlar koleksiyonu**. Tüm oyunlar
sıfırdan yazılmıştır: telifli karakter, görsel, müzik veya varlık kullanılmaz. Grafikler
prosedürel Three.js geometrisi, sesler Web Audio API ile sentezlenir.

## 🎮 Oyunlar

| Oyun | Açıklama | Route |
|---|---|---|
| **Neon Rivals** 🥋 | 3D dövüş oyunu: 4 karakter (Kairo, Vexa, Rokan, Nyra), 2'şer özel saldırı, 3 arena, training modu, tuş yeniden atama, EASY/NORMAL/HARD yapay zekâ | `/game-hub/fighting` |
| **Dövüş Arenası** 🥊 | 3D dövüş oyunu: 4 savaşçı (Kor, Bora, Çelik, Gölge), enerji sistemi, 1P vs CPU / 2P | `/game-hub/games/fighter` |
| **Royal Chess** ♞ | Tam kurallı 3D satranç (rok, en passant, terfi, şah mat) — yerel 2P veya bilgisayar | `/game-hub/games/chess` |
| **Yıldız Vurucu** 🚀 | 3D uzay nişancısı: asteroid alanlarında savaş | `/game-hub/games/spaceship` |
| **Sürat Teknesi Hücumu** 🚤 | 3D sürat teknesi yarışı | `/game-hub/games/powerboat` |
| **World War Z** 🧟 | 3D FPS zombi hayatta kalma | `/game-hub/games/world-war-z` |
| **Pixel Pals** 🌟 | Platform macerası | `/game-hub/games/pixel-pals` |

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
