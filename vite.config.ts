import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

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
                const prompt = body?.prompt;

                if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Missing or empty prompt parameter' }));
                  return;
                }

                const clientKey =
                  (req.headers['x-api-key'] as string) ||
                  (typeof req.headers['authorization'] === 'string'
                    ? req.headers['authorization'].replace(/^Bearer\s+/i, '')
                    : '') ||
                  body?.apiKey;

                const apiKey =
                  env.AICREDITS_API_KEY ||
                  env.VITE_AICREDITS_API_KEY ||
                  process.env.AICREDITS_API_KEY ||
                  process.env.VITE_AICREDITS_API_KEY ||
                  clientKey;

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

                const upstream = await fetch('https://api.aicredits.in/v1/images/generations', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${String(apiKey).trim()}`,
                  },
                  body: JSON.stringify({
                    model: 'black-forest-labs/flux-1-schnell',
                    prompt: prompt.trim(),
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
