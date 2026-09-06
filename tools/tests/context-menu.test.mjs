import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSelectionMenu, SELECTION_MENU, IMAGE_MENU } from '../../src/extension/context-menu.mjs';
import { AppError } from '../../src/extension/contract.mjs';

function fixture(failure) {
  const events = {}, created = [], opened = [], memory = {}; let optionsOpened = 0;
  const chrome = { runtime: { onInstalled: { addListener: fn => { events.install = fn; } },
    onStartup: { addListener: fn => { events.start = fn; } }, openOptionsPage: async () => { optionsOpened++; } },
    contextMenus: { removeAll: callback => callback(), create: (data, callback) => { created.push(data); callback(); },
      onClicked: { addListener: fn => { events.click = fn; } } },
    storage: { session: { setAccessLevel: async () => {}, set: async value => Object.assign(memory, value) } } };
  const open = async (info, tab) => { if (failure) throw failure; opened.push({ info, tab }); };
  registerSelectionMenu(chrome, { openSelection: open, openImage: open });
  return { events, created, opened, memory, optionsOpened: () => optionsOpened, chrome };
}
test('selection-only HTTP(S) menu is installed using compatible callbacks', () => {
  const f = fixture(); f.events.install(); f.events.start();
  assert.equal(f.created.length, 4);
  assert.deepEqual(f.created[0], { id: SELECTION_MENU, title: '선택한 텍스트 번역', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  assert.deepEqual(f.created[1], { id: IMAGE_MENU, title: '이미지 번역', contexts: ['image'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
});

test('image menu dispatches the browser image and clicked tab', async () => {
  const f = fixture(), info = { menuItemId: IMAGE_MENU, mediaType: 'image', srcUrl: 'https://example.invalid/image.png' }, tab = { id: 12 };
  f.events.click(info, tab); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.opened, [{ info, tab }]); assert.deepEqual(f.memory, {});
});
test('menu handler uses clicked tab and snapshot, not currently active tab', async () => {
  const f = fixture(); const info = { menuItemId: SELECTION_MENU, selectionText: 'Selected words', frameId: 0 }, tab = { id: 12 };
  f.events.click({ ...info, menuItemId: 'foreign-menu' }, tab); f.events.click(info, tab);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.opened, [{ info, tab }]);
});
test('menu failures expose only safe codes in settings and never save selection', async () => {
  for (const failure of [new AppError('CONSENT_REQUIRED'), Error('PRIVATE_SELECTED_TEXT')]) {
    const f = fixture(failure);
    f.events.click({ menuItemId: SELECTION_MENU, selectionText: 'PRIVATE_SELECTED_TEXT' }, { id: 12 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.optionsOpened(), 1); assert.ok(!JSON.stringify(f.memory).includes('PRIVATE'));
    assert.equal(f.memory.uiNotice, failure instanceof AppError ? 'CONSENT_REQUIRED' : 'WORKER_INTERRUPTED');
  }
});
