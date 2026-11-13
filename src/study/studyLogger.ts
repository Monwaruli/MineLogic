/**
 * Study_Logger (task 9.3, Requirement 24.6, 25).
 *
 * The one place a Study_Record is built and sent to the Backend. Every record
 * goes THROUGH the Sync_Queue (Requirement 25.10): the logger enqueues a write
 * targeting the 'study_records' table with a STABLE id, so a failed Backend
 * write is retried idempotently and re-logging the same event never stores a
 * duplicate (the queue de-dupes by id at enqueue time, and the Sync_Queue's
 * own idempotence covers re-delivery).
 *
 * A 'study_records' write is NOT a plain table upsert — a Study_Record is
 * written through the `insert_study_record` RPC (which enforces the 21.6
 * consent-required rule). So the logger pairs with a study-specific deliver
 * function (makeStudyDeliver) that calls insertRecord; the queue stays
 * delivery-agnostic (see src/storage/syncQueue.ts). Callers flush the queue
 * with that deliver function.
 *
 * Anonymity (Requirement 25.8): a Study_Record carries ONLY the Participant_ID,
 * the step/phase, a kind, the payload, and a timestamp. The logger never puts
 * an email, name, IP address, or Account identifier anywhere — the payload
 * builders below take only study data. Requirement 25.9: every record is
 * timestamped in ISO 8601 UTC with millisecond precision via
 * `new Date().toISOString()`, which always renders UTC ("Z") with milliseconds.
 *
 * The enqueue function and the clock are injected so the logger is unit-testable
 * without a live DB or real timers (matching the study service / storage style).
 */

import { METRICS_VERSION, type GameMetrics } from '../engine/metrics';
import { serializeMoveLog, type MoveLog } from '../engine/moveLog';
import type { Tier } from '../content/lessons';
import type { StudyStep } from './steps';
import { enqueue as enqueueWrite, type SyncWrite, type StorageLike } from '../storage/syncQueue';
import { insertRecord, type StudyGroup, type SupabaseLike } from './studyService';

/** The study-layer game phases a test/retention game can belong to (25.1). */
export type StudyGamePhase = 'Pre_Test' | 'Post_Test' | 'Retention_Window';

/** The outcome tokens a logged game can carry (mirrors StudyGameOutcome). */
export type LoggedOutcome = 'won' | 'lost' | 'Timed_Out' | 'Interrupted';

/**
 * The shape of a finished test/retention game the logger records. This matches
 * the TestGameResult the StudyTestGameScreen produces, plus the serialized
 * Move_Log threaded through so 25.1 can store it. Difficulty comes from the
 * game's Tier.
 */
export interface LoggedGame {
  phase: StudyGamePhase;
  tier: Tier;
  outcome: LoggedOutcome;
  elapsedMs: number;
  metrics: GameMetrics;
  boardId: string;
  /** The serialized Move_Log text (25.1). */
  moveLog: string;
  /** For Retention_Window games, the Sweep_Day (ISO date), else omitted (24.8). */
  sweepDay?: string;
}

/** One answer to a Background_Question (25.7). */
export interface BackgroundAnswers {
  [questionId: string]: string;
}

/**
 * The structured survey answers (24.6): the seven rating items (1–5, or null
 * when unanswered), the three open-ended prompts (blank when unanswered), and
 * the one demographics item (blank when unanswered). Stored verbatim including
 * blanks so "unanswered" is recorded as blank (24.6).
 */
export interface SurveyAnswers {
  /** Seven 5-point ratings; null for an unanswered item (stored as blank). */
  ratings: Array<number | null>;
  /** Three open-ended answers; '' for an unanswered prompt. */
  openEnded: string[];
  /** One demographics answer; '' when unanswered. */
  demographics: string;
}

/**
 * The injectable surface the logger needs. `enqueue` adds a write to the
 * Sync_Queue (25.10); `now` supplies the clock (25.9). Defaults wire the real
 * Sync_Queue enqueue and Date.now.
 */
export interface StudyLoggerDeps {
  enqueue: (write: Omit<SyncWrite, 'attempts'> & { attempts?: number }) => void;
  now: () => Date;
}

/** Build the default deps: enqueue into the real Sync_Queue, clock = Date. */
export function defaultLoggerDeps(storage?: StorageLike): StudyLoggerDeps {
  return {
    enqueue: (write) => {
      enqueueWrite(write, storage);
    },
    now: () => new Date(),
  };
}

/**
 * The payload of a 'study_records' Sync_Queue write. The queue's `row` carries
 * everything `insert_study_record` needs (participant_id, step, kind, payload)
 * plus the loggedAt timestamp folded into the payload so it survives through the
 * queue and into the Backend.
 */
export interface StudyRecordRow {
  participant_id: string;
  step: StudyStep;
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * The ISO 8601 UTC millisecond timestamp for a record (25.9). `Date.toISOString`
 * always yields UTC with exactly millisecond precision, e.g.
 * "2025-01-02T03:04:05.678Z".
 */
export function isoTimestamp(now: () => Date): string {
  return now().toISOString();
}

/**
 * Build a Study_Record Sync_Queue write. The id is STABLE and derived from the
 * Participant_ID + kind + a caller-supplied event key, so re-logging the same
 * event (e.g. after a reload) replaces rather than duplicates it (25.10 + the
 * queue's idempotence). The loggedAt timestamp (25.9) is folded into the
 * payload so it reaches the Backend through the queue.
 */
export function buildRecordWrite(
  participantId: string,
  step: StudyStep,
  kind: string,
  eventKey: string,
  payload: Record<string, unknown>,
  loggedAt: string,
): Omit<SyncWrite, 'attempts'> {
  const row: StudyRecordRow = {
    participant_id: participantId,
    step,
    kind,
    payload: { ...payload, loggedAt },
  };
  return {
    id: `study:${participantId}:${kind}:${eventKey}`,
    table: 'study_records',
    row: row as unknown as Record<string, unknown>,
    // study_records are RPC-inserted, not upserted; onConflict is unused by the
    // study deliver path but kept non-empty for the SyncWrite shape.
    onConflict: 'id',
  };
}

/**
 * The Study_Logger: a small object bound to a Participant_ID whose methods build
 * and enqueue Study_Records. All writes go through the Sync_Queue (25.10).
 */
export class StudyLogger {
  constructor(
    private readonly participantId: string,
    private readonly deps: StudyLoggerDeps,
  ) {}

  /** Enqueue one record through the Sync_Queue with an ISO-UTC-ms stamp (25.9/25.10). */
  private record(
    step: StudyStep,
    kind: string,
    eventKey: string,
    payload: Record<string, unknown>,
  ): void {
    const loggedAt = isoTimestamp(this.deps.now);
    this.deps.enqueue(
      buildRecordWrite(this.participantId, step, kind, eventKey, payload, loggedAt),
    );
  }

  /**
   * Log a finished Pre_Test / Post_Test / Retention_Window game (25.1): store
   * phase, Difficulty, Board identifier, outcome, elapsed ms, Game_Metrics,
   * Metrics_Version, and the serialized Move_Log. No PII (25.8). The event key
   * is the board id, so the same board's result is logged once per board.
   */
  logTestGame(game: LoggedGame): void {
    const step: StudyStep = game.phase === 'Post_Test' ? 'Post_Test' : 'Pre_Test';
    const payload: Record<string, unknown> = {
      phase: game.phase,
      difficulty: game.tier,
      boardId: game.boardId,
      outcome: game.outcome,
      elapsedMs: game.elapsedMs,
      metrics: game.metrics,
      metricsVersion: game.metrics.metricsVersion ?? METRICS_VERSION,
      moveLog: game.moveLog,
    };
    if (game.sweepDay) payload.sweepDay = game.sweepDay;
    // Retention_Window games log under the Post_Test step (its records follow
    // the Post_Test in the fixed step domain) but carry phase=Retention_Window.
    const eventKey = game.sweepDay ? `${game.boardId}:${game.sweepDay}` : game.boardId;
    this.record(step, 'game', `${game.phase}:${eventKey}`, payload);
  }

  /**
   * Log the Participant's Background_Question answers and assigned group (25.7).
   * Group may be null when logged before the Intermediate block assigns it.
   */
  logBackground(answers: BackgroundAnswers, group: StudyGroup | null): void {
    this.record('Background_Questions', 'background', 'answers', {
      answers,
      group,
    });
  }

  /**
   * Log the submitted Survey_Form (24.6): every answer including unanswered
   * items stored as blank, with the Participant_ID (which is on every record).
   */
  logSurvey(answers: SurveyAnswers): void {
    this.record('Survey_Form', 'survey', 'answers', {
      // Unanswered ratings are stored as blank ('') so "blank" is explicit in
      // the exported CSV, while answered ones keep their numeric value (24.6).
      ratings: answers.ratings.map((r) => (r === null ? '' : r)),
      openEnded: answers.openEnded,
      demographics: answers.demographics,
    });
  }

  /**
   * Log a Learning_Phase step's start/end times (25.3). Thin hook: the call site
   * supplies the step name and the ISO times it observed. Left available for the
   * learning components to wire; a minimal call records what they expose.
   */
  logLearningStep(stepName: string, startedAt: string, endedAt: string): void {
    this.record('Learning_Phase', 'learning_event', stepName, {
      learningStep: stepName,
      startedAt,
      endedAt,
    });
  }

  /**
   * Log a Video_Panel event (25.6): play/pause/seek/ended with positions and the
   * running count of distinct seconds watched. Thin hook for the Video_Panel.
   */
  logVideoEvent(
    eventKey: string,
    event: 'play' | 'pause' | 'seek' | 'ended',
    positionSeconds: number,
    distinctSecondsWatched: number,
  ): void {
    this.record('Learning_Phase', 'video_event', `${eventKey}:${event}`, {
      event,
      positionSeconds,
      distinctSecondsWatched,
    });
  }
}

/** Convenience: a Study_Logger wired to the real Sync_Queue + Date clock. */
export function createStudyLogger(
  participantId: string,
  storage?: StorageLike,
): StudyLogger {
  return new StudyLogger(participantId, defaultLoggerDeps(storage));
}

/**
 * Build a DeliverFn for the Sync_Queue that knows how to deliver a
 * 'study_records' write: it calls the `insert_study_record` RPC via the study
 * service. Non-study writes are rejected here (they are handled by the normal
 * progress/game/sweep deliver path), so callers pair THIS deliver with a
 * study-only flush, or compose it with the account deliver in a dispatcher.
 *
 * Idempotence (25.10): the stable write id de-dupes at the queue; the Backend
 * insert is append-only per unique event because the queue only delivers a
 * given id while it is pending, and removes it on success.
 */
export function makeStudyDeliver(client?: SupabaseLike) {
  return async (write: SyncWrite): Promise<{ ok: boolean; error?: string }> => {
    if (write.table !== 'study_records') {
      return { ok: false, error: `studyDeliver cannot deliver table ${write.table}` };
    }
    const row = write.row as unknown as StudyRecordRow;
    const ok = await insertRecord(
      row.participant_id,
      row.step,
      row.kind,
      row.payload,
      client,
    );
    return ok ? { ok: true } : { ok: false, error: 'insert_study_record failed' };
  };
}

/**
 * Serialize a Move_Log to text for logging (25.1). Re-exported so the test
 * screen / session can thread the serialized log into logTestGame without
 * importing the engine directly.
 */
export function serializeLogForStudy(log: MoveLog): string {
  return serializeMoveLog(log);
}
