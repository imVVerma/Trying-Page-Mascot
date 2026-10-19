/**
 * The nine gaze angles and the nine reactions, in sprite-sheet order.
 *
 * These live apart from the component for two reasons: EnhancedMascot.tsx then
 * exports only components, so editing a constant no longer invalidates Fast
 * Refresh for the whole file; and the gaze harness can share the exact ordering
 * it asserts against instead of duplicating it.
 */

/** Row-major, matching the 3x3 directions sheet. */
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

/** Row-major, matching the 3x3 reactions sheet. */
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
