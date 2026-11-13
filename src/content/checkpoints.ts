/**
 * Authored Mastery_Checkpoint content: the Checkpoint_Variations (task 7.2).
 *
 * A Mastery_Checkpoint ends each Difficulty's tutorial with an unassisted test.
 * It draws Checkpoint_Variations — small, fully-logical Mini_Boards — from a
 * pool of at least six per Difficulty, and the learner passes after clearing
 * three in a row with no Slip (a Guess or a Wrong_Flag). This module holds those
 * pools (Requirement 13.6, 13.7).
 *
 * Each Checkpoint_Variation is a 5x5 Mini_Board authored in canonical Board_
 * Format text (the same text the Board_Parser reads), so it is language-neutral
 * and checkable by the Content_Validator with the Solver (task 7.3). The boards
 * reuse the geometry proven out for the task 7.1 Lessons, with extra layouts so
 * a pool has six distinct variations per tier.
 *
 * Every variation must satisfy Requirement 13.7:
 *   - it can be cleared from its initial state using only Logical_Moves, and
 *   - its first required deduction is attributed to a Pattern_Type of the
 *     variation's Difficulty tier.
 *
 * Tier -> Pattern_Types (glossary):
 *   Beginner:     Exposed_Mines, Satisfied_Number
 *   Intermediate: Wall_1_1, Wall_1_2_1, Wall_1_2_2_1
 *   Expert:       Subset, Clue_Chain, Mine_Count_Endgame
 *
 * The content tests (`checkpoints.test.ts`) verify both conditions with the
 * Solver and the Pattern_Detector, exactly as the Content_Validator will.
 */

import type { Tier } from './lessons';

/** One Checkpoint_Variation: an authored 5x5 Mini_Board for a Mastery_Checkpoint. */
export interface CheckpointVariation {
  /** Stable identifier, unique across all variations. */
  id: string;
  /** The tier (Difficulty) this variation belongs to. */
  tier: Tier;
  /** Canonical Board_Format text for the 5x5 Mini_Board. */
  boardText: string;
}

/**
 * Build a Checkpoint_Variation from a compact spec of mine Tiles and initially
 * revealed Tiles. The board id doubles as the variation id. The Content_
 * Validator re-prints after a parse to get the exact canonical form; this helper
 * just keeps the authored boards short and sorted.
 */
function variation(
  tier: Tier,
  id: string,
  mines: [number, number][],
  revealed: [number, number][],
): CheckpointVariation {
  const lines: string[] = [];
  lines.push('version 1');
  lines.push(`id ${id}`);
  lines.push('width 5');
  lines.push('height 5');
  lines.push(`mines ${mines.length}`);
  const sortRowMajor = (a: [number, number], b: [number, number]) =>
    a[0] - b[0] || a[1] - b[1];
  for (const [r, c] of [...mines].sort(sortRowMajor)) lines.push(`mine ${r} ${c}`);
  for (const [r, c] of [...revealed].sort(sortRowMajor)) lines.push(`revealed ${r} ${c}`);
  return { id, tier, boardText: lines.join('\n') + '\n' };
}

// ===========================================================================
// Beginner tier — Exposed_Mines (corner counting) and Satisfied_Number
// ===========================================================================
//
// The first required deduction of each Beginner variation is a Single_Clue:
// either a corner Number whose only covered Neighbor is forced to be a mine
// (Exposed_Mines) or a Number whose Reduced_Value is already zero so its other
// covered Neighbors are all safe (Satisfied_Number).

const beginner: CheckpointVariation[] = [
  // 1. Top-left corner 1 with a single covered Neighbor -> that Neighbor is the
  //    mine (Exposed_Mines). A far mine at (4,4) keeps the total count open.
  variation(
    'Beginner',
    'cp-beginner-1',
    [
      [0, 0],
      [4, 4],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  ),
  // 2. Bottom-right mirror of #1.
  variation(
    'Beginner',
    'cp-beginner-2',
    [
      [4, 4],
      [0, 0],
    ],
    [
      [4, 3],
      [3, 4],
      [3, 3],
    ],
  ),
  // 3. Top-right corner 1 -> forced mine at (0,4) (Exposed_Mines).
  variation(
    'Beginner',
    'cp-beginner-3',
    [
      [0, 4],
      [4, 0],
    ],
    [
      [0, 3],
      [1, 4],
      [1, 3],
    ],
  ),
  // 4. Satisfied_Number: the 1 at (1,1) already counts its single mine at the
  //    corner (0,0); its remaining covered Neighbors are all safe.
  variation(
    'Beginner',
    'cp-beginner-4',
    [[0, 0]],
    [
      [1, 1],
      [0, 2],
      [2, 0],
      [2, 2],
    ],
  ),
  // 5. Bottom-left corner 1 -> forced mine at (4,0) (Exposed_Mines).
  variation(
    'Beginner',
    'cp-beginner-5',
    [
      [4, 0],
      [0, 4],
    ],
    [
      [4, 1],
      [3, 0],
      [3, 1],
    ],
  ),
  // 6. Satisfied_Number at the bottom-right: the 1 at (3,3) counts its mine at
  //    (4,4), so its other covered Neighbors are safe.
  variation(
    'Beginner',
    'cp-beginner-6',
    [[4, 4]],
    [
      [3, 3],
      [4, 2],
      [2, 4],
      [2, 2],
    ],
  ),
];

// ===========================================================================
// Intermediate tier — wall pattern 1-2-1
// ===========================================================================
//
// The first required deduction of each Intermediate variation is a Wall_1_2_1:
// a straight run of three Numbers reading 1-2-1 beside a line of covered Tiles,
// with mines forced under the two 1s and the Tile under the 2 proven safe.
//
// These six positions (the Wall_1_2_1 family in distinct places and
// orientations) are the Intermediate pool. Each both clears fully with only
// Logical_Moves and surfaces a Wall_1_2_1 attribution as its first deduction,
// so it satisfies Requirement 13.7. The classic 1-1 and 1-2-2-1 safe deductions
// either leave a residual mine ambiguity that the mine count must settle (which
// changes their attribution away from the Intermediate tier) or never surface
// on a single safe Tile, so the checkpoint pool teaches the tier through the
// clean 1-2-1 template.

const intermediate: CheckpointVariation[] = [
  // 1. 1-2-1 along the top-left wall: mines under the 1s at (1,0),(1,2), (1,1) safe.
  variation(
    'Intermediate',
    'cp-intermediate-1',
    [
      [1, 0],
      [1, 2],
      [4, 4],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
  ),
  // 2. 1-2-1 along the bottom wall: mines under (3,1),(3,3), (3,2) safe.
  variation(
    'Intermediate',
    'cp-intermediate-2',
    [
      [3, 1],
      [3, 3],
      [0, 0],
    ],
    [
      [4, 1],
      [4, 2],
      [4, 3],
    ],
  ),
  // 3. 1-2-1 along the top-right wall: mines under (1,2),(1,4), (1,3) safe.
  variation(
    'Intermediate',
    'cp-intermediate-3',
    [
      [1, 2],
      [1, 4],
      [4, 0],
    ],
    [
      [0, 2],
      [0, 3],
      [0, 4],
    ],
  ),
  // 4. 1-2-1 along the bottom-left wall: mines under (3,0),(3,2), (3,1) safe.
  variation(
    'Intermediate',
    'cp-intermediate-4',
    [
      [3, 0],
      [3, 2],
      [0, 4],
    ],
    [
      [4, 0],
      [4, 1],
      [4, 2],
    ],
  ),
  // 5. Vertical 1-2-1 along the left wall: mines beside (0,1),(2,1), (1,1) safe.
  variation(
    'Intermediate',
    'cp-intermediate-5',
    [
      [0, 1],
      [2, 1],
      [4, 4],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  ),
  // 6. Vertical 1-2-1 along the right wall: mines beside (2,3),(4,3), (3,3) safe.
  variation(
    'Intermediate',
    'cp-intermediate-6',
    [
      [2, 3],
      [4, 3],
      [0, 0],
    ],
    [
      [2, 4],
      [3, 4],
      [4, 4],
    ],
  ),
];

// ===========================================================================
// Expert tier — Subset, Clue_Chain, Mine_Count_Endgame
// ===========================================================================
//
// The first required deduction of each Expert variation is a Pair_Clue that is
// not a wall template (Subset), a Multi_Clue that is not a wall template
// (Clue_Chain), or a deduction that needs the total mine count (Mine_Count_
// Endgame).

const expert: CheckpointVariation[] = [
  // 1. Subset: the 1 at (1,2) sees a subset of the 2 at (1,1); subtracting the
  //    shared Tiles proves (2,2) safe.
  variation(
    'Expert',
    'cp-expert-1',
    [
      [0, 0],
      [0, 1],
    ],
    [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  ),
  // 2. Subset mirror along the bottom wall.
  variation(
    'Expert',
    'cp-expert-2',
    [
      [4, 0],
      [4, 1],
    ],
    [
      [4, 2],
      [3, 0],
      [3, 1],
      [3, 2],
    ],
  ),
  // 3. Clue_Chain: the run of Numbers along the top row proves the outer tile
  //    (1,0) safe only by following three of them (a Multi_Clue, not a wall
  //    pair), so the detector attributes it Clue_Chain.
  variation(
    'Expert',
    'cp-expert-3',
    [
      [1, 1],
      [1, 2],
      [4, 4],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
  ),
  // 4. Clue_Chain mirror along the bottom row, proving (3,3) safe.
  variation(
    'Expert',
    'cp-expert-4',
    [
      [3, 1],
      [3, 2],
      [0, 0],
    ],
    [
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
    ],
  ),
  // 5. Mine_Count_Endgame: an L of Numbers in the top-left corner leaves (2,2)
  //    undecided by the local Numbers; only the total mine count proves it safe.
  variation(
    'Expert',
    'cp-expert-5',
    [
      [0, 2],
      [2, 0],
      [4, 4],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  ),
  // 6. Mine_Count_Endgame mirror in the bottom-right corner, proving (2,2) safe.
  variation(
    'Expert',
    'cp-expert-6',
    [
      [4, 2],
      [2, 4],
      [0, 0],
    ],
    [
      [4, 4],
      [4, 3],
      [3, 4],
      [3, 3],
    ],
  ),
];

// ---------------------------------------------------------------------------
// The pools
// ---------------------------------------------------------------------------

/** Every Checkpoint_Variation, flat, in tier order. */
export const CHECKPOINT_VARIATIONS: CheckpointVariation[] = [
  ...beginner,
  ...intermediate,
  ...expert,
];

/** The Checkpoint_Variation pool for one tier (at least six, Requirement 13.6). */
export function variationsForTier(tier: Tier): CheckpointVariation[] {
  return CHECKPOINT_VARIATIONS.filter((v) => v.tier === tier);
}

/** Look up a Checkpoint_Variation by id, or undefined when unknown. */
export function variationById(id: string): CheckpointVariation | undefined {
  return CHECKPOINT_VARIATIONS.find((v) => v.id === id);
}
