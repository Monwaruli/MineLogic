/**
 * Pure input mapping for the Board_View (Requirement 1 input mapping, task 4.2).
 *
 * This module has no React or DOM imports so it can be unit-tested directly and
 * reused by the components. It translates a pointer gesture on a Tile into the
 * engine Action the Board_Engine should apply, deciding reveal vs. flag vs.
 * chord from the mouse button and whether the Tile is already revealed.
 *
 * Mouse mapping, matching common Minesweeper conventions:
 *  - Primary press on a covered Tile: Reveal_Click.
 *  - Secondary press on a covered Tile: Flag_Toggle (the view also suppresses
 *    the browser context menu).
 *  - Primary or middle press on a revealed Number: Chord_Click.
 *  - Primary + Secondary pressed together (on a revealed Number): Chord_Click.
 *
 * A gesture that maps to nothing (e.g. a secondary press on a revealed Tile, or
 * a middle press on a covered Tile) returns null and the view ignores it.
 */

import type { Action } from '../engine/game';
import type { Tile } from '../engine/board';

/** The pointer buttons a gesture may use, normalized from a PointerEvent. */
export type PointerButton = 'primary' | 'secondary' | 'middle' | 'both' | 'other';

/** What the view knows about the target Tile when a gesture arrives. */
export interface TileContext {
  /** True when the Tile is already revealed (so it may be a Number to chord). */
  revealed: boolean;
}

/**
 * Normalize a DOM mouse `button`/`buttons` pair into a {@link PointerButton}.
 *
 * `button` is the button that changed (0 primary, 1 middle, 2 secondary);
 * `buttons` is the bitmask of buttons currently held (1 primary, 2 secondary,
 * 4 middle). When both primary and secondary are held we report `'both'` so the
 * mapping can treat it as a chord.
 */
export function normalizeButton(button: number, buttons: number): PointerButton {
  const primaryHeld = (buttons & 1) !== 0;
  const secondaryHeld = (buttons & 2) !== 0;
  if (primaryHeld && secondaryHeld) return 'both';
  if (button === 0) return 'primary';
  if (button === 1) return 'middle';
  if (button === 2) return 'secondary';
  return 'other';
}

/**
 * Map a pointer gesture on a Tile to the engine Action to apply, or null when
 * the gesture should be ignored.
 */
export function mapGestureToAction(
  button: PointerButton,
  tile: Tile,
  ctx: TileContext,
): Action | null {
  if (ctx.revealed) {
    // On a revealed Number, primary / middle / both chord. Secondary does
    // nothing (you cannot flag a revealed Tile).
    if (button === 'primary' || button === 'middle' || button === 'both') {
      return { type: 'Chord_Click', tile };
    }
    return null;
  }

  // Covered Tile.
  if (button === 'primary') return { type: 'Reveal_Click', tile };
  if (button === 'secondary') return { type: 'Flag_Toggle', tile };
  // Middle / both on a covered Tile chords nothing.
  return null;
}
