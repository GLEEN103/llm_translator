import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readYouTubePlayerCaptions } from '../../src/extension/youtube-player-captions.mjs';
const id = '-SRYHQyg-58', url = `https://www.youtube.com/api/timedtext?v=${id}&lang=en&kind=asr&variant=source&fmt=json3`;
const body = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Public dummy caption' }] }] });
function setup({ transport = 'xhr', payload = body, requestUrl = url, never = false, userChanges = false, oversize = false,
  cold = false, delayed = false, stalled = false, mutable = false, emptyFirst = false } = {}) {
  let selected = cold ? {} : { languageCode: 'ja', kind: 'asr', vssId: 'a.ja' }, trigger = 0, loaded = !cold, unloads = 0, premature = 0;
  const restoredTrack = { ...selected }, activeTimers = new Set(), instances = [];
  class XHR extends EventTarget {
    open(method, value) { this.responseURL = value; this.status = 200; this.responseType = ''; }
    send() { instances.push(this); const empty = emptyFirst && unloads === 0; setTimeout(() => { this.responseText = empty ? '{"events":[]}' : payload; this.dispatchEvent(new Event('loadend')); }, 5); }
  }
  const originalOpen = XHR.prototype.open, originalSend = XHR.prototype.send;
  const nativeFetch = async request => {
    const response = new Response(payload, { headers: oversize ? { 'content-length': '2097153' } : {} });
    Object.defineProperty(response, 'url', { value: request }); return response;
  };
  const player = { classList: { contains: () => false }, getPlayerResponse: () => ({ videoDetails: { videoId: id }, captions: {
    playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: url, languageCode: 'en', kind: 'asr', vssId: 'a.en' }] } } }),
    getOption: () => selected, getOptions: () => loaded ? ['captions'] : [],
    loadModule: () => { loaded = true; }, unloadModule: () => { loaded = false; selected = {}; unloads++; },
    setOption: (_module, option, value) => {
      if (option === 'track') {
        const apply = () => { if (mutable) { for (const key of Object.keys(selected)) delete selected[key]; Object.assign(selected, value); } else selected = value; };
        if (delayed && value.languageCode === 'en') setTimeout(apply, 5); else apply();
      }
      if (option === 'reload') {
        trigger++;
        if (selected.languageCode !== 'en') { premature++; return; }
        if (userChanges) selected = { languageCode: 'de' };
        if (never || (stalled && !unloads)) return;
        if (transport === 'xhr') { const xhr = new context.XMLHttpRequest(); xhr.open('GET', requestUrl); xhr.send(); }
        else void context.fetch(requestUrl);
      }
    } };
  const context = vm.createContext({ URL, TextEncoder, TextDecoder, XMLHttpRequest: XHR, fetch: nativeFetch, Reflect,
    setTimeout: (fn, ms) => { const timer = setTimeout(() => { activeTimers.delete(timer); fn(); }, ms === 12000 ? 80 : ms === 4000 ? 30 : ms === 250 ? 0 : ms); activeTimers.add(timer); return timer; },
    clearTimeout: timer => { activeTimers.delete(timer); clearTimeout(timer); }, setInterval, clearInterval,
    location: { href: `https://www.youtube.com/watch?v=${id}` }, document: { getElementById: () => player } });
  const run = () => vm.runInContext(`(${readYouTubePlayerCaptions.toString()})`, context)(id, 0);
  const clean = () => { assert.equal(context.fetch, nativeFetch); assert.equal(XHR.prototype.open, originalOpen); assert.equal(XHR.prototype.send, originalSend); assert.equal(activeTimers.size, 0); };
  return { run, clean, context, player, restoredTrack, selected: () => selected, trigger: () => trigger, instances,
    unloads: () => unloads, loaded: () => loaded, premature: () => premature, allowResponses: () => { never = false; } };
}
test('native XHR captures only selected captions, restores hooks and prior track', async () => {
  const f = setup(); const result = await f.run();
  assert.equal(result.raw, body); assert.equal(result.source, 'player'); assert.equal(result.playerTrackChanged, false);
  assert.deepEqual({ ...f.selected() }, f.restoredTrack); assert.equal(f.trigger(), 1); f.clean();
  assert.ok(!JSON.stringify(result).includes('/api/timedtext'));
});

test('Shorts native fallback supports OFF startup and refuses recycled player metadata', async () => {
  const f = setup({ cold: true }); f.context.location.href = `https://www.youtube.com/shorts/${id}`;
  f.context.innerWidth = 1000; f.context.innerHeight = 1000;
  f.context.document.querySelectorAll = () => [f.player];
  f.player.querySelector = selector => selector === 'video' ? { getClientRects: () => [1], getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 600 }) } : null;
  assert.equal((await f.run()).raw, body); assert.equal(f.loaded(), false); f.clean();
  f.player.getPlayerResponse = () => ({ videoDetails: { videoId: 'other_video' } });
  assert.equal((await f.run()).error, 'VIDEO_CHANGED'); f.clean();
});
test('native fetch clone captures bounded captions without consuming the player response', async () => {
  const f = setup({ transport: 'fetch' }); const result = await f.run();
  assert.equal(result.raw, body); f.clean();
  const original = await f.context.fetch(url); assert.equal(await original.text(), body);
});
test('native observation refuses translated, different-language, variant and foreign-video responses', async () => {
  for (const requestUrl of [url.replace('lang=en', 'lang=ko'), `${url}&tlang=ko`, url.replace('variant=source', 'variant=other'), url.replace(id, 'other_video'), url.replace('www.youtube.com', 'evil.invalid')]) {
    const f = setup({ requestUrl }); assert.equal((await f.run()).error, 'CAPTIONS_PLAYER_TIMEOUT'); f.clean();
  }
});
test('native observation cleans up on timeout, oversize and navigation', async () => {
  const f = setup({ never: true }); assert.equal((await f.run()).error, 'CAPTIONS_PLAYER_TIMEOUT'); f.clean();
  const big = setup({ transport: 'fetch', oversize: true }); assert.equal((await big.run()).error, 'CAPTIONS_TOO_LARGE'); big.clean();
  const changed = setup(); changed.context.location.href = 'https://www.youtube.com/watch?v=other_video';
  assert.equal((await changed.run()).error, 'VIDEO_CHANGED'); changed.clean();
});
test('user caption changes are never overwritten during cleanup', async () => {
  const f = setup({ userChanges: true }); const result = await f.run();
  assert.equal(f.selected().languageCode, 'de'); assert.equal(result.playerTrackChanged, true); f.clean();
});
test('unsupported native APIs fail explicitly without installing network hooks', async () => {
  const f = setup(); delete f.player.setOption;
  assert.equal((await f.run()).error, 'CAPTIONS_PLAYER_UNAVAILABLE'); f.clean();
});

test('player teardown during observation still cleans up network hooks', async () => {
  const f = setup({ never: true });
  f.context.setInterval = fn => setInterval(fn, 5);
  const pending = f.run();
  f.player.getPlayerResponse = () => { throw Error('player disposed'); };
  assert.equal((await pending).error, 'VIDEO_CHANGED'); f.clean();
});

test('caption module readiness is polled before triggering a native reload', async () => {
  const f = setup(); let polls = 0;
  f.player.getOptions = () => ++polls < 3 ? [] : ['captions'];
  const result = await f.run(); assert.equal(result.raw, body); assert.equal(f.trigger(), 1); assert.ok(polls >= 3); f.clean();
});

test('captions initially OFF wait for asynchronous selection and restore OFF after success', async () => {
  const f = setup({ cold: true, delayed: true });
  const result = await f.run(); assert.equal(result.raw, body); assert.equal(result.playerTrackChanged, false);
  assert.equal(f.premature(), 0); assert.equal(f.loaded(), false); assert.equal(f.unloads(), 1); f.clean();
});

test('a stalled caption module is reinitialized once without reloading the video', async () => {
  const f = setup({ stalled: true }); const result = await f.run();
  assert.equal(result.raw, body); assert.equal(f.unloads(), 1); assert.equal(f.trigger(), 2);
  assert.deepEqual({ ...f.selected() }, f.restoredTrack); f.clean();
});

test('empty caption JSON does not end observation before recovery produces content', async () => {
  const f = setup({ emptyFirst: true }); assert.equal((await f.run()).raw, body);
  assert.equal(f.trigger(), 2); assert.equal(f.unloads(), 1); f.clean();
});

test('a failed OFF start can succeed on the same page later with clean observers', async () => {
  const f = setup({ cold: true, never: true }); assert.equal((await f.run()).error, 'CAPTIONS_PLAYER_TIMEOUT');
  assert.equal(f.loaded(), false); f.clean(); f.allowResponses();
  assert.equal((await f.run()).raw, body); assert.equal(f.loaded(), false); f.clean();
});

test('recovery does not reset a user-selected track while waiting for a response', async () => {
  const f = setup({ never: true, userChanges: true }); assert.equal((await f.run()).error, 'CAPTIONS_PLAYER_TIMEOUT');
  assert.equal(f.unloads(), 0); assert.equal(f.selected().languageCode, 'de'); f.clean();
});

test('mutating player track objects cannot corrupt the original track snapshot', async () => {
  const f = setup({ mutable: true }); assert.equal((await f.run()).raw, body);
  assert.deepEqual({ ...f.selected() }, f.restoredTrack); f.clean();
});
