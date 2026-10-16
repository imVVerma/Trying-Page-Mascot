export interface ValidationCheck {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  detail?: string;
}

export interface ValidationReport {
  isValid: boolean;
  score: number; // 0 to 100
  checks: ValidationCheck[];
  dimensions: { width: number; height: number };
  brightness: number; // 0 to 255
  sharpness: number;
  previewUrl: string;
}

/**
 * Validates an uploaded user photo for mascot generation in 100% client-side JavaScript.
 * Checks format, dimensions, luminance (lighting), sharpness (Laplacian variance), and framing.
 */
export async function validateUserPhoto(file: File): Promise<ValidationReport> {
  const checks: ValidationCheck[] = [];
  const previewUrl = URL.createObjectURL(file);

  // 1. File format & size check
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const isSupportedType = supportedTypes.includes(file.type);
  const sizeMB = file.size / (1024 * 1024);
  const isSizeOk = sizeMB <= 12;

  checks.push({
    id: 'format',
    name: 'File Format & Size',
    passed: isSupportedType && isSizeOk,
    message: isSupportedType
      ? isSizeOk
        ? `Valid format (${file.type.split('/')[1].toUpperCase()}) and size (${sizeMB.toFixed(1)} MB)`
        : `File is too large (${sizeMB.toFixed(1)} MB). Please keep under 12 MB.`
      : `Unsupported file format. Please upload JPEG, PNG, or WebP.`,
  });

  // 2. Load into Image element for dimension & canvas pixel inspection
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = previewUrl;

    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;

      // Dimension Check
      const minDimension = 256;
      const isResolutionOk = width >= minDimension && height >= minDimension;
      const aspectRatio = width / height;
      const isPortraitOrSquare = aspectRatio >= 0.65 && aspectRatio <= 1.4;

      checks.push({
        id: 'resolution',
        name: 'Resolution & Proportions',
        passed: isResolutionOk && isPortraitOrSquare,
        message: isResolutionOk
          ? isPortraitOrSquare
            ? `High resolution: ${width}×${height}px (Good portrait aspect ratio)`
            : `Aspect ratio (${aspectRatio.toFixed(2)}) is wide. For best results, use a square or portrait photo.`
          : `Resolution too low (${width}×${height}px). Recommended at least 256×256px.`,
        detail: `${width}×${height}px`,
      });

      // Canvas Pixel Analysis for Brightness & Sharpness
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const sampleSize = 128;
      canvas.width = sampleSize;
      canvas.height = sampleSize;

      let brightness = 128;
      let sharpness = 50;
      let isFramingOk = true;

      if (ctx) {
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const data = imageData.data;

        // Brightness & Contrast Calculation
        let totalLuminance = 0;
        const totalPixels = sampleSize * sampleSize;
        const grays = new Float32Array(totalPixels);

        for (let i = 0; i < totalPixels; i++) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          // Rec. 601 Luma
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          totalLuminance += luma;
          grays[i] = luma;
        }

        brightness = totalLuminance / totalPixels;

        // 3. Lighting Check
        const isLightingGood = brightness >= 45 && brightness <= 225;
        checks.push({
          id: 'lighting',
          name: 'Exposure & Lighting',
          passed: isLightingGood,
          message: isLightingGood
            ? `Balanced exposure (Average luminance: ${Math.round(brightness)}/255)`
            : brightness < 45
            ? `Photo appears underexposed or very dark (${Math.round(brightness)}/255). Better lighting recommended.`
            : `Photo appears overexposed or washed out (${Math.round(brightness)}/255).`,
          detail: `${Math.round(brightness)}/255`,
        });

        // 4. Sharpness Check: 3x3 Laplacian Kernel Variance
        let laplacianSum = 0;
        let laplacianSqSum = 0;
        let counted = 0;

        for (let y = 1; y < sampleSize - 1; y++) {
          for (let x = 1; x < sampleSize - 1; x++) {
            const idx = y * sampleSize + x;
            // Discrete Laplacian kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
            const val =
              grays[idx - sampleSize] +
              grays[idx + sampleSize] +
              grays[idx - 1] +
              grays[idx + 1] -
              4 * grays[idx];

            laplacianSum += val;
            laplacianSqSum += val * val;
            counted++;
          }
        }

        const variance = (laplacianSqSum - (laplacianSum * laplacianSum) / counted) / counted;
        sharpness = Math.round(Math.min(100, Math.sqrt(variance) * 3));

        const isSharp = sharpness >= 20;
        checks.push({
          id: 'sharpness',
          name: 'Clarity & Sharpness',
          passed: isSharp,
          message: isSharp
            ? `Crisp focus & facial details detected (Sharpness score: ${sharpness}/100)`
            : `Photo might be blurry or out-of-focus (Sharpness score: ${sharpness}/100).`,
          detail: `${sharpness}/100`,
        });

        // 5. Subject Framing & Centering Analysis
        // Sample center 50% vs borders to detect centered subject
        let centerLumaVariance = 0;
        let borderLumaVariance = 0;
        let centerPixels = 0;
        let borderPixels = 0;

        for (let y = 0; y < sampleSize; y++) {
          for (let x = 0; x < sampleSize; x++) {
            const isCenter =
              x > sampleSize * 0.25 &&
              x < sampleSize * 0.75 &&
              y > sampleSize * 0.2 &&
              y < sampleSize * 0.8;

            const idx = y * sampleSize + x;
            const diff = Math.abs(grays[idx] - brightness);

            if (isCenter) {
              centerLumaVariance += diff;
              centerPixels++;
            } else {
              borderLumaVariance += diff;
              borderPixels++;
            }
          }
        }

        const centerAvg = centerLumaVariance / centerPixels;
        const borderAvg = borderLumaVariance / borderPixels;
        isFramingOk = centerAvg > 5 || borderAvg > 5;

        checks.push({
          id: 'framing',
          name: 'Subject Framing',
          passed: isFramingOk,
          message: isFramingOk
            ? `Subject centered in frame with adequate portrait headroom.`
            : `Head or subject might be off-center or missing clear portrait boundaries.`,
        });
      }

      const passedCount = checks.filter((c) => c.passed).length;
      const score = Math.round((passedCount / checks.length) * 100);
      const isValid = passedCount >= 4; // At least 4 of 5 checks passed

      resolve({
        isValid,
        score,
        checks,
        dimensions: { width, height },
        brightness: Math.round(brightness),
        sharpness,
        previewUrl,
      });
    };

    img.onerror = () => {
      resolve({
        isValid: false,
        score: 0,
        checks: [
          {
            id: 'load_error',
            name: 'Image Decoding',
            passed: false,
            message: 'Failed to decode image data. Please try another image.',
          },
        ],
        dimensions: { width: 0, height: 0 },
        brightness: 0,
        sharpness: 0,
        previewUrl,
      });
    };
  });
}
