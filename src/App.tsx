import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { EnhancedMascot } from './components/EnhancedMascot';
import { UploadPanel } from './components/UploadPanel';
import { StickerPack } from './components/StickerPack';
import { validateUserPhoto, type ValidationReport } from './utils/photoValidator';
import {
  sliceSpriteSheetsToStickers,
  downloadAllStickersZip,
  type StickerItem,
} from './utils/stickerSlicer';
import { buildMascotAssets } from './utils/proceduralSpriteGenerator';
import { generateMascot, photoForUpload } from './services/mascotService';
import { saveMascot, loadMostRecent, type StoredMascot } from './utils/mascotStorage';
import './App.css';

type CharacterId =
  | 'custom_uploaded'
  | 'restored'
  | 'fox'
  | 'bear'
  | 'redpanda'
  | 'owl'
  | 'astronaut'
  | 'gearbot'
  | 'cat'
  | 'wizard';

interface CharacterOption {
  id: CharacterId;
  name: string;
}

const PRESET_CHARACTERS: CharacterOption[] = [
  { id: 'fox', name: 'Fox' },
  { id: 'bear', name: 'Bear' },
  { id: 'redpanda', name: 'Red Panda' },
  { id: 'owl', name: 'Owl' },
  { id: 'cat', name: 'Cat' },
  { id: 'astronaut', name: 'Astronaut' },
  { id: 'gearbot', name: 'Gearbot' },
  { id: 'wizard', name: 'Wizard' },
];

export interface CustomMascot {
  directionsUrl: string;
  reactionsUrl: string;
  previewUrl: string;
  name: string;
}

/**
 * Scales the mascot with the viewport so it fills a phone screen without
 * dominating a desktop one. Recomputed on resize and on mobile URL-bar
 * collapse, where `innerHeight` changes without a resize event.
 */
function useFluidSize(min: number, max: number, vwRatio: number, vhRatio: number) {
  const [size, setSize] = useState(() =>
    Math.round(Math.min(max, Math.max(min, window.innerWidth * vwRatio)))
  );

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const byWidth = window.innerWidth * vwRatio;
        const byHeight = window.innerHeight * vhRatio;
        setSize(Math.round(Math.min(max, Math.max(min, Math.min(byWidth, byHeight)))));
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [min, max, vwRatio, vhRatio]);

  return size;
}

export default function App() {
  const [character, setCharacter] = useState<CharacterId>('fox');
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Upload & generation
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState('');
  const [customMascot, setCustomMascot] = useState<CustomMascot | null>(null);
  // Restored from IndexedDB on load so a generated mascot survives a refresh and
  // can be selected again after switching to a preset.
  const [restored, setRestored] = useState<StoredMascot | null>(null);

  // Stickers
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isSlicing, setIsSlicing] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const stageSize = useFluidSize(120, 220, 0.46, 0.32);
  const headerSize = stageSize < 160 ? 36 : 44;

  // Restore the last generated mascot so it is never lost by navigating away or
  // refreshing the page.
  useEffect(() => {
    let cancelled = false;
    loadMostRecent().then((saved) => {
      if (cancelled || !saved) return;
      setRestored(saved);
      setCustomMascot({
        directionsUrl: saved.directionsUrl,
        reactionsUrl: saved.reactionsUrl,
        previewUrl: saved.previewUrl,
        name: saved.name,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Which sprite sheets the stage should render.
  const { directionsUrl, reactionsUrl, activeName } = useMemo(() => {
    // `custom_uploaded` stays selected for the whole session once a mascot is
    // generated, but `restored` lets it be chosen again after switching away.
    if (customMascot && (character === 'custom_uploaded' || character === 'restored')) {
      return {
        directionsUrl: customMascot.directionsUrl,
        reactionsUrl: customMascot.reactionsUrl,
        activeName: customMascot.name,
      };
    }
    const preset = PRESET_CHARACTERS.find((c) => c.id === character);
    return {
      directionsUrl: `/mascots/${character}-directions.webp`,
      reactionsUrl: `/mascots/${character}-reactions.webp`,
      activeName: preset?.name ?? 'Mascot',
    };
  }, [character, customMascot]);

  // Small, self-contained sound effects.
  const playSound = useCallback(
    (type: 'boop' | 'success') => {
      if (!soundEnabled) return;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'boop') {
          osc.frequency.setValueAtTime(320, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.08);
          gain.gain.setValueAtTime(0.14, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.09);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        } else {
          osc.type = 'triangle';
          [440, 660, 880].forEach((freq, i) => {
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
          });
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.35);
          osc.start();
          osc.stop(ctx.currentTime + 0.38);
        }
      } catch {
        // AudioContext can be blocked before a user gesture.
      }
    },
    [soundEnabled]
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      setUploadedFile(file);
      setValidationReport(null);
      setGenerationError(null);
      setIsValidating(true);
      try {
        const report = await validateUserPhoto(file);
        setValidationReport(report);
      } catch (err) {
        console.error('Validation failed:', err);
      } finally {
        setIsValidating(false);
      }
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    if (!uploadedFile || !validationReport?.isValid) return;

    setIsGenerating(true);
    setGenerationError(null);

    try {
      setGenerationStatus('Drawing your mascot…');
      const photo = await photoForUpload(uploadedFile);

      // The model sometimes produces a sheet where characters overlap or fill
      // too much of a cell, which the validator rejects and falls back to the
      // procedural rig. Retry once with a fresh generation before giving up —
      // the prompt is non-deterministic, so a second roll often lands clean.
      const MAX_ATTEMPTS = 2;
      let built: Awaited<ReturnType<typeof buildMascotAssets>> | null = null;
      let fellBack = 0;
      let lastWarnings: string[] | undefined;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          setGenerationStatus('Retrying with a fresh layout…');
        }
        const assets = await generateMascot(photo);
        lastWarnings = assets.warnings;

        setGenerationStatus('Building your sticker pack…');
        const candidate = await buildMascotAssets({
          bust: assets.bust,
          directions: assets.directions,
          reactions: assets.reactions,
        });

        fellBack = Object.values(candidate.source).filter((s) => s === 'procedural').length;
        if (fellBack === 0) {
          built = candidate;
          break;
        }
        built = candidate; // keep last attempt's result
        if (attempt < MAX_ATTEMPTS - 1) {
          console.warn(`Attempt ${attempt + 1} fell back to procedural; retrying`);
        }
      }

      if (!built) throw new Error('Could not build mascot assets.');

      // Be honest when a sheet had to fall back to the procedural rig.
      if (fellBack > 0) {
        const upstreamHint = lastWarnings?.[0] ? ` (${lastWarnings[0]})` : '';
        setGenerationError(
          fellBack === 2
            ? 'The 3×3 angle and expression sheets could not be drawn, so the mascot only tilts ' +
              `slightly rather than turning.${upstreamHint} Try generating again.`
            : 'One of the two 3×3 sheets could not be drawn and was rebuilt locally, so it will ' +
              `be less consistent than the other.${upstreamHint}`
        );
      }

      const shortName = uploadedFile.name.replace(/\.[^/.]+$/, '').slice(0, 15);
      const name = shortName || 'Your mascot';
      setCustomMascot({
        directionsUrl: built.directionsUrl,
        reactionsUrl: built.reactionsUrl,
        previewUrl: built.previewUrl,
        name,
      });
      setCharacter('custom_uploaded');

      // Keep it locally so it survives a refresh or switching to a preset.
      const saved: StoredMascot = {
        id: `${Date.now()}`,
        name,
        createdAt: Date.now(),
        directionsUrl: built.directionsUrl,
        reactionsUrl: built.reactionsUrl,
        previewUrl: built.previewUrl,
        source: built.source,
      };
      await saveMascot(saved);
      setRestored(saved);

      playSound('success');
    } catch (err: any) {
      console.error('Mascot generation failed:', err);
      setGenerationError(
        err?.message ||
          'Could not generate your mascot. Please check your connection and try again.'
      );
    } finally {
      setIsGenerating(false);
      setGenerationStatus('');
    }
  }, [uploadedFile, validationReport, playSound]);

  // Re-slice whenever the active mascot changes.
  //
  // Slicing a generated mascot is slow (~4s) because its sheets are large base64
  // images rather than small preset files, and re-slicing on every switch back
  // and forth left the grid blank for seconds. Cache by source so switching
  // mascots repeatedly is instant after the first pass.
  const sliceCache = useRef(new Map<string, StickerItem[]>());

  useEffect(() => {
    if (!directionsUrl || !reactionsUrl) return;

    const key = `${directionsUrl}::${reactionsUrl}::${activeName}`;
    const cached = sliceCache.current.get(key);
    if (cached) {
      setStickers(cached);
      setIsSlicing(false);
      return;
    }

    let cancelled = false;
    setIsSlicing(true);
    sliceSpriteSheetsToStickers(directionsUrl, reactionsUrl, activeName)
      .then((result) => {
        if (cancelled) return;
        sliceCache.current.set(key, result);
        setStickers(result);
      })
      .catch((err) => console.error('Could not slice stickers:', err))
      .finally(() => {
        if (!cancelled) setIsSlicing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [directionsUrl, reactionsUrl, activeName]);

  const handleDownloadAll = useCallback(async () => {
    if (stickers.length === 0) return;
    setIsZipping(true);
    try {
      await downloadAllStickersZip(stickers, activeName);
      playSound('success');
    } catch (err) {
      console.error('Could not build the ZIP:', err);
    } finally {
      setIsZipping(false);
    }
  }, [stickers, activeName, playSound]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <EnhancedMascot
            directions={directionsUrl}
            reactions={reactionsUrl}
            size={headerSize}
            className="brand-mascot"
            label={activeName}
          />
          <div className="brand-text">
            <h1>Page Mascot</h1>
            <p>Turn a photo into a cursor-tracking mascot</p>
          </div>
        </div>

        <button
          type="button"
          className="icon-button"
          onClick={() => setSoundEnabled((v) => !v)}
          aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
          title={soundEnabled ? 'Mute' : 'Unmute'}
        >
          {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </header>

      <main className="app-main">
        {/* 1. The mascot itself — the thing worth looking at. */}
        <section className="card stage-card">
          <div className="stage">
            <EnhancedMascot
              directions={directionsUrl}
              reactions={reactionsUrl}
              size={stageSize}
              className="stage-mascot"
              label={activeName}
              onBoop={() => playSound('boop')}
            />
          </div>
          <p className="stage-caption">
            <strong>{activeName}</strong> is watching your cursor. Tap it for a reaction.
          </p>

          <div className="preset-row" role="group" aria-label="Mascots">
            <span className="preset-label">
              {customMascot ? 'Switch mascot' : 'Or try one of these'}
            </span>
            <div className="preset-scroll">
              {/* The generated mascot must stay reachable after switching away. */}
              {customMascot && (
                <button
                  type="button"
                  className={`preset-chip custom ${character !== 'restored' ? 'active' : ''}`}
                  onClick={() => setCharacter('restored')}
                  aria-pressed={character !== 'restored'}
                >
                  <img className="preset-thumb custom-thumb" src={customMascot.previewUrl} alt="" />
                  <span>{customMascot.name}</span>
                  <span className="custom-badge">Yours</span>
                </button>
              )}

              {PRESET_CHARACTERS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset-chip ${character === preset.id ? 'active' : ''}`}
                  onClick={() => setCharacter(preset.id)}
                  aria-pressed={character === preset.id}
                >
                  <span
                    className="preset-thumb"
                    style={{ backgroundImage: `url(/mascots/${preset.id}-directions.webp)` }}
                  />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 2. Make your own. */}
        <section className="card">
          <div className="card-heading">
            <Upload size={18} />
            <h2>Make your own mascot</h2>
          </div>

          <UploadPanel
            fileInputRef={fileInputRef}
            report={validationReport}
            isValidating={isValidating}
            isGenerating={isGenerating}
            statusText={generationStatus}
            error={generationError}
            onFileSelect={handleFileSelect}
            onGenerate={handleGenerate}
          />

          {customMascot && (
            <div className="mascot-ready">
              <img src={customMascot.previewUrl} alt="Your generated mascot" />
              <div className="mascot-ready-text">
                <strong>{customMascot.name} is ready</strong>
                <p>
                  Your 18 stickers are below.
                  {restored && <span className="saved-note"> Saved on this device.</span>}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* 3. The payoff. */}
        <section className="card">
          <div className="card-heading">
            <Sparkles size={18} />
            <h2>Your 18 stickers</h2>
          </div>

          <StickerPack
            stickers={stickers}
            isLoading={isSlicing}
            isZipping={isZipping}
            onDownloadAll={handleDownloadAll}
          />
        </section>
      </main>
    </div>
  );
}
