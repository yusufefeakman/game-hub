/* Hub'un commit günlüğü — `git log`'dan üretilir (tur sonlarında yenilenir). */
export interface HubLogEntry { h: string; d: string; t: string; }

export const HUB_LOG: HubLogEntry[] = [
{
"h": "2470809",
"d": "2026-10-28",
"t": "OG/Twitter paylaşım kartları: her oyun + hub varsayılanı"
},
{
"h": "b1cef74",
"d": "2026-10-28",
"t": "\"Sıradaki ne oynasan?\" şeridi + arcade sürpriz düğmesi"
},
{
"h": "b9b3d2c",
"d": "2026-10-28",
"t": "Klavye kısayolları: / n ? Esc"
},
{
"h": "765899d",
"d": "2026-10-28",
"t": "Ayarlar'a 🎵 Ambient müzik anahtarı (kalıcı tercih ilk kez)"
},
{
"h": "fb683ac",
"d": "2026-10-28",
"t": "Ayarlar paneli: ⚙️ fanfar ve animasyon tercihleri"
},
{
"h": "69f65c9",
"d": "2026-10-28",
"t": "Rekor kutlamasına 8-bit fanfar"
},
{
"h": "3a8e907",
"d": "2026-10-28",
"t": "Yeni rekor kutlaması: oyun içi canlı 🏆 overlay"
},
{
"h": "19ab4c6",
"d": "2026-10-28",
"t": "Paylaşım artık skor kartını iliştiriyor"
},
{
"h": "e456e1c",
"d": "2026-10-28",
"t": "Çevrimdışı düşüş sayfası: /offline + SW fallback zinciri"
},
{
"h": "3403b8d",
"d": "2026-10-28",
"t": "Skor kartı: portal'dan canvas ile paylaşılabilir PNG"
},
{
"h": "3306e40",
"d": "2026-10-28",
"t": "Oyun paylaşma: 📤 düğmesi + skorlu paylaşım metni"
},
{
"h": "e0485e3",
"d": "2026-10-28",
"t": "Hero kişiselleştirme: kaldığın yerden devam + sürpriz oyun"
},
{
"h": "9013bd0",
"d": "2026-10-28",
"t": "Oyuncu Salonu istatistikleri + arcade 'Son Oynananlar' sekmesi"
},
{
"h": "d1afb89",
"d": "2026-10-28",
"t": "Ana sayfa kartlarına ★ puanı + SW precache sertleştirme"
},
{
"h": "a06f5f1",
"d": "2026-10-28",
"t": "Oyun sayfalarına 'Benzer Oyunlar' öneri şeridi"
},
{
"h": "c5a2934",
"d": "2026-10-28",
"t": "PWA kurulumunu düzelt + oyun kısayolları + sık oynanan rozeti"
},
{
"h": "0be5c37",
"d": "2026-10-28",
"t": "Çevrimdışı oyun desteği: SW sayfa önbelleği + Pixel Tycoon rota başlığı"
},
{
"h": "b834135",
"d": "2026-10-28",
"t": "Pixel Tycoon skorunu vitrine bağla: rekor entegrasyonu"
},
{
"h": "dc8c570",
"d": "2026-10-28",
"t": "Pixel Tycoon'u kataloga entegre et: 18. oyun"
},
{
"h": "5a9a3ee",
"d": "2026-10-23",
"t": "Pixel Tycoon oyununu ekle: public/tycoon.html (tek dosya, bağımsız)"
},
{
"h": "850b335",
"d": "2026-10-22",
"t": "Ana sayfada favoriler rafı + portal içi oynama takibi ortaklaştırdı"
},
{
"h": "b30b2af",
"d": "2026-10-22",
"t": "Büyük güncelleme: merkezi katalog, ana sayfada arama/kategori, son oynananlar, oyun sayfası kontrolleri, Hakkımızda"
},
{
"h": "a08c841",
"d": "2026-10-18",
"t": "Anime Legends: tam Türkçe arayüz + klavyeyle karakter seçimi — akış testi artık tüm oyunlarda temiz"
},
{
"h": "a04102e",
"d": "2026-10-18",
"t": "Astro Blaster oyun içi arayüzü Türkçe — oyun içi dil eksenı kapanıyor"
},
{
"h": "48356c2",
"d": "2026-10-18",
"t": "Oyun içi arayüzler Türkçe: World War Z ve Pixel Pals yerelleştirmesi"
},
{
"h": "4dad34e",
"d": "2026-10-18",
"t": "Katalog ana sayfası ve site metadata'sı tamamen Türkçe"
},
{
"h": "d609fc5",
"d": "2026-10-18",
"t": "Dövüş Arenası mobil oynanabilirlik: dokunmatik dövüş kontrolleri + intro'da duraklama"
},
{
"h": "7b0c139",
"d": "2026-10-18",
"t": "Neon Rivals mobil oynanabilirlik: dövüş oyununa tam dokunmatik kontrol katmanı"
},
{
"h": "2e674e3",
"d": "2026-10-18",
"t": "Lets World mobil oynanabilirlik: kalıcı sol/sağ/zıplama butonları"
},
{
"h": "04b3730",
"d": "2026-10-18",
"t": "Katalog ana sayfasına kişisel rekor rafı (BestShelf)"
},
{
"h": "bd0bb81",
"d": "2026-10-18",
"t": "Rekor kapsamı tamamlandı: 101 Okey, Satranç, Neon Rivals ve Sunny Side Ride da vitrinde"
},
{
"h": "288ce91",
"d": "2026-10-18",
"t": "Dövüş oyunlarına rekor sistemi: Anime Legends skor + Dövüş Arenası galibiyet sayacı"
},
{
"h": "0eac746",
"d": "2026-10-18",
"t": "Arcade vitrinine kişisel rekor rozetleri + 'Rekorlarım' sekmesi"
},
{
"h": "9225d66",
"d": "2026-10-18",
"t": "Yerel rekor (high-score) altyapısı: 4 oyuna daha REKOR gösterimi"
},
{
"h": "477b508",
"d": "2026-10-18",
"t": "Okey'e ev kuralı ayarları: açılış eşiği, okeyle açılış yasağı, maç hedefi"
},
{
"h": "cac616d",
"d": "2026-10-18",
"t": "Lets World'e görev/finale doğru yapı: 30 bölümlük hedef + son boss + kazanma ekranı"
},
{
"h": "1adebb7",
"d": "2026-10-18",
"t": "World War Z mobil oynanabilirlik: dokunmatik kontrol katmanı eklendi"
},
{
"h": "59ae8bf",
"d": "2026-10-17",
"t": "101 Okey'e gerçek Okey (joker) + gösterge taşı mekaniği eklendi"
},
{
"h": "c6cfc96",
"d": "2026-10-17",
"t": "Lets World: prosedürel doku sistemi (harici asset yok)"
},
{
"h": "a3c0ec2",
"d": "2026-10-17",
"t": "Mayın Tarlası: bitiş ekranında üst butonlar kilitleniyordu + HUD zorluk güncellemesi"
},
{
"h": "d76bdb9",
"d": "2026-10-17",
"t": "Akıl Küpü: çözüm demosu sonrası tahta dolu kalıyordu"
},
{
"h": "c13fd7b",
"d": "2026-10-17",
"t": "Sunny Side Ride: köprü gömülülüğü, dere kanalı ve yol-asistanı düzeltmeleri (derin denetim turu)"
},
{
"h": "3b62436",
"d": "2026-10-17",
"t": "Sunny Side Ride: donma, yol ortası ağaçları ve bozuk rampalar düzeltildi + yeni grafikler"
},
{
"h": "52e2548",
"d": "2026-10-17",
"t": "Sunny Side Ride: hub içinde HUD'un üstüne binen geri butonları düzeltildi"
},
{
"h": "c6b1ba9",
"d": "2026-10-17",
"t": "Hata düzeltmeleri: 4 oyunda ikinci tur (6 düzeltme)"
},
{
"h": "f955479",
"d": "2026-10-15",
"t": "Hata düzeltmeleri: 4 oyunda 8 kritik/orta hata"
},
{
"h": "c89649c",
"d": "2026-10-15",
"t": "Astro Blaster: en iyi skor takibi (localStorage, ★ NEW BEST kutlaması, start/gameover/victory ekranlarında BEST göstergesi), headless test kancası (__astroTest) + doğrulama aracı (14/14 temiz)"
},
{
"h": "b850feb",
"d": "2026-10-15",
"t": "Mayın Tarlası: chord özelliği (doğru bayraklı açık sayıya tıklanınca komşular açılır), ↻ yeniden başlatma butonu, menüye chord açıklaması, headless test kancası (__mineTest) + doğrulama aracı (14/14 temiz)"
},
{
"h": "425abe8",
"d": "2026-10-15",
"t": "Candy Burst: hasValidMoves artık renk bombası takasını geçerli sayıyor — bombalı ama hamlesiz tabloda gereksiz KARIŞTIRILIYOR tetiklenmesinin önüne geçildi (trySwap/findHintMove ile tutarlı)"
},
{
"h": "d7aee15",
"d": "2026-10-13",
"t": "Katalog senkronizasyonu: arcade'e 101 Okey eklendi, README'ye eksik 3 oyun (Candy Burst, 101 Okey, Let's World) eklendi, smoke testten kaldırılmış cube-master rotası çıkarıldı — 20/20 temiz"
},
{
"h": "d3d014d",
"d": "2026-10-13",
"t": "Candy Burst v2.1: geçersiz takas git-gel animasyonu, kalan hamle bonusu (+100/hamle, bölüm sonu ekranında), duraklat (P/ESC + tıkla) overlay'i, mute (M + HUD 🔊 butonu), 🎉 YENİ REKOR kutlaması, headless test kancası (__candyTest) + doğrulama 14/14; smoke test iframe desteği (sunny-side-ride yalancı pozitif düzeltmesi, OOPIF + aynı-proses execution context, WebGL toDataURL piksel probu) — 21/21 temiz"
},
{
"h": "2255726",
"d": "2026-10-10",
"t": "Candy Burst v2: özel boncuklar (4 sıra→Çubuklu, 5 sıra→Renk Bombası, L/T→Sarmalı) + zincir reaksiyonları, ipucu sistemi, HiDPI render, squash/wobble animasyonları, şok dalgası parçacıkları, seviye banner'ı, HUD progress bar, boss müzik varyasyonu + bas çubuğu, karıştırma hatası düzeltmesi, dokunmatik swipe, yerel rekor kaydı, headless doğrulama aracı (9/9 temiz)"
},
{
"h": "a0d6754",
"d": "2026-10-08",
"t": "Hub smoke testi: 21 sayfada headless yükleme + JS hata toplama + canvas-only oyunlar için rAF/piksel doğrulaması (21/21 temiz)"
},
{
"h": "4af30db",
"d": "2026-10-07",
"t": "101 Okey hata avı: açılmadan masa setine dokunma yasağı (UI+hook), destek bitiminde kazanan 0 ceza, 9->16 taş seçim sınırı, maç-gen yarış koruması, modal metni + hedefli CDP testleri (14/14)"
},
{
"h": "24d8ffa",
"d": "2026-10-07",
"t": "101 Okey güncelleme: maç sonu fazı (matchEnd) görünür, botlar %50 elinde tutar, ipucu/ses akışı + CDP doğrulama aracı (10/10 temiz)"
},
{
"h": "93bce64",
"d": "2026-10-04",
"t": "Yeni oyun: 101 Okey (klasik Türk okeyi — 108 taş, 101+ açılış, 3 geçiş, bot rakipler, -101 maç hedefi)"
},
{
"h": "b4beee7",
"d": "2026-10-03",
"t": "Satranç: tık seçimi board-düzlemi raycast'e çevrildi (yan komşu taş artık kareyi kapatmıyor), test kancasına setClocks/pickInfo"
},
{
"h": "f01a498",
"d": "2026-10-03",
"t": "Satranç: hata düzeltmeleri + yeni özellikler"
},
{
"h": "9796c85",
"d": "2026-09-30",
"t": "yilan-arena: slower snake (BASE_TICK 185/MIN_TICK 105, softer accel) + neon polish + bonus star fruit"
},
{
"h": "b2f7972",
"d": "2026-09-30",
"t": "powerboat: tidy course layout + richer graphics (ocean/sky/islands/boats), pirate shanty music, difficulty modes + 3-level campaign"
},
{
"h": "a3f0796",
"d": "2026-09-30",
"t": "world-war-z: rounded models + ruined-city/day-night, inventory + SMG/rocket, 3-level campaign (city/forest/base) with victory"
},
{
"h": "c2c0330",
"d": "2026-09-30",
"t": "pixel-pals: faster snappier movement (fixed-step loop, retuned physics) + richer parallax/tile/sprite graphics"
},
{
"h": "a2fffc3",
"d": "2026-09-30",
"t": "powerboat: add rival AI boats, boost rings, oil slicks, boost flames"
},
{
"h": "ca8b5da",
"d": "2026-09-30",
"t": "world-war-z: add shotgun+sniper weapons, pickups, runner/brute zombie variants"
},
{
"h": "e83879e",
"d": "2026-09-30",
"t": "pixel-pals: add power-ups (double jump/shield/magnet), bat enemy, combo scoring"
},
{
"h": "6aa0f10",
"d": "2026-09-30",
"t": "arcade: add star rating system (user stars, avg score, sort by rating)"
},
{
"h": "92c01f8",
"d": "2026-09-29",
"t": "pixel-arcade: remove VoxelCraft game"
},
{
"h": "97174f4",
"d": "2026-09-29",
"t": "pixel-arcade: add Mayın Tarlası neon minesweeper game"
},
{
"h": "e78370c",
"d": "2026-09-29",
"t": "pixel-arcade: add Yılan Arena neon snake game"
},
{
"h": "786d69a",
"d": "2026-09-29",
"t": "pixel-arcade: voxelcraft furnace smelting + biomes/weather update"
},
{
"h": "9ea4e75",
"d": "2026-09-26",
"t": "pixel-arcade: fix arcade portal filtering (Turkish search normalization, hide showcase rows while filtering, hero Tam Sayfa 404)"
},
{
"h": "eb3e432",
"d": "2026-09-21",
"t": "sunny-side-ride: major bug fixes and mobile support"
},
{
"h": "deb89c5",
"d": "2026-09-20",
"t": "pixel-arcade: add Sunny Side Ride 3D bicycle adventure (page, engine, standalone HTML, catalog + portal entries)"
},
{
"h": "32740e2",
"d": "2026-09-20",
"t": "pixel-arcade: /games/cube-master now shows a removed-game notice and redirects to the arcade portal"
},
{
"h": "bcf7683",
"d": "2026-09-20",
"t": "pixel-arcade: custom 404 page that redirects removed game routes (/games/cube-master) to the arcade portal"
},
{
"h": "493c45c",
"d": "2026-09-20",
"t": "pixel-arcade: remove Cube Master game (route, catalog, portal, profile map, manifest, README)"
},
{
"h": "962c5c1",
"d": "2026-09-20",
"t": "pixel-arcade: arcade portal gets the ambient music + starfield layer (music toggle on /arcade)"
},
{
"h": "f37defd",
"d": "2026-09-20",
"t": "pixel-arcade: Lagged-style arcade portal at /arcade (hero slider, categories, search, favorites, in-page player)"
},
{
"h": "196996b",
"d": "2026-09-20",
"t": "pixel-arcade: akil-kupu SOMA cube puzzle (engine + page + catalog + standalone)"
},
{
"h": "c1addaf",
"d": "2026-09-14",
"t": "pixel-arcade: account dropdown menu (login/register/profile/logout)"
},
{
"h": "718da02",
"d": "2026-09-14",
"t": "pixel-arcade: Supabase-backed membership (auth, profiles, page protection)"
},
{
"h": "924c7cc",
"d": "2026-09-14",
"t": "pixel-arcade: membership system with profiles, avatars and XP"
},
{
"h": "de91c67",
"d": "2026-09-14",
"t": "pixel-arcade: slowed + reverb ambient music"
},
{
"h": "6ecc02e",
"d": "2026-09-14",
"t": "pixel-arcade: peaceful ambient music and clearer audio toggle"
},
{
"h": "590341f",
"d": "2026-09-14",
"t": "pixel-arcade: animated background and ambient music box"
},
{
"h": "cc0020a",
"d": "2026-09-14",
"t": "pixel-arcade: unique per-game card art and richer hub visuals"
},
{
"h": "6a21026",
"d": "2026-09-14",
"t": "pixel-pals: low-res pixel render with integer upscale"
},
{
"h": "9b627ea",
"d": "2026-09-14",
"t": "candy-burst: distinct candy shapes and richer background visuals"
},
{
"h": "a4fd004",
"d": "2026-09-12",
"t": "chess: enhance knight head, bishop/queen/king decorations"
},
{
"h": "b575297",
"d": "2026-09-12",
"t": "fix(chess): fix rook/knight/overlay geometry issues from screenshot"
},
{
"h": "4c0877e",
"d": "2026-09-12",
"t": "fix: chess piece geometry - rook, knight, overlay"
},
{
"h": "f13f752",
"d": "2026-09-12",
"t": "fix(chess): rook/knight geometry fixes - merge cap into body lathe, fix head overlap"
},
{
"h": "6fc722f",
"d": "2026-09-12",
"t": "fix: chess piece geometry - rook, knight, overlay fixes"
},
{
"h": "d21e6b3",
"d": "2026-09-12",
"t": "fix(chess): photorealistic board, solid pieces, knight head fix, soft shadows"
},
{
"h": "2466c49",
"d": "2026-09-12",
"t": "feat: add Candy Burst match-3 game with progressive difficulty"
},
{
"h": "748864a",
"d": "2026-09-12",
"t": "feat: add Candy Burst match-3 game"
},
{
"h": "1409a8a",
"d": "2026-09-12",
"t": "feat: add Let's World platformer game"
},
{
"h": "cef45aa",
"d": "2026-09-10",
"t": "fix(pages): enable trailingSlash so deep links (/games/<id>) resolve on GitHub Pages instead of 404"
},
{
"h": "605c1ea",
"d": "2026-09-10",
"t": "VoxelCraft: update game card + README for seed-based worlds, tree species, touch controls and save v2"
},
{
"h": "8a42811",
"d": "2026-09-10",
"t": "VoxelCraft phase 3: water surface side-face alignment fix, analog touch controls (joystick, look drag, mine/place/jump/sprint/inventory buttons) with desktop controls untouched"
},
{
"h": "664f50c",
"d": "2026-09-10",
"t": "VoxelCraft phase 2: fix transparent-neighbour face culling (holes near glass/leaves), richer block textures, birch+pine tree species and boulder clusters, gradient sky dome + stars + sun/moon discs, smooth player acceleration, throttled aim raycast"
},
{
"h": "c2bc8ea",
"d": "2026-09-10",
"t": "VoxelCraft optimization: shared chunk materials + frustum culling, dirty-chunk-only rebuild, texture atlas padding + mipmaps/anisotropy, seed system, adjustable render distance, mobile low-power profile, seed+edits save v2"
},
{
"h": "29fc6fe",
"d": "2026-09-09",
"t": "VoxelCraft phase 8: modern HUD - FPS counter, sound toggle button (M sync), target block name pill"
},
{
"h": "9fb8367",
"d": "2026-09-09",
"t": "VoxelCraft phase 7: save/load system - localStorage world+player+time+inventory, 25s autosave, menu Kaydet/Yeni Dünya"
},
{
"h": "3fa32bf",
"d": "2026-09-06",
"t": "VoxelCraft phase 6: mobs - passive farm animals + night zombies/skeletons with AI, melee combat, food drops, F to eat"
},
{
"h": "d772a85",
"d": "2026-09-06",
"t": "VoxelCraft phase 5: day/night cycle - dynamic sky/fog colors, sun/moon lighting, day counter HUD"
},
{
"h": "a113938",
"d": "2026-09-06",
"t": "VoxelCraft phase 4: tools with durability (pickaxe/axe/shovel wood+stone), hold-to-mine with block highlight, ore/obsidian tool gating"
},
{
"h": "c28195e",
"d": "2026-09-06",
"t": "VoxelCraft phase 3: full inventory UI (E) with drag-drop, crafting table block + 2x2/3x3 crafting, icon hotbar"
},
{
"h": "180cf9e",
"d": "2026-09-06",
"t": "VoxelCraft phase 2: survival player systems - health/hunger/fall damage, inventory-backed hotbar"
},
{
"h": "5ab1390",
"d": "2026-09-06",
"t": "VoxelCraft phase 1: 27 textured blocks, procedural world (caves, ores, water, trees, flowers), chunk render system"
},
{
"h": "f38cdb6",
"d": "2026-09-06",
"t": "Fix VoxelCraft rendering and gameplay: correct face normals, glass mesh, step-up physics, proper trees, fullscreen"
},
{
"h": "b400bf7",
"d": "2026-09-06",
"t": "Add VoxelCraft: Minecraft-like procedural block world"
},
{
"h": "4fa76d5",
"d": "2026-09-06",
"t": "Fix Starstriker: restart from game-over/pause, shield bar scaling, asteroid flow on boost"
},
{
"h": "6f6e28d",
"d": "2026-09-06",
"t": "Fix chess board rendering: eliminate Z-fighting and align pieces on square tops"
},
{
"h": "6fa83a5",
"d": "2026-09-04",
"t": "Move Doping Challenge into public/ so GitHub Pages serves it"
},
{
"h": "95ffc5b",
"d": "2026-09-04",
"t": "Add Doping Challenge: standalone mobile runner game"
},
{
"h": "3619b9f",
"d": "2026-09-04",
"t": "Add Doping Runner endless-runner game and make Game Hub an installable PWA (manifest, icons, service worker)"
},
{
"h": "07c4503",
"d": "2026-09-02",
"t": "Remove accidentally committed Chrome headless test profiles"
},
{
"h": "d542245",
"d": "2026-09-02",
"t": "Fix rendering quality across all games: remove forced pixelated upscaling, replace deprecated Three.js APIs (PCFSoftShadowMap, Clock)"
},
{
"h": "5e0166d",
"d": "2026-08-29",
"t": "Add Cube Master: high-quality 3D Rubik's cube with smooth animations"
},
{
"h": "1332d8d",
"d": "2026-08-29",
"t": "Remove Sculptor's Studio game"
},
{
"h": "cf65efb",
"d": "2026-08-28",
"t": "Add smooth Greek god statues (Zeus, Athena, Ares, Poseidon) to Sculptor's Studio"
},
{
"h": "0fa5d96",
"d": "2026-08-28",
"t": "Add Sculptor's Studio: high-quality 3D sculpture sandbox"
},
{
"h": "7568ea6",
"d": "2026-08-27",
"t": "Add standalone playable Anime Legends HTML for direct hosting"
},
{
"h": "2c5bf29",
"d": "2026-08-27",
"t": "Add Anime Legends: battle arena with 24 iconic anime characters"
},
{
"h": "dd5a0a5",
"d": "2026-08-27",
"t": "Add one-click deploy buttons and itch.io guide to README"
},
{
"h": "7e69abb",
"d": "2026-08-27",
"t": "Add standalone playable Astro Blaster HTML for direct hosting"
},
{
"h": "28f0ae0",
"d": "2026-08-27",
"t": "Set Turkish locale and use PCF shadow map for visuals"
},
{
"h": "a05a606",
"d": "2026-08-27",
"t": "Add Astro Blaster: space-themed block breaker game"
},
{
"h": "db337d9",
"d": "2026-08-23",
"t": "Realistic visuals: PBR humanoids, shadows, cinematic lighting, bloom"
},
{
"h": "f8b8635",
"d": "2026-08-23",
"t": "Remove Coming Soon placeholder cards from hub"
},
{
"h": "4a1bc52",
"d": "2026-08-23",
"t": "Replace default README with project documentation"
},
{
"h": "9913e56",
"d": "2026-08-23",
"t": "Fix AI blocking loop, verify match-end flow"
},
{
"h": "feeff48",
"d": "2026-08-23",
"t": "Fix fighting game: arena rendering, player walk, training label"
},
{
"h": "257d072",
"d": "2026-08-23",
"t": "Add fighting game and update chess"
},
{
"h": "89535cb",
"d": "2026-08-21",
"t": "Turkish UI: game cards, badges, play button and in-game menus"
},
{
"h": "4e0d2a5",
"d": "2026-08-21",
"t": "Add Starstriker (spaceship) and Royal Chess to the hub"
},
{
"h": "6af175b",
"d": "2026-08-18",
"t": "Fix basePath for GitHub Pages (hardcode in next.config.ts)"
},
{
"h": "3ea49ff",
"d": "2026-08-18",
"t": "Powerboat: fix steering, boat bottom, collision bounce, checkpoint miss reset"
},
{
"h": "7a732c1",
"d": "2026-08-18",
"t": "Add World War Z: 3D FPS zombie survival game (Three.js)"
},
{
"h": "9771a1b",
"d": "2026-08-18",
"t": "Add GitHub Pages deployment (static export + Actions workflow)"
},
{
"h": "5688d40",
"d": "2026-08-18",
"t": "Add game hub: home page with game grid + Pixel Pals game route"
},
{
"h": "52b579a",
"d": "2026-08-18",
"t": "Initial commit from Create Next App"
}
];

export const HUB_STATS = { commits: 143, firstDay: "2026-08-18", lastDay: "2026-10-28" };
