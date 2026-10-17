interface Env {
  AICREDITS_API_KEY?: string;
  [key: string]: any;
}

export const DEFAULT_AICREDITS_MODEL = 'black-forest-labs/flux-1-redux-dev';

export const DEFAULT_AICREDITS_PROMPT =
  'A cute chibi character avatar based on the reference input image. Maintain accurate facial likeness, identity, hairstyle, glasses, and clothing. Cute storybook sticker art style with soft volumetric 3D dimensional shading, smooth lighting, adorable rounded chibi proportions like modern Pixar or Animal Crossing, big expressive eyes with glossy catchlights behind clear glasses, soft pink cheek blush, and warm vibrant colors. Front-facing centered portrait bust (head, neck and upper shoulders only), isolated on a pure solid white background. Single character, perfectly centered, high quality digital illustration.';

// Standard CORS headers for cross-origin or local requests
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

/**
 * Strips non-ASCII characters and whitespace to prevent header encoding crashes
 */
function sanitizeKey(val: any): string {
  if (!val || typeof val !== 'string') return '';
  return val
    .trim()
    .replace(/[\r\n\t]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

/**
 * Handle OPTIONS preflight requests
 */
export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

/**
 * Cloudflare Pages Function: /api/generate
 * Secure server-side proxy for AICredits FLUX Redux image-to-image generation.
 */
export const onRequestPost = async (context: {
  request: Request;
  env: Env;
}) => {
  try {
    const { request, env } = context;

    // Parse incoming JSON body
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Body might be empty or invalid JSON
    }

    const rawPrompt = body?.prompt;
    const prompt =
      rawPrompt && typeof rawPrompt === 'string' && rawPrompt.trim()
        ? rawPrompt.trim()
        : DEFAULT_AICREDITS_PROMPT;

    const model = body?.model || DEFAULT_AICREDITS_MODEL;
    const image = body?.image || body?.image_url || body?.redux_image || body?.input_image;

    // Resolve API key priority:
    // 1. Backend environment secret (AICREDITS_API_KEY) configured in Cloudflare Pages
    // 2. Client-provided header (x-api-key or Authorization Bearer)
    // 3. Client-provided key in body (apiKey)
    const clientProvidedKey =
      request.headers.get('x-api-key') ||
      request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ||
      body?.apiKey;

    const apiKey = sanitizeKey(env.AICREDITS_API_KEY || clientProvidedKey);

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            'AICREDITS_API_KEY is not configured. Please add AICREDITS_API_KEY to your Cloudflare Pages environment variables, or enter your API key in the Photo Lab settings.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let effectivePrompt = prompt;

    // When an image is provided, extract the person's visual traits using Gemini 2.5 Flash on AICredits
    if (image) {
      try {
        const visionRes = await fetch('https://api.aicredits.in/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Analyze the person in this image. In 1 concise phrase, describe: gender/age appearance, hairstyle & hair color, glasses/accessories, facial expression & smile, and clothing colors/style. Focus strictly on visual identity traits.',
                  },
                  { type: 'image_url', image_url: { url: image } },
                ],
              },
            ],
          }),
        });

        if (visionRes.ok) {
          const visionData: any = await visionRes.json();
          const visualTraits = visionData.choices?.[0]?.message?.content?.trim();
          if (visualTraits) {
            effectivePrompt = `A cute chibi character avatar of ${visualTraits}. Cute storybook sticker art style with soft volumetric 3D dimensional shading, smooth lighting, adorable rounded chibi proportions like modern Pixar or Animal Crossing, big expressive eyes with glossy catchlights behind clear glasses, soft pink cheek blush, and warm vibrant colors. Front-facing centered portrait bust (head, neck and upper shoulders only), isolated on a pure solid white background. Single character, perfectly centered, no multiple heads, no repeating elements. High quality digital illustration.`;
          }
        }
      } catch (vErr) {
        console.warn('Vision extraction failed, proceeding with prompt template:', vErr);
      }
    }

    // Forward server-to-server to AICredits images generation endpoint
    const upstreamResponse = await fetch('https://api.aicredits.in/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'black-forest-labs/flux-1-schnell',
        prompt: effectivePrompt,
        n: 1,
        size: '1024x1024',
      }),
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      console.error('AICredits upstream error:', upstreamResponse.status, errorText);

      let parsedMessage = errorText;
      try {
        const errJson = JSON.parse(errorText);
        parsedMessage = errJson?.error?.message || errJson?.message || errorText;
      } catch {
        // Keep raw text if not JSON
      }

      return new Response(
        JSON.stringify({
          error: `AICredits API error (${upstreamResponse.status}): ${parsedMessage}`,
        }),
        {
          status: upstreamResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const data: any = await upstreamResponse.json();
    const item = data?.data?.[0] || data?.images?.[0];
    let imageUrl = item?.url;

    // AICredits returns b64_json when hosted URL is null
    if (!imageUrl && item?.b64_json) {
      imageUrl = `data:image/jpeg;base64,${item.b64_json}`;
    }

    if (!imageUrl) {
      return new Response(
        JSON.stringify({
          error: 'AICredits did not return a valid image URL or base64 payload in response.',
          raw: data,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Return clean JSON response with the generated image URL / data URI
    return new Response(
      JSON.stringify({
        success: true,
        url: imageUrl,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    console.error('Error in /api/generate function:', error);
    return new Response(
      JSON.stringify({
        error: error?.message || 'Internal server error while processing image generation.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
};
