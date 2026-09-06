import { createBroker } from './broker.mjs';
import { AppError } from './contract.mjs';
import { registerSelectionMenu } from './context-menu.mjs';
import { createKieTransport } from './kie-transport.mjs';
import { createOpenAITransport } from './openai-transport.mjs';
const broker = createBroker({ chrome, kieFetchImpl: createKieTransport(chrome), openaiFetchImpl: createOpenAITransport(chrome) });
registerSelectionMenu(chrome, broker);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  broker.handle(message, sender).then(data => sendResponse({ ok: true, data }), error => {
    sendResponse({ ok: false, error: error instanceof AppError ? error.code : 'WORKER_INTERRUPTED' });
  });
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { void broker.forget(tabId, true).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' || info.url) void broker.forget(tabId).catch(() => {});
});
