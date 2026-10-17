/**
 * AI Portrait Segmentation & Mascot Bust Generator.
 * Powered by Google MediaPipe Selfie Segmentation & BlazeFace Face Detection (100% client-side, local WASM/TFLite).
 * 
 * Transforms any user photo into an authentic chibi-style character bust:
 * - 100% transparent background (removes rooms, auditoriums, ceilings, walls)
 * - Intelligent face-detection based chibi bust framing (shoulders up, head centered, standardized eye level at 44%)
 * - Precise facial landmark tracking (eyes, nose, mouth, cheeks) for reaction overlays
 * - Soft chest base fadeout into transparent alpha (matching Koboyo Fox/Bear/Cat/Wizard)
 * - Exact contour die-cut vinyl sticker outline (hugs hair & shoulders, NOT a square box)
 */

let segmenterInstance: any = null;
let faceDetectorInstance: any = null;

async function loadSelfieSegmentationClass(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any).SelfieSegmentation) {
    return (window as any).SelfieSegmentation;
  }

  return new Promise((resolve, reject) => {
    let script = document.querySelector('script[src*="selfie_segmentation.js"]') as HTMLScriptElement;
    if (!script) {
      script = document.createElement('script');
      script.src = '/mediapipe/selfie_segmentation.js';
      script.async = true;
      document.head.appendChild(script);
    }

    if ((window as any).SelfieSegmentation) {
      resolve((window as any).SelfieSegmentation);
      return;
    }

    script.onload = () => {
      if ((window as any).SelfieSegmentation) {
        resolve((window as any).SelfieSegmentation);
      } else {
        reject(new Error('SelfieSegmentation failed to bind to window'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load /mediapipe/selfie_segmentation.js'));
  });
}

async function getSegmenter(): Promise<any> {
  if (segmenterInstance) return segmenterInstance;

  let Cls = (window as any).SelfieSegmentation;
  if (!Cls) {
    Cls = await loadSelfieSegmentationClass();
  }
  if (!Cls) {
    throw new Error('MediaPipe SelfieSegmentation is not available');
  }

  const segmenter = new Cls({
    locateFile: (file: string) => `/mediapipe/${file}`,
  });

  segmenter.setOptions({
    modelSelection: 1, // 1: Landscape model (faster, higher quality for portraits)
    selfieMode: false,
  });

  await segmenter.initialize();
  segmenterInstance = segmenter;
  return segmenterInstance;
}

async function loadFaceDetectionClass(): Promise<any> {
  if (typeof window === 'undefined') return null;
  if ((window as any).FaceDetection) {
    return (window as any).FaceDetection;
  }

  return new Promise((resolve) => {
    let script = document.querySelector('script[src*="face_detection.js"]') as HTMLScriptElement;
    if (!script) {
      script = document.createElement('script');
      script.src = '/mediapipe/face_detection.js';
      script.async = true;
      document.head.appendChild(script);
    }

    if ((window as any).FaceDetection) {
      resolve((window as any).FaceDetection);
      return;
    }

    script.onload = () => {
      resolve((window as any).FaceDetection || null);
    };
    script.onerror = () => {
      console.warn('Failed to load /mediapipe/face_detection.js');
      resolve(null);
    };
  });
}

async function getFaceDetector(): Promise<any> {
  if (faceDetectorInstance) return faceDetectorInstance;

  let Cls = (window as any).FaceDetection;
  if (!Cls) {
    Cls = await loadFaceDetectionClass();
  }
  if (!Cls) {
    return null;
  }

  try {
    const detector = new Cls({
      locateFile: (file: string) => `/mediapipe/${file}`,
    });

    detector.setOptions({
      model: 'short',
      minDetectionConfidence: 0.5,
    });

    await detector.initialize();
    faceDetectorInstance = detector;
    return faceDetectorInstance;
  } catch (err) {
    console.warn('Face detector initialization failed:', err);
    return null;
  }
}

export interface FacialFeatures {
  eyeLeft: { x: number; y: number };
  eyeRight: { x: number; y: number };
  eyeDistance: number;
  eyeTilt: number;
  nose: { x: number; y: number };
  mouth: { x: number; y: number };
  cheekLeft: { x: number; y: number };
  cheekRight: { x: number; y: number };
  faceCenter: { x: number; y: number };
  headSize: number;
}

export interface SegmentedBustResult {
  bustCanvas: HTMLCanvasElement;
  features: FacialFeatures;
  headCenter: { x: number; y: number };
  headSize: number;
}

interface RawDetection {
  hasFace: boolean;
  box: { xCenter: number; yCenter: number; width: number; height: number };
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  nose: { x: number; y: number };
  mouth: { x: number; y: number };
}

async function runFaceDetection(canvas: HTMLCanvasElement): Promise<RawDetection | null> {
  try {
    const detector = await getFaceDetector();
    if (!detector) return null;

    const promise = new Promise<any>((resolve) => {
      detector.onResults((results: any) => {
        resolve(results.detections && results.detections.length > 0 ? results.detections[0] : null);
      });
    });

    await detector.send({ image: canvas });
    const detection = await promise;
    if (!detection) return null;

    const b = detection.boundingBox;
    const lm = detection.landmarks || [];
    const sw = canvas.width;
    const sh = canvas.height;

    // BlazeFace landmarks: 0: right eye (viewer left), 1: left eye (viewer right), 2: nose, 3: mouth
    let pt0 = lm[0] ? { x: lm[0].x * sw, y: lm[0].y * sh } : { x: (b.xCenter - b.width * 0.2) * sw, y: (b.yCenter - b.height * 0.1) * sh };
    let pt1 = lm[1] ? { x: lm[1].x * sw, y: lm[1].y * sh } : { x: (b.xCenter + b.width * 0.2) * sw, y: (b.yCenter - b.height * 0.1) * sh };

    const viewerLeftEye = pt0.x <= pt1.x ? pt0 : pt1;
    const viewerRightEye = pt0.x <= pt1.x ? pt1 : pt0;

    const nose = lm[2] ? { x: lm[2].x * sw, y: lm[2].y * sh } : { x: b.xCenter * sw, y: b.yCenter * sh };
    const mouth = lm[3] ? { x: lm[3].x * sw, y: lm[3].y * sh } : { x: b.xCenter * sw, y: (b.yCenter + b.height * 0.28) * sh };

    return {
      hasFace: true,
      box: { xCenter: b.xCenter, yCenter: b.yCenter, width: b.width, height: b.height },
      leftEye: viewerLeftEye,
      rightEye: viewerRightEye,
      nose,
      mouth,
    };
  } catch (err) {
    console.warn('Face detection error:', err);
    return null;
  }
}

/**
 * Runs client-side AI segmentation & face detection on a user photo and extracts
 * an authentic, chibi-style Koboyo character bust with aligned facial features.
 */
export async function segmentAndExtractMascotBust(
  imgElement: HTMLImageElement,
  targetSize: number = 330
): Promise<SegmentedBustResult> {
  const segmenter = await getSegmenter();

  const rawW = imgElement.naturalWidth || imgElement.width;
  const rawH = imgElement.naturalHeight || imgElement.height;

  // 1. Normalize image resolution to max 800px for optimal ML inference & zero memory bottlenecks
  const maxDim = 800;
  const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
  const sw = Math.round(rawW * scale);
  const sh = Math.round(rawH * scale);

  const normCanvas = document.createElement('canvas');
  normCanvas.width = sw;
  normCanvas.height = sh;
  const nCtx = normCanvas.getContext('2d');
  if (!nCtx) throw new Error('Could not get normalized canvas context');
  nCtx.drawImage(imgElement, 0, 0, sw, sh);

  // 2. Parallel ML pass: Run Selfie Segmentation AND Face Detection
  const [segmentationPromise, faceDetectionPromise] = [
    new Promise<{ image: CanvasImageSource; segmentationMask: CanvasImageSource }>((resolve) => {
      segmenter.onResults((results: any) => {
        resolve({
          image: results.image,
          segmentationMask: results.segmentationMask,
        });
      });
    }),
    runFaceDetection(normCanvas),
  ];

  await segmenter.send({ image: normCanvas });
  const [{ segmentationMask }, faceResult] = await Promise.all([
    segmentationPromise,
    faceDetectionPromise,
  ]);

  // 3. Render segmentation mask to an offscreen canvas
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sw;
  maskCanvas.height = sh;
  const mCtx = maskCanvas.getContext('2d');
  if (!mCtx) throw new Error('Could not get mask canvas context');

  mCtx.drawImage(segmentationMask, 0, 0, sw, sh);
  const maskData = mCtx.getImageData(0, 0, sw, sh);
  const mPixels = maskData.data;

  // 4. Calculate Chibi Bust Framing Bounds
  let cropX = 0;
  let cropY = 0;
  let cropSize = 0;

  let leftEyeCoord = { x: sw * 0.4, y: sh * 0.4 };
  let rightEyeCoord = { x: sw * 0.6, y: sh * 0.4 };
  let noseCoord = { x: sw * 0.5, y: sh * 0.48 };
  let mouthCoord = { x: sw * 0.5, y: sh * 0.56 };
  let detectedHeadH = sh * 0.4;

  if (faceResult && faceResult.hasFace) {
    // MediaPipe BlazeFace bounds
    const fb = faceResult.box;
    const facePxH = fb.height * sh;

    leftEyeCoord = faceResult.leftEye;
    rightEyeCoord = faceResult.rightEye;
    noseCoord = faceResult.nose;
    mouthCoord = faceResult.mouth;
    detectedHeadH = facePxH * 1.35;

    const eyeCenterX = (leftEyeCoord.x + rightEyeCoord.x) / 2;
    const eyeCenterY = (leftEyeCoord.y + rightEyeCoord.y) / 2;

    // Chibi scale: Head occupies ~55% of the frame, shoulders occupy bottom 25% (No arms/hands!)
    cropSize = Math.round(facePxH * 2.38);

    // Standardize eye line at precisely 44% height of the cell (matching Fox/Owl)
    cropX = Math.round(eyeCenterX - cropSize / 2);
    cropY = Math.round(eyeCenterY - cropSize * 0.44);
  } else {
    // Fallback: Silhouette bounds if no face detected
    let minX = sw, maxX = 0, minY = sh, maxY = 0;
    for (let y = 0; y < sh; y += 2) {
      for (let x = 0; x < sw; x += 2) {
        const idx = (y * sw + x) * 4;
        const conf = Math.max(mPixels[idx], mPixels[idx + 1], mPixels[idx + 2], mPixels[idx + 3]);
        if (conf > 70) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const detectedWidth = Math.max(80, maxX - minX);
    cropSize = Math.round(detectedWidth * 1.6);
    cropX = Math.round((minX + maxX) / 2 - cropSize / 2);
    cropY = Math.round(minY - cropSize * 0.08);

    leftEyeCoord = { x: cropX + cropSize * 0.42, y: cropY + cropSize * 0.44 };
    rightEyeCoord = { x: cropX + cropSize * 0.58, y: cropY + cropSize * 0.44 };
    noseCoord = { x: cropX + cropSize * 0.5, y: cropY + cropSize * 0.5 };
    mouthCoord = { x: cropX + cropSize * 0.5, y: cropY + cropSize * 0.58 };
    detectedHeadH = cropSize * 0.5;
  }

  // 5. Padded Offscreen Sampling: Handles edge offsets naturally without distorting the chibi center!
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = cropSize;
  sampleCanvas.height = cropSize;
  const sCtx = sampleCanvas.getContext('2d');
  if (!sCtx) throw new Error('Could not get sample canvas context');
  sCtx.drawImage(normCanvas, -cropX, -cropY);

  const sampleMask = document.createElement('canvas');
  sampleMask.width = cropSize;
  sampleMask.height = cropSize;
  const smCtx = sampleMask.getContext('2d');
  if (!smCtx) throw new Error('Could not get sample mask context');
  smCtx.drawImage(maskCanvas, -cropX, -cropY);

  // 6. Scale & Cutout onto Target Size (330x330)
  const cutoutCanvas = document.createElement('canvas');
  cutoutCanvas.width = targetSize;
  cutoutCanvas.height = targetSize;
  const cCtx = cutoutCanvas.getContext('2d');
  if (!cCtx) throw new Error('Could not get cutout canvas context');

  // Draw source image crop scaled to targetSize
  cCtx.drawImage(sampleCanvas, 0, 0, targetSize, targetSize);

  // Build clean alpha mask from segmentation
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = targetSize;
  alphaCanvas.height = targetSize;
  const aCtx = alphaCanvas.getContext('2d');
  if (!aCtx) throw new Error('Could not get alpha canvas context');

  aCtx.drawImage(sampleMask, 0, 0, targetSize, targetSize);
  const aImgData = aCtx.getImageData(0, 0, targetSize, targetSize);
  const aData = aImgData.data;

  for (let i = 0; i < aData.length; i += 4) {
    const conf = Math.max(aData[i], aData[i + 1], aData[i + 2], aData[i + 3]);
    let alpha = 0;
    if (conf > 120) {
      alpha = 255;
    } else if (conf > 35) {
      alpha = Math.round(((conf - 35) / 85) * 255);
    }
    aData[i] = 255;
    aData[i + 1] = 255;
    aData[i + 2] = 255;
    aData[i + 3] = alpha;
  }
  aCtx.putImageData(aImgData, 0, 0);

  // Apply alpha mask
  cCtx.globalCompositeOperation = 'destination-in';
  cCtx.drawImage(alphaCanvas, 0, 0);
  cCtx.globalCompositeOperation = 'source-over';

  // Apply Koboyo Soft Bottom Fadeout at Chest (bottom 18% of canvas)
  const fadeGrad = cCtx.createLinearGradient(0, 0, 0, targetSize);
  fadeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fadeGrad.addColorStop(0.82, 'rgba(0, 0, 0, 1)');
  fadeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  cCtx.globalCompositeOperation = 'destination-in';
  cCtx.fillStyle = fadeGrad;
  cCtx.fillRect(0, 0, targetSize, targetSize);
  cCtx.globalCompositeOperation = 'source-over';

  // 7. Generate Die-Cut White Vinyl Contour Outline & Ambient Shadow
  const silhouetteCanvas = document.createElement('canvas');
  silhouetteCanvas.width = targetSize;
  silhouetteCanvas.height = targetSize;
  const silCtx = silhouetteCanvas.getContext('2d');
  if (!silCtx) throw new Error('Could not get silhouette canvas context');

  const cutoutImgData = cCtx.getImageData(0, 0, targetSize, targetSize);
  const cData = cutoutImgData.data;

  const silData = silCtx.createImageData(targetSize, targetSize);
  const sd = silData.data;
  for (let i = 0; i < cData.length; i += 4) {
    if (cData[i + 3] > 35) {
      sd[i] = 255;
      sd[i + 1] = 255;
      sd[i + 2] = 255;
      sd[i + 3] = 255;
    }
  }
  silCtx.putImageData(silData, 0, 0);

  // 8. Compose Final Bust Canvas
  const bustCanvas = document.createElement('canvas');
  bustCanvas.width = targetSize;
  bustCanvas.height = targetSize;
  const bCtx = bustCanvas.getContext('2d');
  if (!bCtx) throw new Error('Could not get bust canvas context');

  // Step A: 3D Soft ambient drop shadow behind sticker
  bCtx.save();
  bCtx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  bCtx.shadowBlur = 12;
  bCtx.shadowOffsetY = 6;
  bCtx.drawImage(silhouetteCanvas, 0, 0);
  bCtx.restore();

  // Step B: Crisp white vinyl outline tracing the exact silhouette contour (NOT a square box!)
  const outlineRadius = 5;
  bCtx.save();
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    const ox = Math.cos(angle) * outlineRadius;
    const oy = Math.sin(angle) * outlineRadius;
    bCtx.drawImage(silhouetteCanvas, ox, oy);
  }
  bCtx.restore();

  // Step C: Cel-shaded character bust on top (vibrant anime tone-map)
  bCtx.save();
  bCtx.filter = 'contrast(114%) saturate(120%) brightness(102%)';
  bCtx.drawImage(cutoutCanvas, 0, 0);
  bCtx.filter = 'none';
  bCtx.restore();

  // 9. Map Precise Facial Landmarks onto Target Size Canvas
  const scaleToTarget = targetSize / cropSize;
  const cEyeLX = Math.round((leftEyeCoord.x - cropX) * scaleToTarget);
  const cEyeLY = Math.round((leftEyeCoord.y - cropY) * scaleToTarget);
  const cEyeRX = Math.round((rightEyeCoord.x - cropX) * scaleToTarget);
  const cEyeRY = Math.round((rightEyeCoord.y - cropY) * scaleToTarget);
  const cNoseX = Math.round((noseCoord.x - cropX) * scaleToTarget);
  const cNoseY = Math.round((noseCoord.y - cropY) * scaleToTarget);
  const cMouthX = Math.round((mouthCoord.x - cropX) * scaleToTarget);
  const cMouthY = Math.round((mouthCoord.y - cropY) * scaleToTarget);

  const eyeDist = Math.max(28, Math.hypot(cEyeRX - cEyeLX, cEyeRY - cEyeLY));
  const eyeTilt = Math.atan2(cEyeRY - cEyeLY, cEyeRX - cEyeLX);

  const cheekLX = Math.round(cEyeLX - eyeDist * 0.16);
  const cheekLY = Math.round(cEyeLY + eyeDist * 0.36);
  const cheekRX = Math.round(cEyeRX + eyeDist * 0.16);
  const cheekRY = Math.round(cEyeRY + eyeDist * 0.36);

  const faceCenterX = Math.round((cEyeLX + cEyeRX) / 2);
  const faceCenterY = Math.round((cEyeLY + cEyeRY) / 2);

  const features: FacialFeatures = {
    eyeLeft: { x: cEyeLX, y: cEyeLY },
    eyeRight: { x: cEyeRX, y: cEyeRY },
    eyeDistance: Math.round(eyeDist),
    eyeTilt,
    nose: { x: cNoseX, y: cNoseY },
    mouth: { x: cMouthX, y: cMouthY },
    cheekLeft: { x: cheekLX, y: cheekLY },
    cheekRight: { x: cheekRX, y: cheekRY },
    faceCenter: { x: faceCenterX, y: faceCenterY },
    headSize: Math.round(detectedHeadH * scaleToTarget),
  };

  return {
    bustCanvas,
    features,
    headCenter: {
      x: faceCenterX,
      y: faceCenterY,
    },
    headSize: features.headSize,
  };
}
