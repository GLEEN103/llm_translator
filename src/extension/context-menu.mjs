import { AppError } from './contract.mjs';
export const SELECTION_MENU = 'translate-selected-text';
export const IMAGE_MENU = 'translate-image';
export function registerSelectionMenu(chrome, broker) {
  const showError = async error => {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.set({ uiNotice: error instanceof AppError ? error.code : 'WORKER_INTERRUPTED' });
    await chrome.runtime.openOptionsPage();
  };
  const install = () => {
    // Callbacks retain compatibility with Chrome 112 (Promise API starts later).
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) { void showError(new AppError('CONTEXT_MENU_FAILED')).catch(() => {}); return; }
      chrome.contextMenus.create({ id: SELECTION_MENU, title: '선택한 텍스트 번역', contexts: ['selection'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => {
        if (chrome.runtime.lastError) void showError(new AppError('CONTEXT_MENU_FAILED')).catch(() => {});
      });
      chrome.contextMenus.create({ id: IMAGE_MENU, title: '이미지 번역', contexts: ['image'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => {
        if (chrome.runtime.lastError) void showError(new AppError('CONTEXT_MENU_FAILED')).catch(() => {});
      });
    });
  };
  chrome.runtime.onInstalled.addListener(install);
  chrome.runtime.onStartup.addListener(install);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const run = info.menuItemId === SELECTION_MENU ? broker.openSelection : info.menuItemId === IMAGE_MENU ? broker.openImage : null;
    if (run) void run(info, tab).catch(error => showError(error).catch(() => {}));
  });
}
