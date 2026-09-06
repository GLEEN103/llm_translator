(() => {
  if (globalThis.TranslatorVideoSession) return;
  const transient = new Set(['CAPTIONS_EMPTY', 'CAPTIONS_UNAVAILABLE', 'CAPTIONS_DIRECT_EMPTY', 'CAPTIONS_PLAYER_TIMEOUT', 'CAPTIONS_PLAYER_UNAVAILABLE', 'CAPTIONS_BRIDGE_FAILED',
    'VIDEO_AD', 'CLIENT_BUSY', 'CLIENT_RATE_LIMIT', 'PROVIDER_RATE_LIMIT', 'PROVIDER_NETWORK', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT']);
  const retryDelay = (code, attempts) => ['CLIENT_RATE_LIMIT', 'PROVIDER_RATE_LIMIT'].includes(code) ? 60000 : Math.min(60000, 5000 * 2 ** Math.min(attempts - 1, 4));
  function create({ core = globalThis.TranslatorCore, video = globalThis.TranslatorVideoCore, context, status, read, translate, cancel, change,
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, uuid = () => crypto.randomUUID() }) {
    let enabled = false, generation = 0, busy = false, timer, settings, explicitStart = false;
    const jobs = new Set();
    let cues = [], segments = [], results = new Map(), cache = new Map();
    let failed = new Map(), failedText = new Map(), logs = [], logSequence = 0, cacheWarning = false;
    let nextRead = 0, nextTranslate = 0, readFailures = 0, translateFailures = 0, readError = '', translateError = '';
    let phase = 'off', error = '', disposed = false;
    const emit = () => change({ enabled, phase, error, cues, segments, results, failed, logs, cacheWarning, retryAt: Math.max(nextRead * !!readError, nextTranslate * !!translateError) });
    const completed = () => new Map([...results, ...failed]);
    const wait = (ms, active) => core.waitActive(ms, active, delay => new Promise(resolve => setTimer(resolve, delay)));
    const rebuild = incoming => {
      const prepared = video.prepare(incoming, core);
      cues = prepared.cues; segments = prepared.segments;
      const texts = new Set(segments.map(s => s.text));
      cache = new Map([...cache].filter(([text]) => texts.has(text)));
      results = new Map(segments.filter(s => cache.has(s.text)).map(s => [s.id, cache.get(s.text)]));
      failedText = new Map([...failedText].filter(([text]) => texts.has(text)));
      failed = new Map(segments.filter(s => failedText.has(s.text)).map(s => [s.id, failedText.get(s.text)]));
    };
    const schedule = delay => {
      clearTimer(timer);
      if (enabled && !disposed) timer = setTimer(() => { void pump(); }, Math.max(0, delay));
    };
    function stop(code = '') {
      enabled = false; generation++; clearTimer(timer);
      for (const jobId of jobs) cancel(jobId);
      jobs.clear(); phase = 'off'; error = code; emit();
    }
    function start() {
      if (enabled || disposed) return;
      enabled = true; generation++; explicitStart = true; error = ''; readError = ''; translateError = '';
      readFailures = 0; translateFailures = 0; nextRead = 0; nextTranslate = 0; phase = 'waiting'; emit(); schedule(0);
    }
    function reset() { stop(); settings = undefined; cache.clear(); failedText.clear(); cacheWarning = false; logs = []; rebuild([]); emit(); }
    async function pump() {
      if (!enabled || disposed || busy) return;
      if (context().suspended) { phase = 'suspended'; emit(); schedule(5000); return; }
      busy = true; const run = generation, valid = () => enabled && generation === run && !disposed;
      try {
        const latest = await status(); if (!valid()) return;
        if (!latest.consentAccepted) throw { code: 'CONSENT_REQUIRED' };
        if (!latest.configured) throw { code: 'NOT_CONFIGURED' };
        if (settings && settings.settingsRevision !== latest.settingsRevision) {
          if (!explicitStart) throw { code: 'SETTINGS_CHANGED' };
          cache.clear(); failedText.clear(); rebuild([]);
        }
        settings = { ...latest }; explicitStart = false;
        if (now() >= nextRead && !context().suspended) {
          phase = 'reading'; emit(); nextRead = now() + 10000;
          try {
            const data = await read(); if (!valid()) return;
            rebuild(video.merge(cues, data.cues)); readFailures = 0; readError = ''; nextRead = now() + 10000;
          } catch (e) {
            if (!valid()) return;
            if (!transient.has(e.code)) throw e;
            readError = e.code; nextRead = now() + Math.max(10000, retryDelay(e.code, ++readFailures));
          }
          emit();
        }
        const batches = video.nextBatches(cues, segments, completed(), context().time, core);
        if (batches.length && now() >= nextTranslate && !context().suspended) {
          phase = 'translating'; error = ''; translateError = ''; emit();
          let waveError = '', retryAt = 0;
          await Promise.all(batches.map(async batch => {
            if (!valid()) return;
            const sentJob = uuid(); jobs.add(sentJob);
            try {
              const response = await core.formatRetry(async () => {
                if (context().suspended) throw { code: 'CLIENT_BUSY' };
                const response = await translate(batch, settings, sentJob);
                if (valid() && !core.validResult(response, sentJob, batch)) throw { code: 'INVALID_PROVIDER_RESPONSE' };
                return response;
              }, valid, { wait, onError: record => {
                logs = [...logs, { ...record, sequence: ++logSequence, time: now(), count: batch.length }].slice(-100); emit();
              }, onWait: code => { translateError = code; error = code; emit(); } });
              if (!valid()) return;
              cacheWarning ||= Boolean(response.cacheWarning);
              const byId = new Map(response.translations.map(t => [t.id, t.text]));
              // Merge against the latest cache, not the snapshot at request start.
              const updated = new Map(cache);
              for (const segment of batch) updated.set(segment.text, byId.get(segment.id));
              if ([...updated.values()].reduce((sum, text) => sum + text.length, 0) > 1000000) throw { code: 'CAPTIONS_TOO_LARGE' };
              cache = updated; rebuild(cues); emit();
            } catch (e) {
              if (!valid()) return;
              cancel(sentJob);
              if (core.isFormatError(e.code)) {
                for (const segment of batch) failedText.set(segment.text, e.code);
                rebuild(cues); emit(); return;
              }
              if (!transient.has(e.code)) { stop(e.code || 'WORKER_INTERRUPTED'); return; }
              waveError = e.code; retryAt = Math.max(retryAt, now() + retryDelay(e.code, translateFailures + 1));
            } finally { jobs.delete(sentJob); }
          }));
          if (valid()) {
            translateFailures = waveError ? translateFailures + 1 : 0;
            translateError = waveError;
            nextTranslate = Math.max(now() + core.scheduling.restMs, retryAt);
          }
        }
        if (valid()) { phase = 'waiting'; error = translateError || readError; emit(); }
      } catch (e) { if (valid()) stop(e.code || 'WORKER_INTERRUPTED'); }
      finally {
        busy = false;
        if (enabled) {
          const pending = video.nextBatch(cues, segments, completed(), context().time, core).length;
          schedule(generation !== run ? 0 : Math.min(5000, Math.max(250, nextRead - now()), pending ? Math.max(250, nextTranslate - now()) : 5000));
        }
      }
    }
    return Object.freeze({ start, stop, reset, retryFailed: () => { if (busy) return; failedText.clear(); rebuild(cues); nextTranslate = 0; emit(); if (enabled) schedule(0); },
      wake: () => { if (enabled && !busy) schedule(0); },
      dispose: () => { stop(); disposed = true; cache.clear(); failedText.clear(); logs = []; cues = []; segments = []; results.clear(); failed.clear(); },
      snapshot: () => ({ enabled, busy, cues, segments, results, failed, logs, cacheWarning, error }) });
  }
  globalThis.TranslatorVideoSession = Object.freeze({ create, retryDelay });
})();
