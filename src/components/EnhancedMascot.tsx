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
/** How long each idle gaze direction is held on touch devices. */
const IDLE_DWELL_MS = 1600;

/**
 * Torso lock.
 *
 * Gaze sheets frame each pose slightly differently, so the shoulders can shift a
 * little between cells — which reads as the whole body twitching. A faint,
 * bottom-anchored copy of a fixed reference cell is composited underneath to
 * anchor the shoulders, so only the head appears to move.
 */
const TORSO_ANCHOR_CELL = 4; // the neutral, forward-facing cell
const TORSO_FADE_START = 62;
const TORSO_FADE_END = 88;

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

  // Gaze tracking.
  //
  // Desktop: the mascot follows the mouse anywhere on the page.
  // Touch:   there is no hovering cursor, so a drag anywhere on the page steers
  //          the gaze, and on release it eases back to centre. The mascot also
  //          drifts on its own when untouched, so a phone user still sees it
  //          animate rather than sit frozen.
  useEffect(() => {
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    let sector = -1;
    let pointer: { x: number; y: number } | null = null;
    let touching = false;

    const aim = () => {
      const node = containerRef.current;
      if (!node || !pointer) return;

      const box = node.getBoundingClientRect();
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);

      const dist = Math.hypot(dx, dy);
      const rawAngle = Math.atan2(dy, dx);
      // Dead-zone scales with the mascot so the feel is the same at any size.
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

    // Mouse movement steers directly.
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };

    // Touch: dragging steers, lifting releases back to centre.
    const onTouchStart = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touching = true;
      stopIdle();
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };

    const onTouchMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touching) return;
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };

    const onTouchEnd = () => {
      if (!touching) return;
      touching = false;
      pointer = null;
      sector = -1;
      setDirection('center');
    };

    // Legacy Touch Events, for browsers that fire touch rather than pointer
    // events (older iOS Safari). Coordinates come from touches[0] and are mapped
    // relative to the mascot, exactly like a mouse.
    const readTouch = (event: TouchEvent) => {
      const t = event.touches?.[0] ?? event.changedTouches?.[0];
      if (!t) return;
      pointer = { x: t.clientX, y: t.clientY };
      aim();
    };

    const onTouchEventStart = (event: TouchEvent) => {
      touching = true;
      stopIdle();
      readTouch(event);
    };

    const onTouchEventMove = (event: TouchEvent) => {
      if (!touching) return;
      readTouch(event);
    };

    const onTouchEventEnd = () => onTouchEnd();

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onTouchStart, { passive: true });
    window.addEventListener('pointermove', onTouchMove, { passive: true });
    window.addEventListener('pointerup', onTouchEnd, { passive: true });
    window.addEventListener('pointercancel', onTouchEnd, { passive: true });
    window.addEventListener('touchstart', onTouchEventStart, { passive: true });
    window.addEventListener('touchmove', onTouchEventMove, { passive: true });
    window.addEventListener('touchend', onTouchEventEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEventEnd, { passive: true });
    window.addEventListener('scroll', aim, { passive: true });

    // On touch devices, sweep the gaze gently while idle so the mascot reads as
    // alive without anyone interacting.
    let idleTimer = 0;
    const startIdle = () => {
      if (canHover || touching) return;
      stopIdle();
      const step = () => {
        if (touching) return;
        const order: Direction[] = ['left', 'up-left', 'up', 'up-right', 'right', 'down-right', 'down', 'down-left'];
        const next = order[(cycleRef.current + 1) % order.length];
        cycleRef.current += 1;
        setDirection(next);
        idleTimer = window.setTimeout(step, IDLE_DWELL_MS);
      };
      idleTimer = window.setTimeout(step, IDLE_DWELL_MS);
    };

    function stopIdle() {
      if (idleTimer) {
        window.clearTimeout(idleTimer);
        idleTimer = 0;
      }
    }

    // Only sweep when genuinely idle, not while the page is loading.
    const kickoff = window.setTimeout(startIdle, IDLE_DWELL_MS);
    void kickoff;

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onTouchStart);
      window.removeEventListener('pointermove', onTouchMove);
      window.removeEventListener('pointerup', onTouchEnd);
      window.removeEventListener('pointercancel', onTouchEnd);
      window.removeEventListener('touchstart', onTouchEventStart);
      window.removeEventListener('touchmove', onTouchEventMove);
      window.removeEventListener('touchend', onTouchEventEnd);
      window.removeEventListener('touchcancel', onTouchEventEnd);
      window.removeEventListener('scroll', aim);
      window.clearTimeout(kickoff);
      stopIdle();
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
    WebkitUserSelect: 'none',
    // Suppress iOS tap highlight and the long-press callout menu.
    WebkitTapHighlightColor: 'transparent',
    // manipulation removes the ~300ms double-tap-to-zoom delay without
    // disabling pinch-zoom elsewhere on the page.
    touchAction: 'manipulation',
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
        {/* Torso lock: a steady body behind the moving sprite, faded in wherever
            the sheet's own body has been cropped away by the gaze framing. */}
        <span
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${activeDirections}")`,
            ...cellPosition(TORSO_ANCHOR_CELL),
            opacity: reaction ? 0.12 : 0.16,
            maskImage: `linear-gradient(to bottom, transparent ${TORSO_FADE_START}%, #000 ${TORSO_FADE_END}%)`,
            WebkitMaskImage: `linear-gradient(to bottom, transparent ${TORSO_FADE_START}%, #000 ${TORSO_FADE_END}%)`,
            transition: 'opacity 0.12s ease-in-out',
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
      // Stop iOS/Android turning a long press on the sprite into a text
      // selection or the system callout menu.
      onContextMenu={(e) => e.preventDefault()}
      draggable={false}
      aria-label={`Tap ${label}`}
      className={`enhanced-mascot-btn ${className}`}
      style={shellProps}
    >
      {mascot}
    </button>
  );
}
