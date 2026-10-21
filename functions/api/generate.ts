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
  ' Framing: front-facing head-and-shoulders bust, centered with at least 25% empty magenta background ' +
  'above the topmost hair so the crown is completely intact with generous breathing room above. Shoulders ' +
  'cut off cleanly at the bottom edge. ' +
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
  'CRITICAL SIZE AND HEADROOM RULES — READ CAREFULLY:\n' +
  '- Each portrait is SMALL. The character must fill NO MORE THAN ONE THIRD of its cell.\n' +
  '- Leave at least 25% WIDE EMPTY MAGENTA SPACE ABOVE the top of the hair in EVERY cell. ' +
  'Hair and head must NEVER touch, overlap, or be cropped by the top border of the cell.\n' +
  '- There must be wide empty magenta background on ALL FOUR SIDES of every character.\n' +
  '- No character touches or crosses a cell boundary. Each one is fully enclosed inside its own cell.\n' +
  '- All nine characters are exactly the same size. There are NO lines, frames, dividers, or borders.\n\n' +
  'MANDATORY POSE DIRECTIONS (CRITICAL CONTRAST BY COLUMN):\n' +
  '- COLUMN 1 (Left column: Row 1 left, Row 2 left, Row 3 left): The character\'s head MUST turn physically to the LEFT (3/4 left turn, looking toward the left edge).\n' +
  '- COLUMN 2 (Middle column: Row 1 middle, Row 2 middle, Row 3 middle): The character\'s head MUST face STRICTLY STRAIGHT FORWARD directly at the camera.\n' +
  '- COLUMN 3 (Right column: Row 1 right, Row 2 right, Row 3 right): The character\'s head MUST turn physically to the RIGHT (3/4 right turn, looking toward the right edge).\n' +
  'DO NOT draw the character facing the same direction across different columns!\n\n' +
  'CELL CONTENTS, in order:\n' +
  'Row 1, left cell: head turned 45 degrees up and to the left. Row 1, middle cell: head tilted straight up. ' +
  'Row 1, right cell: head turned 45 degrees up and to the right.\n' +
  'Row 2, left cell: head turned 45 degrees left. Row 2, middle cell: facing strictly straight forward. ' +
  'Row 2, right cell: head turned 45 degrees right.\n' +
  'Row 3, left cell: head turned 45 degrees down and to the left. Row 3, middle cell: head tilted straight ' +
  'down. Row 3, right cell: head turned 45 degrees down and to the right.\n\n' +
  'In every cell the body, shoulders, clothing, hair and glasses stay identical and facing ' +
  'forward; only the head direction changes. Same character, same colours, same art style, same ' +
  'flat vector cartoon look with bold black outlines in all nine.\n\n' +
  BACKGROUND_RULES;

/**
 * Uses the same "nine separate small portraits" skeleton as DIRECTIONS_PROMPT,
 * which is what stopped the model producing one hero subject in the middle of
 * the sheet. Only the per-cell descriptions differ.
 */
const REACTIONS_PROMPT =
  'Using the reference character, draw a sprite sheet containing NINE separate small portraits ' +
  'arranged in a strict 3x3 grid.\n\n' +
  'CRITICAL SIZE AND HEADROOM RULES — READ CAREFULLY:\n' +
  '- Each portrait is SMALL. The character must fill NO MORE THAN ONE THIRD of its cell.\n' +
  '- Leave at least 25% WIDE EMPTY MAGENTA SPACE ABOVE the top of the hair in EVERY cell. ' +
  'Hair and head must NEVER touch, overlap, or be cropped by the top border of the cell.\n' +
  '- There must be wide empty magenta background on ALL FOUR SIDES of every character.\n' +
  '- No character touches or crosses a cell boundary. Each one is fully enclosed inside its own cell.\n' +
  '- EQUAL SCALE ACROSS ALL CELLS: All nine characters are identically sized small busts showing head, shoulders and shirt. ' +
  'The center cell (Row 2, middle cell) is the EXACT SAME small scale as all other cells. Absolutely NO enlarged hero image and NO zoomed-in close-up face anywhere.\n' +
  '- There are NO frames, dividers, or grid lines anywhere. Cells are separated only by plain empty background.\n\n' +
  'MANDATORY EXPRESSION DIVERSITY — EACH CELL MUST HAVE A UNIQUE EXPRESSION:\n' +
  'Row 1, left cell: gentle blink, peaceful closed curved eyelids, soft warm smile (Blink).\n' +
  'Row 1, middle cell: sparkling bright pink heart-shaped eyes sparkling with love, wide happy smile (Heart Eyes).\n' +
  'Row 1, right cell: playful star wink, one eye closed in a cheeky curve, one eye wide open, cheerful smile (Wink).\n' +
  'Row 2, left cell: surprised, wide round open eyes and small open "O" mouth in astonishment (Surprised).\n' +
  'Row 2, middle cell: small bust facing strictly straight forward with a cheerful gentle smile, identical small scale as surrounding cells.\n' +
  'Row 2, right cell: excited eyes with bright 4-point golden anime stars and catchlights, delighted smile (Sparkle).\n' +
  'Row 3, left cell: shy sweet smile, heavy bright rosy anime blush across both cheeks (Bashful).\n' +
  'Row 3, middle cell: hypnosis spiral swirl eyes with wobbly wavy mouth. ONLY this cell has spiral glasses! (Dizzy).\n' +
  'Row 3, right cell: delighted, happy curved eye arcs (^▽^) and big open laughing smile (Delighted Joy).\n\n' +
  'The character is completely identical in all nine cells: same head size, same hair, same glasses, ' +
  'same skin tone, same clothing, same colours, same art style — flat vector cartoon with bold ' +
  'clean black outlines. Only the facial expression differs in each cell.\n\n' +
  BACKGROUND_RULES;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sanitizeKey(val: unknown): string {
  if (!val || typeof val !== 'string') return '';
  let clean = val.trim().replace(/[\r\n\t]/g, '').replace(/[^\x20-\x7E]/g, '');
  if (/^[0-9a-f]{64}$/i.test(clean)) {
    clean = `sk-live-${clean}`;
  }
  return clean;
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
    const bustCall = await generate(BUST_PROMPT, photo);
    if (!bustCall.image) {
      return json(
        { error: bustCall.detail || 'The image model did not return a mascot image.' },
        502
      );
    }
    const bust = bustCall.image;

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
    const [dirCall, reactCall] = await Promise.all([
      generate(DIRECTIONS_PROMPT, bust).catch((err) => {
        console.warn('Directions sheet threw:', err);
        return { image: null, detail: String(err) };
      }),
      generate(REACTIONS_PROMPT, bust).catch((err) => {
        console.warn('Reactions sheet threw:', err);
        return { image: null, detail: String(err) };
      }),
    ]);

    // A sheet that came back empty is not fatal — the client rebuilds it
    // procedurally — but the reason belongs in the log, not silently dropped.
    if (!dirCall.image) console.warn('Directions sheet failed:', dirCall.detail);
    if (!reactCall.image) console.warn('Reactions sheet failed:', reactCall.detail);

    const warnings = [
      dirCall.image ? null : dirCall.detail,
      reactCall.image ? null : reactCall.detail,
    ].filter(Boolean) as string[];

    return json({
      success: true,
      bust,
      directions: dirCall.image,
      reactions: reactCall.image,
      warnings: warnings.length > 0 ? warnings : undefined,
      traits: traits || undefined,
      model,
    });
  } catch (error: any) {
    console.error('Error in /api/generate:', error);
    return json({ error: error?.message || 'Internal server error.' }, 500);
  }
};

/** Result of one image call. `detail` is empty on success and safe to show a user. */
interface ImageCallResult {
  image: string | null;
  detail: string;
}

/**
 * Upstream statuses worth retrying on our side: the provider failed, the
 * request was fine. A 502 from the gateway is the common one in practice, and
 * making the user start over for it wastes a generation and their credits.
 */
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
/** Backoff between attempts; attempt N waits (N-1) × this. */
const RETRY_BASE_MS = 1500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Shortens upstream text for an error message and strips the credential out of
 * it, so a gateway that echoes the request back cannot leak the key into a
 * message that gets rendered in the browser.
 */
function snippet(text: string, apiKey: string, max = 220): string {
  const safe = apiKey ? text.split(apiKey).join('[redacted]') : text;
  const oneLine = safe.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * One image-to-image call, retrying transient provider faults.
 *
 * Failures carry a reason rather than a bare null: a rejected request, a
 * 200 whose body holds no image, or a text-only reply (a refusal, or a gateway
 * message) all used to end up as the same generic "did not return a mascot
 * image", which is useless when debugging a real generation.
 */
async function callImageModel(
  apiKey: string,
  model: string,
  prompt: string,
  inputImage: string
): Promise<ImageCallResult> {
  const payloadMb = (inputImage.length / 1024 / 1024).toFixed(1);
  const body = JSON.stringify({
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
  });

  let detail = 'The image model did not return a mascot image.';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const wait = RETRY_BASE_MS * (attempt - 1);
      console.warn(`Image call failed (${detail}) — retrying in ${wait}ms (attempt ${attempt}/${MAX_ATTEMPTS}).`);
      await sleep(wait);
    }

    let res: Response;
    try {
      res = await fetch(`${UPSTREAM_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });
    } catch (netErr: any) {
      // Typically an oversized body or a dropped connection mid-upload.
      console.error(`Image model request failed (attempt ${attempt}):`, netErr);
      detail =
        `Could not reach the image model (${netErr?.message || 'network error'}). ` +
        `The photo was sent as ${payloadMb} MB of base64.`;
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      console.error(`Image model error (${res.status}) on attempt ${attempt}:`, text.slice(0, 500));
      detail = `The image model returned HTTP ${res.status}: ${snippet(text, apiKey)}`;
      // Only transient faults are worth another attempt; a 400 or 401 will
      // fail identically forever.
      if (RETRY_STATUSES.has(res.status)) continue;
      return { image: null, detail };
    }

    // The provider answered 2xx, so nothing is retryable past this point.
    let data: any;
    try {
      data = await res.json();
    } catch (parseErr) {
      console.error('Image model returned a non-JSON body:', parseErr);
      return { image: null, detail: 'The image model returned a response that was not JSON.' };
    }

    const image = extractImage(data);
    if (image) return { image, detail: '' };

    // A 200 with no image is almost always a text reply. Show what the model
    // actually said instead of leaving it in the server log.
    const message = data?.choices?.[0]?.message;
    let said = typeof message?.content === 'string' ? message.content : '';
    if (Array.isArray(message?.content)) {
      said = message.content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join(' ')
        .trim();
    }
    console.error('Image model returned no image. Body:', JSON.stringify(data).slice(0, 800));

    return {
      image: null,
      detail: said.trim()
        ? `The image model replied with text instead of an image: "${snippet(said, apiKey)}"`
        : `The image model replied 200 OK, but no image was present in the response ` +
          `(${payloadMb} MB request).`,
    };
  }

  return { image: null, detail };
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
