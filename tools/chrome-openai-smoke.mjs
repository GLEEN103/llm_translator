// Isolated Chrome integration: only fixture keys/data, no user's browser profile or provider calls.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const delayMs = Number(process.argv[3] ?? 0);
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw Error('Invalid fixture delay');
const run = path.join(root, 'tools/.tmp', `openai-smoke-${Date.now()}`), extension = path.join(run, 'extension'), profile = path.join(run, 'profile');
await mkdir(extension, { recursive: true }); await mkdir(profile);
const files = ['openai-transport.mjs', 'openai-offscreen-host.mjs', 'openai-offscreen.mjs', 'openai-offscreen.html', 'openai-worker.mjs', 'openai.mjs', 'openai-models.mjs', 'contract.mjs', 'google.mjs', 'image-contract.mjs', 'usage.mjs', 'model-releases.mjs',
  'broker.mjs', 'profiles.mjs', 'models.mjs', 'page-cache.mjs', 'video-cache.mjs', 'image-capture.mjs', 'youtube-captions.mjs', 'youtube-player-captions.mjs', 'video-core.js', 'video-style.js', 'video-session.js', 'video-content.js',
  'kie.mjs', 'kie-models.mjs', 'kie-pricing.mjs', 'kie-transport.mjs', 'options.html', 'options.js', 'options.css', 'ui.css', 'core.js', 'consent.js', 'content.js', 'dom.js'];
for (const file of files) await copyFile(path.join(root, 'src/extension', file), path.join(extension, file));
await copyFile(path.join(root, 'tools/fixtures/parallel-text.js'), path.join(extension, 'parallel-text.js'));
await copyFile(path.join(root, 'tools/fixtures/video-retry-smoke.mjs'), path.join(extension, 'video-retry-smoke.mjs'));
await writeFile(path.join(extension, 'video-retry.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:20px;background:#333"><div id="movie_player" style="width:800px;max-width:100%;height:500px;background:#132438"><video style="width:100%;height:100%"></video></div><script type="module" src="video-retry-smoke.mjs"></script></body></html>');
await writeFile(path.join(extension, 'parallel-text.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><main></main><script src="parallel-text.js"></script><script src="core.js"></script><script src="dom.js"></script><script src="content.js"></script></body></html>');
const manifest = JSON.parse(await readFile(path.join(root, 'src/extension/manifest.json'), 'utf8'));
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'OpenAI isolated smoke', version: '1.0', minimum_chrome_version: manifest.minimum_chrome_version,
  permissions: ['offscreen', 'storage'], options_page: 'options.html', host_permissions: ['https://api.openai.com/*'], background: { service_worker: 'smoke.mjs', type: 'module' }, content_security_policy: manifest.content_security_policy }));
// Real dedicated worker/module loading, but the network boundary is always fake.
const worker = await readFile(path.join(extension, 'openai-worker.mjs'), 'utf8');
await writeFile(path.join(extension, 'openai-worker.mjs'), `globalThis.fetch = async (_url, options) => {
  const input = JSON.parse(JSON.parse(options.body).input[0].content[0].text);
  if(input.segments[0].text==='slow') await new Promise(resolve=>setTimeout(resolve,${delayMs}));
  if(input.segments[0].text==='parallel') await new Promise(resolve=>setTimeout(resolve,500));
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({translations:input.segments.map(s=>({id:s.id,text:'fixture translated'}))})}]}],usage:{input_tokens:2,output_tokens:3,total_tokens:5}});
};\n` + worker);
await writeFile(path.join(extension, 'smoke.mjs'), `import { createOpenAITransport } from './openai-transport.mjs';
import { createOpenAIProvider } from './openai.mjs';
import { createBroker } from './broker.mjs';
import { OPENAI_MODELS } from './openai-models.mjs';
globalThis.trace = [];
const onConnect = chrome.runtime.onConnect.addListener.bind(chrome.runtime.onConnect);
chrome.runtime.onConnect.addListener = listener => onConnect(port => {
  trace.push({event:'connect',name:port.name,sender:port.sender});
  port.onDisconnect.addListener(() => trace.push({event:'disconnect',error:chrome.runtime.lastError?.message}));
  listener(port);
});
const fetchImpl = createOpenAITransport(chrome);
const broker = createBroker({chrome,openaiFetchImpl:fetchImpl,fetchImpl:async(url,options)=>{
  if(url!=='https://api.openai.com/v1/models'||options.method!=='GET')throw Error('FIXTURE_UNEXPECTED_NETWORK');
  return Response.json({object:'list',data:OPENAI_MODELS.map(model=>({id:model.id,object:'model'}))});
}});
globalThis.runSmoke = async (text='hello') => {
  try {
    const translate=createOpenAIProvider({apiKey:'DUMMY_KEY',model:'gpt-5.6-luna',fetchImpl});
    const results = await Promise.all(Array.from({length:text==='parallel'?5:1},(_,i)=>translate({jobId:'fixture-'+i,sourceLanguage:'en',targetLanguage:'ko',chars:text.length,segments:[{id:'s1',text}]})));
    await new Promise(resolve=>setTimeout(resolve,100));
    return {ok:true,count:results.reduce((n,result)=>n+result.translations.length,0),trace,remaining:(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length};
  } catch (e) { return {ok:false,code:e.code,trace,contexts:await chrome.runtime.getContexts({})}; }
};
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.type==='SMOKE')runSmoke(message.text).then(reply);
  else broker.handle(message,sender).then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.code??'FIXTURE_ERROR'}));
  return true;
});`);
await writeFile(path.join(extension,'smoke.html'),'<!doctype html><html><body><pre id="result">running</pre><script type="module" src="smoke-page.mjs"></script></body></html>');
await writeFile(path.join(extension,'smoke-page.mjs'),`const results=[];
try { for(const text of ['hello','parallel','slow','again']) { const began=performance.now(); const result=await chrome.runtime.sendMessage({type:'SMOKE',text}); results.push({...result,elapsedMs:Math.round(performance.now()-began)}); if(!result.ok)break; }
document.getElementById('result').textContent=JSON.stringify({ok:results.length===4&&results[1].count===5&&results.every(r=>r.ok&&r.remaining===0),results}); }
catch {document.getElementById('result').textContent=JSON.stringify({ok:false,code:'SMOKE_MESSAGE_FAILED',results});}`);
const chromePath = process.argv[2] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--enable-unsafe-extension-debugging', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let port;
  for (let i=0;i<100;i++) { try { port = (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; break; } catch { await pause(100); } }
  if (!port) throw Error('CHROME_START_FAILED');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  console.log('Browser: '+version.Browser);
  socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
  let seq=0; const waits=new Map();
  socket.onmessage = event => { const m=JSON.parse(event.data); if(m.id && waits.has(m.id)) { const w=waits.get(m.id); waits.delete(m.id); clearTimeout(w.timer); m.error ? w.reject(Error(JSON.stringify(m.error))) : w.resolve(m.result); } };
  const cdp = (method, params={}, sessionId) => new Promise((resolve,reject) => { const id=++seq; const timer=setTimeout(()=>{waits.delete(id);reject(Error('CDP_TIMEOUT '+method));},20000); waits.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})); });
  const loaded = await cdp('Extensions.loadUnpacked',{path:extension});
  console.log('Fixture extension loaded: '+loaded.id);
  // Attach to the caller page only, not the service worker: debugger attachment must not keep it alive.
  const {targetId} = await cdp('Target.createTarget',{url:'chrome-extension://'+loaded.id+'/smoke.html'});
  const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  let result;
  for(let i=0;i<85;i++) { const read=await cdp('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true},sessionId);
    const value=read.result?.value; if(value?.startsWith('{')) { result=JSON.parse(value); break; } await pause(1000); }
  if(!result)throw Error('SMOKE_RESULT_TIMEOUT');
  const uiTarget=await cdp('Target.createTarget',{url:'chrome-extension://'+loaded.id+'/options.html'});
  const uiSession=(await cdp('Target.attachToTarget',{targetId:uiTarget.targetId,flatten:true})).sessionId;
  const evaluate=async expression=>{
    const read=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},uiSession);
    if(read.exceptionDetails)throw Error('UI_EVALUATION_FAILED');return read.result?.value;
  };
  const until=async expression=>{for(let i=0;i<50;i++){if(await evaluate(expression))return;await pause(100);}throw Error('UI_WAIT_FAILED');};
  await until('document.getElementById("provider") && !document.getElementById("provider").disabled');
  await evaluate(`(()=>{const p=document.getElementById('provider');p.value='openai';p.dispatchEvent(new Event('change'));const k=document.getElementById('api-key');k.value='DUMMY_UI_OPENAI_KEY';k.dispatchEvent(new Event('input'));document.getElementById('load-models').click();})()`);
  await until('document.querySelectorAll(".model-card input").length===12 && !document.querySelector(".model-card input").disabled');
  const layouts=[];
  for(const width of [1280,360]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},uiSession);
    await evaluate('document.getElementById("models-heading").scrollIntoView()');
    const layout=await evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,cards:[...document.querySelectorAll('.model-card')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})})`);
    layouts.push(layout);
    const shot=await cdp('Page.captureScreenshot',{format:'png'},uiSession);await writeFile(path.join(run,'options-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
  await evaluate(`document.querySelector('.model-card input[value="gpt-5.6-luna"]').click();document.getElementById('save').click();`);
  await until(`document.getElementById('saved-model').value==='gpt-5.6-luna' && !document.getElementById('provider').disabled`);
  await cdp('Page.reload',{},uiSession);
  await until(`document.getElementById('saved-model')?.value==='gpt-5.6-luna' && !document.getElementById('provider').disabled`);
  const ui=await evaluate(`({provider:document.getElementById('provider').value,keyEmpty:document.getElementById('api-key').value==='',saved:document.getElementById('saved-model').value,kieDisabled:document.querySelector('#provider option[value="kie"]').disabled,status:document.getElementById('status').textContent})`);
  result.ui={...ui,layouts};
  result.ok &&= ui.provider==='openai'&&ui.keyEmpty&&ui.kieDisabled&&layouts.every(l=>!l.overflow&&l.cards);
  const textTarget = await cdp('Target.createTarget', { url: 'chrome-extension://' + loaded.id + '/parallel-text.html' });
  const textSession = (await cdp('Target.attachToTarget', { targetId: textTarget.targetId, flatten: true })).sessionId;
  const textEval = async expression => {
    const read = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, textSession);
    if (read.exceptionDetails) throw Error('TEXT_EVALUATION_FAILED'); return read.result?.value;
  };
  const textUntil = async expression => {
    for (let i = 0; i < 150; i++) { if (await textEval(expression)) return; await pause(100); }
    const diagnostic = await textEval(`({roots:parallelFixture.roots.map(r=>({status:r.querySelector('.status')?.textContent,text:r.textContent.slice(-500)})),calls:parallelFixture.calls.length})`);
    throw Error('TEXT_WAIT_FAILED: ' + expression + ' ' + JSON.stringify(diagnostic));
  };
  const clickText = async label => {
    const point = await textEval(`(()=>{const b=[...parallelFixture.roots.at(-1).querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, textSession);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, textSession);
  };
  await textUntil('globalThis.parallelFixture && globalThis.__localTranslatorInstalled');
  await textEval('parallelFixture.open()');
  await textUntil(`parallelFixture.roots.at(-1)?.querySelector('.status')?.textContent.includes('준비됨')`);
  await clickText('번역 시작');
  await textUntil(`parallelFixture.calls.length===7 && !parallelFixture.active`);
  const textResult = await textEval(`({peak:parallelFixture.peak,count:parallelFixture.calls.length,uniqueJobs:new Set(parallelFixture.calls.map(c=>c.jobId)).size,restMs:Math.min(...parallelFixture.calls.slice(5).map(c=>c.start))-Math.max(...parallelFixture.calls.slice(0,5).map(c=>c.end)),translated:[...document.querySelectorAll('main p')].every((p,i)=>p.textContent==='T:phrase-'+i)})`);
  await clickText('번역본 ON');
  textResult.restored = await textEval(`[...document.querySelectorAll('main p')].every((p,i)=>p.textContent==='phrase-'+i) && parallelFixture.calls.length===7`);
  await clickText('번역본 OFF');
  textResult.toggled = await textEval(`[...document.querySelectorAll('main p')].every((p,i)=>p.textContent==='T:phrase-'+i) && parallelFixture.calls.length===7`);
  await clickText('새 번역');
  await textUntil(`parallelFixture.roots.at(-1)?.querySelector('.status')?.textContent.includes('준비됨')`);
  await textEval('parallelFixture.delay=2000'); await clickText('번역 시작');
  await textUntil('parallelFixture.calls.length===12'); await clickText('취소');
  await textUntil('!parallelFixture.active'); await pause(300);
  textResult.cancelled = await textEval('new Set(parallelFixture.cancelled).size');
  textResult.ignoredLate = await textEval(`[...document.querySelectorAll('main p')].every((p,i)=>p.textContent==='phrase-'+i) && parallelFixture.calls.length===12`);
  result.text = textResult;
  result.ok &&= textResult.peak===5&&textResult.count===7&&textResult.uniqueJobs===7&&textResult.restMs>=4990&&textResult.translated&&textResult.restored&&textResult.toggled&&textResult.cancelled===5&&textResult.ignoredLate;
  const videoTarget = await cdp('Target.createTarget', { url: 'chrome-extension://' + loaded.id + '/video-retry.html' });
  const videoSession = (await cdp('Target.attachToTarget', { targetId: videoTarget.targetId, flatten: true })).sessionId;
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, videoSession);
  const videoEval = async expression => {
    const read = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, videoSession);
    if (read.exceptionDetails) throw Error('VIDEO_EVALUATION_FAILED: ' + JSON.stringify(read.exceptionDetails)); return read.result?.value;
  };
  const videoUntil = async expression => { for (let i = 0; i < 350; i++) { if (await videoEval(expression)) return; await pause(100); } throw Error('VIDEO_WAIT_FAILED: ' + expression); };
  const videoClick = async label => {
    const point = await videoEval(`(()=>{const b=[...videoRetryFixture.roots.at(-1).querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, videoSession);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, videoSession);
  };
  const readyVideo = async () => {
    await videoUntil('globalThis.videoRetryFixture?.ready'); await videoEval('videoRetryFixture.open()');
    await videoUntil(`videoRetryFixture.roots.at(-1)?.querySelector('select')?.options.length===1`); await videoClick('번역 OFF');
  };
  await readyVideo();
  await videoUntil(`videoRetryFixture.roots.at(-1)?.querySelector('[role=status]')?.textContent.includes('64구간 오류')`);
  await videoUntil(`videoRetryFixture.roots.at(-1)?.querySelector('.caption')?.textContent.includes('[번역 오류]')`);
  const videoResult = await videoEval(`({calls:videoRetryFixture.calls,on:[...videoRetryFixture.roots.at(-1).querySelectorAll('button')].some(b=>b.textContent==='번역 ON'),logs:videoRetryFixture.roots.at(-1).querySelectorAll('ol li').length,caption:videoRetryFixture.roots.at(-1).querySelector('.caption').textContent,logText:videoRetryFixture.roots.at(-1).querySelector('ol').textContent})`);
  videoResult.cache = await videoEval('videoRetryFixture.summary()');
  await videoEval('videoRetryFixture.fail=false'); await videoClick('실패 구간 재시도');
  await videoUntil(`videoRetryFixture.roots.at(-1)?.querySelector('[role=status]')?.textContent.includes('128/128')`);
  videoResult.recoveredCalls = await videoEval('videoRetryFixture.calls');
  const videoShot = await cdp('Page.captureScreenshot', { format: 'png' }, videoSession); await writeFile(path.join(run, 'video-retry.png'), Buffer.from(videoShot.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false }, videoSession); await pause(200);
  videoResult.narrowFits = await videoEval(`document.documentElement.scrollWidth<=innerWidth && videoRetryFixture.roots.at(-1).querySelector('.panel').getBoundingClientRect().right<=innerWidth`);
  const narrowShot = await cdp('Page.captureScreenshot', { format: 'png' }, videoSession); await writeFile(path.join(run, 'video-retry-360.png'), Buffer.from(narrowShot.data, 'base64'));
  await cdp('Page.reload', {}, videoSession); await readyVideo();
  await videoUntil(`videoRetryFixture.roots.at(-1)?.querySelector('[role=status]')?.textContent.includes('128/128')`);
  videoResult.revisitCalls = await videoEval('videoRetryFixture.calls');
  result.video = videoResult;
  result.ok &&= videoResult.calls===5&&videoResult.on&&videoResult.logs===4&&videoResult.caption.includes('[번역 오류]')&&!videoResult.logText.includes('not JSON')&&videoResult.cache.videos===1&&videoResult.recoveredCalls===6&&videoResult.revisitCalls===6&&videoResult.narrowFits;
  console.log(JSON.stringify({browser:version.Browser,result},null,2));
  await writeFile(path.join(run,'result.json'),JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
  console.log('Artifact: '+path.join(run,'result.json'));
  await cdp('Browser.close').catch(()=>{});
} finally { socket?.close(); child.kill(); }
