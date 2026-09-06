(() => {
  if (globalThis.TranslatorDOM) return;
  const { limits, splitText } = globalThis.TranslatorCore;
  const excluded = 'script,style,noscript,template,input,textarea,select,option,button,form,canvas,svg,iframe,video,audio,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-llm-translator-root],[data-llm-translation]';
  const blocks = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dd,dt,figcaption,td,th,div,section,article,main';
  function eligible(node) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue || parent.closest(excluded)) return false;
    for (let element = parent; element; element = element.parentElement) {
      if (element.hidden || element.getAttribute('aria-hidden') === 'true' || element.inert) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    return parent.getClientRects().length > 0;
  }
  function unchanged(entry) {
    if (entry.range) return entry.range.startContainer.isConnected && entry.range.endContainer.isConnected && entry.range.toString() === (entry.rangeText ?? entry.text);
    return entry.nodes.every(({ node, original, parent }) => node.isConnected && node.parentElement === parent && node.nodeValue === original);
  }
  function collect(mode) {
    const selection = mode === 'selection' ? window.getSelection() : null;
    if (mode === 'selection' && (!selection?.rangeCount || selection.isCollapsed)) throw new Error('선택된 텍스트가 없습니다. 페이지에서 먼저 텍스트를 선택하세요.');
    const range = selection?.getRangeAt(0).cloneRange();
    const root = mode === 'selection' ? document.body : (document.querySelector('main,article,[role="main"]') ?? document.body);
    if (!root) throw new Error('이 페이지에는 번역할 본문이 없습니다.');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const groups = new Map(); let visited = 0, truncated = false;
    while (walker.nextNode()) {
      if (++visited > 30_000) { truncated = true; break; }
      const node = walker.currentNode;
      if (!eligible(node) || (range && !range.intersectsNode(node))) continue;
      let text = node.nodeValue;
      if (range) text = text.slice(range.startContainer === node ? range.startOffset : 0, range.endContainer === node ? range.endOffset : text.length);
      if (!text) continue;
      const anchor = mode === 'page' ? node.parentElement : (node.parentElement.closest(blocks) ?? node.parentElement);
      const key = mode === 'page' ? node : anchor;
      if (!groups.has(key)) groups.set(key, { anchor, nodes: [], text: '', status: 'pending' });
      const group = groups.get(key);
      group.nodes.push({ node, original: node.nodeValue, parent: node.parentElement }); group.text += text;
    }
    const entries = []; let chars = 0, segmentCount = 0;
    for (const group of groups.values()) {
      const parts = splitText(group.text).filter(text => text.trim());
      if (!parts.length) continue;
      if (chars + group.text.length > limits.pageChars || segmentCount + parts.length > limits.pageSegments) {
        truncated = true;
        if (mode === 'selection') throw new Error('선택한 원문이 너무 큽니다. 60,000자 이하로 줄여 주세요.');
        continue;
      }
      group.id = `e${entries.length}`;
      group.segments = parts.map((text, index) => ({ id: `${group.id}_${index}`, text }));
      chars += group.text.length; segmentCount += parts.length; entries.push(group);
    }
    if (!entries.length) throw new Error('번역할 본문을 찾지 못했습니다. 폼·숨김 영역·프레임·이미지 문자는 제외됩니다.');
    if (range && truncated) throw new Error('선택 영역을 모두 읽지 못했습니다. 더 작은 범위를 선택하세요.');
    return { mode, entries, chars, segmentCount, truncated };
  }
  function apply(entry, text) {
    if (entry.nodes.length !== 1 || !unchanged(entry) || !entry.anchor.isConnected) return false;
    const { node, original } = entry.nodes[0];
    // Preserve element identity, CSS, inline boundaries and event listeners.
    entry.applied = original.match(/^\s*/)[0] + text.trim() + original.match(/\s*$/)[0];
    node.nodeValue = entry.applied;
    return true;
  }
  function restore(entry) {
    if (entry.applied === undefined) return;
    const { node, original, parent } = entry.nodes[0];
    // Never overwrite changes made by the page after translation.
    if (node.isConnected && node.parentElement === parent && node.nodeValue === entry.applied) node.nodeValue = original;
    delete entry.applied;
  }
  function collectSelection(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('선택된 텍스트가 없습니다. 다시 선택하고 우클릭하세요.');
    if (text.length > limits.pageChars) throw new Error('선택한 원문이 너무 큽니다. 60,000자 이하로 줄여 주세요.');
    const segments = splitText(text).filter(part => part.trim()).map((part, index) => ({ id: `e0_${index}`, text: part }));
    return { mode: 'selection', entries: [{ id: 'e0', nodes: [], text, segments, status: 'pending' }], chars: text.length, segmentCount: segments.length, truncated: false };
  }
  let menuRange;
  document.addEventListener('contextmenu', () => {
    const selection = window.getSelection();
    menuRange = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
  }, true);
  function selectionAnchor(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const normalized = value => value.replace(/\s+/g, ' ').trim();
    const wanted = normalized(text);
    const selection = window.getSelection();
    const live = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const valid = range => range && normalized(range.toString()) === wanted && range.startContainer.isConnected &&
      range.endContainer.isConnected && range.getClientRects().length > 0 &&
      !((range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest(excluded));
    for (const range of [live, menuRange]) if (valid(range)) return range.cloneRange();
    // Recover only an unambiguous visible match; never guess among duplicates.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; let joined = '', visited = 0;
    while (walker.nextNode()) {
      if (++visited > 30000) return null;
      const node = walker.currentNode;
      if (!eligible(node)) continue;
      nodes.push({ node, start: joined.length }); joined += node.nodeValue;
      if (joined.length > 500000) return null;
    }
    // Browser menu text collapses inline whitespace; retain offsets into original nodes.
    let compact = ''; const offsets = [];
    for (let index = 0; index < joined.length; index++) {
      const char = /\s/.test(joined[index]) ? ' ' : joined[index];
      if (char === ' ' && (!compact || compact.endsWith(' '))) continue;
      compact += char; offsets.push(index);
    }
    const match = compact.indexOf(wanted);
    if (match < 0 || compact.indexOf(wanted, match + 1) >= 0) return null;
    const start = offsets[match], end = offsets[match + wanted.length - 1] + 1;
    const first = nodes.find(item => item.start + item.node.length > start);
    const last = nodes.find(item => item.start < end && item.start + item.node.length >= end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    return valid(range) ? range : null;
  }
  globalThis.TranslatorDOM = Object.freeze({ collect, collectSelection, selectionAnchor, unchanged, apply, restore, eligible });
})();
