# Page Mascot Studio

Turn a photo into a cursor-tracking mascot and 18 downloadable 512×512
transparent WebP stickers.

## What it does

- **Eight preset mascots** (Fox, Bear, Red Panda, Owl, Cat, Astronaut,
  Gearbot, Wizard) on a cursor-tracking stage — eight-way gaze with a dead zone
  so the head settles instead of jittering.
- **Tap the mascot** for a reaction. Rapid taps cycle through nine expressions:
  blink, heart, sparkle, surprised, wink, bashful, sleepy, dizzy, delighted.
- **Make your own** from a photo: the app generates a chibi bust plus two 3×3
  sprite sheets, chroma-keys and torso-locks them, and slices 18 stickers you can
  download individually or as a ZIP.
- **Nothing is lost** — generated mascots are kept in IndexedDB, so they survive
  a refresh and a switch to a preset.
- **Responsive** down to 320px, with 44px tap targets and no horizontal overflow.
- **Touch works**: a drag in the safe middle band steers the gaze; edge swipes
  stay with the operating system.

## How a mascot is made

Three image generations against `google/gemini-3.1-flash-image` (backdrop
`#FB0BF8`):

1. **Bust** — identity anchor.
2. **Directions sheet** — 3×3 grid of the nine gaze angles.
3. **Reactions sheet** — 3×3 grid of the nine expressions.

A fourth, text-only call (`google/gemini-2.5-flash`) describes the bust in one
sentence to reinforce identity; it is non-fatal.

Client side, `src/utils/chromaKey.ts` keys out the backdrop
(`green < min(red, blue) - 55`), extracts the 3×3 grid, locks the torso so all
nine cells share one shoulders/shirt/framing, and repairs any cell whose head is
out of line. `src/utils/proceduralSpriteGenerator.ts` is the fallback ladder if a
sheet is rejected: first the model's own sheet, then a procedural rig from the
bust. `src/utils/stickerSlicer.ts` slices the 1080×1080 sheets into 18 × 512×512
transparent WebP stickers.

## Running

```sh
npm install
cp .env.example .env   # then put your AICREDITS_API_KEY in .env
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api/generate` to the real
Pages Function in `functions/api/generate.ts`, so the two can never drift apart.

## Building and checking

```sh
npm run lint        # oxlint, 0 errors
npm run build       # tsc -b && vite build
```

The gaze behaviour has its own committed harness: open `/gaze-harness.html` while
`npm run dev` is running. It runs 27 assertions covering shadow removal, turn
softness, touch zones, mouse/touch precedence and the crossfade curve.

## Deploying (Cloudflare Pages)

1. Connect the repo to a Cloudflare Pages project.
2. Build command: `npm run build`; output directory: `dist`.
3. In the Pages dashboard, set `AICREDITS_API_KEY` as an environment variable
   for both Production and Preview. Never rename it to a `VITE_*` variable — Vite
   inlines those into the client bundle.
4. Optional overrides: `AICREDITS_IMAGE_MODEL`, `AICREDITS_VISION_MODEL`.

The Pages Function `functions/api/generate.ts` handles the upstream calls and a
per-IP rate limit (10 generations per minute).

## Cost

One successful generation costs **3 credits** (three image calls). A transient
upstream 502 is retried three times with backoff and, since no image is
produced, costs nothing.

## Project layout

```
src/
  App.tsx                       three-section page
  components/                   EnhancedMascot, UploadPanel, StickerPack
  services/mascotService.ts     upload downscaling + generateMascot
  utils/chromaKey.ts            keying, grid extraction, torso lock
  utils/proceduralSpriteGenerator.ts  fallback ladder + bust die-cut
  utils/stickerSlicer.ts        18 x 512 WebP + ZIP
  utils/mascotStorage.ts        IndexedDB persistence
  utils/photoValidator.ts       local photo report
  utils/mascotPoses.ts          the nine gaze angles and nine reactions
functions/api/generate.ts       Cloudflare Pages Function (the only secret holder)
gaze-harness.html               dev-only gaze behaviour harness
PLAN.md                         phase-by-phase implementation log
```

## Licence

MIT.
