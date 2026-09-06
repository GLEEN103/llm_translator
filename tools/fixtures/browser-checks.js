// Test harness: page-level mocks, not a Chrome extension integration test.
const listeners = []; let calls = 0;
function dispatch(message) { for (const listener of listeners) listener(message, { id }, () => {}); }
const id = 'a'.repeat(32);
globalThis.chrome = { runtime: {
  id, onMessage: { addListener: callback => { listeners.push(callback); } },
  sendMessage: async message => {
    if (message.type === 'CONTENT_STATUS') return { ok: true, data: { configured: true, consentAccepted: true, model: 'mock-browser-model', settingsRevision: 'mock-revision' } };
    if (['CANCEL', 'RELEASE_IMAGE'].includes(message.type)) return { ok: true, data: {} };
    if (message.type === 'CAPTURE_IMAGE') {
      const box = TranslatorImageUI.captureGeometry(message.imageToken);
      return box ? { ok: true, data: globalThis.fixtureImagePixels } : { ok: false, error: 'IMAGE_NOT_VISIBLE' };
    }
    if (message.type === 'TRANSLATE_IMAGE') {
      calls++; document.getElementById('calls').textContent = `Mock API calls: ${calls} · Image target: ${message.body.targetLanguage}`;
      await new Promise(resolve => setTimeout(resolve, document.getElementById('slow').checked ? 15000 : 100));
      if (document.getElementById('fail').checked) { document.getElementById('fail').checked = false; return { ok: false, error: 'PROVIDER_MODEL_OR_REQUEST' }; }
      const noText = document.getElementById('no-image-text').checked;
      return { ok: true, data: { jobId: message.body.jobId, noText, recognizedText: noText ? '' : 'WELCOME\nExit on the right',
        translation: noText ? '' : message.body.targetLanguage === 'ja' ? 'ようこそ\n出口は右側です' : '환영합니다\n출구는 오른쪽입니다 <img src=x onerror=alert(1)>' } };
    }
    if (message.type !== 'TRANSLATE') return { ok: false, error: 'INVALID_REQUEST' };
    calls++; document.getElementById('calls').textContent = `Mock API calls: ${calls} · Last batch: ${message.body.segments.length} segments`;
    await new Promise(resolve => setTimeout(resolve, document.getElementById('slow').checked ? 15000 : 100));
    if (document.getElementById('fail').checked) { document.getElementById('fail').checked = false; return { ok: false, error: 'INVALID_PROVIDER_RESPONSE' }; }
    return { ok: true, data: { jobId: message.body.jobId, translations: [...message.body.segments].reverse().map(segment => ({ id: segment.id, text: `[모의 번역 ${segment.id}] ${segment.text}` })) } };
  }
} };
const results = [];
function check(label, condition) { if (!condition) throw new Error(label); results.push(`PASS: ${label}`); }
document.getElementById('shadow').attachShadow({ mode: 'open' }).textContent = 'SHADOW_SECRET';
for (let index = 0; index < 40; index++) {
  const element = document.createElement('p'); element.textContent = `Batch sentence ${index}.`; document.getElementById('many-elements').append(element);
}
try {
  const snapshot = TranslatorDOM.collect('page');
  const text = snapshot.entries.map(entry => entry.text).join('');
  check('Hidden, form, editable, button, shadow and frame content excluded', !text.includes('SECRET'));
  check('Visible inline link text preserved', text.includes('Read this linked phrase.'));
  check('Whitespace-only inline separator stays in original DOM', document.getElementById('inline-space').textContent === 'Hello again');
  const first = snapshot.entries.find(entry => entry.anchor.id === 'first');
  const original = document.getElementById('first').innerHTML;
  check('Original text node translated in place', TranslatorDOM.apply(first, '<img src=x onerror=alert(1)>'));
  check('Model HTML rendered as text', first.nodes[0].node.nodeValue.includes('<img') && !first.anchor.querySelector('img'));
  TranslatorDOM.restore(first);
  check('Restore preserves original HTML and original link node', document.getElementById('first').innerHTML === original && document.getElementById('link').isConnected);
  first.nodes[0].node.nodeValue += ' changed';
  check('Changed source rejects late response', !TranslatorDOM.apply(first, 'late response'));
  first.nodes[0].node.nodeValue = first.nodes[0].original;
  const other = snapshot.entries.find(entry => entry.anchor.id === 'second');
  const node = other.nodes[0].node; node.remove();
  check('Removed source rejects late response', !TranslatorDOM.apply(other, 'late response'));
  other.anchor.append(node);
  const range = document.createRange(); range.setStart(first.nodes[0].node, 0); range.setEnd(first.nodes[0].node, 5);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  check('Selection sends only selected substring', TranslatorDOM.collect('selection').entries.map(entry => entry.text).join('') === 'Hello');
  selection.removeAllRanges();
  check('Menu snapshot survives lost selection', TranslatorDOM.collectSelection('Chosen text').entries[0].text === 'Chosen text');
  check('Lost selection recovers a unique range across inline nodes', TranslatorDOM.selectionAnchor(document.getElementById('first').textContent)?.toString() === document.getElementById('first').textContent);
  check('Ambiguous duplicate source never guesses an overlay position', TranslatorDOM.selectionAnchor(document.getElementById('second').textContent) === null);
  check('Excluded editable text cannot be used as fallback anchor', TranslatorDOM.selectionAnchor('EDITABLE_SECRET') === null);
  const spaced = document.createElement('p'); spaced.textContent = 'Unique   spaced phrase'; document.body.append(spaced);
  check('Menu whitespace normalization still finds exact original positions', TranslatorDOM.selectionAnchor('Unique spaced phrase')?.toString() === spaced.textContent);
  spaced.remove();
  selection.addRange(range);
  const anchor = TranslatorDOM.selectionAnchor('Hello');
  check('Live selection preserves exact substring coordinates', anchor?.toString() === 'Hello' && anchor.startOffset === 0 && anchor.endOffset === 5);
  const anchored = { range: anchor, text: 'Hello', nodes: [] };
  check('Anchored source is initially valid', TranslatorDOM.unchanged(anchored));
  first.nodes[0].node.nodeValue = 'changed';
  check('Source mutation invalidates a late overlay response', !TranslatorDOM.unchanged(anchored));
  first.nodes[0].node.nodeValue = first.nodes[0].original; selection.removeAllRanges();
  const layouts = ['layout-grid', 'layout-flex', 'layout-table', 'inline-space'].map(id => document.getElementById(id));
  for (const layout of layouts) {
    const html = layout.innerHTML, style = layout.getAttribute('style'), elements = [...layout.querySelectorAll('*')];
    const entries = snapshot.entries.filter(entry => layout.contains(entry.nodes[0].node));
    for (const entry of entries) check(`${layout.id} text update`, TranslatorDOM.apply(entry, '번역'));
    check(`${layout.id} element tree and CSS preserved`, elements.length === layout.querySelectorAll('*').length &&
      elements.every((element, i) => element === layout.querySelectorAll('*')[i]) && style === layout.getAttribute('style'));
    for (const entry of entries) TranslatorDOM.restore(entry);
    check(`${layout.id} exact HTML restored`, layout.innerHTML === html);
  }
  const link = document.getElementById('link'); let clicks = 0;
  link.addEventListener('click', event => { event.preventDefault(); clicks++; });
  const linkEntry = snapshot.entries.find(entry => entry.anchor === link);
  TranslatorDOM.apply(linkEntry, '번역 링크'); link.click(); TranslatorDOM.restore(linkEntry);
  check('Link event listeners survive translation', clicks === 1);
  TranslatorDOM.apply(first, '번역'); first.nodes[0].node.nodeValue = 'Page changed'; TranslatorDOM.restore(first);
  check('Restore does not overwrite later page edits', first.nodes[0].node.nodeValue === 'Page changed');
  first.nodes[0].node.nodeValue = first.nodes[0].original;
  for (let index = 0; index < 3; index++) {
    check(`Repeated ON ${index + 1} safely reapplies cached text`, TranslatorDOM.apply(first, '반복 번역'));
    TranslatorDOM.restore(first);
  }
  first.nodes[0].node.nodeValue = 'Live page update';
  check('ON refuses to overwrite page changes made while OFF', !TranslatorDOM.apply(first, 'cached response'));
  first.nodes[0].node.nodeValue = first.nodes[0].original;
  const batchEntries = snapshot.entries.filter(entry => document.getElementById('many-elements').contains(entry.anchor));
  check('40 DOM elements grouped into one structured request', TranslatorCore.batches(batchEntries.flatMap(entry => entry.segments)).length === 1);
  document.getElementById('checks').textContent = results.join('\n') + `\n${results.length} browser DOM checks passed.`;
} catch (error) { document.getElementById('checks').textContent = results.join('\n') + `\nFAIL: ${error.message}`; }
document.getElementById('open-page').addEventListener('click', () => dispatch({ type: 'OPEN_PANEL', mode: 'page', grant: 'fixture' }));
document.getElementById('open-selection').addEventListener('click', () => {
  const range = document.createRange(); range.selectNodeContents(document.getElementById('first'));
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const selectionText = window.getSelection().toString(); window.getSelection().removeAllRanges();
  dispatch({ type: 'OPEN_PANEL', mode: 'selection', grant: 'fixture', selectionText });
});
document.getElementById('mutate').addEventListener('click', () => { document.getElementById('first').firstChild.nodeValue += ' (updated)'; });
