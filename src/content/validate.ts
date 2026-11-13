/**
 * The Content_Validator (task 7.3): the build-time check that verifies every
 * authored Board with the Solver (Requirement 17 build gate; also 10.8, 10.9 for
 * snippets, 11.11 for lessons, 13.7 for checkpoints).
 *
 * Pure logic, no React or DOM imports, so it runs in Vitest and from the
 * `validate:content` CLI (`tools/validateContent.ts`). It gathers every authored
 * Board — the Skill_Check_Snippets, the Mastery_Checkpoint Checkpoint_Variations,
 * and the lesson Learn_Step and Do_Step Mini_Boards — parses each with the
 * Board_Parser, and checks the relevant invariant with the Solver and the
 * Pattern_Detector. It returns a list of issues; an empty list means all content
 * is valid and the CLI exits 0.
 *
 * The checks mirror the content tests (skillCheck.test.ts, checkpoints.test.ts,
 * lessons.test.ts) so the CLI and the test suite agree by construction; both are
 * the single source of truth for "valid authored content".
 */

import { parseBoard } from '../engine/boardFormat';
import {
  createGame,
  applyAction,
  type Action,
  type GameState,
} from '../engine/game';
import { classifyGame, revealTargets, targetsAllSafe } from '../engine/practice';
import {
  attributeSafeTiles,
  classifyPattern,
  type PatternType,
} from '../engine/patterns';
import { neighbors, tileKey, type Tile } from '../engine/board';
import { threeBV } from '../engine/threeBV';
import { SKILL_CHECK_SNIPPETS } from './skillCheck';
import { CHECKPOINT_VARIATIONS } from './checkpoints';
import { LESSONS } from './lessons';
import type { Tier } from './lessons';

/** One validation problem found in an authored Board. */
export interface ValidationIssue {
  /** The kind of content: a snippet, a checkpoint variation, a lesson step, or a study Evaluation_Board. */
  kind: 'snippet' | 'checkpoint' | 'lesson' | 'evaluation';
  /** The content identifier (snippet id, variation id, or lesson step label). */
  id: string;
  /** A human-readable description of what is wrong. */
  message: string;
}

/** Pattern_Types that belong to each tier (glossary). */
const TIER_PATTERNS: Record<Tier, PatternType[]> = {
  Beginner: ['Exposed_Mines', 'Satisfied_Number'],
  Intermediate: ['Wall_1_1', 'Wall_1_2_1', 'Wall_1_2_2_1'],
  Expert: ['Subset', 'Clue_Chain', 'Mine_Count_Endgame'],
};

// ---------------------------------------------------------------------------
// Shared Solver-driven helpers (identical logic to the content tests)
// ---------------------------------------------------------------------------

/**
 * Greedily clear a board using only Logical_Moves and flags on Provably_Mine
 * Tiles. Flagging mines lets the win condition be reached even when a last safe
 * reveal sits beside a forced mine.
 */
function solveWithLogic(game: GameState): GameState {
  let state = game;
  for (let guard = 0; guard < 400; guard++) {
    const result = classifyGame(state);
    if (result.inexact || result.inconsistent) break;
    let progressed = false;

    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Mine') continue;
      if (state.flags.has(key)) continue;
      const [r, c] = key.split(',').map(Number) as Tile;
      state = applyAction(state, { type: 'Flag_Toggle', tile: [r, c] }, 0);
      progressed = true;
    }

    const safeResult = classifyGame(state);
    if (!safeResult.inexact && !safeResult.inconsistent) {
      for (const [key, cls] of safeResult.classification) {
        if (cls !== 'Provably_Safe') continue;
        if (state.revealed.has(key) || state.flags.has(key)) continue;
        const [r, c] = key.split(',').map(Number) as Tile;
        const action: Action = { type: 'Reveal_Click', tile: [r, c] };
        const targets = revealTargets(state, action);
        if (targets.length === 0) continue;
        const fresh = classifyGame(state);
        if (!targetsAllSafe(targets, fresh)) continue;
        state = applyAction(state, action, 0);
        progressed = true;
        if (state.status === 'won' || state.status === 'lost') return state;
      }
    }

    if (!progressed) break;
  }
  return state;
}

/** True when the Board forces at least one Provably_Mine Tile (Exposed_Mines). */
function forcesProvablyMine(game: GameState): boolean {
  const result = classifyGame(game);
  if (result.inexact || result.inconsistent) return false;
  for (const cls of result.classification.values()) {
    if (cls === 'Provably_Mine') return true;
  }
  return false;
}

/** The Pattern_Types attributed to Provably_Safe Tiles in the initial state. */
function initialSafePatterns(game: GameState): Set<PatternType> {
  const types = new Set<PatternType>();
  for (const a of attributeSafeTiles(game).values()) types.add(a.patternType);
  return types;
}

/** True when the expected Pattern_Type surfaces during a logical solve. */
function patternTypeReached(expected: PatternType, initial: GameState): boolean {
  let state = initial;
  for (let guard = 0; guard < 200; guard++) {
    for (const a of attributeSafeTiles(state).values()) {
      if (a.patternType === expected) return true;
    }
    const result = classifyGame(state);
    if (result.inexact || result.inconsistent) break;
    let progressed = false;
    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Safe') continue;
      if (state.revealed.has(key) || state.flags.has(key)) continue;
      const [r, c] = key.split(',').map(Number) as Tile;
      const action: Action = { type: 'Reveal_Click', tile: [r, c] };
      const targets = revealTargets(state, action);
      if (targets.length === 0) continue;
      const fresh = classifyGame(state);
      if (!targetsAllSafe(targets, fresh)) continue;
      state = applyAction(state, action, 0);
      progressed = true;
      break;
    }
    if (!progressed) break;
    if (state.status === 'won' || state.status === 'lost') break;
  }
  return false;
}

/** True when a collinear run of four revealed Numbers reads 1-2-2-1. */
function hasWall1221Run(game: GameState): boolean {
  const { board } = game;
  const { width, height } = board;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const isRevealedNumber = (r: number, c: number): boolean =>
    game.revealed.has(tileKey(r, c)) && !mineSet.has(tileKey(r, c));

  const tryRun = (run: Tile[]): boolean => {
    if (!run.every(([r, c]) => isRevealedNumber(r, c))) return false;
    const touchesCovered = run.some(([r, c]) =>
      neighbors([r, c], width, height).some(
        (nb) => !game.revealed.has(tileKey(nb[0], nb[1])),
      ),
    );
    if (!touchesCovered) return false;
    return classifyPattern(game, run[0], run, 'Multi_Clue', false, new Set()) ===
      'Wall_1_2_2_1';
  };

  for (let r = 0; r < height; r++) {
    for (let c = 0; c + 3 < width; c++) {
      if (tryRun([[r, c], [r, c + 1], [r, c + 2], [r, c + 3]])) return true;
    }
  }
  for (let c = 0; c < width; c++) {
    for (let r = 0; r + 3 < height; r++) {
      if (tryRun([[r, c], [r + 1, c], [r + 2, c], [r + 3, c]])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-content validation
// ---------------------------------------------------------------------------

/** Validate every Skill_Check_Snippet (Requirement 10.8, 10.9). */
export function validateSnippets(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const s of SKILL_CHECK_SNIPPETS) {
    const id = s.id;
    let game: GameState;
    try {
      const board = parseBoard(s.boardText);
      if (board.startTile || !(board.initialRevealed && board.initialRevealed.length)) {
        issues.push({ kind: 'snippet', id, message: 'must be a partly-revealed Mini_Board' });
        continue;
      }
      game = createGame(board, 0);
    } catch (e) {
      issues.push({ kind: 'snippet', id, message: `fails to parse: ${(e as Error).message}` });
      continue;
    }

    const result = classifyGame(game);
    if (result.inexact || result.inconsistent) {
      issues.push({ kind: 'snippet', id, message: 'is not exactly solvable (inexact/inconsistent)' });
      continue;
    }

    const safeKeys = new Set<string>();
    for (const [key, cls] of result.classification) {
      if (cls === 'Provably_Safe') safeKeys.add(key);
    }

    // Exactly one Provably_Safe covered Tile, equal to the authored safeTile (10.8).
    if (safeKeys.size !== 1) {
      issues.push({
        kind: 'snippet',
        id,
        message: `must have exactly one Provably_Safe tile, found ${safeKeys.size}`,
      });
    }
    const safeKey = tileKey(s.safeTile[0], s.safeTile[1]);
    if (!safeKeys.has(safeKey)) {
      issues.push({
        kind: 'snippet',
        id,
        message: `authored safeTile ${safeKey} is not the Provably_Safe tile`,
      });
    }

    // At least one Trap_Tile, none Provably_Safe (10.8).
    if (s.traps.length < 1) {
      issues.push({ kind: 'snippet', id, message: 'must have at least one Trap_Tile' });
    }
    for (const { tile } of s.traps) {
      if (safeKeys.has(tileKey(tile[0], tile[1]))) {
        issues.push({
          kind: 'snippet',
          id,
          message: `Trap_Tile ${tileKey(tile[0], tile[1])} must not be Provably_Safe`,
        });
      }
    }

    // The snippet surfaces its tier's deduction (10.9). The Intermediate snippet
    // must be attributed Wall_1_2_1 on its safe tile. The Expert snippet's safe
    // tile must be an Expert-tier pattern. The Beginner snippet exercises corner
    // counting (Exposed_Mines): because a safe tile is never attributed
    // Exposed_Mines (a single-Number safe Tile is Satisfied_Number, and a
    // single-safe board is structurally impossible for Satisfied_Number), the
    // Beginner tier is verified by the Provably_Mine Tile its corner counting
    // forces — exactly the convention in lessons.test.ts and checkpoints.test.ts.
    const attr = attributeSafeTiles(game).get(safeKey);
    if (s.tier === 'Beginner') {
      if (!forcesProvablyMine(game)) {
        issues.push({
          kind: 'snippet',
          id,
          message: 'Beginner snippet must force a Provably_Mine tile (corner counting)',
        });
      }
    } else if (!attr) {
      issues.push({ kind: 'snippet', id, message: 'safe tile has no pattern attribution' });
    } else {
      if (!TIER_PATTERNS[s.tier].includes(attr.patternType)) {
        issues.push({
          kind: 'snippet',
          id,
          message: `safe tile attributed ${attr.patternType}, not a ${s.tier}-tier pattern`,
        });
      }
      if (s.tier === 'Intermediate' && attr.patternType !== 'Wall_1_2_1') {
        issues.push({
          kind: 'snippet',
          id,
          message: `Intermediate snippet must be Wall_1_2_1, got ${attr.patternType}`,
        });
      }
    }
  }
  return issues;
}

/** Validate every Mastery_Checkpoint Checkpoint_Variation (Requirement 13.7). */
export function validateCheckpoints(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const v of CHECKPOINT_VARIATIONS) {
    const id = v.id;
    let game: GameState;
    try {
      const board = parseBoard(v.boardText);
      game = createGame(board, 0);
    } catch (e) {
      issues.push({ kind: 'checkpoint', id, message: `fails to parse: ${(e as Error).message}` });
      continue;
    }

    const result = classifyGame(game);
    if (result.inexact || result.inconsistent) {
      issues.push({ kind: 'checkpoint', id, message: 'initial state is not exactly solvable' });
      continue;
    }

    // Clears to a win with only Logical_Moves (13.7).
    if (solveWithLogic(createGame(parseBoard(v.boardText), 0)).status !== 'won') {
      issues.push({ kind: 'checkpoint', id, message: 'does not clear with Logical_Moves alone' });
    }

    // First required deduction is attributed to its tier (13.7).
    const safePatterns = initialSafePatterns(game);
    const tierHit = TIER_PATTERNS[v.tier].some((p) => safePatterns.has(p));
    const beginnerMineHit = v.tier === 'Beginner' && forcesProvablyMine(game);
    if (!tierHit && !beginnerMineHit) {
      issues.push({
        kind: 'checkpoint',
        id,
        message: `first deduction is not a ${v.tier}-tier pattern`,
      });
    }
  }
  return issues;
}

/**
 * Validate every lesson Mini_Board (Requirement 11.11): each Do_Step's Objective
 * can be met from the initial state with only Logical_Moves (and flags on
 * Provably_Mine Tiles), at least one Target_Tile is attributed to the Lesson's
 * Pattern_Type, and every Learn_Step and Do_Step board parses as a Mini_Board.
 */
export function validateLessons(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const lesson of LESSONS) {
    // Learn_Step boards must parse as Mini_Boards.
    lesson.learnSteps.forEach((step, i) => {
      const id = `${lesson.id} learn ${i}`;
      try {
        const board = parseBoard(step.boardText);
        if (board.startTile || !(board.initialRevealed && board.initialRevealed.length)) {
          issues.push({ kind: 'lesson', id, message: 'must be a partly-revealed Mini_Board' });
        }
      } catch (e) {
        issues.push({ kind: 'lesson', id, message: `fails to parse: ${(e as Error).message}` });
      }
    });

    lesson.doSteps.forEach((step, i) => {
      const id = `${lesson.id} do ${i}`;
      let game: GameState;
      try {
        const board = parseBoard(step.boardText);
        game = createGame(board, 0);
      } catch (e) {
        issues.push({ kind: 'lesson', id, message: `fails to parse: ${(e as Error).message}` });
        return;
      }

      const result = classifyGame(game);
      if (result.inexact || result.inconsistent) {
        issues.push({ kind: 'lesson', id, message: 'initial state is not exactly solvable' });
        return;
      }

      // Every Target_Tile is Provably_Safe from the initial state.
      for (const [r, c] of step.targets) {
        if (result.classification.get(tileKey(r, c)) !== 'Provably_Safe') {
          issues.push({
            kind: 'lesson',
            id,
            message: `target ${tileKey(r, c)} is not Provably_Safe at the start`,
          });
        }
      }

      // The Objective completes with Logical_Moves only.
      const solved = solveWithLogic(createGame(parseBoard(step.boardText), 0));
      for (const [r, c] of step.targets) {
        if (!solved.revealed.has(tileKey(r, c))) {
          issues.push({
            kind: 'lesson',
            id,
            message: `target ${tileKey(r, c)} is not reached by Logical_Moves`,
          });
        }
      }

      // The taught Pattern_Type is present (two patterns use structural checks).
      let taught: boolean;
      if (lesson.patternType === 'Exposed_Mines') {
        taught = forcesProvablyMine(game);
      } else if (lesson.patternType === 'Wall_1_2_2_1') {
        taught = hasWall1221Run(game);
      } else {
        taught = patternTypeReached(lesson.patternType, game);
      }
      if (!taught) {
        issues.push({
          kind: 'lesson',
          id,
          message: `does not surface its taught pattern ${lesson.patternType}`,
        });
      }
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Study_Config Evaluation_Board validation (task 9.2, Requirements 22.5, 22.6)
//
// Unlike the authored content above, Evaluation_Boards live in a Study_Config
// as Board_Format text, so these validators take the board text as input. They
// are exercised by tests with fixture boards, and can later be run against a
// real Study_Config. They reuse the same Solver/Pattern helpers so "valid" means
// the same thing everywhere.
// ---------------------------------------------------------------------------

/** The tiers, ordered by increasing Difficulty. */
const TIER_ORDER: Tier[] = ['Beginner', 'Intermediate', 'Expert'];

/** Difficulty rank for comparisons; higher means harder. */
const TIER_RANK: Record<Tier, number> = { Beginner: 0, Intermediate: 1, Expert: 2 };

/** The tiers at or below a given Difficulty (the tiers an Evaluation_Board must cover). */
function tiersUpTo(tier: Tier): Tier[] {
  return TIER_ORDER.filter((t) => TIER_RANK[t] <= TIER_RANK[tier]);
}

/** The structural signature compared for a matched pre/post pair (22.5). */
export interface BoardSignature {
  width: number;
  height: number;
  mineCount: number;
  threeBV: number;
}

/** Compute the matched-pair signature of a Board from its Board_Format text. */
export function boardSignature(boardText: string): BoardSignature {
  const board = parseBoard(boardText);
  return {
    width: board.width,
    height: board.height,
    mineCount: board.mines.length,
    threeBV: threeBV(board),
  };
}

/** True when two Board signatures match on dimensions, mine count, and 3BV (22.5). */
export function signaturesMatch(a: BoardSignature, b: BoardSignature): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.mineCount === b.mineCount &&
    a.threeBV === b.threeBV
  );
}

/**
 * The set of every Pattern_Type that surfaces anywhere along a Board's
 * Canonical_Solve_Path: from the initial state, repeatedly attribute the
 * Provably_Safe Tiles, record their Pattern_Types, then advance by revealing a
 * Provably_Safe Tile (as the logical solve does) until the Board clears or no
 * progress is possible. Exposed_Mines is attributed via a forced Provably_Mine
 * Tile (a safe Tile is never itself attributed Exposed_Mines), matching the
 * convention used throughout this module.
 */
function patternTypesAlongSolve(initial: GameState): Set<PatternType> {
  const seen = new Set<PatternType>();
  let state = initial;
  for (let guard = 0; guard < 400; guard++) {
    for (const a of attributeSafeTiles(state).values()) seen.add(a.patternType);
    if (forcesProvablyMine(state)) seen.add('Exposed_Mines');

    const result = classifyGame(state);
    if (result.inexact || result.inconsistent) break;

    // Flag forced mines so the win condition can be reached, then reveal one
    // Provably_Safe Tile to advance the Canonical_Solve_Path.
    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Mine' || state.flags.has(key)) continue;
      const [r, c] = key.split(',').map(Number) as Tile;
      state = applyAction(state, { type: 'Flag_Toggle', tile: [r, c] }, 0);
    }

    let progressed = false;
    const safeResult = classifyGame(state);
    if (!safeResult.inexact && !safeResult.inconsistent) {
      for (const [key, cls] of safeResult.classification) {
        if (cls !== 'Provably_Safe') continue;
        if (state.revealed.has(key) || state.flags.has(key)) continue;
        const [r, c] = key.split(',').map(Number) as Tile;
        const action: Action = { type: 'Reveal_Click', tile: [r, c] };
        const targets = revealTargets(state, action);
        if (targets.length === 0) continue;
        if (!targetsAllSafe(targets, classifyGame(state))) continue;
        state = applyAction(state, action, 0);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
    if (state.status === 'won' || state.status === 'lost') {
      // Capture any patterns in the final state too.
      for (const a of attributeSafeTiles(state).values()) seen.add(a.patternType);
      break;
    }
  }
  return seen;
}

/**
 * A fresh GameState for an Evaluation_Board with its Start_Tile already
 * revealed. A full Board (one with a Start_Tile) ignores every action until the
 * Start_Tile reveal, so the Solver-driven helpers must begin from the revealed
 * Opening. Mini_Boards (no Start_Tile) are returned as-is.
 */
function startedGame(boardText: string): GameState {
  const board = parseBoard(boardText);
  let game = createGame(board, 0);
  if (board.startTile) {
    game = applyAction(game, { type: 'Reveal_Click', tile: board.startTile }, 0);
  }
  return game;
}

/** True when a Board (parsed from text) clears to a win with Logical_Moves alone. */
function boardSolvesWithLogic(boardText: string): boolean {
  return solveWithLogic(startedGame(boardText)).status === 'won';
}

/**
 * Validate ONE Evaluation_Board against Requirement 22.6: it parses, its initial
 * state is exactly solvable (No_Guess_Board solvable by logic), it clears with
 * Logical_Moves alone, and its Canonical_Solve_Path contains at least one
 * Pattern_Instance from every tier up to its own Difficulty.
 *
 * `role` is a human-readable label (e.g. "Pre_Beginner") used in issue ids.
 */
export function validateEvaluationBoard(
  role: string,
  tier: Tier,
  boardText: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let game: GameState;
  try {
    game = startedGame(boardText);
  } catch (e) {
    issues.push({ kind: 'evaluation', id: role, message: `fails to parse: ${(e as Error).message}` });
    return issues;
  }

  const result = classifyGame(game);
  if (result.inexact || result.inconsistent) {
    issues.push({
      kind: 'evaluation',
      id: role,
      message: 'is not a No_Guess_Board (initial state is inexact/inconsistent)',
    });
    return issues;
  }

  if (!boardSolvesWithLogic(boardText)) {
    issues.push({
      kind: 'evaluation',
      id: role,
      message: 'does not clear with Logical_Moves alone (not a No_Guess_Board)',
    });
  }

  const seen = patternTypesAlongSolve(startedGame(boardText));
  for (const t of tiersUpTo(tier)) {
    const hasTierPattern = TIER_PATTERNS[t].some((p) => seen.has(p));
    if (!hasTierPattern) {
      issues.push({
        kind: 'evaluation',
        id: role,
        message: `Canonical_Solve_Path contains no ${t}-tier Pattern_Instance (required up to ${tier})`,
      });
    }
  }
  return issues;
}

/** The five Evaluation_Boards of a Study_Config, as Board_Format text or null. */
export interface EvaluationBoards {
  preBeginner: string | null;
  preIntermediate: string | null;
  postBeginner: string | null;
  postIntermediate: string | null;
  postExpert: string | null;
  /** Whether the study includes the Expert tier (Requirement 22.4, 22.6). */
  includesExpert: boolean;
}

/**
 * Validate a Study_Config's Evaluation_Boards against Requirements 22.5 and
 * 22.6. Checks that the four always-required boards (plus Post_Expert only when
 * the config includes Expert) are present and each a logic-solvable
 * No_Guess_Board with the required per-tier pattern coverage (22.6), and that
 * Post_Beginner matches Pre_Beginner and Post_Intermediate matches
 * Pre_Intermediate on dimensions, mine count, and 3BV (22.5). A Post_Expert
 * board is required ONLY when the config includes the Expert tier (22.4/22.6).
 */
export function validateEvaluationBoards(config: EvaluationBoards): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const required: Array<{ role: string; tier: Tier; text: string | null }> = [
    { role: 'Pre_Beginner', tier: 'Beginner', text: config.preBeginner },
    { role: 'Pre_Intermediate', tier: 'Intermediate', text: config.preIntermediate },
    { role: 'Post_Beginner', tier: 'Beginner', text: config.postBeginner },
    { role: 'Post_Intermediate', tier: 'Intermediate', text: config.postIntermediate },
  ];
  if (config.includesExpert) {
    required.push({ role: 'Post_Expert', tier: 'Expert', text: config.postExpert });
  }

  for (const { role, tier, text } of required) {
    if (!text) {
      issues.push({ kind: 'evaluation', id: role, message: 'is required but not configured' });
      continue;
    }
    issues.push(...validateEvaluationBoard(role, tier, text));
  }

  // 22.5 — matched pre/post pairs on dimensions, mine count, and 3BV. Only
  // compare when both boards parse; parse failures are reported above.
  const comparePair = (
    preRole: string,
    pre: string | null,
    postRole: string,
    post: string | null,
  ): void => {
    if (!pre || !post) return;
    let preSig: BoardSignature;
    let postSig: BoardSignature;
    try {
      preSig = boardSignature(pre);
      postSig = boardSignature(post);
    } catch {
      return; // parse failure already reported by validateEvaluationBoard
    }
    if (!signaturesMatch(preSig, postSig)) {
      issues.push({
        kind: 'evaluation',
        id: `${postRole} vs ${preRole}`,
        message:
          `must match on dimensions, mine count, and 3BV ` +
          `(pre ${preSig.width}x${preSig.height} mines=${preSig.mineCount} 3BV=${preSig.threeBV}; ` +
          `post ${postSig.width}x${postSig.height} mines=${postSig.mineCount} 3BV=${postSig.threeBV})`,
      });
    }
  };
  comparePair('Pre_Beginner', config.preBeginner, 'Post_Beginner', config.postBeginner);
  comparePair('Pre_Intermediate', config.preIntermediate, 'Post_Intermediate', config.postIntermediate);

  return issues;
}

/** Run every content check and return all issues (empty means valid). */
export function validateAllContent(): ValidationIssue[] {
  return [
    ...validateSnippets(),
    ...validateCheckpoints(),
    ...validateLessons(),
  ];
}
