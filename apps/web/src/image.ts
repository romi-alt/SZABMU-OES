/** Reads an image file, scales it down to at most `max` px on the longest side and returns a JPEG data URL under `maxBytes` (the server refuses anything larger). */
export async function photoToDataUrl(file: File, max = 256, maxBytes = 150_000): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); const w = Math.max(1, Math.round(bmp.width * k)); const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('This browser cannot process images.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  for (let q = 0.85; q >= 0.4; q -= 0.15) { const url = canvas.toDataURL('image/jpeg', q); if (Math.ceil((url.length - 23) * 0.75) <= maxBytes) return url; }
  throw new Error('The photo is too large. Choose a smaller image.');
}
