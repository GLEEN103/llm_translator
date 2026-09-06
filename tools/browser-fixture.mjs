// Local, public fixture only. Does not read .env.local or call any provider.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const routes = new Map([
  ['/video-cache.mjs', [new URL('../src/extension/video-cache.mjs', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/options.css', [new URL('../src/extension/options.css', import.meta.url), 'text/css; charset=utf-8']],
  ...['kie.mjs', 'kie-models.mjs', 'kie-pricing.mjs'].map(file => [`/${file}`, [new URL(`../src/extension/${file}`, import.meta.url), 'text/javascript; charset=utf-8']]),
  ['/statistics.html', [new URL('../src/extension/statistics.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/statistics.css', [new URL('../src/extension/statistics.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/popup-preview', [new URL('../src/extension/popup.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/usage-fixture.mjs', [new URL('./fixtures/usage-fixture.mjs', import.meta.url), 'text/javascript; charset=utf-8']],
  ...['usage.mjs', 'usage-ui.mjs', 'statistics.mjs', 'popup.js', 'popup-usage.mjs'].map(file => [`/${file}`, [new URL(`../src/extension/${file}`, import.meta.url), 'text/javascript; charset=utf-8']]),
  ['/youtube-launcher.js', [new URL('../src/extension/youtube-launcher.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/launcher-fixture.js', [new URL('./fixtures/launcher-fixture.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ...['youtube-dom.js', 'video-style.js', 'video-session.js'].map(file => [`/${file}`, [new URL(`../src/extension/${file}`, import.meta.url), 'text/javascript; charset=utf-8']]),
  ['/youtube-player-checks', [new URL('./fixtures/youtube-player-checks.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/youtube-player-checks.mjs', [new URL('./fixtures/youtube-player-checks.mjs', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/youtube-player-captions.mjs', [new URL('../src/extension/youtube-player-captions.mjs', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/watch?v=abcdefghijk', [new URL('./fixtures/video-page.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/shorts/abcdefghijk', [new URL('./fixtures/shorts-page.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/shorts-fixture.js', [new URL('./fixtures/shorts-fixture.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/video-fixture.js', [new URL('./fixtures/video-fixture.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/', [new URL('./fixtures/text-page.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/fixture.js', [new URL('./fixtures/browser-checks.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/image-fixture.mjs', [new URL('./fixtures/image-fixture.mjs', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/cross-origin-image.svg', [new URL('./fixtures/cross-origin-image.svg', import.meta.url), 'image/svg+xml']],
  ['/options-preview', [new URL('../src/extension/options.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/options-fixture.mjs', [new URL('./fixtures/options-fixture.mjs', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/ui.css', [new URL('../src/extension/ui.css', import.meta.url), 'text/css; charset=utf-8']],
  ...['core.js', 'dom.js', 'content.js', 'image-dom.js', 'image-content.js', 'image-contract.mjs', 'image-capture.mjs', 'consent.js', 'options.js', 'broker.mjs', 'page-cache.mjs', 'contract.mjs', 'google.mjs', 'models.mjs', 'profiles.mjs', 'model-releases.mjs', 'video-core.js', 'video-content.js', 'youtube-captions.mjs'].map(file => [`/${file}`, [new URL(`../src/extension/${file}`, import.meta.url), 'text/javascript; charset=utf-8']])
]);
const server = http.createServer(async (req, res) => {
  const publicImage = req.headers.host === 'localhost:43188' && req.url === '/cross-origin-image.svg';
  if ((!publicImage && req.headers.host !== '127.0.0.1:43188') || req.method !== 'GET' || !routes.has(req.url)) { res.writeHead(404); res.end(); return; }
  const [file, type] = routes.get(req.url);
  try {
    let content = await readFile(file);
    if (req.url === '/options-preview') content = content.toString().replace('<script src="options.js"></script>', '<script type="module" src="/options-fixture.mjs"></script>');
    if (req.url === '/statistics.html') content = content.toString().replace('src="statistics.mjs"', 'src="/usage-fixture.mjs"');
    if (req.url === '/popup-preview') content = content.toString().replace('<script src="popup.js"></script><script type="module" src="popup-usage.mjs"></script>', '<script type="module" src="/usage-fixture.mjs"></script>');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(content);
  }
  catch { res.writeHead(500); res.end('Fixture unavailable'); }
});
server.listen(43188, '127.0.0.1', () => console.log('Public DOM fixture: http://127.0.0.1:43188 (mock translations only)'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
