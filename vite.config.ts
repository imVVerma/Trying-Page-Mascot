import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_AICREDITS_MODEL = 'black-forest-labs/flux-1-redux-dev';

const DEFAULT_AICREDITS_PROMPT =
  'A cute chibi character avatar based on the reference input image. Maintain accurate facial likeness, identity, hairstyle, glasses, and clothing. Cute storybook sticker art style with soft volumetric 3D dimensional shading, smooth lighting, adorable rounded chibi proportions like modern Pixar or Animal Crossing, big expressive eyes with glossy catchlights behind clear glasses, soft pink cheek blush, and warm vibrant colors. Front-facing centered portrait bust (head, neck and upper shoulders only), isolated on a pure solid white background. Single character, perfectly centered, high quality digital illustration.';

function sanitizeKey(val: any): string {
  if (!val || typeof val !== 'string') return '';
  return val
    .trim()
    .replace(/[\r\n\t]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'cloudflare-pages-api-dev-middleware',
        configureServer(server) {
          // Emulate /api/generate in local Vite dev server so localhost works seamlessly
          server.middlewares.use('/api/generate', (req, res) => {
            if (req.method === 'OPTIONS') {
              res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
              });
              res.end();
              return;
            }

            if (req.method !== 'POST') {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }

            let bodyStr = '';
            req.on('data', (chunk) => {
              bodyStr += chunk;
            });

            req.on('end', async () => {
              try {
                const body = bodyStr ? JSON.parse(bodyStr) : {};
                const prompt =
                  body?.prompt && typeof body.prompt === 'string' && body.prompt.trim()
                    ? body.prompt.trim()
                    : DEFAULT_AICREDITS_PROMPT;

                const model = body?.model || DEFAULT_AICREDITS_MODEL;
                const image = body?.image || body?.image_url || body?.redux_image || body?.input_image;

                const clientKey =
                  (req.headers['x-api-key'] as string) ||
                  (typeof req.headers['authorization'] === 'string'
                    ? req.headers['authorization'].replace(/^Bearer\s+/i, '')
                    : '') ||
                  body?.apiKey;

                const apiKey = sanitizeKey(
                  env.AICREDITS_API_KEY ||
                  env.VITE_AICREDITS_API_KEY ||
                  process.env.AICREDITS_API_KEY ||
                  process.env.VITE_AICREDITS_API_KEY ||
                  clientKey
                );

                if (!apiKey) {
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(
                    JSON.stringify({
                      error:
                        'AICREDITS_API_KEY is not configured. Please add AICREDITS_API_KEY to your .env file or enter your API key in the Photo Lab settings.',
                    })
                  );
                  return;
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

                const upstream = await fetch('https://api.aicredits.in/v1/images/generations', {
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

                if (!upstream.ok) {
                  const errorText = await upstream.text();
                  res.writeHead(upstream.status, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                  });
                  res.end(
                    JSON.stringify({
                      error: `AICredits API error (${upstream.status}): ${errorText}`,
                    })
                  );
                  return;
                }

                const data: any = await upstream.json();
                const item = data?.data?.[0] || data?.images?.[0];
                let imageUrl = item?.url;

                // AICredits returns b64_json if hosted URL is null
                if (!imageUrl && item?.b64_json) {
                  imageUrl = `data:image/jpeg;base64,${item.b64_json}`;
                }

                if (!imageUrl) {
                  res.writeHead(502, { 'Content-Type': 'application/json' });
                  res.end(
                    JSON.stringify({
                      error: 'AICredits did not return a valid image URL or base64 data in response.',
                      raw: data,
                    })
                  );
                  return;
                }

                res.writeHead(200, {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ success: true, url: imageUrl }));
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: err?.message || 'Local server proxy error while generating image.',
                  })
                );
              }
            });
          });
        },
      },
    ],
  };
});
