import { AppError, LIMITS, validateRequest, validateTranslations } from './contract.mjs';
import { cacheScope, cachedEntries, mergeCache } from './page-cache.mjs';
import { createVideoCache } from './video-cache.mjs';
import { createGoogleProvider } from './google.mjs';
import { createOpenAIProvider } from './openai.mjs';
import { listOpenAIModels, openaiModel } from './openai-models.mjs';
import { createKieProvider } from './kie.mjs';
import { listKieModels, kieModel } from './kie-models.mjs';
import { createKiePriceService } from './kie-pricing.mjs';
import { createUsageStore } from './usage.mjs';
import { listGoogleModels } from './models.mjs';
import { createProfiles, validModel, validProvider } from './profiles.mjs';
import { validateImageRequest, IMAGE_LIMITS } from './image-contract.mjs';
import { captureImage } from './image-capture.mjs';
import { youtubeId, loadYouTubeCaptions } from './youtube-captions.mjs';
import './video-style.js';

// This module only runs in trusted extension contexts (or isolated tests).
export function createBroker({ chrome, fetchImpl = fetch, kieFetchImpl = fetchImpl, openaiFetchImpl = fetchImpl, now = Date.now, uuid = () => crypto.randomUUID(), captureImpl = captureImage, panelTimeoutMs = 8000 }) {
  const requests = new Map();
  const imageActions = new Map();
  const videoReads = new Set();
  const session = chrome.storage.session;
  const local = chrome.storage.local, version = chrome.runtime.getManifest().version;
  const ready = Promise.all([session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })])
    .then(() => session.remove(['connectionToken', 'providerSettings']))
    .catch(() => { throw new AppError('STORAGE_FAILED'); });
  const profiles = createProfiles(local, uuid);
  const usage = createUsageStore(local, { now, uuid });
  const videoCache = createVideoCache(local);
  const kiePrices = createKiePriceService({ fetchImpl, now });
  const usageHooks = (settings, kind) => ({
    onAttempt: () => usage.begin({ provider: settings.provider, model: settings.model, kind }),
    onUsage: (id, metadata) => usage.finish(id, metadata)
  });
  let modelRequest;
  let serial = Promise.resolve();
  const locked = task => {
    const work = serial.then(task);
    serial = work.catch(() => {});
    return work;
  };
  const read = async key => (await session.get(key))[key];
  async function panelStep(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AppError('PANEL_OPEN_TIMEOUT')), panelTimeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  const ownPage = (sender, file) => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL(file);
  const abortAll = () => { for (const record of requests.values()) record.controller.abort(); };
  async function invalidate() {
    abortAll(); modelRequest?.controller.abort();
    await session.remove('modelCatalog');
  }
  const consentAccepted = async () => (await local.get('textConsent')).textConsent?.version === version;
  // Keep legacy modules and stored profiles, but never start provider work for Kie.
  const requireEnabled = provider => { if (provider === 'kie') throw new AppError('PROVIDER_DISABLED'); };
  const requireConsent = async () => {
    requireEnabled((await profiles.settings())?.provider);
    if (!await consentAccepted()) throw new AppError('CONSENT_REQUIRED');
  };
  const validKey = value => typeof value === 'string' && (value === '' || /^[\x21-\x7e]{16,2048}$/.test(value));
  async function status(includeCatalog = false) {
    const settings = await profiles.settings();
    const quota = await read('providerQuota');
    const catalog = includeCatalog ? await read('modelCatalog') : null;
    const disabled = settings?.provider === 'kie';
    return { provider: settings?.provider ?? 'google', model: settings?.model ?? '', configured: !disabled && Boolean(settings?.apiKey && settings?.model),
      consentAccepted: await consentAccepted(), version,
      ...(disabled ? { notice: 'PROVIDER_DISABLED' } : includeCatalog ? { notice: await read('uiNotice') ?? '' } : {}),
      ...(includeCatalog ? { profiles: await profiles.publicList() } : {}),
      ...(!disabled && catalog?.models && catalog.apiKey === settings?.apiKey && (catalog.provider ?? 'google') === settings?.provider ? { catalogId: catalog.id, models: catalog.models } : {}),
      settingsRevision: settings?.revision ?? '', sessionChars: quota?.chars ?? 0, limits: LIMITS };
  }
  async function reserve(chars, revision, image = false) {
    return locked(async () => {
      await requireConsent();
      const settings = await profiles.settings();
      if (settings?.revision !== revision) throw new AppError('SETTINGS_CHANGED');
      const old = await read('providerQuota') ?? { chars: 0, attempts: [] };
      // One shared rolling window, including images and provider retries. The
      // lock makes competing tabs reserve slots atomically; never wait here.
      const timestamp = now();
      const attempts = old.attempts.filter(time => time > timestamp - 60_000);
      if (attempts.length >= LIMITS.attemptsPerMinute) throw new AppError('CLIENT_RATE_LIMIT');
      if (old.chars + chars > LIMITS.sessionChars) throw new AppError('SESSION_BUDGET');
      if (image && (old.images ?? 0) >= IMAGE_LIMITS.sessionAttempts) throw new AppError('IMAGE_SESSION_BUDGET');
      await session.set({ providerQuota: { chars: old.chars + chars, images: (old.images ?? 0) + Number(image), attempts: [...attempts, timestamp] } });
    });
  }
  async function handle(message, sender) {
    if (!message || sender.id !== chrome.runtime.id) throw new AppError('UNAUTHORIZED');
    await ready;
    if (message.type === 'STATUS' && (ownPage(sender, 'popup.html') || ownPage(sender, 'options.html'))) return status(ownPage(sender, 'options.html'));
    if (message.type === 'VIDEO_CACHE_STATUS' && ownPage(sender, 'options.html')) return videoCache.summary();
    if (message.type === 'VIDEO_CACHE_CLEAR' && ownPage(sender, 'options.html')) return videoCache.clear();
    if (message.type === 'KIE_PRICES' && ownPage(sender, 'options.html')) { requireEnabled('kie'); return kiePrices(); }
    if (message.type === 'USAGE_GET' && (ownPage(sender, 'popup.html') || ownPage(sender, 'statistics.html'))) return usage.snapshot();
    if (message.type === 'USAGE_CLEAR' && ownPage(sender, 'statistics.html')) { await usage.clear(); return usage.snapshot(); }
    if (message.type === 'ACCEPT_CONSENT' && (ownPage(sender, 'popup.html') || ownPage(sender, 'options.html'))) {
      if (message.version !== version) throw new AppError('CONSENT_REQUIRED');
      await local.set({ textConsent: { version } });
      return status(ownPage(sender, 'options.html'));
    }
    if (message.type === 'LOAD_MODELS' && ownPage(sender, 'options.html')) {
      const provider = message.provider ?? 'google';
      requireEnabled(provider);
      if (!validProvider(provider)) throw new AppError('INVALID_SETTINGS');
      const catalog = await locked(async () => {
        if (!validKey(message.apiKey)) throw new AppError('INVALID_SETTINGS');
        const apiKey = message.apiKey || await profiles.keyFor(message.credentialModel, provider);
        if (!apiKey) throw new AppError('NOT_CONFIGURED');
        modelRequest?.controller.abort();
        const record = { id: uuid(), apiKey, provider, controller: new AbortController() };
        modelRequest = record;
        await session.set({ modelCatalog: { id: record.id, apiKey, provider } });
        return record;
      });
      try {
        const models = await (provider === 'openai' ? listOpenAIModels : provider === 'kie' ? listKieModels : listGoogleModels)({ apiKey: catalog.apiKey, fetchImpl, signal: catalog.controller.signal });
        return await locked(async () => {
          if (catalog.controller.signal.aborted || (await read('modelCatalog'))?.id !== catalog.id) throw new AppError('MODEL_LIST_CHANGED');
          if (!models.length) throw new AppError('NO_MODELS');
          await session.set({ modelCatalog: { id: catalog.id, apiKey: catalog.apiKey, provider, models } });
          return { catalogId: catalog.id, models, provider };
        });
      } catch (error) {
        await locked(async () => { if ((await read('modelCatalog'))?.id === catalog.id) await session.remove('modelCatalog'); });
        throw error;
      } finally { if (modelRequest === catalog) modelRequest = null; }
    }
    if (message.type === 'SAVE_SETTINGS' && ownPage(sender, 'options.html')) {
      const provider = message.provider ?? 'google';
      requireEnabled(provider);
      return locked(async () => {
        if (!validProvider(provider) || !validModel(message.model) || (provider === 'openai' && !openaiModel(message.model)) || (provider === 'kie' && !kieModel(message.model)) ||
            !validKey(message.apiKey)) throw new AppError('INVALID_SETTINGS');
        const apiKey = message.apiKey || await profiles.keyFor(message.model, provider);
        if (!apiKey) throw new AppError('MODEL_KEY_REQUIRED');
        const catalog = await read('modelCatalog');
        if (!catalog || (catalog.provider ?? 'google') !== provider || catalog.id !== message.catalogId || catalog.apiKey !== apiKey ||
            !catalog.models?.some(model => model.id === message.model)) throw new AppError('MODEL_LIST_CHANGED');
        const metadata = catalog.models.find(model => model.id === message.model);
        await invalidate();
        await profiles.save(message.model, apiKey, metadata, provider);
        return status(true);
      });
    }
    if (message.type === 'CLEAR_SETTINGS' && ownPage(sender, 'options.html')) {
      return locked(async () => { await invalidate(); await profiles.clear(); return status(true); });
    }
    if (['ACTIVATE_MODEL', 'DELETE_MODEL'].includes(message.type) && ownPage(sender, 'options.html')) {
      const provider = message.provider ?? 'google';
      if (message.type === 'ACTIVATE_MODEL') requireEnabled(provider);
      return locked(async () => {
        if (!validProvider(provider) || !validModel(message.model) || (message.type === 'ACTIVATE_MODEL' && ((provider === 'openai' && !openaiModel(message.model)) || (provider === 'kie' && !kieModel(message.model))))) throw new AppError('INVALID_SETTINGS');
        await invalidate();
        if (message.type === 'ACTIVATE_MODEL') await profiles.activate(message.model, provider);
        else await profiles.remove(message.model, provider);
        return status(true);
      });
    }
    if (message.type === 'OPEN' && ownPage(sender, 'popup.html')) {
      await requireConsent();
      if (!['page', 'video'].includes(message.mode)) throw new AppError('INVALID_REQUEST');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return openPanel(tab, message.mode);
    }
    if (message.type === 'OPEN_VIDEO_INLINE') {
      if (!youtubeSender(sender) || sender.frameId !== 0 || !sender.documentId || !Number.isInteger(sender.tab?.id)) throw new AppError('UNSUPPORTED_VIDEO');
      const tab = await chrome.tabs.get(sender.tab.id);
      const videoId = youtubeId(tab.url);
      if (!videoId || message.videoId !== videoId) throw new AppError('VIDEO_CHANGED');
      await panelDocument(tab, sender.documentId);
      if (!(await status()).configured || !await consentAccepted()) {
        await chrome.runtime.openOptionsPage();
        return { opened: false, needsSettings: true };
      }
      return openPanel(tab, 'video', undefined, sender.documentId);
    }
    const permission = await read(`grant:${sender.tab?.id}`);
    if (!permission || sender.frameId !== 0 || sender.documentId !== permission.documentId || message.grant !== permission.grant) throw new AppError('WORKER_INTERRUPTED');
    if (message.type === 'CONTENT_STATUS') return status();
    if (message.type === 'VIDEO_STYLE_GET') return globalThis.TranslatorVideoStyle.normalize((await local.get('videoAppearance')).videoAppearance);
    if (message.type === 'VIDEO_STYLE_SET') {
      if (!globalThis.TranslatorVideoStyle.valid(message.style)) throw new AppError('INVALID_VIDEO_STYLE');
      return locked(async () => {
        const style = { ...message.style };
        await local.set({ videoAppearance: style });
        return style;
      });
    }
    if (message.type === 'CANCEL') {
      for (const record of requests.values()) if (record.tabId === sender.tab.id && record.jobId === message.jobId) record.controller.abort();
      return { cancelled: true };
    }
    const assertVideo = async () => {
      if (!youtubeSender(sender)) throw new AppError('UNSUPPORTED_VIDEO');
      const tab = await chrome.tabs.get(sender.tab.id);
      const grant = await read(`grant:${sender.tab.id}`);
      if (youtubeId(tab.url) !== message.videoId || grant?.documentId !== sender.documentId || grant.grant !== message.grant) throw new AppError('VIDEO_CHANGED');
    };
    if (['VIDEO_TRACKS', 'VIDEO_CAPTIONS'].includes(message.type)) {
      await requireConsent(); await assertVideo();
      if (message.type === 'VIDEO_CAPTIONS' && !Number.isInteger(message.trackIndex)) throw new AppError('CAPTIONS_INVALID');
      if (videoReads.has(sender.tab.id)) throw new AppError('CLIENT_BUSY');
      videoReads.add(sender.tab.id);
      try {
        const result = await loadYouTubeCaptions({ chrome, tabId: sender.tab.id, documentId: sender.documentId,
          videoId: message.videoId, trackIndex: message.type === 'VIDEO_TRACKS' ? null : message.trackIndex });
        await assertVideo();
        return result;
      } finally { videoReads.delete(sender.tab.id); }
    }
    if (['TRANSLATE_IMAGE', 'CAPTURE_IMAGE', 'RELEASE_IMAGE'].includes(message.type)) {
      const action = imageActions.get(sender.tab.id);
      if (!action || action.token !== message.imageToken || action.documentId !== sender.documentId) throw new AppError('IMAGE_ACTION_EXPIRED');
      const assertActive = async () => {
        const grant = await read(`grant:${sender.tab.id}`);
        if (imageActions.get(sender.tab.id) !== action || grant?.documentId !== sender.documentId || grant.grant !== message.grant) throw new AppError('IMAGE_ACTION_EXPIRED');
      };
      if (message.type === 'RELEASE_IMAGE') {
        imageActions.delete(sender.tab.id);
        for (const record of requests.values()) if (record.action === action) record.controller.abort();
        return { released: true };
      }
      await requireConsent();
      if (message.type === 'CAPTURE_IMAGE') {
        if ((await profiles.settings())?.provider === 'kie') throw new AppError('PROVIDER_IMAGE_UNSUPPORTED');
        if (action.capturing || (action.lastCapture !== undefined && now() - action.lastCapture < 1000)) throw new AppError('IMAGE_CAPTURE_WAIT');
        action.capturing = true; action.lastCapture = now();
        try { return await captureImpl({ chrome, tabId: sender.tab.id, windowId: action.windowId, documentId: sender.documentId, token: action.token, assertActive }); }
        finally { action.capturing = false; }
      }
      const request = validateImageRequest(message.body);
      const settings = await profiles.settings();
      if (!settings?.apiKey) throw new AppError('NOT_CONFIGURED');
      if (settings.provider === 'kie') throw new AppError('PROVIDER_IMAGE_UNSUPPORTED');
      if (request.model !== settings.model || request.settingsRevision !== settings.revision) throw new AppError('SETTINGS_CHANGED');
      const key = `${sender.tab.id}:${request.jobId}`;
      if (requests.has(key) || requests.size >= LIMITS.concurrent) throw new AppError('CLIENT_BUSY');
      const record = { controller: new AbortController(), tabId: sender.tab.id, jobId: request.jobId, action };
      requests.set(key, record);
      try {
        await assertActive();
        const translate = (settings.provider === 'openai' ? createOpenAIProvider : createGoogleProvider)({ apiKey: settings.apiKey, model: settings.model, fetchImpl: settings.provider === 'openai' ? openaiFetchImpl : fetchImpl, imageMode: true });
        const result = await translate(request, { signal: record.controller.signal, beforeAttempt: () => reserve(0, settings.revision, true), ...usageHooks(settings, 'image') });
        await assertActive();
        if (record.controller.signal.aborted) throw new AppError('CANCELLED');
        if ((await profiles.settings())?.revision !== settings.revision) throw new AppError('SETTINGS_CHANGED');
        return result;
      } finally { if (requests.get(key) === record) requests.delete(key); }
    }
    if (message.type !== 'TRANSLATE') throw new AppError('INVALID_REQUEST');
    if (message.mode === 'video') await assertVideo();
    await requireConsent();
    const request = validateRequest(message.body);
    const settings = await profiles.settings();
    if (!settings?.apiKey) throw new AppError('NOT_CONFIGURED');
    if (settings.revision !== request.settingsRevision || settings.model !== request.model || settings.provider !== request.provider) throw new AppError('SETTINGS_CHANGED');
    const key = `${sender.tab.id}:${request.jobId}`;
    if (requests.has(key) || requests.size >= LIMITS.concurrent) throw new AppError('CLIENT_BUSY');
    const controller = new AbortController();
    const record = { controller, tabId: sender.tab.id, jobId: request.jobId };
    requests.set(key, record);
    try {
      const cacheKey = `pageCache:${sender.tab.id}`;
      const scope = cacheScope(sender.url, request);
      const videoTicket = message.mode === 'video' ? await videoCache.get(message.videoId, request) : null;
      const cache = videoTicket?.entries ?? (message.mode === 'page' ? cachedEntries(await read(cacheKey), scope) : new Map());
      const missing = request.segments.filter(segment => !cache.has(segment.text));
      const translate = (settings.provider === 'openai' ? createOpenAIProvider : settings.provider === 'kie' ? createKieProvider : createGoogleProvider)({ apiKey: settings.apiKey, model: settings.model,
        fetchImpl: settings.provider === 'openai' ? openaiFetchImpl : settings.provider === 'kie' ? kieFetchImpl : fetchImpl });
      const fresh = missing.length ? await translate({ ...request, segments: missing, chars: missing.reduce((total, segment) => total + segment.text.length, 0) },
        { signal: controller.signal, beforeAttempt: chars => reserve(chars, settings.revision), ...usageHooks(settings, ['page', 'video'].includes(message.mode) ? message.mode : 'selection') }) : { translations: [] };
      const byId = new Map(fresh.translations.map(item => [item.id, item.text]));
      const result = { jobId: request.jobId, translations: request.segments.map(segment => ({ id: segment.id, text: cache.get(segment.text) ?? byId.get(segment.id) })) };
      validateTranslations({ translations: result.translations }, request.segments);
      if (controller.signal.aborted) throw new AppError('CANCELLED');
      if ((await profiles.settings())?.revision !== settings.revision) throw new AppError('SETTINGS_CHANGED');
      if (message.mode === 'video') await assertVideo();
      if (videoTicket) {
        result.cacheWarning = videoTicket.warning;
        if (fresh.translations.length) result.cacheWarning = (await videoCache.put(message.videoId, videoTicket, missing, fresh.translations)) || result.cacheWarning;
      }
      if (message.mode === 'page') {
        await locked(async () => {
          const active = await read(`grant:${sender.tab.id}`);
          if (controller.signal.aborted || active?.documentId !== sender.documentId || active.grant !== message.grant) throw new AppError('CANCELLED');
          try {
            const merged = mergeCache(await read(cacheKey), scope, request.segments, result.translations);
            if (!merged) throw new Error('cache capacity');
            await session.set({ [cacheKey]: merged });
          } catch { result.cacheWarning = true; }
        });
      }
      return result;
    } finally { if (requests.get(key) === record) requests.delete(key); }
  }
  async function forget(tabId, closed = false) {
    imageActions.delete(tabId);
    for (const record of requests.values()) if (record.tabId === tabId) record.controller.abort();
    await ready;
    await locked(() => session.remove([`grant:${tabId}`, ...(closed ? [`pageCache:${tabId}`] : [])]));
  }
  async function panelDocument(tab, expectedDocumentId) {
    const [document] = await panelStep(chrome.scripting.executeScript({ injectImmediately: true, target: { tabId: tab.id, ...(expectedDocumentId ? { documentIds: [expectedDocumentId] } : { frameIds: [0] }) }, func: () => location.href }));
    if (!document?.documentId || document.result !== tab.url || (expectedDocumentId && document.documentId !== expectedDocumentId)) throw new AppError('PAGE_CHANGED');
    return document.documentId;
  }
  function youtubeSender(sender) {
    try {
      const url = new URL(sender.url);
      return url.origin === 'https://www.youtube.com' && !url.username && !url.password &&
        (!sender.origin || sender.origin === 'https://www.youtube.com');
    } catch { return false; }
  }
  async function openPanel(tab, mode, selectionText, expectedDocumentId) {
    if (!Number.isInteger(tab?.id) || !/^https?:\/\//.test(tab.url ?? '')) throw new AppError('UNSUPPORTED_PAGE');
    if (mode === 'video' && !youtubeId(tab.url)) throw new AppError('UNSUPPORTED_VIDEO');
    const documentId = await panelDocument(tab, expectedDocumentId);
    const files = mode === 'video' ? ['core.js', 'video-core.js', 'video-style.js', 'video-session.js', 'youtube-dom.js', 'video-content.js'] :
      ['core.js', 'dom.js', 'content.js', 'image-dom.js', 'image-content.js'];
    await panelStep(chrome.scripting.executeScript({ injectImmediately: true, target: { tabId: tab.id, documentIds: [documentId] }, files }));
    const previous = await read(`grant:${tab.id}`);
    const grant = previous?.documentId === documentId ? previous.grant : uuid();
    await session.set({ [`grant:${tab.id}`]: { documentId, grant } });
    if (mode === 'image') {
      for (const record of requests.values()) if (record.tabId === tab.id && record.action) record.controller.abort();
      const token = uuid(); imageActions.set(tab.id, { token, documentId, windowId: tab.windowId });
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_IMAGE', grant, imageToken: token, srcUrl: selectionText }, { documentId });
    } else if (mode === 'video') {
      const result = await panelStep(chrome.tabs.sendMessage(tab.id, { type: 'OPEN_VIDEO', grant, videoId: youtubeId(tab.url) }, { documentId }));
      if (!result?.opened) throw new AppError('CAPTIONS_UNAVAILABLE');
    }
    else await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL', mode, grant, ...(mode === 'selection' ? { selectionText } : {}) }, { documentId });
    await session.remove('uiNotice');
    return { opened: true };
  }
  // Called only by the browser's menu event, never by content messages.
  async function openSelection(info, tab) {
    await ready;
    if (info.editable || (info.frameId ?? 0) !== 0) throw new AppError('UNSUPPORTED_SELECTION');
    if (typeof info.selectionText !== 'string' || !info.selectionText.trim()) throw new AppError('UNSUPPORTED_SELECTION');
    if (info.selectionText.length > 60_000) throw new AppError('REQUEST_TOO_LARGE');
    if (info.pageUrl && info.pageUrl !== tab?.url) throw new AppError('PAGE_CHANGED');
    await requireConsent();
    if (!await profiles.settings()) throw new AppError('NOT_CONFIGURED');
    return openPanel(tab, 'selection', info.selectionText);
  }
  async function openImage(info, tab) {
    await ready;
    if (info.mediaType !== 'image' || info.editable || (info.frameId ?? 0) !== 0 || typeof info.srcUrl !== 'string' ||
        info.srcUrl.length > 6 * 1024 * 1024 || !/^(https?:|data:image\/|blob:https?:)/.test(info.srcUrl)) throw new AppError('UNSUPPORTED_IMAGE');
    if (info.pageUrl && info.pageUrl !== tab?.url) throw new AppError('PAGE_CHANGED');
    if (!Number.isInteger(tab?.windowId)) throw new AppError('UNSUPPORTED_PAGE');
    await requireConsent();
    if (!await profiles.settings()) throw new AppError('NOT_CONFIGURED');
    if ((await profiles.settings()).provider === 'kie') throw new AppError('PROVIDER_IMAGE_UNSUPPORTED');
    return openPanel(tab, 'image', info.srcUrl);
  }
  return { handle, forget, openSelection, openImage };
}
