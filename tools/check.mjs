import { readdir, readFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
async function walk(relative) {
  const directory = path.join(root, relative);
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked code directories are not allowed');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (relative === 'tools' && entry.name === '.tmp') continue;
    if (entry.isSymbolicLink()) throw new Error('Linked code files are not allowed');
    const item = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(item);
    else if (/\.(m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path.join(root, item)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`Syntax check failed: ${item}\n${result.stderr}`);
      count++;
    } else if (entry.name.endsWith('.json')) JSON.parse(await readFile(path.join(root, item), 'utf8'));
  }
}
await walk('src'); await walk('tools');
for (const item of ['package.json', 'config/security-policy.json']) JSON.parse(await readFile(path.join(root, item), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'src/extension/manifest.json'), 'utf8'));
for (const file of ['openai.mjs', 'openai-models.mjs', 'openai-transport.mjs', 'openai-offscreen.html', 'openai-offscreen.mjs', 'openai-offscreen-host.mjs', 'openai-worker.mjs']) await lstat(path.join(root, 'src/extension', file));
for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page]) await lstat(path.join(root, 'src/extension', file));
for (const file of ['statistics.html', 'statistics.mjs', 'statistics.css', 'popup-usage.mjs', 'usage-ui.mjs', 'usage.mjs']) await lstat(path.join(root, 'src/extension', file));
if (manifest.host_permissions.join() !== 'https://generativelanguage.googleapis.com/*,https://www.youtube.com/*,https://api.kie.ai/*,https://docs.kie.ai/*,https://api.openai.com/*' || manifest.permissions.includes('tabs') || manifest.permissions.includes('<all_urls>')) throw new Error('Unexpected broad permissions');
if (JSON.stringify(manifest.content_scripts) !== JSON.stringify([{ matches: ['https://www.youtube.com/*'], js: ['youtube-dom.js', 'youtube-launcher.js'], run_at: 'document_idle', all_frames: false }])) throw new Error('Unexpected automatic injection scope');
await lstat(path.join(root, 'src/extension/youtube-launcher.js'));
if (!manifest.permissions.includes('contextMenus')) throw new Error('Selection menu permission is missing');
if (!manifest.permissions.includes('offscreen') || Number(manifest.minimum_chrome_version) < 116) throw new Error('Kie worker transport requires offscreen and Chrome 116');
for (const file of ['kie-offscreen.html', 'kie-offscreen.mjs', 'kie-offscreen-host.mjs', 'kie-worker.mjs', 'kie-transport.mjs']) await lstat(path.join(root, 'src/extension', file));
if (!manifest.content_security_policy.extension_pages.endsWith('connect-src https://generativelanguage.googleapis.com https://api.kie.ai https://docs.kie.ai https://api.openai.com')) throw new Error('Unexpected outbound endpoint');
console.log(`PASS: ${count} JavaScript files, JSON configuration, extension entrypoints and permission scope.`);
