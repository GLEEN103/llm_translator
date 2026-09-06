(() => {
  if (globalThis.TranslatorVideoCore) return;
  const limits = Object.freeze({ events: 5000, chars: 100000, bytes: 2097152, seconds: 86400 });
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function parse(data) {
    if (!Array.isArray(data?.events)) fail('CAPTIONS_INVALID');
    if (data.events.length > limits.events) fail('CAPTIONS_TOO_LARGE');
    const cues = [], windows = new Map(); let chars = 0;
    for (const event of data.events) {
      if (!event || typeof event !== 'object') fail('CAPTIONS_INVALID');
      if (!event.segs) continue; // JSON3 window/pen metadata contains no caption text.
      if (!Array.isArray(event.segs) || event.segs.some(s => typeof s?.utf8 !== 'string')) fail('CAPTIONS_INVALID');
      const window = String(event.wWinId ?? 0), previous = windows.get(window);
      const start = event.tStartMs / 1000;
      const duration = event.dDurationMs === undefined && event.aAppend === 1 && previous ? Math.max(0, previous.end - start) : event.dDurationMs / 1000;
      if (typeof event.tStartMs !== 'number' || !Number.isFinite(start) || start < 0 || start > limits.seconds ||
          (event.dDurationMs !== undefined && typeof event.dDurationMs !== 'number') || !Number.isFinite(duration) || duration < 0 || start + duration > limits.seconds) fail('CAPTIONS_INVALID');
      const text = event.segs.map(s => s.utf8).join('').replace(/\s+/gu, ' ').trim();
      chars += text.length;
      if (chars > limits.chars) fail('CAPTIONS_TOO_LARGE');
      if (!text || duration === 0) continue;
      // Rolling ASR additions become one cue; a new window event replaces the old display.
      if (event.aAppend === 1 && previous && start <= previous.end) {
        previous.text += ` ${text}`; previous.end = Math.max(previous.end, start + duration);
      } else {
        if (event.wWinId !== undefined && previous && previous.start < start && previous.end > start) previous.end = start;
        const cue = { start, end: start + duration, text };
        cues.push(cue); windows.set(window, cue);
      }
    }
    const sorted = cues.filter(c => c.end > c.start).sort((a, b) => a.start - b.start);
    if (!sorted.length) fail('CAPTIONS_EMPTY');
    return sorted.map((cue, i) => ({ ...cue, id: `c${i}` }));
  }
  function index(cues) {
    let end = 0;
    return cues.map(cue => { end = Math.max(end, cue.end); return end; });
  }
  function active(cues, ends, time) {
    if (!Number.isFinite(time) || time < 0) return [];
    let low = 0, high = cues.length;
    while (low < high) { const mid = (low + high) >>> 1; if (cues[mid].start <= time) low = mid + 1; else high = mid; }
    const found = [];
    for (let i = low - 1; i >= 0 && ends[i] > time; i--) if (cues[i].end > time) found.push(cues[i]);
    return found.reverse();
  }
  function prepare(cues, core) {
    const segments = [], unique = new Map();
    const items = cues.map(cue => ({ ...cue, parts: core.splitText(cue.text).map(text => {
      if (!unique.has(text)) { const segment = { id: `s${segments.length}`, text }; unique.set(text, segment); segments.push(segment); }
      return unique.get(text).id;
    }) }));
    return { cues: items, segments };
  }
  function nextBatches(cues, segments, results, time, core) {
    const missing = new Set();
    // Prioritize the playhead after seeking, then wrap to earlier untranslated cues.
    for (const future of [true, false]) for (const cue of cues) {
      if ((cue.end > time) === future) for (const id of cue.parts) if (!results.has(id)) missing.add(id);
    }
    const byId = new Map(segments.map(s => [s.id, s]));
    return core.batches([...missing].map(id => byId.get(id))).slice(0, core.scheduling.concurrent);
  }
  const nextBatch = (...args) => nextBatches(...args)[0] ?? [];
  function merge(previous, incoming) {
    // A refreshed timestamp replaces its prior text/duration; other loaded
    // windows remain available when the player returns only a partial chunk.
    const starts = new Set(incoming.map(c => c.start));
    const combined = [...previous.filter(c => !starts.has(c.start)), ...incoming];
    if (combined.length > limits.events) fail('CAPTIONS_TOO_LARGE');
    let chars = 0;
    for (const cue of combined) {
      if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > limits.seconds || typeof cue.text !== 'string' || !cue.text.trim()) fail('CAPTIONS_INVALID');
      chars += cue.text.length;
    }
    if (chars > limits.chars) fail('CAPTIONS_TOO_LARGE');
    return combined.sort((a, b) => a.start - b.start).map((c, i) => ({ id: `c${i}`, start: c.start, end: c.end, text: c.text }));
  }
  globalThis.TranslatorVideoCore = Object.freeze({ limits, parse, index, active, prepare, nextBatch, nextBatches, merge });
})();
