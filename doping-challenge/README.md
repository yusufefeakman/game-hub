# ⚡ Doping Challenge

Android / mobil uyumlu, **dikey (portrait)** 2D sonsuz koşu oyunu.
Saf **HTML5 + CSS + JavaScript** (harici kütüphane yok, backend yok).

> Kurgusal bir oyundur — gerçek hayattaki doping kullanımını teşvik etmez.

## 🎮 Oynanış

- Karakter otomatik koşar; ekrana **dokun = zıpla** (havadayken tekrar dokun = çift zıplama).
- 🟢 **Yeşil enerji içeceği** → enerji doldurur + 100 puan (topla!)
- ⭐ **Yıldız** → 150 bonus puan (topla!)
- 🔴 **Kırmızı şırınga (YASAK)** → sakın toplama: −200 puan + sersemleme (hız artar, görüntü bozulur)
- 🧱 Engellere çarpma → oyun biter.
- 🔋 Enerji biterse oyun biter — enerjiyi yeşil içeceklerle doldur.
- Her **1000 puan**da seviye atlarsın → hız artar.
- 🏆 En yüksek skor tarayıcıda (localStorage) saklanır.

## 📱 Ekranlar

1. Ana menü (başla + en yüksek skor)
2. Nasıl oynanır
3. Oyun ekranı (skor / seviye / enerji barı)
4. Duraklatma menüsü (⏸ butonu)
5. Oyun bitti ekranı (skor + rekor + "Tekrar Oyna")

## 📂 Dosyalar

```
doping-challenge/
├── index.html   ← OYUNUN BAŞLANGICI (bunu aç)
├── style.css    ← arayüz / tema
└── game.js      ← oyun motoru (canvas)
```

## 🚀 Çalıştırma

### En kolay yol (dosyayı direkt aç)
`index.html` dosyasına çift tıkla → Chrome/Edge'de açılır.
(⚠️ Bazı Android tarayıcılar `file://` üzerinde localStorage'ı kısıtlayabilir → aşağıdaki yerel sunucuyu kullan.)

### Yerel sunucu ile (önerilir)
Klasör içinde bir terminal aç:

```bash
# Python varsa:
python -m http.server 8000

# veya Node varsa:
npx serve .
```

Sonra tarayıcıda aç: http://localhost:8000

### Android telefonda
1. `doping-challenge` klasörünü telefona kopyala (USB / Drive / kablosuz).
2. [Termux](https://termux.com) veya PC'de aynı klasörde `python -m http.server 8000` başlat.
3. Telefonun tarayıcısında `http://BILGISAYAR_IP:8000` aç.
4. Tarayıcı menüsü → **"Ana ekrana ekle"** → uygulama gibi tam ekran oyna.

## ✅ Doğrulama

- `node --check game.js` → sözdizimi temiz
- Otomatik simülasyon testi (`smoke-test.js`): oyun 90 sn simüle edildi,
  enerji bitişi → skor ekranı → rekor kaydı akışı **hatasız** çalıştı.
- Testi tekrar koşmak için: `node smoke-test.js`
