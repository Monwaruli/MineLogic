/**
 * Board_View (task 4.2): renders a Board and turns pointer gestures into engine
 * Actions. Pure presentation plus input mapping — all game rules stay in the
 * Board_Engine. The parent passes the GameState and an `onAction` callback; the
 * view never mutates state itself.
 *
 * Rendering:
 *  - A CSS grid of fixed-size Tile buttons (>= 24px), sized for up to Expert
 *    (30 columns x 16 rows). The grid scrolls if the viewport is small.
 *  - Numbers 1-8 use high-contrast colors AND the digit itself, so color never
 *    carries meaning alone. Flags and mines use a glyph plus an aria-label, so
 *    they are distinguishable without color.
 *  - The Start_Tile is marked before the first reveal to guide the player to
 *    the required first action.
 *
 * Input (see inputMapping.ts for the pure mapping):
 *  - onMouseDown maps primary/secondary/middle/both to reveal/flag/chord. We use
 *    the mouse event (not pointer) because its button/buttons fields are
 *    well-defined across browsers and test environments.
 *  - onContextMenu is suppressed so a right-click flags instead of opening the
 *    browser menu.
 *
 * Accessibility: every Tile is a real <button> (focusable, keyboard-activatable
 * for reveal), the grid has role="grid" with an aria-label, and each Tile has
 * an aria-label describing its state.
 */

import { useCallback, useMemo, useState } from 'react';
import { neighbors, numberAt, tileKey, type Tile } from '../engine/board';
import type { Action, GameState } from '../engine/game';
import { mapGestureToAction, normalizeButton } from './inputMapping';

/** Classic, high-contrast Number colors. Color is a supplement to the digit. */
const NUMBER_COLORS: Record<number, string> = {
  1: '#1d4ed8', // blue
  2: '#15803d', // green
  3: '#b91c1c', // red
  4: '#6d28d9', // purple
  5: '#9a3412', // maroon
  6: '#0f766e', // teal
  7: '#111827', // near-black
  8: '#4b5563', // gray
};

/** Smallest Tile edge in px (requirement: at least 24px). */
const TILE_PX = 28;

/**
 * Optional overlays drawn over the board. Used by Practice_Mode for the
 * two-stage Nudge: a `region` outline (stage 1) and `anchors` highlights (stage
 * 2). Each overlay carries a distinct border pattern and a label so it reads
 * without relying on color (Requirement 2.6). Overlays are purely visual — they
 * never change the Board_State (guardrail 14.8).
 */
export interface BoardOverlay {
  /** Inclusive region box `[top,left]`..`[bottom,right]` to outline, or null. */
  region?: { top: number; left: number; bottom: number; right: number } | null;
  /** Anchor Tiles to highlight (the Nudge's Anchor_Numbers). */
  anchors?: Tile[];
  /**
   * Role-tagged, labeled Tile overlays used by the Tutorial_Player's Learn_Steps
   * (Requirement 11.2) and to mark an intercepted Do_Step Tile (Requirement
   * 11.5). Each role draws a distinct border pattern and a text label so it
   * reads without relying on color (Requirement 2.6). Overlays are purely
   * visual and never change the Board_State.
   */
  roles?: BoardRoleOverlay[];
}

/** A role drawn on one or more Tiles by the Tutorial_Player. */
export type OverlayTileRole = 'clue' | 'safe' | 'mine' | 'error';

/** A labeled, role-tagged Tile overlay. */
export interface BoardRoleOverlay {
  role: OverlayTileRole;
  tiles: Tile[];
  label: string;
}

/** Border/label styling for each Tile role. Each reads without color alone. */
const ROLE_STYLE: Record<OverlayTileRole, { ring: string; badge: string; mark: string }> = {
  // A dotted sky ring + ◆ marks an interacting Number.
  clue: { ring: 'ring-2 ring-dotted ring-sky-500 ring-inset z-10', badge: 'text-sky-700', mark: '◆' },
  // A dashed emerald ring + ✓ marks a Tile proven safe.
  safe: { ring: 'ring-2 ring-dashed ring-emerald-500 ring-inset z-10', badge: 'text-emerald-700', mark: '✓' },
  // A solid rose ring + ✸ marks a Tile proven to be a mine.
  mine: { ring: 'ring-2 ring-rose-500 ring-inset z-10', badge: 'text-rose-700', mark: '✸' },
  // A solid amber ring + ✗ marks an intercepted (not-yet-provable) Tile.
  error: { ring: 'ring-2 ring-amber-500 ring-inset z-10', badge: 'text-amber-700', mark: '✗' },
};

export interface BoardViewProps {
  state: GameState;
  /** Called with the engine Action a gesture maps to. */
  onAction: (action: Action) => void;
  /** When true (before the first reveal), highlight the Start_Tile. */
  highlightStart?: boolean;
  /** Optional Nudge overlays (region outline and anchor highlights). */
  overlay?: BoardOverlay | null;
}

/** Render one Tile and compute its content, colors, and aria-label. */
function renderTile(
  state: GameState,
  r: number,
  c: number,
  mineSet: Set<string>,
  highlightStart: boolean,
): { content: string; color?: string; ariaLabel: string; className: string } {
  const key = tileKey(r, c);
  const isRevealed = state.revealed.has(key);
  const isFlagged = state.flags.has(key);
  const isMine = mineSet.has(key);
  const isStart =
    highlightStart &&
    !!state.board.startTile &&
    state.board.startTile[0] === r &&
    state.board.startTile[1] === c;

  const base =
    'flex items-center justify-center font-bold select-none border border-slate-600 ' +
    'focus:outline-none focus:ring-2 focus:ring-amber-400 focus:z-10';

  if (isRevealed) {
    if (isMine) {
      // A revealed mine (a loss). Glyph + label, not color alone.
      return {
        content: '✸',
        ariaLabel: `row ${r + 1} column ${c + 1}: mine`,
        className: `${base} bg-red-700 text-white`,
      };
    }
    const n = numberAt([r, c], state.board.width, state.board.height, mineSet);
    return {
      content: n === 0 ? '' : String(n),
      color: n === 0 ? undefined : NUMBER_COLORS[n],
      ariaLabel:
        n === 0
          ? `row ${r + 1} column ${c + 1}: empty`
          : `row ${r + 1} column ${c + 1}: ${n}`,
      className: `${base} bg-slate-200`,
    };
  }

  if (isFlagged) {
    // Flag: glyph + label so it reads without relying on color.
    return {
      content: '⚑',
      color: '#b91c1c',
      ariaLabel: `row ${r + 1} column ${c + 1}: flagged`,
      className: `${base} bg-slate-400`,
    };
  }

  // Covered, unflagged.
  return {
    content: isStart ? '◎' : '',
    color: isStart ? '#b45309' : undefined,
    ariaLabel: isStart
      ? `row ${r + 1} column ${c + 1}: start tile, reveal to begin`
      : `row ${r + 1} column ${c + 1}: covered`,
    className: `${base} ${
      isStart ? 'bg-amber-200 ring-2 ring-amber-500' : 'bg-slate-400 hover:bg-slate-300'
    } active:bg-slate-300`,
  };
}

/**
 * Which part of a Nudge overlay touches a Tile: the region's edge (outline),
 * its interior, an anchor Number, or nothing.
 */
interface OverlayInfo {
  /** The Tile is on the Hint_Region's border. */
  regionEdge: boolean;
  /** The Tile is inside the Hint_Region (edge or interior). */
  inRegion: boolean;
  /** The Tile is one of the highlighted Anchor_Numbers (stage 2). */
  anchor: boolean;
}

/** Compute how the overlay touches `[r, c]`. */
function overlayInfoAt(overlay: BoardOverlay | null | undefined, r: number, c: number): OverlayInfo {
  if (!overlay) return { regionEdge: false, inRegion: false, anchor: false };
  let inRegion = false;
  let regionEdge = false;
  const reg = overlay.region;
  if (reg) {
    inRegion = r >= reg.top && r <= reg.bottom && c >= reg.left && c <= reg.right;
    regionEdge =
      inRegion && (r === reg.top || r === reg.bottom || c === reg.left || c === reg.right);
  }
  const anchor = !!overlay.anchors?.some(([ar, ac]) => ar === r && ac === c);
  return { regionEdge, inRegion, anchor };
}

export default function BoardView({
  state,
  onAction,
  highlightStart = false,
  overlay = null,
}: BoardViewProps) {
  const { board } = state;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));

  // Press-and-hold chord preview: while the primary button is held on a
  // revealed Number, its covered, unflagged neighbors are highlighted (the
  // classic Minesweeper 'blink'). Purely visual — it never changes state.
  const [pressedChord, setPressedChord] = useState<Tile | null>(null);

  const highlightedKeys = useMemo(() => {
    if (!pressedChord) return new Set<string>();
    const [pr, pc] = pressedChord;
    const n = numberAt(pressedChord, board.width, board.height, mineSet);
    // Only revealed Numbers (value > 0) preview their neighbors.
    if (!state.revealed.has(tileKey(pr, pc)) || n === 0) return new Set<string>();
    const keys = new Set<string>();
    for (const [nr, nc] of neighbors(pressedChord, board.width, board.height)) {
      const k = tileKey(nr, nc);
      // Highlight covered, unflagged neighbors — the tiles a chord would open.
      if (!state.revealed.has(k) && !state.flags.has(k)) keys.add(k);
    }
    return keys;
  }, [pressedChord, board.width, board.height, mineSet, state.revealed, state.flags]);

  const clearPressed = useCallback(() => setPressedChord(null), []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, tile: Tile) => {
      const button = normalizeButton(e.button, e.buttons);
      const key = tileKey(tile[0], tile[1]);
      const action = mapGestureToAction(button, tile, {
        revealed: state.revealed.has(key),
      });
      // Start the press-and-hold neighbor preview on a chord gesture over a
      // revealed Number (visual only; the chord Action still fires below).
      if (action && action.type === 'Chord_Click') setPressedChord(tile);
      if (action) {
        e.preventDefault();
        onAction(action);
      }
    },
    [onAction, state.revealed],
  );

  // Keyboard support: Enter/Space reveals (or chords a revealed Number); the
  // flag gesture is mouse-only, which keyboard users reach via the context menu
  // suppression not applying to them — covered by the reveal path here.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, tile: Tile) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const key = tileKey(tile[0], tile[1]);
      const revealed = state.revealed.has(key);
      const action = mapGestureToAction('primary', tile, { revealed });
      if (action) onAction(action);
    },
    [onAction, state.revealed],
  );

  return (
    <div
      role="grid"
      aria-label={`Minesweeper board, ${board.height} rows by ${board.width} columns`}
      className="inline-grid gap-px bg-slate-600 p-px rounded overflow-auto max-w-full"
      style={{
        gridTemplateColumns: `repeat(${board.width}, ${TILE_PX}px)`,
        gridTemplateRows: `repeat(${board.height}, ${TILE_PX}px)`,
      }}
      // Suppress the browser context menu so secondary-press flags the Tile.
      onContextMenu={(e) => e.preventDefault()}
      // Clear the press-and-hold chord preview when the button releases or the
      // pointer leaves the board.
      onMouseUp={clearPressed}
      onMouseLeave={clearPressed}
    >
      {Array.from({ length: board.height }, (_, r) =>
        Array.from({ length: board.width }, (_, c) => {
          const info = renderTile(state, r, c, mineSet, highlightStart);
          const ov = overlayInfoAt(overlay, r, c);
          const tile: Tile = [r, c];

          // Role overlay (Tutorial_Player Learn_Steps / intercepted Tile).
          const roleHit = overlay?.roles?.find((ro) =>
            ro.tiles.some(([rr, cc]) => rr === r && cc === c),
          );
          const roleStyle = roleHit ? ROLE_STYLE[roleHit.role] : null;

          // Overlay styling: a dashed amber ring marks the Hint_Region edge; a
          // solid sky ring and a ◆ label mark an Anchor_Number (stage 2). Both
          // use a border pattern + label so they read without color alone.
          const overlayClass = ov.anchor
            ? ' ring-2 ring-sky-500 ring-inset z-10'
            : ov.regionEdge
            ? ' ring-2 ring-dashed ring-amber-400 ring-inset'
            : ov.inRegion
            ? ' ring-1 ring-amber-300/60 ring-inset'
            : '';
          const overlayLabel = roleHit
            ? `${info.ariaLabel}, ${roleHit.label}`
            : ov.anchor
            ? `${info.ariaLabel}, hint anchor`
            : ov.inRegion
            ? `${info.ariaLabel}, in hint region`
            : info.ariaLabel;

          const roleClass = roleStyle ? ` ${roleStyle.ring}` : '';

          // Press-and-hold chord preview: a covered neighbor of the held
          // Number gets a pressed/inset look (visual only).
          const isChordPreview = highlightedKeys.has(tileKey(r, c));
          const previewClass = isChordPreview
            ? ' bg-slate-300 ring-2 ring-sky-400 ring-inset z-10'
            : '';

          return (
            <button
              key={`${r},${c}`}
              type="button"
              role="gridcell"
              aria-label={overlayLabel}
              data-row={r}
              data-col={c}
              data-anchor={ov.anchor ? 'true' : undefined}
              data-region={ov.inRegion ? 'true' : undefined}
              data-role={roleHit ? roleHit.role : undefined}
              className={info.className + overlayClass + roleClass + previewClass}
              data-chord-preview={isChordPreview ? 'true' : undefined}
              style={{ width: TILE_PX, height: TILE_PX, color: info.color }}
              onMouseDown={(e) => handleMouseDown(e, tile)}
              onKeyDown={(e) => handleKeyDown(e, tile)}
            >
              {roleStyle ? (
                <span className="relative">
                  {info.content}
                  <span
                    aria-hidden="true"
                    className={`absolute -top-2 -right-2 text-[10px] ${roleStyle.badge}`}
                  >
                    {roleStyle.mark}
                  </span>
                </span>
              ) : ov.anchor ? (
                <span className="relative">
                  {info.content}
                  <span aria-hidden="true" className="absolute -top-2 -right-2 text-[10px] text-sky-600">◆</span>
                </span>
              ) : (
                info.content
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
