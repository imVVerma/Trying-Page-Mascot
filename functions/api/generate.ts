interface Env {
  AICREDITS_API_KEY?: string;
  [key: string]: any;
}

// Standard CORS headers for cross-origin or local requests
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

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
 * Secure server-side proxy for AICredits FLUX Schnell generation.
 */
export const onRequestPost = async (context: {
  request: Request;
  env: Env;
}) => {
  try {
    const { request, env } = context;

    // Parse incoming JSON body
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON request body.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const prompt = body?.prompt;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty "prompt" in request body.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Resolve API key priority:
    // 1. Backend environment secret (AICREDITS_API_KEY) configured in Cloudflare Pages
    // 2. Client-provided header (x-api-key or Authorization Bearer)
    // 3. Client-provided key in body (apiKey)
    const clientProvidedKey =
      request.headers.get('x-api-key') ||
      request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ||
      body?.apiKey;

    const apiKey = env.AICREDITS_API_KEY || clientProvidedKey;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            'AICREDITS_API_KEY is not configured. Please add AICREDITS_API_KEY to your Cloudflare Pages environment variables, or enter it in the Photo Lab settings.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Forward server-to-server to AICredits images generation endpoint
    const upstreamResponse = await fetch('https://api.aicredits.in/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: 'black-forest-labs/flux-1-schnell',
        prompt: prompt.trim(),
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

    // AICredits returns b64_json if hosted URL is null
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

    // Return clean JSON response with the generated image URL
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
