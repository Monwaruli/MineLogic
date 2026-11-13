/**
 * Anonymized Data Export (task 9.3, Requirement 26).
 *
 * The PURE core of the CSV exporter: no DOM, no Supabase. It takes
 * already-fetched rows (plain record objects) and returns CSV text plus the
 * data dictionary text, so every rule is unit/property testable and a thin
 * browser wrapper can fetch + trigger a download separately.
 *
 * What it provides:
 *   - An RFC 4180 writer (writeCsv) and a matching parser (parseCsv) so the
 *     round-trip property (26.4) holds: writing records then parsing the result
 *     yields records equal to the originals, even for text with commas, quotes,
 *     CRLF, and non-ASCII. Fields are quoted when they contain comma / quote /
 *     CR / LF; embedded quotes are doubled; rows end with CRLF; UTF-8 (26.3).
 *   - Separate export builders (26.1): participants, test games, learning
 *     events, video events, survey responses, retention results. Each row
 *     carries the Participant_ID (26.3) and each file starts with a header row.
 *   - The paired pre/post row builder (26.5): for each Participant and each of
 *     Beginner and Intermediate, one row pairing the Pre/Post values.
 *   - A data dictionary generator (26.7) describing every column, its unit, and
 *     the Metrics_Version definitions — and stating explicitly that the exported
 *     metrics are the SAME Game_Metrics, under the SAME Metrics_Version, that
 *     learners see in game summaries.
 *
 * Metrics_Version comes from the engine (METRICS_VERSION) so the dictionary and
 * the exported metrics cannot drift from what learners see (26.7).
 */

import { METRICS_VERSION } from '../engine/metrics';

// ---------------------------------------------------------------------------
// RFC 4180 writer + parser
// ---------------------------------------------------------------------------

/** The RFC 4180 row terminator. */
const CRLF = '\r\n';

/** A field needs quoting when it contains a comma, quote, CR, or LF (RFC 4180). */
function needsQuoting(field: string): boolean {
  return /[",\r\n]/.test(field);
}

/** Escape one field per RFC 4180: wrap in quotes and double any inner quote. */
export function escapeField(field: string): string {
  if (!needsQuoting(field)) return field;
  return `"${field.replace(/"/g, '""')}"`;
}

/**
 * Write a table (header + rows of string fields) as an RFC 4180 CSV string.
 * Every row (including the header) is terminated with CRLF and the whole output
 * ends with a trailing CRLF, which an RFC 4180 parser reads back identically.
 */
export function writeCsv(header: string[], rows: string[][]): string {
  const lines: string[] = [];
  lines.push(header.map(escapeField).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeField).join(','));
  }
  return lines.join(CRLF) + CRLF;
}

/**
 * Parse an RFC 4180 CSV string into an array of records (string[][]), including
 * the header as the first record. Handles quoted fields with embedded commas,
 * doubled quotes, and CR/LF inside quotes, and accepts both CRLF and lone LF as
 * row terminators. A trailing terminator does not produce an empty final record.
 *
 * This is the matching parser the round-trip property (26.4) checks against:
 * parseCsv(writeCsv(h, rows)) === [h, ...rows].
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  // Tracks whether the current record has any content, so a trailing row
  // terminator does not emit a spurious empty record.
  let sawField = false;

  const endField = () => {
    record.push(field);
    field = '';
    sawField = true;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    sawField = false;
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF or lone CR ends the record.
      endRecord();
      if (text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      i += 1;
      continue;
    }
    field += ch;
    sawField = true;
    i += 1;
  }

  // Flush any trailing partial record (file without a final terminator).
  if (sawField || field.length > 0 || record.length > 0) {
    endRecord();
  }

  return records;
}

// ---------------------------------------------------------------------------
// Export row models (already-fetched, shaped rows)
// ---------------------------------------------------------------------------

/** A Participant export row (26.1): group + Background_Question answers. */
export interface ParticipantExport {
  participantId: string;
  group: string | null;
  /** Background_Question answers keyed by question id. */
  background: Record<string, string>;
}

/** A test-game export row (25.1 fields). */
export interface TestGameExport {
  participantId: string;
  phase: string;
  difficulty: string;
  boardId: string;
  outcome: string;
  elapsedMs: number;
  logicalMoveRate: number | null;
  patternRecognitionSpeed: number | null;
  chordingEfficiency: number | null;
  metricsVersion: number;
  moveLog: string;
  loggedAt: string;
}

/** A learning-event export row (25.3). */
export interface LearningEventExport {
  participantId: string;
  learningStep: string;
  startedAt: string;
  endedAt: string;
  loggedAt: string;
}

/** A video-event export row (25.6). */
export interface VideoEventExport {
  participantId: string;
  event: string;
  positionSeconds: number;
  distinctSecondsWatched: number;
  loggedAt: string;
}

/** A survey-response export row (24.6). Seven ratings, three open, one demo. */
export interface SurveyExport {
  participantId: string;
  ratings: Array<number | string>;
  openEnded: string[];
  demographics: string;
  loggedAt: string;
}

/** A Retention_Window export row (26.6). */
export interface RetentionExport {
  participantId: string;
  completedSweepDays: number;
  dailyStreakAtEnd: number;
}

/**
 * The per-game metric values used to build the paired pre/post row (26.5). One
 * of these per (participant, difficulty, phase).
 */
export interface PairedMetricInput {
  participantId: string;
  difficulty: 'Beginner' | 'Intermediate';
  phase: 'Pre_Test' | 'Post_Test';
  outcome: string;
  elapsedMs: number;
  logicalMoveRate: number | null;
  patternRecognitionSpeed: number | null;
  chordingEfficiency: number | null;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Render a nullable number as a CSV field ('' for null/undefined). */
function numOrBlank(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** The IDs of the Background_Questions in a stable export order (10.x). */
export const BACKGROUND_QUESTION_IDS = ['experience', 'goal'] as const;

/** The seven rating item keys, in order (24.1). */
export const SURVEY_RATING_KEYS = [
  'rating_1',
  'rating_2',
  'rating_3',
  'rating_4',
  'rating_5',
  'rating_6',
  'rating_7',
] as const;

/** The three open-ended keys, in order (24.1). */
export const SURVEY_OPEN_KEYS = ['open_1', 'open_2', 'open_3'] as const;

// ---------------------------------------------------------------------------
// Separate CSV export builders (26.1). Each returns { header, rows }.
// ---------------------------------------------------------------------------

/** A built CSV table before serialization. */
export interface CsvTable {
  header: string[];
  rows: string[][];
}

/** Participants export (26.1): participant_id, group, Background answers. */
export function buildParticipantsTable(rows: ParticipantExport[]): CsvTable {
  const header = ['participant_id', 'group', ...BACKGROUND_QUESTION_IDS];
  const out = rows.map((r) => [
    r.participantId,
    r.group ?? '',
    ...BACKGROUND_QUESTION_IDS.map((q) => r.background[q] ?? ''),
  ]);
  return { header, rows: out };
}

/** Test-games export (25.1). */
export function buildTestGamesTable(rows: TestGameExport[]): CsvTable {
  const header = [
    'participant_id',
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
  ];
  const out = rows.map((r) => [
    r.participantId,
    r.phase,
    r.difficulty,
    r.boardId,
    r.outcome,
    String(r.elapsedMs),
    numOrBlank(r.logicalMoveRate),
    numOrBlank(r.patternRecognitionSpeed),
    numOrBlank(r.chordingEfficiency),
    String(r.metricsVersion),
    r.moveLog,
    r.loggedAt,
  ]);
  return { header, rows: out };
}

/** Learning-events export (25.3). */
export function buildLearningEventsTable(rows: LearningEventExport[]): CsvTable {
  const header = ['participant_id', 'learning_step', 'started_at', 'ended_at', 'logged_at'];
  const out = rows.map((r) => [
    r.participantId,
    r.learningStep,
    r.startedAt,
    r.endedAt,
    r.loggedAt,
  ]);
  return { header, rows: out };
}

/** Video-events export (25.6). */
export function buildVideoEventsTable(rows: VideoEventExport[]): CsvTable {
  const header = [
    'participant_id',
    'event',
    'position_seconds',
    'distinct_seconds_watched',
    'logged_at',
  ];
  const out = rows.map((r) => [
    r.participantId,
    r.event,
    String(r.positionSeconds),
    String(r.distinctSecondsWatched),
    r.loggedAt,
  ]);
  return { header, rows: out };
}

/** Survey-responses export (24.6): seven ratings, three open, one demographics. */
export function buildSurveyTable(rows: SurveyExport[]): CsvTable {
  const header = [
    'participant_id',
    ...SURVEY_RATING_KEYS,
    ...SURVEY_OPEN_KEYS,
    'demographics',
    'logged_at',
  ];
  const out = rows.map((r) => {
    const ratings = SURVEY_RATING_KEYS.map((_, i) => {
      const v = r.ratings[i];
      return v === undefined || v === null ? '' : String(v);
    });
    const open = SURVEY_OPEN_KEYS.map((_, i) => r.openEnded[i] ?? '');
    return [r.participantId, ...ratings, ...open, r.demographics, r.loggedAt];
  });
  return { header, rows: out };
}

/** Retention-results export (26.6). */
export function buildRetentionTable(rows: RetentionExport[]): CsvTable {
  const header = ['participant_id', 'completed_sweep_days', 'daily_streak_at_end'];
  const out = rows.map((r) => [
    r.participantId,
    String(r.completedSweepDays),
    String(r.dailyStreakAtEnd),
  ]);
  return { header, rows: out };
}

/**
 * Paired pre/post rows (26.5): for each Participant and for each of Beginner and
 * Intermediate, ONE row pairing the Pre_Test and Post_Test values of outcome,
 * elapsed time, Logical_Move_Rate, Pattern_Recognition_Speed, and
 * Chording_Efficiency. A missing pre or post leaves that side's fields blank.
 */
export function buildPairedPrePostTable(inputs: PairedMetricInput[]): CsvTable {
  const header = [
    'participant_id',
    'difficulty',
    'pre_outcome',
    'post_outcome',
    'pre_elapsed_ms',
    'post_elapsed_ms',
    'pre_logical_move_rate',
    'post_logical_move_rate',
    'pre_pattern_recognition_speed',
    'post_pattern_recognition_speed',
    'pre_chording_efficiency',
    'post_chording_efficiency',
  ];

  // Group by participant, then difficulty; keep the LAST pre and LAST post seen.
  type Pair = { pre?: PairedMetricInput; post?: PairedMetricInput };
  const byParticipant = new Map<string, Map<string, Pair>>();
  // Preserve first-seen participant order for deterministic output.
  const participantOrder: string[] = [];

  for (const input of inputs) {
    if (!byParticipant.has(input.participantId)) {
      byParticipant.set(input.participantId, new Map());
      participantOrder.push(input.participantId);
    }
    const byDiff = byParticipant.get(input.participantId)!;
    const pair = byDiff.get(input.difficulty) ?? {};
    if (input.phase === 'Pre_Test') pair.pre = input;
    else pair.post = input;
    byDiff.set(input.difficulty, pair);
  }

  const difficulties: Array<'Beginner' | 'Intermediate'> = ['Beginner', 'Intermediate'];
  const rows: string[][] = [];
  for (const participantId of participantOrder) {
    const byDiff = byParticipant.get(participantId)!;
    for (const difficulty of difficulties) {
      const pair = byDiff.get(difficulty);
      // 26.5 requires a row for each (participant, Beginner|Intermediate). Emit
      // a row even when one side is missing, leaving its fields blank.
      if (!pair) continue;
      const { pre, post } = pair;
      rows.push([
        participantId,
        difficulty,
        pre?.outcome ?? '',
        post?.outcome ?? '',
        numOrBlank(pre?.elapsedMs),
        numOrBlank(post?.elapsedMs),
        numOrBlank(pre?.logicalMoveRate),
        numOrBlank(post?.logicalMoveRate),
        numOrBlank(pre?.patternRecognitionSpeed),
        numOrBlank(post?.patternRecognitionSpeed),
        numOrBlank(pre?.chordingEfficiency),
        numOrBlank(post?.chordingEfficiency),
      ]);
    }
  }
  return { header, rows };
}

// ---------------------------------------------------------------------------
// The data dictionary (26.7)
// ---------------------------------------------------------------------------

/** One documented column: name, unit, and description. */
export interface DictionaryEntry {
  column: string;
  unit: string;
  description: string;
}

/**
 * The exact sentence the data dictionary MUST contain (26.7): the exported
 * metrics are the same Game_Metrics, under the same Metrics_Version, that
 * learners see in game summaries. Kept as a constant so the test asserts it
 * verbatim and the Metrics_Version is interpolated from the engine.
 */
export function metricsEqualityStatement(): string {
  return (
    `The exported metrics (Logical_Move_Rate, Pattern_Recognition_Speed, and ` +
    `Chording_Efficiency) are the same Game_Metrics, under the same ` +
    `Metrics_Version (${METRICS_VERSION}), that learners see in game summaries.`
  );
}

/** The documented columns across every export file (26.7). */
export function dictionaryEntries(): DictionaryEntry[] {
  return [
    { column: 'participant_id', unit: 'uuid', description: 'Anonymous Participant identifier, present on every row (26.3).' },
    { column: 'group', unit: 'Group_A | Group_B', description: 'Assigned learning group.' },
    { column: 'phase', unit: 'Pre_Test | Post_Test | Retention_Window', description: 'The study phase the game belongs to.' },
    { column: 'difficulty', unit: 'Beginner | Intermediate | Expert', description: 'The board Difficulty.' },
    { column: 'board_id', unit: 'text', description: 'The Evaluation_Board identifier.' },
    { column: 'outcome', unit: 'won | lost | Timed_Out | Interrupted', description: 'How the game ended.' },
    { column: 'elapsed_ms', unit: 'milliseconds', description: 'Elapsed time from the Start_Tile reveal to the end.' },
    { column: 'logical_move_rate', unit: 'percent (0–100, one decimal)', description: 'Logical_Move_Rate: share of reveal actions on provably-safe tiles. Same as the learner summary.' },
    { column: 'pattern_recognition_speed', unit: 'seconds (one decimal)', description: 'Pattern_Recognition_Speed: median seconds from a pattern appearing to being resolved. Same as the learner summary.' },
    { column: 'chording_efficiency', unit: 'ratio (two decimals)', description: 'Chording_Efficiency: Total_Clicks / 3BV for won games. Same as the learner summary.' },
    { column: 'metrics_version', unit: 'integer', description: `The Metrics_Version of the definitions (currently ${METRICS_VERSION}).` },
    { column: 'move_log', unit: 'text (Move_Log_Format)', description: 'The serialized Move_Log the metrics were computed from.' },
    { column: 'logged_at', unit: 'ISO 8601 UTC, millisecond precision', description: 'When the record was logged (25.9).' },
    { column: 'learning_step', unit: 'text', description: 'The Learning_Phase step name.' },
    { column: 'started_at', unit: 'ISO 8601 UTC, millisecond precision', description: 'Learning step start time.' },
    { column: 'ended_at', unit: 'ISO 8601 UTC, millisecond precision', description: 'Learning step end time.' },
    { column: 'event', unit: 'play | pause | seek | ended', description: 'A Video_Panel event.' },
    { column: 'position_seconds', unit: 'seconds', description: 'Video position at the event.' },
    { column: 'distinct_seconds_watched', unit: 'seconds', description: 'Distinct seconds of video watched so far.' },
    ...SURVEY_RATING_KEYS.map((k, i) => ({
      column: k,
      unit: '1 (strongly disagree) – 5 (strongly agree), blank if unanswered',
      description: `Survey rating item ${i + 1} (24.3). Unanswered items are blank (24.6).`,
    })),
    ...SURVEY_OPEN_KEYS.map((k, i) => ({
      column: k,
      unit: 'text (up to 2,000 chars)',
      description: `Survey open-ended prompt ${i + 1} (24.5). Blank if unanswered (24.6).`,
    })),
    { column: 'demographics', unit: 'text', description: 'Survey demographics item. Blank if unanswered (24.6).' },
    { column: 'completed_sweep_days', unit: 'count', description: 'Retention_Window Sweep_Days with a completed Daily_Sweep (26.6).' },
    { column: 'daily_streak_at_end', unit: 'count', description: 'Daily_Streak at the end of the Retention_Window (26.6).' },
    ...BACKGROUND_QUESTION_IDS.map((q) => ({
      column: q,
      unit: 'text',
      description: `Background_Question answer: ${q}.`,
    })),
    { column: 'pre_outcome', unit: 'won | lost | Timed_Out | Interrupted', description: 'Pre_Test outcome (paired row, 26.5).' },
    { column: 'post_outcome', unit: 'won | lost | Timed_Out | Interrupted', description: 'Post_Test outcome (paired row, 26.5).' },
  ];
}

/**
 * Render the data dictionary as text (26.7): a header, the metrics-equality
 * statement, and one line per documented column (name, unit, description).
 */
export function buildDataDictionary(): string {
  const lines: string[] = [];
  lines.push('MineLogic Study — Data Dictionary');
  lines.push('');
  lines.push(metricsEqualityStatement());
  lines.push('');
  lines.push('Columns (column | unit | description):');
  for (const e of dictionaryEntries()) {
    lines.push(`${e.column} | ${e.unit} | ${e.description}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Export authorization (26.2) — pure guard
// ---------------------------------------------------------------------------

/**
 * A pure guard mirroring the Backend's 26.2 rule: only a Researcher may export.
 * The Backend is the authority (its export functions reject a non-Researcher),
 * but the client checks first so it never shows export controls to others and
 * so the deny is testable without a live DB.
 */
export function canExport(isResearcher: boolean): boolean {
  return isResearcher === true;
}

/** Thrown when a non-Researcher attempts an export (mirrors the Backend deny). */
export class ExportNotAuthorizedError extends Error {
  constructor() {
    super('Export denied: only a Researcher may download study data (26.2).');
    this.name = 'ExportNotAuthorizedError';
  }
}

/** The full set of export files produced for a Researcher (26.1 + 26.5 + 26.7). */
export interface ExportBundle {
  participants: string;
  testGames: string;
  learningEvents: string;
  videoEvents: string;
  surveyResponses: string;
  retention: string;
  pairedPrePost: string;
  dataDictionary: string;
}

/** The already-fetched rows the exporter turns into the bundle. */
export interface ExportData {
  participants: ParticipantExport[];
  testGames: TestGameExport[];
  learningEvents: LearningEventExport[];
  videoEvents: VideoEventExport[];
  surveyResponses: SurveyExport[];
  retention: RetentionExport[];
  pairedPrePost: PairedMetricInput[];
}

/**
 * Build the full export bundle (26.1, 26.3, 26.5, 26.7). Throws
 * ExportNotAuthorizedError when the caller is not a Researcher (26.2), matching
 * the Backend deny so the UI fails the same way whether it checks client-side or
 * the Backend rejects the read.
 */
export function buildExportBundle(isResearcher: boolean, data: ExportData): ExportBundle {
  if (!canExport(isResearcher)) throw new ExportNotAuthorizedError();
  const p = buildParticipantsTable(data.participants);
  const tg = buildTestGamesTable(data.testGames);
  const le = buildLearningEventsTable(data.learningEvents);
  const ve = buildVideoEventsTable(data.videoEvents);
  const sv = buildSurveyTable(data.surveyResponses);
  const rt = buildRetentionTable(data.retention);
  const pp = buildPairedPrePostTable(data.pairedPrePost);
  return {
    participants: writeCsv(p.header, p.rows),
    testGames: writeCsv(tg.header, tg.rows),
    learningEvents: writeCsv(le.header, le.rows),
    videoEvents: writeCsv(ve.header, ve.rows),
    surveyResponses: writeCsv(sv.header, sv.rows),
    retention: writeCsv(rt.header, rt.rows),
    pairedPrePost: writeCsv(pp.header, pp.rows),
    dataDictionary: buildDataDictionary(),
  };
}
