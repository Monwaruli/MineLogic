/**
 * The Pattern_Detector (task 6).
 *
 * Pure engine logic, no React or DOM imports, so it runs in tests, Workers, and
 * tools. It answers two questions:
 *
 *  1. For a single Board_State: for every Provably_Safe covered Tile, at what
 *     Deduction_Level is it proven, which revealed Numbers (Anchor_Numbers)
 *     prove it, and which Pattern_Type does that deduction belong to
 *     (Requirement 7.1, 7.2).
 *
 *  2. Across a whole game (a Board and its Move_Log): which Pattern_Instances
 *     appear, when they appear, when the player resolves them, and which ones
 *     are excluded, superseded, or left unresolved (Requirement 7.3-7.7). These
 *     feed Pattern_Recognition_Speed in the Metrics_Engine (Requirement 8.7-8.9)
 *     and the post-game replay (Requirement 16).
 *
 * The Deduction_Level, Anchor_Numbers, and the smallest-proving-subset search
 * are shared with Follow-Along Practice (`practice.ts`): a Pattern_Instance's
 * Anchor_Numbers are defined identically to a Nudge's Anchor_Numbers, so the
 * same `findAnchors` is reused rather than reimplemented.
 *
 * Glossary definitions this module follows exactly:
 *  - Deduction_Level: Single_Clue (one Number, after earlier single-Number
 *    results), Pair_Clue (two Numbers), Multi_Clue (three or more Numbers,
 *    no mine count), Mine_Count (needs the total mine count).
 *  - Reduced_Value: a Number minus the count of its Provably_Mine Neighbors.
 *  - Pattern_Type:
 *      * Exposed_Mines    - a Single_Clue deduction whose anchor Number has a
 *        non-zero Reduced_Value (its covered Neighbors are all mines, which in
 *        turn proves Tiles elsewhere safe).
 *      * Satisfied_Number - a Single_Clue deduction whose anchor Number has a
 *        Reduced_Value of zero (its remaining covered Neighbors are all safe).
 *      * Wall_1_1 / Wall_1_2_1 / Wall_1_2_2_1 - a Pair_Clue deduction whose
 *        Anchor_Numbers sit in a straight run of Numbers, with Reduced_Values
 *        1-1, 1-2-1, or 1-2-2-1, beside a straight line of covered Tiles.
 *      * Subset           - any other Pair_Clue deduction.
 *      * Clue_Chain       - a Multi_Clue deduction.
 *      * Mine_Count_Endgame - a Mine_Count deduction.
 *  - Pattern_Instance: covered Tiles made Provably_Safe by the same
 *    Player_Action, sharing one Pattern_Type and one set of Anchor_Numbers.
 *  - Anchor_Numbers: the smallest set of revealed Numbers that proves the
 *    Pattern_Instance's Tiles safe.
 *
 * See Requirements 7, 8, and 16 and the Design Notes in tasks.md.
 */

import {
  neighbors,
  numberAt,
  tileKey,
  type Board,
  type Tile,
} from './board';
import {
  applyAction,
  createGame,
  type Action,
  type GameState,
} from './game';
import { classify, type BoardState } from './solver';
import { boardStateOf, type DeductionLevel } from './practice';
import type { MoveLog } from './moveLog';

// ---------------------------------------------------------------------------
// Pattern types
// ---------------------------------------------------------------------------

/** One entry of the pattern catalog (glossary Pattern_Type). */
export type PatternType =
  // Beginner tier (Single_Clue).
  | 'Exposed_Mines'
  | 'Satisfied_Number'
  // Intermediate tier (Pair_Clue wall templates).
  | 'Wall_1_1'
  | 'Wall_1_2_1'
  | 'Wall_1_2_2_1'
  // Expert tier.
  | 'Subset' // other Pair_Clue
  | 'Clue_Chain' // Multi_Clue
  | 'Mine_Count_Endgame'; // Mine_Count

/**
 * The attribution of a single Provably_Safe Tile: the level at which it is
 * proven, the Numbers that prove it, and the Pattern_Type of that deduction.
 */
export interface TileAttribution {
  tile: Tile;
  deductionLevel: DeductionLevel;
  /** The smallest set of revealed Numbers proving the Tile safe. */
  anchors: Tile[];
  patternType: PatternType;
  /** True when the total mine count was needed to prove the Tile. */
  needsMineCount: boolean;
}

// ---------------------------------------------------------------------------
// Single-state attribution
// ---------------------------------------------------------------------------

/**
 * Attribute every Provably_Safe covered Tile of a GameState to a Pattern_Type
 * at its lowest Deduction_Level (Requirement 7.1, 7.2).
 *
 * Returns a map from `"row,col"` key to its attribution. Tiles that are not
 * Provably_Safe (or not covered) are absent from the map. Pass an existing
 * Solver result to avoid reclassifying when the caller already has one.
 */
export function attributeSafeTiles(game: GameState): Map<string, TileAttribution> {
  const result = classify(boardStateOf(game));
  const out = new Map<string, TileAttribution>();
  if (result.inexact || result.inconsistent) return out;

  // The set of Provably_Mine Tiles is needed for Reduced_Value.
  const provablyMine = new Set<string>();
  for (const [key, cls] of result.classification) {
    if (cls === 'Provably_Mine') provablyMine.add(key);
  }

  const clues = activeClues(game);

  for (const [key, cls] of result.classification) {
    if (cls !== 'Provably_Safe') continue;
    const [r, c] = parseKey(key);
    const tile: Tile = [r, c];
    const { anchors, level, needsMineCount } = analyzeTile(game, tile, clues);
    const patternType = classifyPattern(game, tile, anchors, level, needsMineCount, provablyMine);
    out.set(key, { tile, deductionLevel: level, anchors, patternType, needsMineCount });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anchor_Numbers and Deduction_Level (count-free local analysis)
// ---------------------------------------------------------------------------

/** A revealed Number together with the keys of its covered Neighbors. */
interface NumberClue {
  tile: Tile;
  number: number;
  coveredNeighbors: string[];
}

/** Collect every revealed Number that borders at least one covered Tile. */
function activeClues(game: GameState): NumberClue[] {
  const { board } = game;
  const { width, height } = board;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const clues: NumberClue[] = [];
  for (const key of game.revealed) {
    if (mineSet.has(key)) continue;
    const [r, c] = parseKey(key);
    const covered: string[] = [];
    for (const nb of neighbors([r, c], width, height)) {
      const nk = tileKey(nb[0], nb[1]);
      if (!game.revealed.has(nk)) covered.push(nk);
    }
    if (covered.length === 0) continue;
    clues.push({
      tile: [r, c],
      number: numberAt([r, c], width, height, mineSet),
      coveredNeighbors: covered,
    });
  }
  return clues;
}

/** Cap on the Solver sub-calls per Tile analysis, so the subset search stays cheap. */
const ANCHOR_SEARCH_BUDGET = 400;
/** Largest Anchor_Numbers set the local search considers (covers the catalog). */
const MAX_ANCHOR_SIZE = 4;

/**
 * Find a Tile's Anchor_Numbers and Deduction_Level: the smallest set of revealed
 * Numbers that proves it safe, trying one Number, then pairs, then larger sets,
 * running the Solver on only those constraints with the total mine count made
 * non-binding. When no local set up to the cap proves it, the total mine count
 * is needed, so the level is Mine_Count and the anchors fall back to the clues
 * that border the Tile (Requirement 7.1, glossary Anchor_Numbers/Deduction_Level).
 *
 * The total mine count is made non-binding by giving the isolated sub-problem a
 * pool of unconstrained slack Tiles large enough to absorb any number of mines,
 * so only the chosen local Numbers constrain the Tile. This is the correct
 * emulation of "these clues alone", unlike pinning the count to the covered
 * total (which would force every covered Tile to be a mine).
 */
function analyzeTile(
  game: GameState,
  target: Tile,
  allClues: NumberClue[],
): { anchors: Tile[]; level: DeductionLevel; needsMineCount: boolean } {
  const targetKey = tileKey(target[0], target[1]);
  const bordering = allClues.filter((c) => c.coveredNeighbors.includes(targetKey));
  const component = connectedClues(bordering, allClues);
  const budget = { remaining: ANCHOR_SEARCH_BUDGET };

  // Phase 1: local Numbers only, smallest subset first (count-free).
  const local = smallestProvingSubset(game, target, component, budget);
  if (local) {
    return {
      anchors: local.map((c) => c.tile),
      level: levelFromSize(local.length),
      needsMineCount: false,
    };
  }

  // Phase 2: the total mine count is needed.
  return {
    anchors: bordering.map((c) => c.tile),
    level: 'Mine_Count',
    needsMineCount: true,
  };
}

/** Map an anchor-set size to the local Deduction_Level (no mine count). */
function levelFromSize(size: number): DeductionLevel {
  if (size <= 1) return 'Single_Clue';
  if (size === 2) return 'Pair_Clue';
  return 'Multi_Clue';
}

/**
 * The connected component of Numbers containing `seeds`: every clue reachable
 * from a seed by hopping through shared covered Tiles. Numbers outside this
 * component share no covered Tile with the target's neighborhood, so they
 * cannot help prove the target.
 */
function connectedClues(seeds: NumberClue[], all: NumberClue[]): NumberClue[] {
  if (seeds.length === 0) return [];
  const inComponent = new Set<NumberClue>(seeds);
  const frontier = [...seeds];
  while (frontier.length > 0) {
    const cur = frontier.pop()!;
    const curCovered = new Set(cur.coveredNeighbors);
    for (const other of all) {
      if (inComponent.has(other)) continue;
      if (other.coveredNeighbors.some((k) => curCovered.has(k))) {
        inComponent.add(other);
        frontier.push(other);
      }
    }
  }
  return [...inComponent];
}

/**
 * Smallest subset of `clues` (by size, then combination order) whose local
 * constraints prove `target` safe, up to MAX_ANCHOR_SIZE and the shared budget.
 */
function smallestProvingSubset(
  game: GameState,
  target: Tile,
  clues: NumberClue[],
  budget: { remaining: number },
): NumberClue[] | null {
  const maxSize = Math.min(clues.length, MAX_ANCHOR_SIZE);
  for (let size = 1; size <= maxSize; size++) {
    const found = combinationsProve(game, target, clues, size, budget);
    if (found) return found;
    if (budget.remaining <= 0) return null;
  }
  return null;
}

/** Try every size-`k` combination of `clues`; return the first that proves safe. */
function combinationsProve(
  game: GameState,
  target: Tile,
  clues: NumberClue[],
  k: number,
  budget: { remaining: number },
): NumberClue[] | null {
  const n = clues.length;
  if (k > n) return null;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    if (budget.remaining-- <= 0) return null;
    const subset = idx.map((i) => clues[i]);
    if (provesSafeLocally(game, target, subset)) return subset;
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return null;
}

/**
 * True when the chosen clues alone prove `target` safe, ignoring the total mine
 * count. The sub-problem contains only the chosen Numbers as revealed Tiles; a
 * pool of unconstrained slack Tiles makes the global count non-binding so that
 * only the local Number constraints decide the target.
 */
function provesSafeLocally(game: GameState, target: Tile, clues: NumberClue[]): boolean {
  const { board } = game;
  const revealed = clues.map((c) => ({ tile: c.tile, number: c.number }));

  // Covered Tiles touched by these clues (the constrained region).
  const constrained = new Set<string>();
  for (const c of clues) for (const k of c.coveredNeighbors) constrained.add(k);
  const targetKey = tileKey(target[0], target[1]);
  if (!constrained.has(targetKey)) return false; // no chosen clue borders T

  // The Solver treats any in-bounds covered Tile as a variable and forces the
  // total mine count. The whole grid minus the revealed clue Tiles is covered;
  // setting mineCount to that covered count would force every covered Tile to be
  // a mine. Instead, make the count non-binding: set it to the number of
  // constrained covered Tiles, so the many unconstrained covered Tiles across
  // the grid form a slack pool that can absorb any feasible number of mines.
  const coveredInGrid = board.width * board.height - revealed.length;
  const unconstrained = coveredInGrid - constrained.size;
  // Choose a count that both local-max-mines and local-min-mines can satisfy
  // using the slack pool. The constrained region holds between 0 and
  // constrained.size mines; the slack pool holds between 0 and `unconstrained`.
  // A count equal to `constrained.size` lets the slack pool take up the rest for
  // the min case and lets the constrained region take its max for the max case,
  // provided there is at least `constrained.size` of slack. When the board is
  // large (the real use case) this always holds; guard it anyway.
  const mineCount = Math.min(constrained.size, unconstrained);
  if (unconstrained < constrained.size) {
    // Too little slack to be sure the count is non-binding; fall back to not
    // proving locally so the Tile is treated as a Mine_Count deduction.
    return false;
  }

  const subState: BoardState = {
    width: board.width,
    height: board.height,
    mineCount,
    revealed,
  };
  const res = classify(subState);
  if (res.inconsistent || res.inexact) return false;
  return res.classification.get(targetKey) === 'Provably_Safe';
}

/**
 * Decide the Pattern_Type of a Provably_Safe Tile from its Anchor_Numbers and
 * Deduction_Level.
 *
 * Interpretation note (the spec is internally inconsistent here): the glossary
 * and Requirement 7.2 describe the wall templates as Pair_Clue deductions, but
 * the classic 1-2-1 and 1-2-2-1 safe deductions geometrically need three and
 * four Numbers, so their minimal Anchor_Numbers set is a Multi_Clue. To keep
 * the catalog coherent and to match the Intermediate tier's teaching of 1-1,
 * 1-2-1, and 1-2-2-1 as named wall patterns, this detector attributes a
 * deduction to a wall template whenever its Anchor_Numbers lie on a single
 * straight line and their Reduced_Value sequence reads 1-1, 1-2-1, or 1-2-2-1.
 * Wall matching takes priority over Subset (Requirement 7.2) and, by the same
 * reasoning, over Clue_Chain. A non-matching Pair_Clue is a Subset and a
 * non-matching Multi_Clue is a Clue_Chain.
 */
export function classifyPattern(
  game: GameState,
  _target: Tile,
  anchors: Tile[],
  level: DeductionLevel,
  needsMineCount: boolean,
  provablyMine: Set<string>,
): PatternType {
  if (needsMineCount || level === 'Mine_Count') return 'Mine_Count_Endgame';

  if (level === 'Single_Clue') {
    // One anchor Number. Satisfied_Number when its Reduced_Value is zero (its
    // remaining covered Neighbors are all safe), otherwise Exposed_Mines (its
    // covered Neighbors are forced mines, which proves Tiles elsewhere safe). A
    // single-clue safe deduction is always one of these two by the glossary.
    const anchor = anchors[0];
    if (anchor && reducedValue(game, anchor, provablyMine) === 0) {
      return 'Satisfied_Number';
    }
    return 'Exposed_Mines';
  }

  // Pair_Clue or Multi_Clue: a straight run of Anchor_Numbers whose
  // Reduced_Value sequence matches a wall template wins, taking priority over
  // Subset and Clue_Chain.
  const wall = matchWallTemplate(game, anchors);
  if (wall) return wall;

  return level === 'Pair_Clue' ? 'Subset' : 'Clue_Chain';
}

// ---------------------------------------------------------------------------
// Reduced_Value and wall templates
// ---------------------------------------------------------------------------

/** The Reduced_Value of a revealed Number: its Number minus its Provably_Mine Neighbors. */
function reducedValue(game: GameState, numberTile: Tile, provablyMine: Set<string>): number {
  const { board } = game;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const value = numberAt(numberTile, board.width, board.height, mineSet);
  let mineNeighbors = 0;
  for (const nb of neighbors(numberTile, board.width, board.height)) {
    if (provablyMine.has(tileKey(nb[0], nb[1]))) mineNeighbors++;
  }
  return value - mineNeighbors;
}

/**
 * Match a straight run of Anchor_Numbers to a wall template.
 *
 * The anchors must lie on one straight line (all in the same row, or all in the
 * same column) at consecutive positions one cell apart, so they form a
 * contiguous straight run beside the covered Tiles they constrain. Ordered
 * along that line, their Reduced_Value sequence must read 1-1, 1-2-1, or
 * 1-2-2-1 (forward or backward, since the templates are symmetric). Returns the
 * matched template or null.
 */
function matchWallTemplate(game: GameState, anchors: Tile[]): PatternType | null {
  if (anchors.length < 2 || anchors.length > 4) return null;

  const sameRow = anchors.every((t) => t[0] === anchors[0][0]);
  const sameCol = anchors.every((t) => t[1] === anchors[0][1]);
  if (!sameRow && !sameCol) return null;

  // Project onto the variable axis and require consecutive integer positions.
  const coords = anchors.map((t) => (sameRow ? t[1] : t[0]));
  const order = anchors
    .map((t, i) => ({ t, v: coords[i] }))
    .sort((x, y) => x.v - y.v);
  for (let i = 1; i < order.length; i++) {
    if (order[i].v - order[i - 1].v !== 1) return null; // a gap breaks the run
  }

  // The template is named from the anchors' Reduced_Values *as the pattern sees
  // them*: the raw Number minus only the mines forced by clues OUTSIDE the
  // anchor set. Subtracting every Provably_Mine neighbor (including the ones the
  // pattern itself proves) would collapse a 1-2-1 run to 0-0-0, because a real
  // 1-2-1 forces the mines under its 1s. `externalProvablyMine` reclassifies
  // the Board with the anchor clues removed, so only externally-known mines are
  // subtracted.
  const external = externalProvablyMine(game, anchors);
  const reduced = order.map((o) => reducedValue(game, o.t, external));

  if (sequenceMatches(reduced, [1, 1])) return 'Wall_1_1';
  if (sequenceMatches(reduced, [1, 2, 1])) return 'Wall_1_2_1';
  if (sequenceMatches(reduced, [1, 2, 2, 1])) return 'Wall_1_2_2_1';
  return null;
}

/**
 * The Provably_Mine Tiles forced by the revealed Numbers *other than* the given
 * anchors. Used to compute a wall run's pattern-relative Reduced_Values: mines
 * that only the anchors themselves force are not subtracted, so a clean 1-2-1
 * run reads 1-2-1 rather than 0-0-0.
 */
function externalProvablyMine(game: GameState, anchors: Tile[]): Set<string> {
  const anchorKeys = new Set(anchors.map((t) => tileKey(t[0], t[1])));
  const base = boardStateOf(game);
  const revealed = base.revealed.filter(
    (r) => !anchorKeys.has(tileKey(r.tile[0], r.tile[1])),
  );
  const res = classify({ ...base, revealed });
  const mines = new Set<string>();
  if (res.inexact || res.inconsistent) return mines;
  for (const [key, cls] of res.classification) {
    if (cls === 'Provably_Mine') mines.add(key);
  }
  return mines;
}

/**
 * True when `seq` equals `pattern` read forward or backward. Wall templates are
 * symmetric, so checking both directions makes the match orientation-free.
 */
function sequenceMatches(seq: number[], pattern: number[]): boolean {
  if (seq.length !== pattern.length) return false;
  const forward = seq.every((v, i) => v === pattern[i]);
  const backward = seq.every((v, i) => v === pattern[pattern.length - 1 - i]);
  return forward || backward;
}

// ---------------------------------------------------------------------------
// Pattern_Instances across a game
// ---------------------------------------------------------------------------

/** The lifecycle status of a Pattern_Instance at game end. */
export type InstanceStatus = 'resolved' | 'excluded' | 'superseded' | 'unresolved';

/**
 * A Pattern_Instance: a group of covered Tiles made Provably_Safe by the same
 * Player_Action, sharing one Pattern_Type and one set of Anchor_Numbers.
 */
export interface PatternInstance {
  /** Stable id (appearance index), unique within one game's detection. */
  id: number;
  patternType: PatternType;
  /** The Anchor_Numbers (revealed Number Tiles) proving this instance. */
  anchors: Tile[];
  /** The covered Tiles that became provable together, row-major. */
  tiles: Tile[];
  /** Elapsed ms of the action after which the Tiles first became provable. */
  appearanceMs: number;
  /** Elapsed ms of the action that resolved the instance, or null. */
  resolutionMs: number | null;
  /** The lifecycle status at game end. */
  status: InstanceStatus;
}

/**
 * Detect every Pattern_Instance across a game, replaying the Board and Move_Log
 * (Requirement 7.3-7.7).
 *
 * The replay mirrors the Metrics_Engine: for each entry it looks at the
 * Board_State before and after the action. A Tile that is newly Provably_Safe
 * after an action (and was not before) appears as part of a Pattern_Instance,
 * grouped by Pattern_Type and Anchor_Numbers. A later action that directly
 * targets one of an instance's Tiles resolves it; a cascade or an untargeting
 * action that merely reveals the Tiles leaves the instance for the game-end
 * sweep (excluded if its Tiles are gone, unresolved otherwise). A Tile that
 * drops to a lower Deduction_Level before resolution supersedes its instance.
 */
export function detectPatternInstances(board: Board, log: MoveLog): PatternInstance[] {
  let state = createGame(board, 0);

  // Open (not yet resolved/superseded) instances, by appearance order.
  const open: PatternInstance[] = [];
  // Finished instances (resolved, excluded, superseded).
  const closed: PatternInstance[] = [];
  let nextId = 0;

  // Attribution of the Board_State before the first action: usually empty for a
  // full Board (nothing revealed yet).
  let prevAttr = attributeSafeTiles(state);

  for (const entry of log.entries) {
    const action: Action = { type: entry.type, tile: entry.tile };
    const before = state;

    // The Target_Tiles this action directly targets (before applying it).
    const targeted = directlyTargetedTiles(before, action);

    // Resolve any open instance whose Tiles include a directly-targeted Tile
    // (Requirement 7.4). Record the resolution and close it.
    if (targeted.size > 0) {
      for (let i = open.length - 1; i >= 0; i--) {
        const inst = open[i];
        if (inst.tiles.some((t) => targeted.has(tileKey(t[0], t[1])))) {
          inst.resolutionMs = entry.elapsedMs;
          inst.status = 'resolved';
          closed.push(inst);
          open.splice(i, 1);
        }
      }
    }

    // Apply the action and re-attribute.
    state = applyAction(before, action, entry.elapsedMs);
    const nextAttr = attributeSafeTiles(state);

    // Supersede: an open instance whose a Tile is still covered but now provable
    // at a strictly lower Deduction_Level than when the instance appeared
    // (Requirement 7.6).
    for (let i = open.length - 1; i >= 0; i--) {
      const inst = open[i];
      let superseded = false;
      for (const t of inst.tiles) {
        const key = tileKey(t[0], t[1]);
        const now = nextAttr.get(key);
        if (!now) continue; // no longer provable here (revealed or gone)
        if (deductionRank(now.deductionLevel) < deductionRank(instanceLevel(inst))) {
          superseded = true;
          break;
        }
      }
      if (superseded) {
        inst.status = 'superseded';
        closed.push(inst);
        open.splice(i, 1);
      }
    }

    // Newly Provably_Safe Tiles: present in nextAttr but not provable (at all)
    // in prevAttr. Group them into instances by Pattern_Type + Anchor_Numbers
    // (Requirement 7.3).
    const fresh: TileAttribution[] = [];
    for (const [key, attr] of nextAttr) {
      if (!prevAttr.has(key)) fresh.push(attr);
    }
    if (fresh.length > 0) {
      const groups = groupByPattern(fresh);
      for (const group of groups) {
        open.push({
          id: nextId++,
          patternType: group.patternType,
          anchors: group.anchors,
          tiles: group.tiles,
          appearanceMs: entry.elapsedMs,
          resolutionMs: null,
          status: 'unresolved',
        });
      }
    }

    prevAttr = nextAttr;
  }

  // Game-end sweep (Requirement 7.5, 7.7): each still-open instance is either
  // excluded (every Tile was revealed by a cascade or untargeting action, so
  // the Tile is no longer covered) or unresolved (a Tile is still covered).
  for (const inst of open) {
    const anyStillCovered = inst.tiles.some(
      (t) => !state.revealed.has(tileKey(t[0], t[1])) && !state.flags.has(tileKey(t[0], t[1])),
    );
    // A loss reveals mines but never the instance's safe Tiles via the engine's
    // mine-exposure, so "revealed" here means genuinely cleared.
    inst.status = anyStillCovered ? 'unresolved' : 'excluded';
    closed.push(inst);
  }

  // Return all instances in appearance order.
  closed.sort((x, y) => x.id - y.id);
  return closed;
}

/** The Deduction_Level an instance appeared at (from its Pattern_Type). */
function instanceLevel(inst: PatternInstance): DeductionLevel {
  return levelOfPattern(inst.patternType);
}

/** Map a Pattern_Type back to the Deduction_Level it represents. */
export function levelOfPattern(type: PatternType): DeductionLevel {
  switch (type) {
    case 'Exposed_Mines':
    case 'Satisfied_Number':
      return 'Single_Clue';
    case 'Wall_1_1':
    case 'Wall_1_2_1':
    case 'Wall_1_2_2_1':
    case 'Subset':
      return 'Pair_Clue';
    case 'Clue_Chain':
      return 'Multi_Clue';
    case 'Mine_Count_Endgame':
      return 'Mine_Count';
  }
}

/** Numeric rank of a Deduction_Level, lowest first. */
function deductionRank(level: DeductionLevel): number {
  switch (level) {
    case 'Single_Clue':
      return 0;
    case 'Pair_Clue':
      return 1;
    case 'Multi_Clue':
      return 2;
    case 'Mine_Count':
      return 3;
  }
}

/**
 * The Tiles a Player_Action directly targets, for resolution (Requirement 7.4):
 *  - Reveal_Click: the clicked covered, unflagged Tile.
 *  - Chord_Click on a satisfied revealed Number: its covered, unflagged
 *    Neighbors (the Number borders those Tiles and the chord reveals them).
 * A Flag_Toggle targets nothing for resolution purposes.
 */
function directlyTargetedTiles(state: GameState, action: Action): Set<string> {
  const { board } = state;
  const { width, height } = board;
  const out = new Set<string>();

  if (action.type === 'Reveal_Click') {
    const key = tileKey(action.tile[0], action.tile[1]);
    if (!state.revealed.has(key) && !state.flags.has(key)) out.add(key);
    return out;
  }

  if (action.type === 'Chord_Click') {
    const key = tileKey(action.tile[0], action.tile[1]);
    if (!state.revealed.has(key)) return out;
    const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
    const number = numberAt(action.tile, width, height, mineSet);
    let flagged = 0;
    const covered: string[] = [];
    for (const nb of neighbors(action.tile, width, height)) {
      const nk = tileKey(nb[0], nb[1]);
      if (state.flags.has(nk)) flagged++;
      else if (!state.revealed.has(nk)) covered.push(nk);
    }
    if (flagged !== number) return out; // Wasted chord targets nothing.
    for (const nk of covered) out.add(nk);
    return out;
  }

  return out;
}

/** A group of fresh Tiles sharing a Pattern_Type and Anchor_Numbers. */
interface PatternGroup {
  patternType: PatternType;
  anchors: Tile[];
  tiles: Tile[];
}

/**
 * Group fresh attributions into Pattern_Instances by Pattern_Type and
 * Anchor_Numbers. Two Tiles share an instance when their Pattern_Type matches
 * and their Anchor_Numbers are the same set (Requirement 7.3).
 */
function groupByPattern(fresh: TileAttribution[]): PatternGroup[] {
  const byKey = new Map<string, PatternGroup>();
  for (const attr of fresh) {
    const anchorKey = attr.anchors
      .map((t) => tileKey(t[0], t[1]))
      .sort()
      .join('|');
    const groupKey = `${attr.patternType}#${anchorKey}`;
    let group = byKey.get(groupKey);
    if (!group) {
      group = { patternType: attr.patternType, anchors: attr.anchors, tiles: [] };
      byKey.set(groupKey, group);
    }
    group.tiles.push(attr.tile);
  }
  // Row-major order within each group for determinism.
  for (const group of byKey.values()) {
    group.tiles.sort(rowMajor);
  }
  return [...byKey.values()];
}

/** Row-major comparison of two Tiles. */
function rowMajor(a: Tile, b: Tile): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** Parse a `"row,col"` key into a Tile. */
function parseKey(key: string): Tile {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}
