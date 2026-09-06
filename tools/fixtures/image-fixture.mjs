import { cropScreenshot } from '/image-capture.mjs';
import { validateImage } from '/image-contract.mjs';
const fixture = document.getElementById('test-image');
const board = document.createElement('canvas'); board.width = 640; board.height = 220;
const context = board.getContext('2d'); context.fillStyle = '#e1efff'; context.fillRect(0, 0, 640, 220);
context.fillStyle = '#123b63'; context.font = 'bold 46px sans-serif'; context.fillText('WELCOME', 32, 85);
context.font = '30px sans-serif'; context.fillText('Exit on the right', 32, 155);
fixture.src = board.toDataURL('image/png'); await fixture.decode();
globalThis.fixtureImagePixels = { mimeType: 'image/png', data: fixture.src.split(',')[1] };
const imageResults = [];
function check(label, condition) { if (!condition) throw new Error(label); imageResults.push(`PASS: ${label}`); }
try {
  const snapshot = TranslatorImageDOM.find(fixture.src), original = fixture.outerHTML;
  const encoded = TranslatorImageDOM.encode(snapshot);
  check('Loaded image encoded locally as bounded PNG', validateImage(encoded).mimeType === 'image/png');
  check('Encoding preserves original image and style', fixture.outerHTML === original);
  const box = TranslatorImageDOM.geometry(snapshot);
  check('Fully visible image produces a bounded viewport crop', box.width > 0 && box.x + box.width <= innerWidth);
  const cover = document.createElement('div'); cover.style.cssText = `position:fixed;left:${box.x + 10}px;top:${box.y + 10}px;width:2px;height:2px;background:red;z-index:2147483647`;
  document.body.append(cover); let covered = false; try { TranslatorImageDOM.geometry(snapshot); } catch { covered = true; } cover.remove();
  check('Even a tiny overlapping element blocks screenshot fallback', covered);
  const crossOrigin = document.createElement('img'); crossOrigin.src = 'http://localhost:43188/cross-origin-image.svg'; crossOrigin.style.cssText = 'width:100px;height:auto'; document.body.append(crossOrigin); await crossOrigin.decode();
  check('Cross-origin pixels request screenshot fallback instead of leaking URL', TranslatorImageDOM.encode(TranslatorImageDOM.find(crossOrigin.src)) === null); crossOrigin.remove();
  const duplicate = fixture.cloneNode(); fixture.parentElement.append(duplicate); await duplicate.decode();
  let rejected = false; try { TranslatorImageDOM.find(fixture.src); } catch { rejected = true; }
  check('Duplicate image URL requires another context click', rejected); duplicate.remove();
  const large = document.createElement('canvas'); large.width = 4096; large.height = 1024;
  const largeImage = document.createElement('img'); largeImage.src = large.toDataURL('image/png'); largeImage.style.cssText = 'width:200px;height:50px'; document.body.append(largeImage); await largeImage.decode();
  const reduced = TranslatorImageDOM.encode(TranslatorImageDOM.find(largeImage.src));
  check('Large input is resized to the 2048px bound', validateImage(reduced).mimeType === 'image/png'); largeImage.remove();
  const screen = document.createElement('canvas'); screen.width = 400; screen.height = 200;
  const paint = screen.getContext('2d'); paint.fillStyle = 'red'; paint.fillRect(0,0,400,200); paint.fillStyle = 'blue'; paint.fillRect(100,40,120,80);
  const crop = await cropScreenshot(screen.toDataURL('image/png'), { x: 50, y: 20, width: 60, height: 40, viewportWidth: 200, viewportHeight: 100 });
  const cropped = new Image(); cropped.src = `data:${crop.mimeType};base64,${crop.data}`; await cropped.decode();
  const proof = document.createElement('canvas'); proof.width = 120; proof.height = 80; const ctx = proof.getContext('2d'); ctx.drawImage(cropped,0,0);
  const pixels = ctx.getImageData(0,0,120,80).data;
  check('Screenshot crop has exact scaled image dimensions', cropped.naturalWidth === 120 && cropped.naturalHeight === 80);
  check('Screenshot crop contains no surrounding red page pixels', Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i*4] === 0 && pixels[i*4+2] === 255).every(Boolean));
  fixture.src = screen.toDataURL('image/png'); await fixture.decode();
  check('Source replacement invalidates image snapshot', !TranslatorImageDOM.unchanged(snapshot));
  fixture.src = board.toDataURL('image/png'); await fixture.decode();
  document.getElementById('image-checks').textContent = imageResults.join('\n') + `\n${imageResults.length} browser image checks passed.`;
} catch (error) { document.getElementById('image-checks').textContent = imageResults.join('\n') + `\nFAIL: ${error.message}`; }
document.getElementById('open-image').addEventListener('click', () => dispatch({ type: 'OPEN_IMAGE', grant: 'fixture', imageToken: crypto.randomUUID(), srcUrl: fixture.currentSrc }));
document.getElementById('open-cors-image').addEventListener('click', async () => {
  fixture.src = 'http://localhost:43188/cross-origin-image.svg'; await fixture.decode();
  dispatch({ type: 'OPEN_IMAGE', grant: 'fixture', imageToken: crypto.randomUUID(), srcUrl: fixture.currentSrc });
});
document.getElementById('change-image').addEventListener('click', () => { context.fillText('CHANGED', 360, 200); fixture.src = board.toDataURL('image/png'); });
