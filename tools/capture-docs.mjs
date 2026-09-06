// Documentation screenshots: real product UI, synthetic captions, no provider calls.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = path.join(root, 'tools/.tmp', `docs-capture-${Date.now()}`);
const output = path.join(root, 'guide/images');
await mkdir(run, { recursive: true }); await mkdir(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, [path.join(root, 'tools/browser-fixture.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, socket;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('FIXTURE_START_TIMEOUT')), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', () => { clearTimeout(timer); reject(Error('FIXTURE_EXITED')); });
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
  });
  browser = spawn(process.argv[2] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${run}/profile`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let launchError; browser.once('error', error => { launchError = error; });
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { port = (await readFile(path.join(run, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await pause(100); }
  }
  if (!port) throw Error('CHROME_START_FAILED');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const waiting = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), item = waiting.get(message.id);
    if (!item) return; waiting.delete(message.id); clearTimeout(item.timer);
    message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
  };
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`CDP_TIMEOUT ${method}`)); }, 15000);
    waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw Error('DOCS_UI_EVALUATION_FAILED'); return result.result?.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); }
    throw Error(`DOCS_UI_WAIT_FAILED ${expression}`);
  };
  await cdp('Page.enable', {}, sessionId);
  await cdp('Network.enable', {}, sessionId);
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] }, sessionId);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.docsRoots=[];const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const r=original.call(this,options);docsRoots.push(r);return r;};` }, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp('Page.navigate', { url: 'http://127.0.0.1:43188/watch?v=abcdefghijk' }, sessionId);
  await until(`document.querySelector('video')?.readyState>=2 && globalThis.__translatorVideoInstalled`);
  // Only the surrounding fixture presentation changes; product shadow UI is unmodified.
  await evaluate(`(() => {
    document.documentElement.setAttribute('dark','');
    document.querySelector('h1').textContent='YouTube 자막 번역 · 실행 화면';
    const note=document.createElement('p');note.id='docs-note';note.textContent='로컬 예제 영상과 모의 번역 응답으로 실행한 실제 UI입니다. 외부 API 호출은 없습니다.';document.querySelector('h1').after(note);
    const style=document.createElement('style');style.textContent='body{margin:28px;font-family:system-ui,sans-serif}body> :not(h1):not(#docs-note):not(#movie_player):not(ytd-watch-metadata):not([data-llm-translator-root]){display:none!important}h1{font-size:26px;margin:0 0 10px}#docs-note{color:#adb9c9;margin-bottom:22px}#movie_player{width:1044px;height:587px}';document.head.append(style);
    document.getElementById('open').click();
  })()`);
  await until(`docsRoots.some(r=>[...r.querySelectorAll('button')].some(b=>b.textContent==='번역 OFF'&&!b.disabled))`);
  const click = async label => {
    const point = await evaluate(`(()=>{const b=docsRoots.flatMap(r=>[...r.querySelectorAll('button')]).find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('BUTTON_MISSING');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, sessionId);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, sessionId);
  };
  await click('번역 OFF');
  await evaluate(`document.getElementById('seek-one').click()`);
  await until(`docsRoots.some(r=>r.querySelector('.caption')?.textContent==='자막 번역에 오신 것을 환영합니다.'&&!r.querySelector('.caption').hidden)`);
  const save = async file => {
    await evaluate('document.fonts.ready'); await pause(200);
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(path.join(output, file), Buffer.from(shot.data, 'base64'));
  };
  await save('youtube-caption-settings.png');
  await click('닫기');
  await until(`docsRoots.some(r=>r.querySelector('.panel')?.hidden && !r.querySelector('.caption').hidden)`);
  await save('youtube-caption-overlay.png');
  const evidence = await evaluate(`({caption:docsRoots.find(r=>r.querySelector('.caption'))?.querySelector('.caption').textContent,fixture:document.getElementById('status').textContent})`);
  await writeFile(path.join(run, 'result.json'), JSON.stringify({ browser: version.Browser, ...evidence, screenshots: ['youtube-caption-settings.png', 'youtube-caption-overlay.png'] }, null, 2));
  console.log(JSON.stringify({ browser: version.Browser, ...evidence, output }));
  await cdp('Browser.close').catch(() => {});
} finally { socket?.close(); browser?.kill(); server.kill(); }
