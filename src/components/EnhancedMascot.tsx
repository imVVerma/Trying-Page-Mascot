import React, { useCallback, useEffect, useRef, useState } from 'react';

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

/** Clockwise from right, matching atan2 with y pointing down. */
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

/** Dead-zone scales with the mascot so the feel is the same at any size. */
const DEAD_ZONE_RATIO = 0.42;
const MIN_DEAD_ZONE = 48;

const REACTION_DWELL_MS = 900;
const SQUASH_MS = 420;

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

export interface EnhancedMascotProps {
  directions: string;
  reactions: string;
  size?: number;
  className?: string;
  label?: string;
  /** Fired when the mascot is tapped. Omit to render a static, non-interactive mascot. */
  onBoop?: () => void;
}

export function EnhancedMascot({
  directions,
  reactions,
  size = 140,
  className = '',
  label = 'mascot',
  onBoop,
}: EnhancedMascotProps) {
  const containerRef = useRef<HTMLElement>(null);
  const squashRef = useRef<HTMLSpanElement>(null);
  const timersRef = useRef<number[]>([]);
  const cycleRef = useRef(0);

  // Keep mutable inputs in refs so the pointer listener is attached exactly once
  // instead of being torn down and re-added on every render.
  const sizeRef = useRef(size);
  const onBoopRef = useRef(onBoop);
  useEffect(() => {
    sizeRef.current = size;
    onBoopRef.current = onBoop;
  });

  const [direction, setDirection] = useState<Direction>('center');
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [ready, setReady] = useState(false);
  const [activeDirections, setActiveDirections] = useState(directions);
  const [activeReactions, setActiveReactions] = useState(reactions);

  useEffect(() => setActiveDirections(directions), [directions]);
  useEffect(() => setActiveReactions(reactions), [reactions]);

  // Preload so the mascot never flashes while swapping sprites.
  useEffect(() => {
    let cancelled = false;
    setReady(false);

    const load = (src: string, onError: () => void) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onerror = onError;
        img.onload = () => resolve();
        img.src = src;
        if (img.decode) img.decode().then(resolve, () => resolve());
      });

    Promise.allSettled([
      load(directions, () => {
        // Styled variants are optional; fall back to the base sheet.
        const fallback = directions.replace(/-(?:ink|sketch|riso|paper|pixel)-/, '-');
        if (fallback !== directions && !cancelled) setActiveDirections(fallback);
      }),
      load(reactions, () => {
        const fallback = reactions.replace(/-(?:ink|sketch|riso|paper|pixel)-/, '-');
        if (fallback !== reactions && !cancelled) setActiveReactions(fallback);
      }),
    ]).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [directions, reactions]);

  // Cursor tracking: attached once, reads size from a ref.
  useEffect(() => {
    const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!supportsHover) return;

    let sector = -1;
    let pointer: { x: number; y: number } | null = null;

    const aim = () => {
      const node = containerRef.current;
      if (!node || !pointer) return;

      const box = node.getBoundingClientRect();
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);

      const dist = Math.hypot(dx, dy);
      const rawAngle = Math.atan2(dy, dx);
      const deadZone = Math.max(MIN_DEAD_ZONE, sizeRef.current * DEAD_ZONE_RATIO);

      if (dist < deadZone) {
        sector = -1;
        setDirection('center');
        return;
      }

      // Hysteresis keeps the sprite from flickering between two adjacent sectors.
      if (sector !== -1 && Math.abs(wrapAngle(rawAngle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS) {
        return;
      }

      sector = (Math.round(rawAngle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length;
      setDirection(CLOCKWISE[sector]);
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
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach(window.clearTimeout);
    },
    []
  );

  // Tapping cycles through the expressions.
  const handleBoop = useCallback(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];

    const next = REACTIONS[cycleRef.current % REACTIONS.length];
    cycleRef.current += 1;

    setReaction(next);
    timersRef.current.push(window.setTimeout(() => setReaction(null), REACTION_DWELL_MS));

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      squashRef.current?.animate(SQUASH_KEYFRAMES, {
        duration: SQUASH_MS,
        easing: 'linear',
      });
    }

    onBoopRef.current?.();
  }, []);

  const layerBase: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundSize: '300% 300%',
    backgroundRepeat: 'no-repeat',
    transition: 'opacity 0.08s ease-in-out',
  };

  const dirIndex = DIRECTIONS.indexOf(direction);
  const reactIndex = REACTIONS.indexOf(reaction ?? 'blink');

  // Without an onBoop handler the mascot is decorative, so it renders as a
  // plain element rather than a focusable button that does nothing.
  const isInteractive = Boolean(onBoop);

  const shellProps: React.CSSProperties = {
    position: 'relative',
    display: 'block',
    flexShrink: 0,
    width: size,
    height: size,
    padding: 0,
    border: 0,
    background: 'transparent',
    appearance: 'none',
    cursor: isInteractive ? 'pointer' : 'default',
    userSelect: 'none',
    outline: 'none',
    opacity: ready ? 1 : 0.5,
    transition: 'opacity 0.2s ease',
  };

  const mascot = (
    <span
      ref={squashRef}
      style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          height: '100%',
          transformOrigin: '50% 78%',
        }}
      >
        <span
          style={{
            ...layerBase,
            backgroundImage: `url("${activeDirections}")`,
            ...cellPosition(dirIndex >= 0 ? dirIndex : 4),
            opacity: reaction ? 0 : 1,
          }}
        />
        <span
          style={{
            ...layerBase,
            backgroundImage: `url("${activeReactions}")`,
            ...cellPosition(reactIndex >= 0 ? reactIndex : 0),
            opacity: reaction ? 1 : 0,
          }}
        />
      </span>
  );

  if (!isInteractive) {
    return (
      <span
        ref={containerRef as React.RefObject<HTMLSpanElement>}
        role="img"
        aria-label={`${label} mascot`}
        className={`enhanced-mascot-btn ${className}`}
        style={shellProps}
      >
        {mascot}
      </span>
    );
  }

  return (
    <button
      ref={containerRef as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={handleBoop}
      aria-label={`Tap ${label}`}
      className={`enhanced-mascot-btn ${className}`}
      style={shellProps}
    >
      {mascot}
    </button>
  );
}
