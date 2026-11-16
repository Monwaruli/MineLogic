// @ts-check
/**
 * MineLogic per-difficulty walkthrough clip recorder (silent).
 *
 * Records THREE separate videos — one per difficulty — each showing that
 * tier's tutorial (the Learn_Steps, stepped through) followed by an auto-solved
 * Timed_Game of that difficulty. These are the three embedded walkthrough videos
 * the Week 4 requirement asks for.
 *
 * Output: tools/demo/clips/<tier>.webm  (beginner.webm, intermediate.webm, expert.webm)
 *
 * Usage (repo root), after `npm i -D @playwright/test` + `npx playwright install chromium`:
 *   node tools/demo/record-clips.mjs
 *   node tools/demo/record-clips.mjs beginner   # just one tier
 *
 * The auto-solver uses the basic rules + the subset rule + the mine-count
 * endgame rule, which clear every no-guess board MineLogic generates.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Write straight into public/videos so Vite serves them at /videos/<tier>.webm
// and they deploy with the site (GitHub Pages). Keep each clip small.
const CLIPS_DIR = join(__dirname, '..', '..', 'public', 'videos');
const SITE = process.env.DEMO_URL || 'https://monwaruli.github.io/MineLogic/';

const PACE = { click: 240, step: 1000, read: 2000, learn: 1600, solveCap: 600 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TIER_INDEX = { Beginner: 0, Intermediate: 1, Expert: 2 };
const FILE_OF = { Beginner: 'beginner', Intermediate: 'intermediate', Expert: 'expert' };

/** DOM-reading logical solver (basic + subset + mine-count endgame). */
const SOLVER = () => {
  const cells = Array.from(document.querySelectorAll('[role="gridcell"]'));
  if (cells.length === 0) return { safe: [], mines: [], done: 'no-board' };
  const grid = new Map();
  for (const el of cells) {
    const r = Number(el.getAttribute('data-row'));
    const c = Number(el.getAttribute('data-col'));
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    let state = 'covered'; let n = null;
    if (label.includes(': flagged')) state = 'flagged';
    else if (label.includes(': mine')) state = 'mine';
    else if (label.includes(': empty')) { state = 'number'; n = 0; }
    else if (/: \d+/.test(label)) { state = 'number'; n = Number(label.match(/: (\d+)/)[1]); }
    else if (label.includes(': covered') || label.includes('start tile')) state = 'covered';
    grid.set(r + ',' + c, { r, c, state, n });
  }
  if ([...grid.values()].some((g) => g.state === 'mine')) return { safe: [], mines: [], done: 'lost' };
  const neigh = (r, c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const g = grid.get((r + dr) + ',' + (c + dc));
      if (g) out.push(g);
    }
    return out;
  };
  const safe = new Set(); const mines = new Set(); const constraints = [];
  for (const g of grid.values()) {
    if (g.state !== 'number' || g.n === null || g.n === 0) continue;
    const ns = neigh(g.r, g.c);
    const covered = ns.filter((x) => x.state === 'covered');
    const flagged = ns.filter((x) => x.state === 'flagged');
    if (covered.length === 0) continue;
    const need = g.n - flagged.length;
    const cs = new Set(covered.map((x) => x.r + ',' + x.c));
    if (need === cs.size) for (const k of cs) mines.add(k);
    if (need === 0) for (const k of cs) safe.add(k);
    constraints.push({ cells: cs, need });
  }
  for (let i = 0; i < constraints.length; i++) for (let j = 0; j < constraints.length; j++) {
    if (i === j) continue;
    const A = constraints[i], B = constraints[j];
    if (A.cells.size >= B.cells.size) continue;
    let sub = true; for (const k of A.cells) if (!B.cells.has(k)) { sub = false; break; }
    if (!sub) continue;
    const extra = [...B.cells].filter((k) => !A.cells.has(k));
    const extraNeed = B.need - A.need;
    if (extraNeed === extra.length) for (const k of extra) mines.add(k);
    if (extraNeed === 0) for (const k of extra) safe.add(k);
  }
  const coveredCells = [...grid.values()].filter((g) => g.state === 'covered');
  const counterEl = document.querySelector('[data-testid="mine-counter"]');
  if (counterEl) {
    const mm = (counterEl.textContent || '').match(/-?\d+/);
    if (mm) {
      const rem = Number(mm[0]);
      if (rem === 0) for (const g of coveredCells) safe.add(g.r + ',' + g.c);
      else if (rem === coveredCells.length) for (const g of coveredCells) mines.add(g.r + ',' + g.c);
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

async function clickTile(page, r, c, button) {
  const el = page.locator(`[role="gridcell"][data-row="${r}"][data-col="${c}"]`);
  if ((await el.count()) === 0) return;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ button: button === 'flag' ? 'right' : 'left', timeout: 4000 }).catch(() => {});
}

async function revealStart(page) {
  const start = page.locator('[role="gridcell"][aria-label*="start tile"]');
  if ((await start.count()) > 0) await start.first().click().catch(() => {});
  else await page.locator('[role="gridcell"]').first().click().catch(() => {});
}

async function solveBoard(page) {
  await revealStart(page);
  await sleep(PACE.step);
  for (let i = 0; i < PACE.solveCap; i++) {
    const res = await page.evaluate(SOLVER);
    if (res.done === 'cleared') return true;
    if (res.done === 'lost' || res.done === 'no-board') return false;
    for (const [r, c] of res.mines) { await clickTile(page, r, c, 'flag'); await sleep(PACE.click); }
    for (const [r, c] of res.safe) { await clickTile(page, r, c, 'reveal'); await sleep(PACE.click); }
    if (res.safe.length === 0 && res.mines.length === 0) {
      const again = await page.evaluate(SOLVER);
      if (again.safe.length === 0 && again.mines.length === 0) return again.done === 'cleared';
    }
    if ((await page.getByText('You won').count()) > 0) return true;
  }
  return (await page.getByText('You won').count()) > 0;
}

async function clickText(page, text) {
  const el = page.getByRole('button', { name: text }).or(page.getByText(text, { exact: false }));
  if ((await el.count()) > 0) { await el.first().click().catch(() => {}); return true; }
  return false;
}

/** Skip onboarding if it appears (Skip leaves mastery at 0, fine for a demo). */
async function skipOnboardingIfPresent(page) {
  const skip = page.getByRole('button', { name: 'Skip' });
  if ((await skip.count()) > 0) { await skip.first().click().catch(() => {}); await sleep(PACE.step); }
}

/** Record one tier's clip: its tutorial Learn_Steps, then a solved game. */
async function recordTier(browser, tier) {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
    recordVideo: { dir: CLIPS_DIR, size: { width: 1100, height: 850 } },
    colorScheme: 'dark',
  });
  // Paint the page's base background in the app's slate-900 BEFORE React mounts,
  // so the clip never opens on a white flash during initial load.
  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'html,body{background:#0f172a !important;}';
    document.documentElement.appendChild(style);
  });
  const page = await context.newPage();
  console.log(`[${tier}] opening`);
  await page.goto(SITE, { waitUntil: 'networkidle' });
  // Wait for the dark app shell to actually render, then settle, so the opening
  // frames show the rendered UI rather than a blank/white page.
  await page.waitForSelector('main', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  await skipOnboardingIfPresent(page);

  // --- Tutorial: open the tier's Tutorial step, walk the Learn_Steps. --------
  const tutorialBtns = page.getByRole('button', { name: /^Tutorial$/ });
  const idx = TIER_INDEX[tier];
  if ((await tutorialBtns.count()) > idx) {
    await tutorialBtns.nth(idx).click().catch(() => {});
    await sleep(PACE.step);
    // Step through every Learn_Step (read-only; just click Next).
    for (let i = 0; i < 12; i++) {
      const next = page.locator('[data-testid="learn-next"]');
      if ((await next.count()) === 0) break;
      await sleep(PACE.learn);
      await next.click().catch(() => {});
    }
    // Now on the first Do_Step: pause to show the prompt, then exit the tutorial.
    await sleep(PACE.read);
    const exit = page.locator('[data-testid="tutorial-exit"]');
    if ((await exit.count()) > 0) await exit.click().catch(() => {});
    await sleep(PACE.step);
  }

  // --- Timed game of this tier, auto-solved to a win. ------------------------
  const timed = page.getByRole('button', { name: /Timed/i });
  if ((await timed.count()) > idx) { await timed.nth(idx).click().catch(() => {}); }
  await sleep(PACE.step);
  const won = await solveBoard(page);
  console.log(`[${tier}] solved:`, won);
  await sleep(PACE.read);
  // Hold on the win summary (metrics) a beat longer.
  if ((await page.getByText('You won').count()) > 0) await sleep(PACE.read);

  await context.close(); // flush the video

  // Rename the just-written take to <tier>.webm (newest unnamed take).
  const unnamed = readdirSync(CLIPS_DIR).filter((f) => f.endsWith('.webm') && !['beginner','intermediate','expert'].includes(f.replace('.webm','')));
  if (unnamed.length > 0) {
    // newest first
    unnamed.sort((a, b) => a.localeCompare(b));
    const newest = unnamed[unnamed.length - 1];
    const dest = join(CLIPS_DIR, FILE_OF[tier] + '.webm');
    rmSync(dest, { force: true });
    renameSync(join(CLIPS_DIR, newest), dest);
    console.log(`[${tier}] saved:`, dest);
  }
}

async function main() {
  const only = (process.argv[2] || '').toLowerCase();
  const tiers = ['Beginner', 'Intermediate', 'Expert'].filter(
    (t) => !only || FILE_OF[t] === only,
  );
  if (tiers.length === 0) { console.log('Unknown tier:', only); process.exit(1); }

  mkdirSync(CLIPS_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  for (const tier of tiers) {
    await recordTier(browser, tier);
  }
  await browser.close();
  console.log('Done. Clips in', CLIPS_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
