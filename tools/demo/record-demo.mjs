// @ts-check
/**
 * MineLogic combined demo recorder (silent).
 *
 * Drives the LIVE GitHub Pages site through a full walkthrough and records it to
 * a single .webm video. No audio (Playwright video is always silent).
 *
 * Flow:
 *   1. Onboarding: answer the two questions, then the three skill-check snippets
 *      by clicking each highlighted provably-safe tile.
 *   2. For each difficulty (Beginner, Intermediate, Expert): open a Timed_Game
 *      and auto-solve it to a WIN with a DOM-reading logical solver (every
 *      generated board is no-guess, so pure logic always clears it), then pause
 *      on the win summary to show the metrics.
 *   3. Daily Sweep: play today's board and win it.
 *   4. Leaderboards: open and cycle the three difficulty tabs.
 *
 * Usage (from the repo root), after the one-time setup below:
 *   node tools/demo/record-demo.mjs
 *
 * One-time setup:
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *
 * Output: tools/demo/out/minelogic-demo.webm  (plus Playwright's raw take).
 * Convert to mp4 if your grader needs it:
 *   ffmpeg -i minelogic-demo.webm minelogic-demo.mp4
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SITE = process.env.DEMO_URL || 'https://monwaruli.github.io/MineLogic/';

// Watchable pacing knobs (ms). Tune these if the video feels fast/slow.
const PACE = {
  click: 260,     // between individual tile clicks while solving
  step: 1100,     // between major UI steps
  read: 2200,     // to let a viewer read a screen (summary, leaderboard)
  solveCap: 400,  // max clicks per difficulty before giving up (safety)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The DOM-reading solver, evaluated inside the page. Returns ONE batch of moves:
 * covered tiles proven safe (to reveal) and covered tiles proven mines (to
 * flag), using the two classic deductions on each revealed number:
 *   - if a number's covered neighbors == its (number - adjacent flags), all
 *     those covered neighbors are mines;
 *   - if a number's adjacent flags == its number, all remaining covered
 *     neighbors are safe.
 * Reads tile state from each button's aria-label and data-row/data-col.
 */
const SOLVER = () => {
  const cells = Array.from(document.querySelectorAll('[role="gridcell"]'));
  if (cells.length === 0) return { safe: [], mines: [], done: 'no-board' };

  /** @type {Map<string, {r:number,c:number,state:string,n:number|null}>} */
  const grid = new Map();
  let maxR = 0, maxC = 0;
  for (const el of cells) {
    const r = Number(el.getAttribute('data-row'));
    const c = Number(el.getAttribute('data-col'));
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    let state = 'covered';
    let n = null;
    if (label.includes(': flagged')) state = 'flagged';
    else if (label.includes(': mine')) state = 'mine';
    else if (label.includes(': empty')) { state = 'number'; n = 0; }
    else if (/: \d+/.test(label)) { state = 'number'; n = Number(label.match(/: (\d+)/)[1]); }
    else if (label.includes(': covered') || label.includes('start tile')) state = 'covered';
    grid.set(r + ',' + c, { r, c, state, n });
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }

  // Lost already?
  if ([...grid.values()].some((g) => g.state === 'mine')) return { safe: [], mines: [], done: 'lost' };

  const neigh = (r, c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const g = grid.get((r + dr) + ',' + (c + dc));
        if (g) out.push(g);
      }
    return out;
  };

  const safe = new Set();
  const mines = new Set();
  const constraints = [];
  for (const g of grid.values()) {
    if (g.state !== 'number' || g.n === null || g.n === 0) continue;
    const ns = neigh(g.r, g.c);
    const covered = ns.filter((x) => x.state === 'covered');
    const flagged = ns.filter((x) => x.state === 'flagged');
    if (covered.length === 0) continue;
    const need = g.n - flagged.length;
    const cells = new Set(covered.map((x) => x.r + ',' + x.c));
    if (need === cells.size) for (const k of cells) mines.add(k);
    if (need === 0) for (const k of cells) safe.add(k);
    constraints.push({ cells, need });
  }
  for (let i = 0; i < constraints.length; i++) {
    for (let j = 0; j < constraints.length; j++) {
      if (i === j) continue;
      const A = constraints[i], B = constraints[j];
      if (A.cells.size >= B.cells.size) continue;
      let subset = true;
      for (const k of A.cells) if (!B.cells.has(k)) { subset = false; break; }
      if (!subset) continue;
      const extra = [...B.cells].filter((k) => !A.cells.has(k));
      const extraNeed = B.need - A.need;
      if (extraNeed === extra.length) for (const k of extra) mines.add(k);
      if (extraNeed === 0) for (const k of extra) safe.add(k);
    }
  }
  const coveredCells = [...grid.values()].filter((g) => g.state === 'covered');
  const counterEl = document.querySelector('[data-testid="mine-counter"]');
  if (counterEl) {
    const mm = (counterEl.textContent || '').match(/-?d+/);
    if (mm) {
      const remainingMines = Number(mm[0]);
      if (remainingMines === 0) for (const g of coveredCells) safe.add(g.r + ',' + g.c);
      else if (remainingMines === coveredCells.length) for (const g of coveredCells) mines.add(g.r + ',' + g.c);
    }
  }
  for (const k of [...safe]) if (mines.has(k)) { safe.delete(k); mines.delete(k); }
  const coveredCount = coveredCells.length;
  return {
    safe: [...safe].map((k) => k.split(',').map(Number)),
    mines: [...mines].map((k) => k.split(',').map(Number)),
    coveredCount,
    done: coveredCount === 0 ? 'cleared' : 'progress',
  };
};

/** Click one tile (reveal = left click, flag = right click). */
async function clickTile(page, r, c, button) {
  const sel = `[role="gridcell"][data-row="${r}"][data-col="${c}"]`;
  const el = page.locator(sel);
  if ((await el.count()) === 0) return;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ button: button === 'flag' ? 'right' : 'left', timeout: 4000 }).catch(() => {});
}

/** Reveal the highlighted Start_Tile to begin a game. */
async function revealStart(page) {
  // The start tile has a distinctive aria-label; fall back to the center tile.
  const start = page.locator('[role="gridcell"][aria-label*="start tile"]');
  if ((await start.count()) > 0) {
    await start.first().click().catch(() => {});
  } else {
    const any = page.locator('[role="gridcell"]');
    await any.first().click().catch(() => {});
  }
}

/** Auto-solve the current board to a win using the DOM solver. */
async function solveBoard(page) {
  await revealStart(page);
  await sleep(PACE.step);

  for (let i = 0; i < PACE.solveCap; i++) {
    const res = await page.evaluate(SOLVER);
    if (res.done === 'cleared') return true;
    if (res.done === 'lost' || res.done === 'no-board') return false;

    // Flag proven mines first (visual + so the safe rule can fire next pass).
    for (const [r, c] of res.mines) {
      await clickTile(page, r, c, 'flag');
      await sleep(PACE.click);
    }
    // Reveal proven-safe tiles.
    for (const [r, c] of res.safe) {
      await clickTile(page, r, c, 'reveal');
      await sleep(PACE.click);
    }

    // If a pass found no deductions but tiles remain, nudge: reveal the start
    // opening again is not possible; break to avoid an infinite loop. (On a
    // no-guess board this should not happen from the start tile.)
    if (res.safe.length === 0 && res.mines.length === 0) {
      // One more evaluate to confirm we are truly stuck.
      const again = await page.evaluate(SOLVER);
      if (again.safe.length === 0 && again.mines.length === 0) return again.done === 'cleared';
    }

    // Did a win summary appear?
    if ((await page.getByText('You won').count()) > 0) return true;
  }
  return (await page.getByText('You won').count()) > 0;
}

/** Click a button/link by its visible text, best-effort. */
async function clickText(page, text, opts = {}) {
  const el = page.getByRole('button', { name: text }).or(page.getByText(text, { exact: false }));
  if ((await el.count()) > 0) {
    await el.first().click().catch(() => {});
    return true;
  }
  return false;
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1100, height: 900 } },
  });
  const page = await context.newPage();

  console.log('Opening', SITE);
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await sleep(PACE.read);

  // --- 1. Onboarding (if shown) ---------------------------------------------
  // Two background questions: pick the first option on each when present.
  if ((await page.getByText('How much Minesweeper', { exact: false }).count()) > 0) {
    await clickText(page, 'Casual player');
    await sleep(PACE.step);
    await clickText(page, 'Mouse');
    await sleep(PACE.step);

    // Three skill-check snippets: after answering, the safe tile is shown; we
    // just need a first reveal, then Next. Click the marked safe tile if we can
    // detect it; otherwise click any covered tile (answer is still recorded).
    for (let i = 0; i < 3; i++) {
      await sleep(PACE.step);
      // Prefer the tile the app will mark safe once answered: we cannot know it
      // before answering, so click a covered tile to register the answer.
      const covered = page.locator('[role="gridcell"][aria-label*="covered"]');
      if ((await covered.count()) > 0) await covered.first().click().catch(() => {});
      await sleep(PACE.read);
      // Advance (Next, or "Go to the hub" on the last snippet).
      const next = page.locator('[data-testid="skillcheck-next"]');
      if ((await next.count()) > 0) await next.click().catch(() => {});
      await sleep(PACE.step);
    }
  }

  // --- 2. A timed game per difficulty ---------------------------------------
  for (const tier of ['Beginner', 'Intermediate', 'Expert']) {
    await sleep(PACE.step);
    // The Hub shows a "Timed game" step link per tier. Open the one for `tier`.
    // Scope by the tier's section heading when possible.
    const timed = page.getByRole('button', { name: new RegExp('Timed', 'i') });
    // There are three; pick by order B/I/E.
    const idx = { Beginner: 0, Intermediate: 1, Expert: 2 }[tier];
    if ((await timed.count()) > idx) {
      await timed.nth(idx).click().catch(() => {});
    }
    await sleep(PACE.step);

    const won = await solveBoard(page);
    await sleep(PACE.read);
    console.log(tier, 'solved:', won);

    // Pause on the summary, then go Home for the next tier.
    if ((await page.getByText('You won').count()) > 0) await sleep(PACE.read);
    await clickText(page, 'Home');
    await sleep(PACE.step);
  }

  // --- 3. Daily Sweep -------------------------------------------------------
  await sleep(PACE.step);
  if (await clickText(page, 'Daily Sweep')) {
    await sleep(PACE.step);
    const won = await solveBoard(page);
    console.log('Daily Sweep solved:', won);
    await sleep(PACE.read);
    await clickText(page, 'Home');
    await sleep(PACE.step);
  }

  // --- 4. Leaderboards ------------------------------------------------------
  if (await clickText(page, 'Leaderboards')) {
    await sleep(PACE.read);
    for (const tab of ['Beginner', 'Intermediate', 'Expert']) {
      const t = page.locator(`[data-testid="leaderboard-tab-${tab}"]`);
      if ((await t.count()) > 0) await t.click().catch(() => {});
      await sleep(PACE.read);
    }
    const home = page.locator('[data-testid="leaderboard-home"]');
    if ((await home.count()) > 0) await home.click().catch(() => {});
    await sleep(PACE.step);
  }

  await sleep(PACE.read);

  // Finalize: close the context so the video is flushed, then rename it.
  await context.close();
  await browser.close();

  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.webm'));
  if (files.length > 0) {
    const final = join(OUT_DIR, 'minelogic-demo.webm');
    renameSync(join(OUT_DIR, files[0]), final);
    console.log('Saved video:', final);
  } else {
    console.log('No video file produced — check for errors above.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
