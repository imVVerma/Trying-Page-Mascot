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
  Layers,
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
} from 'lucide-react';
import {
  EnhancedMascot,
  type ArtStyle,
  type Direction,
  type Reaction,
} from './components/EnhancedMascot';
import { validateUserPhoto, type ValidationReport } from './utils/photoValidator';
import {
  sliceSpriteSheetsToStickers,
  downloadSingleSticker,
  downloadAllStickersZip,
  type StickerItem,
} from './utils/stickerSlicer';
import { generateSpriteSheetsFromPhoto } from './utils/proceduralSpriteGenerator';
import './App.css';

type CharacterId =
  | 'custom_uploaded'
  | 'fox'
  | 'redpanda'
  | 'owl'
  | 'astronaut'
  | 'gearbot'
  | 'cat'
  | 'wizard';

type ActiveTab = 'characters' | 'upload' | 'styles' | 'stickers' | 'props' | 'inspector';

interface CharacterOption {
  id: CharacterId;
  name: string;
  role: string;
  isCustom?: boolean;
  avatarThumb?: string;
}

const PRESET_CHARACTERS: CharacterOption[] = [
  { id: 'fox', name: 'Fox', role: 'Default Watcher' },
  { id: 'redpanda', name: 'Red Panda', role: 'Bamboo Debugger' },
  { id: 'owl', name: 'Owl', role: 'Night Owl Reviewer' },
  { id: 'astronaut', name: 'Astronaut', role: 'Space Explorer' },
  { id: 'gearbot', name: 'Gearbot', role: 'CI/CD Automator' },
  { id: 'cat', name: 'Cat', role: 'Keyboard Stepper' },
  { id: 'wizard', name: 'Wizard', role: 'Regex Sorcerer' },
];

const STYLES: { id: ArtStyle; label: string; desc: string }[] = [
  { id: 'colour', label: 'Colour', desc: 'Default vibrant full colour' },
  { id: 'ink', label: 'Ink', desc: 'High-contrast graphic black line art' },
  { id: 'sketch', label: 'Sketch', desc: 'Pencil shading & hatch texture' },
  { id: 'riso', label: 'Riso', desc: 'Two-tone duotone print aesthetic' },
  { id: 'paper', label: 'Paper', desc: 'Cut-paper craft layered depth' },
  { id: 'pixel', label: 'Pixel', desc: '32px retro pixel sprite effect' },
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

export default function App() {
  // Navigation & Core Selection
  const [activeTab, setActiveTab] = useState<ActiveTab>('characters');
  const [character, setCharacter] = useState<CharacterId>('fox');
  const [style, setStyle] = useState<ArtStyle>('colour');
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
  // BULLETPROOF ASSET RESOLUTION:
  // For 'fox', load official artist-drawn style sheets locally from /mascots/fox-${style}-*.webp
  // For custom uploads and Koboyo CDN characters, load base sheets + GPU shader filters
  let directionsUrl = '';
  let reactionsUrl = '';
  let activeMascotName = 'Mascot';
  let isFoxNativeStyle = false;

  if (character === 'custom_uploaded' && uploadedCustomSheets) {
    directionsUrl = uploadedCustomSheets.directionsUrl;
    reactionsUrl = uploadedCustomSheets.reactionsUrl;
    activeMascotName = uploadedCustomSheets.name || 'Custom Avatar';
  } else if (character === 'fox') {
    activeMascotName = 'Fox';
    if (style === 'colour') {
      directionsUrl = '/mascots/fox-directions.webp';
      reactionsUrl = '/mascots/fox-reactions.webp';
    } else {
      directionsUrl = `/mascots/fox-${style}-directions.webp`;
      reactionsUrl = `/mascots/fox-${style}-reactions.webp`;
      isFoxNativeStyle = true;
    }
  } else {
    // Koboyo CDN characters: redpanda, owl, astronaut, gearbot, cat, wizard
    const baseUrl = 'https://koboyo.com/page-mascot/mascots';
    directionsUrl = `${baseUrl}/${character}-directions.webp`;
    reactionsUrl = `${baseUrl}/${character}-reactions.webp`;
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

  // Generate 3x3 Sprite Sheets from Validated Photo
  const handleGenerateMascotFromPhoto = async () => {
    if (!validationReport || !uploadedFile) return;
    setIsGeneratingMascot(true);

    try {
      const img = new Image();
      img.src = validationReport.previewUrl;
      await new Promise((res) => {
        img.onload = res;
      });

      const sheets = await generateSpriteSheetsFromPhoto(img);
      const name = uploadedFile.name.replace(/\.[^/.]+$/, '').slice(0, 15);

      setUploadedCustomSheets({
        directionsUrl: sheets.directionsUrl,
        reactionsUrl: sheets.reactionsUrl,
        previewUrl: validationReport.previewUrl,
        name: `Custom (${name})`,
      });

      setCharacter('custom_uploaded');
      playSound('success');
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6366f1', '#06b6d4', '#ec4899', '#f59e0b'],
      });
    } catch (err) {
      console.error('Sprite generation failed:', err);
    } finally {
      setIsGeneratingMascot(false);
    }
  };

  // Slice Current Sprite Sheets into 18 Stickers
  const handleSliceStickers = useCallback(async () => {
    if (!directionsUrl || !reactionsUrl) return;
    setIsSlicingStickers(true);
    try {
      const sliced = await sliceSpriteSheetsToStickers(
        directionsUrl,
        reactionsUrl,
        activeMascotName,
        style
      );
      setStickers(sliced);
    } catch (err) {
      console.error('Failed to slice stickers:', err);
    } finally {
      setIsSlicingStickers(false);
    }
  }, [directionsUrl, reactionsUrl, activeMascotName, style]);

  // Automatically refresh sticker pack when switching into stickers tab or changing character / style
  useEffect(() => {
    if (activeTab === 'stickers') {
      handleSliceStickers();
    }
  }, [activeTab, character, style, handleSliceStickers]);

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

  // Mascot Boop Callback
  const handleMascotBoop = (count: number, isDizzyState: boolean, activeReaction: Reaction | null) => {
    setPokeCount((c) => c + 1);
    setCombo(count);
    setIsDizzy(isDizzyState);

    if (isDizzyState) {
      playSound('dizzy');
      confetti({
        particleCount: 50,
        spread: 65,
        origin: { y: 0.65 },
        colors: ['#ec4899', '#f59e0b', '#6366f1'],
      });
    } else if (activeReaction === 'sparkle' || activeReaction === 'heart') {
      playSound('sparkle');
    } else {
      playSound('poke');
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
        size={${size}}
        label="${activeMascotName} mascot in ${style} style"
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
              artStyle={style}
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
                  key={`${directionsUrl}-${reactionsUrl}-${size}-${style}`}
                  directions={directionsUrl}
                  reactions={reactionsUrl}
                  size={size}
                  artStyle={isFoxNativeStyle ? 'colour' : style}
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
                      } else {
                        setControlledReaction(r.id);
                        if (r.id === 'dizzy') {
                          setIsDizzy(true);
                          playSound('dizzy');
                        } else {
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

            {/* Stage Action Toolbar */}
            <div className="stage-toolbar">
              <div className="action-btn-group">
                <button
                  className="action-btn primary"
                  onClick={() => {
                    const btn = document.querySelector('.enhanced-mascot-btn') as HTMLButtonElement;
                    btn?.click();
                  }}
                >
                  <Sparkles size={14} />
                  <span>Poke / Boop</span>
                </button>
                <button
                  className="action-btn"
                  onClick={() => {
                    const btn = document.querySelector('.enhanced-mascot-btn') as HTMLButtonElement;
                    for (let i = 0; i < 4; i++) {
                      setTimeout(() => btn?.click(), i * 110);
                    }
                  }}
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
              className={`tab-btn ${activeTab === 'styles' ? 'active' : ''}`}
              onClick={() => setActiveTab('styles')}
            >
              <Layers size={15} />
              <span>Styles</span>
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
                    onClick={() => setCharacter(char.id)}
                  >
                    <span className="char-name">{char.name}</span>
                    <span className="char-role">{char.role}</span>
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

                  {/* Generate Button */}
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem' }}>
                    <button
                      className="action-btn primary"
                      disabled={!validationReport.isValid || isGeneratingMascot}
                      onClick={handleGenerateMascotFromPhoto}
                      style={{ flex: 1, justifyContent: 'center', padding: '0.65rem' }}
                    >
                      {isGeneratingMascot ? (
                        <>
                          <Sparkles size={16} className="animate-spin" />
                          <span>Generating 3×3 Sprite Sheets...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={16} />
                          <span>Generate My 3×3 Mascot (Client-Side)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ART STYLES */}
          {activeTab === 'styles' && (
            <div className="tab-content-card">
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                  Visual Art Styles (6 Shaders)
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Transform your active mascot ({activeMascotName}) into 6 distinctive art styles without missing assets or 404 errors.
                </p>
              </div>

              <div className="style-grid">
                {STYLES.map((s) => {
                  const isHandDrawn = character === 'fox';
                  const previewSrc = isHandDrawn
                    ? `/mascots/fox-${s.id === 'colour' ? '' : `${s.id}-`}directions.webp`
                    : directionsUrl;
                  const previewFilter =
                    !isHandDrawn && s.id !== 'colour'
                      ? s.id === 'ink'
                        ? 'grayscale(100%) contrast(280%) brightness(105%)'
                        : s.id === 'sketch'
                        ? 'grayscale(100%) contrast(150%) brightness(102%)'
                        : s.id === 'riso'
                        ? 'sepia(100%) hue-rotate(295deg) saturate(320%) contrast(135%)'
                        : s.id === 'paper'
                        ? 'contrast(125%) saturate(115%)'
                        : s.id === 'pixel'
                        ? 'contrast(140%) saturate(130%)'
                        : 'none'
                      : 'none';

                  return (
                    <div
                      key={s.id}
                      className={`style-card ${style === s.id ? 'active' : ''}`}
                      onClick={() => {
                        setStyle(s.id);
                        playSound('poke');
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="style-card-header">
                        <div className="style-preview-box">
                          <div
                            className="style-preview-sprite"
                            style={{
                              backgroundImage: `url(${previewSrc})`,
                              filter: previewFilter,
                              ...(s.id === 'pixel' ? { imageRendering: 'pixelated' } : {}),
                            }}
                          />
                        </div>
                        <div className="style-card-titles">
                          <div className="style-label-row">
                            <span className="style-label">{s.label}</span>
                            <span className={`style-badge ${isHandDrawn ? 'hand-drawn' : 'gpu-shader'}`}>
                              {isHandDrawn ? 'Hand-Drawn' : 'GPU Shader'}
                            </span>
                          </div>
                          <p className="style-desc">{s.desc}</p>
                          {style === s.id && (
                            <span className="style-active-pill">
                              <CheckCircle2 size={13} color="#818cf8" />
                              Active Style
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="style-info-banner">
                💡 <strong>Universal Art Architecture:</strong> Fox includes artist-drawn native sprite sheets for all 6 styles (ink, sketch, risograph, papercraft, and retro pixel). Custom user photos and other characters utilize GPU-accelerated CSS and SVG filter shaders to guarantee instant rendering with zero network lag or missing frames.
              </div>
            </div>
          )}

          {/* TAB 4: 18-STICKER SLICER & EXPORTER */}
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
    size={${size}}
    label="${activeMascotName} mascot in ${style} style"
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
