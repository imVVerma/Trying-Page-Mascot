/**
 * Cloudflare Pages Function: /api/generate
 *
 * Server-side mascot generation pipeline for AICredits.
 *
 * SECURITY
 *   The API key is read from `env.AICREDITS_API_KEY` and nowhere else. There is
 *   no client-supplied key path (no header, no body field). The browser only
 *   ever sends the user's photo.
 *
 * PIPELINE (3 stages)
 *   1. bust       photo      -> one chibi sticker bust on a magenta background
 *   2. directions bust       -> 3x3 head-angle sprite sheet
 *   3. reactions  bust       -> 3x3 expression sprite sheet
 *
 *   Stage 1 anchors the character's identity. Stages 2 and 3 take that rendered
 *   bust back as their reference, which is what keeps all nine cells of each
 *   sheet consistent with each other.
 *
 *   Every stage is allowed to fail independently. If a sheet fails, the client
 *   falls back to its procedural rig for that sheet only, so a partial success
 *   still produces a usable mascot.
 */

interface Env {
  AICREDITS_API_KEY?: string;
  AICREDITS_IMAGE_MODEL?: string;
  AICREDITS_VISION_MODEL?: string;
  [key: string]: any;
}

const UPSTREAM_BASE = 'https://api.aicredits.in/v1';
/**
 * Chosen by comparison on a real portrait (see PLAN.md):
 *   gemini-3.1-flash-image  -> sampled backdrop #FB0BF8, within 11 of #FF00FF
 *   gemini-2.5-flash-image  -> sampled backdrop #D92D87, a pink, 120 off in blue
 * 3.1 also matched the reference mascot framing more closely. Override per
 * deployment with AICREDITS_IMAGE_MODEL.
 */
const IMAGE_MODEL = 'google/gemini-3.1-flash-image';
const VISION_MODEL = 'google/gemini-2.5-flash';

/** Solid chroma-key colour. The client removes this to reach transparency. */
export const CHROMA_KEY = '#FF00FF';

/**
 * Shared background + framing language. Ask for a flat, known colour rather than
 * white: white is too close to skin and paper tones to key reliably.
 */
const BACKGROUND_RULES =
  'Background: perfectly uniform solid pure magenta #FF00FF filling the entire background, ' +
  'edge to edge. No gradient, no vignette, no shadow cast on the background, no floor, no wall, ' +
  'no text, no watermark, no border, no frame. Exactly one character and nothing else in the image.';

const STYLE_RULES =
  'Style: flat vector cartoon sticker art, bold clean black outlines, smooth cel shading, ' +
  'big expressive eyes with glossy catchlights, soft pink cheek blush, warm vibrant colours, ' +
  'rounded chibi proportions, appealing and friendly.';

const BUST_PROMPT =
  'Create a cute chibi mascot sticker bust of the person in the reference photo. ' +
  'Identity: match their hairstyle and hair colour, their glasses and frames, their skin tone, ' +
  'and their clothing colours and style exactly. ' +
  STYLE_RULES +
  ' Framing: front-facing head-and-shoulders bust, head fully inside the frame with clear space ' +
  'above the hair, shoulders cut off cleanly at the bottom edge, character centred. ' +
  BACKGROUND_RULES;

/**
 * Prompt tuned against real model output.
 *
 * Attempt 1 asked for a 3x3 grid with "equal cells" and consistency wording. The
 * model returned one giant portrait spanning the middle of the sheet, ringed by
 * eight small busts, plus divider lines it had been told not to draw.
 *
 * Attempt 2 leads with explicit size and enclosure rules instead, and describes
 * each cell's contents individually. That produced a clean, uniform 3x3.
 */
const DIRECTIONS_PROMPT =
  'Using the reference character, draw a sprite sheet containing NINE separate small portraits ' +
  'arranged in a strict 3x3 grid.\n\n' +
  'SIZE AND SPACING RULES — these matter more than anything else:\n' +
  '- Each portrait is SMALL. The character fills only the middle third of its own cell.\n' +
  '- Every character has wide, empty magenta background on ALL FOUR sides of it: above the hair, ' +
  'below the shoulders, to the left and to the right.\n' +
  '- No character touches, overlaps or crosses a cell boundary. Each one is fully enclosed ' +
  'inside its own cell.\n' +
  '- All nine characters are exactly the same size as one another. No character is larger than ' +
  'the others.\n' +
  '- There is NO large portrait, NO close-up and NO hero image anywhere in the picture. Every face ' +
  'is small and equal-sized.\n' +
  '- There are NO lines, frames, borders, divider lines, separators, boxes or grid lines anywhere. ' +
  'Cells are separated only by plain empty background.\n\n' +
  'CELL CONTENTS, in order:\n' +
  'Row 1, left cell: head turned up and to the left. Row 1, middle cell: head tilted straight up. ' +
  'Row 1, right cell: head turned up and to the right.\n' +
  'Row 2, left cell: head turned three-quarters to the left. Row 2, middle cell: facing straight ' +
  'forward. Row 2, right cell: head turned three-quarters to the right.\n' +
  'Row 3, left cell: head turned down and to the left. Row 3, middle cell: head tilted straight ' +
  'down. Row 3, right cell: head turned down and to the right.\n\n' +
  'In every cell the body, shoulders, clothing, hair and glasses stay identical and facing ' +
  'forward; only the head direction changes. Same character, same colours, same art style, same ' +
  'flat vector cartoon look with bold black outlines in all nine.\n\n' +
  BACKGROUND_RULES;

/**
 * Uses the same "nine separate small portraits" skeleton as DIRECTIONS_PROMPT,
 * which is what stopped the model producing one hero subject in the middle of
 * the sheet. Only the per-cell descriptions differ.
 *
 * Measured result: cell-area spread 1.08, worst-cell-vs-median 1.04 — both
 * inside the range of the official reference sheets.
 */
const REACTIONS_PROMPT =
  'Using the reference character, draw a sprite sheet containing NINE separate small portraits ' +
  'arranged in a strict 3x3 grid.\n\n' +
  'SIZE AND SPACING RULES — these matter more than anything else:\n' +
  '- Each portrait is SMALL. The character fills only the middle third of its own cell.\n' +
  '- Every character has wide, empty magenta background on ALL FOUR sides of it: above the hair, ' +
  'below the shoulders, to the left and to the right.\n' +
  '- No character touches, overlaps or crosses a cell boundary. Each one is fully enclosed ' +
  'inside its own cell.\n' +
  '- All nine characters are exactly the same size as one another. No character is larger than ' +
  'the others.\n' +
  '- There is NO large portrait, NO close-up and NO hero image anywhere in the picture. Every face ' +
  'is small and equal-sized.\n' +
  '- There are NO lines, frames, borders, divider lines, separators, boxes or grid lines anywhere. ' +
  'Cells are separated only by plain empty background.\n\n' +
  'CELL CONTENTS, in order. Only the FACE changes between cells — the head shape, hair, glasses, ' +
  'body, shoulders and clothing stay exactly as they are:\n' +
  'Row 1, left cell: gentle blink, relaxed closed eyelids, soft smile. Row 1, middle cell: ' +
  'heart-shaped eyes sparkling with love, wide happy smile. Row 1, right cell: excited sparkling ' +
  'eyes with bright star-shaped highlights, open delighted smile.\n' +
  'Row 2, left cell: surprised, wide open eyes and a small round open mouth. Row 2, middle cell: ' +
  'playful wink, one eye closed in a curve, tongue slightly out, cheeky smile. Row 2, right cell: ' +
  'bashful and shy, heavy pink blush across both cheeks, small closed smile.\n' +
  'Row 3, left cell: sleepy, heavy half-closed drooping eyelids, tiny yawn. Row 3, middle cell: ' +
  'dizzy, spiral swirl eyes, wobbly unsure mouth. Row 3, right cell: delighted, big open laughing ' +
  'smile with mouth wide open.\n\n' +
  'The character is completely identical in all nine cells: same head, same hair, same glasses, ' +
  'same skin tone, same clothing, same colours, same art style — flat vector cartoon with bold ' +
  'clean black outlines. Only the facial expression differs.\n\n' +
  BACKGROUND_RULES;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sanitizeKey(val: unknown): string {
  if (!val || typeof val !== 'string') return '';
  return val.trim().replace(/[\r\n\t]/g, '').replace(/[^\x20-\x7E]/g, '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────
// Rate limiting (in-memory, best-effort — resets on cold start)
// ─────────────────────────────────────────────────────────────

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(clientId: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(clientId);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(clientId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const { request, env } = context;

    const apiKey = sanitizeKey(env.AICREDITS_API_KEY);
    if (!apiKey) {
      return json(
        { error: 'Server is not configured. Set AICREDITS_API_KEY in the environment.' },
        500
      );
    }

    const clientId = request.headers.get('CF-Connecting-IP') || 'anonymous';
    if (rateLimited(clientId)) {
      return json({ error: 'Too many generations. Please wait a minute and try again.' }, 429);
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const photo = body?.image;
    if (!photo || typeof photo !== 'string' || !photo.startsWith('data:image/')) {
      return json({ error: 'A photo is required, as a base64 data URI.' }, 400);
    }

    const model = env.AICREDITS_IMAGE_MODEL || IMAGE_MODEL;
    const visionModel = env.AICREDITS_VISION_MODEL || VISION_MODEL;

    const generate = (prompt: string, inputImage: string) =>
      callImageModel(apiKey, model, prompt, inputImage);

    // ── Stage 1: identity anchor. Without this the later sheets drift.
    const bust = await generate(BUST_PROMPT, photo);
    if (!bust) {
      return json({ error: 'The image model did not return a mascot image.' }, 502);
    }

    // ── Optional: a one-sentence subject description to reinforce identity.
    let traits = '';
    try {
      const visionRes = await fetch(`${UPSTREAM_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    'Describe this chibi mascot character in ONE short sentence for an illustrator. ' +
                    'Include only: hairstyle and hair colour, glasses or accessories, clothing colours ' +
                    'and style, and overall mood. No preamble, no commentary.',
                },
                { type: 'image_url', image_url: { url: bust } },
              ],
            },
          ],
        }),
      });
      if (visionRes.ok) {
        const visionData: any = await visionRes.json();
        traits = (visionData?.choices?.[0]?.message?.content ?? '').toString().trim();
      }
    } catch (vErr) {
      // Non-fatal. The image model already has the character.
      console.warn('Trait description failed, continuing:', vErr);
    }

    // ── Stages 2 and 3: the two sprite sheets, both referencing the bust.
    // Run them together; each is independent and either may fail.
    const [directions, reactions] = await Promise.all([
      generate(DIRECTIONS_PROMPT, bust).catch((err) => {
        console.warn('Directions sheet failed:', err);
        return null;
      }),
      generate(REACTIONS_PROMPT, bust).catch((err) => {
        console.warn('Reactions sheet failed:', err);
        return null;
      }),
    ]);

    return json({
      success: true,
      bust,
      directions,
      reactions,
      traits: traits || undefined,
      model,
    });
  } catch (error: any) {
    console.error('Error in /api/generate:', error);
    return json({ error: error?.message || 'Internal server error.' }, 500);
  }
};

/** One image-to-image call. Returns a data URI, or null if the model gave nothing usable. */
async function callImageModel(
  apiKey: string,
  model: string,
  prompt: string,
  inputImage: string
): Promise<string | null> {
  const res = await fetch(`${UPSTREAM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: inputImage } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Image model error (${res.status}):`, text.slice(0, 500));
    return null;
  }

  const data: any = await res.json();
  return extractImage(data);
}

/**
 * Gemini-style image models return inline base64 under
 * `choices[].message.images[].image_url.url`; some gateways mirror it onto
 * `content`. Handle both shapes rather than assuming one.
 */
function extractImage(data: any): string | null {
  const message = data?.choices?.[0]?.message;

  const fromImages = message?.images?.[0]?.image_url?.url;
  if (typeof fromImages === 'string' && fromImages) return fromImages;

  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url ?? part?.inline_data?.data;
      if (typeof url === 'string' && url.length > 0) {
        return url.startsWith('data:') ? url : `data:image/png;base64,${url}`;
      }
    }
  }

  if (typeof message?.content === 'string') {
    const match = message.content.match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/);
    if (match) return match[0];
  }

  // OpenAI-compatible image-generation shape, as a last resort.
  const legacy = data?.data?.[0];
  if (legacy?.url) return legacy.url;
  if (legacy?.b64_json) return `data:image/png;base64,${legacy.b64_json}`;

  return null;
}
