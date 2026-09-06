(() => {
  if (globalThis.TranslatorImageDOM) return;
  const edge = 2048, maxBytes = 4 * 1024 * 1024;
  let clicked;
  document.addEventListener('contextmenu', event => {
    if (event.isTrusted) clicked = event.composedPath().find(node => node instanceof HTMLImageElement);
  }, true);
  const source = image => image.currentSrc || image.src;
  const eligible = image => image instanceof HTMLImageElement && image.getRootNode() === document && image.isConnected && image.complete && image.naturalWidth > 0 &&
    !image.closest('form,[contenteditable]:not([contenteditable="false"]),[data-llm-translator-root]') &&
    image.getClientRects().length > 0 && getComputedStyle(image).visibility === 'visible';
  function find(srcUrl) {
    const matches = image => eligible(image) && (source(image) === srcUrl || image.src === srcUrl);
    const images = [...document.images].filter(matches);
    const image = matches(clicked) ? clicked : images.length === 1 ? images[0] : null;
    clicked = null;
    if (!image) throw new Error('IMAGE_NOT_FOUND');
    return { element: image, src: source(image), width: image.naturalWidth, height: image.naturalHeight };
  }
  function unchanged(snapshot) {
    return eligible(snapshot.element) && source(snapshot.element) === snapshot.src && snapshot.width === snapshot.element.naturalWidth && snapshot.height === snapshot.element.naturalHeight;
  }
  function encode(snapshot) {
    if (!unchanged(snapshot)) throw new Error('IMAGE_CHANGED');
    const ratio = Math.min(1, edge / Math.max(snapshot.width, snapshot.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(snapshot.width * ratio)); canvas.height = Math.max(1, Math.floor(snapshot.height * ratio));
    try {
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(snapshot.element, 0, 0, canvas.width, canvas.height);
      let url = canvas.toDataURL('image/png');
      if (url.length * 0.75 > maxBytes) url = canvas.toDataURL('image/jpeg', 0.9);
      const [header, data] = url.split(',');
      if (!data || data.length * 0.75 > maxBytes) throw new Error('IMAGE_TOO_LARGE');
      return { mimeType: header.includes('image/png') ? 'image/png' : 'image/jpeg', data };
    } catch (error) {
      if (error.name === 'SecurityError') return null;
      throw new Error(error.message === 'IMAGE_TOO_LARGE' ? error.message : 'IMAGE_UNREADABLE');
    } finally { canvas.width = 1; canvas.height = 1; }
  }
  function geometry(snapshot) {
    if (!unchanged(snapshot)) throw new Error('IMAGE_CHANGED');
    const image = snapshot.element, style = getComputedStyle(image), rect = image.getBoundingClientRect();
    if (window.visualViewport && (visualViewport.scale !== 1 || visualViewport.offsetLeft || visualViewport.offsetTop)) throw new Error('IMAGE_NOT_VISIBLE');
    for (let node = image; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (css.transform !== 'none' || css.clipPath !== 'none' || css.visibility !== 'visible' || Number(css.opacity) !== 1) throw new Error('IMAGE_NOT_VISIBLE');
    }
    const left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), top = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    let x = rect.left + left, y = rect.top + top;
    let width = rect.width - left - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    let height = rect.height - top - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    if (style.objectFit !== 'fill') {
      if (!['contain', 'scale-down'].includes(style.objectFit) || style.objectPosition !== '50% 50%') throw new Error('IMAGE_NOT_VISIBLE');
      const scale = Math.min(width / snapshot.width, height / snapshot.height, style.objectFit === 'scale-down' ? 1 : Infinity);
      const w = snapshot.width * scale, h = snapshot.height * scale;
      x += (width - w) / 2; y += (height - h) / 2; width = w; height = h;
    }
    if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > innerWidth || y + height > innerHeight) throw new Error('IMAGE_NOT_VISIBLE');
    const elements = document.querySelectorAll('*');
    if (elements.length > 10000) throw new Error('IMAGE_NOT_VISIBLE');
    for (const node of elements) {
      if (node === image || node.contains(image)) continue;
      const css = getComputedStyle(node);
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) continue;
      for (const box of node.getClientRects()) if (box.width && box.height && box.left < x + width && box.right > x && box.top < y + height && box.bottom > y) {
        const px = (Math.max(x, box.left) + Math.min(x + width, box.right)) / 2;
        const py = (Math.max(y, box.top) + Math.min(y + height, box.bottom)) / 2;
        const paints = css.backgroundImage !== 'none' || !['rgba(0, 0, 0, 0)', 'transparent'].includes(css.backgroundColor) ||
          css.boxShadow !== 'none' || ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].some(key => parseFloat(css[key]) > 0) ||
          [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.nodeValue.trim());
        if (document.elementFromPoint(px, py) !== image || (css.pointerEvents === 'none' && paints)) throw new Error('IMAGE_NOT_VISIBLE');
      }
    }
    // Reject clipping/occlusion, including translator panels, at a dense sample grid.
    for (let iy = 0; iy <= 10; iy++) for (let ix = 0; ix <= 10; ix++) {
      const px = x + Math.max(0.5, Math.min(width - 0.5, width * ix / 10));
      const py = y + Math.max(0.5, Math.min(height - 0.5, height * iy / 10));
      if (document.elementFromPoint(px, py) !== image) throw new Error('IMAGE_NOT_VISIBLE');
    }
    return { x, y, width, height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  }
  globalThis.TranslatorImageDOM = Object.freeze({ find, unchanged, encode, geometry });
})();
