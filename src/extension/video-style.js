(() => {
  if (globalThis.TranslatorVideoStyle) return;
  const defaults = Object.freeze({ backgroundOpacity: 72, textOpacity: 100, font: 'system', size: 28, vertical: 86, align: 'center' });
  const fonts = Object.freeze({ system: 'system-ui, sans-serif', sans: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif', serif: '"Batang", "AppleMyungjo", serif', mono: 'Consolas, "Courier New", monospace' });
  function valid(value) {
    return value && Object.keys(value).length === Object.keys(defaults).length && Object.keys(defaults).every(k => Object.hasOwn(value, k)) &&
      ['backgroundOpacity', 'textOpacity'].every(k => Number.isInteger(value[k]) && value[k] >= 0 && value[k] <= 100) &&
      Number.isInteger(value.size) && value.size >= 12 && value.size <= 64 &&
      Number.isInteger(value.vertical) && value.vertical >= 5 && value.vertical <= 95 &&
      Object.hasOwn(fonts, value.font) && ['left', 'center', 'right'].includes(value.align);
  }
  function normalize(value) { return valid(value) ? { ...value } : { ...defaults }; }
  function apply(container, text, value) {
    const style = normalize(value);
    Object.assign(container.style, { top: `${style.vertical}%`, bottom: 'auto', transform: 'translateY(-50%)', textAlign: style.align,
      fontFamily: fonts[style.font], fontSize: `${style.size}px` });
    Object.assign(text.style, { backgroundColor: `rgba(0, 0, 0, ${style.backgroundOpacity / 100})`, color: `rgba(255, 255, 255, ${style.textOpacity / 100})`, textShadow: `0 1px 3px rgba(0, 0, 0, ${style.textOpacity / 100})` });
  }
  globalThis.TranslatorVideoStyle = Object.freeze({ defaults, fonts, valid, normalize, apply });
})();
