// Isolated Chrome integration: only fixture keys/data, no user's browser profile or provider calls.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const delayMs = Number(process.argv[3] ?? 0);
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw Error('Invalid fixture delay');
const run = path.join(root, 'tools/.tmp', `kie-smoke-${Date.now()}`), extension = path.join(run, 'extension'), profile = path.join(run, 'profile');
await mkdir(extension, { recursive: true }); await mkdir(profile);
const files = ['kie-transport.mjs', 'kie-offscreen-host.mjs', 'kie-offscreen.mjs', 'kie-offscreen.html', 'kie-worker.mjs', 'kie.mjs', 'kie-models.mjs', 'contract.mjs', 'google.mjs', 'image-contract.mjs', 'usage.mjs', 'model-releases.mjs'];
for (const file of files) await copyFile(path.join(root, 'src/extension', file), path.join(extension, file));
const manifest = JSON.parse(await readFile(path.join(root, 'src/extension/manifest.json'), 'utf8'));
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Kie isolated smoke', version: '1.0', minimum_chrome_version: manifest.minimum_chrome_version,
  permissions: ['offscreen'], host_permissions: ['https://api.kie.ai/*'], background: { service_worker: 'smoke.mjs', type: 'module' }, content_security_policy: manifest.content_security_policy }));
// Real dedicated worker/module loading, but the network boundary is always fake.
const worker = await readFile(path.join(extension, 'kie-worker.mjs'), 'utf8');
await writeFile(path.join(extension, 'kie-worker.mjs'), `globalThis.fetch = async (_url, options) => {
  const input = JSON.parse(JSON.parse(options.body).messages[1].content[0].text);
  if(input.segments[0].text==='slow') await new Promise(resolve=>setTimeout(resolve,${delayMs}));
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: input.segments.map(s => ({ id:s.id, text:'fixture translated' })) }) } }], usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5} });
};\n` + worker);
await writeFile(path.join(extension, 'smoke.mjs'), `import { createKieTransport } from './kie-transport.mjs';
import { createKieProvider } from './kie.mjs';
globalThis.trace = [];
const onConnect = chrome.runtime.onConnect.addListener.bind(chrome.runtime.onConnect);
chrome.runtime.onConnect.addListener = listener => onConnect(port => {
  trace.push({event:'connect',name:port.name,sender:port.sender});
  port.onDisconnect.addListener(() => trace.push({event:'disconnect',error:chrome.runtime.lastError?.message}));
  listener(port);
});
const fetchImpl = createKieTransport(chrome);
globalThis.runSmoke = async (text='hello') => {
  try { const result = await createKieProvider({apiKey:'DUMMY_KEY',model:'gemini-3-8-flash-openai',fetchImpl})({jobId:'fixture',sourceLanguage:'en',targetLanguage:'ko',chars:text.length,segments:[{id:'s1',text}]});
    await new Promise(resolve=>setTimeout(resolve,100));
    return {ok:true,count:result.translations.length,trace,remaining:(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length};
  } catch (e) { return {ok:false,code:e.code,trace,contexts:await chrome.runtime.getContexts({})}; }
};
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{ if(message.type!=='SMOKE')return;runSmoke(message.text).then(reply);return true; });`);
await writeFile(path.join(extension,'smoke.html'),'<!doctype html><html><body><pre id="result">running</pre><script type="module" src="smoke-page.mjs"></script></body></html>');
await writeFile(path.join(extension,'smoke-page.mjs'),`const results=[];
try { for(const text of ['hello','slow','again']) { const began=performance.now(); const result=await chrome.runtime.sendMessage({type:'SMOKE',text}); results.push({...result,elapsedMs:Math.round(performance.now()-began)}); if(!result.ok)break; }
document.getElementById('result').textContent=JSON.stringify({ok:results.length===3&&results.every(r=>r.ok&&r.remaining===0),results}); }
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
  console.log(JSON.stringify({browser:version.Browser,result},null,2));
  await writeFile(path.join(run,'result.json'),JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
  console.log('Artifact: '+path.join(run,'result.json'));
  await cdp('Browser.close').catch(()=>{});
} finally { socket?.close(); child.kill(); }
