/**
 * Frontend Service: AICredits Mascot Generation
 * Makes a secure request to our backend route (/api/generate)
 * which forwards server-to-server to AICredits, eliminating browser CORS issues.
 * 
 * Supports image-conditioned generation using black-forest-labs/flux-1-redux-dev.
 */

export const DEFAULT_AICREDITS_MODEL = 'black-forest-labs/flux-1-schnell';

export const DEFAULT_AICREDITS_PROMPT =
  'A cute chibi character avatar based on the reference input image. Maintain accurate facial likeness, identity, hairstyle, glasses, and clothing. Cute storybook sticker art style with soft volumetric 3D dimensional shading, smooth lighting, adorable rounded chibi proportions like modern Pixar or Animal Crossing, big expressive eyes with glossy catchlights behind clear glasses, soft pink cheek blush, and warm vibrant colors. Front-facing centered portrait bust (head, neck and upper shoulders only), isolated on a pure solid white background. Single character, perfectly centered, high quality digital illustration.';

/**
 * Converts a browser File or Blob into a base64 Data URI string.
 */
export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Strips non-ASCII characters, invisible whitespace, and trims strings
 * to prevent the browser fetch "String contains non ISO-8859-1 code point" crash.
 */
export function sanitizeHeaderValue(val: string): string {
  if (!val) return '';
  return val
    .trim()
    .replace(/[\r\n\t]/g, '')
    // Retain only printable ASCII characters (0x20 to 0x7E)
    .replace(/[^\x20-\x7E]/g, '');
}

/**
 * Retrieves the active AICredits API key from:
 * 1. An explicitly passed custom key
 * 2. Vite environment variable `VITE_AICREDITS_API_KEY` (if available on client)
 * 3. Browser `localStorage` ('aicredits_api_key')
 */
export function getAiCreditsApiKey(customKey?: string): string {
  if (customKey && customKey.trim()) {
    return sanitizeHeaderValue(customKey);
  }

  // Vite client env
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AICREDITS_API_KEY) {
    return sanitizeHeaderValue(import.meta.env.VITE_AICREDITS_API_KEY);
  }

  // Local storage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem('aicredits_api_key');
    if (saved && saved.trim()) return sanitizeHeaderValue(saved);
  }

  return '';
}

export function saveAiCreditsApiKey(apiKey: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    const sanitized = sanitizeHeaderValue(apiKey);
    if (sanitized) {
      window.localStorage.setItem('aicredits_api_key', sanitized);
    } else {
      window.localStorage.removeItem('aicredits_api_key');
    }
  }
}

export function hasAiCreditsApiKey(customKey?: string): boolean {
  return Boolean(getAiCreditsApiKey(customKey));
}

/**
 * Generates an image-conditioned 3x3 vector mascot sprite sheet via our backend proxy route /api/generate
 * (Cloudflare Pages Function in production / Vite server middleware locally).
 * Sends user reference image for black-forest-labs/flux-1-redux-dev.
 */
export async function generateMascotFromAI(
  userPrompt?: string,
  imageInput?: string | File | Blob,
  customApiKey?: string,
  timeoutMs: number = 40000
): Promise<string> {
  const apiKey = getAiCreditsApiKey(customApiKey);
  const prompt = userPrompt && userPrompt.trim() ? userPrompt.trim() : DEFAULT_AICREDITS_PROMPT;

  // Convert imageInput to base64 string if needed
  let base64Image: string | undefined;
  if (imageInput) {
    if (typeof imageInput === 'string') {
      base64Image = imageInput;
    } else {
      base64Image = await fileToBase64(imageInput);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // If a key was provided in Photo Lab or client env, pass it along sanitized
  if (apiKey) {
    headers['x-api-key'] = sanitizeHeaderValue(apiKey);
  }

  // Timeout guard using AbortController
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`AICredits generation timed out after ${timeoutMs / 1000}s`));
  }, timeoutMs);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: DEFAULT_AICREDITS_MODEL,
        prompt,
        image: base64Image || undefined,
        image_url: base64Image || undefined,
        redux_image: base64Image || undefined,
        input_image: base64Image || undefined,
        apiKey: apiKey || undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      let errorMessage = `Server responded with status ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage =
            typeof errorData.error === 'string'
              ? errorData.error
              : JSON.stringify(errorData.error);
        }
      } catch {
        // Fallback to generic status error
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data?.url) {
      throw new Error('Server response did not contain a generated image URL.');
    }

    return data.url;
  } catch (error: any) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') {
      throw new Error(`AICredits request timed out after ${timeoutMs / 1000} seconds.`);
    }
    console.error('AICredits /api/generate request failed:', error);
    throw error;
  }
}
