import { InferenceClient } from '@huggingface/inference';

/**
 * Retrieves the active Hugging Face token from:
 * 1. An explicitly passed custom token
 * 2. Vite environment variable `VITE_HF_TOKEN`
 * 3. Browser `localStorage` ('hf_user_token')
 * 4. Node `process.env.VITE_HF_TOKEN` (if in test/SSR environment)
 */
export function getHfToken(customToken?: string): string {
  if (customToken && customToken.trim()) {
    return customToken.trim();
  }

  // Vite client env
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_HF_TOKEN) {
    return import.meta.env.VITE_HF_TOKEN;
  }

  // Local storage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem('hf_user_token');
    if (saved && saved.trim()) return saved.trim();
  }

  // Node fallback
  if (typeof process !== 'undefined' && process.env?.VITE_HF_TOKEN) {
    return process.env.VITE_HF_TOKEN;
  }

  return '';
}

export function saveHfToken(token: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    if (token && token.trim()) {
      window.localStorage.setItem('hf_user_token', token.trim());
    } else {
      window.localStorage.removeItem('hf_user_token');
    }
  }
}

export function hasHfToken(customToken?: string): boolean {
  return Boolean(getHfToken(customToken));
}

export interface VectorGenerationOptions {
  prompt?: string;
  guidanceScale?: number;
  numInferenceSteps?: number;
  customToken?: string;
}

/**
 * Transforms a user photo into a clean 2D chibi vector clipart illustration
 * using black-forest-labs/FLUX.1-Kontext-dev routed through fal-ai on Hugging Face.
 */
export async function generateVectorMascotFromPhoto(
  imageBlob: Blob,
  options?: VectorGenerationOptions
): Promise<Blob> {
  const token = getHfToken(options?.customToken);

  if (!token) {
    throw new Error(
      'Hugging Face API token is required. Please set VITE_HF_TOKEN in your .env file or enter your token in the Photo Lab settings.'
    );
  }

  const client = new InferenceClient(token);

  try {
    const prompt =
      options?.prompt ||
      'Convert this person into a clean 2D chibi vector illustration style, bold black outlines, flat pastel coloring, minimalist anime eyes, isolated on a pure white background, 3x3 grid style reference.';

    // Call FLUX.1-Kontext-dev via Hugging Face Inference Providers (fal-ai routing)
    const resultBlob = await client.imageToImage({
      model: 'black-forest-labs/FLUX.1-Kontext-dev',
      provider: 'fal-ai',
      inputs: imageBlob,
      parameters: {
        prompt,
        guidance_scale: options?.guidanceScale ?? 2.5,
        num_inference_steps: options?.numInferenceSteps ?? 28,
      },
    });

    return resultBlob; // Returns the generated vector clipart image Blob
  } catch (error: any) {
    console.error('Failed to generate vector mascot via Hugging Face:', error);
    const message =
      error?.message ||
      'Hugging Face FLUX.1-Kontext-dev generation failed. Please verify your token permissions and inference provider billing.';
    throw new Error(message);
  }
}
