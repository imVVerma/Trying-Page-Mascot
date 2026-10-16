The **photo validation** and the **18-sticker slicing** can be done **100% locally in the browser** with zero API costs and no LLM required. For **generating** the 18 sprite poses from the uploaded photo, you can choose between a deterministic client-side approach (no AI/LLM at all) or an optional local/API model depending on the look you want.

### 1. Client-Side Photo Validation (Zero LLM, 100% In-Browser)

Before accepting a user's photo, you can run a fast validation pipeline directly in the browser using native Web APIs and lightweight client-side vision models:

* **Basic File & Dimension Checks (HTML5 `Image` + `File` API):**
* **Format & Size:** Verify `file.type` is `image/jpeg`, `image/png`, or `image/webp` and `file.size` is under 5–10 MB.
* **Resolution & Aspect Ratio:** Load the file into an `Image()` object and check that `naturalWidth` and `naturalHeight` are at least `256×256px` so the output stickers aren't blurry.


* **Brightness, Contrast & Blur Detection (HTML5 `<canvas>` Pixel Math):**
* Draw the image onto a small offscreen canvas (`64×64`) and read `ctx.getImageData()`.
* **Lighting check:** Average the luminance ($0.299R + 0.587G + 0.114B$) across pixels—reject if too dark (`< 40`) or overexposed (`> 230`).
* **Sharpness check:** Run a fast 3×3 Laplacian kernel over the grayscale pixels to measure variance; if variance is too low, warn the user the photo is blurry.


* **Face Presence, Framing & Angle Check (`@mediapipe/tasks-vision` or `face-api.js`):**
* Runs entirely on the user's GPU/CPU via WebAssembly/WebGL (no server needed, ~2MB model cached in browser).
* **Single Subject Rule:** Reject if `faces.length === 0` ("No face detected") or `faces.length > 1` ("Multiple faces found—please upload a solo photo").
* **Centering & Size Rule:** Check the face bounding box—ensure the face takes up at least 20–60% of the frame and isn't cut off at the edges.
* **Front-Facing Rule:** Use the 6 facial landmarks (eyes, nose tip, ears, mouth) to verify the user is looking straight at the camera (symmetric distance from nose tip to left/right ear) rather than in profile.



---

### 2. Generating the 3×3 Sprite Sheets (Two Options)

Once the photo passes validation, you have two ways to turn that photo into the two 3×3 sheets (`directions` + `reactions`):

| Approach | How It Works | Pros | Cons |
| --- | --- | --- | --- |
| **Option A: Pure Client-Side Procedural Rig (No AI / Free)** | Uses **MediaPipe Face Landmarker + Selfie Segmentation** in the browser to cut out the person's head/shoulders, apply a shader filter (Ink, Riso, Pixel, Cut-paper, Cartoon), and procedurally warp/tilt the head across the 9 angles + overlay 2D vector expressions (hearts, stars, dizzy spirals, closed eyelids) on an HTML5 `<canvas>`. | **100% free**, instant (runs in ~1 second in browser), zero API keys, works offline. | Looks like a stylized photo/cutout puppet rather than a hand-redrawn chibi illustration. |
| **Option B: Original `page-mascot` Pipeline (Requires Image Model)** | The official `nilbuild/page-mascot` repo uses an image generation API (or a local Stable Diffusion / ComfyUI server) to redraw the photo into a chibi character across two 3×3 grids, then uses Python (`rembg`) to strip the background. | Produces completely redrawn chibi illustrations. | Cannot be done without an image generation model (either paid API or heavy local GPU server). |

*Recommendation for a standalone app:* Build **Option A** as the default instant in-browser generator (using Canvas filters for the 6 styles: `colour`, `ink`, `sketch`, `riso`, `paper`, `pixel` + SVG expression overlays for the 9 reactions), and optionally let power users upload pre-made sheets or plug in their own key if they want AI redrawing.

---

### 3. Slicing & Downloading the 18 WhatsApp Stickers (100% In-Browser)

WhatsApp stickers have a strict spec: **512×512px WebP (or PNG) with a transparent background**. Since both `directions` and `reactions` sheets are 1080×1080px 3×3 grids (each cell is `360×360px`), you can slice all 18 in milliseconds in the browser:

1. Load both 3×3 sheets into an HTML5 `<canvas>`.
2. Loop through rows `0..2` and columns `0..2` (`sx = col * 360, sy = row * 360`).
3. Draw each `360×360` cell onto a `512×512` export canvas (`ctx.drawImage(sheet, sx, sy, 360, 360, 0, 0, 512, 512)`).
4. Export each canvas via `canvas.toBlob(blob => ..., 'image/webp')` for instant individual download, or bundle all 18 blobs into a single `.zip` using **`JSZip`** (~40KB library) with one click.