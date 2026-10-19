# Mascot Studio — Implementation Plan & Status

## Phase status

| Phase | Scope | Status |
|---|---|---|
| **0** | Stop the bleeding (revoke key, strip leaks) | **Done** |
| **4** | Hardcode key server-side, zero key UI | **Done** |
| **3** | Simplify the UI | **Done** |
| **5** | Mobile responsive | **Done** (layout) |
| **1b** | Per-cell alignment (fixes jitter) | **Done** — 0.34 → 0.003 |
| **1c** | Persist generated mascots | **Done** — IndexedDB + cache |
| **1e** | Torso lock | **Done** — torso pixel-identical |
| **1f** | Tap highlight + touch gaze | **Done** |
| **1g** | Down-row head clipping | **Partial** — see below |
| **1** | Generation pipeline | Prompts validated; live run pending |
| **2** | Cursor feel | Done via 1e/1f |
| **6** | Cleanup + README | Not started |

---

## Phase 0 + 4 — completed

### Security
- Rotated `AICREDITS_API_KEY` (the old one was revoked by the owner).
- Deleted 4 `.mjs` scripts that hardcoded the key; added `AEvals/`, `scratch*/`,
  `custom__dsc_*` to `.gitignore`.
- `.env` now holds only `AICREDITS_API_KEY`. Removed `VITE_AICREDITS_API_KEY` and
  `VITE_HF_TOKEN` — Vite inlines every `VITE_*` var into the client bundle, which
  published the key to visitors.
- Verified: `dist/assets/*.js` contains **zero** secret literals.

> Remaining: the revoked key is still in git history across 3 commits
> (`58587c1`, `fe629fd`, `4203a28`). Rewrite history or rotate-and-forget.

### Server (`functions/api/generate.ts`)
- Key read **only** from `env.AICREDITS_API_KEY`. Removed the `x-api-key` header,
  `Authorization` bearer, and `body.apiKey` fallbacks.
- **Bug fix — the photo now actually reaches the image model.** Previously the
  photo was used only for a vision pass; the image call sent text only, so the
  model invented a random person. Both upstream calls now attach
  `image_url: { url: image }`.
- Switched to `google/gemini-2.5-flash-image` (confirmed live on the account,
  alongside `gemini-3.1-flash-image` and `gemini-nano-banana-2.1`).
- Prompt rewritten to request a **solid magenta `#FF00FF` background** so the
  browser can key it out exactly, replacing the old white-background request that
  made keying unreliable.
- Added in-memory rate limiting (12 req/min per IP).
- Added `extractImage()` handling all three gateway response shapes.

### Dev/prod parity
`vite.config.ts` no longer duplicates the handler — it imports the real function,
so the two cannot drift apart again.

### Client
- Deleted `vectorMascotService.ts` (browser-side Hugging Face calls).
- Renamed `aiCreditsService.ts` → `mascotService.ts`; removed every key getter,
  setter, `localStorage` write, and `import.meta.env.VITE_*` read.
- Removed from `App.tsx`: both API-key password inputs, both "Save Key" buttons,
  the HF token panel, the 3-way generation-mode selector, both prompt textareas,
  and the endpoint/engine readout. **-230 lines.**
- The prompt now lives only on the server.

### Sprite generator
- `generateSpriteSheetsFromPhoto(img, { isIllustration })`.
- New `keyOutIllustrationBackground()`: flood-fills the flat chroma background,
  measures the subject bbox from alpha, contain-fits it with Fox-style framing,
  and strokes a white die-cut contour. **No photo-matting model is ever run on
  an illustration** — that was the main source of the torn-edge/speckle artifacts.

### Verification
`tsc -b` clean · `oxlint` 0 errors · `vite build` succeeds · dev endpoint returns
correct 500/405 on misconfigured and wrong-method requests.

**Needs a live key to finish:** the Gemini image response shape. I wrote
`extractImage()` to handle `message.images[].image_url.url`, array `content`
parts, and the legacy `data[0].url` / `b64_json` shapes, but only one of those is
exercised in practice. Add a key to `.env` and I'll confirm and trim to the
correct one.

---

## Phase 3 — UI simplification (completed)

The app is now a single scrolling page with three sections, no tabs:

1. **The mascot** — cursor-tracked stage, tap for a reaction, preset picker below.
2. **Make your own mascot** — dropzone, plain-language photo check, Generate button.
3. **Your 18 stickers** — filter chips, download individually or as a ZIP.

### Removed
- All 5 tabs (Characters, Photo Lab, Stickers, Props, Inspector) → no tabs at all.
- The 6 art styles (`colour/ink/sketch/riso/paper/pixel`) and the CSS filter
  shaders in both the component and the sticker slicer.
- The Poke/Boop button, Trigger 4x Dizzy button, Reset button, poke counter,
  combo counter, dizzy warning badge, and dead-zone crosshair overlay.
- The 9-pill reaction test row and the click-to-dizzy combo logic.
- Perch mode, size slider, JSX code generator, footer links, angle telemetry.
- Dead dependencies: `openai`, `page-mascot`, `canvas-confetti`,
  `@huggingface/inference` (+ `@types/canvas-confetti`). 7 packages removed.

Dizzy is kept as a *sticker* (it is one of the 9 expressions) but is no longer a
user-facing button or state.

### Result
| File | Before | After |
|---|---|---|
| `src/App.tsx` | 1,529 | 367 |
| `src/App.css` | 1,055 | 599 |
| JS bundle | 798 kB | 364 kB |
| CSS bundle | 20.1 kB | 9.7 kB |

Split into `UploadPanel.tsx` and `StickerPack.tsx` so each file has one job.

### Verified in a real browser
- 18/18 stickers render as valid 512×512 transparent WebP.
- Cursor tracking produces 4 distinct sprite directions from pointer movement.
- **No horizontal overflow at 320 / 375 / 414 / 768 / 1024 px.** The preset row
  scrolls inside its own container, as intended.
- Console clean — no errors or warnings.

---

## Phase 2 — partial

Fixed the listener-churn bug: the `pointermove` handler is now attached once and
reads `size` from a ref, instead of being torn down and re-added on every render.
The dead-zone now scales with mascot size (`42%`, min 48px) rather than being a
fixed 70px.

**Still to do:** continuous "lean" layer, idle blink/breathing, and touch support
(tracking is currently disabled entirely on touch devices).

## Phase 5 — Mobile responsive (layout done)

Replaced the single weak media query with a real responsive pass and made the
mascot size fluid.

### Removed
The sample-photo option ("No photo handy? Try a sample") and `public/test_sample.jpg`.
The fallback copy it triggered — *"built from your original photo"* — is now
unreachable from that path, and `onUseDemo` is gone from the component API.

### Changes
- `useFluidSize()` hook scales the mascot with the viewport, capped at 220px and
  floored at 120px. Recomputes on `resize`, `orientationchange`, and
  `visualViewport` resize (mobile URL-bar collapse).
- All spacing, padding, and type now use `clamp()` instead of fixed values.
- `env(safe-area-inset-*)` padding for notched phones and the home indicator.
- `100vh` → `100dvh` on `body`/`#root` (with `100vh` fallback), so the layout
  does not break when mobile browser chrome collapses.
- `overflow-x: hidden` on `body` to stop any accidental horizontal scroll.
- Tap targets raised to 44px on phones (preset chips, sound button, filter chips,
  download button).
- `-webkit-text-size-adjust: 100%` so iOS does not inflate text on rotate.
- Breakpoints at 768 / 560 / 380px, plus a landscape-phone rule
  (`max-height: 520px`) and a `(hover: none)` rule so touch devices do not get
  stuck hover states.
- Sticker grid adapts 3 → 4 → 6 → 7 columns.

### Accessibility fix found while testing
The header mascot was a focusable `<button>` that did nothing. It now renders as
`<span role="img">`, while the tappable stage mascot stays a real `<button>` with
an `aria-label`. (An intermediate attempt rendered both as `<span>` — that would
have broken keyboard access, so it was corrected.)

### Verified
Built an iframe harness testing 7 real viewports, since media queries only fire
on genuine viewport size:

| Device | Width | Mascot | Overflow | Sticker cols | Small targets |
|---|---|---|---|---|---|
| iPhone SE | 320 | 147px | none | 3 | none |
| iPhone 8 | 375 | 173px | none | 3 | none |
| iPhone 14 | 390 | 179px | none | 3 | none |
| Pro Max | 430 | 198px | none | 4 | none |
| iPad | 768 | 220px | none | 6 | — |
| Laptop | 1024 | 220px | none | 7 | — |
| Landscape | 844×390 | 125px | none | 6 | — |

The harness file was removed after use.

**Still to do (Phase 2):** the mascot does not follow a finger on touch devices —
the `hover: hover` gate disables tracking entirely there. Layout is mobile-ready;
the gaze interaction is not.

---

## Phase 1b — Per-cell alignment (the jitter bug)

### Root cause, measured
The mascot "slides" sideways when tracking the cursor horizontally because **the
character sits at a different position inside each cell**. Swapping cells therefore
moves the artwork, not just the pose.

Measured character centre across the 9 cells, as a fraction of cell width:

| Sheet | Horizontal centre spread | Vertical | Width | Height |
|---|---|---|---|---|
| `fox-directions` (reference) | **0.031** | 0.030 | 0.055 | 0.061 |
| `cat-directions` (reference) | **0.028** | 0.041 | 0.073 | 0.083 |
| Our generated directions | **0.339** | 0.036 | 0.338 | 0.050 |
| Our generated reactions | **0.239** | 0.000 | 0.016 | 0.000 |

Reference art varies by ~3% of a cell. Ours varies by **~34%** — eleven times more,
which is exactly the visible horizontal jump.

Why it happens: image models lay the nine characters out as a *spread grid across
the full image width* rather than one character centred per cell. Splitting the
artwork bounds into thirds then puts each character off-centre by a different
amount depending on its column.

### Fix — done
Added a normalisation pass in `extractGridSheet()`: after splitting, each cell's
opaque bounding box is measured and the cell redrawn re-centred and rescaled to a
shared anchor. Height is the stable dimension (turning a head sideways barely
changes how tall the bust is, whereas width shifts a lot), so cells are scaled on
height and anchored at 50% across / 34% down.

### Result
| Sheet | Spread before | Spread after | Worst sweep step |
|---|---|---|---|
| Generated directions | 0.339 | **0.003** | **1 px** at 200px mascot |
| Generated reactions | 0.239 | **0.000** | **0.1 px** |

Verified by reproducing the actual cursor sweep (centre → left → right → centre)
at real mascot size and measuring where the character lands on screen each time.
Reference art moves ~0.03 of a cell across all nine poses; generated art now
moves 0.003.

Client-side only — **no credits used**.

---

## Phase 1c — Generated mascots must not be lost

### Root cause
`customMascot` lives only in React state. Confirmed in the running app:

- `localStorage` and `sessionStorage` are both empty — nothing is persisted.
- Once you switch to a preset there is **no way back**: `customMascotReachable`
  is `false`, because the custom mascot is not offered as a selectable chip.
- A page reload discards the mascot entirely.

This is why the generated pack appeared to vanish after trying another sprite.

### Fix — done
1. **`src/utils/mascotStorage.ts`** — IndexedDB persistence (save / list / load
   most recent / delete). IndexedDB rather than localStorage because a mascot is
   ~400 KB–1.5 MB of base64 webp, and a few generations would blow past
   localStorage's ~5 MB quota and block the whole origin.
2. The generated mascot now appears as its own chip at the front of the picker,
   badged **Yours**, so it can be re-selected after switching to a preset.
3. Restored automatically on page load, with a "Saved on this device" note.
4. **Slicing cache** — slicing a generated mascot takes ~4s (its sheets are large
   base64 images, unlike the small preset files). Re-slicing on every switch left
   the sticker grid blank for seconds. Results are now cached by source, so
   switching back is instant.

### Result
Verified in the running app with a mascot seeded into IndexedDB:
- Survives a full page reload: restored, auto-selected, banner shown.
- Switching to a preset and back returns all 18 stickers in under 500 ms.
- Save / reload / list / delete round-trip all pass.

---

## Phase 1d — Transparency (already working, needs verification)

Measured end-to-end on real output: keyed sheets are **52.8% transparent**, and
exported stickers are valid **512×512 `image/webp`** at **~53% transparent** with
a small feathered edge band. So transparency is already correct.

Outstanding work:
- Confirm visually in the app (checkerboard preview) rather than only numerically.
- The die-cut white sticker border is currently applied only on the procedural
  fallback path, not to model-generated sheets — so generated stickers may look
  flatter than the presets. Apply consistently.

---

## Phase 1e — UI/UX and anatomy fixes

### 1. Mobile tap highlight
`-webkit-tap-highlight-color: transparent`, `user-select: none`,
`touch-action: manipulation` on the shell, plus `onContextMenu` preventDefault and
`draggable={false}` on the button so a long press cannot raise the callout menu.
`touch-action: manipulation` also removes the ~300ms double-tap delay without
disabling pinch-zoom elsewhere.

### 2. Touch gaze tracking
The gaze handler no longer bails on `(hover: hover) and (pointer: fine)`:
- **Drag anywhere** steers the gaze on touch; releasing eases back to centre.
- **Idle sweep** — on touch devices the mascot cycles through directions every
  1.6s when untouched, so it reads as alive rather than frozen.
- Mouse behaviour is unchanged, and mouse moves are ignored during a touch drag.

### 3. Torso lock (anatomy)
`lockTorsoAcrossSheet()` separates head from torso in every cell and rebuilds the
sheet so all nine share **one** torso:

- Neck located per cell by scanning up from the widest row until the silhouette
  collapses. Uses the **widest contiguous run** per row, so detached fragments
  never influence where the neck is judged to be.
- Heads are cropped to their true bbox ignoring small runs, scaled to a common
  height, centred, and overlapped into the neck by 4.5% of the cell so the join
  is hidden rather than seamed.
- The reference torso comes from the median intact cell, never a fragmented one.

A faint bottom-anchored copy of the neutral cell also sits under the sprite in
`EnhancedMascot` as a runtime anchor for the shoulders.

### 4. Down-direction defects
Root cause was **not** slicing — it was the model. Measured on real output, the
bottom row's torso span was 0.88–0.91 against 0.61–0.64 elsewhere, i.e. ~45% wider.
Those were detached shoulder fragments, and height-based normalisation was then
scaling them *up* to match, making them more visible.

Fixed by repairing rather than discarding: the aspect check now flags those cells
(`MAX_ASPECT_OUTLIER = 1.25`, calibrated from the measured 0.66 vs 0.89 gap), and
the torso lock replaces the broken torsos outright.

### Verified
| Metric | Before | After |
|---|---|---|
| Torso band hash across 9 cells | varies | **identical (1/9 unique)** |
| `spreadY` (vertical position) | 0.111 | **0.000** |
| `spreadH` (height) | 0.222 | **0.000** |
| Bottom-row torso span | 0.88–0.91 | **0.70–0.78** |
| Hairline cropped on down-gaze | yes | no |

`tsc` clean · 0 lint errors · build passes. No credits used.

---

## Phase 1 — generation pipeline (prompts validated)

Built the 3-stage server pipeline and validated every prompt against a real
portrait (`scratch/test.jpeg`) rather than shipping untested strings.

### Model choice
Compared three models on Stage 1 (`google/gemini-2.5-flash-image`,
`google/gemini-3.1-flash-image`, `google/gemini-nano-banana-2.1`).

| Model | Backdrop produced | Keys cleanly? |
|---|---|---|
| `gemini-3.1-flash-image` | `#FB0BF8` | yes |
| `gemini-2.5-flash-image` | `#D92D87` — a pink, 120 off in blue | borderline |
| `gemini-nano-banana-2.1` | HTTP 429 upstream | not billed |

**Chosen: `gemini-3.1-flash-image`.** Better likeness (matched the photo's
lighter textured hair and collared shirt) and closer to the reference framing
(more shoulder visible, more headroom). Override with `AICREDITS_IMAGE_MODEL`.

### Chroma gate made robust
The original gate tested for near-`#FF00FF`, which would have **rejected 2.5's
perfectly-keyable pink** and silently dropped to the procedural fallback. Replaced
with a test on the property that actually separates a chroma backdrop from skin,
hair and clothing — *green sitting far below both red and blue*. Verified against
real model output and swatches for white, skin tone, blue shirt and black hair.

### Prompt engineering — the key finding
The first 3×3 prompt asked for "equal cells" and consistency wording. The model
returned **one giant portrait spanning the middle of the sheet**, ringed by eight
small busts, plus divider lines it had been explicitly told not to draw.

Rewriting to lead with explicit **size and enclosure rules** ("fills only the
middle third of its own cell", "no character touches, overlaps or crosses a cell
boundary", "no hero image anywhere") and to describe each cell individually
produced a clean, uniform 3×3. That skeleton now backs both sheet prompts.

| Sheet | Cell-area spread | Worst cell vs median | Verdict |
|---|---|---|---|
| Directions (v2) | 1.27 | 1.23 | pass |
| Reactions | **1.08** | **1.04** | pass |
| *Reference sheets (15)* | *1.05 – 1.21* | *1.03 – 1.13* | *known good* |

### Validator calibrated against real art
The first validator rejected only **empty** cells, so it would have shipped the
broken sheet — every cell there was 46–98% full. It now measures per-cell opaque
area and rejects scale outliers.

Thresholds are calibrated, not guessed: measured all 15 official reference sheets
to establish the genuine range (spread 1.05–1.21, worst cell 1.03–1.13) and set
limits at **1.45 / 1.35**, sitting in the gap between known-good and the known-bad
sheet (2.13 / 1.92). Verified against the real broken sheet, a synthetic uniform
grid, and a synthetic hero-subject grid.

### Known defect
Cell 7 of the directions sheet ("looking down") contains two floating shoulder
fragments — a generation artifact that **no automated check catches**, since the
validator measures area and centring, not shape. One cell of nine is affected.

### Credits used
5 successful image calls (+1 HTTP 429, not billed): 2 for the model comparison,
1 for the failed directions attempt, 1 for the successful one, 1 for reactions.
All test scripts live in gitignored `scratch/` and read the key from `.env` at
runtime — never hardcoded.

**Not yet done:** a live end-to-end run through the app itself.

---

## Sticker quality — the ±3.5° problem

Confirmed, as you noted. This affects the pre-existing presets and any newly
generated mascot equally: the nine "directions" are still a flat bust rotated
±3.5°, which is why they do not match the Fox art. Phase 1 addresses this and the
API key is now present in `.env`.
