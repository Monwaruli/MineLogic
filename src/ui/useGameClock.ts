/**
 * Game clock hook (task 4.2).
 *
 * The clock is wall-clock based: elapsed time is `now - startedAt`, recomputed
 * on a timer. Because it reads the real clock rather than counting ticks, it
 * keeps advancing correctly even while the browser tab is hidden and the
 * interval is throttled or paused — when the tab wakes, the next tick shows the
 * true elapsed time. A `visibilitychange` listener also forces an immediate
 * recompute the moment the tab becomes visible again.
 *
 * `startedAt` is the epoch-ms timestamp of the Start_Tile reveal (null before
 * it). `stoppedAt` freezes the clock at the game's end. While running the hook
 * ticks about four times a second, enough for a smooth seconds display.
 */

import { useEffect, useRef, useState } from 'react';

/** Options controlling the clock. `now` is injectable for tests. */
export interface GameClockOptions {
  /** Epoch ms when the Start_Tile was revealed, or null before then. */
  startedAt: number | null;
  /** Epoch ms when the game ended, or null while still playing. */
  stoppedAt: number | null;
  /** Clock source; defaults to Date.now. Injectable for deterministic tests. */
  now?: () => number;
  /** Tick interval in ms while running. Defaults to 250. */
  intervalMs?: number;
}

/**
 * Pure elapsed-time calculation shared by the hook and tests.
 *
 * Returns 0 before the Start_Tile reveal, the frozen span once stopped, and the
 * live span (clamped at 0) while running.
 */
export function elapsedMs(
  startedAt: number | null,
  stoppedAt: number | null,
  now: number,
): number {
  if (startedAt === null) return 0;
  const end = stoppedAt ?? now;
  return Math.max(0, end - startedAt);
}

/** Format elapsed milliseconds as `M:SS` (minutes never wrap to hours here). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * React hook returning the current elapsed milliseconds for the clock. Ticks on
 * a timer while running and recomputes immediately when the tab regains
 * visibility, so the displayed time is accurate after the tab was hidden.
 */
export function useGameClock(options: GameClockOptions): number {
  const { startedAt, stoppedAt, now = Date.now, intervalMs = 250 } = options;
  const [value, setValue] = useState(() => elapsedMs(startedAt, stoppedAt, now()));
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    const recompute = () => setValue(elapsedMs(startedAt, stoppedAt, nowRef.current()));
    recompute();

    // Once stopped, no timer is needed; the frozen value stays put.
    if (startedAt === null || stoppedAt !== null) return;

    const id = setInterval(recompute, intervalMs);
    const onVisible = () => recompute();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [startedAt, stoppedAt, intervalMs]);

  return value;
}
