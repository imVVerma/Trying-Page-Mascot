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

export interface GeneratedAssets {
  /** Canonical chibi bust — used as the character preview. */
  bust: string;
  /** 3x3 head-angle sprite sheet, or null if that stage failed. */
  directions: string | null;
  /** 3x3 expression sprite sheet, or null if that stage failed. */
  reactions: string | null;
  /** One-sentence subject description, when the server could produce one. */
  traits?: string;
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
