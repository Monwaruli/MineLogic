import { describe, it, expect } from 'vitest';
import {
  STUDY_SESSION_KEY,
  clearStudySession,
  loadStudySession,
  markStepComplete,
  saveStudySession,
  type StorageLike,
} from './studySessionStorage';

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('local Study_Session pointer (Requirement 21.9)', () => {
  it('returns null when this browser has no session for the code', () => {
    const storage = memoryStorage();
    expect(loadStudySession('STUDY1', storage)).toBeNull();
  });

  it('round-trips a pointer for a Study_Code', () => {
    const storage = memoryStorage();
    saveStudySession(
      { studyCode: 'STUDY1', participantId: 'p-1', resumeCode: 'MLS-ABCD-EFGH', completedSteps: [] },
      1000,
      storage,
    );
    const loaded = loadStudySession('STUDY1', storage);
    expect(loaded?.participantId).toBe('p-1');
    expect(loaded?.resumeCode).toBe('MLS-ABCD-EFGH');
    expect(loaded?.completedSteps).toEqual([]);
    expect(loaded?.updatedAt).toBe(1000);
  });

  it('scopes pointers by Study_Code so studies do not collide', () => {
    const storage = memoryStorage();
    saveStudySession(
      { studyCode: 'A', participantId: 'pa', resumeCode: 'MLS-AAAA-AAAA', completedSteps: [] },
      1,
      storage,
    );
    saveStudySession(
      { studyCode: 'B', participantId: 'pb', resumeCode: 'MLS-BBBB-BBBB', completedSteps: [] },
      2,
      storage,
    );
    expect(loadStudySession('A', storage)?.participantId).toBe('pa');
    expect(loadStudySession('B', storage)?.participantId).toBe('pb');
  });

  it('markStepComplete records completed steps in canonical order', () => {
    const storage = memoryStorage();
    saveStudySession(
      { studyCode: 'S', participantId: 'p', resumeCode: 'MLS-CODE-CODE', completedSteps: [] },
      1,
      storage,
    );
    markStepComplete('S', 'Pre_Test', 2, storage);
    markStepComplete('S', 'Background_Questions', 3, storage);
    expect(loadStudySession('S', storage)?.completedSteps).toEqual([
      'Background_Questions',
      'Pre_Test',
    ]);
  });

  it('markStepComplete is a no-op without a pointer', () => {
    const storage = memoryStorage();
    expect(markStepComplete('missing', 'Pre_Test', 1, storage)).toBeNull();
  });

  it('clearStudySession removes only the given code', () => {
    const storage = memoryStorage();
    saveStudySession(
      { studyCode: 'A', participantId: 'pa', resumeCode: 'MLS-AAAA-AAAA', completedSteps: [] },
      1,
      storage,
    );
    saveStudySession(
      { studyCode: 'B', participantId: 'pb', resumeCode: 'MLS-BBBB-BBBB', completedSteps: [] },
      2,
      storage,
    );
    clearStudySession('A', storage);
    expect(loadStudySession('A', storage)).toBeNull();
    expect(loadStudySession('B', storage)?.participantId).toBe('pb');
  });

  it('reads corrupt or missing storage as no session (never throws)', () => {
    const storage = memoryStorage({ [STUDY_SESSION_KEY]: 'not json' });
    expect(loadStudySession('S', storage)).toBeNull();
  });

  it('drops unknown completed steps when loading', () => {
    const raw = JSON.stringify({
      S: { participantId: 'p', resumeCode: 'MLS-CODE-CODE', completedSteps: ['Pre_Test', 'junk'] },
    });
    const storage = memoryStorage({ [STUDY_SESSION_KEY]: raw });
    expect(loadStudySession('S', storage)?.completedSteps).toEqual(['Pre_Test']);
  });
});
