/* =====================================================================
   Merkezi oyun kataloğu: ana sayfa, arcade ve diğer yüzeyler aynı
   veri kaynağını kullanır. Yeni oyun eklerken tek buraya eklemek yeter.
   ===================================================================== */

export type GameCategory =
  | "Aksiyon" | "Bulmaca" | "Dövüş" | "Yarış"
  | "Platform" | "Strateji" | "Macera" | "Arcade";

export interface GameDef {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  /** ana sayfa kart görseli (globals.css art-N sınıfı) */
  artClass: string;
  /** arcade kart görseli (düz degrade) */
  art: string;
  description: string;
  route: string;
  category: GameCategory;
  tags: string[];
  /** topluluk popülaritesi (arcade sıralaması) */
  pop: number;
  isNew?: boolean;
  featured?: boolean;
  /** oyunun kökteki bağımsız HTML kopyası (iframe/yedek) */
  standalone?: string;
}

export const GAMES: GameDef[] = [
  {
    id: "pixel-pals", title: "Pixel Pals", subtitle: "Yıldızın Peşinde", emoji: "🌟",
    artClass: "art-1", art: "linear-gradient(135deg,#6fc3e8 0%,#5cb874 100%)",
    category: "Platform", tags: ["Retro", "Boss", "Macera"], pop: 76,
    route: "/games/pixel-pals",
    description: "Küçük mavi yaratık Bloop ile çayırı geç, grump'ları ez, tüm paraları topla ve boss Gloom'u yenerek Altın Yıldız'ı kazan.",
  },
  {
    id: "world-war-z", title: "World War Z", subtitle: "Zombi Sürüsü Hayatta Kalma", emoji: "🧟",
    artClass: "art-2", art: "linear-gradient(135deg,#2d2d44 0%,#4a4a6a 100%)",
    category: "Aksiyon", tags: ["FPS", "3D", "Zombi"], pop: 91,
    route: "/games/world-war-z",
    description: "3D birinci şahıs zombi hayatta kalma: karanlık arenada sonsuz dalgalara karşı koy. WASD + fare, ateş etmek için tıkla.",
  },
  {
    id: "powerboat", title: "Sürat Teknesi Hücumu", subtitle: "Sürat Teknesi Engel Yarışı", emoji: "🚤",
    artClass: "art-4", art: "linear-gradient(135deg,#1e88e5 0%,#0d47a1 100%)",
    category: "Yarış", tags: ["3D", "Engel", "Nitro"], pop: 80,
    route: "/games/powerboat",
    description: "Okyanusta 3 boyutlu sürat teknesi yarışı: mayınlardan, kayalardan ve girdaplardan kaçın. WASD + Space ile hareket ve nitro.",
  },
  {
    id: "spaceship", title: "Yıldız Vurucu", subtitle: "Asteroid Saldırısı", emoji: "🚀",
    artClass: "art-6", art: "linear-gradient(135deg,#0b0b2b 0%,#3a1a6a 100%)",
    category: "Aksiyon", tags: ["Uzay", "Nişancı", "3D"], pop: 84,
    route: "/games/spaceship",
    description: "Asteroid alanlarında hayatta kal: kayaları ve düşman filolarını patlat. WASD ile hareket, Space ile ateş, Shift ile hızlan.",
  },
  {
    id: "doping-runner", title: "Doping Runner", subtitle: "Sonsuz Koşu ⚡", emoji: "⚡",
    artClass: "art-7", art: "linear-gradient(135deg,#ff2d78 0%,#7a1fa2 100%)",
    category: "Arcade", tags: ["Sonsuz Koşu", "Refleks", "Mobil"], pop: 89,
    route: "/games/doping-runner",
    description: "Neon şehirde sonsuz koşu: doping kapsüllerini topla, süper hıza ulaş, engellerden kaç ve rekor kır. Space ile zıpla (çift zıplama var).",
  },
  {
    id: "anime-legends", title: "Anime Legends", subtitle: "Ultimate Arena", emoji: "🥷",
    artClass: "art-9", art: "linear-gradient(135deg,#ff6f00 0%,#c62828 100%)",
    category: "Dövüş", tags: ["Turnuva", "Combo", "1P"], pop: 93,
    route: "/games/anime-legends", standalone: "/anime-legends.html",
    description: "24 karakterli dövüş turnuvası: karakterini seç, 8 rakibi yen ve şampiyon ol. A/D hareket, J/K/L saldırı, U ultimate.",
  },
  {
    id: "astro-blaster", title: "Astro Blaster", subtitle: "Uzay Blok Patlatma", emoji: "🛸",
    artClass: "art-10", art: "linear-gradient(135deg,#5e35b1 0%,#1a237e 100%)",
    category: "Arcade", tags: ["Breakout", "5 Seviye", "Güçlendirme"], pop: 82,
    route: "/games/astro-blaster", standalone: "/astro-blaster.html",
    description: "Uzay temalı blok kırma: 5 seviye, 4 blok tipi ve güçlendirmeler. Altın bloklar ekstra puan, elmas bloklar kırılmaz.",
  },
  {
    id: "chess", title: "Royal Chess", subtitle: "3D Strateji Klasiği", emoji: "♞",
    artClass: "art-11", art: "linear-gradient(135deg,#a1887f 0%,#5d4037 100%)",
    category: "Strateji", tags: ["Satranç", "3D", "2P"], pop: 90,
    route: "/games/chess",
    description: "Tam kurallı 3D satranç: rok, en passant, terfi ve şah mat. Arkadaşınla ya da dahili bilgisayara karşı oyna. Döndürmek için sürükle, hamle için tıkla.",
  },
  {
    id: "okey", title: "101 Okey", subtitle: "Klasik Türk Okeyi", emoji: "🀄",
    artClass: "art-8", art: "linear-gradient(135deg,#7cb342 0%,#1b5e20 100%)",
    category: "Strateji", tags: ["Klasik", "Bot", "108 Taş"], pop: 86,
    route: "/games/okey",
    description: "Klasik Türk okeyi: 108 taş, renk ve karma setler, 101+ açılış, 3 geçiş kuralı, akıllı bot rakipler ve -101 hedefli maçlar. Tamamen Türkçe.",
  },
  {
    id: "fighter", title: "Dövüş Arenası", subtitle: "Efsane Savaşçılar", emoji: "🥊",
    artClass: "art-12", art: "linear-gradient(135deg,#ff1744 0%,#880e4f 100%)",
    category: "Dövüş", tags: ["2P", "Enerji", "3D"], pop: 85,
    route: "/games/fighter",
    description: "4 efsane savaşçı (Kor, Bora, Çelik, Gölge), yumruk-tekme-blok ve enerjiyle güçlenen özel saldırılar. 1P vs CPU ya da 2 oyuncu.",
  },
  {
    id: "fighting", title: "Neon Rivals", subtitle: "3D Dövüş Oyunu", emoji: "🥋",
    artClass: "art-13", art: "linear-gradient(135deg,#00e5ff 0%,#004d40 100%)",
    category: "Dövüş", tags: ["3D", "Yapay Zekâ", "Kombo"], pop: 88,
    route: "/fighting",
    description: "4 savaşçı, 2'şer özel saldırı, 3 arena ve EASY/NORMAL/HARD yapay zekâ. Eğitim modu ve stamina sistemiyle tam bir dövüş deneyimi.",
  },
  {
    id: "lets-world", title: "Let's World", subtitle: "Platform Macerası", emoji: "🌍",
    artClass: "art-14", art: "linear-gradient(135deg,#42a5f5 0%,#1b5e20 100%)",
    category: "Platform", tags: ["Macera", "Boss", "Klasik"], pop: 79,
    route: "/games/lets-world",
    description: "Klasik platform macerası: koş, zıpla, jeton topla ve düşmanları ezip geç. Her 10 bölümde dev boss seni bekliyor.",
  },
  {
    id: "candy-burst", title: "Candy Burst", subtitle: "Eşleştirme Macerası", emoji: "🍬",
    artClass: "art-15", art: "linear-gradient(135deg,#ff4081 0%,#4a148c 100%)",
    category: "Bulmaca", tags: ["Eşleştirme", "Zincir", "Mobil"], pop: 87,
    route: "/games/candy-burst",
    description: "Şeker patlatma! 3+ aynı renkleri eşleştir, zincirleme patlamalar yap ve her 10 bölümde boss'u yen. Tıkla & sürükle ile takas et.",
  },
  {
    id: "sunny-side-ride", title: "Sunny Side Ride", subtitle: "3D Bisiklet Macerası", emoji: "🚲",
    artClass: "art-17", art: "linear-gradient(135deg,#7dd3fc 0%,#22c55e 100%)",
    category: "Yarış", tags: ["3D", "Bisiklet", "Keşif"], pop: 92,
    route: "/games/sunny-side-ride", standalone: "/sunny-side-ride.html",
    isNew: true, featured: true,
    description: "Açık dünya 3D bisiklet macerası! Ağaç tünelleriyle kaplı kıvrımlı sokaklarda pedal çevir, rampalardan zıpla, tokenları topla ve checkpointleri geç.",
  },
  {
    id: "akil-kupu", title: "Akıl Küpü", subtitle: "SOMA Parça Bulmacası", emoji: "🧩",
    artClass: "art-16", art: "linear-gradient(135deg,#22d3ee 0%,#a855f7 100%)",
    category: "Bulmaca", tags: ["SOMA", "3D", "Dokunmatik"], pop: 86,
    route: "/games/akil-kupu", standalone: "/akil-kupu.html",
    isNew: true, featured: true,
    description: "Klasik SOMA bulmacası: 7 renkli parçayı 3×3×3 küpe yerleştirip tamamla. Dokunmatik kontroller, 3D önizleme, animasyonlu çözücü ve en iyi süre takibi.",
  },
  {
    id: "yilan-arena", title: "Yılan Arena", subtitle: "Neon Yılan Oyunu", emoji: "🐍",
    artClass: "art-18", art: "linear-gradient(135deg,#34d399 0%,#0891b2 100%)",
    category: "Arcade", tags: ["Neon", "Klasik", "Dokunmatik"], pop: 88,
    route: "/games/yilan-arena",
    isNew: true,
    description: "Neon yılan arenasında klasik yılan: elmalar, altın elma + hayalet modu, hızlanma ve rekor takibi. Oklar/WASD veya kaydırma; mobilde ekran butonları.",
  },
  {
    id: "mayin-tarlasi", title: "Mayın Tarlası", subtitle: "Neon Mayın Oyunu", emoji: "💣",
    artClass: "art-19", art: "linear-gradient(135deg,#fb7185 0%,#312e81 100%)",
    category: "Strateji", tags: ["Klasik", "Bayrak", "3 Zorluk"], pop: 85,
    route: "/games/mayin-tarlasi",
    isNew: true,
    description: "Klasik mayın oyunu neon arena'da! İlk tık her zaman güvenli; komşu sayılarını oku, bayraklarla mayınları işaretle, tarlayı temizle. Kolay/Orta/Zor ve süre rekorları.",
  },
];

export const GAMES_BY_ID: Record<string, GameDef> = Object.fromEntries(GAMES.map((g) => [g.id, g]));
