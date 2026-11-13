import { describe, it, expect } from 'vitest';
import {
  mapGestureToAction,
  normalizeButton,
  type PointerButton,
} from './inputMapping';
import type { Tile } from '../engine/board';

const tile: Tile = [2, 3];

describe('normalizeButton', () => {
  it('maps the primary button', () => {
    expect(normalizeButton(0, 1)).toBe('primary');
  });

  it('maps the middle button', () => {
    expect(normalizeButton(1, 4)).toBe('middle');
  });

  it('maps the secondary button', () => {
    expect(normalizeButton(2, 2)).toBe('secondary');
  });

  it('reports both when primary and secondary are held together', () => {
    // button is whichever changed; buttons bitmask has both bits set.
    expect(normalizeButton(0, 3)).toBe('both');
    expect(normalizeButton(2, 3)).toBe('both');
  });
});

describe('mapGestureToAction on a covered tile', () => {
  const ctx = { revealed: false };

  it('primary reveals', () => {
    expect(mapGestureToAction('primary', tile, ctx)).toEqual({
      type: 'Reveal_Click',
      tile,
    });
  });

  it('secondary flags', () => {
    expect(mapGestureToAction('secondary', tile, ctx)).toEqual({
      type: 'Flag_Toggle',
      tile,
    });
  });

  it('middle and both do nothing on a covered tile', () => {
    expect(mapGestureToAction('middle', tile, ctx)).toBeNull();
    expect(mapGestureToAction('both', tile, ctx)).toBeNull();
  });
});

describe('mapGestureToAction on a revealed number', () => {
  const ctx = { revealed: true };

  it('primary chords', () => {
    expect(mapGestureToAction('primary', tile, ctx)).toEqual({
      type: 'Chord_Click',
      tile,
    });
  });

  it('middle chords', () => {
    expect(mapGestureToAction('middle', tile, ctx)).toEqual({
      type: 'Chord_Click',
      tile,
    });
  });

  it('both (primary+secondary) chords', () => {
    expect(mapGestureToAction('both', tile, ctx)).toEqual({
      type: 'Chord_Click',
      tile,
    });
  });

  it('secondary does nothing on a revealed tile', () => {
    expect(mapGestureToAction('secondary', tile, ctx)).toBeNull();
  });
});

describe('every PointerButton has a defined mapping', () => {
  const buttons: PointerButton[] = ['primary', 'secondary', 'middle', 'both', 'other'];
  it('never throws for any button in either tile state', () => {
    for (const b of buttons) {
      expect(() => mapGestureToAction(b, tile, { revealed: false })).not.toThrow();
      expect(() => mapGestureToAction(b, tile, { revealed: true })).not.toThrow();
    }
  });
});
