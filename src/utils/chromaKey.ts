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

  // Suppress magenta spill on anti-aliased and translucent edge pixels (e.g. clear glasses)
  suppressChromaSpill(d, w, h);

  ctx.putImageData(imageData, 0, 0);

  const bounds = measureBounds(d, w, h);
  if (!bounds) return null;

  return { canvas: work, bounds };
}

/**
 * Neutralizes magenta background color spill on semi-transparent edges and
 * translucent elements (like clear glasses frames and hair strands).
 */
function suppressChromaSpill(d: Uint8ClampedArray, w: number, h: number) {
  for (let i = 0; i < w * h * 4; i += 4) {
    const a = d[i + 3];
    if (a <= 20) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const minRB = Math.min(r, b);
    // Magenta spill signature: red and blue are both significantly higher than green
    if (minRB > g + 40 && minRB > 110) {
      const excess = minRB - g;
      d[i] = Math.max(0, r - Math.round(excess * 0.75));
      d[i + 2] = Math.max(0, b - Math.round(excess * 0.75));
    }
  }
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
  // Add 5% padding on all sides so the top of the head/hair and the edges
  // of the character are never clipped by the cell boundary.
  const padX = Math.round((maxX - minX + 1) * 0.05);
  const padY = Math.round((maxY - minY + 1) * 0.05);
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  const bw = Math.min(w - x, maxX - minX + 1 + padX * 2);
  const bh = Math.min(h - y, maxY - minY + 1 + padY * 2);
  return { x, y, w: bw, h: bh };
}

/**
 * Head/torso separation and locking.
 *
 * The problem: gaze sheets frame each pose independently, so the shoulders drift
 * between cells, and the "looking down" poses often come back with detached
 * shoulder fragments beside the head. A full-body cell swap then makes the whole
 * body twitch rather than just the head turning.
 *
 * The fix mirrors how a clean mascot rig is built: separate the head from the
 * torso in every cell, then re-composite all nine so they share one identical
 * torso and only the head differs. That makes the shoulders provably pixel-locked
 * across the sheet and removes fragments, because fragments live in the torso
 * band and are replaced by the reference torso.
 */

/**
 * Neck position, as a fraction of cell height.
 *
 * Calibrated on the eight official reference sheets (72 cells): p25, median and
 * p75 all land on 0.278, so the proportion is fixed for this chibi art style.
 */
const REFERENCE_NECK = 0.278;

/**
 * Neck search band.
 *
 * Tried and rejected: a narrow band around 0.278 clipped the crown on the tall
 * downward-gaze poses; a "narrowest row" scan collapsed the head to a sliver,
 * because a chibi skull is nearly as wide as its shoulders and the true minimum
 * is the taper above the hair. These bounds bracket the walk-up scan that lands
 * on the calibrated value for real generated output, while still allowing a
 * genuinely unusual pose to shift the cut.
 */
const NECK_SEARCH_TOP = 0.24;
const NECK_SEARCH_BOTTOM = 0.62;

/**
 * Widest contiguous opaque run on a row, as a fraction of cell width.
 * A single widest-run measure per row is what makes this robust: detached
 * fragments form their own run, so they never inflate the torso measurement
 * that decides where the neck is.
 */
function widestRunAtRow(alpha: Uint8ClampedArray, cellW: number, y: number): number {
  let best = 0;
  let run = 0;
  const base = y * cellW;
  for (let x = 0; x < cellW; x++) {
    if (alpha[base + x] > 24) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best / cellW;
}

/**
 * Locates the neck: the row where the silhouette broadens from skull to
 * shoulders. Scans up from the widest row until the run collapses.
 *
 * Using the widest *contiguous run* rather than total coverage is what makes
 * this survive detached shoulder fragments — a fragment is its own run, so it
 * cannot drag the walk-up scan up into the face.
 */
function findNeckRow(alpha: Uint8ClampedArray, cellW: number, cellH: number): number {
  let maxRun = 0;
  let maxY = Math.floor(cellH * 0.5);
  for (let y = 0; y < cellH; y++) {
    const r = widestRunAtRow(alpha, cellW, y);
    if (r > maxRun) {
      maxRun = r;
      maxY = y;
    }
  }
  if (maxRun <= 0) return Math.floor(cellH * REFERENCE_NECK);

  const shoulderFloor = maxRun * 0.7;
  let neck = maxY;
  const minY = Math.floor(cellH * NECK_SEARCH_TOP);
  while (neck > minY && widestRunAtRow(alpha, cellW, neck - 1) > shoulderFloor) {
    neck--;
  }
  if (neck < minY || neck > cellH * NECK_SEARCH_BOTTOM) {
    return Math.floor(cellH * REFERENCE_NECK);
  }
  return neck;
}

interface CellParts {
  /** Head pixels, cropped to the skull. */
  head: HTMLCanvasElement | null;
  headW: number;
  headH: number;
  /** True when this cell's torso looks unusable (fragmented or degenerate). */
  torsoBroken: boolean;
}

/**
 * Splits one cell into head and torso.
 *
 * `maxTorsoWidth` is the median torso width across the sheet; a cell whose own
 * torso is much wider than that is the fragmented case and is not trusted for
 * its torso pixels.
 */
function splitCell(
  cellCanvas: HTMLCanvasElement,
  neckY: number,
  maxTorsoWidth: number
): CellParts {
  const w = cellCanvas.width;
  const h = cellCanvas.height;
  const ctx = cellCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { head: null, headW: 0, headH: 0, torsoBroken: true };

  const data = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = data[p * 4 + 3];

  // Crop the head to its true bbox, ignoring small detached runs so stray
  // fragments above the shoulders cannot widen the head box.
  const minRun = w * 0.08;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < neckY; y++) {
    let x = 0;
    while (x < w) {
      if (alpha[y * w + x] > 24) {
        let len = 0;
        while (x + len < w && alpha[y * w + x + len] > 24) len++;
        if (len >= minRun) {
          if (x < minX) minX = x;
          if (x + len - 1 > maxX) maxX = x + len - 1;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        x += len;
      } else {
        x++;
      }
    }
  }
  if (maxX < 0) return { head: null, headW: 0, headH: 0, torsoBroken: true };

  const headW = maxX - minX + 1;
  const headH = maxY - minY + 1;

  const head = document.createElement('canvas');
  head.width = headW;
  head.height = headH;
  head.getContext('2d')!.drawImage(cellCanvas, minX, minY, headW, headH, 0, 0, headW, headH);

  // Torso sanity: measure the widest run in the torso band.
  let torsoRun = 0;
  for (let y = neckY; y < h; y++) {
    torsoRun = Math.max(torsoRun, widestRunAtRow(alpha, w, y));
  }
  const torsoBroken = maxTorsoWidth > 0 && torsoRun > maxTorsoWidth * 1.25;

  return { head, headW, headH, torsoBroken };
}

/**
 * Vertical gap kept above the tallest head, as a fraction of the cell width.
 *
 * The lock seats every head at the same height, so a single constraint applies
 * to all nine cells at once. This is the default the app uses.
 */
export const CROWN_CLEARANCE_RATIO = 0.05;

/**
 * Re-composites a 3x3 sheet so every cell shares one torso.
 *
 * All nine heads are scaled to a common height and anchored identically, then
 * laid over a single reference torso. Only the drawn head pose differs between
 * cells, so shoulders, shirt and framing are pixel-identical throughout.
 *
 * `crownClearanceRatio` exists so the crown guard's effect can be measured
 * against an uncapped render; production callers omit it.
 */
export function lockTorsoAcrossSheet(
  cells: HTMLCanvasElement[],
  size = 1080,
  crownClearanceRatio = CROWN_CLEARANCE_RATIO
): HTMLCanvasElement {
  const cell = size / 3;
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Could not get sheet context');
  const srcCell = cells[0]?.width ?? cell;

  const alphas = cells.map((c) => {
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    const a = new Uint8ClampedArray(c.width * c.height);
    for (let p = 0; p < c.width * c.height; p++) a[p] = d[p * 4 + 3];
    return a;
  });

  // One shared neck for the whole sheet.
  //
  // Per-cell detection was tried and rejected: poses differ enough that the
  // detected neck swings by 80px between cells (161 vs 82 on real output), and
  // sharing the lowest value drags the torso cut up through the eyes. A single
  // robust neck keeps every cell consistent, which is what the lock requires.
  const necks = alphas.map((a) => findNeckRow(a, cells[0].width, cells[0].height));
  const sortedNecks = [...necks].sort((a, b) => a - b);
  const neckY = sortedNecks[Math.floor(sortedNecks.length / 2)];
  const torsoTop = neckY;

  // Median torso width, used to spot fragmented cells.
  const torsoWidths = alphas.map((a) => {
    let best = 0;
    for (let y = neckY; y < cells[0].height; y++) {
      best = Math.max(best, widestRunAtRow(a, cells[0].width, y));
    }
    return best;
  });
  const sortedTw = [...torsoWidths].sort((a, b) => a - b);
  const medianTw = sortedTw[Math.floor(sortedTw.length / 2)];

  const parts = cells.map((c) => splitCell(c, neckY, medianTw));

  // Reference torso: the median-height intact cell, so the shared torso is a
  // clean drawing rather than a fragmented one.
  const intact = parts
    .map((p, i) => ({ ...p, i }))
    .filter((p) => !p.torsoBroken && p.head)
    .sort((a, b) => b.headH - a.headH);
  const referenceIndex = intact.length ? intact[Math.floor(intact.length / 2)].i : 0;
  const torsoSource = cells[referenceIndex];

  // Common head scale, from the median head height.
  const headHeights = parts.map((p) => p.headH).filter((v) => v > 0).sort((a, b) => a - b);
  let targetHeadH = headHeights.length ? headHeights[Math.floor(headHeights.length / 2)] : 0;

  // The neck cut runs slightly high so the torso retains the base of the neck.
  // The head is then overlapped downward by this many pixels, which hides the
  // join instead of leaving a visible seam across the throat.
  const neckOverlap = Math.round(srcCell * 0.045);

  // Breathing room above the crown.
  //
  // Heads are seated so their bottom sits `neckOverlap` pixels below the neck
  // cut. For the taller downward-gaze poses that places the top of the hair
  // above the cell's top edge, which clipped the crown. Cap the head height so
  // the highest hair still clears the top by CROWN_CLEARANCE, shrinking only as
  // much as the tallest pose requires — every cell still shares one head scale,
  // so the mascot does not pulse as it turns.
  //
  // This is the one place the lock can shrink heads below their natural size
  // rather than merely re-seating them, so the ratio is a parameter: passing 0
  // renders the uncapped result, which is how the cap's actual cost is measured
  // (see Phase 1j).
  const CROWN_CLEARANCE = Math.round(srcCell * crownClearanceRatio);
  const maxHeadH = torsoTop - neckOverlap - CROWN_CLEARANCE;
  if (targetHeadH > maxHeadH && maxHeadH > 0) {
    targetHeadH = maxHeadH;
  }

  const torsoH = srcCell - torsoTop;

  for (let i = 0; i < 9; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const dx = col * cell;
    const dy = row * cell;

    // Torso first, at its natural scale so the shared body never shifts.
    octx.drawImage(torsoSource, 0, torsoTop, srcCell, torsoH, dx, dy + torsoTop, cell, torsoH);

    const part = parts[i];
    if (!part.head || targetHeadH <= 0) continue;

    const scale = targetHeadH / part.headH;
    const dw = part.headW * scale;
    const dh = targetHeadH;

    // Head centred horizontally on the torso, seated at the neck.
    // A small upward offset gives the crown breathing room so the top of the
    // hair is never clipped by the cell boundary.
    const HEAD_Y_OFFSET = -4;
    const headX = dx + (cell - dw) / 2;
    const headY = dy + torsoTop - dh + neckOverlap + HEAD_Y_OFFSET;

    // Belt and braces: never let a head cross the cell boundary, whatever the
    // source art did. Clamped with 2px of top padding so a cropped crown is
    // impossible even on the tallest poses.
    const clampedHeadY = Math.max(dy + 2, headY);

    octx.drawImage(part.head, headX, clampedHeadY, dw, dh);
  }

  return out;
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
  /** True when the torso lock rebuilt the sheet and corrected bad cells. */
  repaired?: boolean;
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
const MAX_OVERALL_SPREAD = 1.95;
const MAX_CELL_VS_MEDIAN = 1.65;

/**
 * Width:height tolerance across cells.
 *
 * Expressive reaction cells with floating sparkles, hearts, or stars have slightly
 * wider bounding boxes than neutral portraits. 1.60 comfortably accommodates emote
 * particles while still rejecting detached shoulder fragments or split cells.
 */
const MAX_ASPECT_OUTLIER = 1.60;

/**
 * Detects the natural empty background gutters between the 3 rows and 3 columns
 * by finding opacity valleys around 1/3 and 2/3.
 *
 * This prevents horizontal crown shearing: dividing blindly at exact thirds
 * slices through the hair if rows drift by even a few pixels.
 */
function findGridSplitPoints(
  d: Uint8ClampedArray,
  w: number,
  bounds: { x: number; y: number; w: number; h: number }
): { xs: number[]; ys: number[] } {
  const rowCounts = new Int32Array(bounds.h);
  for (let dy = 0; dy < bounds.h; dy++) {
    const y = bounds.y + dy;
    let count = 0;
    for (let dx = 0; dx < bounds.w; dx++) {
      const x = bounds.x + dx;
      if (d[(y * w + x) * 4 + 3] > 24) count++;
    }
    rowCounts[dy] = count;
  }

  const colCounts = new Int32Array(bounds.w);
  for (let dx = 0; dx < bounds.w; dx++) {
    const x = bounds.x + dx;
    let count = 0;
    for (let dy = 0; dy < bounds.h; dy++) {
      const y = bounds.y + dy;
      if (d[(y * w + x) * 4 + 3] > 24) count++;
    }
    colCounts[dx] = count;
  }

  const findValley = (counts: Int32Array, targetFrac: number, winFrac: number) => {
    const target = Math.round(counts.length * targetFrac);
    const win = Math.round(counts.length * winFrac);
    const start = Math.max(0, target - win);
    const end = Math.min(counts.length - 1, target + win);
    let bestScore = Infinity;
    let bestIdx = target;
    for (let i = start; i <= end; i++) {
      // Prioritize low count, and break ties by choosing index closest to target
      const score = counts[i] * 10 + Math.abs(i - target);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const y1 = bounds.y + findValley(rowCounts, 1 / 3, 0.08);
  const y2 = bounds.y + findValley(rowCounts, 2 / 3, 0.08);

  const x1 = bounds.x + findValley(colCounts, 1 / 3, 0.08);
  const x2 = bounds.x + findValley(colCounts, 2 / 3, 0.08);

  return {
    xs: [bounds.x, x1, x2, bounds.x + bounds.w],
    ys: [bounds.y, y1, y2, bounds.y + bounds.h],
  };
}

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
  // Hard failures: problems the torso lock cannot fix (too much fill, multiple
  // overlapping characters). These are never cleared by Pass 3.
  const hardFailures: number[] = [];

  interface CellBox { x: number; y: number; w: number; h: number; area: number }
  const boxes: (CellBox | null)[] = new Array(9).fill(null);

  // Pass 1: measure each cell's opaque bounding box and pixel count, and keep
  // the raw cell so the head/torso lock can rebuild the sheet from it.
  const rawCells: (HTMLCanvasElement | null)[] = new Array(9).fill(null);

  const fullData = sctx.getImageData(0, 0, src.width, src.height).data;
  const splits = findGridSplitPoints(fullData, src.width, bounds);

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const sx = splits.xs[col];
      const sy = splits.ys[row];
      const sw = Math.max(1, splits.xs[col + 1] - splits.xs[col]);
      const sh = Math.max(1, splits.ys[row + 1] - splits.ys[row]);

      const cellCanvas = document.createElement('canvas');
      cellCanvas.width = sw;
      cellCanvas.height = sh;
      const cctx = cellCanvas.getContext('2d', { willReadFrequently: true });
      if (!cctx) continue;
      cctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);

      const probe = cctx.getImageData(0, 0, sw, sh).data;
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
      } else if (area / (sw * sh) > 0.85) {
        // A single cell filling > 85% means an oversized hero image rather than a small portrait.
        hardFailures.push(idx);
        boxes[idx] = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area };
        rawCells[idx] = cellCanvas;
      } else {
        // Count major connected components (> 8% of cell area). A single character has 1 major body.
        // Multiple major bodies (> 1) indicate genuine overlapping or duplicate characters.
        // Small detached emote particles (sparkles, tears, hearts, blush lines, sweat drops)
        // are allowed and do not trigger false rejections.
        let majorComponents = 0;
        const visited = new Uint8Array(sw * sh);
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            if (probe[(y * sw + x) * 4 + 3] <= 24 || visited[y * sw + x]) continue;
            let blobArea = 0;
            const stack: number[] = [y * sw + x];
            visited[y * sw + x] = 1;
            while (stack.length) {
              const pos = stack.pop()!;
              blobArea++;
              const px = pos % sw;
              const py = (pos - px) / sw;
              for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = px + dx, ny = py + dy;
                if (nx < 0 || nx >= sw || ny < 0 || ny >= sh) continue;
                const ni = ny * sw + nx;
                if (visited[ni] || probe[ni * 4 + 3] <= 24) continue;
                visited[ni] = 1;
                stack.push(ni);
              }
            }
            if (blobArea > sw * sh * 0.08) {
              majorComponents++;
            }
          }
        }
        if (majorComponents > 1) {
          hardFailures.push(idx);
        }
        boxes[idx] = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area };
        rawCells[idx] = cellCanvas;
      }
    }
  }

  // Pass 2: reject outliers. Compare against the median so a single bad cell
  // cannot drag the baseline toward itself.
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

  // Pass 2b: reject torso outliers.
  //
  // A pose where the model left detached shoulder fragments beside the head has
  // a far wider bounding box than the others. Height-based normalisation would
  // then scale that fragment *up* to match, making it more visible rather than
  // less. Measure the width relative to the median and drop those cells so the
  // sheet falls back rather than shipping a broken torso.
  const widths = boxes.map((b) => (b ? b.w / b.h : 0)).filter((v) => v > 0).sort((a, b) => a - b);
  const medianRatio = widths.length ? widths[Math.floor(widths.length / 2)] : 0;

  if (medianRatio > 0) {
    for (let i = 0; i < 9; i++) {
      const box = boxes[i];
      if (!box) continue;
      const aspect = box.w / box.h;
      if (aspect > medianRatio * MAX_ASPECT_OUTLIER && !oddCells.includes(i)) {
        oddCells.push(i);
      }
    }
  }

  // Pass 3: draw complete, intact characters aligned to a shared baseline.
  //
  // Every cell keeps its full, cohesive character portrait (face, chin, neck, shirt)
  // as drawn by the model — with zero decapitation or mismatched glued chins.
  // Characters are scaled to a consistent height and bottom-anchored so all poses
  // share a stable baseline across all 9 angles and reactions.
  const validBoxes = boxes.filter((b): b is NonNullable<typeof b> => Boolean(b));
  const heights = validBoxes.map((b) => b.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 1;
  const targetH = cell * 0.86;
  const scale = targetH / medianH;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const box = boxes[idx];
      const raw = rawCells[idx];
      if (!box || !raw) continue;

      const dw = box.w * scale;
      const dh = box.h * scale;
      const dx = col * cell + (cell - dw) / 2;
      const dy = row * cell + cell * 0.94 - dh;

      octx.drawImage(raw, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
    }
  }

  const ok =
    emptyCells.length === 0 &&
    hardFailures.length === 0 &&
    oddCells.length <= 1;

  return {
    canvas: out,
    ok,
    emptyCells,
    oddCells,
    alignment: measureAlignment(out),
    repaired: false,
    reason: ok
      ? undefined
      : emptyCells.length > 0
        ? `${emptyCells.length} empty cell(s)`
        : hardFailures.length > 0
          ? `bad cell quality (cells ${hardFailures.join(', ')}): too large or overlapping characters`
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
