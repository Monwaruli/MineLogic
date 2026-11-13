import { describe, it, expect } from 'vitest';
import {
  loadPracticeCompletions,
  savePracticeCompletion,
  hasCompletedPractice,
  type PracticeCompletionRecord,
  type StorageLike,
} from './practiceStorage';

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const rec = (over: Partial<PracticeCompletionRecord> = {}): PracticeCompletionRecord => ({
  difficulty: 'Beginner',
  boardId: 'b1',
  interceptedCount: 2,
  stage2Count: 1,
  finishedAt: 1000,
  ...over,
});

describe('practiceStorage', () => {
  it('reads an empty list from a fresh store', () => {
    expect(loadPracticeCompletions(memoryStorage())).toEqual([]);
  });

  it('appends and reads back completions', () => {
    const store = memoryStorage();
    savePracticeCompletion(rec(), store);
    savePracticeCompletion(rec({ boardId: 'b2', difficulty: 'Expert' }), store);
    const all = loadPracticeCompletions(store);
    expect(all).toHaveLength(2);
    expect(all[0]!.boardId).toBe('b1');
    expect(all[1]!.difficulty).toBe('Expert');
  });

  it('hasCompletedPractice reflects stored difficulties', () => {
    const store = memoryStorage();
    expect(hasCompletedPractice('Beginner', store)).toBe(false);
    savePracticeCompletion(rec(), store);
    expect(hasCompletedPractice('Beginner', store)).toBe(true);
    expect(hasCompletedPractice('Expert', store)).toBe(false);
  });

  it('never throws on a corrupt store and reads as empty', () => {
    const store = memoryStorage({ 'minelogic.practice.v1': '{not json' });
    expect(loadPracticeCompletions(store)).toEqual([]);
  });

  it('filters out malformed records', () => {
    const store = memoryStorage({
      'minelogic.practice.v1': JSON.stringify([
        rec(),
        { difficulty: 'Beginner' }, // missing fields
        null,
      ]),
    });
    expect(loadPracticeCompletions(store)).toHaveLength(1);
  });
});
