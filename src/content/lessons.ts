/**
 * Authored tutorial content for the Learn-Then-Do Lessons (task 7.1).
 *
 * This module holds the eight Lessons of the curriculum, one per Pattern_Type:
 *
 *   Beginner:     Exposed_Mines (corner counting), Satisfied_Number (+ chording)
 *   Intermediate: Wall_1_1, Wall_1_2_1, Wall_1_2_2_1
 *   Expert:       Subset, Clue_Chain, Mine_Count_Endgame
 *
 * Each Lesson is authored data: a short list of Learn_Steps (explanations with
 * colored, labeled Overlays drawn on a demonstration Mini_Board) followed by two
 * or three Do_Steps, each on its own 5x5 Mini_Board (Requirement 11.1-11.3).
 *
 * Boards are written in canonical Board_Format text (the same text the Board_
 * Parser reads), so they are language-neutral and checkable by the Content_
 * Validator with the Solver (task 7.3, Requirement 11.11). The Tutorial_Player
 * engine (`src/engine/tutorial.ts`) parses the text into a Board at runtime.
 *
 * Mini_Boards use an `initialRevealed` set (one or more `revealed` lines), never
 * a Start_Tile, so the taught deduction is visible from the first moment the
 * board is shown (glossary Mini_Board). Every Do_Step is authored so its
 * Objective can be met from the initial state using only Logical_Moves (and, for
 * the Satisfied_Number chord lesson, a Chord_Click) — the Solver proves this in
 * the content tests.
 *
 * Overlays reference Tiles by `[row, col]`. The Tutorial_Player UI draws each
 * Overlay role with a distinct border pattern and a text label as well as a
 * color, so each role reads without color vision (Requirement 2.6).
 */

import type { PatternType } from '../engine/patterns';

/** The three curriculum tiers. */
export type Tier = 'Beginner' | 'Intermediate' | 'Expert';

/** An Overlay role drawn on a Learn_Step's demonstration board. */
export type OverlayRole =
  /** An interacting revealed Number the deduction reasons from. */
  | 'clue'
  /** A covered Tile the clues prove safe. */
  | 'safe'
  /** A covered Tile the clues prove is a mine. */
  | 'mine';

/** A single colored, labeled Overlay on a Learn_Step's board (Requirement 11.2). */
export interface LessonOverlay {
  role: OverlayRole;
  /** The Tiles this Overlay marks, as `[row, col]`. */
  tiles: [number, number][];
  /** Short label shown on/with the Overlay (reads without color). */
  label: string;
}

/**
 * A Learn_Step: an explanation shown on a demonstration Mini_Board with Overlays
 * on the interacting Numbers and on the Tiles those Numbers prove safe or mine
 * (Requirement 11.2).
 */
export interface LearnStep {
  /** Board_Format text for the demonstration board. */
  boardText: string;
  /** The explanation shown beside the board. */
  explanation: string;
  /** Overlays drawn on the board for this step. */
  overlays: LessonOverlay[];
}

/** The kind of Objective a Do_Step requires. */
export type ObjectiveKind =
  /** Reveal every Target_Tile (by Reveal_Click or revealing Chord_Click). */
  | 'reveal'
  /** Reveal the Target_Tiles specifically with a Chord_Click (Requirement 11.6). */
  | 'chord';

/**
 * A Do_Step: the learner applies the taught deduction on its own 5x5 Mini_Board
 * to meet the Objective (Requirement 11.3). The Objective lists the Target_Tiles
 * to reveal; the Tutorial_Player marks the step complete once they are all
 * revealed, and (for a `chord` Objective) resets the board if the learner
 * reveals a Target_Tile with a plain Reveal_Click (Requirement 11.6).
 */
export interface DoStep {
  /** Board_Format text for this Do_Step's 5x5 Mini_Board. */
  boardText: string;
  /** Instruction shown to the learner. */
  prompt: string;
  /** How the Objective must be met. */
  objective: ObjectiveKind;
  /** The Target_Tiles that complete the Objective, as `[row, col]`. */
  targets: [number, number][];
  /** For a `chord` Objective, the revealed Number to chord on. */
  chordOn?: [number, number];
}

/** One tutorial Lesson: Learn_Steps then two or three Do_Steps. */
export interface Lesson {
  /** Stable identifier used as the local-storage progress key. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Curriculum tier. */
  tier: Tier;
  /** The Pattern_Type this Lesson teaches. */
  patternType: PatternType;
  /** One-line summary of the pattern. */
  summary: string;
  /** The modeling steps (Requirement 11.2). */
  learnSteps: LearnStep[];
  /** The practice steps, two or three (Requirement 11.3). */
  doSteps: DoStep[];
}

// ---------------------------------------------------------------------------
// Board_Format helpers for authoring 5x5 Mini_Boards
// ---------------------------------------------------------------------------

/**
 * Build canonical Board_Format text for a 5x5 Mini_Board from a compact spec:
 * a list of mine Tiles and a list of initially revealed Tiles. The helper keeps
 * the authored boards short and consistent; the Board_Printer's exact canonical
 * form is produced by re-printing after a parse in the Content_Validator.
 */
function mini(
  id: string,
  mines: [number, number][],
  revealed: [number, number][],
): string {
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
  return lines.join('\n') + '\n';
}

// ===========================================================================
// Beginner tier
// ===========================================================================

/**
 * Exposed_Mines (corner counting). A Number whose covered-Neighbor count equals
 * its (reduced) value forces all those Neighbors to be mines, which in turn
 * frees Tiles elsewhere. The classic case is a corner `1` with a single covered
 * Neighbor: that Neighbor is the mine, and the rest of the board is safe.
 */
const exposedMines: Lesson = {
  id: 'beginner-exposed-mines',
  title: 'Corner counting: exposed mines',
  tier: 'Beginner',
  patternType: 'Exposed_Mines',
  summary:
    'A number touching exactly as many covered tiles as its value marks every one of them as a mine.',
  learnSteps: [
    {
      // A 3x3-ish corner demo inside a 5x5 frame. The `1` at (0,1) touches a
      // single covered Tile (0,0), so (0,0) is a mine and the rest is safe.
      boardText: mini(
        'learn-exposed-mines',
        [[0, 0]],
        [
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
          [1, 0],
          [1, 1],
          [1, 2],
          [1, 3],
          [1, 4],
          [2, 0],
          [2, 1],
          [2, 2],
          [2, 3],
          [2, 4],
          [3, 0],
          [3, 1],
          [3, 2],
          [3, 3],
          [3, 4],
          [4, 0],
          [4, 1],
          [4, 2],
          [4, 3],
          [4, 4],
        ],
      ),
      explanation:
        'The 1 in the corner touches only one covered tile. A 1 means exactly one mine among its neighbors, so that single covered tile must be the mine.',
      overlays: [
        { role: 'clue', tiles: [[0, 1]], label: 'the 1' },
        { role: 'mine', tiles: [[0, 0]], label: 'must be a mine' },
      ],
    },
  ],
  doSteps: [
    {
      // The `1` at (0,1) and (1,1) corner the single mine into (0,0): it is the
      // only covered Neighbor they can count, so (0,0) is Provably_Mine. A
      // far-corner mine at (4,4) keeps the total count non-binding so the rest
      // of the top band is Provably_Safe. Reveal a safe tile the corner frees.
      boardText: mini(
        'do-exposed-mines-1',
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
      prompt:
        'The corner 1 touches just one covered tile, so that tile is the mine. Every other covered tile is safe — reveal one of them to continue.',
      objective: 'reveal',
      targets: [[0, 2]],
    },
    {
      // Mirror corner at the bottom-right: the `1`s at (4,3) and (3,3) corner the
      // mine into (4,4), with a far mine at (0,0) keeping the count non-binding.
      boardText: mini(
        'do-exposed-mines-2',
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
      prompt:
        'One corner 1 has only a single covered neighbor — that neighbor is the mine. Reveal any other covered tile, which you can now prove safe.',
      objective: 'reveal',
      targets: [[4, 2]],
    },
  ],
};

/**
 * Satisfied_Number with chording. A Number whose flagged/known mines already
 * account for its value (Reduced_Value zero) has all its remaining covered
 * Neighbors safe. A Chord_Click reveals them all at once — the fast way to
 * clear them (addresses misconception M2).
 */
const satisfiedNumber: Lesson = {
  id: 'beginner-satisfied-number',
  title: 'Satisfied numbers and chording',
  tier: 'Beginner',
  patternType: 'Satisfied_Number',
  summary:
    'When a number already touches all its mines, every other neighbor is safe — reveal them in one chord click.',
  learnSteps: [
    {
      // A `1` at (2,2) whose only mine is the corner-ish (0,0)-style neighbor.
      // Here the single mine (1,1) is already the one mine the `1` counts, so
      // the `1`'s other covered neighbors are all safe.
      boardText: mini(
        'learn-satisfied-number',
        [[1, 1]],
        [
          [2, 1],
          [2, 2],
          [2, 3],
          [3, 1],
          [3, 2],
          [3, 3],
        ],
      ),
      explanation:
        'This 1 already touches its single mine (marked here). Once you flag that mine, the 1 is satisfied, so every other covered neighbor is safe — one chord click on the number reveals them all at once.',
      overlays: [
        { role: 'clue', tiles: [[2, 2]], label: 'the 1' },
        { role: 'mine', tiles: [[1, 1]], label: 'its one mine' },
        {
          role: 'safe',
          tiles: [
            [1, 2],
            [1, 3],
            [2, 1],
            [2, 3],
            [3, 1],
            [3, 2],
            [3, 3],
          ],
          label: 'all safe',
        },
      ],
    },
  ],
  doSteps: [
    {
      // The `1` at (1,1) touches a single mine, forced into the corner (0,0) by
      // the surrounding revealed Numbers. Once (0,0) is flagged the `1` is
      // satisfied, so a chord on it reveals its four remaining covered
      // neighbors (0,1), (1,0), (1,2), (2,1) — all Provably_Safe.
      boardText: mini(
        'do-satisfied-number-1',
        [[0, 0]],
        [
          [1, 1],
          [0, 2],
          [2, 0],
          [2, 2],
        ],
      ),
      prompt:
        'Flag the mine the 1 touches, then chord on the 1 (press both buttons, or the middle button) to reveal its safe neighbors at once.',
      objective: 'chord',
      targets: [
        [0, 1],
        [1, 0],
        [1, 2],
        [2, 1],
      ],
      chordOn: [1, 1],
    },
    {
      // A tighter variant: the `1` at (1,1) again counts the forced corner mine
      // at (0,0), with more of the board revealed so the chord clears the two
      // remaining covered neighbors (0,1) and (1,0).
      boardText: mini(
        'do-satisfied-number-2',
        [[0, 0]],
        [
          [1, 1],
          [0, 2],
          [1, 2],
          [2, 0],
          [2, 1],
          [2, 2],
        ],
      ),
      prompt:
        'Flag the single mine this 1 touches, then chord the 1 to clear the rest.',
      objective: 'chord',
      targets: [
        [0, 1],
        [1, 0],
      ],
      chordOn: [1, 1],
    },
  ],
};

// ===========================================================================
// Intermediate tier — wall patterns beside a straight line of covered tiles
// ===========================================================================

/**
 * Wall_1_1. A straight run of two `1`s along a wall, each `1` sharing the same
 * two covered Tiles beside the wall. The pair forces exactly one mine among the
 * shared Tiles, leaving the covered Tile past the run safe.
 */
const wall11: Lesson = {
  id: 'intermediate-wall-1-1',
  title: 'Wall pattern 1-1',
  tier: 'Intermediate',
  patternType: 'Wall_1_1',
  summary:
    'Two 1s in a row along a wall share their mine, which frees the tile just past the run.',
  learnSteps: [
    {
      boardText: mini(
        'learn-wall-1-1',
        [[0, 1]],
        [
          [1, 0],
          [1, 1],
          [1, 2],
          [1, 3],
          [1, 4],
          [2, 0],
          [2, 1],
          [2, 2],
          [2, 3],
          [2, 4],
        ],
      ),
      explanation:
        'The two 1s along the top wall both count the same mine in the covered row above them. Because that mine satisfies both, the covered tile beyond the run is safe.',
      overlays: [
        {
          role: 'clue',
          tiles: [
            [1, 1],
            [1, 2],
          ],
          label: 'the 1-1',
        },
        { role: 'safe', tiles: [[0, 3]], label: 'safe' },
      ],
    },
  ],
  doSteps: [
    {
      // Two 1s at (0,0),(0,1) along the top wall, with mines under the run at
      // (1,0),(1,3) and a far mine at (4,4). The 1-1 pair proves (1,2) safe.
      boardText: mini(
        'do-wall-1-1-1',
        [
          [1, 0],
          [1, 3],
          [4, 4],
        ],
        [
          [0, 0],
          [0, 1],
          [0, 2],
          [0, 3],
        ],
      ),
      prompt:
        'Use the run of numbers along the wall to find the covered tile past the run that must be safe, and reveal it.',
      objective: 'reveal',
      targets: [[1, 2]],
    },
    {
      // Mirror along the bottom wall: 1s at (4,3),(4,4) with mines (3,1),(3,4)
      // and a far mine at (0,0). The 1-1 pair proves (3,2) safe.
      boardText: mini(
        'do-wall-1-1-2',
        [
          [3, 1],
          [3, 4],
          [0, 0],
        ],
        [
          [4, 1],
          [4, 2],
          [4, 3],
          [4, 4],
        ],
      ),
      prompt: 'Find the safe tile the 1-1 run frees and reveal it.',
      objective: 'reveal',
      targets: [[3, 2]],
    },
  ],
};

/**
 * Wall_1_2_1. Three Numbers 1-2-1 along a wall. The 2 in the middle forces mines
 * under the two end 1s, leaving the tile beneath the 2 safe.
 */
const wall121: Lesson = {
  id: 'intermediate-wall-1-2-1',
  title: 'Wall pattern 1-2-1',
  tier: 'Intermediate',
  patternType: 'Wall_1_2_1',
  summary:
    'A 1-2-1 along a wall hides mines under the two 1s, so the tile under the 2 is safe.',
  learnSteps: [
    {
      boardText: mini(
        'learn-wall-1-2-1',
        [
          [0, 0],
          [0, 2],
        ],
        [
          [1, 0],
          [1, 1],
          [1, 2],
          [2, 0],
          [2, 1],
          [2, 2],
        ],
      ),
      explanation:
        'Reading 1-2-1 along the wall, the only way to satisfy all three numbers is a mine under each 1. The tile directly under the 2 is then safe.',
      overlays: [
        {
          role: 'clue',
          tiles: [
            [1, 0],
            [1, 1],
            [1, 2],
          ],
          label: 'the 1-2-1',
        },
        {
          role: 'mine',
          tiles: [
            [0, 0],
            [0, 2],
          ],
          label: 'mines',
        },
        { role: 'safe', tiles: [[0, 1]], label: 'safe' },
      ],
    },
  ],
  doSteps: [
    {
      // Numbers (0,0)=1,(0,1)=2,(0,2)=1 read 1-2-1 along the top wall, with mines
      // under the two 1s at (1,0),(1,2) and a far mine at (4,4). The tile under
      // the 2, (1,1), is proved safe by all three Numbers (a wall 1-2-1).
      boardText: mini(
        'do-wall-1-2-1-1',
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
      prompt:
        'Read the numbers along the top wall as 1-2-1 and reveal the one tile they prove safe.',
      objective: 'reveal',
      targets: [[1, 1]],
    },
    {
      // Mirror along the bottom wall: (4,1)=1,(4,2)=2,(4,3)=1 with mines under the
      // 1s at (3,1),(3,3) and a far mine at (0,0). The tile under the 2, (3,2),
      // is safe.
      boardText: mini(
        'do-wall-1-2-1-2',
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
      prompt: 'Find the 1-2-1 along the bottom wall and reveal the safe tile.',
      objective: 'reveal',
      targets: [[3, 2]],
    },
  ],
};

/**
 * Wall_1_2_2_1. Four Numbers reading 1-2-2-1 along a wall. The only placement
 * that satisfies all four puts the two mines under the shared middle cells, so
 * the two outer tiles under the end 1s are safe.
 *
 * Detector note (see patterns.ts and Requirement 11.11): a 1-2-2-1 safe
 * deduction decomposes into smaller sub-deductions, so no single safe Tile
 * carries all four Numbers as its minimal Anchor_Numbers — the Pattern_Detector
 * attributes these safe Tiles as Clue_Chain. The Content_Validator therefore
 * verifies this Lesson by its collinear 1-2-2-1 anchor run (the Numbers read
 * 1-2-2-1 along the wall), not by a single safe Target_Tile's attribution.
 */
const wall1221: Lesson = {
  id: 'intermediate-wall-1-2-2-1',
  title: 'Wall pattern 1-2-2-1',
  tier: 'Intermediate',
  patternType: 'Wall_1_2_2_1',
  summary:
    'A 1-2-2-1 along a wall puts the two mines under the middle, freeing the outer tiles under the end 1s.',
  learnSteps: [
    {
      // Numbers (0,0)=1,(0,1)=2,(0,2)=2,(0,3)=1 read 1-2-2-1 over the covered row
      // below, with the two mines forced into the shared middle cells (1,1),(1,2).
      boardText: mini(
        'learn-wall-1-2-2-1',
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
      explanation:
        'Reading 1-2-2-1 along the wall, the only way to satisfy the two 2s is a mine under each of the two middle cells. The outer tiles under the end 1s are then safe.',
      overlays: [
        {
          role: 'clue',
          tiles: [
            [0, 0],
            [0, 1],
            [0, 2],
            [0, 3],
          ],
          label: 'the 1-2-2-1',
        },
        {
          role: 'mine',
          tiles: [
            [1, 1],
            [1, 2],
          ],
          label: 'mines',
        },
        {
          role: 'safe',
          tiles: [
            [1, 0],
            [1, 3],
          ],
          label: 'both safe',
        },
      ],
    },
  ],
  doSteps: [
    {
      // The 1-2-2-1 run along the top wall. Mines under the middle at (1,1),(1,2)
      // and a far mine at (4,4). The outer tiles (1,0),(1,3) under the end 1s are
      // safe.
      boardText: mini(
        'do-wall-1-2-2-1-1',
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
      prompt:
        'Read 1-2-2-1 along the wall and reveal the two outer tiles under the end 1s that must be safe.',
      objective: 'reveal',
      targets: [
        [1, 0],
        [1, 3],
      ],
    },
    {
      // Mirror along the bottom wall: (4,0)=1,(4,1)=2,(4,2)=2,(4,3)=1 with mines
      // under the middle at (3,1),(3,2) and a far mine at (0,4).
      boardText: mini(
        'do-wall-1-2-2-1-2',
        [
          [3, 1],
          [3, 2],
          [0, 4],
        ],
        [
          [4, 0],
          [4, 1],
          [4, 2],
          [4, 3],
        ],
      ),
      prompt: 'Find the 1-2-2-1 along the bottom wall and clear both safe outer tiles.',
      objective: 'reveal',
      targets: [
        [3, 0],
        [3, 3],
      ],
    },
  ],
};

// ===========================================================================
// Expert tier
// ===========================================================================

/**
 * Subset. Two Numbers where one's covered Neighbors are a subset of the other's.
 * The difference set is forced, which proves tiles safe. This is a Pair_Clue
 * deduction that is not a wall template.
 */
const subset: Lesson = {
  id: 'expert-subset',
  title: 'Subset logic',
  tier: 'Expert',
  patternType: 'Subset',
  summary:
    "When one number's covered tiles sit inside another's, the extra tiles carry the extra mines — and the rest are safe.",
  learnSteps: [
    {
      boardText: mini(
        'learn-subset',
        [[0, 0]],
        [
          [1, 0],
          [1, 1],
          [2, 0],
          [2, 1],
          [2, 2],
        ],
      ),
      explanation:
        "The 1 higher up sees a subset of the lower number's covered tiles. Subtracting the shared part shows where the extra mine must be, which frees the remaining covered tiles.",
      overlays: [
        {
          role: 'clue',
          tiles: [
            [1, 1],
            [2, 1],
          ],
          label: 'compare these',
        },
        { role: 'mine', tiles: [[0, 0]], label: 'mine' },
        { role: 'safe', tiles: [[1, 2]], label: 'safe' },
      ],
    },
  ],
  doSteps: [
    {
      // Row1 reads (1,0)=2,(1,1)=2,(1,2)=1 with mines (0,0),(0,1). The 1 at (1,2)
      // sees a subset of the 2 at (1,1)'s covered tiles; subtracting the shared
      // part proves (2,2) safe. A Pair_Clue that is not a wall run -> Subset.
      boardText: mini(
        'do-subset-1',
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
      prompt:
        'Compare the two numbers. The shared tiles cancel; reveal the tile the leftover count proves safe.',
      objective: 'reveal',
      targets: [[2, 2]],
    },
    {
      // Vertical mirror along the bottom wall: row4 reads 2-2-1 with mines
      // (4,0),(4,1). The 1 at (4,2) sees a subset of the 2 at (4,1); the subset
      // deduction proves (2,2) safe -> Subset.
      boardText: mini(
        'do-subset-2',
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
      prompt: 'Use subset logic on the two numbers to clear a safe tile.',
      objective: 'reveal',
      targets: [[2, 2]],
    },
  ],
};

/**
 * Clue_Chain. Three or more Numbers connected across an area, no single pair of
 * which settles the tile — the chain of constraints together proves it.
 */
const clueChain: Lesson = {
  id: 'expert-clue-chain',
  title: 'Connecting clues (clue chains)',
  tier: 'Expert',
  patternType: 'Clue_Chain',
  summary:
    'Some tiles are only safe once you follow a chain of three or more numbers that constrain each other.',
  learnSteps: [
    {
      boardText: mini(
        'learn-clue-chain',
        [
          [0, 0],
          [2, 2],
        ],
        [
          [0, 1],
          [1, 0],
          [1, 1],
          [1, 2],
          [2, 1],
        ],
      ),
      explanation:
        'No two numbers alone settle the target. Following the chain of three numbers across the area pins the mines down and leaves the target safe.',
      overlays: [
        {
          role: 'clue',
          tiles: [
            [0, 1],
            [1, 1],
            [2, 1],
          ],
          label: 'the chain',
        },
        { role: 'safe', tiles: [[1, 2]], label: 'safe' },
      ],
    },
  ],
  doSteps: [
    {
      // Numbers along row0 (1-2-2-1) with mines (1,1),(1,2) and a far mine at
      // (4,4). The outer tile (1,0) is proved safe only by following three of
      // the Numbers across the run — a Multi_Clue that is not a single wall pair,
      // so the detector attributes it Clue_Chain.
      boardText: mini(
        'do-clue-chain-1',
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
      prompt:
        'Follow the row of numbers as a chain. Reveal the covered tile the whole chain proves safe.',
      objective: 'reveal',
      targets: [[1, 0]],
    },
    {
      // Mirror along the bottom: mines (3,1),(3,2) with a far mine at (0,0). The
      // chain of Numbers along row4 proves the outer tile (3,3) safe.
      boardText: mini(
        'do-clue-chain-2',
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
      prompt: 'Connect the numbers to prove one covered tile safe, then reveal it.',
      objective: 'reveal',
      targets: [[3, 3]],
    },
  ],
};

/**
 * Mine_Count_Endgame. Near the end, the total mine count settles tiles that the
 * local Numbers alone cannot. Here the remaining mines all fit on one side, so
 * the other covered tiles are safe.
 */
const mineCountEndgame: Lesson = {
  id: 'expert-mine-count-endgame',
  title: 'Mine-counter endgame',
  tier: 'Expert',
  patternType: 'Mine_Count_Endgame',
  summary:
    'When the local numbers are not enough, the mine counter itself can prove the last tiles safe.',
  learnSteps: [
    {
      boardText: mini(
        'learn-mine-count',
        [[0, 0]],
        [
          [0, 1],
          [1, 0],
          [1, 1],
          [1, 2],
          [2, 0],
          [2, 1],
          [2, 2],
        ],
      ),
      explanation:
        'The numbers alone leave several tiles undetermined, but the mine counter shows only one mine remains. Once it is placed, every other covered tile is safe.',
      overlays: [
        { role: 'clue', tiles: [[0, 1]], label: 'uses the counter' },
        { role: 'mine', tiles: [[0, 0]], label: 'the last mine' },
        {
          role: 'safe',
          tiles: [
            [0, 2],
            [0, 3],
          ],
          label: 'safe by count',
        },
      ],
    },
  ],
  doSteps: [
    {
      // An L of revealed Numbers in the top-left corner with mines at (0,2) and
      // (2,0), plus a far mine at (4,4). The local Numbers leave (2,2) undecided;
      // only the total mine count proves it safe -> Mine_Count_Endgame.
      boardText: mini(
        'do-mine-count-1',
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
      prompt:
        'The numbers alone are not enough. Use the mine counter to prove the remaining safe tile, then reveal it.',
      objective: 'reveal',
      targets: [[2, 2]],
    },
    {
      // Mirror in the bottom-right corner: mines (4,2),(2,4) with a far mine at
      // (0,0). The mine count proves (2,2) safe.
      boardText: mini(
        'do-mine-count-2',
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
      prompt: 'With the counter in mind, reveal a tile the count proves safe.',
      objective: 'reveal',
      targets: [[2, 2]],
    },
  ],
};

// ---------------------------------------------------------------------------
// The curriculum
// ---------------------------------------------------------------------------

/** Every Lesson, in curriculum order (Requirement 11.1). */
export const LESSONS: Lesson[] = [
  exposedMines,
  satisfiedNumber,
  wall11,
  wall121,
  wall1221,
  subset,
  clueChain,
  mineCountEndgame,
];

/** The Lessons of one tier, in order. */
export function lessonsForTier(tier: Tier): Lesson[] {
  return LESSONS.filter((l) => l.tier === tier);
}

/** Look up a Lesson by its id, or undefined when unknown. */
export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
