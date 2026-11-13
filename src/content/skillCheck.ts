/**
 * Authored Skill_Check content: the three Skill_Check_Snippets (task 7.3).
 *
 * The Onboarding_Flow ends with a Skill_Check: three untimed, partly revealed
 * Boards, one per Difficulty tier, shown in the order Beginner, Intermediate,
 * Expert (Requirement 10.1). Each snippet is a diagnostic probe of misconception
 * M1 (forced guessing): it has exactly one Provably_Safe covered Tile and one or
 * more Trap_Tiles — covered Tiles that are not Provably_Safe but look safe to a
 * player who ignores Neighbors shared between Numbers (glossary Snippet, Trap).
 *
 * The Skill_Check treats the learner's first Reveal_Click as the answer and
 * records it Correct (the Provably_Safe Tile), Trap (a labeled Trap_Tile), or
 * Other (Requirement 10.3, 10.4). After the answer it highlights the
 * Provably_Safe Tile and explains the deduction (Requirement 10.5).
 *
 * Every snippet is authored in Board_Format text (the same text the Board_Parser
 * reads), so it is language-neutral and checkable by the Content_Validator with
 * the Solver (Requirement 10.8, 10.9). The Content_Validator and the content
 * tests verify, for each snippet:
 *   - exactly one Provably_Safe covered Tile (10.8),
 *   - at least one Trap_Tile, none of which is Provably_Safe (10.8),
 *   - the snippet surfaces its tier's deduction (10.9): the Intermediate snippet
 *     is attributed Wall_1_2_1; the Expert snippet's safe tile is an Expert
 *     pattern; the Beginner snippet exercises corner counting (Exposed_Mines).
 *
 * Authoring note (why the compact shapes). A snippet must have *exactly one*
 * Provably_Safe Tile. A satisfied Number always frees every one of its remaining
 * covered Neighbors at once, so a Beginner "Satisfied_Number" probe can never
 * leave exactly one safe Tile; and isolating a single safe Tile forces a
 * multi-Number proof. The verified shapes below are therefore:
 *   - Beginner: corner counting, where the key deduction is a forced MINE
 *     (Exposed_Mines). A safe Tile is never attributed Exposed_Mines (the
 *     detector names a single-Number safe Tile Satisfied_Number), so, exactly as
 *     the Lesson and Checkpoint content checks already do (see lessons.test.ts
 *     and checkpoints.test.ts), the Beginner snippet's tier is verified by the
 *     Provably_Mine Tile its corner counting forces, with the mine count then
 *     proving the single safe Tile.
 *   - Intermediate: a 1-2-1 wall run, whose single safe Tile under the 2 the
 *     detector attributes Wall_1_2_1 (required by 10.9).
 *   - Expert: a mine-count endgame, whose single safe Tile the detector
 *     attributes Mine_Count_Endgame (an Expert-tier pattern).
 * Each shape was confirmed with the Solver and the Pattern_Detector; the content
 * tests and the Content_Validator re-check them on every run.
 *
 * Snippets use an `initialRevealed` set (one or more `revealed` lines), never a
 * Start_Tile, so the probe is visible from the first moment (glossary Snippet).
 */

import type { Tier } from './lessons';

/** One Skill_Check_Snippet: an authored partly-revealed probe Board. */
export interface SkillCheckSnippet {
  /** Stable identifier, unique across all snippets. */
  id: string;
  /** The tier (Difficulty) this snippet probes. */
  tier: Tier;
  /** Board_Format text for the snippet (re-printed canonically when parsed). */
  boardText: string;
  /** The single Provably_Safe covered Tile, as `[row, col]` (Requirement 10.8). */
  safeTile: [number, number];
  /** The Trap_Tiles, each with a short label shown when answered Trap (10.4). */
  traps: Array<{ tile: [number, number]; label: string }>;
  /** The explanation shown after an answer (Requirement 10.5). */
  explanation: string;
}

/**
 * Build Board_Format text for a snippet from a compact spec of its dimensions,
 * mine Tiles, and initially revealed Tiles, in row-major order.
 */
function snippet(
  id: string,
  width: number,
  height: number,
  mines: [number, number][],
  revealed: [number, number][],
): string {
  const lines: string[] = [];
  lines.push('version 1');
  lines.push(`id ${id}`);
  lines.push(`width ${width}`);
  lines.push(`height ${height}`);
  lines.push(`mines ${mines.length}`);
  const sortRowMajor = (a: [number, number], b: [number, number]) =>
    a[0] - b[0] || a[1] - b[1];
  for (const [r, c] of [...mines].sort(sortRowMajor)) lines.push(`mine ${r} ${c}`);
  for (const [r, c] of [...revealed].sort(sortRowMajor)) lines.push(`revealed ${r} ${c}`);
  return lines.join('\n') + '\n';
}

// ===========================================================================
// Beginner snippet — corner counting (Exposed_Mines), one safe by the count
// ===========================================================================
//
// A 2-wide, 3-tall probe. Mines at (0,0) and (1,0). Revealed Numbers (0,1) and
// (2,1) read the covered left column:
//   (0,1) counts {(0,0),(1,0)}  -> a 2 in the corner: both are mines
//   (2,1) counts {(1,0),(2,0)}  -> a 1: one mine among them
// Corner counting forces (0,0) and (1,0) to be mines (Exposed_Mines). With both
// mines accounted for, the total of 2 leaves (2,0) as the single Provably_Safe
// Tile. The forced-mine Tiles are the Trap_Tiles: a guesser might click one.

const beginnerSnippet: SkillCheckSnippet = {
  id: 'skillcheck-beginner',
  tier: 'Beginner',
  boardText: snippet(
    'skillcheck-beginner',
    2,
    3,
    [
      [0, 0],
      [1, 0],
    ],
    [
      [0, 1],
      [2, 1],
    ],
  ),
  safeTile: [2, 0],
  traps: [
    { tile: [0, 0], label: 'the corner' },
    { tile: [1, 0], label: 'below the corner' },
  ],
  explanation:
    'The 2 in the corner touches only two covered tiles, so both are mines. With both mines counted, the last covered tile holds no mine — it is the one provably safe tile, while the two you counted are the mines.',
};

// ===========================================================================
// Intermediate snippet — Wall_1_2_1 (must be attributed to Wall_1_2_1, 10.9)
// ===========================================================================
//
// A 5-wide, 3-tall probe with a vertical 1-2-1 down the left wall. Revealed
// Numbers (0,0)=1,(1,0)=2,(2,0)=1 read 1-2-1 beside the covered column 1. The
// only placement that satisfies all three puts a mine under each end 1, so the
// Tile beside the 2, (1,1), is the single Provably_Safe Tile. The Tiles beside
// the 1s, (0,1) and (2,1), are the Trap_Tiles (they are in fact mines). A
// floating mine somewhere in the untouched right columns keeps the total count
// non-binding, so the 1-2-1 is proven locally and attributed Wall_1_2_1.

const intermediateSnippet: SkillCheckSnippet = {
  id: 'skillcheck-intermediate',
  tier: 'Intermediate',
  boardText: snippet(
    'skillcheck-intermediate',
    5,
    3,
    [
      [0, 1],
      [2, 1],
      [1, 4],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  ),
  safeTile: [1, 1],
  traps: [
    { tile: [0, 1], label: 'beside the top 1' },
    { tile: [2, 1], label: 'beside the bottom 1' },
  ],
  explanation:
    'Reading 1-2-1 down the wall, the only way to satisfy the 2 is a mine beside each end 1. That makes the tile beside the 2 the one provably safe tile — the tiles beside the 1s are mines, not safe guesses.',
};

// ===========================================================================
// Expert snippet — Mine_Count_Endgame (the total count settles the last tile)
// ===========================================================================
//
// A 3-wide, 2-tall probe. Mines total 2, at (0,0) and (0,1). Revealed Numbers:
//   (1,0)=2 over covered {(0,0),(0,1),(1,1)}  — two mines among three, but which
//           two is not forced by this Number alone
//   (1,2)=1 over covered {(0,1),(0,2),(1,1)}
// Covered Tiles: (0,0),(0,1),(0,2),(1,1). The two consistent configurations are
// {(0,0),(0,1)} and {(0,0),(1,1)}; in both, (0,2) is never a mine, so (0,2) is
// the single Provably_Safe Tile — and only the total mine count proves it (no
// pair of local Numbers does), so the detector attributes it Mine_Count_Endgame.
// (0,1) and (1,1) flip between the configurations (Undetermined Trap_Tiles);
// (0,0) is a mine in both.

const expertSnippet: SkillCheckSnippet = {
  id: 'skillcheck-expert',
  tier: 'Expert',
  boardText: snippet(
    'skillcheck-expert',
    3,
    2,
    [
      [0, 0],
      [0, 1],
    ],
    [
      [1, 0],
      [1, 2],
    ],
  ),
  safeTile: [0, 2],
  traps: [
    { tile: [0, 1], label: 'between the numbers' },
    { tile: [1, 1], label: 'below, between the numbers' },
  ],
  explanation:
    'The numbers alone cannot say which tiles are mines — two layouts both fit. But in every layout the far tile holds no mine, so the mine count proves it safe while the tiles between the numbers stay coin-flips.',
};

// ---------------------------------------------------------------------------
// The Skill_Check
// ---------------------------------------------------------------------------

/** The three Skill_Check_Snippets in order: Beginner, Intermediate, Expert (10.1). */
export const SKILL_CHECK_SNIPPETS: SkillCheckSnippet[] = [
  beginnerSnippet,
  intermediateSnippet,
  expertSnippet,
];

/** The snippet for one tier, or undefined when unknown. */
export function snippetForTier(tier: Tier): SkillCheckSnippet | undefined {
  return SKILL_CHECK_SNIPPETS.find((s) => s.tier === tier);
}

/** Look up a snippet by id, or undefined when unknown. */
export function snippetById(id: string): SkillCheckSnippet | undefined {
  return SKILL_CHECK_SNIPPETS.find((s) => s.id === id);
}
