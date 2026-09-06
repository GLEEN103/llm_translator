import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../../src/extension/youtube-dom.js', import.meta.url), 'utf8');
test('Shorts surface skips hidden/preloaded players and follows active video replacement', () => {
  const make = (top, hidden = false) => {
    const video = { getClientRects: () => hidden ? [] : [1], getBoundingClientRect: () => ({ left: 0, top, right: 300, bottom: top + 600 }) };
    return { querySelector: () => video, closest: () => null };
  };
  const hidden = make(0, true), offscreen = make(1200), active = make(0), next = make(0);
  let players = [hidden, offscreen, active];
  const context = vm.createContext({ URL, location: { pathname: '/shorts/abcdefghijk', href: 'https://www.youtube.com/shorts/abcdefghijk' }, innerWidth: 1000, innerHeight: 700,
    document: { querySelectorAll: () => players } });
  vm.runInContext(code, context); const api = context.TranslatorYouTubeDOM;
  assert.equal(api.videoId(), 'abcdefghijk'); assert.equal(api.surface().player, active);
  players = [hidden, offscreen, next]; assert.equal(api.surface().player, next);
  players = [hidden, offscreen]; assert.equal(api.surface(), null);
  assert.equal(api.videoId('https://www.youtube.com/shorts/abcdefghijk/extra'), null);
});

test('same-video startup gaps, replacement and zero size wait instead of ending the panel', () => {
  let time = 0, current;
  const location = { pathname: '/watch', href: 'https://www.youtube.com/watch?v=abcdefghijk' };
  const make = () => {
    const rect = { left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450 };
    const video = { isConnected: true, getClientRects: () => [1], getBoundingClientRect: () => rect };
    const player = { isConnected: true, closest: () => null, querySelector: () => video };
    return { rect, video, player };
  };
  const context = vm.createContext({ URL, location, innerWidth: 1000, innerHeight: 700,
    document: { getElementById: () => current?.player } });
  vm.runInContext(code, context);
  const binding = context.TranslatorYouTubeDOM.createBinding('abcdefghijk', { now: () => time });
  assert.deepEqual({ ...binding.poll() }, { ended: false, ready: false });
  current = make(); assert.equal(binding.poll().ready, false);
  time = 199; assert.equal(binding.poll().ready, false); time = 200; assert.equal(binding.poll().ready, true);
  const old = current; current = undefined;
  assert.equal(binding.poll().ended, false); assert.equal(binding.poll().ready, false);
  current = make(); assert.equal(binding.poll().ready, false); time += 200;
  assert.equal(binding.poll().video, current.video); assert.notEqual(binding.poll().video, old.video); assert.equal(binding.poll().ready, true);
  current.rect.width = 0; assert.equal(binding.poll().ready, false); assert.equal(binding.poll().ended, false);
  current.rect.width = 800; assert.equal(binding.poll().ready, false); time += 200; assert.equal(binding.poll().ready, true);
  location.href = 'https://www.youtube.com/watch?v=other_video'; assert.equal(binding.poll().ended, true);
});
