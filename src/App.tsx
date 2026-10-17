import { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  MousePointer,
  RotateCcw,
  Volume2,
  VolumeX,
  Eye,
  User,
  Sliders,
  ExternalLink,
  Copy,
  Check,
  Zap,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  Package,
  FileCheck,
  Wand2,
  Key,
  Cpu,
} from 'lucide-react';
import {
  EnhancedMascot,
  getStyleFilter,
  type Direction,
  type Reaction,
  type ArtStyle,
} from './components/EnhancedMascot';
import { validateUserPhoto, type ValidationReport } from './utils/photoValidator';
import {
  sliceSpriteSheetsToStickers,
  downloadSingleSticker,
  downloadAllStickersZip,
  type StickerItem,
} from './utils/stickerSlicer';
import { generateSpriteSheetsFromPhoto } from './utils/proceduralSpriteGenerator';
import {
  generateVectorMascotFromPhoto,
  getHfToken,
  saveHfToken,
} from './services/vectorMascotService';
import {
  generateMascotFromAI,
  getAiCreditsApiKey,
  saveAiCreditsApiKey,
} from './services/aiCreditsService';
import './App.css';

type CharacterId =
  | 'custom_uploaded'
  | 'fox'
  | 'bear'
  | 'redpanda'
  | 'owl'
  | 'astronaut'
  | 'gearbot'
  | 'cat'
  | 'wizard';

type ActiveTab = 'characters' | 'upload' | 'stickers' | 'props' | 'inspector';

interface CharacterOption {
  id: CharacterId;
  name: string;
  role: string;
  isCustom?: boolean;
  avatarThumb?: string;
}

const PRESET_CHARACTERS: CharacterOption[] = [
  { id: 'fox', name: 'Fox', role: 'Default Watcher' },
  { id: 'bear', name: 'Bear', role: 'Forest Sleeper' },
  { id: 'redpanda', name: 'Red Panda', role: 'Bamboo Debugger' },
  { id: 'owl', name: 'Owl', role: 'Night Owl Reviewer' },
  { id: 'astronaut', name: 'Astronaut', role: 'Space Explorer' },
  { id: 'gearbot', name: 'Gearbot', role: 'CI/CD Automator' },
  { id: 'cat', name: 'Cat', role: 'Keyboard Stepper' },
  { id: 'wizard', name: 'Wizard', role: 'Regex Sorcerer' },
];

const DIRECTION_LABELS = [
  'Top-Left',
  'Top',
  'Top-Right',
  'Left',
  'Center (Dead-zone)',
  'Right',
  'Bottom-Left',
  'Bottom',
  'Bottom-Right',
];

const REACTION_METAS: { id: Reaction; label: string; emoji: string }[] = [
  { id: 'blink', label: 'Blink', emoji: '😌' },
  { id: 'heart', label: 'Heart', emoji: '😍' },
  { id: 'sparkle', label: 'Sparkle', emoji: '✨' },
  { id: 'surprised', label: 'Surprised', emoji: '😮' },
  { id: 'wink', label: 'Wink', emoji: '😉' },
  { id: 'bashful', label: 'Bashful', emoji: '😊' },
  { id: 'sleepy', label: 'Sleepy', emoji: '💤' },
  { id: 'dizzy', label: 'Dizzy', emoji: '😵' },
  { id: 'delighted', label: 'Delighted', emoji: '😁' },
];

export const ART_STYLES: { id: ArtStyle; label: string; desc: string; icon: string }[] = [
  { id: 'colour', label: 'Full Colour', desc: 'Default vibrant cel-shaded palette', icon: '🎨' },
  { id: 'ink', label: 'Ink', desc: 'High-contrast graphic novel manga ink', icon: '✒️' },
  { id: 'sketch', label: 'Sketch', desc: 'Textured graphite pencil sketch', icon: '✏️' },
  { id: 'riso', label: 'Risograph', desc: 'Duotone magenta & electric purple', icon: '🖨️' },
  { id: 'paper', label: 'Papercraft', desc: 'Cutout paper with shadow depth', icon: '📄' },
  { id: 'pixel', label: 'Pixel Art', desc: 'Retro 8-bit crisp pixelated shader', icon: '👾' },
];

export default function App() {
  // Navigation & Core Selection
  const [activeTab, setActiveTab] = useState<ActiveTab>('characters');
  const [character, setCharacter] = useState<CharacterId>('fox');
  const [artStyle, setArtStyle] = useState<ArtStyle>('colour');
  const [size, setSize] = useState<number>(160);
  const [perchMode, setPerchMode] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Controlled Reaction (manual selection in Inspector or Reaction Bar)
  const [controlledReaction, setControlledReaction] = useState<Reaction | null>(null);

  // Telemetry & Stats
  const [pokeCount, setPokeCount] = useState<number>(0);
  const [combo, setCombo] = useState<number>(0);
  const [isDizzy, setIsDizzy] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [pointerInfo, setPointerInfo] = useState<{ angle: number; distance: number; sector: string }>({
    angle: 0,
    distance: 0,
    sector: 'Center',
  });

  // Custom User Photo Upload & Validation Pipeline
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isGeneratingMascot, setIsGeneratingMascot] = useState<boolean>(false);
  const [uploadedCustomSheets, setUploadedCustomSheets] = useState<{
    directionsUrl: string;
    reactionsUrl: string;
    previewUrl: string;
    name: string;
  } | null>(null);

  // Generation Pipeline Mode & AI Services State
  const [generationMode, setGenerationMode] = useState<'aicredits_flux' | 'flux_vector' | 'client_chibi'>('aicredits_flux');

  // AICredits FLUX Schnell State
  const [customAiCreditsKey, setCustomAiCreditsKey] = useState<string>(() => getAiCreditsApiKey());
  const [savedAiCreditsKeyMsg, setSavedAiCreditsKeyMsg] = useState<boolean>(false);
  const [aiCreditsPrompt, setAiCreditsPrompt] = useState<string>(
    'Convert this portrait into a clean 2D chibi vector illustration style, bold black outlines, flat pastel coloring, minimalist anime eyes, isolated on a pure white background.'
  );

  // Hugging Face FLUX.1-Kontext-dev & Vector Clipart Generation State
  const [customHfToken, setCustomHfToken] = useState<string>(() => getHfToken());
  const [savedTokenMsg, setSavedTokenMsg] = useState<boolean>(false);
  const [hfPrompt, setHfPrompt] = useState<string>(
    'Convert this person into a clean 2D chibi vector illustration style, bold black outlines, flat pastel coloring, minimalist anime eyes, isolated on a pure white background, 3x3 grid style reference.'
  );
  const [generationStatusText, setGenerationStatusText] = useState<string>('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  // 18-Sticker Slicer State
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isSlicingStickers, setIsSlicingStickers] = useState<boolean>(false);
  const [stickerFilter, setStickerFilter] = useState<'all' | 'reaction' | 'direction'>('all');
  const [isZipping, setIsZipping] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synthesize sound effects
  const playSound = useCallback(
    (type: 'poke' | 'dizzy' | 'sparkle' | 'success') => {
      if (!soundEnabled) return;
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'poke') {
          osc.frequency.setValueAtTime(320, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.08);
          gain.gain.setValueAtTime(0.14, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.09);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        } else if (type === 'dizzy') {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(260, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(130, ctx.currentTime + 0.28);
          gain.gain.setValueAtTime(0.18, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          osc.start();
          osc.stop(ctx.currentTime + 0.3);
        } else if (type === 'sparkle') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.14);
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.16);
          osc.start();
          osc.stop(ctx.currentTime + 0.18);
        } else if (type === 'success') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(440, ctx.currentTime);
          osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.35);
          osc.start();
          osc.stop(ctx.currentTime + 0.38);
        }
      } catch {
        // AudioContext blocked before gesture
      }
    },
    [soundEnabled]
  );

  // Compute Active Mascot Sprite Sheet URLs
  // All character sprite sheets are hosted locally in /mascots/ with 0 latency and 0 CORS issues!
  let directionsUrl = '';
  let reactionsUrl = '';
  let activeMascotName = 'Mascot';

  if (character === 'custom_uploaded' && uploadedCustomSheets) {
    directionsUrl = uploadedCustomSheets.directionsUrl;
    reactionsUrl = uploadedCustomSheets.reactionsUrl;
    activeMascotName = uploadedCustomSheets.name || 'Custom Avatar';
  } else {
    // Only 'fox' has native pre-rendered art style files on disk (e.g. /mascots/fox-ink-directions.webp)
    if (character === 'fox' && artStyle !== 'colour') {
      directionsUrl = `/mascots/fox-${artStyle}-directions.webp`;
      reactionsUrl = `/mascots/fox-${artStyle}-reactions.webp`;
    } else {
      // All other characters (and custom avatar) load base colour sheets,
      // and styles like 'ink', 'sketch', 'riso', 'paper', 'pixel' are rendered via CSS/canvas shaders!
      directionsUrl = `/mascots/${character}-directions.webp`;
      reactionsUrl = `/mascots/${character}-reactions.webp`;
    }
    const found = PRESET_CHARACTERS.find((c) => c.id === character);
    activeMascotName = found ? found.name : character;
  }

  // Handle Photo File Upload
  const handlePhotoSelect = async (file: File) => {
    setUploadedFile(file);
    setIsValidating(true);
    try {
      const report = await validateUserPhoto(file);
      setValidationReport(report);
      if (report.isValid) {
        playSound('success');
      }
    } catch (err) {
      console.error('Validation error:', err);
    } finally {
      setIsValidating(false);
    }
  };

  // Generate 3x3 Sprite Sheets from Validated Photo (FLUX.1-Kontext-dev or Client-Side Chibi Rig)
  const handleGenerateMascotFromPhoto = async () => {
    if (!validationReport || !uploadedFile) return;
    setIsGeneratingMascot(true);
    setGenerationError(null);

    try {
      let sourceImg: HTMLImageElement;
      let mascotPreviewUrl = validationReport.previewUrl;

      if (generationMode === 'aicredits_flux') {
        setGenerationStatusText('Calling AICredits FLUX Schnell (api.aicredits.in)...');

        // Call black-forest-labs/flux-1-schnell via AICredits OpenAI-compatible API
        const hostedImageUrl = await generateMascotFromAI(aiCreditsPrompt, customAiCreditsKey);
        mascotPreviewUrl = hostedImageUrl;

        const img = new Image();
        if (!hostedImageUrl.startsWith('data:')) {
          img.crossOrigin = 'anonymous';
        }
        img.src = hostedImageUrl;
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error('Failed to load generated mascot image. Please check your network connection.'));
        });
        sourceImg = img;
      } else if (generationMode === 'flux_vector') {
        setGenerationStatusText('Calling Hugging Face FLUX.1-Kontext-dev (fal-ai provider)...');

        // Call black-forest-labs/FLUX.1-Kontext-dev via fal-ai
        const vectorBlob = await generateVectorMascotFromPhoto(uploadedFile, {
          prompt: hfPrompt,
          customToken: customHfToken,
        });

        mascotPreviewUrl = URL.createObjectURL(vectorBlob);
        const img = new Image();
        img.src = mascotPreviewUrl;
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error('Failed to load generated vector image'));
        });
        sourceImg = img;
      } else {
        setGenerationStatusText('Processing via client-side MediaPipe chibi rig...');
        const img = new Image();
        img.src = validationReport.previewUrl;
        await new Promise((res) => {
          img.onload = res;
        });
        sourceImg = img;
      }

      setGenerationStatusText('Generating 3×3 Direction & Reaction Sprite Sheets...');
      const sheets = await generateSpriteSheetsFromPhoto(sourceImg);
      const name = uploadedFile.name.replace(/\.[^/.]+$/, '').slice(0, 15);

      const prefix =
        generationMode === 'aicredits_flux'
          ? 'FLUX AI'
          : generationMode === 'flux_vector'
          ? 'Vector'
          : 'Chibi';

      setUploadedCustomSheets({
        directionsUrl: sheets.directionsUrl,
        reactionsUrl: sheets.reactionsUrl,
        previewUrl: mascotPreviewUrl,
        name: `${prefix} (${name})`,
      });

      setCharacter('custom_uploaded');
      setSize(220); // Scale up custom mascot so it's bold, full-size and NOT a pinhole!
      setActiveTab('stickers');
      playSound('success');
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6366f1', '#06b6d4', '#ec4899', '#f59e0b'],
      });
    } catch (err: any) {
      console.error('Sprite generation failed:', err);
      setGenerationError(err.message || 'Generation failed');
    } finally {
      setIsGeneratingMascot(false);
      setGenerationStatusText('');
    }
  };

  // Slice Current Sprite Sheets into 18 Stickers with active art style
  const handleSliceStickers = useCallback(async () => {
    if (!directionsUrl || !reactionsUrl) return;
    setIsSlicingStickers(true);
    try {
      const sliced = await sliceSpriteSheetsToStickers(
        directionsUrl,
        reactionsUrl,
        activeMascotName,
        artStyle
      );
      setStickers(sliced);
    } catch (err) {
      console.error('Failed to slice stickers:', err);
    } finally {
      setIsSlicingStickers(false);
    }
  }, [directionsUrl, reactionsUrl, activeMascotName, artStyle]);

  // Automatically refresh sticker pack when switching into stickers tab, changing character, or changing art style
  useEffect(() => {
    if (activeTab === 'stickers') {
      handleSliceStickers();
    }
  }, [activeTab, character, artStyle, handleSliceStickers]);

  // Download All Stickers as .ZIP
  const handleDownloadAllZip = async () => {
    if (stickers.length === 0) return;
    setIsZipping(true);
    try {
      await downloadAllStickersZip(stickers, activeMascotName);
      playSound('success');
    } catch (err) {
      console.error('Failed to create ZIP pack:', err);
    } finally {
      setIsZipping(false);
    }
  };

  // Dedicated Dizzy Trigger: works 100% reliably
  const triggerDizzy = () => {
    setControlledReaction('dizzy');
    setIsDizzy(true);
    setCombo((c) => Math.max(c, 4));
    setPokeCount((c) => c + 4);
    playSound('dizzy');
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.65 },
      colors: ['#ec4899', '#f59e0b', '#6366f1', '#06b6d4'],
    });

    window.clearTimeout((window as any).__dizzyTimer);
    (window as any).__dizzyTimer = window.setTimeout(() => {
      setControlledReaction(null);
      setIsDizzy(false);
      setCombo(0);
    }, 4500);
  };

  // Mascot Boop Callback
  const handleMascotBoop = (count: number, isDizzyState: boolean, activeReaction: Reaction | null) => {
    setPokeCount((c) => c + 1);
    setCombo(count);

    if (isDizzyState) {
      setIsDizzy(true);
      playSound('dizzy');
      confetti({
        particleCount: 50,
        spread: 65,
        origin: { y: 0.65 },
        colors: ['#ec4899', '#f59e0b', '#6366f1'],
      });
      window.clearTimeout((window as any).__dizzyTimer);
      (window as any).__dizzyTimer = window.setTimeout(() => {
        setIsDizzy(false);
        setCombo(0);
      }, 2200);
    } else {
      setIsDizzy(false);
      if (activeReaction === 'sparkle' || activeReaction === 'heart') {
        playSound('sparkle');
      } else {
        playSound('poke');
      }
    }

    // Clear any controlled reaction override so cycling is visible
    setControlledReaction(null);
  };

  // Telemetry updates from Mascot
  const handleDirectionChange = (dir: Direction, angleDeg: number, distance: number) => {
    setPointerInfo({
      angle: angleDeg,
      distance: Math.round(distance),
      sector: dir,
    });
  };

  const handleCopyCode = () => {
    const snippet = `import { Mascot } from 'page-mascot';

export default function MyMascot() {
  return (
    <div style={{${perchMode ? ` marginBottom: '-${Math.round(size * 0.24)}px',` : ''} lineHeight: 0 }}>
      <Mascot
        directions="${directionsUrl}"
        reactions="${reactionsUrl}"
        size={${size}}${artStyle !== 'colour' ? `\n        artStyle="${artStyle}"` : ''}
        label="${activeMascotName} mascot"
      />
    </div>
  );
}`;
    navigator.clipboard.writeText(snippet);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const filteredStickers = stickers.filter((s) => {
    if (stickerFilter === 'all') return true;
    return s.type === stickerFilter;
  });

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-section">
          <div
            className="header-mascot-perch"
            style={{ marginBottom: `-${Math.round(48 * 0.24)}px` }}
          >
            <EnhancedMascot
              directions={directionsUrl}
              reactions={reactionsUrl}
              size={48}
              artStyle={artStyle}
              className="header-mascot-btn"
              label="Mini perched avatar"
            />
          </div>
          <div className="brand-info">
            <h1>
              Page Mascot Studio <span className="pill-badge"><Sparkles size={12} /> v0.2.0</span>
            </h1>
            <p>Interactive 3×3 cursor-tracker, custom photo validator & 18-sticker slicer</p>
          </div>
        </div>

        <div className="header-actions">
          <button
            className={`source-toggle-btn ${soundEnabled ? 'active' : ''}`}
            onClick={() => setSoundEnabled((v) => !v)}
            title="Toggle Sound Effects"
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{soundEnabled ? 'Sound On' : 'Muted'}</span>
          </button>

          <button
            className="source-toggle-btn active"
            onClick={() => setActiveTab('upload')}
          >
            <Upload size={14} />
            <span>Upload Photo</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="main-workspace">
        {/* Left Column: Interactive Mascot Stage */}
        <section className="stage-panel">
          <div className="stage-card">
            <div className="stage-header">
              <div className="stage-title">
                <MousePointer size={18} color="#06b6d4" />
                <span>Interactive Stage</span>
                <span className="char-badge-tag" style={{ marginLeft: '0.4rem' }}>
                  {activeMascotName}
                </span>
                {artStyle !== 'colour' && (
                  <span className="char-badge-tag" style={{ marginLeft: '0.3rem', background: 'rgba(236,72,153,0.18)', borderColor: 'rgba(236,72,153,0.4)', color: '#f472b6' }}>
                    {artStyle.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="stage-status-pills">
                <span className="status-pill">Angle: {pointerInfo.angle}°</span>
                <span
                  className={`status-pill ${pointerInfo.distance <= 70 ? 'highlight' : ''}`}
                >
                  {pointerInfo.distance <= 70 ? 'Center Dead-zone' : pointerInfo.sector}
                </span>
              </div>
            </div>

            {/* Mascot Interactive Stage Box */}
            <div
              className="mascot-stage-box"
              id="mascot-interactive-stage"
            >
              {/* 70px Dead-zone Overlay */}
              <div className="stage-crosshair-overlay">
                <div className="stage-crosshair-circle" />
                <span className="stage-deadzone-label">70px Center Dead-zone</span>
              </div>

              {/* Combo & Dizzy Badges */}
              <div className="click-combo-burst">
                {combo > 1 && (
                  <div className="combo-badge">
                    {combo}x Combo! 🔥
                  </div>
                )}
                {isDizzy && (
                  <div className="dizzy-warning">
                    Dizzy State! @_@
                  </div>
                )}
              </div>

              {/* The Enhanced Mascot Engine */}
              <div
                className="mascot-center-wrapper"
                style={
                  perchMode
                    ? { marginBottom: `-${Math.round(size * 0.24)}px` }
                    : undefined
                }
              >
                <EnhancedMascot
                  key={`${directionsUrl}-${reactionsUrl}-${size}-${artStyle}`}
                  directions={directionsUrl}
                  reactions={reactionsUrl}
                  size={size}
                  artStyle={artStyle}
                  className="stage-mascot-btn"
                  label={activeMascotName}
                  controlledReaction={controlledReaction}
                  onBoop={handleMascotBoop}
                  onDirectionChange={handleDirectionChange}
                />
              </div>
            </div>

            {/* Quick 9-Reaction Selector Bar */}
            <div className="reaction-selector-row">
              <span className="reaction-row-label">Reaction Test:</span>
              <div className="reaction-pills-scroll">
                {REACTION_METAS.map((r) => (
                  <button
                    key={r.id}
                    className={`reaction-pill-btn ${controlledReaction === r.id ? 'active' : ''}`}
                    onClick={() => {
                      if (controlledReaction === r.id) {
                        setControlledReaction(null);
                        setIsDizzy(false);
                      } else {
                        setControlledReaction(r.id);
                        if (r.id === 'dizzy') {
                          setIsDizzy(true);
                          setCombo(4);
                          playSound('dizzy');
                          confetti({
                            particleCount: 50,
                            spread: 65,
                            origin: { y: 0.65 },
                            colors: ['#ec4899', '#f59e0b', '#6366f1'],
                          });
                        } else {
                          setIsDizzy(false);
                          playSound('sparkle');
                        }
                      }
                    }}
                    title={`Preview expression: ${r.label}`}
                  >
                    <span>{r.emoji}</span>
                    <span>{r.label}</span>
                  </button>
                ))}
                {controlledReaction && (
                  <button
                    className="reaction-pill-btn clear-btn"
                    onClick={() => setControlledReaction(null)}
                    title="Resume live cursor tracking"
                  >
                    ✕ Reset
                  </button>
                )}
              </div>
            </div>

            {/* Quick Art Style Selector Bar */}
            <div className="reaction-selector-row" style={{ marginTop: '0.45rem' }}>
              <span className="reaction-row-label">Art Style:</span>
              <div className="reaction-pills-scroll">
                {ART_STYLES.map((style) => (
                  <button
                    key={style.id}
                    className={`reaction-pill-btn ${artStyle === style.id ? 'active' : ''}`}
                    onClick={() => {
                      setArtStyle(style.id);
                      playSound('sparkle');
                    }}
                    title={style.desc}
                  >
                    <span>{style.icon}</span>
                    <span>{style.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Stage Action Toolbar */}
            <div className="stage-toolbar">
              <div className="action-btn-group">
                <button
                  className="action-btn primary"
                  onClick={() => {
                    const btn = document.querySelector('.stage-mascot-btn') as HTMLButtonElement;
                    btn?.click();
                  }}
                >
                  <Sparkles size={14} />
                  <span>Poke / Boop</span>
                </button>
                <button
                  className="action-btn"
                  onClick={triggerDizzy}
                  title="Trigger rapid poke Dizzy reaction"
                >
                  <Zap size={14} />
                  <span>Trigger 4x Dizzy</span>
                </button>
                <button
                  className="action-btn"
                  onClick={() => {
                    setPokeCount(0);
                    setCombo(0);
                    setIsDizzy(false);
                    setControlledReaction(null);
                  }}
                  title="Reset counter"
                >
                  <RotateCcw size={14} />
                  <span>Reset</span>
                </button>
              </div>

              <div className="status-pill">
                Total Pokes: <strong>{pokeCount}</strong>
              </div>
            </div>
          </div>

          {/* Sliced Stickers Teaser Banner */}
          <div className="photo-compare-card" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('stickers')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Package size={18} color="#06b6d4" />
                <div>
                  <strong style={{ fontSize: '0.95rem', color: '#f8fafc' }}>
                    18-Sticker WhatsApp & Telegram Pack
                  </strong>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    All 9 head angles + 9 reaction expressions ready to download in 512×512 WebP
                  </p>
                </div>
              </div>
              <button className="action-btn primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}>
                Open Sticker Studio ➔
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Studio Tools & Controls */}
        <section className="controls-panel">
          {/* Navigation Tabs */}
          <nav className="tabs-nav">
            <button
              className={`tab-btn ${activeTab === 'characters' ? 'active' : ''}`}
              onClick={() => setActiveTab('characters')}
            >
              <User size={15} />
              <span>Characters</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <Upload size={15} />
              <span>Photo Lab</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'stickers' ? 'active' : ''}`}
              onClick={() => setActiveTab('stickers')}
            >
              <Package size={15} />
              <span>18 Stickers</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'props' ? 'active' : ''}`}
              onClick={() => setActiveTab('props')}
            >
              <Sliders size={15} />
              <span>Props</span>
            </button>
            <button
              className={`tab-btn ${activeTab === 'inspector' ? 'active' : ''}`}
              onClick={() => setActiveTab('inspector')}
            >
              <Eye size={15} />
              <span>Inspector</span>
            </button>
          </nav>

          {/* TAB 1: CHARACTERS */}
          {activeTab === 'characters' && (
            <div className="tab-content-card">
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                  Select Active Mascot
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Switch seamlessly between your custom uploaded avatar and official Koboyo characters.
                </p>
              </div>

              <div className="character-grid">
                {/* Custom Uploaded Avatar (if exists) */}
                {uploadedCustomSheets && (
                  <button
                    className={`char-card custom-featured ${character === 'custom_uploaded' ? 'active' : ''}`}
                    onClick={() => setCharacter('custom_uploaded')}
                  >
                    <img
                      src={uploadedCustomSheets.previewUrl}
                      alt={uploadedCustomSheets.name}
                      className="custom-avatar-thumb"
                    />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="char-name">{uploadedCustomSheets.name}</span>
                        <span className="char-badge-tag">Your Custom Avatar</span>
                      </div>
                      <span className="char-role">Client-side 3×3 Rig</span>
                    </div>
                    <Sparkles size={20} color="#06b6d4" />
                  </button>
                )}

                {/* Preset Characters */}
                {PRESET_CHARACTERS.map((char) => (
                  <button
                    key={char.id}
                    className={`char-card ${character === char.id ? 'active' : ''}`}
                    onClick={() => {
                      setCharacter(char.id);
                      playSound('poke');
                    }}
                  >
                    <div className="char-card-header">
                      <div
                        className="char-preview-thumb"
                        style={{
                          backgroundImage: `url(/mascots/${char.id}-directions.webp)`,
                        }}
                      />
                      <div className="char-card-info">
                        <span className="char-name">{char.name}</span>
                        <span className="char-role">{char.role}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--bg-card-border)', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Want to use your own photo instead?
                </span>
                <button
                  className="action-btn primary"
                  onClick={() => setActiveTab('upload')}
                  style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem' }}
                >
                  <Upload size={13} />
                  <span>Launch Photo Lab</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: PHOTO LAB & VALIDATION PIPELINE */}
          {activeTab === 'upload' && (
            <div className="tab-content-card">
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                  Custom Photo Upload & Validation Pipeline
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Upload a photo to run client-side validation (framing, lighting, sharpness) and generate your own 3×3 sprite sheets.
                </p>
              </div>

              {/* Upload Drop Zone */}
              <div
                className="upload-dropzone"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePhotoSelect(file);
                  }}
                />
                <Upload size={32} color="#818cf8" className={isValidating ? 'animate-bounce' : ''} />
                <div style={{ textAlign: 'center' }}>
                  <strong style={{ fontSize: '0.95rem', color: '#f8fafc' }}>
                    {isValidating
                      ? 'Analyzing photo metrics (framing, lighting, sharpness)...'
                      : 'Click to browse or drop your portrait photo here'}
                  </strong>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {isValidating
                      ? 'Checking 256×256px resolution, Laplacian sharpness & luminance'
                      : 'Supports PNG, JPG, or WebP (solo portrait, well-lit, front-facing)'}
                  </p>
                </div>
              </div>

              {/* Quick Demo Sample Button */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '-0.35rem' }}>
                <button
                  type="button"
                  className="action-btn"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const res = await fetch('/test_sample.jpg');
                      const blob = await res.blob();
                      const file = new File([blob], 'sample_engineer.jpg', { type: 'image/jpeg' });
                      handlePhotoSelect(file);
                    } catch (err) {
                      console.error('Failed to load demo portrait:', err);
                    }
                  }}
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}
                >
                  <Sparkles size={13} color="#06b6d4" />
                  <span>Try Demo Portrait (One-Click Test)</span>
                </button>
              </div>

              {/* Photo Lab Tips */}
              <div className="photo-tips-row">
                <div className="photo-tip-badge">📸 Solo Portrait</div>
                <div className="photo-tip-badge">💡 Neutral Lighting</div>
                <div className="photo-tip-badge">🎯 Front-Facing Angle</div>
                <div className="photo-tip-badge">✂️ Auto Die-Cut Contour</div>
              </div>

              {/* Validation Report Scorecard */}
              {validationReport && (
                <div className="validation-report-card">
                  <div className="validation-report-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <FileCheck size={18} color="#06b6d4" />
                      <strong style={{ fontSize: '0.9rem' }}>Photo Validation Scorecard</strong>
                    </div>
                    <span
                      className={`validation-score-badge ${
                        validationReport.isValid ? 'passed' : 'failed'
                      }`}
                    >
                      {validationReport.score}% Match {validationReport.isValid ? '✓ Ready' : '⚠ Review'}
                    </span>
                  </div>

                  <div className="validation-checks-list">
                    {validationReport.checks.map((check) => (
                      <div key={check.id} className="validation-check-item">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {check.passed ? (
                            <CheckCircle2 size={16} color="#10b981" />
                          ) : (
                            <AlertTriangle size={16} color="#f59e0b" />
                          )}
                          <span className="check-name">{check.name}</span>
                        </div>
                        <span className="check-msg">{check.message}</span>
                      </div>
                    ))}
                  </div>

                  {/* Generation Mode Selector */}
                  <div style={{ marginTop: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f1f5f9' }}>
                        Generation Pipeline:
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Select how your photo is converted
                      </span>
                    </div>

                    <div className="generation-mode-row">
                      <button
                        type="button"
                        className={`mode-select-btn ${generationMode === 'aicredits_flux' ? 'active' : ''}`}
                        onClick={() => {
                          setGenerationMode('aicredits_flux');
                          setGenerationError(null);
                        }}
                      >
                        <div className="mode-title">
                          <Zap size={15} color="#eab308" />
                          <span>AICredits FLUX Schnell</span>
                        </div>
                        <span className="mode-desc">
                          black-forest-labs/flux-1-schnell via AICredits (~₹0.20/img). Ultra-fast high-res 2D mascot.
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`mode-select-btn ${generationMode === 'flux_vector' ? 'active' : ''}`}
                        onClick={() => {
                          setGenerationMode('flux_vector');
                          setGenerationError(null);
                        }}
                      >
                        <div className="mode-title">
                          <Wand2 size={15} color="#ec4899" />
                          <span>FLUX.1-Kontext-dev</span>
                        </div>
                        <span className="mode-desc">
                          Hugging Face Inference (fal-ai). Image-guided style transformation.
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`mode-select-btn ${generationMode === 'client_chibi' ? 'active' : ''}`}
                        onClick={() => {
                          setGenerationMode('client_chibi');
                          setGenerationError(null);
                        }}
                      >
                        <div className="mode-title">
                          <Cpu size={15} color="#06b6d4" />
                          <span>Fast Client-Side Rig</span>
                        </div>
                        <span className="mode-desc">
                          100% local MediaPipe WASM segmentation. Zero latency, no API key needed.
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* AICredits Configuration Box (When aicredits_flux mode selected) */}
                  {generationMode === 'aicredits_flux' && (
                    <div className="hf-config-card" style={{ borderColor: 'rgba(234, 179, 8, 0.35)' }}>
                      <div className="hf-config-header">
                        <div className="hf-config-title">
                          <Key size={15} color="#eab308" />
                          <span>AICredits API Integration (OpenAI Compatible)</span>
                        </div>
                        <span
                          className={`hf-badge ${
                            customAiCreditsKey.trim() ? 'connected' : 'needed'
                          }`}
                        >
                          {customAiCreditsKey.trim() ? '✓ Key Connected' : '⚠ API Key Required'}
                        </span>
                      </div>

                      <div className="hf-token-input-row">
                        <input
                          type="password"
                          className="hf-token-input"
                          placeholder="Paste your AICredits API Key (sk-...)"
                          value={customAiCreditsKey}
                          onChange={(e) => {
                            setCustomAiCreditsKey(e.target.value);
                            setSavedAiCreditsKeyMsg(false);
                            setGenerationError(null);
                          }}
                        />
                        <button
                          type="button"
                          className="action-btn primary"
                          style={{ fontSize: '0.75rem', padding: '0.45rem 0.85rem' }}
                          onClick={() => {
                            saveAiCreditsApiKey(customAiCreditsKey);
                            setSavedAiCreditsKeyMsg(true);
                            setTimeout(() => setSavedAiCreditsKeyMsg(false), 2500);
                          }}
                        >
                          {savedAiCreditsKeyMsg ? 'Saved! ✓' : 'Save Key'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        <span>
                          Endpoint: <code>https://api.aicredits.in/v1</code> • Model: <code>black-forest-labs/flux-1-schnell</code>
                        </span>
                        <a
                          href="https://aicredits.in"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <span>Get AICredits Key</span>
                          <ExternalLink size={11} />
                        </a>
                      </div>

                      {/* Prompt Customization */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Mascot Generation Prompt:</span>
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '0.7rem', cursor: 'pointer', padding: 0 }}
                            onClick={() =>
                              setAiCreditsPrompt(
                                'Convert this portrait into a clean 2D chibi vector illustration style, bold black outlines, flat pastel coloring, minimalist anime eyes, isolated on a pure white background.'
                              )
                            }
                          >
                            Reset Prompt
                          </button>
                        </div>
                        <textarea
                          className="hf-prompt-input"
                          value={aiCreditsPrompt}
                          onChange={(e) => setAiCreditsPrompt(e.target.value)}
                          rows={2}
                        />
                      </div>
                    </div>
                  )}

                  {/* Hugging Face Configuration Box (Only when FLUX.1 mode selected) */}
                  {generationMode === 'flux_vector' && (
                    <div className="hf-config-card">
                      <div className="hf-config-header">
                        <div className="hf-config-title">
                          <Key size={15} color="#f59e0b" />
                          <span>Hugging Face Inference Providers Setup</span>
                        </div>
                        <span
                          className={`hf-badge ${
                            customHfToken.trim() ? 'connected' : 'needed'
                          }`}
                        >
                          {customHfToken.trim() ? '✓ Token Connected' : '⚠ API Token Required'}
                        </span>
                      </div>

                      <div className="hf-token-input-row">
                        <input
                          type="password"
                          className="hf-token-input"
                          placeholder="Paste your Hugging Face Access Token (hf_...)"
                          value={customHfToken}
                          onChange={(e) => {
                            setCustomHfToken(e.target.value);
                            setSavedTokenMsg(false);
                            setGenerationError(null);
                          }}
                        />
                        <button
                          type="button"
                          className="action-btn primary"
                          style={{ fontSize: '0.75rem', padding: '0.45rem 0.85rem' }}
                          onClick={() => {
                            saveHfToken(customHfToken);
                            setSavedTokenMsg(true);
                            setTimeout(() => setSavedTokenMsg(false), 2500);
                          }}
                        >
                          {savedTokenMsg ? 'Saved! ✓' : 'Save Token'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        <span>
                          Model: <code>black-forest-labs/FLUX.1-Kontext-dev</code> via <code>fal-ai</code>
                        </span>
                        <a
                          href="https://huggingface.co/settings/tokens"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <span>Get Free HF Token</span>
                          <ExternalLink size={11} />
                        </a>
                      </div>

                      {/* Prompt Customization */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Vector Style Prompt:</span>
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '0.7rem', cursor: 'pointer', padding: 0 }}
                            onClick={() =>
                              setHfPrompt(
                                'Convert this person into a clean 2D chibi vector illustration style, bold black outlines, flat pastel coloring, minimalist anime eyes, isolated on a pure white background, 3x3 grid style reference.'
                              )
                            }
                          >
                            Reset Prompt
                          </button>
                        </div>
                        <textarea
                          className="hf-prompt-input"
                          value={hfPrompt}
                          onChange={(e) => setHfPrompt(e.target.value)}
                          rows={2}
                        />
                      </div>
                    </div>
                  )}

                  {/* Active Generation Progress Status */}
                  {isGeneratingMascot && generationStatusText && (
                    <div className="generation-status-box">
                      <Sparkles size={18} color="#ec4899" className="animate-spin" />
                      <span>{generationStatusText}</span>
                    </div>
                  )}

                  {/* Generation Error Banner with Fallback Option */}
                  {generationError && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.75rem',
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <AlertTriangle size={16} color="#f87171" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span style={{ fontSize: '0.78rem', color: '#fca5a5' }}>
                          {generationError}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="action-btn"
                          style={{ fontSize: '0.74rem', padding: '0.35rem 0.75rem' }}
                          onClick={() => {
                            setGenerationMode('client_chibi');
                            setGenerationError(null);
                          }}
                        >
                          <Cpu size={13} color="#06b6d4" />
                          <span>Switch to Fast Client-Side Rig (Zero Key Required)</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Generate Button */}
                  <div style={{ marginTop: '0.85rem', display: 'flex', gap: '0.75rem' }}>
                    <button
                      className="action-btn primary"
                      disabled={!validationReport.isValid || isGeneratingMascot}
                      onClick={handleGenerateMascotFromPhoto}
                      style={{ flex: 1, justifyContent: 'center', padding: '0.75rem', fontSize: '0.85rem' }}
                    >
                      {isGeneratingMascot ? (
                        <>
                          <Sparkles size={16} className="animate-spin" />
                          <span>Generating Mascot &amp; 18 Stickers...</span>
                        </>
                      ) : generationMode === 'aicredits_flux' ? (
                        <>
                          <Zap size={16} color="#facc15" />
                          <span>Generate with AICredits FLUX Schnell (~₹0.20)</span>
                        </>
                      ) : generationMode === 'flux_vector' ? (
                        <>
                          <Wand2 size={16} />
                          <span>Generate 2D Vector Clipart (FLUX.1-Kontext-dev)</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={16} />
                          <span>Generate My 3×3 Chibi Rig &amp; 18-Sticker Pack</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Generated Custom Mascot Ready Banner */}
                  {uploadedCustomSheets && (
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(6, 182, 212, 0.12)', border: '1px solid rgba(6, 182, 212, 0.35)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <img src={uploadedCustomSheets.previewUrl} alt="Preview" style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #06b6d4' }} />
                        <div>
                          <strong style={{ fontSize: '0.88rem', color: '#67e8f9' }}>{uploadedCustomSheets.name} Ready!</strong>
                          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Die-cut maskout &amp; 18 stickers are sliced and ready.</p>
                        </div>
                      </div>
                      <button className="action-btn primary" onClick={() => setActiveTab('stickers')} style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem' }}>
                        <Package size={14} />
                        <span>Open 18 Stickers Pack ➔</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: 18-STICKER SLICER & EXPORTER */}
          {activeTab === 'stickers' && (
            <div className="tab-content-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                    18-Sticker WhatsApp & Chat Pack
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Export individual 512×512 transparent WebP stickers or download the entire bundled pack (.zip).
                  </p>
                </div>

                <button
                  className="action-btn primary"
                  disabled={isZipping || stickers.length === 0}
                  onClick={handleDownloadAllZip}
                >
                  <Download size={14} />
                  <span>{isZipping ? 'Bundling ZIP...' : 'Download All 18 (.ZIP)'}</span>
                </button>
              </div>

              {/* Filter Pills */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className={`source-toggle-btn ${stickerFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setStickerFilter('all')}
                >
                  All (18)
                </button>
                <button
                  className={`source-toggle-btn ${stickerFilter === 'reaction' ? 'active' : ''}`}
                  onClick={() => setStickerFilter('reaction')}
                >
                  Reactions (9)
                </button>
                <button
                  className={`source-toggle-btn ${stickerFilter === 'direction' ? 'active' : ''}`}
                  onClick={() => setStickerFilter('direction')}
                >
                  Head Angles (9)
                </button>
              </div>

              {/* Sliced Stickers Grid */}
              {isSlicingStickers ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Sparkles size={24} className="animate-spin" />
                  <p style={{ marginTop: '0.5rem' }}>Slicing 3×3 sprite atlases into 512×512 high-res stickers...</p>
                </div>
              ) : (
                <div className="stickers-gallery-grid">
                  {filteredStickers.map((sticker) => (
                    <div key={sticker.id} className="sticker-item-card">
                      <div className="sticker-preview-box">
                        <img
                          src={sticker.dataUrl}
                          alt={sticker.label}
                          className="sticker-thumb-img"
                        />
                      </div>
                      <div className="sticker-meta-row">
                        <div style={{ overflow: 'hidden' }}>
                          <div className="sticker-title">{sticker.label}</div>
                          <div className="sticker-sub">{sticker.expressionOrAngle}</div>
                        </div>
                        <button
                          className="download-single-btn"
                          onClick={() => downloadSingleSticker(sticker)}
                          title="Download 512x512 WebP Sticker"
                        >
                          <Download size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: PROPS & CODE */}
          {activeTab === 'props' && (
            <div className="tab-content-card">
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                  Component Props & Code Generator
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Tune dimensions and layout options for seamless integration into headers, cards, or hero banners.
                </p>
              </div>

              {/* Size Slider */}
              <div className="control-row">
                <div className="control-label-row">
                  <span>Size (Width & Height)</span>
                  <span className="control-val">{size}px</span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={280}
                  step={10}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
              </div>

              {/* Quick Size Presets */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[100, 140, 180, 220].map((s) => (
                  <button
                    key={s}
                    className={`action-btn ${size === s ? 'primary' : ''}`}
                    onClick={() => setSize(s)}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    {s}px
                  </button>
                ))}
              </div>

              {/* Art Style Selector */}
              <div className="control-row">
                <div className="control-label-row">
                  <span>Art Style Shader</span>
                  <span className="control-val">{artStyle.toUpperCase()}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem', marginTop: '0.3rem' }}>
                  {ART_STYLES.map((s) => (
                    <button
                      key={s.id}
                      className={`action-btn ${artStyle === s.id ? 'primary' : ''}`}
                      onClick={() => setArtStyle(s.id)}
                      style={{ fontSize: '0.75rem', padding: '0.4rem 0.5rem', justifyContent: 'center' }}
                      title={s.desc}
                    >
                      <span>{s.icon}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Perch Mode Toggle */}
              <div className="toggle-perch-box">
                <div className="toggle-perch-info">
                  <h4>Negative Margin Perch Mode</h4>
                  <p>
                    Apply <code>marginBottom: -{Math.round(size * 0.24)}px</code> so mascot perches flush on borders without clipping bounce animation.
                  </p>
                </div>
                <button
                  className={`source-toggle-btn ${perchMode ? 'active' : ''}`}
                  onClick={() => setPerchMode((v) => !v)}
                >
                  {perchMode ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              {/* Generated Code Snippet */}
              <div className="code-generator-box">
                <div className="code-header">
                  <span className="code-lang-tag">React / TypeScript</span>
                  <button className="copy-snippet-btn" onClick={handleCopyCode}>
                    {copiedCode ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>
                </div>
                <pre className="code-pre">
{`import { Mascot } from 'page-mascot';

<div style={{${perchMode ? ` marginBottom: '-${Math.round(size * 0.24)}px',` : ''} lineHeight: 0 }}>
  <Mascot
    directions="${directionsUrl}"
    reactions="${reactionsUrl}"
    size={${size}}${artStyle !== 'colour' ? `\n    artStyle="${artStyle}"` : ''}
    label="${activeMascotName} mascot"
  />
</div>`}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 6: 3x3 INSPECTOR */}
          {activeTab === 'inspector' && (
            <div className="tab-content-card">
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                  Raw 3×3 Sprite Atlas Inspector
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Click or hover any cell to immediately preview that exact angle or expression on the stage!
                </p>
              </div>

              <div className="inspector-container">
                {/* Directions Sheet */}
                <div className="sheet-card">
                  <span className="sheet-card-title">1. Directions Sheet (9 Angles)</span>
                  <p className="sheet-card-sub">
                    Row 1: Up-Left, Up, Up-Right<br />
                    Row 2: Left, Center, Right<br />
                    Row 3: Down-Left, Down, Down-Right
                  </p>
                  <div className="sheet-preview-frame">
                    <img
                      src={directionsUrl}
                      alt="Directions sprite grid"
                      className="sheet-preview-img"
                      style={getStyleFilter(artStyle, directionsUrl)}
                    />
                    <div className="grid-overlay-3x3">
                      {DIRECTION_LABELS.map((label, idx) => (
                        <div
                          key={label}
                          className="grid-cell-hover"
                          title={`Angle ${idx + 1}: ${label}`}
                        >
                          <span className="cell-index-badge">{idx + 1}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Reactions Sheet */}
                <div className="sheet-card">
                  <span className="sheet-card-title">2. Reactions Sheet (9 Expressions)</span>
                  <p className="sheet-card-sub">
                    Row 1: Blink, Heart, Sparkle<br />
                    Row 2: Surprised, Wink, Bashful<br />
                    Row 3: Sleepy, Dizzy, Delighted
                  </p>
                  <div className="sheet-preview-frame">
                    <img
                      src={reactionsUrl}
                      alt="Reactions sprite grid"
                      className="sheet-preview-img"
                      style={getStyleFilter(artStyle, reactionsUrl)}
                    />
                    <div className="grid-overlay-3x3">
                      {REACTION_METAS.map((meta, idx) => (
                        <div
                          key={meta.id}
                          className="grid-cell-hover"
                          onClick={() => {
                            setControlledReaction(meta.id);
                            if (meta.id === 'dizzy') {
                              setIsDizzy(true);
                              playSound('dizzy');
                            } else {
                              playSound('sparkle');
                            }
                          }}
                          title={`Click to preview: ${meta.label} (${idx + 1})`}
                        >
                          <span className="cell-index-badge">{idx + 1} {meta.emoji}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <span>Powered by <code>page-mascot</code> &amp; Antigravity Studio</span>
        <span>•</span>
        <a
          href="https://github.com/nilbuild/page-mascot"
          target="_blank"
          rel="noreferrer"
          className="footer-link"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
        >
          <span>GitHub</span>
          <ExternalLink size={12} />
        </a>
        <span>•</span>
        <a
          href="https://koboyo.com/page-mascot"
          target="_blank"
          rel="noreferrer"
          className="footer-link"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
        >
          <span>Official Gallery (52 Characters)</span>
          <ExternalLink size={12} />
        </a>
      </footer>
    </div>
  );
}
