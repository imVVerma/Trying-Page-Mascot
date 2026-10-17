import React, { useEffect, useRef, useState, useCallback } from 'react';

export const DIRECTIONS = [
  'up-left',
  'up',
  'up-right',
  'left',
  'center',
  'right',
  'down-left',
  'down',
  'down-right',
] as const;

export const REACTIONS = [
  'blink',
  'heart',
  'sparkle',
  'surprised',
  'wink',
  'bashful',
  'sleepy',
  'dizzy',
  'delighted',
] as const;

export type Direction = (typeof DIRECTIONS)[number];
export type Reaction = (typeof REACTIONS)[number];
export type ArtStyle = 'colour' | 'ink' | 'sketch' | 'riso' | 'paper' | 'pixel';

// Clockwise from right for atan2 (y pointing down)
const CLOCKWISE: Direction[] = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
];

const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const HYSTERESIS = 0.12;
const DEAD_ZONE = 70;

const BOOP_PAYOFF = 130;
const BOOP_END = 620;
const SQUASH_MS = 420;
const DIZZY_AFTER = 4;
const DIZZY_WINDOW = 2400; // was 1600; giving users 2.4s to click 4 times comfortably
const DIZZY_END = 3200;    // was 1200; giving users 3.2s of dizzy expression

const SQUASH_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1, 1)', easing: 'ease-in' },
  { transform: 'scale(1.12, 0.85)', offset: 0.18, easing: 'ease-out' },
  { transform: 'scale(0.94, 1.09)', offset: 0.45, easing: 'ease-in-out' },
  { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
  { transform: 'scale(1, 1)' },
];

function cellPosition(index: number): React.CSSProperties {
  return {
    backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`,
  };
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function getStyleFilter(style: ArtStyle, url?: string): React.CSSProperties {
  // If the asset URL already contains `-${style}-` (e.g. fox-ink-directions.webp),
  // the art style is natively baked into the image, so skip the CSS filter.
  if (url && url.includes(`-${style}-`)) {
    return { filter: 'none' };
  }

  switch (style) {
    case 'ink':
      return {
        filter: 'grayscale(100%) contrast(280%) brightness(105%)',
      };
    case 'sketch':
      return {
        filter: 'grayscale(100%) contrast(150%) brightness(102%) drop-shadow(1px 1px 0px rgba(0,0,0,0.25))',
      };
    case 'riso':
      return {
        filter: 'sepia(100%) hue-rotate(295deg) saturate(320%) contrast(135%)',
      };
    case 'paper':
      return {
        filter: 'contrast(125%) saturate(115%) drop-shadow(2px 3px 2px rgba(0,0,0,0.4))',
      };
    case 'pixel':
      return {
        imageRendering: 'pixelated',
        filter: 'contrast(140%) saturate(130%)',
      };
    case 'colour':
    default:
      return {
        filter: 'none',
      };
  }
}

export interface EnhancedMascotProps {
  directions: string;
  reactions: string;
  size?: number;
  className?: string;
  label?: string;
  artStyle?: ArtStyle;
  controlledReaction?: Reaction | null;
  onBoop?: (count: number, isDizzy: boolean, activeReaction: Reaction | null) => void;
  onDirectionChange?: (dir: Direction, angleDeg: number, distance: number) => void;
  onReactionChange?: (reaction: Reaction | null) => void;
}

export function EnhancedMascot({
  directions,
  reactions,
  size = 140,
  className = '',
  label = 'mascot',
  artStyle = 'colour',
  controlledReaction = null,
  onBoop,
  onDirectionChange,
  onReactionChange,
}: EnhancedMascotProps) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const squashRef = useRef<HTMLSpanElement>(null);
  const timersRef = useRef<number[]>([]);
  const boopsRef = useRef({ count: 0, at: 0, cycleIdx: 0 });

  const [direction, setDirection] = useState<Direction>('center');
  const [internalReaction, setInternalReaction] = useState<Reaction | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [activeDirections, setActiveDirections] = useState(directions);
  const [activeReactions, setActiveReactions] = useState(reactions);

  useEffect(() => {
    setActiveDirections(directions);
  }, [directions]);

  useEffect(() => {
    setActiveReactions(reactions);
  }, [reactions]);

  // Preload & decode images to completely prevent flicker, with robust fallback on 404
  useEffect(() => {
    let cancelled = false;
    const preload = async () => {
      try {
        const dImg = new Image();
        dImg.crossOrigin = 'anonymous';
        dImg.src = directions;
        dImg.onerror = () => {
          // If a styled variant fails to load (e.g., bear-ink-directions.webp),
          // fallback to base colour sheet (e.g., bear-directions.webp)
          const fallback = directions.replace(/-(?:ink|sketch|riso|paper|pixel)-/, '-');
          if (fallback !== directions && !cancelled) {
            console.warn(`[EnhancedMascot] Falling back from ${directions} to ${fallback}`);
            setActiveDirections(fallback);
          }
        };

        const rImg = new Image();
        rImg.crossOrigin = 'anonymous';
        rImg.src = reactions;
        rImg.onerror = () => {
          const fallback = reactions.replace(/-(?:ink|sketch|riso|paper|pixel)-/, '-');
          if (fallback !== reactions && !cancelled) {
            console.warn(`[EnhancedMascot] Falling back from ${reactions} to ${fallback}`);
            setActiveReactions(fallback);
          }
        };

        await Promise.allSettled([
          dImg.decode ? dImg.decode() : Promise.resolve(),
          rImg.decode ? rImg.decode() : Promise.resolve(),
        ]);

        if (!cancelled) {
          setImagesLoaded(true);
        }
      } catch {
        if (!cancelled) setImagesLoaded(true);
      }
    };

    preload();
    return () => {
      cancelled = true;
    };
  }, [directions, reactions]);

  // Active reaction: controlled prop takes precedence, otherwise internal boop reaction
  const activeReaction = controlledReaction !== null ? controlledReaction : internalReaction;

  useEffect(() => {
    onReactionChange?.(activeReaction);
  }, [activeReaction, onReactionChange]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(window.clearTimeout);
    };
  }, []);

  // Aiming logic with 70px dead-zone and sector hysteresis
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    let sector = -1;
    let pointer: { x: number; y: number } | null = null;

    const aim = () => {
      const button = containerRef.current;
      if (!button || !pointer) return;

      const box = button.getBoundingClientRect();
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      const dx = pointer.x - centerX;
      const dy = pointer.y - centerY;
      const dist = Math.hypot(dx, dy);

      const rawAngle = Math.atan2(dy, dx);
      const angleDeg = Math.round(((rawAngle * 180) / Math.PI + 360) % 360);

      if (dist < DEAD_ZONE) {
        sector = -1;
        setDirection('center');
        onDirectionChange?.('center', angleDeg, dist);
        return;
      }

      if (sector !== -1 && Math.abs(wrapAngle(rawAngle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS) {
        onDirectionChange?.(CLOCKWISE[sector], angleDeg, dist);
        return;
      }

      sector = (Math.round(rawAngle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length;
      const newDir = CLOCKWISE[sector];
      setDirection(newDir);
      onDirectionChange?.(newDir, angleDeg, dist);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('scroll', aim, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', aim);
    };
  }, [onDirectionChange]);

  // Enhanced Boop Handler: cycles through ALL 9 expressions smoothly and supports Dizzy state
  const handleBoop = useCallback(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];

    const later = (ms: number, next: Reaction | null) => {
      timersRef.current.push(window.setTimeout(() => setInternalReaction(next), ms));
    };

    const now = Date.now();
    const boops = boopsRef.current;
    const isRapid = now - boops.at < DIZZY_WINDOW;
    boops.count = isRapid ? boops.count + 1 : 1;
    boops.at = now;

    const isDizzyTriggered = boops.count >= DIZZY_AFTER;

    if (isDizzyTriggered) {
      boops.count = 0;
      setInternalReaction('dizzy');
      later(DIZZY_END, null);
      onBoop?.(DIZZY_AFTER, true, 'dizzy');
    } else {
      // Cycle through all reaction expressions:
      // Index 0: blink, 1: heart, 2: sparkle, 3: surprised, 4: wink, 5: bashful, 6: sleepy, 7: dizzy, 8: delighted
      const nextReaction = REACTIONS[boops.cycleIdx % REACTIONS.length];
      boops.cycleIdx++;

      setInternalReaction('blink');
      later(BOOP_PAYOFF, nextReaction);
      later(BOOP_END, null);
      onBoop?.(boops.count, false, nextReaction);
    }

    // Squash & Stretch Animation
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      squashRef.current?.animate(SQUASH_KEYFRAMES, {
        duration: SQUASH_MS,
        easing: 'linear',
      });
    }
  }, [onBoop]);

  const styleFilter = getStyleFilter(artStyle, activeDirections);

  const layerBase: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundSize: '300% 300%',
    backgroundRepeat: 'no-repeat',
    transition: 'opacity 0.08s ease-in-out',
  };

  const dirIndex = DIRECTIONS.indexOf(direction);
  const reactIndex = REACTIONS.indexOf(activeReaction ?? 'blink');

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={handleBoop}
      aria-label={`Boop ${label}`}
      className={`enhanced-mascot-btn ${className}`}
      style={{
        position: 'relative',
        display: 'block',
        flexShrink: 0,
        width: size,
        height: size,
        padding: 0,
        border: 0,
        background: 'transparent',
        appearance: 'none',
        cursor: 'pointer',
        userSelect: 'none',
        outline: 'none',
        opacity: imagesLoaded ? 1 : 0.6,
        transition: 'opacity 0.2s ease',
        ...styleFilter,
      }}
    >
      <span
        ref={squashRef}
        className={activeReaction === 'dizzy' ? 'mascot-dizzy-wobble' : ''}
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          height: '100%',
          transformOrigin: '50% 78%',
        }}
      >
        {/* Directions Layer */}
        <span
          style={{
            ...layerBase,
            backgroundImage: `url("${activeDirections}")`,
            ...cellPosition(dirIndex >= 0 ? dirIndex : 4),
            opacity: activeReaction ? 0 : 1,
          }}
        />

        {/* Reactions Layer */}
        <span
          style={{
            ...layerBase,
            backgroundImage: `url("${activeReactions}")`,
            ...cellPosition(reactIndex >= 0 ? reactIndex : 0),
            opacity: activeReaction ? 1 : 0,
          }}
        />
      </span>
    </button>
  );
}
