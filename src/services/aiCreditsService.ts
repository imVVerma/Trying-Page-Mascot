/**
 * Frontend Service: AICredits Mascot Generation
 * Makes a secure request to our backend route (/api/generate)
 * which forwards server-to-server to AICredits, eliminating browser CORS issues.
 */

/**
 * Retrieves the active AICredits API key from:
 * 1. An explicitly passed custom key
 * 2. Vite environment variable `VITE_AICREDITS_API_KEY` (if available on client)
 * 3. Browser `localStorage` ('aicredits_api_key')
 */
export function getAiCreditsApiKey(customKey?: string): string {
  if (customKey && customKey.trim()) {
    return customKey.trim();
  }

  // Vite client env
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AICREDITS_API_KEY) {
    return import.meta.env.VITE_AICREDITS_API_KEY;
  }

  // Local storage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem('aicredits_api_key');
    if (saved && saved.trim()) return saved.trim();
  }

  return '';
}

export function saveAiCreditsApiKey(apiKey: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    if (apiKey && apiKey.trim()) {
      window.localStorage.setItem('aicredits_api_key', apiKey.trim());
    } else {
      window.localStorage.removeItem('aicredits_api_key');
    }
  }
}

export function hasAiCreditsApiKey(customKey?: string): boolean {
  return Boolean(getAiCreditsApiKey(customKey));
}

/**
 * Generates a clean 2D chibi mascot image via our backend serverless route /api/generate
 * (Cloudflare Pages Function in production / Vite server middleware locally).
 */
export async function generateMascotFromAI(
  userPrompt: string,
  customApiKey?: string
): Promise<string> {
  const apiKey = getAiCreditsApiKey(customApiKey);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // If a key was provided in Photo Lab or client env, pass it along so the server can use it
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: userPrompt,
        apiKey: apiKey || undefined,
      }),
    });

    if (!response.ok) {
      let errorMessage = `Server responded with status ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage = typeof errorData.error === 'string'
            ? errorData.error
            : JSON.stringify(errorData.error);
        }
      } catch {
        // Use default fallback error message
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data?.url) {
      throw new Error('Server response did not contain a generated image URL.');
    }

    return data.url;
  } catch (error: any) {
    console.error('AICredits /api/generate generation failed:', error);
    throw error;
  }
}
