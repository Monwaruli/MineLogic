import { describe, it, expect } from 'vitest';
import {
  loadOnboarding,
  saveOnboarding,
  saveOnboardingComplete,
  saveOnboardingSkipped,
  hasOnboarded,
  ONBOARDING_KEY,
  type OnboardingRecord,
  type StorageLike,
} from './onboardingStorage';

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('onboardingStorage', () => {
  it('reads null and not-onboarded from a fresh store', () => {
    const store = memoryStorage();
    expect(loadOnboarding(store)).toBeNull();
    expect(hasOnboarded(store)).toBe(false);
  });

  it('persists a completed onboarding with answers and skill-check results (10.6)', () => {
    const store = memoryStorage();
    saveOnboardingComplete(
      'casual',
      'trackpad',
      { Beginner: 'Correct', Intermediate: 'Trap', Expert: 'Other' },
      1234,
      store,
    );
    const rec = loadOnboarding(store);
    expect(rec).not.toBeNull();
    expect(rec!.completed).toBe(true);
    expect(rec!.skipped).toBe(false);
    expect(rec!.experience).toBe('casual');
    expect(rec!.inputDevice).toBe('trackpad');
    expect(rec!.skillCheck).toEqual({
      Beginner: 'Correct',
      Intermediate: 'Trap',
      Expert: 'Other',
    });
    expect(rec!.updatedAt).toBe(1234);
    expect(hasOnboarded(store)).toBe(true);
  });

  it('persists a skipped onboarding with no skill-check results (10.7)', () => {
    const store = memoryStorage();
    saveOnboardingSkipped('new', 'mouse', 5, store);
    const rec = loadOnboarding(store);
    expect(rec!.completed).toBe(true);
    expect(rec!.skipped).toBe(true);
    expect(rec!.skillCheck).toEqual({});
    expect(hasOnboarded(store)).toBe(true);
  });

  it('round-trips an explicit record', () => {
    const store = memoryStorage();
    const record: OnboardingRecord = {
      completed: true,
      skipped: false,
      experience: 'regular',
      inputDevice: 'other',
      skillCheck: { Expert: 'Correct' },
      updatedAt: 42,
    };
    saveOnboarding(record, store);
    expect(loadOnboarding(store)).toEqual(record);
  });

  it('drops unknown answer values on read (corrupt store)', () => {
    const store = memoryStorage({
      [ONBOARDING_KEY]: JSON.stringify({
        completed: true,
        skipped: false,
        experience: 'bogus',
        inputDevice: 'joystick',
        skillCheck: { Beginner: 'Maybe', Expert: 'Correct' },
        updatedAt: 7,
      }),
    });
    const rec = loadOnboarding(store);
    expect(rec!.experience).toBeNull();
    expect(rec!.inputDevice).toBeNull();
    expect(rec!.skillCheck).toEqual({ Expert: 'Correct' });
  });

  it('reads null from corrupt JSON', () => {
    const store = memoryStorage({ [ONBOARDING_KEY]: 'not json{' });
    expect(loadOnboarding(store)).toBeNull();
  });
});
