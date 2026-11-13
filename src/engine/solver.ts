/**
 * Constraint satisfaction Solver.
 *
 * Classifies every covered Tile of a Board_State as Provably_Safe,
 * Provably_Mine, or Undetermined, using the revealed Numbers and the Board's
 * total mine count only. Flags are never read (flag-invariance).
 *
 * A Consistent_Configuration is an assignment of mine/safe to every covered
 * Tile such that (a) every revealed Number equals the count of mines among its
 * covered Neighbors, and (b) the total number of mines equals the Board's mine
 * count. A Tile is Provably_Safe when it is safe in every Consistent_
 * Configuration, Provably_Mine when it is a mine in every one, and Undetermined
 * otherwise.
 *
 * See the Design Notes in tasks.md and Requirement 4.
 */

import { neighbors, tileKey, type Tile } from './board';

/** Classification of a single covered Tile. */
export type Classification = 'Provably_Safe' | 'Provably_Mine' | 'Undetermined';

/**
 * The Solver's input: a Board_State without flags.
 *
 * `revealed` holds the revealed Tiles with their Numbers. Any in-bounds Tile not
 * present in `revealed` is covered. Flags are intentionally not part of the
 * input, so the Solver cannot depend on them.
 */
export interface BoardState {
  width: number;
  height: number;
  /** The Board's total mine count. */
  mineCount: number;
  /** Revealed Tiles paired with their Number. */
  revealed: Array<{ tile: Tile; number: number }>;
}

/** The Solver's output. */
export interface SolveResult {
  /** `"row,col"` -> classification for every covered Tile. */
  classification: Map<string, Classification>;
  /** True when the search budget ran out before classification finished. */
  inexact: boolean;
  /** True when no mine placement fits the Numbers and the total mine count. */
  inconsistent: boolean;
}

/**
 * Search-node budget. Each backtracking node counts as one step. Picked so that
 * the worst Expert Board_State stays near one second on a typical laptop; this
 * is an estimate until it can be measured on the Reference_Device, and it is
 * exported so callers and tests can reason about it.
 */
export const STEP_BUDGET = 2_000_000;

/** One Number constraint: its covered Tiles must contain exactly `target` mines. */
interface Constraint {
  /** Indices into the shared `varKeys` array. */
  vars: number[];
  target: number;
}

/** Raised internally when the budget is exhausted mid-search. */
class BudgetExceeded extends Error {}

/**
 * Classify every covered Tile of `state`.
 *
 * @param state the Board_State (no flags)
 * @param stepBudget maximum number of search nodes before giving up
 */
export function classify(state: BoardState, stepBudget: number = STEP_BUDGET): SolveResult {
  const { width, height, mineCount } = state;

  const revealedSet = new Set<string>();
  for (const { tile } of state.revealed) revealedSet.add(tileKey(tile[0], tile[1]));

  // All covered Tiles, row-major.
  const coveredKeys: string[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const key = tileKey(r, c);
      if (!revealedSet.has(key)) coveredKeys.push(key);
    }
  }

  // Default every covered Tile to Undetermined.
  const classification = new Map<string, Classification>();
  for (const key of coveredKeys) classification.set(key, 'Undetermined');

  // With no covered Tiles there is nothing to classify.
  if (coveredKeys.length === 0) {
    return { classification, inexact: false, inconsistent: false };
  }

  // Build one constraint per revealed Number over its covered Neighbors.
  // `varIndex` assigns a dense index to each covered Tile that borders a Number.
  const varIndex = new Map<string, number>();
  const varKeys: string[] = [];
  const getVar = (key: string): number => {
    let idx = varIndex.get(key);
    if (idx === undefined) {
      idx = varKeys.length;
      varIndex.set(key, idx);
      varKeys.push(key);
    }
    return idx;
  };

  const rawConstraints: Constraint[] = [];
  for (const { tile, number } of state.revealed) {
    const coveredNeighbors: number[] = [];
    for (const [nr, nc] of neighbors(tile, width, height)) {
      const key = tileKey(nr, nc);
      if (!revealedSet.has(key)) coveredNeighbors.push(getVar(key));
    }
    // A Number whose covered Neighbors exceed it, or exceed what they can hold,
    // signals an inconsistent state. A Number with no covered Neighbors is
    // satisfied only if it is zero.
    if (number < 0 || number > coveredNeighbors.length) {
      return inconsistentResult(classification);
    }
    rawConstraints.push({ vars: coveredNeighbors, target: number });
  }

  // Covered Tiles that border no Number are unconstrained by local Numbers;
  // only the total mine count limits them.
  const unconstrainedCount = coveredKeys.length - varKeys.length;

  // Apply the quick single-Number and subset (pair) rules as fixpoint
  // propagation. This both speeds up search and settles easy Tiles directly.
  const forced = new Map<number, number>(); // var index -> 0 safe / 1 mine
  if (!propagate(rawConstraints, forced)) {
    return inconsistentResult(classification);
  }

  // Split the still-unknown constrained vars into connected components.
  const unknownVars: number[] = [];
  for (let i = 0; i < varKeys.length; i++) {
    if (!forced.has(i)) unknownVars.push(i);
  }
  const components = buildComponents(rawConstraints, unknownVars, forced);

  // For each component, enumerate every satisfying assignment grouped by how
  // many mines it uses. For each mine count we record which vars can be a mine
  // and which can be safe, plus the number of assignments (weight is not needed
  // for classification, only feasibility, so we track booleans).
  const budget = { remaining: stepBudget };

  const componentProfiles: ComponentProfile[] = [];
  try {
    for (const comp of components) {
      componentProfiles.push(enumerateComponent(comp, budget));
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      // Keep only what the quick rules proved; everything else stays
      // Undetermined.
      applyForced(classification, varKeys, forced);
      return { classification, inexact: true, inconsistent: false };
    }
    throw e;
  }

  // Combine components with a subset-sum over per-component mine counts so the
  // Board's total mine count holds. Forced mines count toward the total; the
  // leftover mines must fit in the unconstrained Tiles (0..unconstrainedCount).
  let forcedMines = 0;
  for (const v of forced.values()) forcedMines += v;

  const combo = combineComponents(
    componentProfiles,
    mineCount - forcedMines,
    unconstrainedCount,
  );

  if (!combo.feasible) {
    return inconsistentResult(classification);
  }

  // Forced results first.
  applyForced(classification, varKeys, forced);

  // Constrained unknown vars: classify from the combined feasibility.
  for (let ci = 0; ci < componentProfiles.length; ci++) {
    const profile = componentProfiles[ci];
    const reach = combo.reachableCounts[ci];
    for (let li = 0; li < profile.vars.length; li++) {
      const globalVar = profile.vars[li];
      let canMine = false;
      let canSafe = false;
      for (const count of reach) {
        const perCount = profile.byCount.get(count);
        if (!perCount) continue;
        if (perCount.canMine[li]) canMine = true;
        if (perCount.canSafe[li]) canSafe = true;
      }
      classification.set(varKeys[globalVar], decide(canMine, canSafe));
    }
  }

  // Unconstrained covered Tiles: all interchangeable. They can be a mine if some
  // feasible global solution leaves >=1 mine for them, and safe if some feasible
  // global solution leaves at least one unconstrained Tile unmined.
  if (unconstrainedCount > 0) {
    const canMine = combo.unconstrainedCanMine;
    const canSafe = combo.unconstrainedCanSafe;
    const cls = decide(canMine, canSafe);
    for (const key of coveredKeys) {
      if (!varIndex.has(key)) classification.set(key, cls);
    }
  }

  // Reaching here means classification finished within budget.
  return { classification, inexact: false, inconsistent: false };
}

/** Decide a classification from reachability flags. */
function decide(canMine: boolean, canSafe: boolean): Classification {
  if (canMine && !canSafe) return 'Provably_Mine';
  if (canSafe && !canMine) return 'Provably_Safe';
  return 'Undetermined';
}

/** Build the all-Undetermined inconsistent result. */
function inconsistentResult(classification: Map<string, Classification>): SolveResult {
  return { classification, inexact: false, inconsistent: true };
}

/** Write the forced (quick-rule) results into the classification map. */
function applyForced(
  classification: Map<string, Classification>,
  varKeys: string[],
  forced: Map<number, number>,
): void {
  for (const [v, val] of forced) {
    classification.set(varKeys[v], val === 1 ? 'Provably_Mine' : 'Provably_Safe');
  }
}

/**
 * Fixpoint propagation with single-Number and subset (pair) rules.
 *
 * Mutates `forced` with any var proven mine (1) or safe (0). Returns false when
 * a contradiction is found. This never backtracks, so it is cheap and does not
 * count against the search budget.
 */
function propagate(constraints: Constraint[], forced: Map<number, number>): boolean {
  // Working copy of each constraint as a mutable set of still-unknown vars with
  // a running target that drops as mines get fixed.
  const live = constraints.map((c) => ({
    vars: new Set(c.vars),
    target: c.target,
  }));

  const fix = (v: number, val: number): boolean => {
    const existing = forced.get(v);
    if (existing !== undefined) return existing === val;
    forced.set(v, val);
    for (const lc of live) {
      if (lc.vars.delete(v) && val === 1) lc.target--;
    }
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;

    // Single-Number rule: all remaining vars are mines, or all are safe.
    for (const lc of live) {
      if (lc.vars.size === 0) {
        if (lc.target !== 0) return false;
        continue;
      }
      if (lc.target < 0 || lc.target > lc.vars.size) return false;
      if (lc.target === 0) {
        for (const v of [...lc.vars]) {
          if (!fix(v, 0)) return false;
          changed = true;
        }
      } else if (lc.target === lc.vars.size) {
        for (const v of [...lc.vars]) {
          if (!fix(v, 1)) return false;
          changed = true;
        }
      }
    }
    if (changed) continue;

    // Subset (pair) rule: when A's vars are a subset of B's, the vars in B \ A
    // hold exactly (B.target - A.target) mines. If that equals their size they
    // are all mines; if it is zero they are all safe.
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a.vars.size === 0) continue;
      for (let j = 0; j < live.length; j++) {
        if (i === j) continue;
        const b = live[j];
        if (b.vars.size === 0 || a.vars.size >= b.vars.size) continue;
        if (!isSubset(a.vars, b.vars)) continue;
        const diff: number[] = [];
        for (const v of b.vars) if (!a.vars.has(v)) diff.push(v);
        const diffTarget = b.target - a.target;
        if (diffTarget < 0 || diffTarget > diff.length) return false;
        if (diffTarget === 0) {
          for (const v of diff) {
            if (!fix(v, 0)) return false;
            changed = true;
          }
        } else if (diffTarget === diff.length) {
          for (const v of diff) {
            if (!fix(v, 1)) return false;
            changed = true;
          }
        }
      }
      if (changed) break;
    }
  }

  // Final sanity pass on fully-decided constraints.
  for (const lc of live) {
    if (lc.vars.size === 0 && lc.target !== 0) return false;
  }
  return true;
}

/** True when every element of `a` is in `b`. */
function isSubset(a: Set<number>, b: Set<number>): boolean {
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** A connected group of still-unknown constrained vars and the constraints over them. */
interface Component {
  vars: number[];
  constraints: Constraint[];
}

/**
 * Group the still-unknown vars into connected components. Two vars are connected
 * when they appear together in some constraint (after forced vars are removed).
 */
function buildComponents(
  constraints: Constraint[],
  unknownVars: number[],
  forced: Map<number, number>,
): Component[] {
  const isUnknown = new Set(unknownVars);

  // Reduce each constraint to its unknown vars with target adjusted for forced
  // mines. Drop constraints that end up empty.
  const reduced: Constraint[] = [];
  for (const c of constraints) {
    const vars: number[] = [];
    let target = c.target;
    for (const v of c.vars) {
      const f = forced.get(v);
      if (f === undefined) vars.push(v);
      else if (f === 1) target--;
    }
    if (vars.length > 0) reduced.push({ vars, target });
  }

  // Union-find over unknown vars.
  const parent = new Map<number, number>();
  for (const v of unknownVars) parent.set(v, v);
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const c of reduced) {
    for (let i = 1; i < c.vars.length; i++) union(c.vars[0], c.vars[i]);
  }

  const byRoot = new Map<number, Component>();
  for (const v of unknownVars) {
    if (!isUnknown.has(v)) continue;
    const root = find(v);
    let comp = byRoot.get(root);
    if (!comp) {
      comp = { vars: [], constraints: [] };
      byRoot.set(root, comp);
    }
    comp.vars.push(v);
  }
  for (const c of reduced) {
    const root = find(c.vars[0]);
    byRoot.get(root)!.constraints.push(c);
  }

  return [...byRoot.values()];
}

/** Per-mine-count feasibility for one component. */
interface PerCount {
  /** For local var index `li`, true if it can be a mine at this mine count. */
  canMine: boolean[];
  /** For local var index `li`, true if it can be safe at this mine count. */
  canSafe: boolean[];
}

/** Feasibility profile for one component. */
interface ComponentProfile {
  /** Global var indices, in a fixed local order. */
  vars: number[];
  /** Mine count -> reachability within this component. */
  byCount: Map<number, PerCount>;
}

/**
 * Backtrack over one component, recording for every reachable total mine count
 * which vars can be a mine and which can be safe. Each node counts against the
 * budget.
 */
function enumerateComponent(
  comp: Component,
  budget: { remaining: number },
): ComponentProfile {
  const localIndex = new Map<number, number>();
  comp.vars.forEach((v, i) => localIndex.set(v, i));
  const n = comp.vars.length;

  // Rewrite constraints into local indices.
  const localConstraints = comp.constraints.map((c) => ({
    vars: c.vars.map((v) => localIndex.get(v)!),
    target: c.target,
  }));

  // For pruning: constraints touching each var.
  const touching: number[][] = Array.from({ length: n }, () => []);
  localConstraints.forEach((c, ci) => {
    for (const v of c.vars) touching[v].push(ci);
  });

  const value = new Int8Array(n).fill(-1);
  const remainingTarget = localConstraints.map((c) => c.target);
  const remainingVars = localConstraints.map((c) => c.vars.length);

  const byCount = new Map<number, PerCount>();

  const record = (mineTotal: number): void => {
    let pc = byCount.get(mineTotal);
    if (!pc) {
      pc = {
        canMine: new Array<boolean>(n).fill(false),
        canSafe: new Array<boolean>(n).fill(false),
      };
      byCount.set(mineTotal, pc);
    }
    for (let i = 0; i < n; i++) {
      if (value[i] === 1) pc.canMine[i] = true;
      else pc.canSafe[i] = true;
    }
  };

  const assignVar = (vi: number, val: number): boolean => {
    value[vi] = val;
    // Always update every touched constraint fully so that `undoVar` can
    // reverse exactly the same set. The feasibility check is done after the
    // full update, never mid-loop, otherwise a partial update paired with a
    // full undo would corrupt the running counters.
    let feasible = true;
    for (const ci of touching[vi]) {
      remainingVars[ci]--;
      if (val === 1) remainingTarget[ci]--;
      // Feasibility: need 0 <= remainingTarget <= remainingVars.
      if (remainingTarget[ci] < 0 || remainingTarget[ci] > remainingVars[ci]) {
        feasible = false;
      }
    }
    return feasible;
  };

  const undoVar = (vi: number, val: number): void => {
    for (const ci of touching[vi]) {
      remainingVars[ci]++;
      if (val === 1) remainingTarget[ci]++;
    }
    value[vi] = -1;
  };

  const recurse = (vi: number, mineCount: number): void => {
    if (budget.remaining-- <= 0) throw new BudgetExceeded();
    if (vi === n) {
      // All constraints must be exactly satisfied.
      for (let ci = 0; ci < localConstraints.length; ci++) {
        if (remainingTarget[ci] !== 0) return;
      }
      record(mineCount);
      return;
    }
    // Try safe (0) then mine (1).
    for (const val of [0, 1]) {
      if (assignVar(vi, val)) {
        recurse(vi + 1, mineCount + val);
      }
      undoVar(vi, val);
    }
  };

  recurse(0, 0);

  return { vars: comp.vars, byCount };
}

/** Result of combining components under the total mine-count constraint. */
interface CombineResult {
  feasible: boolean;
  /** For each component, the set of its mine counts used by some global solution. */
  reachableCounts: Array<Set<number>>;
  /** Whether an unconstrained Tile can be a mine in some global solution. */
  unconstrainedCanMine: boolean;
  /** Whether an unconstrained Tile can be safe in some global solution. */
  unconstrainedCanSafe: boolean;
}

/**
 * Subset-sum over per-component mine counts.
 *
 * Choose one mine count per component plus a number of mines placed among the
 * unconstrained Tiles (0..unconstrainedCount) so the parts sum to
 * `remainingMines`. A component count is reachable when it participates in at
 * least one such valid combination. The unconstrained Tiles can be a mine when
 * some valid combination places >=1 mine there, and safe when some valid
 * combination leaves at least one of them unmined.
 */
function combineComponents(
  profiles: ComponentProfile[],
  remainingMines: number,
  unconstrainedCount: number,
): CombineResult {
  const reachableCounts: Array<Set<number>> = profiles.map(() => new Set<number>());

  if (remainingMines < 0) {
    return {
      feasible: false,
      reachableCounts,
      unconstrainedCanMine: false,
      unconstrainedCanSafe: false,
    };
  }

  // Per-component candidate counts (ascending).
  const candidateCounts = profiles.map((p) => [...p.byCount.keys()].sort((a, b) => a - b));

  // Forward DP: prefixSums[k] = set of achievable mine totals using components
  // 0..k-1. Track, per achievable total, which count each component contributed
  // is not needed; we instead do a backward feasibility pass.
  const k = profiles.length;

  // dp[i] = set of totals achievable from components [0, i).
  const dp: Array<Set<number>> = [new Set<number>([0])];
  for (let i = 0; i < k; i++) {
    const next = new Set<number>();
    for (const sofar of dp[i]) {
      for (const cnt of candidateCounts[i]) {
        const t = sofar + cnt;
        if (t <= remainingMines) next.add(t);
      }
    }
    dp.push(next);
  }

  // suffix[i] = set of totals achievable from components [i, k).
  const suffix: Array<Set<number>> = new Array(k + 1);
  suffix[k] = new Set<number>([0]);
  for (let i = k - 1; i >= 0; i--) {
    const s = new Set<number>();
    for (const after of suffix[i + 1]) {
      for (const cnt of candidateCounts[i]) {
        const t = after + cnt;
        if (t <= remainingMines) s.add(t);
      }
    }
    suffix[i] = s;
  }

  let feasible = false;
  let unconstrainedCanMine = false;
  let unconstrainedCanSafe = false;

  // A full assignment is valid when
  //   (sum of component counts) + u == remainingMines
  // for some u in [0, unconstrainedCount]. Equivalently the component total S
  // must lie in [remainingMines - unconstrainedCount, remainingMines].
  const minCompTotal = Math.max(0, remainingMines - unconstrainedCount);
  const maxCompTotal = remainingMines;

  // Determine feasibility and unconstrained flags from the full component total
  // set (dp[k]).
  for (const total of dp[k]) {
    if (total < minCompTotal || total > maxCompTotal) continue;
    feasible = true;
    const u = remainingMines - total; // mines among unconstrained Tiles
    if (u >= 1) unconstrainedCanMine = true;
    if (u <= unconstrainedCount - 1) unconstrainedCanSafe = true;
  }

  if (unconstrainedCount === 0) {
    unconstrainedCanMine = false;
    unconstrainedCanSafe = false;
  }

  if (!feasible) {
    return {
      feasible: false,
      reachableCounts,
      unconstrainedCanMine: false,
      unconstrainedCanSafe: false,
    };
  }

  // A count `cnt` of component i is reachable when there exist a prefix total
  // from dp[i] and a suffix total from suffix[i+1] such that
  //   prefix + cnt + suffix + u == remainingMines, u in [0, unconstrainedCount].
  for (let i = 0; i < k; i++) {
    for (const cnt of candidateCounts[i]) {
      let ok = false;
      for (const pre of dp[i]) {
        if (pre + cnt > remainingMines) continue;
        for (const suf of suffix[i + 1]) {
          const compTotal = pre + cnt + suf;
          if (compTotal < minCompTotal || compTotal > maxCompTotal) continue;
          ok = true;
          break;
        }
        if (ok) break;
      }
      if (ok) reachableCounts[i].add(cnt);
    }
  }

  return { feasible, reachableCounts, unconstrainedCanMine, unconstrainedCanSafe };
}
