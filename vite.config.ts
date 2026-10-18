import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { onRequestPost, onRequestOptions } from './functions/api/generate.ts'

// Local dev proxies /api/generate to the real Cloudflare Pages Function so the
// two can never drift apart. Delete functions/api/generate.ts's logic here and
// this follows automatically.
async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (ctx: { request: Request; env: Record<string, string> }) => Promise<Response>
) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const rawBody = Buffer.concat(chunks).toString('utf8')

  const url = `http://localhost${req.url ?? '/'}`;
  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).reduce<Record<string, string>>((acc, [k, v]) => {
      if (typeof v === 'string') acc[k] = v
      return acc
    }, {}),
    body: rawBody || undefined,
  })

  const response = await handler({ request, env: process.env as Record<string, string> })

  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  res.writeHead(response.status, headers)
  res.end(Buffer.from(await response.arrayBuffer()))
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Keep server-only secrets on process.env for the dev middleware.
  // `loadEnv` is deliberately NOT spread into `define`, so nothing leaks to the client.
  Object.assign(process.env, env)

  return {
    plugins: [
      react(),
      {
        name: 'cloudflare-pages-api-dev-middleware',
        configureServer(server) {
          server.middlewares.use('/api/generate', async (req, res, next) => {
            try {
              if (req.method === 'OPTIONS') {
                await handleApi(req, res, onRequestOptions as any)
                return
              }
              if (req.method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Method Not Allowed' }))
                return
              }
              await handleApi(req, res, onRequestPost as any)
            } catch (err) {
              next(err as Error)
            }
          })
        },
      },
    ],
  }
})
