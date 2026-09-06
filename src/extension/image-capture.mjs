import { AppError } from './contract.mjs';
import { IMAGE_LIMITS, validateImage } from './image-contract.mjs';

export function validateGeometry(value) {
  const keys = ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight'];
  if (!value || !keys.every(key => Number.isFinite(value[key])) || value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1 ||
      value.viewportWidth < 1 || value.viewportHeight < 1 || value.viewportWidth > 16384 || value.viewportHeight > 16384 ||
      value.x + value.width > value.viewportWidth || value.y + value.height > value.viewportHeight) throw new AppError('IMAGE_NOT_VISIBLE');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
export async function cropScreenshot(dataUrl, geometry) {
  const g = validateGeometry(geometry);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 48 * 1024 * 1024) throw new AppError('IMAGE_CAPTURE_FAILED');
  let bitmap;
  try {
    const binary = atob(dataUrl.slice(22));
    bitmap = await createImageBitmap(new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'image/png' }));
    const sx = bitmap.width / g.viewportWidth, sy = bitmap.height / g.viewportHeight;
    if (Math.abs(sx - sy) > 0.03 || sx < 0.25 || sx > 8) throw new AppError('IMAGE_CAPTURE_FAILED');
    // Round inward: never include neighboring page pixels in the transmitted crop.
    const x = Math.ceil(g.x * sx), y = Math.ceil(g.y * sy);
    const width = Math.floor((g.x + g.width) * sx) - x, height = Math.floor((g.y + g.height) * sy) - y;
    if (width < 1 || height < 1) throw new AppError('IMAGE_NOT_VISIBLE');
    const ratio = Math.min(1, IMAGE_LIMITS.edge / Math.max(width, height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.floor(width * ratio)), Math.max(1, Math.floor(height * ratio)));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    let blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.size > IMAGE_LIMITS.bytes) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    if (blob.size > IMAGE_LIMITS.bytes) throw new AppError('IMAGE_TOO_LARGE');
    const bytes = new Uint8Array(await blob.arrayBuffer()); let encoded = '';
    for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return validateImage({ mimeType: blob.type, data: btoa(encoded) });
  } catch (error) { throw error instanceof AppError ? error : new AppError('IMAGE_CAPTURE_FAILED'); }
  finally { bitmap?.close(); }
}

export async function captureImage({ chrome, tabId, windowId, documentId, token, crop = cropScreenshot, assertActive = () => {} }) {
  const active = async () => {
    await assertActive();
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id !== tabId || !/^https?:\/\//.test(tab.url ?? '')) throw new AppError('PAGE_CHANGED');
  };
  const geometry = async () => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] },
      func: token => globalThis.TranslatorImageUI?.captureGeometry(token), args: [token] });
    if (result?.documentId !== documentId) throw new AppError('PAGE_CHANGED');
    return validateGeometry(result.result);
  };
  await active(); const before = await geometry();
  const screenshot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  await active(); const after = await geometry();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new AppError('PAGE_CHANGED');
  const image = await crop(screenshot, before);
  await active();
  return image;
}
