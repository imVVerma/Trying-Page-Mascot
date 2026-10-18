/**
 * Chroma-key utilities for turning model-generated mascot art into clean,
 * transparent sprite sheets.
 *
 * Image models rarely return a pixel-perfect 3x3 grid: they add margins, leave
 * uneven gutters, and drift between cells. So rather than slicing blindly at
 * exact thirds, we key the background out first, measure where the artwork
 * actually sits, and split inside that measured region.
 */

/** The chroma colour requested from the model. */
export const CHROMA = { r: 255, g: 0, b: 255 };

export interface KeyedImage {
  canvas: HTMLCanvasElement;
  /** Bounding box of non-transparent pixels. */
  bounds: { x: number; y: number; w: number; h: number };
}

/**
 * Removes the magenta background, leaving feathered alpha on the edges.
 *
 * Uses a flood fill from the border rather than a global colour-distance test,
 * so magenta details *inside* the character are preserved rather than punched
 * out. Returns null if the image is not magenta-backed.
 */
export function keyOutChroma(
  img: HTMLImageElement,
  tolerance = 62
): KeyedImage | null {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;

  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  // Estimate the real background colour from the border, because models rarely
  // render #FF00FF exactly — they shift it slightly.
  let bgR = 0, bgG = 0, bgB = 0, n = 0;
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    bgR += d[i]; bgG += d[i + 1]; bgB += d[i + 2]; n++;
  };
  for (let x = 0; x < w; x += 3) { sample(x, 0); sample(x, 1); sample(x, h - 1); sample(x, h - 2); }
  for (let y = 3; y < h - 3; y += 3) { sample(0, y); sample(1, y); sample(w - 1, y); sample(w - 2, y); }

  // Decide whether this is a chroma-backed image at all.
  //
  // Matching #FF00FF exactly is too brittle: measured outputs ranged from
  // #FB0BF8 (essentially exact) to #D92D87 (a pink, 120 off in blue). Requiring
  // near-magenta would reject perfectly keyable backgrounds.
  //
  // Instead test the property that actually separates a chroma backdrop from
  // skin, hair and clothing: the green channel sits far below *both* red and
  // blue. That holds for magenta, pink and purple, and fails for white, skin
  // tones, blues and greys.
  const avgR = bgR / n;
  const avgG = bgG / n;
  const avgB = bgB / n;
  const isChromaBackdrop = avgG < Math.min(avgR, avgB) - 55;
  if (!isChromaBackdrop) return null;

  bgR /= n; bgG /= n; bgB /= n;

  // Flood fill from the border through background-coloured pixels only.
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (visited[p]) return;
    visited[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  const tolSq = tolerance * tolerance * 3;
  let head = 0;
  while (head < stack.length) {
    const p = stack[head++];
    const i = p * 4;

    const dr = d[i] - bgR;
    const dg = d[i + 1] - bgG;
    const db = d[i + 2] - bgB;
    const distSq = dr * dr + dg * dg + db * db;

    if (distSq > tolSq) continue;

    d[i + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // Feather: soften the remaining edge pixels so the die-cut border isn't jagged.
  featherEdges(d, w, h);

  ctx.putImageData(imageData, 0, 0);

  const bounds = measureBounds(d, w, h);
  if (!bounds) return null;

  return { canvas: work, bounds };
}

/** Blurs alpha across the silhouette boundary by one pixel. */
function featherEdges(d: Uint8ClampedArray, w: number, h: number) {
  const src = new Uint8ClampedArray(d);
  const isEdge = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const here = src[i + 3] > 24;
    const up = y > 0 ? src[((y - 1) * w + x) * 4 + 3] > 24 : false;
    const left = x > 0 ? src[(y * w + x - 1) * 4 + 3] > 24 : false;
    return here !== up || here !== left;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] <= 24) continue;
      if (!isEdge(x, y)) continue;
      // Pull partially transparent pixels further toward their true value.
      if (src[i + 3] < 255) d[i + 3] = Math.min(255, src[i + 3] + 90);
    }
  }
}

function measureBounds(
  d: Uint8ClampedArray,
  w: number,
  h: number
): { x: number; y: number; w: number; h: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface ExtractedSheet {
  canvas: HTMLCanvasElement;
  /** True only when all nine cells are present and similarly sized. */
  ok: boolean;
  /** Cells that came up empty, as 0-8 indices. */
  emptyCells: number[];
  /** Cells whose artwork scale differs wildly from the rest. */
  oddCells: number[];
  reason?: string;
  /** Alignment diagnostics, in cell-width fractions. */
  alignment?: {
    spreadX: number;
    spreadY: number;
    spreadW: number;
    spreadH: number;
    /** Worst horizontal jump between adjacent cells, as a fraction of a cell. */
    worstJumpX: number;
  };
}

/**
 * Scale-consistency limits, calibrated against the 15 official reference sheets
 * in /public/mascots (fox, bear, cat, owl, wizard, astronaut, gearbot, redpanda
 * and six fox art styles) plus their reaction sheets.
 *
 *   genuine art        : overall spread 1.05 - 1.21, worst cell 1.03 - 1.13
 *   known-bad AI sheet : overall spread 2.13,        worst cell 1.92
 *
 * Thresholds sit inside that gap: comfortably above every known-good sheet and
 * comfortably below the failure.
 */
const MAX_OVERALL_SPREAD = 1.45;
const MAX_CELL_VS_MEDIAN = 1.35;

/**
 * Splits a keyed 3x3 sprite sheet into a clean 1080x1080 sheet, cropping to the
 * artwork's measured bounds so stray margins do not throw off the thirds.
 *
 * Image models frequently refuse to produce a uniform grid — they favour one
 * large hero subject ringed by smaller figures. Such a sheet is rejected here
 * rather than shipped, because a centre cell twice the size of its neighbours
 * produces a visibly broken mascot.
 *
 * Every cell is then re-centred and rescaled to a shared anchor. Without this
 * the mascot visibly slides when tracking the cursor, because models lay the
 * nine characters out spread across the full width rather than one per cell —
 * measured at 0.34 of a cell width for generated art versus 0.03 for the
 * official reference sheets.
 */
export function extractGridSheet(keyed: KeyedImage, size = 1080): ExtractedSheet {
  const { canvas: src, bounds } = keyed;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d');
  if (!sctx || !octx) {
    return { canvas: src, ok: false, emptyCells: [], oddCells: [], reason: 'no 2d context' };
  }

  const cell = size / 3;
  const emptyCells: number[] = [];
  const oddCells: number[] = [];

  interface CellBox { x: number; y: number; w: number; h: number; area: number }
  const boxes: (CellBox | null)[] = new Array(9).fill(null);

  // Pass 1: measure each cell's opaque bounding box and pixel count.
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const sx = Math.floor(bounds.x + (bounds.w / 3) * col);
      const sy = Math.floor(bounds.y + (bounds.h / 3) * row);
      const sw = Math.max(1, Math.floor(bounds.w / 3));
      const sh = Math.max(1, Math.floor(bounds.h / 3));

      const probe = sctx.getImageData(sx, sy, sw, sh).data;
      let area = 0, minX = sw, minY = sh, maxX = -1, maxY = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (probe[(y * sw + x) * 4 + 3] > 24) {
            area++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (area / (sw * sh) < 0.03) {
        emptyCells.push(idx);
      } else {
        boxes[idx] = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area };
      }
    }
  }

  // Pass 2: reject scale outliers. Compare against the median so a single
  // outlier cannot drag the baseline toward itself.
  const areas = boxes.map((b) => (b ? b.area : 0));
  const nonEmpty = areas.filter((a) => a > 0).sort((a, b) => a - b);
  const median = nonEmpty.length ? nonEmpty[Math.floor(nonEmpty.length / 2)] : 0;
  const spread = nonEmpty.length ? nonEmpty[nonEmpty.length - 1] / nonEmpty[0] : 1;

  if (median > 0) {
    for (let i = 0; i < 9; i++) {
      if (!areas[i]) continue;
      const ratio = areas[i] / median;
      if (ratio > MAX_CELL_VS_MEDIAN || ratio < 1 / MAX_CELL_VS_MEDIAN) oddCells.push(i);
    }
  }
  if (spread > MAX_OVERALL_SPREAD) {
    for (let i = 0; i < 9; i++) if (!oddCells.includes(i)) oddCells.push(i);
  }

  // Pass 3: normalise. Anchor every cell on a shared target so that swapping
  // cells changes only the pose, never the artwork's position on screen.
  //
  // Height is the stable dimension: turning a head sideways barely changes how
  // tall the bust is, whereas its width shifts a lot. Normalising on width
  // would make the mascot pulse as it turns.
  const valid = boxes.filter((b): b is CellBox => Boolean(b));

  let targetH = 0;
  if (valid.length) {
    const heights = valid.map((b) => b.h).sort((a, b) => a - b);
    targetH = heights[Math.floor(heights.length / 2)];
  }

  // Anchor the bust horizontally centred, and vertically by the head position
  // rather than the bounding box, which varies with the pose.
  const ANCHOR_X = 0.5;
  const ANCHOR_Y = 0.34;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const box = boxes[idx];
      if (!box) continue;

      const srcX = Math.floor(bounds.x + (bounds.w / 3) * col) + box.x;
      const srcY = Math.floor(bounds.y + (bounds.h / 3) * row) + box.y;

      const scale = targetH / box.h;
      const drawW = box.w * scale;
      const drawH = box.h * scale;

      octx.drawImage(
        src,
        srcX, srcY, box.w, box.h,
        col * cell + cell * ANCHOR_X - drawW / 2,
        row * cell + cell * ANCHOR_Y - drawH * 0.15,
        drawW,
        drawH
      );
    }
  }

  const ok = emptyCells.length === 0 && oddCells.length === 0;

  return {
    canvas: out,
    ok,
    emptyCells,
    oddCells,
    alignment: measureAlignment(out),
    reason: ok
      ? undefined
      : emptyCells.length > 0
        ? `${emptyCells.length} empty cell(s)`
        : `uneven grid (spread ${spread.toFixed(2)}); cells ${oddCells.join(', ')}`,
  };
}

/**
 * Re-measures a normalised sheet so alignment can be reported and tested.
 * All values are fractions of one cell.
 */
export function measureAlignment(sheet: HTMLCanvasElement) {
  const w = sheet.width;
  const h = sheet.height;
  const ctx = sheet.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;

  const cellW = w / 3;
  const cellH = h / 3;
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  const hs: number[] = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const sx = Math.floor(col * cellW);
      const sy = Math.floor(row * cellH);
      const sw = Math.floor(cellW);
      const sh = Math.floor(cellH);
      const d = ctx.getImageData(sx, sy, sw, sh).data;

      let minX = sw, minY = sh, maxX = -1, maxY = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (d[(y * sw + x) * 4 + 3] > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) continue;

      xs.push(((minX + maxX) / 2) / sw);
      ys.push(((minY + maxY) / 2) / sh);
      ws.push((maxX - minX) / sw);
      hs.push((maxY - minY) / sh);
    }
  }

  if (!xs.length) return undefined;

  const range = (v: number[]) => Math.max(...v) - Math.min(...v);
  const spreadX = range(xs);

  // Largest horizontal step between cells that the cursor can swap between.
  let worstJumpX = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    worstJumpX = Math.max(worstJumpX, Math.abs(xs[i + 1] - xs[i]));
  }

  return {
    spreadX: +spreadX.toFixed(3),
    spreadY: +range(ys).toFixed(3),
    spreadW: +range(ws).toFixed(3),
    spreadH: +range(hs).toFixed(3),
    worstJumpX: +worstJumpX.toFixed(3),
  };
}

/**
 * Frames a single keyed mascot image as a bust sized for one sprite cell.
 * Used for the canonical bust and for procedural fallbacks.
 */
export function frameAsBust(keyed: KeyedImage, size = 330, biasY = 0.28): HTMLCanvasElement {
  const { canvas: src, bounds } = keyed;
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not get bust context');

  const pad = size * 0.06;
  const fit = Math.min((size - pad * 2) / bounds.w, (size - pad * 2) / bounds.h);
  const dw = bounds.w * fit;
  const dh = bounds.h * fit;

  ctx.drawImage(
    src,
    bounds.x, bounds.y, bounds.w, bounds.h,
    (size - dw) / 2,
    (size - dh) * biasY,
    dw,
    dh
  );

  return out;
}

/** Wraps a cell-sized bust in a white die-cut vinyl outline. */
export function applyDieCut(bust: HTMLCanvasElement, outlineRadius = 5): HTMLCanvasElement {
  const size = bust.width;
  const silhouette = document.createElement('canvas');
  silhouette.width = size;
  silhouette.height = size;
  const sCtx = silhouette.getContext('2d');
  if (!sCtx) throw new Error('Could not get silhouette context');

  const bCtx = bust.getContext('2d', { willReadFrequently: true })!;
  const src = bCtx.getImageData(0, 0, size, size);
  const outData = sCtx.createImageData(size, size);
  const od = outData.data;
  const sd = src.data;

  for (let i = 0; i < sd.length; i += 4) {
    if (sd[i + 3] > 24) {
      od[i] = 255; od[i + 1] = 255; od[i + 2] = 255; od[i + 3] = 255;
    }
  }
  sCtx.putImageData(outData, 0, 0);

  const final = document.createElement('canvas');
  final.width = size;
  final.height = size;
  const fCtx = final.getContext('2d');
  if (!fCtx) throw new Error('Could not get final context');

  // Stamp the silhouette in a ring to grow it outward into an outline.
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    fCtx.drawImage(silhouette, Math.cos(a) * outlineRadius, Math.sin(a) * outlineRadius);
  }
  fCtx.drawImage(bust, 0, 0);

  return final;
}

/** Loads a data URI or URL into an HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}
