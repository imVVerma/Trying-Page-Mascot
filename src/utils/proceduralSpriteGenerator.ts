/**
 * Client-Side Procedural 3x3 Sprite Sheet & Die-Cut Sticker Generator.
 * Transforms any user photo into authentic WhatsApp/Telegram-style stickers
 * and 3x3 head-direction / expression sprite sheets.
 */

export interface GeneratedMascotSheets {
  directionsUrl: string;
  reactionsUrl: string;
}

/**
 * Creates a die-cut sticker bust from an image:
 * - Square crop centered on portrait
 * - Natural bust contour cutout (tapered shoulders)
 * - Cel-shade / comic tone enhancement
 * - Thick die-cut white outline with soft 3D ambient shadow
 */
function createDieCutStickerBust(imgElement: HTMLImageElement, size: number = 260): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d canvas context');

  const sw = imgElement.naturalWidth;
  const sh = imgElement.naturalHeight;
  const cropSize = Math.min(sw, sh);
  const sx = (sw - cropSize) / 2;
  const sy = Math.max(0, (sh - cropSize) * 0.15); // portrait face bias

  // Step 1: Draw offscreen bust silhouette path
  const bustPath = new Path2D();
  const cx = size / 2;
  const cy = size * 0.46;
  const headR = size * 0.36;

  // Head circle + shoulder taper contour (smooth bust silhouette)
  bustPath.arc(cx, cy, headR, Math.PI * 0.85, Math.PI * 0.15, false);
  // Right shoulder curve
  bustPath.bezierCurveTo(cx + headR + 10, size * 0.82, cx + headR + 24, size * 0.94, cx + headR + 18, size * 0.98);
  // Bottom edge
  bustPath.lineTo(cx - headR - 18, size * 0.98);
  // Left shoulder curve
  bustPath.bezierCurveTo(cx - headR - 24, size * 0.94, cx - headR - 10, size * 0.82, cx - headR, cy + headR * 0.7);
  bustPath.closePath();

  // Step 2: Draw drop shadow for 3D sticker effect
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#ffffff';
  ctx.fill(bustPath);
  ctx.restore();

  // Step 3: Draw thick white die-cut border
  ctx.save();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(bustPath);
  ctx.restore();

  // Step 4: Clip image to the bust path
  ctx.save();
  ctx.clip(bustPath);

  // Apply subtle cel-shade / vibrant cartoon filter to make it look like an illustration
  ctx.filter = 'contrast(118%) saturate(125%) brightness(102%)';
  ctx.drawImage(imgElement, sx, sy, cropSize, cropSize, cx - headR - 20, 0, (headR + 20) * 2, size);
  ctx.filter = 'none';

  // Inner subtle dark rim for clean definition
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
  ctx.stroke(bustPath);
  ctx.restore();

  return canvas;
}

export async function generateSpriteSheetsFromPhoto(
  imgElement: HTMLImageElement
): Promise<GeneratedMascotSheets> {
  const SHEET_SIZE = 1080;
  const CELL_SIZE = 360; // 3x3 grid
  const BUST_SIZE = 250;

  // Create the high-quality sticker bust
  const stickerBust = createDieCutStickerBust(imgElement, BUST_SIZE);

  // -------------------------------------------------------------
  // 1. Generate 3x3 DIRECTIONS Sheet (9 Head Angles)
  // -------------------------------------------------------------
  const dirCanvas = document.createElement('canvas');
  dirCanvas.width = SHEET_SIZE;
  dirCanvas.height = SHEET_SIZE;
  const dCtx = dirCanvas.getContext('2d');
  if (!dCtx) throw new Error('Could not get directions canvas context');

  // [dx, dy, rotateDeg, scaleX, scaleY]
  const DIRECTION_TRANSFORMS = [
    [-18, -14, -5, 0.96, 1.02], // 0: Top-Left
    [0, -18, 0, 0.95, 1.04],    // 1: Top
    [18, -14, 5, 0.96, 1.02],   // 2: Top-Right
    [-22, 0, -4, 0.93, 1.0],    // 3: Left
    [0, 0, 0, 1.0, 1.0],        // 4: Center (Dead-zone)
    [22, 0, 4, 0.93, 1.0],      // 5: Right
    [-16, 15, -4, 1.03, 0.96],  // 6: Bottom-Left
    [0, 20, 0, 1.04, 0.95],     // 7: Bottom
    [16, 15, 4, 1.03, 0.96],    // 8: Bottom-Right
  ];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const [dx, dy, deg, sxScale, syScale] = DIRECTION_TRANSFORMS[idx];

      const cx = c * CELL_SIZE + CELL_SIZE / 2;
      const cy = r * CELL_SIZE + CELL_SIZE / 2;

      dCtx.save();
      dCtx.translate(cx + dx, cy + dy);
      dCtx.rotate((deg * Math.PI) / 180);
      dCtx.scale(sxScale, syScale);
      dCtx.drawImage(stickerBust, -BUST_SIZE / 2, -BUST_SIZE / 2);
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

      // Base Sticker Bust
      rCtx.drawImage(stickerBust, -BUST_SIZE / 2, -BUST_SIZE / 2);

      // PRO STICKER VECTOR OVERLAYS (Full-Res Comic Elements)
      switch (idx) {
        case 0: // 0: Blink (Relaxed Closed Eyelids & Blush)
          drawClosedEyelids(rCtx, -28, -12, 18);
          drawClosedEyelids(rCtx, 28, -12, 18);
          drawAnimeBlush(rCtx, -38, 16, 16);
          drawAnimeBlush(rCtx, 38, 16, 16);
          break;

        case 1: // 1: Heart Eyes (Glossy 3D Hearts & Twin Floating Hearts)
          drawGlossyHeart(rCtx, -28, -10, 26);
          drawGlossyHeart(rCtx, 28, -10, 26);
          drawFloatingHeart(rCtx, 56, -65, 22, '#f43f5e');
          drawFloatingHeart(rCtx, -58, -50, 16, '#fb7185');
          break;

        case 2: // 2: Sparkle (Golden 4-Point Anime Stars & Excited Eyes)
          drawAnimeSparkleStar(rCtx, -60, -65, 26, '#f59e0b');
          drawAnimeSparkleStar(rCtx, 65, -50, 22, '#fbbf24');
          drawAnimeSparkleStar(rCtx, 52, 25, 16, '#38bdf8');
          drawAnimeSparkleStar(rCtx, -50, 35, 14, '#fbbf24');
          // Star gleam on eyes
          drawEyeStarGleam(rCtx, -28, -12, 12);
          drawEyeStarGleam(rCtx, 28, -12, 12);
          break;

        case 3: // 3: Surprised (Gasping 'O' Mouth & Comic Sweat Drop)
          drawComicSweatDrop(rCtx, 46, -45, 18);
          drawGaspingMouth(rCtx, 0, 32, 15, 22);
          break;

        case 4: // 4: Wink (Playful Star Wink & Confident Smirk)
          drawWinkingEye(rCtx, 28, -12, 22);
          drawEyeStarGleam(rCtx, -28, -12, 12);
          drawPlayfulSmirk(rCtx, 0, 26, 20);
          drawFloatingHeart(rCtx, 58, -50, 15, '#ec4899');
          break;

        case 5: // 5: Bashful (Deep Rose Blush & Shy Sweet Glance)
          drawDeepBlush(rCtx, -38, 12, 22);
          drawDeepBlush(rCtx, 38, 12, 22);
          drawCuteSmile(rCtx, 0, 26, 14);
          break;

        case 6: // 6: Sleepy (Cyan Sleep Bubble & Floating "Zzz")
          drawSleepBubble(rCtx, 28, -18, 16);
          drawSleepyZzz(rCtx, 50, -60);
          drawClosedEyelids(rCtx, -28, -8, 18);
          break;

        case 7: // 7: Dizzy (Hypnosis Spiral Glasses, Orbiting Stars & Wavy Mouth)
          drawHypnoSpiral(rCtx, -28, -10, 20);
          drawHypnoSpiral(rCtx, 28, -10, 20);
          drawAnimeSparkleStar(rCtx, -44, -75, 16, '#eab308');
          drawAnimeSparkleStar(rCtx, 0, -85, 20, '#facc15');
          drawAnimeSparkleStar(rCtx, 44, -75, 16, '#eab308');
          drawWavyDazedMouth(rCtx, 0, 32, 28);
          break;

        case 8: // 8: Delighted (Happy Arcs ^▽^ & Big Laughing Smile)
          drawHappyEyeArc(rCtx, -28, -10, 18);
          drawHappyEyeArc(rCtx, 28, -10, 18);
          drawLaughingTeethMouth(rCtx, 0, 25, 26, 18);
          drawAnimeBlush(rCtx, -40, 18, 14);
          drawAnimeBlush(rCtx, 40, 18, 14);
          break;
      }

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

function drawGlossyHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);

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

function drawClosedEyelids(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.save();
  ctx.translate(x, y);
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

function drawWinkingEye(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.save();
  ctx.translate(x, y);
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

function drawHappyEyeArc(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.save();
  ctx.translate(x, y);
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
