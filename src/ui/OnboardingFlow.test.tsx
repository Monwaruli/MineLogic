// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import OnboardingFlow from './OnboardingFlow';
import { SKILL_CHECK_SNIPPETS } from '../content/skillCheck';
import { loadOnboarding, type StorageLike } from '../storage/onboardingStorage';

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

/** Find a tile button by its row/col data attributes. */
function tileAt(row: number, col: number): HTMLButtonElement {
  return document.querySelector(
    `button[data-row="${row}"][data-col="${col}"]`,
  ) as HTMLButtonElement;
}

/** Reveal-click a tile (the Skill_Check answer gesture, Requirement 10.3). */
function reveal(row: number, col: number): void {
  fireEvent.mouseDown(tileAt(row, col), { button: 0, buttons: 1 });
}

describe('OnboardingFlow', () => {
  it('asks the two Background_Questions then runs the Skill_Check in tier order (10.1, 10.2)', () => {
    const storage = memoryStorage();
    let completed = false;
    render(
      <OnboardingFlow
        onComplete={() => {
          completed = true;
        }}
        storage={storage}
        now={() => 1}
      />,
    );

    // Q1: prior experience.
    expect(screen.getByText(/how much minesweeper/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Casual player'));

    // Q2: input device.
    expect(screen.getByText(/what are you playing with/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Mouse'));

    // Skill check, Beginner first.
    expect(screen.getByTestId('skillcheck-progress').textContent).toContain('Beginner');

    // Walk all three snippets, answering each with its provably-safe tile.
    for (let i = 0; i < SKILL_CHECK_SNIPPETS.length; i++) {
      const snippet = SKILL_CHECK_SNIPPETS[i];
      expect(screen.getByTestId('skillcheck-progress').textContent).toContain(snippet.tier);
      reveal(snippet.safeTile[0], snippet.safeTile[1]);
      expect(screen.getByTestId('skillcheck-result').textContent).toMatch(/correct/i);
      fireEvent.click(screen.getByTestId('skillcheck-next'));
    }

    expect(completed).toBe(true);
    const rec = loadOnboarding(storage);
    expect(rec!.completed).toBe(true);
    expect(rec!.experience).toBe('casual');
    expect(rec!.inputDevice).toBe('mouse');
    expect(rec!.skillCheck).toEqual({
      Beginner: 'Correct',
      Intermediate: 'Correct',
      Expert: 'Correct',
    });
  });

  it('records a Trap answer with its label (10.4) and shows the explanation (10.5)', () => {
    const storage = memoryStorage();
    render(<OnboardingFlow onComplete={() => {}} storage={storage} now={() => 1} />);
    fireEvent.click(screen.getByText('Regular player'));
    fireEvent.click(screen.getByText('Trackpad'));

    const beginner = SKILL_CHECK_SNIPPETS[0];
    const trap = beginner.traps[0];
    reveal(trap.tile[0], trap.tile[1]);
    expect(screen.getByTestId('skillcheck-result').textContent).toMatch(/trap/i);
    // The explanation text is shown after answering (10.5).
    expect(screen.getByText(beginner.explanation)).toBeTruthy();
  });

  it('only the first Reveal_Click counts as the answer (10.3)', () => {
    const storage = memoryStorage();
    render(<OnboardingFlow onComplete={() => {}} storage={storage} now={() => 1} />);
    fireEvent.click(screen.getByText('New to Minesweeper'));
    fireEvent.click(screen.getByText('Other'));

    const beginner = SKILL_CHECK_SNIPPETS[0];
    // First answer: a trap.
    reveal(beginner.traps[0].tile[0], beginner.traps[0].tile[1]);
    const first = screen.getByTestId('skillcheck-result').textContent;
    expect(first).toMatch(/trap/i);
    // A later click on the safe tile must not change the recorded answer.
    reveal(beginner.safeTile[0], beginner.safeTile[1]);
    expect(screen.getByTestId('skillcheck-result').textContent).toBe(first);
  });

  it('Skip ends the flow and leaves no Skill_Check results (10.7)', () => {
    const storage = memoryStorage();
    let completed = false;
    render(
      <OnboardingFlow
        onComplete={() => {
          completed = true;
        }}
        storage={storage}
        now={() => 1}
      />,
    );
    fireEvent.click(screen.getByText('Skip'));
    expect(completed).toBe(true);
    const rec = loadOnboarding(storage);
    expect(rec!.completed).toBe(true);
    expect(rec!.skipped).toBe(true);
    expect(rec!.skillCheck).toEqual({});
  });
});
