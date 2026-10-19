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
 * Direction change feel.
 *
 * A direction swap used to be an instant backgroundPosition jump and the gaze
 * snapped straight back to centre the moment a finger lifted, which read as a
 * hard twitch. Direction layers now crossfade over DIRECTION_CROSSFADE_MS on a
 * soft ease, and the return to centre is deferred by RETURN_TO_CENTER_MS so the
 * mascot lingers on whatever corner it was pointed at before settling.
 */
const DIRECTION_CROSSFADE_MS = 340;
const DIRECTION_EASING = 'cubic-bezier(0.33, 0, 0.2, 1)';
const RETURN_TO_CENTER_MS = 420;

/**
 * Touch capture zone.
 *
 * EDGE_GUTTER_PX: touches that begin this close to the left or right edge of
 * the viewport are never treated as gaze input — that is where the OS reserves
 * swipe-to-go-back and screen-edge gestures, and stealing them is what made
 * edge swipes feel hijacked.
 *
 * SWIPE_INTENT_PX: the first few pixels of a drag are ambiguous, so the
 * gesture is classified as gaze (mostly horizontal) or scroll (mostly
 * vertical) once it clears this distance. Gaze drags then have their default
 * action suppressed so the page does not scroll out from under them, while
 * vertical drags scroll normally.
 */
const EDGE_GUTTER_PX = 28;
const SWIPE_INTENT_PX = 12;

/**
 * Dead-zone for touch. The desktop dead zone (0.42 of the sprite, min 48px) is
 * sized for a hovering cursor and swallowed most of a phone-sized mascot, so a
 * drag across the middle of the screen did nothing until it was already far
 * off centre. Touch uses a much tighter ring so the central screen area
 * responds immediately, while still leaving the mascot a centre pose to return
 * to.
 */
const TOUCH_DEAD_ZONE_RATIO = 0.18;
const MIN_TOUCH_DEAD_ZONE = 26;


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
  /**
   * Two stacked direction layers so a change can crossfade instead of popping.
   * `side` is the layer currently on top; the other one holds the outgoing pose
   * while it fades out, which is what keeps a turn — or the return to centre —
   * from snapping.
   */
  const [dirLayers, setDirLayers] = useState<{ front: Direction; back: Direction; side: 0 | 1 }>({
    front: 'center',
    back: 'center',
    side: 0,
  });
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [ready, setReady] = useState(false);
  const [activeDirections, setActiveDirections] = useState(directions);
  const [activeReactions, setActiveReactions] = useState(reactions);

  useEffect(() => setActiveDirections(directions), [directions]);
  useEffect(() => setActiveReactions(reactions), [reactions]);

  // Swap the crossfade layers whenever the gaze direction actually changes.
  useEffect(() => {
    setDirLayers((prev) =>
      prev.front === direction
        ? prev
        : { front: direction, back: prev.front, side: prev.side === 0 ? 1 : 0 }
    );
  }, [direction]);

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
    /**
     * What the current touch is doing:
     *  - 'undecided'  not yet moved far enough to classify
     *  - 'gaze'       mostly-horizontal drag in the safe middle band, steers
     *  - 'scroll'     edge swipe or vertical drag, left entirely to the browser/OS
     */
    let gesture: 'undecided' | 'gaze' | 'scroll' = 'scroll';
    let startX = 0;
    let startY = 0;
    let centerTimer = 0;
    let idleTimer = 0;
    let kickoff = 0;

    const cancelCenterReturn = () => {
      if (centerTimer) {
        window.clearTimeout(centerTimer);
        centerTimer = 0;
      }
    };

    const goCentre = () => {
      sector = -1;
      setDirection('center');
    };

    /**
     * Returning to centre is deferred rather than immediate. Snapping back the
     * instant input stopped is what made a corner tap feel like it sprang back;
     * holding the pose briefly and then crossfading (see DIRECTION_CROSSFADE_MS)
     * gives the settle instead.
     */
    const scheduleCentreReturn = () => {
      cancelCenterReturn();
      centerTimer = window.setTimeout(() => {
        centerTimer = 0;
        goCentre();
      }, RETURN_TO_CENTER_MS);
    };

    /** Touches inside the OS gesture gutters are never ours to interpret. */
    const inEdgeGutter = (x: number) =>
      x <= EDGE_GUTTER_PX || x >= window.innerWidth - EDGE_GUTTER_PX;

    const aim = () => {
      const node = containerRef.current;
      if (!node || !pointer) return;

      const box = node.getBoundingClientRect();
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);

      const dist = Math.hypot(dx, dy);
      const rawAngle = Math.atan2(dy, dx);
      // Dead-zone scales with the mascot so the feel is the same at any size,
      // and is much tighter under touch so the middle of the screen responds.
      const deadZone = touching
        ? Math.max(MIN_TOUCH_DEAD_ZONE, sizeRef.current * TOUCH_DEAD_ZONE_RATIO)
        : Math.max(MIN_DEAD_ZONE, sizeRef.current * DEAD_ZONE_RATIO);

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

    const beginTouch = (x: number, y: number) => {
      // Swipes that start against the screen edge belong to the OS — the
      // swipe-to-go-back gesture — so they are ignored outright rather than
      // partially captured.
      if (inEdgeGutter(x)) {
        gesture = 'scroll';
        return;
      }

      touching = true;
      cancelCenterReturn();
      stopIdle();
      startX = x;
      startY = y;
      gesture = 'undecided';
      pointer = { x, y };
      aim();
    };

    const continueTouch = (x: number, y: number) => {
      if (!touching || gesture === 'scroll') return;

      if (gesture === 'undecided') {
        const dx = x - startX;
        const dy = y - startY;
        if (Math.hypot(dx, dy) < SWIPE_INTENT_PX) return;
        // Mostly-horizontal drives the gaze; mostly-vertical is a page scroll
        // and we hands off immediately so it never feels hijacked.
        gesture = Math.abs(dx) >= Math.abs(dy) ? 'gaze' : 'scroll';
        if (gesture === 'scroll') {
          pointer = null;
          scheduleCentreReturn();
          return;
        }
      }

      pointer = { x, y };
      aim();
    };

    const endTouch = () => {
      if (!touching) return;
      touching = false;
      gesture = 'scroll';
      pointer = null;
      scheduleCentreReturn();
      // Resume the idle sweep so a phone mascot goes back to drifting on its own.
      kickoff = window.setTimeout(startIdle, IDLE_DWELL_MS);
    };

    // Mouse movement steers directly — but only when no touch gesture is in
    // flight. Without this guard a stray mouse move (a cursor parked over the
    // page, or a hybrid laptop nudging the trackpad during a screen drag)
    // overwrites the touch point mid-gesture and yanks the gaze away, which is
    // what made touch dragging unreliable on touch-screen laptops.
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || touching) return;
      cancelCenterReturn();
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };

    // Pointer Events cover touch on most modern browsers.
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      beginTouch(event.clientX, event.clientY);
    };

    const onPointerTouchMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      continueTouch(event.clientX, event.clientY);
    };

    // Legacy Touch Events, for browsers that fire touch rather than pointer
    // events (older iOS Safari). Coordinates come from touches[0].
    const readTouches = (event: TouchEvent, phase: 'begin' | 'continue') => {
      const t = event.touches?.[0] ?? event.changedTouches?.[0];
      if (!t) return;
      if (phase === 'begin') beginTouch(t.clientX, t.clientY);
      else continueTouch(t.clientX, t.clientY);
    };

    /**
     * Suppresses the default scroll only once a drag has been recognised as a
     * gaze drag (or is still undetermined inside the safe middle band). Registered
     * non-passive — it runs after the classifiers above, which share the
     * registration order — so a gaze drag cannot scroll the page out from under
     * the mascot, while edge swipes and vertical scrolls are never blocked.
     */
    const onMoveGuard = (event: TouchEvent) => {
      if (!touching) return;
      if (gesture === 'gaze' || gesture === 'undecided') event.preventDefault();
    };

    const onTouchStartEvent = (event: TouchEvent) => readTouches(event, 'begin');
    const onTouchMoveEvent = (event: TouchEvent) => readTouches(event, 'continue');

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerTouchMove, { passive: true });
    window.addEventListener('pointerup', endTouch, { passive: true });
    window.addEventListener('pointercancel', endTouch, { passive: true });
    window.addEventListener('touchstart', onTouchStartEvent, { passive: true });
    window.addEventListener('touchmove', onTouchMoveEvent, { passive: true });
    window.addEventListener('touchmove', onMoveGuard, { passive: false });
    window.addEventListener('touchend', endTouch, { passive: true });
    window.addEventListener('touchcancel', endTouch, { passive: true });
    window.addEventListener('scroll', aim, { passive: true });

    // On touch devices, sweep the gaze gently while idle so the mascot reads as
    // alive without anyone interacting.
    function startIdle() {
      if (canHover || touching || idleTimer) return;
      const step = () => {
        if (touching) return;
        const order: Direction[] = ['left', 'up-left', 'up', 'up-right', 'right', 'down-right', 'down', 'down-left'];
        const next = order[(cycleRef.current + 1) % order.length];
        cycleRef.current += 1;
        setDirection(next);
        idleTimer = window.setTimeout(step, IDLE_DWELL_MS);
      };
      idleTimer = window.setTimeout(step, IDLE_DWELL_MS);
    }

    function stopIdle() {
      if (idleTimer) {
        window.clearTimeout(idleTimer);
        idleTimer = 0;
      }
    }

    // Only sweep when genuinely idle, not while the page is loading.
    kickoff = window.setTimeout(startIdle, IDLE_DWELL_MS);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerTouchMove);
      window.removeEventListener('pointerup', endTouch);
      window.removeEventListener('pointercancel', endTouch);
      window.removeEventListener('touchstart', onTouchStartEvent);
      window.removeEventListener('touchmove', onTouchMoveEvent);
      window.removeEventListener('touchmove', onMoveGuard);
      window.removeEventListener('touchend', endTouch);
      window.removeEventListener('touchcancel', endTouch);
      window.removeEventListener('scroll', aim);
      window.clearTimeout(kickoff);
      cancelCenterReturn();
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
    // Direction changes (and the settle back to centre) dissolve rather than
    // pop: a soft ease over a deliberately slow beat.
    transition: `opacity ${DIRECTION_CROSSFADE_MS}ms ${DIRECTION_EASING}`,
  };

  const dirIndexA = DIRECTIONS.indexOf(dirLayers.side === 0 ? dirLayers.front : dirLayers.back);
  const dirIndexB = DIRECTIONS.indexOf(dirLayers.side === 1 ? dirLayers.front : dirLayers.back);
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
        {/* Two direction layers: the visible one carries the current gaze, the
            other holds the pose being left behind and dissolves away, so a turn
            — or the settle back to centre — is a crossfade, not a jump. */}
        <span
          style={{
            ...layerBase,
            backgroundImage: `url("${activeDirections}")`,
            ...cellPosition(dirIndexA >= 0 ? dirIndexA : 4),
            opacity: reaction ? 0 : dirLayers.side === 0 ? 1 : 0,
          }}
        />
        <span
          style={{
            ...layerBase,
            backgroundImage: `url("${activeDirections}")`,
            ...cellPosition(dirIndexB >= 0 ? dirIndexB : 4),
            opacity: reaction ? 0 : dirLayers.side === 1 ? 1 : 0,
          }}
        />
        <span
          style={{
            ...layerBase,
            backgroundImage: `url("${activeReactions}")`,
            ...cellPosition(reactIndex >= 0 ? reactIndex : 0),
            opacity: reaction ? 1 : 0,
            // Reactions dwell for a fixed beat, so they dissolve faster than a
            // gaze turn in order to stay legible within it.
            transition: 'opacity 220ms ease-in-out',
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
