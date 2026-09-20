/* Derlenmiş Next.js çıktısını (out/) GitHub Pages gibi /game-hub/ altında sunar.
   Böylece basePath davranışı yerelde birebir test edilebilir.

   Kullanım: node tools/serve-hub.js [port]
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 8124);
const ROOT = path.join(__dirname, '..', 'out');
const BASE = '/game-hub';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

/** GitHub Pages davranışı: dizin isteğinde index.html, uzantısız yolda .html ara.
 *  Next.js RSC prefetch dosyaları (`__next.<route>.__PAGE__.txt`) da eşlenir. */
function resolveFile(urlPath) {
  const rel = urlPath.replace(BASE, '') || '/';
  const clean = decodeURIComponent(rel.split('?')[0]);
  const candidates = [];
  const trimmed = clean.replace(/^\//, "");
  if (clean === '/' || clean === '') candidates.push('index.html');
  else {
    candidates.push(trimmed);
    if (clean.endsWith('/')) candidates.push(trimmed + 'index.html');
    else {
      candidates.push(trimmed + '/index.html');
      candidates.push(trimmed + '.html');
    }
  }
  // RSC prefetch: /arcade/__next.arcade.__PAGE__.txt → out/__next.__PAGE__.txt
  const rsc = trimmed.match(/^(?:.*\/)?(__next\..*)$/);
  if (rsc) {
    candidates.push(rsc[1]);
    // Next bazı durumlarda rota adını da gömüyor: __next.arcade.__PAGE__.txt
    candidates.push(rsc[1].replace(/^__next\.[^.]+\./, "__next."));
  }
  for (const c of candidates) {
    const full = path.join(ROOT, c);
    if (full.startsWith(ROOT) && fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (!url.startsWith(BASE)) {
    res.writeHead(302, { Location: BASE + '/' });
    return res.end();
  }
  const file = resolveFile(url);
  if (!file) return send(res, 404, 'not found');
  const data = fs.readFileSync(file);
  send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', () => console.log('HUB_READY http://127.0.0.1:' + PORT + BASE + '/'));
