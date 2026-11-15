/**
 * Generate SMALL pattern-focused Evaluation_Boards for a short study (~12 min).
 *
 * Instead of full 9x9 / 16x16 boards (minutes each), we generate small boards
 * that still pass validateEvaluationBoard (No_Guess + the required tier-pattern
 * coverage of 22.6) and clear in seconds. We find matched Pre/Post pairs with
 * identical 3BV (22.5). Beginner uses a small board needing a Beginner pattern;
 * Intermediate uses a slightly larger small board needing Beginner+Intermediate
 * patterns. Both validate fast because the boards are small.
 *
 * Run: npx vite-node tools/makeStudyConfig.ts > study_config.sql
 */
import { generate } from '../src/engine/generator';
import { printBoard } from '../src/engine/boardFormat';
import { threeBV } from '../src/engine/threeBV';
import type { Difficulty } from '../src/engine/board';
import { validateEvaluationBoard } from '../src/content/validate';
import type { Tier } from '../src/content/lessons';

interface Cand { text: string; bv: number; seed: number; }

// Small custom difficulties: big enough to contain the tier patterns, small
// enough to clear and validate in well under a second.
const SMALL: Record<'Beginner' | 'Intermediate', Difficulty> = {
  Beginner: { name: 'Beginner', width: 6, height: 6, mines: 5 } as Difficulty,
  Intermediate: { name: 'Intermediate', width: 8, height: 8, mines: 11 } as Difficulty,
};

/** Find two validated small boards of a tier with equal 3BV. */
function matchedPair(tier: 'Beginner' | 'Intermediate', maxSeeds: number): [Cand, Cand] {
  const byBv = new Map<number, Cand>();
  const diff = SMALL[tier];
  for (let seed = 1; seed <= maxSeeds; seed++) {
    let board;
    try { board = generate(diff, seed).board; } catch { continue; }
    const text = printBoard(board);
    // Must be a valid Evaluation_Board for this tier (22.6 coverage).
    if (validateEvaluationBoard(`${tier}-probe`, tier as Tier, text).length > 0) continue;
    const bv = threeBV(board);
    const prev = byBv.get(bv);
    if (prev) return [prev, { text, bv, seed }];
    byBv.set(bv, { text, bv, seed });
  }
  throw new Error(`No matched ${tier} pair in ${maxSeeds} seeds; widen search or adjust SMALL dims.`);
}

function lit(s: string): string { return "'" + s.replace(/'/g, "''") + "'"; }

function main() {
  const [preBeg, postBeg] = matchedPair('Beginner', 3000);
  const [preInt, postInt] = matchedPair('Intermediate', 6000);
  console.error(`Beginner seeds ${preBeg.seed}/${postBeg.seed} 3BV ${preBeg.bv}`);
  console.error(`Intermediate seeds ${preInt.seed}/${postInt.seed} 3BV ${preInt.bv}`);

  const consentText =
    'Welcome to the MineLogic study. This short (about 10-15 minute) study ' +
    'measures how an interactive Minesweeper tutorial affects logical-deduction ' +
    'skill. You will answer two quick background questions, solve a few small ' +
    'pattern boards, work through a focused lesson, solve a few matched boards ' +
    'again, and complete a brief survey. Your participation is anonymous: no name, ' +
    'email, or IP address is stored, only an anonymous participant code and your ' +
    'gameplay. You may withdraw at any time, which deletes all of your study data.';
  const statements = [
    'I am at least 18 years old.',
    'I have read and understood the information above.',
    'I understand participation is voluntary and anonymous, and I may withdraw at any time.',
    'I consent to my anonymized gameplay and survey answers being used for research.',
  ];
  const ratingItems = [
    'The tutorial was clear and easy to follow.',
    'The pacing felt right.',
    'The hints helped me reason without giving away the answer.',
    'The progress and mastery cues made me want to keep going.',
    'I feel more confident spotting Minesweeper patterns now.',
    'The experience was engaging.',
    'Overall, MineLogic was an effective way to learn.',
  ];
  const openItems = [
    'What was the most confusing part, if any?',
    'What did you find most helpful?',
    'Any other feedback?',
  ];
  const demo = 'How would you describe your prior Minesweeper experience? (new / casual / regular)';

  const sql = `
-- Short-study Study_Config; Study_Link code STUDY1. Small fast Evaluation_Boards.
insert into public.study_configs (
  study_code, active, consent_text, consent_version, consent_statements,
  includes_expert, pre_beginner, pre_intermediate, post_beginner, post_intermediate,
  post_expert, intermediate_video_source,
  survey_rating_items, survey_open_prompts, survey_demographics_item
) values (
  'STUDY1', true, ${lit(consentText)}, 'v2',
  ${lit(JSON.stringify(statements))}::jsonb,
  false,
  ${lit(preBeg.text)}, ${lit(preInt.text)},
  ${lit(postBeg.text)}, ${lit(postInt.text)},
  null, 'https://www.youtube.com/embed/dQw4w9WgXcQ',
  ${lit(JSON.stringify(ratingItems))}::jsonb,
  ${lit(JSON.stringify(openItems))}::jsonb,
  ${lit(demo)}
)
on conflict (study_code) do update set
  active = excluded.active,
  consent_text = excluded.consent_text,
  consent_version = excluded.consent_version,
  consent_statements = excluded.consent_statements,
  includes_expert = excluded.includes_expert,
  pre_beginner = excluded.pre_beginner,
  pre_intermediate = excluded.pre_intermediate,
  post_beginner = excluded.post_beginner,
  post_intermediate = excluded.post_intermediate,
  post_expert = excluded.post_expert,
  intermediate_video_source = excluded.intermediate_video_source,
  survey_rating_items = excluded.survey_rating_items,
  survey_open_prompts = excluded.survey_open_prompts,
  survey_demographics_item = excluded.survey_demographics_item;
`;
  console.log(sql);
}

main();
