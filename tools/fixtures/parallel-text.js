// Isolated Chrome fixture only: no provider, real key, or external page access.
(() => {
  const roots = [], listeners = [];
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) { const root = attach.call(this, options); roots.push(root); return root; };
  const fixture = globalThis.parallelFixture = { calls: [], cancelled: [], active: 0, peak: 0, delay: 0, roots,
    open: () => listeners.forEach(listener => listener({ type: 'OPEN_PANEL', mode: 'page', grant: 'fixture' }, { id: 'fixture' }, () => {})) };
  const main = document.querySelector('main');
  for (let i = 0; i < 400; i++) { const p = document.createElement('p'); p.textContent = `phrase-${i}`; main.append(p); }
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
    id: 'fixture', onMessage: { addListener: fn => listeners.push(fn) },
    sendMessage: async message => {
      if (message.type === 'CONTENT_STATUS') return { ok: true, data: { configured: true, consentAccepted: true, provider: 'openai', model: 'fixture', settingsRevision: 'r1' } };
      if (message.type === 'CANCEL') { fixture.cancelled.push(message.jobId); return { ok: true, data: {} }; }
      if (message.type !== 'TRANSLATE') return { ok: false, error: 'INVALID_REQUEST' };
      const call = { jobId: message.body.jobId, start: performance.now(), count: message.body.segments.length };
      fixture.calls.push(call); fixture.peak = Math.max(fixture.peak, ++fixture.active);
      await new Promise(resolve => setTimeout(resolve, fixture.delay || (700 - ((fixture.calls.length - 1) % 5) * 100)));
      fixture.active--; call.end = performance.now();
      // Deliberately return even after CANCEL to test rejection of late output.
      return { ok: true, data: { jobId: message.body.jobId, translations: [...message.body.segments].reverse().map(s => ({ id: s.id, text: `T:${s.text}` })) } };
    }
  } } });
})();
