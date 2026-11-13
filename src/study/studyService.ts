/**
 * Study_Module Backend client (task 9.1, Requirement 21).
 *
 * This is the client side of the anonymous study identity flow. Participants
 * hold NO Supabase auth session (21.7), so every operation goes through a
 * SECURITY DEFINER database function the anon role may execute (see
 * supabase/migrations/20240104000000_study_module.sql). This module wraps those
 * RPCs:
 *
 *   - getActiveConfig(code): the ACTIVE Study_Config for a Study_Code, or null
 *     when none matches (21.1, 21.2). Also reports whether the config is
 *     complete enough to start — i.e. it has all required Evaluation_Boards and
 *     the Intermediate Video_Source (21.3; the deep Content_Validator rules of
 *     22.5/22.6 are task 9.2).
 *   - createParticipant(configId, consentVersion): create an anonymous
 *     Participant + consent row and return its Participant_ID and Resume_Code
 *     (21.4, 21.7, 21.8).
 *   - resumeByCode(code): restore a Participant identity from a Resume_Code
 *     (21.10).
 *   - withdraw(participantId): delete every Study_Record for the Participant
 *     (21.12) and report the count so the UI can confirm (21.13).
 *   - insertRecord(...): the 21.6 consent-required insert; defined here for
 *     task 9.3 but exercised now so the acceptance rule has a client entry.
 *
 * The Supabase client is injected (defaulting to getSupabaseClient) so tests
 * pass a lightweight fake, matching leaderboardService.ts.
 */

import { getSupabaseClient } from '../storage/supabaseClient';
import type { StudyStep } from './steps';

/** The raw study_config row returned by get_active_config_by_code. */
export interface StudyConfigRow {
  id: string;
  study_code: string;
  consent_text: string;
  consent_version: string;
  consent_statements: string[];
  includes_expert: boolean;
  pre_beginner: string | null;
  pre_intermediate: string | null;
  post_beginner: string | null;
  post_intermediate: string | null;
  post_expert: string | null;
  intermediate_video_source: string | null;
  /** Survey item text (task 9.3, Requirement 24.2); JSON arrays of strings. */
  survey_rating_items?: unknown;
  survey_open_prompts?: unknown;
  survey_demographics_item?: string | null;
}

/** The shaped Study_Config the consent screen consumes. */
export interface StudyConfig {
  id: string;
  studyCode: string;
  consentText: string;
  consentVersion: string;
  consentStatements: string[];
  includesExpert: boolean;
  preBeginner: string | null;
  preIntermediate: string | null;
  postBeginner: string | null;
  postIntermediate: string | null;
  postExpert: string | null;
  intermediateVideoSource: string | null;
  /**
   * The Survey_Form item text, read from the Study_Config (Requirement 24.2):
   * seven rating items, three open-ended prompts, one demographics item. When a
   * config omits them, the client falls back to a default English wording so the
   * survey still renders the correct SHAPE (seven/three/one); the Backend
   * columns let a study override the text.
   */
  surveyRatingItems: string[];
  surveyOpenPrompts: string[];
  surveyDemographicsItem: string;
}

/** An anonymous study identity (21.7). */
export interface Participant {
  participantId: string;
  resumeCode: string;
  /** Assigned learning group, or null before the Intermediate block (23.3). */
  studyGroup: string | null;
}

/**
 * The slice of the Supabase client this module uses, declared structurally so
 * tests can pass a small fake. All study operations are RPC calls to the
 * SECURITY DEFINER functions; `rpc` returns either rows (table functions) or a
 * scalar (withdraw/insert).
 */
export interface SupabaseLike {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/** Resolve the client: the injected one, else the shared client. */
function resolveClient(client?: SupabaseLike): SupabaseLike {
  return client ?? (getSupabaseClient() as unknown as SupabaseLike);
}

/**
 * Default Survey_Form text (Requirement 24.1/24.2). A Study_Config may override
 * these via its survey_* columns; when it does not, the client uses these so
 * the survey renders the required SHAPE: seven rating items, three open-ended
 * prompts, one demographics item. The rating items are 5-point agree/disagree
 * statements (labeled 1..5 by the form, 24.3).
 */
export const DEFAULT_SURVEY_RATING_ITEMS: readonly string[] = [
  'The lessons explained Minesweeper logic clearly.',
  'The pace of the lessons felt right.',
  'The practice mode helped me apply what I learned.',
  'The hints appeared when I needed them.',
  'I feel more confident solving boards by logic.',
  'I was motivated to keep playing.',
  'I would recommend MineLogic to a friend.',
];

export const DEFAULT_SURVEY_OPEN_PROMPTS: readonly string[] = [
  'What did you find most helpful?',
  'What was confusing or frustrating?',
  'What would you change about MineLogic?',
];

export const DEFAULT_SURVEY_DEMOGRAPHICS_ITEM =
  'Optionally, tell us a little about your background (age range, prior Minesweeper experience).';

/** Coerce an unknown config value into a string[] of the expected length. */
function toStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.filter((v): v is string => typeof v === 'string');
    if (items.length === fallback.length) return items;
  }
  return [...fallback];
}

/** Shape a raw config row into the client StudyConfig. */
function toConfig(row: StudyConfigRow): StudyConfig {
  return {
    id: row.id,
    studyCode: row.study_code,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
    consentStatements: Array.isArray(row.consent_statements) ? row.consent_statements : [],
    includesExpert: row.includes_expert === true,
    preBeginner: row.pre_beginner,
    preIntermediate: row.pre_intermediate,
    postBeginner: row.post_beginner,
    postIntermediate: row.post_intermediate,
    postExpert: row.post_expert,
    intermediateVideoSource: row.intermediate_video_source,
    surveyRatingItems: toStringArray(row.survey_rating_items, DEFAULT_SURVEY_RATING_ITEMS),
    surveyOpenPrompts: toStringArray(row.survey_open_prompts, DEFAULT_SURVEY_OPEN_PROMPTS),
    surveyDemographicsItem:
      typeof row.survey_demographics_item === 'string' && row.survey_demographics_item.length > 0
        ? row.survey_demographics_item
        : DEFAULT_SURVEY_DEMOGRAPHICS_ITEM,
  };
}

/**
 * The required pieces for a config to start new Study_Sessions (21.3): the four
 * always-required Evaluation_Boards, the Intermediate Video_Source, and — only
 * when the study includes the Expert tier — the Post_Expert board. Returns the
 * list of MISSING piece names (empty when the config is complete). The deep
 * Content_Validator checks (matched dimensions/3BV, no-guess, pattern coverage)
 * are task 9.2; here we only check the required fields are present.
 */
export function missingConfigPieces(config: StudyConfig): string[] {
  const missing: string[] = [];
  if (!config.preBeginner) missing.push('Pre_Beginner');
  if (!config.preIntermediate) missing.push('Pre_Intermediate');
  if (!config.postBeginner) missing.push('Post_Beginner');
  if (!config.postIntermediate) missing.push('Post_Intermediate');
  if (config.includesExpert && !config.postExpert) missing.push('Post_Expert');
  if (!config.intermediateVideoSource) missing.push('Intermediate Video_Source');
  return missing;
}

/** True when the config has every required Evaluation_Board + video (21.3). */
export function isConfigComplete(config: StudyConfig): boolean {
  return missingConfigPieces(config).length === 0;
}

/**
 * Fetch the ACTIVE Study_Config for a Study_Code (21.1), or null when the code
 * matches no active config (21.2). A transport error also yields null so the
 * UI can show the invalid/unavailable message rather than crash.
 */
export async function getActiveConfig(
  studyCode: string,
  client?: SupabaseLike,
): Promise<StudyConfig | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase.rpc('get_active_config_by_code', {
    p_study_code: studyCode,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return toConfig(data[0] as StudyConfigRow);
}

/**
 * Create an anonymous Participant with a Resume_Code and record consent (21.4,
 * 21.7, 21.8). Returns the Participant on success, or null on error so the UI
 * can surface a retry.
 */
export async function createParticipant(
  configId: string,
  consentVersion: string,
  client?: SupabaseLike,
): Promise<Participant | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase.rpc('create_participant', {
    p_config_id: configId,
    p_consent_version: consentVersion,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { participant_id: string; resume_code: string };
  if (!row.participant_id || !row.resume_code) return null;
  return { participantId: row.participant_id, resumeCode: row.resume_code, studyGroup: null };
}

/**
 * Restore a Participant identity from a Resume_Code (21.10). Returns the
 * Participant when the code is valid, or null for an unknown code / error so
 * the resume screen can reject it.
 */
export async function resumeByCode(
  resumeCode: string,
  client?: SupabaseLike,
): Promise<Participant | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase.rpc('get_participant_by_resume_code', {
    p_resume_code: resumeCode,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { participant_id: string; study_group: string | null };
  if (!row.participant_id) return null;
  return { participantId: row.participant_id, resumeCode, studyGroup: row.study_group ?? null };
}

/**
 * Insert a Study_Record for a Participant (21.6). The Backend accepts the insert
 * only when a consent row exists for the Participant_ID; otherwise it errors and
 * nothing is stored. Returns true on success. Defined for task 9.3; exercised
 * here so the consent-required rule has a client entry point.
 */
export async function insertRecord(
  participantId: string,
  step: StudyStep,
  kind: string,
  payload: Record<string, unknown>,
  client?: SupabaseLike,
): Promise<boolean> {
  const supabase = resolveClient(client);
  const { error } = await supabase.rpc('insert_study_record', {
    p_participant_id: participantId,
    p_step: step,
    p_kind: kind,
    p_payload: payload,
  });
  return !error;
}

/** The two learning groups (Requirement 23.3). */
export type StudyGroup = 'Group_A' | 'Group_B';

/**
 * Decide the group for a new assignment from the CURRENT group counts
 * (Requirement 23.3): the smaller group, or a random tie-break when the counts
 * are equal. This mirrors the decision in the `assign_participant_group`
 * database function, extracted here as a pure helper so the balance property
 * (23.4) can be unit/property tested without a database.
 *
 * Because the chosen group is always the smaller one (and a tie is a draw that
 * cannot increase an existing gap), adding to it keeps `|A - B| <= 1` after
 * every assignment, provided the counts start balanced (they start 0/0).
 *
 * `rng` returns a float in [0, 1); defaults to Math.random. Tests pass a
 * deterministic rng to pin the tie-break.
 */
export function decideGroup(
  countA: number,
  countB: number,
  rng: () => number = Math.random,
): StudyGroup {
  if (countA < countB) return 'Group_A';
  if (countB < countA) return 'Group_B';
  return rng() < 0.5 ? 'Group_A' : 'Group_B';
}

/**
 * Assign the Participant to a learning group, or return the existing group when
 * one is already assigned (Requirement 23.3, 23.5). The decision and the write
 * happen atomically in the `assign_participant_group` database function, which
 * keeps Group_A and Group_B balanced to within one even under concurrent
 * requests (23.4). Returns the assigned group, or null on error.
 */
export async function assignGroup(
  participantId: string,
  client?: SupabaseLike,
): Promise<StudyGroup | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase.rpc('assign_participant_group', {
    p_participant_id: participantId,
  });
  if (error) return null;
  return data === 'Group_A' || data === 'Group_B' ? data : null;
}

/**
 * Withdraw a Participant: delete every Study_Record with that Participant_ID
 * (21.12). Returns the number of records deleted on success (so the UI can
 * confirm, 21.13), or null on error. A successful withdrawal with no stored
 * records returns 0, which is still a completed withdrawal.
 */
export async function withdraw(
  participantId: string,
  client?: SupabaseLike,
): Promise<number | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase.rpc('withdraw_participant', {
    p_participant_id: participantId,
  });
  if (error) return null;
  return typeof data === 'number' ? data : 0;
}
