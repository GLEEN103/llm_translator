import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import '../../src/extension/core.js';
import '../../src/extension/video-core.js';
import { youtubeId, readYouTubePage, loadYouTubeCaptions } from '../../src/extension/youtube-captions.mjs';
const V = globalThis.TranslatorVideoCore, Core = globalThis.TranslatorCore;
const event = (start, duration, text, extra = {}) => ({ tStartMs: start, dDurationMs: duration, segs: [{ utf8: text }], ...extra });
const id = 'abcdefghijk';

test('manual caption timing, overlap, exact boundaries and gaps stay on device', () => {
  const cues = V.parse({ events: [event(1000, 3000, 'one'), event(2000, 3000, 'two'), event(6000, 1000, 'three')] });
  const ends = V.index(cues), at = t => V.active(cues, ends, t).map(c => c.text);
  assert.deepEqual(at(0), []); assert.deepEqual(at(1), ['one']); assert.deepEqual(at(2), ['one', 'two']);
  assert.deepEqual(at(4), ['two']); assert.deepEqual(at(5), []); assert.deepEqual(at(7), []);
  // Seeking backward / changing playback rate uses media time, never elapsed wall time.
  assert.deepEqual(at(6), ['three']); assert.deepEqual(at(1), ['one']); assert.deepEqual(at(NaN), []);
});
test('automatic rolling windows merge append text and replace prior window timing', () => {
  const cues = V.parse({ events: [{ wWinId: 1 }, event(0, 5000, 'Hello', { wWinId: 1 }),
    event(1000, undefined, 'world', { aAppend: 1, wWinId: 1 }), event(3000, 2000, 'Next', { wWinId: 1 }), event(5000, 1000, '\n')] });
  assert.deepEqual(cues.map(c => [c.start, c.end, c.text]), [[0, 3, 'Hello world'], [3, 5, 'Next']]);
});
test('malformed captions and capacity breaches fail closed', () => {
  for (const events of [[event(-1, 1000, 'x')], [event(0, -1, 'x')], [event('0', 1000, 'x')],
    [event(0, undefined, 'x')], [event(0, Infinity, 'x')], [{ segs: [null] }], [event(86400000, 1, 'x')]]) {
    assert.throws(() => V.parse({ events }), { code: 'CAPTIONS_INVALID' });
  }
  assert.throws(() => V.parse({ events: [] }), { code: 'CAPTIONS_EMPTY' });
  assert.throws(() => V.parse({ events: Array(5001).fill(event(0, 100, 'x')) }), { code: 'CAPTIONS_TOO_LARGE' });
  assert.throws(() => V.parse({ events: [event(0, 100, 'x'.repeat(100001))] }), { code: 'CAPTIONS_TOO_LARGE' });
});
test('batched caption requests deduplicate repeated text, split long cues and prioritize seek position', () => {
  const prepared = V.prepare(V.parse({ events: Array.from({ length: 80 }, (_, i) => event(i * 1000, 900, `line ${i}`)).concat([
    event(81000, 1000, 'line 0'), event(82000, 1000, 'long '.repeat(1000))]) }), Core);
  assert.equal(prepared.cues[0].parts[0], prepared.cues[80].parts[0]);
  assert.ok(prepared.cues[81].parts.length > 1);
  const batch = V.nextBatch(prepared.cues, prepared.segments, new Map(), 50, Core);
  assert.equal(batch[0].text, 'line 50'); assert.ok(batch.length <= 64);
  assert.ok(batch.reduce((n, s) => n + s.text.length, 0) <= 12000);
  assert.ok(batch.every(s => Object.keys(s).join() === 'id,text'));
  assert.deepEqual(V.nextBatch(prepared.cues, prepared.segments, new Map(prepared.segments.map(s => [s.id, 'done'])), 0, Core), []);
});
test('YouTube URL allowlist allows watch and Shorts, excludes other pages, insecure and lookalike origins', () => {
  assert.equal(youtubeId(`https://www.youtube.com/watch?v=${id}&t=4`), id);
  assert.equal(youtubeId(`https://www.youtube.com/shorts/${id}?feature=share`), id);
  assert.equal(youtubeId(`https://www.youtube.com/shorts/${id}/`), id);
  for (const value of [`https://www.youtube.com.evil.invalid/watch?v=${id}`, `http://www.youtube.com/watch?v=${id}`, `https://www.youtube.com/shorts/${id}/extra`, `https://user@www.youtube.com/shorts/${id}`, `https://youtube.com/watch?v=${id}`, 'invalid']) assert.equal(youtubeId(value), null);
});
function page({ baseUrl = `https://www.youtube.com/api/timedtext?v=${id}&lang=en`, responseBody = JSON.stringify({ events: [event(0, 1000, 'hello')] }), ad = false, live = false, status = 200 } = {}) {
  const calls = [], details = { videoId: id, isLive: live };
  const response = { videoDetails: details, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl, languageCode: 'en', name: { simpleText: 'English' }, kind: 'asr' }] } } };
  const location = { href: `https://www.youtube.com/watch?v=${id}` };
  const player = { classList: { contains: () => ad }, getPlayerResponse: () => response };
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, TextDecoder, location,
    document: { getElementById: () => player, querySelectorAll: () => [player] }, innerWidth: 1000, innerHeight: 1000,
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(responseBody, { status }); } });
  const read = vm.runInContext(`(${readYouTubePage.toString()})`, context);
  return { read, calls, location, details, response, player };
}
test('MAIN bridge lists manual/automatic metadata without any caption URL or secrets', async () => {
  const f = page(); const result = await f.read(id);
  assert.equal(result.tracks[0].automatic, true); assert.equal(result.tracks[0].label, 'English');
  assert.equal(f.calls.length, 0); assert.ok(!JSON.stringify(result).includes('baseUrl'));
});

test('Shorts MAIN bridge uses the visible player and rejects recycled video metadata', async () => {
  const f = page(); f.location.href = `https://www.youtube.com/shorts/${id}`;
  f.player.querySelector = () => ({ getClientRects: () => [1], getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 600 }) });
  assert.equal((await f.read(id)).tracks[0].label, 'English');
  assert.equal((await f.read(id, 0)).videoId, id);
  f.details.videoId = 'other_video';
  assert.equal((await f.read(id, 0)).error, 'VIDEO_CHANGED');
  f.details.videoId = id; f.player.querySelector = () => ({ getClientRects: () => [] });
  assert.equal((await f.read(id)).error, 'VIDEO_CHANGED');
});
test('MAIN bridge requests only same-origin timedtext and forces original-language JSON3', async () => {
  const f = page({ baseUrl: `https://www.youtube.com/api/timedtext?v=${id}&lang=en&tlang=ja` });
  const result = await f.read(id, 0); assert.equal(result.videoId, id);
  assert.ok(f.calls[0].url.includes('fmt=json3')); assert.ok(!f.calls[0].url.includes('tlang'));
  assert.equal(f.calls[0].options.redirect, 'error'); assert.equal(f.calls[0].options.credentials, 'same-origin');
  assert.equal(f.calls[0].options.headers, undefined);
});
test('MAIN bridge rejects arbitrary URLs, video switches, live streams, ads and unavailable responses', async () => {
  for (const baseUrl of ['https://evil.invalid/api/timedtext', `https://www.youtube.com/watch?v=${id}`, 'https://www.youtube.com/api/timedtext?v=other_video', `https://user:password@www.youtube.com/api/timedtext?v=${id}`]) {
    const f = page({ baseUrl }); assert.equal((await f.read(id, 0)).error, 'CAPTIONS_INVALID'); assert.equal(f.calls.length, 0);
  }
  assert.equal((await page({ ad: true }).read(id)).error, 'VIDEO_AD');
  assert.equal((await page({ live: true }).read(id)).error, 'VIDEO_LIVE');
  assert.equal((await page({ responseBody: '' }).read(id, 0)).error, 'CAPTIONS_DIRECT_EMPTY');
  assert.equal((await page({ status: 403 }).read(id, 0)).error, 'CAPTIONS_UNAVAILABLE');
  assert.equal((await page({ responseBody: 'x'.repeat(2097153) }).read(id, 0)).error, 'CAPTIONS_TOO_LARGE');
  const f = page(); f.location.href = 'https://www.youtube.com/watch?v=other_video'; assert.equal((await f.read(id)).error, 'VIDEO_CHANGED');
});
test('trusted bridge pins document, strips extra metadata, validates payload and sanitizes page errors', async () => {
  let scripted;
  const base = { tabId: 7, documentId: 'doc-7', videoId: id };
  const chrome = { scripting: { executeScript: async args => { scripted = args; return [{ documentId: 'doc-7', result: {
    videoId: id, tracks: [{ index: 0, label: 'English', language: 'en', automatic: true, secretUrl: 'SHOULD_NOT_LEAK' }] } }]; } } };
  const result = await loadYouTubeCaptions({ chrome, ...base });
  assert.equal(scripted.world, 'MAIN'); assert.deepEqual(scripted.target, { tabId: 7, documentIds: ['doc-7'] });
  assert.deepEqual(scripted.args, [id, null]); assert.ok(!JSON.stringify(result).includes('SHOULD'));
  chrome.scripting.executeScript = async () => [{ documentId: 'doc-7', result: { error: 'PRIVATE_ERROR' } }];
  await assert.rejects(loadYouTubeCaptions({ chrome, ...base }), { code: 'CAPTIONS_UNAVAILABLE' });
  chrome.scripting.executeScript = async () => [{ documentId: 'old', result: { videoId: id } }];
  await assert.rejects(loadYouTubeCaptions({ chrome, ...base }), { code: 'VIDEO_CHANGED' });
  chrome.scripting.executeScript = async () => [{ documentId: 'doc-7', result: { videoId: id, raw: '{invalid' } }];
  await assert.rejects(loadYouTubeCaptions({ chrome, ...base, trackIndex: 0 }), { code: 'CAPTIONS_INVALID' });
});

test('empty direct caption responses fall back to native player, keeping raw metadata private', async () => {
  const calls = [];
  const chrome = { scripting: { executeScript: async args => {
    calls.push(args);
    return [{ documentId: 'doc-7', result: calls.length === 1 ? { error: 'CAPTIONS_DIRECT_EMPTY' } : {
      videoId: id, raw: JSON.stringify({ events: [event(0, 1000, 'Recovered caption')] }), source: 'player', playerTrackChanged: true, url: 'DO_NOT_RETURN' } }];
  } } };
  const result = await loadYouTubeCaptions({ chrome, tabId: 7, documentId: 'doc-7', videoId: id, trackIndex: 0 });
  assert.equal(calls.length, 2); assert.equal(calls[1].func.name, 'readYouTubePlayerCaptions');
  assert.deepEqual(calls[1].target, { tabId: 7, documentIds: ['doc-7'] }); assert.deepEqual(calls[1].args, [id, 0]);
  assert.equal(result.cues[0].text, 'Recovered caption'); assert.equal(result.playerTrackChanged, true);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_RETURN'));
});

test('bridge failures and native player timeouts remain actionable without exposing page errors', async () => {
  const params = { tabId: 7, documentId: 'doc-7', videoId: id, trackIndex: 0 };
  let calls = 0;
  const chrome = { scripting: { executeScript: async () => { calls++; return [{ documentId: 'doc-7', result: { error: calls === 1 ? 'CAPTIONS_DIRECT_EMPTY' : 'CAPTIONS_PLAYER_TIMEOUT' } }]; } } };
  await assert.rejects(loadYouTubeCaptions({ chrome, ...params }), { code: 'CAPTIONS_PLAYER_TIMEOUT' });
  chrome.scripting.executeScript = async () => { throw new Error('PRIVATE_STACK'); };
  await assert.rejects(loadYouTubeCaptions({ chrome, ...params }), { code: 'CAPTIONS_BRIDGE_FAILED' });
  chrome.scripting.executeScript = async () => [{ documentId: 'old-doc', result: { error: 'CAPTIONS_DIRECT_EMPTY' } }];
  await assert.rejects(loadYouTubeCaptions({ chrome, ...params }), { code: 'VIDEO_CHANGED' });
});
