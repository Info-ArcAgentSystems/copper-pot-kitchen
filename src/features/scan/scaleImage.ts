/**
 * Shrinking a photo before it is sent.
 *
 * BROWSER ONLY — it needs a canvas. It sits here rather than in `src/scan/`
 * because that directory is imported by tests, which compile without `lib: DOM`
 * on purpose: a test reaching for a browser global should fail to build.
 *
 * WHY IT EXISTS AT ALL. An iPhone photo is around 12 megapixels; base64 inflates
 * it by a third, and the result is a multi-megabyte JSON body that the edge
 * function rejects before the owner sees anything. The failure would look like
 * "the scanner is broken" rather than "that photo was too big".
 *
 * 1600px is comfortably enough for handwriting and lands around a couple of
 * hundred kilobytes. JPEG rather than PNG: a photograph of paper compresses
 * enormously, and PNG would put the size problem straight back.
 */

const MAX_EDGE = 1600;

export async function toScaledDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser could not process the photo.');

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.85);
}
