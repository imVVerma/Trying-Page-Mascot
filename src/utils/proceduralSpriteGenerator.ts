/**
 * Client-Side Procedural 3x3 Sprite Sheet & Die-Cut Sticker Generator.
 *
 * This is the FALLBACK path. When the server returns real model-drawn sprite
 * sheets (see `buildMascotAssets`) those are used directly, because only an
 * image model can draw nine genuinely different head angles. The procedural rig
 * below rotates one flat bust, which reads as "tilted" rather than "turned", so
 * it is a fallback and not the intended output.
 */

import { segmentAndExtractMascotBust } from './aiPortraitSegmenter';
import {
  keyOutChroma,
  extractGridSheet,
  frameAsBust,
  applyDieCut,
  loadImage,
} from './chromaKey';

export interface GeneratedMascotSheets {
  directionsUrl: string;
  reactionsUrl: string;
}

export interface SpriteGenerationOptions {
  /**
   * True when the source image is an AI-rendered illustration rather than a
   * photograph. Illustrations are chroma-keyed directly — running MediaPipe
   * selfie segmentation (a photo matting model) over a drawing produces torn
   * edges, unmatted background and speckle artifacts.
   */
  isIllustration?: boolean;
}

export interface MascotAssetInput {
  /** Canonical bust data URI from the server. */
  bust: string;
  /** 3x3 head-angle sheet, when the model produced a usable one. */
  directions?: string | null;
  /** 3x3 expression sheet, when the model produced a usable one. */
  reactions?: string | null;
}

export interface MascotAssets {
  directionsUrl: string;
  reactionsUrl: string;
  previewUrl: string;
  /** Which sheets came from the model vs. the procedural fallback. */
  source: { directions: 'ai' | 'procedural'; reactions: 'ai' | 'procedural' };
}

const SHEET_SIZE = 1080;
const BUST_SIZE = 330;

/**
 * Builds the final 1080x1080 sheets from the server's generated assets.
 *
 * Any sheet the model failed to produce (or produced badly) is rebuilt with the
 * procedural rig from the canonical bust, so the mascot always has both sheets.
 */
export async function buildMascotAssets(input: MascotAssetInput): Promise<MascotAssets> {
  const bustImg = await loadImage(input.bust);

  const directions = await resolveSheet(input.directions, bustImg, 'directions');
  const reactions = await resolveSheet(input.reactions, bustImg, 'reactions');

  return {
    directionsUrl: directions.url,
    reactionsUrl: reactions.url,
    previewUrl: input.bust,
    source: { directions: directions.source, reactions: reactions.source },
  };
}

/** Uses a model-drawn sheet when it keys and splits cleanly, otherwise falls back. */
async function resolveSheet(
  sheetUrl: string | null | undefined,
  bustImg: HTMLImageElement,
  kind: 'directions' | 'reactions'
): Promise<{ url: string; source: 'ai' | 'procedural' }> {
  if (sheetUrl) {
    try {
      const img = await loadImage(sheetUrl);
      const keyed = keyOutChroma(img);
      if (keyed) {
        const sheet = extractGridSheet(keyed, SHEET_SIZE);
        if (sheet.ok) {
          if (kind === 'reactions' && !isReactionSheetDiverse(sheet.canvas)) {
            console.warn(
              '[mascot] reactions sheet lacks expression diversity (cells collapsed into duplicates); using procedural fallback'
            );
          } else {
            return { url: sheet.canvas.toDataURL('image/webp', 0.95), source: 'ai' };
          }
        } else {
          console.warn(
            `[mascot] ${kind} sheet rejected (${sheet.reason}); using procedural fallback`
          );
        }
      } else {
        console.warn(`[mascot] ${kind} sheet was not magenta-backed; using fallback`);
      }
    } catch (err) {
      console.warn(`[mascot] ${kind} sheet failed to load; using fallback`, err);
    }
  }

  const sheets = await generateSpriteSheetsFromPhoto(bustImg, { isIllustration: true });
  return {
    url: kind === 'directions' ? sheets.directionsUrl : sheets.reactionsUrl,
    source: 'procedural',
  };
}

/**
 * Verifies that a generated reactions sheet actually contains diverse expressions
 * rather than a single repeated expression (e.g. all dizzy spirals across 9 cells).
 */
function isReactionSheetDiverse(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return true;

  const w = canvas.width;
  const h = canvas.height;
  const cellW = w / 3;
  const cellH = h / 3;

  // Face sample region within each 360x360 cell
  const sampleW = Math.round(cellW * 0.45);
  const sampleH = Math.round(cellH * 0.4);
  const sampleOffX = Math.round(cellW * 0.275);
  const sampleOffY = Math.round(cellH * 0.25);

  const refX = sampleOffX;
  const refY = sampleOffY;
  const refData = ctx.getImageData(refX, refY, sampleW, sampleH).data;

  let totalDiff = 0;
  let count = 0;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 0 && c === 0) continue;
      const curX = c * cellW + sampleOffX;
      const curY = r * cellH + sampleOffY;
      const curData = ctx.getImageData(curX, curY, sampleW, sampleH).data;

      let cellDiff = 0;
      let opaquePx = 0;
      for (let p = 0; p < refData.length; p += 4) {
        if (refData[p + 3] > 40 && curData[p + 3] > 40) {
          const dr = Math.abs(refData[p] - curData[p]);
          const dg = Math.abs(refData[p + 1] - curData[p + 1]);
          const db = Math.abs(refData[p + 2] - curData[p + 2]);
          cellDiff += (dr + dg + db) / 3;
          opaquePx++;
        }
      }
      if (opaquePx > 0) {
        totalDiff += cellDiff / opaquePx;
        count++;
      }
    }
  }

  if (count === 0) return true;
  const avgDiff = totalDiff / count;
  return avgDiff >= 7.5;
}

/**
 * Advanced Client-Side Smart Background Maskout & Die-Cut Vinyl Sticker Generator.
 * 1. Square crops the portrait.
 * 2. Samples background color and edge gradients from top and side borders.
 * 3. Removes background pixels (flood-fill / color distance from boundary) while preserving portrait head & shoulders.
 * 4. Adds a bold 14px die-cut vinyl sticker outline with soft 3D ambient drop-shadow.
 * 5. Applies cel-shaded contrast and glossy sticker reflections.
 */
export function createDieCutStickerBust(imgElement: HTMLImageElement, size: number = 330): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d canvas context');

  const sw = imgElement.naturalWidth;
  const sh = imgElement.naturalHeight;
  const cropSize = Math.min(sw, sh);
  const sx = (sw - cropSize) / 2;
  const sy = Math.max(0, (sh - cropSize) * 0.1); // portrait face bias

  // Create an offscreen canvas for the cropped portrait
  const procW = 280;
  const procH = 280;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = procW;
  cropCanvas.height = procH;
  const cCtx = cropCanvas.getContext('2d');
  if (!cCtx) throw new Error('Could not get 2d context for cutout');

  // Draw cropped photo
  cCtx.drawImage(imgElement, sx, sy, cropSize, cropSize, 0, 0, procW, procH);

  // Perform Smart Background Cutout / Maskout
  const imgData = cCtx.getImageData(0, 0, procW, procH);
  const data = imgData.data;

  // Sample corner & top border pixels to determine the dominant background color
  let bgR = 0, bgG = 0, bgB = 0, sampleCount = 0;
  const samplePixel = (px: number, py: number) => {
    const idx = (py * procW + px) * 4;
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
    sampleCount++;
  };

  // Sample top edge and top corners
  for (let x = 0; x < procW; x += 4) {
    samplePixel(x, 0);
    samplePixel(x, 1);
    samplePixel(x, 2);
  }
  for (let y = 0; y < procH * 0.4; y += 4) {
    samplePixel(0, y);
    samplePixel(1, y);
    samplePixel(procW - 1, y);
    samplePixel(procW - 2, y);
  }

  bgR = Math.round(bgR / sampleCount);
  bgG = Math.round(bgG / sampleCount);
  bgB = Math.round(bgB / sampleCount);

  // BFS Flood-fill from outer edges to mask out background
  const visited = new Uint8Array(procW * procH);
  const queue: number[] = [];

  // Seed with perimeter pixels
  for (let x = 0; x < procW; x++) {
    queue.push(x, 0);
    queue.push(x, procH - 1);
    visited[x] = 1;
    visited[(procH - 1) * procW + x] = 1;
  }
  for (let y = 1; y < procH - 1; y++) {
    queue.push(0, y);
    queue.push(procW - 1, y);
    visited[y * procW] = 1;
    visited[y * procW + (procW - 1)] = 1;
  }

  // Center protection zone (head region that must NEVER be erased)
  const headCenterX = procW * 0.5;
  const headCenterY = procH * 0.48;
  const headRadiusX = procW * 0.32;
  const headRadiusY = procH * 0.42;

  let head = 0;
  const colorTolerance = 46; // Euclidian distance tolerance

  while (head < queue.length) {
    const qx = queue[head++];
    const qy = queue[head++];
    const pIdx = (qy * procW + qx) * 4;

    const r = data[pIdx];
    const g = data[pIdx + 1];
    const b = data[pIdx + 2];

    const dist = Math.hypot(r - bgR, g - bgG, b - bgB);

    // Check if pixel is background
    const isHeadZone =
      Math.pow((qx - headCenterX) / headRadiusX, 2) +
        Math.pow((qy - headCenterY) / headRadiusY, 2) < 1.0;

    if (dist <= colorTolerance && !isHeadZone) {
      // Mark as transparent background
      data[pIdx + 3] = 0;

      // Expand to 4-way neighbors
      const neighbors = [
        [qx + 1, qy],
        [qx - 1, qy],
        [qx, qy + 1],
        [qx, qy - 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < procW && ny >= 0 && ny < procH) {
          const nIdx = ny * procW + nx;
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  cCtx.putImageData(imgData, 0, 0);

  // Now create the final die-cut vinyl sticker badge
  const pad = 10;
  const badgeW = size - pad * 2;
  const badgeH = size - pad * 2;
  const radius = 56;

  const stickerPath = new Path2D();
  if (typeof (stickerPath as unknown as { roundRect?: Function }).roundRect === 'function') {
    (stickerPath as unknown as { roundRect: Function }).roundRect(pad, pad, badgeW, badgeH, radius);
  } else {
    stickerPath.moveTo(pad + radius, pad);
    stickerPath.lineTo(pad + badgeW - radius, pad);
    stickerPath.quadraticCurveTo(pad + badgeW, pad, pad + badgeW, pad + radius);
    stickerPath.lineTo(pad + badgeW, pad + badgeH - radius);
    stickerPath.quadraticCurveTo(pad + badgeW, pad + badgeH, pad + badgeW - radius, pad + badgeH);
    stickerPath.lineTo(pad + radius, pad + badgeH);
    stickerPath.quadraticCurveTo(pad, pad + badgeH, pad, pad + badgeH - radius);
    stickerPath.lineTo(pad, pad + radius);
    stickerPath.quadraticCurveTo(pad, pad, pad + radius, pad);
    stickerPath.closePath();
  }

  // Step 1: Draw drop shadow for 3D sticker effect
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#ffffff';
  ctx.fill(stickerPath);
  ctx.restore();

  // Step 2: Draw thick white vinyl sticker outline
  ctx.save();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(stickerPath);
  ctx.restore();

  // Step 3: Draw opaque white sticker backing
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fill(stickerPath);
  ctx.restore();

  // Step 4: Clip image to sticker badge and draw masked-out portrait
  ctx.save();
  ctx.clip(stickerPath);

  // Cel-shade tone enhancement
  ctx.filter = 'contrast(116%) saturate(120%) brightness(102%)';
  ctx.drawImage(cropCanvas, pad, pad, badgeW, badgeH);
  ctx.filter = 'none';

  // Step 5: Glossy diagonal sticker glare reflection
  const glossGrad = ctx.createLinearGradient(pad, pad, pad + badgeW * 0.8, pad + badgeH * 0.8);
  glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
  glossGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.10)');
  glossGrad.addColorStop(0.65, 'transparent');
  ctx.fillStyle = glossGrad;
  ctx.fill(stickerPath);

  // Step 6: Subtle inner rim
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.2)';
  ctx.stroke(stickerPath);
  ctx.restore();

  return canvas;
}





/**
 * Renders the 9 pro reaction overlays (blush, heart eyes, sparkle, wink, dizzy, etc.)
 */
function renderReactionOverlays(
  rCtx: CanvasRenderingContext2D,
  idx: number,
  feat: any,
  bustSize: number
) {
  const eyeLX = feat.eyeLeft.x - bustSize / 2;
  const eyeLY = feat.eyeLeft.y - bustSize / 2;
  const eyeRX = feat.eyeRight.x - bustSize / 2;
  const eyeRY = feat.eyeRight.y - bustSize / 2;
  const mouthX = feat.mouth.x - bustSize / 2;
  const mouthY = feat.mouth.y - bustSize / 2;
  const cheekLX = feat.cheekLeft.x - bustSize / 2;
  const cheekLY = feat.cheekLeft.y - bustSize / 2;
  const cheekRX = feat.cheekRight.x - bustSize / 2;
  const cheekRY = feat.cheekRight.y - bustSize / 2;
  const eyeDist = feat.eyeDistance;
  const eyeTilt = feat.eyeTilt;
  const fcX = feat.faceCenter.x - bustSize / 2;
  const fcY = feat.faceCenter.y - bustSize / 2;
  const hs = feat.headSize;

  switch (idx) {
    case 0: // 0: Blink (Relaxed Closed Eyelids & Blush)
      drawClosedEyelids(rCtx, eyeLX, eyeLY, eyeDist * 0.44, eyeTilt);
      drawClosedEyelids(rCtx, eyeRX, eyeRY, eyeDist * 0.44, eyeTilt);
      drawAnimeBlush(rCtx, cheekLX, cheekLY, eyeDist * 0.35);
      drawAnimeBlush(rCtx, cheekRX, cheekRY, eyeDist * 0.35);
      break;

    case 1: // 1: Heart Eyes (Glossy 3D Hearts & Twin Floating Hearts)
      drawGlossyHeart(rCtx, eyeLX, eyeLY, eyeDist * 0.62, eyeTilt);
      drawGlossyHeart(rCtx, eyeRX, eyeRY, eyeDist * 0.62, eyeTilt);
      drawFloatingHeart(rCtx, fcX + hs * 0.52, fcY - hs * 0.48, hs * 0.2, '#f43f5e');
      drawFloatingHeart(rCtx, fcX - hs * 0.52, fcY - hs * 0.38, hs * 0.16, '#fb7185');
      break;

    case 2: // 2: Sparkle (Golden 4-Point Anime Stars & Excited Eyes)
      drawAnimeSparkleStar(rCtx, fcX - hs * 0.56, fcY - hs * 0.46, hs * 0.24, '#f59e0b');
      drawAnimeSparkleStar(rCtx, fcX + hs * 0.58, fcY - hs * 0.36, hs * 0.2, '#fbbf24');
      drawAnimeSparkleStar(rCtx, fcX + hs * 0.46, fcY + hs * 0.28, hs * 0.16, '#38bdf8');
      drawAnimeSparkleStar(rCtx, fcX - hs * 0.46, fcY + hs * 0.34, hs * 0.14, '#fbbf24');
      drawEyeStarGleam(rCtx, eyeLX, eyeLY, eyeDist * 0.24);
      drawEyeStarGleam(rCtx, eyeRX, eyeRY, eyeDist * 0.24);
      break;

    case 3: // 3: Surprised (Gasping 'O' Mouth & Comic Sweat Drop)
      drawComicSweatDrop(rCtx, fcX + hs * 0.44, fcY - hs * 0.38, hs * 0.18);
      drawGaspingMouth(rCtx, mouthX, mouthY, eyeDist * 0.24, eyeDist * 0.34);
      break;

    case 4: // 4: Wink (Playful Star Wink & Confident Smirk)
      drawWinkingEye(rCtx, eyeRX, eyeRY, eyeDist * 0.46, eyeTilt);
      drawEyeStarGleam(rCtx, eyeLX, eyeLY, eyeDist * 0.24);
      drawPlayfulSmirk(rCtx, mouthX, mouthY, eyeDist * 0.42);
      drawFloatingHeart(rCtx, fcX + hs * 0.52, fcY - hs * 0.38, hs * 0.15, '#ec4899');
      break;

    case 5: // 5: Bashful (Deep Rose Blush & Shy Sweet Glance)
      drawDeepBlush(rCtx, cheekLX, cheekLY, eyeDist * 0.4);
      drawDeepBlush(rCtx, cheekRX, cheekRY, eyeDist * 0.4);
      drawCuteSmile(rCtx, mouthX, mouthY, eyeDist * 0.35);
      break;

    case 6: // 6: Sleepy (Cyan Sleep Bubble & Floating "Zzz")
      drawClosedEyelids(rCtx, eyeLX, eyeLY, eyeDist * 0.44, eyeTilt);
      drawClosedEyelids(rCtx, eyeRX, eyeRY, eyeDist * 0.44, eyeTilt);
      drawSleepBubble(rCtx, mouthX + eyeDist * 0.28, mouthY - eyeDist * 0.18, eyeDist * 0.38);
      drawSleepyZzz(rCtx, fcX + hs * 0.5, fcY - hs * 0.46);
      break;

    case 7: // 7: Dizzy (Hypnosis Spiral Glasses, Orbiting Stars & Wavy Mouth)
      drawHypnoSpiral(rCtx, eyeLX, eyeLY, eyeDist * 0.48);
      drawHypnoSpiral(rCtx, eyeRX, eyeRY, eyeDist * 0.48);
      drawAnimeSparkleStar(rCtx, fcX - hs * 0.42, fcY - hs * 0.58, hs * 0.16, '#eab308');
      drawAnimeSparkleStar(rCtx, fcX, fcY - hs * 0.65, hs * 0.2, '#facc15');
      drawAnimeSparkleStar(rCtx, fcX + hs * 0.42, fcY - hs * 0.58, hs * 0.16, '#eab308');
      drawWavyDazedMouth(rCtx, mouthX, mouthY, eyeDist * 0.55);
      break;

    case 8: // 8: Delighted (Happy Arcs ^▽^ & Big Laughing Smile)
      drawHappyEyeArc(rCtx, eyeLX, eyeLY, eyeDist * 0.44, eyeTilt);
      drawHappyEyeArc(rCtx, eyeRX, eyeRY, eyeDist * 0.44, eyeTilt);
      drawLaughingTeethMouth(rCtx, mouthX, mouthY, eyeDist * 0.52, eyeDist * 0.36);
      drawAnimeBlush(rCtx, cheekLX, cheekLY, eyeDist * 0.32);
      drawAnimeBlush(rCtx, cheekRX, cheekRY, eyeDist * 0.32);
      break;
  }
}

/**
 * Chibi art convention for facial anchors: eyes at 44% height, 16% apart.
 * Matches the reference mascot sheets. Used when no real landmarks are available.
 */
function defaultFeatures(size: number) {
  return {
    eyeLeft: { x: size * 0.42, y: size * 0.44 },
    eyeRight: { x: size * 0.58, y: size * 0.44 },
    eyeDistance: Math.round(size * 0.16),
    eyeTilt: 0,
    nose: { x: size * 0.5, y: size * 0.5 },
    mouth: { x: size * 0.5, y: size * 0.58 },
    cheekLeft: { x: size * 0.36, y: size * 0.52 },
    cheekRight: { x: size * 0.64, y: size * 0.52 },
    faceCenter: { x: size * 0.5, y: size * 0.46 },
    headSize: Math.round(size * 0.48),
  };
}

export async function generateSpriteSheetsFromPhoto(
  imgElement: HTMLImageElement,
  options: SpriteGenerationOptions = {}
): Promise<GeneratedMascotSheets> {

  const SHEET_SIZE = 1080;
  const CELL_SIZE = 360; // 3x3 grid

  let stickerBust: HTMLCanvasElement;
  let feat: any;

  if (options.isIllustration) {
    // A rendered illustration, not a photograph. MediaPipe selfie segmentation is a
    // photo-matting model and produces torn edges + unmatted background on drawings,
    // so key the flat chroma background out directly instead.
    const keyed = keyOutChroma(imgElement);
    if (keyed) {
      stickerBust = applyDieCut(frameAsBust(keyed, BUST_SIZE));
      feat = defaultFeatures(BUST_SIZE);
    } else {
      stickerBust = createDieCutStickerBust(imgElement, BUST_SIZE);
      feat = defaultFeatures(BUST_SIZE);
    }
  } else {
    try {
      const aiResult = await segmentAndExtractMascotBust(imgElement, BUST_SIZE);
      stickerBust = aiResult.bustCanvas;
      feat = aiResult.features;
    } catch (err) {
      console.warn('AI portrait segmentation failed, falling back to local die-cut sticker bust:', err);
      stickerBust = createDieCutStickerBust(imgElement, BUST_SIZE);
      feat = defaultFeatures(BUST_SIZE);
    }
  }

  const eyeLX = feat.eyeLeft.x - BUST_SIZE / 2;
  const eyeLY = feat.eyeLeft.y - BUST_SIZE / 2;
  const eyeRX = feat.eyeRight.x - BUST_SIZE / 2;
  const eyeRY = feat.eyeRight.y - BUST_SIZE / 2;
  const eyeDist = feat.eyeDistance;

  // -------------------------------------------------------------
  // 1. Generate 3x3 DIRECTIONS Sheet (9 Head & Gaze Angles)
  // Torso is anchored and stable: NO whole-body flipping or spinning!
  // Head has subtle neck-anchored 2.5D parallax (max 2-3px) + isolated pupil gaze tracking!
  // -------------------------------------------------------------
  const dirCanvas = document.createElement('canvas');
  dirCanvas.width = SHEET_SIZE;
  dirCanvas.height = SHEET_SIZE;
  const dCtx = dirCanvas.getContext('2d');
  if (!dCtx) throw new Error('Could not get directions canvas context');

  // [deg, scaleX, scaleY, dy, dx, gazeY]
  // deg: head turn angle around neck pivot (degrees)
  // scaleX, scaleY: 3D perspective foreshortening
  // dy, dx: subtle vertical lift/dip and horizontal shift (minimal so torso stays anchored)
  const DIRECTION_CONFIGS = [
    [-2.8, 0.96, 0.98, -2.5, -1.0, -0.85], // 0: Top-Left
    [0.0,  1.01, 0.97, -3.5,  0.0, -1.0],  // 1: Top (Up)
    [2.8,  0.96, 0.98, -2.5,  1.0, -0.85], // 2: Top-Right
    [-3.5, 0.94, 1.00,  0.0, -1.5,  0.0],  // 3: Left
    [0.0,  1.00, 1.00,  0.0,  0.0,  0.0],  // 4: Center (Forward Look)
    [3.5,  0.94, 1.00,  0.0,  1.5,  0.0],  // 5: Right
    [-2.5, 0.96, 0.98,  2.5, -1.0,  0.85], // 6: Bottom-Left
    [0.0,  1.01, 0.97,  3.5,  0.0,  1.0],  // 7: Bottom (Down)
    [2.5,  0.96, 0.98,  2.5,  1.0,  0.85], // 8: Bottom-Right
  ];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const [deg, scaleX, scaleY, dy, dx, gazeY] = DIRECTION_CONFIGS[idx];

      const cx = c * CELL_SIZE + CELL_SIZE / 2;
      const cy = r * CELL_SIZE + CELL_SIZE / 2;

      dCtx.save();
      dCtx.translate(cx, cy);

      // Pivot placed at the base of the neck / upper chest (BUST_SIZE * 0.38)
      // This ensures shoulders and chest base stay locked in position (matching Fox/Bear)
      const pivotY = BUST_SIZE * 0.38;
      dCtx.translate(dx, dy + pivotY);
      if (deg !== 0) {
        dCtx.rotate((deg * Math.PI) / 180);
      }
      dCtx.scale(scaleX, scaleY);
      dCtx.translate(0, -pivotY);

      dCtx.drawImage(stickerBust, -BUST_SIZE / 2, -BUST_SIZE / 2);

      // Subtle eyelid contour only when looking down (never stamps fake pupils)
      drawDirectionalGaze(
        dCtx,
        eyeLX,
        eyeLY,
        eyeRX,
        eyeRY,
        eyeDist,
        0,
        gazeY
      );

      dCtx.restore();
    }
  }

  // -------------------------------------------------------------
  // 2. Generate 3x3 REACTIONS Sheet (9 Expressions)
  // -------------------------------------------------------------
  const reactCanvas = document.createElement('canvas');
  reactCanvas.width = SHEET_SIZE;
  reactCanvas.height = SHEET_SIZE;
  const rCtx = reactCanvas.getContext('2d');
  if (!rCtx) throw new Error('Could not get reactions canvas context');

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cx = c * CELL_SIZE + CELL_SIZE / 2;
      const cy = r * CELL_SIZE + CELL_SIZE / 2;

      rCtx.save();
      rCtx.translate(cx, cy);

      // Base Character Bust (True borderless cutout)
      rCtx.drawImage(stickerBust, -BUST_SIZE / 2, -BUST_SIZE / 2);

      // PRO STICKER VECTOR OVERLAYS (Accurately targeted to face landmarks)
      renderReactionOverlays(rCtx, idx, feat, BUST_SIZE);

      rCtx.restore();
    }
  }

  const directionsUrl = dirCanvas.toDataURL('image/webp', 0.95);
  const reactionsUrl = reactCanvas.toDataURL('image/webp', 0.95);

  return { directionsUrl, reactionsUrl };
}

// -------------------------------------------------------------
// Pro Sticker Graphic Vector Renderers
// -------------------------------------------------------------

/**
 * Applies subtle soft eyelid contour adjustments when looking downwards.
 * Never stamps opaque artificial black pupils over the character's already-drawn eyes.
 */
function drawDirectionalGaze(
  ctx: CanvasRenderingContext2D,
  eyeLX: number,
  eyeLY: number,
  eyeRX: number,
  eyeRY: number,
  eyeDist: number,
  _gazeX: number,
  gazeY: number
) {
  // Only apply subtle soft eyelid contour when looking downward (never paint fake pupils over drawn eyes!)
  if (gazeY <= 0.4) return;

  const eyeRadius = Math.max(6, eyeDist * 0.16);
  const eyes = [
    { x: eyeLX, y: eyeLY },
    { x: eyeRX, y: eyeRY },
  ];

  ctx.save();
  for (const eye of eyes) {
    ctx.save();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.beginPath();
    ctx.arc(eye.x, eye.y - eyeRadius * 0.15, eyeRadius * 0.95, 0.85 * Math.PI, 0.15 * Math.PI, true);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawGlossyHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tilt: number = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);

  // Outer bold border
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 6;

  ctx.beginPath();
  const topH = size * 0.32;
  ctx.moveTo(0, topH);
  ctx.bezierCurveTo(0, 0, -size / 2, 0, -size / 2, topH);
  ctx.bezierCurveTo(-size / 2, (size + topH) / 2, 0, size, 0, size);
  ctx.bezierCurveTo(0, size, size / 2, (size + topH) / 2, size / 2, topH);
  ctx.bezierCurveTo(size / 2, 0, 0, 0, 0, topH);
  ctx.closePath();

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#ff2d55');
  grad.addColorStop(1, '#be123c');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.stroke();

  // Gloss highlight
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.beginPath();
  ctx.ellipse(-size * 0.22, topH * 0.7, size * 0.12, size * 0.08, -Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawFloatingHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.15);

  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 5;

  ctx.beginPath();
  const topH = size * 0.3;
  ctx.moveTo(0, topH);
  ctx.bezierCurveTo(0, 0, -size / 2, 0, -size / 2, topH);
  ctx.bezierCurveTo(-size / 2, (size + topH) / 2, 0, size, 0, size);
  ctx.bezierCurveTo(0, size, size / 2, (size + topH) / 2, size / 2, topH);
  ctx.bezierCurveTo(size / 2, 0, 0, 0, 0, topH);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawAnimeSparkleStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 6;

  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.quadraticCurveTo(0, 0, 0, radius);
  ctx.quadraticCurveTo(0, 0, -radius, 0);
  ctx.quadraticCurveTo(0, 0, 0, -radius);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();

  // Star center glint
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawEyeStarGleam(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.quadraticCurveTo(0, 0, 0, radius);
  ctx.quadraticCurveTo(0, 0, -radius, 0);
  ctx.quadraticCurveTo(0, 0, 0, -radius);
  ctx.fill();
  ctx.restore();
}

function drawClosedEyelids(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, tilt: number = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#0f172a';
  ctx.lineCap = 'round';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 4;

  ctx.beginPath();
  ctx.arc(0, 0, width / 2, Math.PI * 0.12, Math.PI * 0.88);
  ctx.stroke();
  ctx.restore();
}

function drawWinkingEye(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, tilt: number = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  ctx.lineWidth = 5.5;
  ctx.strokeStyle = '#0f172a';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(-width / 2, 2);
  ctx.quadraticCurveTo(0, -10, width / 2, 2);
  ctx.stroke();

  // Eyelash perk
  ctx.beginPath();
  ctx.moveTo(width / 2 - 2, 0);
  ctx.lineTo(width / 2 + 6, -6);
  ctx.stroke();
  ctx.restore();
}

function drawHappyEyeArc(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, tilt: number = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#0f172a';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = 4;

  ctx.beginPath();
  ctx.arc(0, 0, width / 2, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.restore();
}

function drawAnimeBlush(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Cute blush stripes
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(225, 29, 72, 0.6)';
  ctx.beginPath();
  ctx.moveTo(-radius * 0.4, -2);
  ctx.lineTo(-radius * 0.2, 4);
  ctx.moveTo(0, -2);
  ctx.lineTo(radius * 0.2, 4);
  ctx.moveTo(radius * 0.4, -2);
  ctx.lineTo(radius * 0.6, 4);
  ctx.stroke();
  ctx.restore();
}

function drawDeepBlush(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(236, 72, 153, 0.6)';
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.65, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawComicSweatDrop(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.35);

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 4;

  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.quadraticCurveTo(size * 0.6, 0, 0, size * 0.7);
  ctx.quadraticCurveTo(-size * 0.6, 0, 0, -size);
  ctx.closePath();

  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.stroke();

  // Drop highlight
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-size * 0.15, 0, size * 0.14, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGaspingMouth(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;

  ctx.fillStyle = '#1e1b4b';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Pink tongue inside
  ctx.fillStyle = '#f43f5e';
  ctx.beginPath();
  ctx.arc(0, ry * 0.45, rx * 0.75, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}

function drawPlayfulSmirk(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = '#0f172a';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(-width / 2, 0);
  ctx.quadraticCurveTo(0, width * 0.5, width / 2, -width * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawCuteSmile(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0f172a';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.arc(0, 0, width, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawSleepBubble(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(186, 230, 253, 0.7)';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Bubble highlight
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-radius * 0.35, -radius * 0.35, radius * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSleepyZzz(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.font = '800 26px "Outfit", system-ui, sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.strokeText('Z', 0, 0);
  ctx.fillText('Z', 0, 0);

  ctx.font = '800 18px "Outfit", system-ui, sans-serif';
  ctx.strokeText('z', 16, -20);
  ctx.fillText('z', 16, -20);

  ctx.font = '800 13px "Outfit", system-ui, sans-serif';
  ctx.strokeText('z', 28, -36);
  ctx.fillText('z', 28, -36);
  ctx.restore();
}

function drawHypnoSpiral(ctx: CanvasRenderingContext2D, x: number, y: number, maxR: number) {
  ctx.save();
  ctx.translate(x, y);

  // Background white lens
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, maxR + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#6366f1';
  ctx.lineCap = 'round';
  ctx.beginPath();

  for (let i = 0; i < 48; i++) {
    const angle = 0.28 * i;
    const r = (maxR / 48) * i;
    const px = r * Math.cos(angle);
    const py = r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Glasses rim
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1e1b4b';
  ctx.beginPath();
  ctx.arc(0, 0, maxR + 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawWavyDazedMouth(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = '#1e293b';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(-width / 2, 0);
  ctx.quadraticCurveTo(-width / 4, -8, 0, 0);
  ctx.quadraticCurveTo(width / 4, 8, width / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function drawLaughingTeethMouth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.lineWidth = 4.5;
  ctx.strokeStyle = '#0f172a';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 4;

  ctx.beginPath();
  ctx.arc(0, 0, width / 2, 0, Math.PI);
  ctx.closePath();

  ctx.fillStyle = '#be123c';
  ctx.fill();
  ctx.stroke();

  // White teeth row
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.rect(-width * 0.4, 0, width * 0.8, height * 0.45);
  ctx.fill();

  ctx.restore();
}
