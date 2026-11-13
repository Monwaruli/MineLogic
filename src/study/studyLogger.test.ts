import { describe, it, expect } from 'vitest';
import { METRICS_VERSION, type GameMetrics } from '../engine/metrics';
import type { PatternType } from '../engine/patterns';
import type { SyncWrite } from '../storage/syncQueue';
import {
  StudyLogger,
  isoTimestamp,
  buildRecordWrite,
  makeStudyDeliver,
  type StudyLoggerDeps,
  type StudyRecordRow,
  type LoggedGame,
} from './studyLogger';
import type { SupabaseLike } from './studyService';

/** A deps stub that captures every enqueued write and uses a fixed clock. */
function captureDeps(nowIso = '2025-01-02T03:04:05.678Z'): {
  deps: StudyLoggerDeps;
  writes: Array<Omit<SyncWrite, 'attempts'> & { attempts?: number }>;
} {
  const writes: Array<Omit<SyncWrite, 'attempts'> & { attempts?: number }> = [];
  const deps: StudyLoggerDeps = {
    enqueue: (w) => writes.push(w),
    now: () => new Date(nowIso),
  };
  return { deps, writes };
}

function fakeMetrics(over: Partial<GameMetrics> = {}): GameMetrics {
  const patternSpeed = {} as Record<PatternType, { medianSeconds: number | null; counts: { resolved: number; excluded: number; superseded: number; unresolved: number } }>;
  return {
    metricsVersion: METRICS_VERSION,
    boardId: 'b1',
    logicalMoveRate: 100,
    logicalMoves: 5,
    countedReveals: 5,
    guesses: 0,
    wrongFlags: 0,
    totalClicks: 6,
    threeBV: 5,
    chordingEfficiency: 1.2,
    clickCounts: { revealClicks: 5, flagToggles: 0, chordClicks: 1, wastedClicks: 0 },
    partial: false,
    excludedForInexact: 0,
    outcome: 'won',
    patternSpeed,
    ...over,
  } as GameMetrics;
}

function game(over: Partial<LoggedGame> = {}): LoggedGame {
  return {
    phase: 'Pre_Test',
    tier: 'Beginner',
    outcome: 'won',
    elapsedMs: 12345,
    metrics: fakeMetrics(),
    boardId: 'b1',
    moveLog: 'movelog 1\nboard b1\n',
    ...over,
  };
}

describe('isoTimestamp (Requirement 25.9)', () => {
  it('is ISO 8601 UTC with millisecond precision', () => {
    const stamp = isoTimestamp(() => new Date('2025-01-02T03:04:05.678Z'));
    expect(stamp).toBe('2025-01-02T03:04:05.678Z');
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('logTestGame (Requirement 25.1, 25.9, 25.10)', () => {
  it('enqueues a study_records write with the full 25.1 field set and a UTC ms timestamp', () => {
    const { deps, writes } = captureDeps();
    new StudyLogger('p1', deps).logTestGame(game());
    expect(writes).toHaveLength(1);
    const w = writes[0]!;
    expect(w.table).toBe('study_records');
    const row = w.row as unknown as StudyRecordRow;
    expect(row.participant_id).toBe('p1');
    expect(row.kind).toBe('game');
    const p = row.payload;
    expect(p.phase).toBe('Pre_Test');
    expect(p.difficulty).toBe('Beginner');
    expect(p.boardId).toBe('b1');
    expect(p.outcome).toBe('won');
    expect(p.elapsedMs).toBe(12345);
    expect(p.metrics).toBeTruthy();
    expect(p.metricsVersion).toBe(METRICS_VERSION);
    expect(p.moveLog).toContain('movelog 1');
    expect(p.loggedAt).toBe('2025-01-02T03:04:05.678Z');
  });

  it('uses a STABLE id so re-logging the same game does not duplicate (idempotent, 25.10)', () => {
    const { deps, writes } = captureDeps();
    const logger = new StudyLogger('p1', deps);
    logger.logTestGame(game());
    logger.logTestGame(game());
    expect(writes).toHaveLength(2);
    expect(writes[0]!.id).toBe(writes[1]!.id);
  });

  it('distinguishes pre and post games by id and step', () => {
    const { deps, writes } = captureDeps();
    const logger = new StudyLogger('p1', deps);
    logger.logTestGame(game({ phase: 'Pre_Test' }));
    logger.logTestGame(game({ phase: 'Post_Test' }));
    expect(writes[0]!.id).not.toBe(writes[1]!.id);
    expect((writes[0]!.row as unknown as StudyRecordRow).step).toBe('Pre_Test');
    expect((writes[1]!.row as unknown as StudyRecordRow).step).toBe('Post_Test');
  });

  it('never includes email, name, IP, or account fields (Requirement 25.8)', () => {
    const { deps, writes } = captureDeps();
    new StudyLogger('p1', deps).logTestGame(game());
    const serialized = JSON.stringify(writes[0]);
    for (const banned of ['email', 'ipAddress', 'ip_address', 'accountId', 'account_id', 'displayName']) {
      expect(serialized.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe('logBackground (Requirement 25.7)', () => {
  it('stores background answers and the group', () => {
    const { deps, writes } = captureDeps();
    new StudyLogger('p1', deps).logBackground({ experience: 'casual', goal: 'speed' }, 'Group_A');
    const row = writes[0]!.row as unknown as StudyRecordRow;
    expect(row.step).toBe('Background_Questions');
    expect(row.kind).toBe('background');
    expect(row.payload.answers).toEqual({ experience: 'casual', goal: 'speed' });
    expect(row.payload.group).toBe('Group_A');
  });
});

describe('logSurvey (Requirement 24.6)', () => {
  it('stores every answer, unanswered ratings as blank', () => {
    const { deps, writes } = captureDeps();
    new StudyLogger('p1', deps).logSurvey({
      ratings: [5, null, 3, null, 1, 2, null],
      openEnded: ['great', '', 'more boards'],
      demographics: '',
    });
    const row = writes[0]!.row as unknown as StudyRecordRow;
    expect(row.step).toBe('Survey_Form');
    expect(row.kind).toBe('survey');
    // null ratings become '' (blank) so "unanswered" is explicit (24.6).
    expect(row.payload.ratings).toEqual([5, '', 3, '', 1, 2, '']);
    expect(row.payload.openEnded).toEqual(['great', '', 'more boards']);
    expect(row.payload.demographics).toBe('');
  });
});

describe('buildRecordWrite', () => {
  it('folds loggedAt into the payload and builds a stable id from participant+kind+event', () => {
    const w = buildRecordWrite('p1', 'Survey_Form', 'survey', 'answers', { a: 1 }, 'TS');
    expect(w.id).toBe('study:p1:survey:answers');
    const row = w.row as unknown as StudyRecordRow;
    expect(row.payload).toEqual({ a: 1, loggedAt: 'TS' });
  });
});

describe('makeStudyDeliver (Requirement 25.10)', () => {
  it('delivers a study_records write by calling insert_study_record and returns ok on success', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client: SupabaseLike = {
      async rpc(fn, args) {
        calls.push({ fn, args });
        return { data: 'rec-1', error: null };
      },
    };
    const deliver = makeStudyDeliver(client);
    const write = buildRecordWrite('p1', 'Pre_Test', 'game', 'b1', { x: 1 }, 'TS');
    const result = await deliver({ ...write, attempts: 0 });
    expect(result.ok).toBe(true);
    expect(calls[0]!.fn).toBe('insert_study_record');
    expect(calls[0]!.args.p_participant_id).toBe('p1');
    expect(calls[0]!.args.p_kind).toBe('game');
  });

  it('reports failure when the RPC errors (so the queue retries, 25.10)', async () => {
    const client: SupabaseLike = {
      async rpc() {
        return { data: null, error: { message: 'no consent' } };
      },
    };
    const deliver = makeStudyDeliver(client);
    const write = buildRecordWrite('p1', 'Pre_Test', 'game', 'b1', {}, 'TS');
    const result = await deliver({ ...write, attempts: 0 });
    expect(result.ok).toBe(false);
  });

  it('refuses a non-study write', async () => {
    const deliver = makeStudyDeliver();
    const result = await deliver({
      id: 'x',
      table: 'progress',
      row: {},
      onConflict: 'id',
      attempts: 0,
    });
    expect(result.ok).toBe(false);
  });
});
