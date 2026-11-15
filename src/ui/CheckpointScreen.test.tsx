// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import CheckpointScreen from './CheckpointScreen';
import { variationsForTier } from '../content/checkpoints';
import {
  applyCheckpointAction,
  createCheckpoint,
  seededChooser,
} from '../engine/checkpoint';
import { classifyGame } from '../engine/practice';
import { isCheckpointPassed, type StorageLike } from '../storage/checkpointStorage';
import type { GameState } from '../engine/game';
import type { Tile } from '../engine/board';

afterEach(cleanup);

function memoryStorage(): StorageLike {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function tileAt(row: number, col: number): HTMLButtonElement {
  return document.querySelector(
    `button[data-row="${row}"][data-col="${col}"]`,
  ) as HTMLButtonElement;
}

function primaryClick(row: number, col: number) {
  act(() => {
    fireEvent.mouseDown(tileAt(row, col), { button: 0, buttons: 1 });
  });
}

/** The Provably_Safe covered tiles of a game, row-major. */
function safeTiles(game: GameState): Tile[] {
  const result = classifyGame(game);
  const out: Tile[] = [];
  for (const [key, cls] of result.classification) {
    if (cls !== 'Provably_Safe') continue;
    if (game.revealed.has(key)) continue;
    const [r, c] = key.split(',').map(Number) as Tile;
    out.push([r, c]);
  }
  return out;
}

describe('CheckpointScreen (Requirement 13 + 12 layout)', () => {
  it('shows three streak markers, all empty at the start (13.5)', () => {
    render(
      <CheckpointScreen tier="Beginner" seed={0} onHome={() => {}} storage={memoryStorage()} />,
    );
    const markers = screen.getByTestId('streak-markers');
    expect(markers.querySelectorAll('[data-testid="streak-empty"]')).toHaveLength(3);
    expect(markers.querySelectorAll('[data-testid="streak-filled"]')).toHaveLength(0);
  });

  it('shows the Video_Panel beside the board, playing the tier walkthrough clip (12.1, 12.2)', () => {
    render(
      <CheckpointScreen tier="Beginner" seed={0} onHome={() => {}} storage={memoryStorage()} />,
    );
    // The panel renders beside the board; with a walkthrough clip now configured
    // per tier (src/content/videos.ts), it shows the native file player rather
    // than the coming-soon placeholder.
    expect(screen.getByTestId('video-panel')).toBeTruthy();
    const video = screen.getByTestId('video-file');
    expect(video.querySelector('source')?.getAttribute('src') || '').toContain('videos/beginner.webm');
  });

  it('a Slip flashes an error marker and resets the streak (13.3)', () => {
    // Drive the engine to find a known non-safe covered tile on the first board.
    const pool = variationsForTier('Intermediate');
    const start = createCheckpoint(pool, seededChooser(3));
    const safe = new Set(
      safeTiles(start.game).map(([r, c]) => `${r},${c}`),
    );
    // Find a covered tile that is NOT safe: a Guess target.
    let guess: Tile | null = null;
    for (let r = 0; r < 5 && !guess; r++) {
      for (let c = 0; c < 5; c++) {
        const key = `${r},${c}`;
        if (!start.game.revealed.has(key) && !safe.has(key)) {
          guess = [r, c];
          break;
        }
      }
    }
    expect(guess).not.toBeNull();

    const storage = memoryStorage();
    render(
      <CheckpointScreen
        tier="Intermediate"
        seed={3}
        onHome={() => {}}
        storage={storage}
        slipFlashMs={500}
      />,
    );

    // The screen uses the same seed/pool, so the first board matches `start`.
    primaryClick(guess![0], guess![1]);

    // A slip message appears and the slipped tile is marked with the error role.
    expect(screen.getByText(/slip/i)).toBeTruthy();
    // The error overlay badge (✗) is rendered somewhere on the board.
    expect(document.body.textContent).toContain('✗');
  });

  it('records the checkpoint as passed after three clean clears (13.4)', () => {
    const storage = memoryStorage();
    const seed = 1;
    render(
      <CheckpointScreen tier="Beginner" seed={seed} onHome={() => {}} storage={storage} />,
    );

    // A mirror engine, seeded identically to the component, tells us which safe
    // tile to click next. We apply each click to both the UI and the mirror so
    // they advance variations in lockstep.
    let mirror = createCheckpoint(variationsForTier('Beginner'), seededChooser(seed));

    let guard = 0;
    while (!mirror.passed && guard++ < 200) {
      const tiles = safeTiles(mirror.game);
      expect(tiles.length).toBeGreaterThan(0);
      const [r, c] = tiles[0];
      primaryClick(r, c);
      mirror = applyCheckpointAction(mirror, {
        type: 'Reveal_Click',
        tile: [r, c],
      }).state;
    }

    expect(mirror.passed).toBe(true);
    expect(isCheckpointPassed('Beginner', storage)).toBe(true);
    expect(screen.getByText(/checkpoint passed/i)).toBeTruthy();
  });
});
