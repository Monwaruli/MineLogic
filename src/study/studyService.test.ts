import { describe, it, expect } from 'vitest';
import {
  createParticipant,
  getActiveConfig,
  insertRecord,
  isConfigComplete,
  missingConfigPieces,
  resumeByCode,
  withdraw,
  type StudyConfig,
  type StudyConfigRow,
  type SupabaseLike,
} from './studyService';

/** A fake Supabase that records rpc calls and returns scripted results. */
function fakeSupabase(
  handler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null },
): { client: SupabaseLike; calls: { fn: string; args: Record<string, unknown> }[] } {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: SupabaseLike = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      return handler(fn, args);
    },
  };
  return { client, calls };
}

function configRow(overrides: Partial<StudyConfigRow> = {}): StudyConfigRow {
  return {
    id: 'cfg-1',
    study_code: 'SPRING2025',
    consent_text: 'Please read and consent.',
    consent_version: 'v1',
    consent_statements: ['I am 18 or older', 'I agree to take part'],
    includes_expert: false,
    pre_beginner: 'board-pb',
    pre_intermediate: 'board-pi',
    post_beginner: 'board-ob',
    post_intermediate: 'board-oi',
    post_expert: null,
    intermediate_video_source: 'https://example.com/video.mp4',
    ...overrides,
  };
}

function fullConfig(overrides: Partial<StudyConfig> = {}): StudyConfig {
  return {
    id: 'cfg-1',
    studyCode: 'SPRING2025',
    consentText: 'text',
    consentVersion: 'v1',
    consentStatements: ['a'],
    includesExpert: false,
    preBeginner: 'pb',
    preIntermediate: 'pi',
    postBeginner: 'ob',
    postIntermediate: 'oi',
    postExpert: null,
    intermediateVideoSource: 'https://v',
    surveyRatingItems: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
    surveyOpenPrompts: ['o1', 'o2', 'o3'],
    surveyDemographicsItem: 'demo',
    ...overrides,
  };
}

describe('getActiveConfig (21.1, 21.2)', () => {
  it('returns the shaped config when an active one matches (21.1)', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [configRow()], error: null }));
    const cfg = await getActiveConfig('SPRING2025', client);
    expect(cfg?.studyCode).toBe('SPRING2025');
    expect(cfg?.consentStatements).toEqual(['I am 18 or older', 'I agree to take part']);
    expect(calls[0]).toEqual({
      fn: 'get_active_config_by_code',
      args: { p_study_code: 'SPRING2025' },
    });
  });

  it('returns null when no active config matches (21.2)', async () => {
    const { client } = fakeSupabase(() => ({ data: [], error: null }));
    expect(await getActiveConfig('UNKNOWN', client)).toBeNull();
  });

  it('returns null on a transport error', async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: { message: 'boom' } }));
    expect(await getActiveConfig('X', client)).toBeNull();
  });
});

describe('config completeness (21.3)', () => {
  it('a full config (no Expert) is complete', () => {
    expect(isConfigComplete(fullConfig())).toBe(true);
    expect(missingConfigPieces(fullConfig())).toEqual([]);
  });

  it('reports missing Evaluation_Boards', () => {
    const missing = missingConfigPieces(fullConfig({ preBeginner: null, postIntermediate: null }));
    expect(missing).toContain('Pre_Beginner');
    expect(missing).toContain('Post_Intermediate');
  });

  it('reports a missing Intermediate Video_Source', () => {
    expect(missingConfigPieces(fullConfig({ intermediateVideoSource: null }))).toContain(
      'Intermediate Video_Source',
    );
  });

  it('requires Post_Expert only when the study includes the Expert tier', () => {
    expect(missingConfigPieces(fullConfig({ includesExpert: false, postExpert: null }))).not.toContain(
      'Post_Expert',
    );
    expect(missingConfigPieces(fullConfig({ includesExpert: true, postExpert: null }))).toContain(
      'Post_Expert',
    );
  });
});

describe('createParticipant (21.4, 21.7, 21.8)', () => {
  it('returns the Participant_ID and Resume_Code', async () => {
    const { client, calls } = fakeSupabase(() => ({
      data: [{ participant_id: 'p-1', resume_code: 'MLS-ABCD-EFGH' }],
      error: null,
    }));
    const p = await createParticipant('cfg-1', 'v1', client);
    expect(p).toEqual({ participantId: 'p-1', resumeCode: 'MLS-ABCD-EFGH', studyGroup: null });
    expect(calls[0]).toEqual({
      fn: 'create_participant',
      args: { p_config_id: 'cfg-1', p_consent_version: 'v1' },
    });
  });

  it('returns null on error', async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: { message: 'x' } }));
    expect(await createParticipant('cfg-1', 'v1', client)).toBeNull();
  });
});

describe('resumeByCode (21.10)', () => {
  it('restores the identity for a valid code', async () => {
    const { client } = fakeSupabase(() => ({
      data: [{ participant_id: 'p-9', study_config_id: 'cfg-1', study_group: 'Group_A' }],
      error: null,
    }));
    const p = await resumeByCode('MLS-ABCD-EFGH', client);
    expect(p).toEqual({
      participantId: 'p-9',
      resumeCode: 'MLS-ABCD-EFGH',
      studyGroup: 'Group_A',
    });
  });

  it('returns null for an unknown code', async () => {
    const { client } = fakeSupabase(() => ({ data: [], error: null }));
    expect(await resumeByCode('MLS-BAD0-BAD0', client)).toBeNull();
  });
});

describe('insertRecord (21.6)', () => {
  it('returns true when the Backend accepts the record', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: 'id', error: null }));
    expect(await insertRecord('p-1', 'Pre_Test', 'game', { a: 1 }, client)).toBe(true);
    expect(calls[0]!.fn).toBe('insert_study_record');
  });

  it('returns false when the Backend rejects (no consent, 21.6)', async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: { message: 'no consent' } }));
    expect(await insertRecord('p-1', 'Pre_Test', 'game', {}, client)).toBe(false);
  });
});

describe('withdraw (21.12, 21.13)', () => {
  it('returns the number of deleted records', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: 7, error: null }));
    expect(await withdraw('p-1', client)).toBe(7);
    expect(calls[0]).toEqual({
      fn: 'withdraw_participant',
      args: { p_participant_id: 'p-1' },
    });
  });

  it('returns 0 for a withdrawal with no stored records', async () => {
    const { client } = fakeSupabase(() => ({ data: 0, error: null }));
    expect(await withdraw('p-1', client)).toBe(0);
  });

  it('returns null on error', async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: { message: 'x' } }));
    expect(await withdraw('p-1', client)).toBeNull();
  });
});
