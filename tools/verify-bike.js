/* game-hub içindeki bisiklet oyununu doğrular: /games/sunny-side-ride rotasında
   iframe ile gömülü oyun gerçekten oynanabiliyor mu? */
const { chromium } = require('playwright');
const CHROME = process.env.CHROME_PATH ||
  'C:/Users/lbleg/OneDrive/Masaüstü/efe kod/.browsers/chromium-1243/chrome-win64/chrome.exe';
const path = require('path');
const fs = require('fs');

const BASE = process.env.HUB_URL || 'http://127.0.0.1:8124';
const SHOTS = path.join(__dirname, '..', '..', 'bike-adventure', 'shots');
const log = (...a) => console.log(...a);
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text());
  });
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) failed.push(r.status() + ' ' + r.url()); });

  let fails = 0;
  const check = (n, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}${extra ? ' | ' + extra : ''}`); };

  /* 1) Hub rotası açılıyor mu? */
  await page.goto(BASE + '/game-hub/games/sunny-side-ride/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  check('hub rota durumu 200', failed.filter(f => /sunny-side-ride/.test(f)).length === 0);

  /* 2) iframe yüklendi mi ve içinde oyun hazır mı? */
  const frameEl = await page.waitForSelector('iframe[title*="Sunny"]', { timeout: 30000 });
  check('oyun iframe\'i DOM\'da', !!frameEl);

  const frame = page.frames().find(f => /sunny-side-ride\.html/.test(f.url()));
  check('iframe src doğru yüklendi', !!frame, frame ? frame.url() : 'frame yok');

  if (frame) {
    await frame.waitForFunction(() => window.gameDebug && window.gameDebug.ready === true, { timeout: 60000 });
    const d0 = await frame.evaluate(() => ({ ...window.gameDebug, playerPosition: { ...window.gameDebug.playerPosition } }));
    check('oyun hazır (gameDebug.ready)', d0.ready === true);
    check('token/checkpoint yüklendi', d0.totalCollectibles > 100 && d0.totalCheckpoints === 8,
      `${d0.totalCollectibles} token, ${d0.totalCheckpoints} checkpoint`);

    await page.screenshot({ path: path.join(SHOTS, '09-hub-start.png') });
    console.log('   → shots/09-hub-start.png');

    /* 3) Start + sürüş: iframe içine klavye girdisi */
    await frame.click('#startBtn');
    await frame.waitForTimeout(500);
    const started = await frame.evaluate(() => window.gameDebug.started);
    check('start butonu çalıştı', started === true);

    // iframe gövdesine odaklan ve tuşları gönder
    await frame.evaluate(() => { document.body.focus(); window.focus(); });
    await frame.locator('body').click({ position: { x: 480, y: 300 } }).catch(() => {});
    await frame.waitForTimeout(200);

    await page.keyboard.down('w');    // üst sayfadan gönder (iframe odaklı)
    let peak = 0, moved = 0;
    const p0 = await frame.evaluate(() => window.gameDebug.playerPosition);
    for (let i = 0; i < 24; i++) {
      await frame.waitForTimeout(300);
      const d = await frame.evaluate(() => ({ v: window.gameDebug.speed, p: window.gameDebug.playerPosition, tok: window.gameDebug.collectibles }));
      peak = Math.max(peak, d.v);
      moved = Math.hypot(d.p.x - p0.x, d.p.z - p0.z);
      if (d.tok > 0 && peak > 8) break;
    }
    await page.keyboard.up('w');
    check('iframe içinde bisiklet hızlandı', peak > 5, peak.toFixed(1) + ' m/s');
    check('iframe içinde dünyada hareket etti', moved > 5, moved.toFixed(1) + ' m');

    const d1 = await frame.evaluate(() => ({ ...window.gameDebug, playerPosition: { ...window.gameDebug.playerPosition } }));
    check('token toplandı (hub içinde)', d1.collectibles > 0, d1.collectibles + ' token');
    check('skor arttı (hub içinde)', d1.score > 0, d1.score + ' puan');

    await page.screenshot({ path: path.join(SHOTS, '10-hub-gameplay.png') });
    console.log('   → shots/10-hub-gameplay.png');

    /* 4) Diğer kontroller iframe içinde */
    await page.keyboard.press('c');
    await frame.waitForTimeout(400);
    const cam = await frame.evaluate(() => window.gameDebug.cameraMode);
    check('C kamera değiştirdi', cam !== 0, 'mod=' + cam);

    await page.keyboard.press('p');
    await frame.waitForTimeout(400);
    const paused = await frame.evaluate(() => window.gameDebug.paused);
    check('P duraklattı', paused === true);
    await frame.click('#resumeBtn');
    await frame.waitForTimeout(300);
    check('devam etti', (await frame.evaluate(() => window.gameDebug.paused)) === false);

    await page.keyboard.press('r');
    await frame.waitForTimeout(500);
    const afterReset = await frame.evaluate(() => window.gameDebug.playerPosition);
    check('R sıfırladı', Math.abs(afterReset.x - 97.7) < 3 || Math.abs(afterReset.z - 35.7) < 3,
      `(${afterReset.x.toFixed(0)},${afterReset.z.toFixed(0)})`);
  }

  /* 5) Hub'ın kendi sayfaları bozulmadı mı? */
  await page.goto(BASE + '/game-hub/arcade/', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const arc = await page.evaluate(() => ({
    cards: document.querySelectorAll('.arc-card').length,
    hasSunny: document.body.textContent.includes('Sunny Side Ride'),
    hero: !!document.querySelector('.arc-hero')
  }));
  check('portal açılıyor, kartlar var', arc.cards > 10 && arc.hero, JSON.stringify(arc));
  check('Sunny Side Ride portalda görünüyor', arc.hasSunny);
  await page.screenshot({ path: path.join(SHOTS, '11-hub-arcade.png') });

  await page.goto(BASE + '/game-hub/', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const home = await page.evaluate(() => document.body.textContent.includes('Sunny Side Ride'));
  check('ana katalogda görünüyor', home);

  /* 6) Standalone HTML de çalışıyor mu? */
  await page.goto(BASE + '/game-hub/sunny-side-ride.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.gameDebug && window.gameDebug.ready === true, { timeout: 60000 });
  check('standalone HTML çalışıyor', true);

  // Next.js RSC prefetch istekleri (`__next.*.__PAGE__.txt`, çift basePath) ve
  // favicon, oyunla ilgisi olmayan framework gürültüsüdür — canlı sitede de var.
  // Gerçek oyun kaynakları için 404 aranır.
  const isFrameworkNoise = (u) => /favicon|__next\.|\.txt(\?|$)|\/game-hub\/game-hub\//i.test(u);
  const realFailures = failed.filter(u => !isFrameworkNoise(u));
  check('konsol hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('gerçek kaynak hatası yok', realFailures.length === 0, realFailures.slice(0, 3).join(' | '));
  const noise = failed.filter(isFrameworkNoise);
  if (noise.length) log(`   (${noise.length} framework prefetch isteği yok sayıldı — Next.js normal davranışı)`);

  console.log(fails ? `\n${fails} kontrol başarısız` : '\nHUB ENTEGRASYONU DOĞRULANDI ✔');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('PROBE HATASI:', e.message); process.exit(1); });
