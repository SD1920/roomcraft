// The phone's side of Gemini detection: send the frame to the laptop's
// /api/detect endpoint (the laptop's dev server, or the deployed site's function) and get boxes back in the on-phone detector's shape.

/** A camera frame (ImageData) as a base64 JPEG, without the data: prefix. */
export function jpegBase64(image, quality = 0.8) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

/**
 * @param frame {jpeg: base64 string, width, height}, or {image: ImageData, ...}
 * @returns {Promise<{items: {label, score, box}[], dropped: number, model: string, ms: number}>}
 */
export async function geminiDetect(frame) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: frame.jpeg ?? jpegBase64(frame.image), width: frame.width, height: frame.height }),
    });
  } catch (e) {
    throw new Error(`could not reach the server (${e.message})`);
  }
  const body = await res.json().catch(() => null);
  if (res.status === 404) throw new Error('this server has no /api/detect (on the laptop: npm run dev:wifi)');
  if (!res.ok) throw new Error(body?.error ?? `server said ${res.status}`);
  return { ...body, roundTripMs: Math.round(performance.now() - t0) };
}
