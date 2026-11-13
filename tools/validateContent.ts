/**
 * Content_Validator CLI (task 7.3).
 *
 * Checks every authored Board — the Skill_Check_Snippets, the Mastery_Checkpoint
 * Checkpoint_Variations, and the lesson Learn_Step/Do_Step Mini_Boards — with
 * the Solver, and fails the build on any invalid content (Requirement 10.8,
 * 10.9, 11.11, 13.7; the build-gate role in Requirement 17 / tasks.md).
 *
 * Run with: npm run validate:content
 * (which invokes vite-node on this file). Exits 0 when all content is valid,
 * and 1 — printing each problem — when any check fails, so CI and the local
 * build can gate on it.
 *
 * All validation logic lives in `src/content/validate.ts` (pure, also exercised
 * by the content test suite); this file is only the CLI wrapper.
 */

import {
  validateAllContent,
  validateSnippets,
  validateCheckpoints,
  validateLessons,
} from '../src/content/validate';

function main(): void {
  const snippetIssues = validateSnippets();
  const checkpointIssues = validateCheckpoints();
  const lessonIssues = validateLessons();
  const all = [...snippetIssues, ...checkpointIssues, ...lessonIssues];

  // Sanity: validateAllContent aggregates the same checks.
  const aggregate = validateAllContent();

  console.log('MineLogic Content_Validator');
  console.log('---------------------------');
  console.log(
    `Skill_Check_Snippets:    ${snippetIssues.length === 0 ? 'OK' : `${snippetIssues.length} issue(s)`}`,
  );
  console.log(
    `Checkpoint_Variations:   ${checkpointIssues.length === 0 ? 'OK' : `${checkpointIssues.length} issue(s)`}`,
  );
  console.log(
    `Lesson Mini_Boards:      ${lessonIssues.length === 0 ? 'OK' : `${lessonIssues.length} issue(s)`}`,
  );

  if (all.length === 0 && aggregate.length === 0) {
    console.log('\nAll authored content is valid.');
    process.exit(0);
  }

  console.error('\nInvalid content found:');
  for (const issue of all) {
    console.error(`  [${issue.kind}] ${issue.id}: ${issue.message}`);
  }
  console.error(`\n${all.length} issue(s). Content validation failed.`);
  process.exit(1);
}

main();
