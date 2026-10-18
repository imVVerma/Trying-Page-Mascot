import JSZip from 'jszip';

export interface StickerItem {
  id: string;
  name: string;
  type: 'direction' | 'reaction';
  row: number;
  col: number;
  label: string;
  expressionOrAngle: string;
  filename: string;
  dataUrl: string;
  blob: Blob;
}

const DIRECTION_NAMES = [
  { id: 'dir_top_left', label: 'Looking Up-Left', angle: 'Top-Left', filename: '01_up_left' },
  { id: 'dir_top', label: 'Looking Up', angle: 'Top', filename: '02_up' },
  { id: 'dir_top_right', label: 'Looking Up-Right', angle: 'Top-Right', filename: '03_up_right' },
  { id: 'dir_left', label: 'Looking Left', angle: 'Left', filename: '04_left' },
  { id: 'dir_center', label: 'Facing Center', angle: 'Center', filename: '05_center' },
  { id: 'dir_right', label: 'Looking Right', angle: 'Right', filename: '06_right' },
  { id: 'dir_bottom_left', label: 'Looking Down-Left', angle: 'Down-Left', filename: '07_down_left' },
  { id: 'dir_bottom', label: 'Looking Down', angle: 'Down', filename: '08_down' },
  { id: 'dir_bottom_right', label: 'Looking Down-Right', angle: 'Down-Right', filename: '09_down_right' },
];

const REACTION_NAMES = [
  { id: 'react_blink', label: 'Gentle Blink', expr: 'Blink', filename: '10_blink' },
  { id: 'react_heart', label: 'Heart Eyes / Love', expr: 'Heart', filename: '11_heart_eyes' },
  { id: 'react_sparkle', label: 'Sparkle Excitement', expr: 'Sparkle', filename: '12_sparkle' },
  { id: 'react_surprised', label: 'Gasping Surprise', expr: 'Surprised', filename: '13_surprised' },
  { id: 'react_wink', label: 'Playful Wink', expr: 'Wink', filename: '14_wink' },
  { id: 'react_bashful', label: 'Bashful Blush', expr: 'Bashful', filename: '15_bashful' },
  { id: 'react_sleepy', label: 'Sleepy / Zzz', expr: 'Sleepy', filename: '16_sleepy' },
  { id: 'react_dizzy', label: 'Dizzy Spirals (@_@)', expr: 'Dizzy', filename: '17_dizzy' },
  { id: 'react_delighted', label: 'Delighted Joy', expr: 'Delighted', filename: '18_delighted' },
];

/**
 * Loads an image URL into an HTMLImageElement with crossOrigin support.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load sprite sheet from ${url}: ${e}`));
  });
}

/**
 * Slices two 3x3 sprite sheets (directions and reactions) into 18 individual
 * 512x512 transparent WebP stickers.
 */
export async function sliceSpriteSheetsToStickers(
  directionsUrl: string,
  reactionsUrl: string,
  characterName: string = 'mascot'
): Promise<StickerItem[]> {
  const [directionsImg, reactionsImg] = await Promise.all([
    loadImage(directionsUrl),
    loadImage(reactionsUrl),
  ]);

  const stickers: StickerItem[] = [];
  const exportSize = 512;

  // Helper to slice a 3x3 sheet
  const sliceSheet = async (
    img: HTMLImageElement,
    type: 'direction' | 'reaction',
    metaList: typeof DIRECTION_NAMES | typeof REACTION_NAMES
  ) => {
    const cellW = img.naturalWidth / 3;
    const cellH = img.naturalHeight / 3;

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const index = r * 3 + c;
        const meta = metaList[index];

        const canvas = document.createElement('canvas');
        canvas.width = exportSize;
        canvas.height = exportSize;
        const ctx = canvas.getContext('2d');

        if (!ctx) continue;

        // Clear transparent background
        ctx.clearRect(0, 0, exportSize, exportSize);

        // Draw source cell scaled to 512x512
        const sx = c * cellW;
        const sy = r * cellH;
        ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, exportSize, exportSize);

        const blob = await new Promise<Blob>((res) => {
          canvas.toBlob(
            (b) => res(b || new Blob()),
            'image/webp',
            0.95
          );
        });

        const dataUrl = canvas.toDataURL('image/webp', 0.95);
        const safeName = characterName.toLowerCase().replace(/[^a-z0-9]/g, '_');

        stickers.push({
          id: meta.id,
          name: meta.label,
          type,
          row: r,
          col: c,
          label: meta.label,
          expressionOrAngle: 'expr' in meta ? meta.expr : meta.angle,
          filename: `${safeName}_${meta.filename}.webp`,
          dataUrl,
          blob,
        });
      }
    }
  };

  await sliceSheet(directionsImg, 'direction', DIRECTION_NAMES);
  await sliceSheet(reactionsImg, 'reaction', REACTION_NAMES);

  return stickers;
}

/**
 * Downloads a single sticker as a 512x512 WebP image.
 */
export function downloadSingleSticker(sticker: StickerItem) {
  const link = document.createElement('a');
  link.href = sticker.dataUrl;
  link.download = sticker.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Packages all 18 stickers into a single .zip archive for WhatsApp, Telegram, or Discord.
 */
export async function downloadAllStickersZip(
  stickers: StickerItem[],
  characterName: string = 'Mascot'
): Promise<void> {
  const zip = new JSZip();
  const safeName = characterName.toLowerCase().replace(/[^a-z0-9]/g, '_');

  const folder = zip.folder(`${safeName}_sticker_pack`);

  // Add individual stickers
  stickers.forEach((sticker) => {
    folder?.file(sticker.filename, sticker.blob);
  });

  // Add metadata manifest
  const manifest = {
    title: `${characterName} Page Mascot Sticker Pack`,
    author: 'Page Mascot Studio',
    version: '1.0.0',
    totalStickers: stickers.length,
    format: '512x512 transparent WebP',
    compatibleWith: ['WhatsApp', 'Telegram', 'Discord', 'Slack', 'iMessage'],
    stickers: stickers.map((s) => ({
      name: s.name,
      type: s.type,
      expressionOrAngle: s.expressionOrAngle,
      filename: s.filename,
    })),
  };

  folder?.file('manifest.json', JSON.stringify(manifest, null, 2));

  // Add README
  const readme = `# ${characterName} WhatsApp & Chat Sticker Pack

This pack contains 18 high-resolution 512x512 transparent WebP stickers generated from 3x3 Page Mascot sprite sheets:

- 9 Head Direction Angles (Top-Left, Up, Top-Right, Left, Center, Right, Down-Left, Down, Down-Right)
- 9 Reaction Expressions (Blink, Heart Eyes, Sparkles, Surprised, Wink, Bashful, Sleepy, Dizzy @_@, Delighted)

### How to use:
- **WhatsApp**: Import using apps like "Sticker.ly" or "Personal Stickers for WhatsApp".
- **Telegram**: Upload via @Stickers bot in Telegram.
- **Discord / Slack**: Upload directly as custom emoji or server stickers.
`;
  folder?.file('README.md', readme);

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}_stickers_18pack.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
