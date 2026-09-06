import { readYouTubePlayerCaptions } from '/youtube-player-captions.mjs';
import '/video-core.js';
const results = document.getElementById('results'), lines = [];
const id = '-SRYHQyg-58', url = `https://www.youtube.com/api/timedtext?v=${id}&lang=en&kind=asr`;
async function run(raw) {
  class XHR extends EventTarget {
    open() { this.status = 200; this.responseURL = url; this.responseType = 'text'; }
    send() { this.responseText = raw; setTimeout(() => this.dispatchEvent(new Event('loadend')), 0); }
  }
  let selected = {};
  const fake = { XMLHttpRequest: XHR, fetch: async () => { throw new Error('No external requests'); } };
  const old = { open: XHR.prototype.open, send: XHR.prototype.send, fetch: fake.fetch };
  const player = { classList: { contains: () => false }, getPlayerResponse: () => ({ videoDetails: { videoId: id }, captions: {
    playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: url, languageCode: 'en', kind: 'asr' }] } } }),
    getOption: () => selected, setOption: (_module, key, value) => {
      if (key === 'track') selected = value;
      if (key === 'reload') { const xhr = new fake.XMLHttpRequest(); xhr.open('GET', url); xhr.send(); }
    } };
  // Test-only scope isolates globals; the product function is otherwise unchanged.
  const scoped = new Function('globalThis', 'location', 'document', `return (${readYouTubePlayerCaptions.toString()})`)(fake,
    { href: `https://www.youtube.com/watch?v=${id}` }, { getElementById: () => player });
  const data = await scoped(id, 0);
  if (XHR.prototype.open !== old.open || XHR.prototype.send !== old.send || fake.fetch !== old.fetch) throw new Error('hooks not cleaned');
  return data.error ? data : { ...data, cues: globalThis.TranslatorVideoCore.parse(JSON.parse(data.raw)) };
}
async function check(name, fn) { try { if (!await fn()) throw new Error('assertion'); lines.push(`PASS: ${name}`); } catch (error) { lines.push(`FAIL: ${name} (${error.message})`); } results.textContent = lines.join('\n'); }
await check('srv3 XML / nested words / exact millisecond timing', async () => {
  const data = await run('<timedtext format="3"><body><p t="1200" d="2400" w="1"><s>Hello</s><s> &amp; welcome</s></p></body></timedtext>');
  return data.cues?.[0].start === 1.2 && Math.abs(data.cues[0].end - 3.6) < 1e-9 && data.cues[0].text === 'Hello & welcome';
});
await check('legacy XML / decimal seconds / entity decoding', async () => {
  const data = await run('<transcript><text start="1.25" dur="2.5">Hello &lt;b&gt;literal&lt;/b&gt;</text></transcript>');
  return data.cues?.[0].start === 1.25 && data.cues[0].end === 3.75 && data.cues[0].text === 'Hello <b>literal</b>';
});
await check('srv3 append without duration and empty control events', async () => {
  const data = await run('<timedtext><body><p t="0" d="4000" w="1">Hello</p><p t="1000" w="1" a="1">world</p><p t="4000" w="1"> </p></body></timedtext>');
  return data.cues?.[0].text === 'Hello world' && data.cues[0].end === 4;
});
await check('malformed XML rejected', async () => (await run('<timedtext><body><p t="1" d="2">broken</body>')).error === 'CAPTIONS_INVALID');
await check('DTD / entity declarations rejected before parsing', async () => (await run('<!DOCTYPE transcript [<!ENTITY secret "data">]><transcript/>')).error === 'CAPTIONS_INVALID');
await check('HTML error response never treated as captions', async () => (await run('<html><body>Denied</body></html>')).error === 'CAPTIONS_INVALID');
await check('missing non-append timing rejected', async () => (await run('<transcript><text start="1">missing duration</text></transcript>')).error === 'CAPTIONS_INVALID');
await check('JSON3 native response validated with existing timing parser', async () => {
  const data = await run(JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'JSON caption' }] }] }));
  return data.cues?.[0].text === 'JSON caption';
});
results.textContent += `\n${lines.filter(s => s.startsWith('PASS')).length}/${lines.length} passed.`;
