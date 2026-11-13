# Implementation Plan: MineLogic Platform

## Overview

MineLogic is built in the order agreed with the user. First come the board engine, the Solver, and the no-guess Board_Generator, then timed games with metrics, then practice with hints, then tutorials, the Supabase backend, and the study features. Each task should leave the app working and its tests passing.

requirements.md is much more detailed than this class project needs. Implement what each task lists, use the referenced criteria to settle details, and skip criteria that a task does not list. There is no design.md. The design decisions are below.

## Design Notes

- Stack: Vite, React 18, TypeScript (strict), and Tailwind CSS at the repository root. Tests use Vitest and fast-check. npm scripts: `dev`, `build`, `test` (runs once), `typecheck`.
- Layout: pure game logic goes in `src/engine/` with no React or DOM imports, so it runs in tests, Web Workers, and tools. UI goes in `src/ui/`, authored lessons and boards in `src/content/`, the backend in `supabase/`, and Python tools in `tools/`.
- Tiles are `[row, col]`, zero-based. Row-major order sorts by row, then column. Width is the number of columns.
- Determinism: the Solver stops after a fixed `STEP_BUDGET` of search steps instead of the 1,000 ms limit in Requirement 4.7, so its results never depend on device speed. The Board_Generator uses a seeded 32-bit PRNG, never `Math.random`. The same seed and `GENERATOR_VERSION` always give the same Board.
- The Solver reasons only from revealed Numbers and the Board's total mine count. It never reads flags.
- Board_Format text, shared by TypeScript and Python, has one declaration per line:

      version 1
      id <1 to 64 characters: letters, digits, period, underscore, hyphen>
      width <1-30>
      height <1-30>
      mines <count>
      mine <row> <col>       (one line per mine)
      start <row> <col>      (or one or more lines of: revealed <row> <col>)

## Tasks

- [x] 1. Set up the project and build the board engine
  - Scaffold Vite, React, TypeScript, and Tailwind CSS at the repository root, add Vitest and fast-check, add a `.gitignore` for `node_modules` and `dist`, and replace the starter page with a placeholder MineLogic page.
  - `src/engine/board.ts`: the Board type (identifier, width, height, mine set, and either a Start_Tile or an initial revealed set), 8-connected Neighbors, Numbers, and the Difficulty presets (Beginner 9x9 with 10 mines, Intermediate 16x16 with 40, Expert 30 columns by 16 rows with 99).
  - `src/engine/boardFormat.ts`: the Board_Parser and Board_Printer for the Board_Format above. The printer writes declarations in the order shown, Tiles in row-major order, and LF line endings. The parser accepts CRLF and blank lines and rejects the cases in Requirement 3.2 with the failed rule and the line number.
  - `src/engine/game.ts`: the Board_Engine. It applies Reveal_Click, Flag_Toggle, and Chord_Click; cascades through zero-Number Tiles (8-connected, stopped by flags); detects wins and losses; computes the mine counter; ignores every action except the Start_Tile's Reveal_Click until the Start_Tile is revealed; and appends each applied action to the Move_Log with the elapsed milliseconds since the Start_Tile reveal and a Wasted_Click mark (a Chord_Click that changes nothing).
  - Tests: unit tests for each rule, and property tests that printing then parsing a Board gives the same Board and the same text, that a revealed Tile never becomes covered, and that no action reveals a flagged Tile.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 2. Build the constraint satisfaction Solver
  - `src/engine/solver.ts`: `classify(state, stepBudget = STEP_BUDGET)` returns Provably_Safe, Provably_Mine, or Undetermined for every covered Tile, an `inexact` flag, and an `inconsistent` error when no mine placement fits.
  - Algorithm: make one constraint per revealed Number over its covered Neighbors. Apply single-Number and subset (pair) rules first. Split the remaining constrained Tiles into connected components and backtrack over each component with propagation, recording for each possible mine count whether each Tile can be a mine and whether it can be safe. Combine the components and the covered Tiles that border no Number with a subset-sum check over mine counts, so that the total mine count holds (the leftover mines must fit in the unconstrained Tiles). A Tile is Provably_Safe when no consistent placement makes it a mine, and Provably_Mine when none makes it safe.
  - Count every search node against the budget. Pick `STEP_BUDGET` so that the worst Expert case takes about 1 second on a typical laptop. When the budget runs out, keep what is proven, mark every other covered Tile Undetermined, and set `inexact`.
  - Tests: a property test that compares the Solver with brute-force enumeration on random small Board_States (up to about 16 covered Tiles) taken from real Boards, plus soundness during random safe play, flag invariance, and agreement under rotation.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_

- [x] 3. Build the no-guess Board_Generator
  - `src/engine/rng.ts`: a seeded 32-bit PRNG such as sfc32.
  - `src/engine/generator.ts`: `generate(difficulty, seed)` picks a Start_Tile and places mines uniformly at random outside the Start_Tile and its Neighbors. It then checks the Board by revealing the Start_Tile's Opening and repeatedly revealing every Provably_Safe Tile with its Cascade until every non-mine Tile is revealed. A Board that gets stuck or reaches an `inexact` state is rejected, and the next layout is drawn from the same PRNG. It returns the Board with metadata stored beside it: the seed, `GENERATOR_VERSION`, and 3BV.
  - `src/engine/threeBV.ts`: 3BV is the number of Openings plus the number of non-mine Tiles that border no zero-Number Tile.
  - `src/engine/generator.worker.ts` and an async wrapper, so that generation runs off the main thread.
  - Add `npm run bench:gen`, which reports generation times per Difficulty. If Expert Boards take more than about 3 seconds, add mine perturbation: when the check gets stuck, move one mine from beside the frontier to a covered Tile that borders no revealed Number, using the same PRNG, then check again from the start.
  - Tests: the same seed gives the same Board; every generated Board clears with the Solver alone; every state along the clearing has a Provably_Safe Tile; and 3BV matches hand-counted examples and the click count of the 3BV model (reveal one Tile per Opening, then each remaining non-mine Tile).
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.6_

- [x] 4. Make timed no-guess games playable, with metrics
  - [x] 4.1 Build the Move_Log format and the Metrics_Engine
    - `src/engine/moveLog.ts`: a versioned text serializer and parser for Move_Logs. Each entry has an action type, a Tile, elapsed milliseconds, and a Wasted_Click mark, and an End_Entry records the outcome and end time.
    - `src/engine/metrics.ts`: compute the Game_Metrics from only the Board and the Move_Log by replaying the game. Logical_Move_Rate is the share of Reveal_Actions after the Start_Tile reveal whose Target_Tiles were all Provably_Safe just before the action, to one decimal place. Chording_Efficiency is Total_Clicks divided by 3BV, to two decimal places, for won games only. Also report the counts of each click type, Guesses, and Wrong_Flags, and a `partial` mark when an `inexact` state occurred. Label the results with `METRICS_VERSION`. The learner summary and every stored result use this one function.
    - Tests: Move_Log round trip; replay reproduces the final Board_State; two computations give identical results; Logical_Move_Rate stays between 0 and 100.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.10, 8.11, 8.13, 9.1, 9.2, 9.5, 9.6, 9.8_
  - [x] 4.2 Build the board view and the timed game screens
    - `src/ui/BoardView.tsx`: render Boards up to Expert size with Tiles at least 24 px. A primary press reveals. A secondary press flags and suppresses the context menu. A primary or middle press on a revealed Number chords, and so does pressing primary and secondary together. Show the mine counter and a game clock that keeps running while the tab is hidden.
    - A home screen with Beginner, Intermediate, and Expert buttons. The game screen requests a Board from the generator worker with a progress indicator and marks the Start_Tile. The end summary shows the outcome, the time, Logical_Move_Rate, and Chording_Efficiency, each with a one-sentence explanation, within 2 seconds (cache Solver results during play if Expert is slower). Save each result with its Board_Format text and Move_Log in local storage.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

- [x] 5. Add Follow-Along Practice with the two-stage Nudge
  - An untimed practice screen per Difficulty on a generated no-guess Board. Before applying a Reveal_Click or a revealing Chord_Click, get the Solver's classification of the current Board_State, holding the action until it is ready. If any Target_Tile is not Provably_Safe, do not apply the action. Instead, show a message that the Tile cannot be proven safe yet, and show stage 1 of a Nudge.
  - The Hint_Target is the Provably_Safe Tile nearest the clicked Tile by Chebyshev distance, with ties broken in row-major order. Its Anchor_Numbers are the smallest set of revealed Numbers whose constraints alone prove it safe. Find them by trying one Number, then pairs, then larger sets, running the Solver on only those constraints, and add the mine counter when the total mine count is needed. Stage 1 outlines the Hint_Region, the bounding box of the Anchor_Numbers and their covered Neighbors. Stage 2 appears after another intercepted click or a More Help click and also highlights the Anchor_Numbers.
  - Guardrail: a Nudge never reveals, flags, or individually marks the Hint_Target or any other covered Tile.
  - Flags are applied without checks. When the Board is cleared, record the practice completion in local storage and show the number of intercepted clicks and of stage 2 Nudges.
  - Tests: showing a Nudge leaves the Board_State unchanged, and no sequence of practice actions reveals a mine.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.11_

- [x] 6. Add pattern detection, Pattern Recognition Speed, and the post-game replay
  - `src/engine/patterns.ts`: for each Provably_Safe Tile, find its Deduction_Level (one Number, two Numbers, all Numbers, or all Numbers plus the mine count), its Anchor_Numbers, and its Pattern_Type. The types are Exposed_Mines or Satisfied_Number for one Number; Wall_1_1, Wall_1_2_1, or Wall_1_2_2_1 for two-Number deductions along a straight run of Numbers beside a wall; Subset for other two-Number deductions; Clue_Chain for three or more Numbers; and Mine_Count_Endgame when the mine count is needed. Track Pattern_Instances. Each one appears at the action that makes its Tiles provable, is resolved when the player directly reveals one of its Tiles, and is excluded when only Cascades reveal its Tiles.
  - Add Pattern_Recognition_Speed, the median seconds from appearance to resolution for each Pattern_Type, to the Metrics_Engine and the summary.
  - Add a replay after each timed game. It steps forward and back through the Move_Log and labels each action (Logical_Move, Guess, flag, or wasted chord). After a loss, it shows the Board_State before the losing click with every Provably_Safe Tile highlighted and labeled with its Pattern_Type, plus the list of unresolved Pattern_Instances.
  - Tests: hand-built fixtures for each Pattern_Type.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.7, 8.8, 8.9, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

- [x] 7. Add tutorials, mastery checkpoints, videos, and onboarding
  - [x] 7.1 Build the Tutorial_Player and the lesson content
    - Each lesson has Learn_Steps with labeled, colored Overlays and explanations, followed by two or three Do_Steps on 5x5 Mini_Boards that intercept moves that are not provable. Write the lessons for all eight Pattern_Types (two Beginner, three Intermediate, three Expert) as Board_Format text plus JSON metadata in `src/content/`, and save lesson progress in local storage.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9, 11.10_
  - [x] 7.2 Add Mastery_Checkpoints and the Video_Panel
    - A Mastery_Checkpoint passes after three unassisted Checkpoint_Variations in a row with no Guess or Wrong_Flag, drawn from six per Difficulty. The Video_Panel sits beside each tutorial, takes a per-Difficulty video URL from a config file, and shows a "coming soon" placeholder when no URL is set.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.8, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_
  - [x] 7.3 Add onboarding, the Hub, and the Content_Validator
    - Onboarding asks the two Background_Questions and runs the three-snippet Skill_Check. The Hub shows a Mastery_Bar per Difficulty and links to every loop step. `npm run validate:content` checks every authored board with the Solver.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 17.1, 17.2, 17.4, 17.5, 17.7_

- [x] 8. Add the Supabase backend
  - [x] 8.1 Create the schema and Row Level Security
    - SQL migrations in `supabase/migrations/` for profiles, progress, game results, leaderboard entries, and Daily Sweep boards, with Row Level Security on every table. The client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the environment and never holds the service-role key.
    - _Requirements: 27.1, 27.3, 27.8, 27.10, 27.11_
  - [x] 8.2 Add accounts and progress sync
    - Email and password accounts with a Display_Name, guest play from local storage, merging of guest progress on first sign-in, and a Sync_Queue that retries failed writes.
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.6, 20.8, 20.9_
  - [x] 8.3 Add leaderboards and the Daily Sweep
    - Leaderboards per Difficulty that open only after a completed practice board at that Difficulty, with plausibility checks in a database function, and a shared Daily Sweep board per UTC day with the daily and longest streaks.
    - _Requirements: 18.1, 18.4, 18.5, 18.6, 18.7, 18.9, 19.1, 19.3, 19.4, 19.7, 19.8, 19.9, 19.10_

- [x] 9. Add the evaluation study module
  - [x] 9.1 Add study entry, consent, and participant identity
    - A Study_Link with a Study_Code, the consent screen, an anonymous Participant_ID with a Resume_Code, resuming, and withdrawal that deletes the Participant's data.
    - _Requirements: 21.1, 21.2, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9, 21.10, 21.11, 21.12, 21.13_
  - [x] 9.2 Add the pre-test, the learning phase, and the post-test
    - Fixed Evaluation_Boards with matched pre/post pairs, time caps, balanced random Group A/B assignment in a database function, and the Intermediate video shown only to Group A. Test games use the same Metrics_Engine as every other game.
    - _Requirements: 22.1, 22.3, 22.4, 22.5, 22.6, 22.8, 22.9, 22.10, 22.11, 22.12, 23.1, 23.2, 23.3, 23.4, 23.6, 23.7_
  - [x] 9.3 Add the survey, study logging, and data export
    - The in-app survey, Study_Record logging through the Sync_Queue, and CSV export with a data dictionary for Researchers. The dictionary states that the exported metrics are the same Game_Metrics, under the same Metrics_Version, that learners see in game summaries.
    - _Requirements: 24.1, 24.3, 24.4, 24.5, 24.6, 25.1, 25.7, 25.8, 25.9, 25.10, 26.1, 26.2, 26.3, 26.5, 26.7_

- [ ] 10. Deploy and add the offline fallback
  - [ ]* 10.1 Add the build and deploy pipeline (skipped for now: no GitHub yet)
    - A GitHub Actions workflow that runs the type check, the tests, and the content validation, then builds and deploys to GitHub Pages, with a fallback page so that direct URLs and Study_Links load. The build fails if the bundle contains a service-role key.
    - _Requirements: 27.2, 27.9, 28.1, 28.2, 28.3_
  - [ ]* 10.2 Add the Python puzzle bank, only if Expert generation is too slow in the browser
    - A Python generator in `tools/` that writes 1,000 Board_Format Boards per Difficulty, and an importer that checks each Board with the Solver before loading it into Supabase.
    - _Requirements: 6.2, 6.5, 6.6_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["5"] },
    { "id": 6, "tasks": ["6"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2"] },
    { "id": 9, "tasks": ["7.3"] },
    { "id": 10, "tasks": ["8.1"] },
    { "id": 11, "tasks": ["8.2"] },
    { "id": 12, "tasks": ["8.3"] },
    { "id": 13, "tasks": ["9.1"] },
    { "id": 14, "tasks": ["9.2"] },
    { "id": 15, "tasks": ["9.3"] },
    { "id": 16, "tasks": ["10.1", "10.2"] }
  ]
}
```

## Notes

- Tasks marked with `*` are optional. Task 10.1 is optional because the user is not using GitHub for now.
- Work through the tasks in order. Each builds on the ones before it.
