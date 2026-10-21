/**
 * Client service for mascot generation.
 *
 * The browser never holds an API key. It sends the user's photo to our own
 * server route (/api/generate), which holds the key and runs the 3-stage
 * generation pipeline server-to-server.
 *
 * Generation prompts live only on the server (functions/api/generate.ts) so
 * the two cannot drift apart.
 */

/** Converts a browser File or Blob into a base64 data URI string. */
export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Longest edge we send to the model, in pixels. A phone photo is often 12MP,
 * and base64 of that runs to tens of megabytes — several gateways reject that
 * outright, and even when they accept it the upload dominates the request time.
 * The model resizes its input anyway, and 1280px holds every facial detail a
 * chibi needs.
 */
const MAX_UPLOAD_EDGE = 1280;

/** JPEG quality for the downscaled upload. */
const UPLOAD_QUALITY = 0.92;

/**
 * Prepares a user photo for upload: decodes it honouring EXIF orientation,
 * downscales anything over MAX_UPLOAD_EDGE on its longest side, and returns a
 * JPEG data URI. Anything unexpected falls back to the untouched file, so an
 * exotic format still uploads rather than blocking the user.
 */
export async function photoForUpload(file: File | Blob): Promise<string> {
  try {
    let bitmap: ImageBitmap;
    try {
      // 'from-image' applies the camera's rotation; older engines reject the
      // option, and an unrotated upload is better than none.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file);
    }

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(srcW, srcH));
    if (scale === 1) {
      bitmap.close();
      return fileToBase64(file);
    }

    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return fileToBase64(file);
    }

    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const dataUrl = canvas.toDataURL('image/jpeg', UPLOAD_QUALITY);
    // A failed encode yields 'data:,' — treat it as unusable.
    if (!dataUrl || dataUrl.startsWith('data:,')) return fileToBase64(file);

    console.info(
      `Upload photo downscaled ${srcW}×${srcH} → ${targetW}×${targetH} ` +
        `(${(file.size / 1024 / 1024).toFixed(1)} MB → ${(dataUrl.length / 1024 / 1024).toFixed(2)} MB)`
    );
    return dataUrl;
  } catch (err) {
    console.warn('Could not downscale photo, uploading the original:', err);
    return fileToBase64(file);
  }
}

export interface GeneratedAssets {
  /** Canonical chibi bust — used as the character preview. */
  bust: string;
  /** 3x3 head-angle sprite sheet, or null if that stage failed. */
  directions: string | null;
  /** 3x3 expression sprite sheet, or null if that stage failed. */
  reactions: string | null;
  /** One-sentence subject description, when the server could produce one. */
  traits?: string;
  /** Upstream reasons or warnings if any sheets could not be drawn. */
  warnings?: string[];
}

/**
 * Sends the photo to the backend and returns the generated mascot assets.
 * No API key is involved on this side.
 *
 * The server runs three image generations, so this needs a generous timeout.
 */
export async function generateMascot(
  photoBase64: string,
  timeoutMs = 240_000
): Promise<GeneratedAssets> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: photoBase64 }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = `Generation failed (${response.status})`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {
        /* keep generic message */
      }
      throw new Error(message);
    }

    const data = await response.json();
    if (!data?.bust) {
      throw new Error('The server did not return a mascot image.');
    }

    return {
      bust: data.bust,
      directions: data.directions ?? null,
      reactions: data.reactions ?? null,
      traits: data.traits,
      warnings: data.warnings,
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Generation timed out. Please try again.');
    }
    console.error('/api/generate request failed:', error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
