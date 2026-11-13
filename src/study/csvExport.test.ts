import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { METRICS_VERSION } from '../engine/metrics';
import {
  writeCsv,
  parseCsv,
  escapeField,
  buildParticipantsTable,
  buildTestGamesTable,
  buildSurveyTable,
  buildPairedPrePostTable,
  buildDataDictionary,
  metricsEqualityStatement,
  dictionaryEntries,
  canExport,
  buildExportBundle,
  ExportNotAuthorizedError,
  SURVEY_RATING_KEYS,
  SURVEY_OPEN_KEYS,
  type PairedMetricInput,
  type ExportData,
} from './csvExport';

describe('RFC 4180 writer/parser round trip (Requirement 26.4)', () => {
  it('writeCsv -> parseCsv is identity for arbitrary strings incl. commas/quotes/CRLF/non-ASCII', () => {
    fc.assert(
      fc.property(
        // A grid of arbitrary strings: a header row + body rows, all same width.
        fc
          .integer({ min: 1, max: 5 })
          .chain((cols) =>
            fc.record({
              header: fc.array(fc.string(), { minLength: cols, maxLength: cols }),
              rows: fc.array(
                fc.array(fc.string(), { minLength: cols, maxLength: cols }),
                { maxLength: 8 },
              ),
            }),
          ),
        ({ header, rows }) => {
          const csv = writeCsv(header, rows);
          const parsed = parseCsv(csv);
          expect(parsed).toEqual([header, ...rows]);
        },
      ),
    );
  });

  it('round-trips the specific hostile cases from 26.4', () => {
    const header = ['participant_id', 'note'];
    const rows = [
      ['p1', 'has, comma'],
      ['p2', 'has "quotes"'],
      ['p3', 'has\nnewline'],
      ['p4', 'has\r\ncrlf'],
      ['p5', 'café — naïve — 日本語 😀'],
      ['p6', ''],
    ];
    expect(parseCsv(writeCsv(header, rows))).toEqual([header, ...rows]);
  });

  it('escapeField quotes only when needed and doubles inner quotes', () => {
    expect(escapeField('plain')).toBe('plain');
    expect(escapeField('a,b')).toBe('"a,b"');
    expect(escapeField('a"b')).toBe('"a""b"');
    expect(escapeField('a\nb')).toBe('"a\nb"');
  });
});

describe('CSV structure (Requirement 26.3)', () => {
  it('starts with a header row and uses CRLF terminators', () => {
    const csv = writeCsv(['a', 'b'], [['1', '2']]);
    expect(csv.startsWith('a,b\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('includes participant_id as the first column on every built table', () => {
    const tables = [
      buildParticipantsTable([{ participantId: 'p1', group: 'Group_A', background: {} }]),
      buildTestGamesTable([
        {
          participantId: 'p1',
          phase: 'Pre_Test',
          difficulty: 'Beginner',
          boardId: 'b1',
          outcome: 'won',
          elapsedMs: 1000,
          logicalMoveRate: 100,
          patternRecognitionSpeed: 2.5,
          chordingEfficiency: 1.2,
          metricsVersion: METRICS_VERSION,
          moveLog: 'movelog 1\n',
          loggedAt: '2025-01-01T00:00:00.000Z',
        },
      ]),
      buildSurveyTable([
        {
          participantId: 'p1',
          ratings: [1, 2, 3, 4, 5, '', ''],
          openEnded: ['a', '', ''],
          demographics: '',
          loggedAt: '2025-01-01T00:00:00.000Z',
        },
      ]),
    ];
    for (const t of tables) {
      expect(t.header[0]).toBe('participant_id');
      for (const row of t.rows) {
        expect(row[0]).toBe('p1');
      }
    }
  });
});

describe('Paired pre/post row (Requirement 26.5)', () => {
  const base = (
    phase: 'Pre_Test' | 'Post_Test',
    difficulty: 'Beginner' | 'Intermediate',
    over: Partial<PairedMetricInput> = {},
  ): PairedMetricInput => ({
    participantId: 'p1',
    difficulty,
    phase,
    outcome: 'won',
    elapsedMs: 1000,
    logicalMoveRate: 80,
    patternRecognitionSpeed: 3,
    chordingEfficiency: 1.1,
    ...over,
  });

  it('emits one row per (participant, Beginner|Intermediate) pairing pre and post', () => {
    const inputs: PairedMetricInput[] = [
      base('Pre_Test', 'Beginner', { logicalMoveRate: 50, elapsedMs: 2000 }),
      base('Post_Test', 'Beginner', { logicalMoveRate: 90, elapsedMs: 1000 }),
      base('Pre_Test', 'Intermediate', { logicalMoveRate: 40 }),
      base('Post_Test', 'Intermediate', { logicalMoveRate: 70 }),
    ];
    const table = buildPairedPrePostTable(inputs);
    expect(table.rows).toHaveLength(2);

    const beginner = table.rows.find((r) => r[1] === 'Beginner')!;
    const preIdx = table.header.indexOf('pre_logical_move_rate');
    const postIdx = table.header.indexOf('post_logical_move_rate');
    expect(beginner[preIdx]).toBe('50');
    expect(beginner[postIdx]).toBe('90');
    expect(beginner[table.header.indexOf('pre_elapsed_ms')]).toBe('2000');
    expect(beginner[table.header.indexOf('post_elapsed_ms')]).toBe('1000');

    const intermediate = table.rows.find((r) => r[1] === 'Intermediate')!;
    expect(intermediate[preIdx]).toBe('40');
    expect(intermediate[postIdx]).toBe('70');
  });

  it('leaves the missing side blank when only pre or only post exists', () => {
    const table = buildPairedPrePostTable([base('Pre_Test', 'Beginner', { logicalMoveRate: 55 })]);
    const row = table.rows[0]!;
    expect(row[table.header.indexOf('pre_logical_move_rate')]).toBe('55');
    expect(row[table.header.indexOf('post_logical_move_rate')]).toBe('');
    expect(row[table.header.indexOf('post_outcome')]).toBe('');
  });
});

describe('Data dictionary (Requirement 26.7)', () => {
  const dict = buildDataDictionary();

  it('states the metrics are the same Game_Metrics under the same Metrics_Version as game summaries', () => {
    expect(dict).toContain(metricsEqualityStatement());
    expect(dict).toContain('same Game_Metrics');
    expect(dict).toContain('game summaries');
  });

  it('uses the engine METRICS_VERSION value', () => {
    expect(metricsEqualityStatement()).toContain(`Metrics_Version (${METRICS_VERSION})`);
    expect(dict).toContain(`${METRICS_VERSION}`);
  });

  it('documents every exported column name across the files', () => {
    const documented = new Set(dictionaryEntries().map((e) => e.column));
    const exportedColumns = [
      'participant_id',
      'group',
      'phase',
      'difficulty',
      'board_id',
      'outcome',
      'elapsed_ms',
      'logical_move_rate',
      'pattern_recognition_speed',
      'chording_efficiency',
      'metrics_version',
      'move_log',
      'logged_at',
      'learning_step',
      'started_at',
      'ended_at',
      'event',
      'position_seconds',
      'distinct_seconds_watched',
      'demographics',
      'completed_sweep_days',
      'daily_streak_at_end',
      ...SURVEY_RATING_KEYS,
      ...SURVEY_OPEN_KEYS,
    ];
    for (const col of exportedColumns) {
      expect(documented.has(col)).toBe(true);
    }
  });

  it('documents units for each column', () => {
    for (const e of dictionaryEntries()) {
      expect(e.unit.length).toBeGreaterThan(0);
      expect(dict).toContain(`${e.column} | ${e.unit} |`);
    }
  });
});

describe('Export authorization (Requirement 26.2)', () => {
  const emptyData: ExportData = {
    participants: [],
    testGames: [],
    learningEvents: [],
    videoEvents: [],
    surveyResponses: [],
    retention: [],
    pairedPrePost: [],
  };

  it('allows a Researcher and denies a non-Researcher', () => {
    expect(canExport(true)).toBe(true);
    expect(canExport(false)).toBe(false);
  });

  it('buildExportBundle throws for a non-Researcher (mirrors the Backend deny)', () => {
    expect(() => buildExportBundle(false, emptyData)).toThrow(ExportNotAuthorizedError);
  });

  it('buildExportBundle returns all files + the dictionary for a Researcher', () => {
    const bundle = buildExportBundle(true, emptyData);
    expect(bundle.participants.startsWith('participant_id')).toBe(true);
    expect(bundle.testGames.startsWith('participant_id')).toBe(true);
    expect(bundle.surveyResponses.startsWith('participant_id')).toBe(true);
    expect(bundle.pairedPrePost.startsWith('participant_id')).toBe(true);
    expect(bundle.dataDictionary).toContain(metricsEqualityStatement());
  });
});
