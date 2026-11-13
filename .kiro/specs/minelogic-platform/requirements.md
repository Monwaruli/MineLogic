# Requirements Document

## Introduction

MineLogic is a web platform that teaches Minesweeper as a deductive logic puzzle. It combines an independent learning application, an educational game, and difficulty-specific hints inspired by intelligent tutoring systems. Like Codecademy or Duolingo, MineLogic does the entire instructional job without a teacher: it is both the tool and the curriculum.

The audience is casual puzzle players, college students, and self-directed adults who know the basic rules but are stuck at Beginner or want faster times. They learn in 10 to 15 minute breaks with no instructor, schedule, or grade, so lessons are bite-sized, the site must keep voluntary users engaged, and every concept is offered in more than one form.

Two misconceptions drive the design:

- **M1, forced guessing:** when no number has its mines trivially exposed, players believe they must guess, click blindly, and blame bad luck. MineLogic answers this with boards that are guaranteed solvable by logic, a follow-along mode that intercepts unprovable clicks, the Logical Move Rate metric, Skill Check trap tiles, and a replay that shows the safe tiles a player missed.
- **M2, no chording:** players click every safe tile one by one instead of chording. MineLogic answers this with the Beginner chording lesson, support for every common chord input, and the Chording Efficiency metric.

Three difficulty modes each teach a skill tier:

| Difficulty | Board | Skills taught |
|---|---|---|
| Beginner | 9x9, 10 mines | Corner counting (exposed mines), satisfied numbers and chording |
| Intermediate | 16x16, 40 mines | Wall patterns 1-1, 1-2-1, 1-2-2-1 |
| Expert | 30 columns x 16 rows, 99 mines | Subset logic, connecting clues across areas, mine-counter endgame |

### Pedagogical rationale for the main loop

Each difficulty follows a four-step loop whose order follows cognitive apprenticeship (Collins, Brown & Newman, 1989):

| Loop step | MineLogic feature | Cognitive apprenticeship method |
|---|---|---|
| 1 | Interactive tutorial on 5x5 Mini_Boards, or the narrated video | Modeling |
| 2 | Untimed Follow-Along Practice with the two-stage nudge | Coaching and scaffolding |
| 3 | Timed No-Guess Game with no hints | Fading |
| 4 | Post-game replay that highlights missed safe patterns | Reflection |

The loop moves learners from knowing a rule in isolation to spotting it on a populated grid, and from untimed support to timed play.

### Link between assessment and evaluation

One Metrics_Engine computes Logical Move Rate, Pattern Recognition Speed, and Chording Efficiency from a Board and its Move_Log. The same module produces the numbers shown to learners after a game (assessment) and the numbers stored for the evaluation study (evaluation), so the study's outcome measures and the learner feedback are identical by construction. The study's pre-test and post-test boards are fixed Evaluation_Boards shared by every Participant, so the measures are comparable across Participants and between pre-test and post-test.

### Scope

In scope: the React + TypeScript + Tailwind CSS + Vite client hosted on GitHub Pages, the Supabase back end (PostgreSQL, Auth, Row Level Security), the client-side Solver and Board_Generator, the optional Python Offline_Generator, all learner-facing modes, and the in-app parts of the evaluation study (consent, session flow, logging, survey, export).

Out of scope: recording the three videos (the user records them with the Windows Snipping Tool; MineLogic only embeds them), the think-aloud interviews over Zoom or Teams, the statistical analysis, report writing, touch-screen play, full keyboard-only play, and self-service account deletion.

### Assumptions

These assumptions resolve ambiguities in the proposal. Each one can be changed during review.

1. **Pre-test boards:** the proposal's "guess board" for the Baseline Pre-Test is read as "no-guess board", because Logical Move Rate is only meaningful when every move can be proven.
2. **Daily Sweep:** one shared Daily_Sweep_Board per Sweep_Day. A Sweep_Day runs from 00:00:00 to 23:59:59 UTC so every player sees the same board and the Backend can check submission times. The board uses Intermediate dimensions (16x16, 40 mines) and mixes patterns from all three tiers. Any win on a Sweep_Day keeps the Daily_Streak alive; retries after a loss are allowed, and only a first-attempt win enters that day's leaderboard, so memorizing the board after a loss earns no rank.
3. **Chording Efficiency:** "minimum required clicks" is 3BV, the standard Minesweeper measure. Chording Efficiency = Total_Clicks / 3BV, where Total_Clicks counts every Reveal_Click, Flag_Toggle, and Chord_Click, including wasted ones. Lower values mean fewer clicks per unit of required work, and values below 1.0 are possible with chording.
4. **Logically provable:** a covered tile is Provably_Safe if it is safe in every Consistent_Configuration, meaning every mine placement that matches all revealed numbers and the board's total mine count. The Solver reasons from revealed numbers and the total mine count only, and ignores the player's flags. Every full board has a marked Start_Tile with no adjacent mines. The first click must be on the Start_Tile; that click is guaranteed safe, counts toward Total_Clicks, and is excluded from Logical Move Rate because no number has been revealed yet.
5. **Logical Move Rate scope:** Logical Move Rate counts Reveal_Actions only (reveal clicks and chords that reveal at least one tile). Flags are excluded so the measure does not depend on flagging style; Wrong_Flags are counted separately.
6. **Pattern Recognition Speed:** measured on safe-tile deductions only. A Pattern_Instance appears at the action after which its tiles first become Provably_Safe, and it is resolved by the first later action that directly targets one of its tiles. Requirements 7 and 8 give the full rules.
7. **Leaderboard gating:** a timed result for a difficulty is Leaderboard_Eligible only if the player completed at least one Follow-Along Practice board at that difficulty before the game started. Daily Sweep results require one completed practice board at any difficulty.
8. **Guest play:** guests can use every learning and game mode without signing in, with progress kept in the browser. Signing in is required for leaderboard submission and cross-device streak sync, and guest progress is merged into the Account at first sign-in.
9. **Background questions:** the two onboarding questions are (a) prior Minesweeper experience and (b) input device (mouse, trackpad, other). The input device ties to the proposal's argument that hardware distorts clock time.
10. **Follow-along interception:** in Follow-Along Practice, an unprovable click is intercepted and not executed, so the learner cannot lose.
11. **Videos:** each difficulty has a configurable Video_Source (a direct video file URL or a YouTube embed URL). A placeholder appears until the user configures the source.
12. **Study entry and assignment:** Participants enter through a Study_Link that carries a Study_Code. Consent comes before any study logging. Participants are assigned to Group A or Group B when they reach the Intermediate learning step, keeping group sizes within one of each other. The Researcher exports anonymized data as CSV from an in-app page.
13. **Study ordering:** the onboarding Skill Check runs after the Pre_Test, at the start of the Learning_Phase, because the Skill Check shows why guessing fails and would otherwise contaminate the baseline. The pre-test controls reminder covers reveal and flag only, and MineLogic accepts all common chord inputs, so baseline Chording Efficiency reflects each Participant's existing habits.
14. **Matched evaluation boards:** each Post_Test board for Beginner and Intermediate is a rotation or reflection of its paired Pre_Test board, so mine count, 3BV, and the required deductions are identical. When a Study_Config includes the Expert tier, Expert has a Post_Test board only; when it does not, no Expert Evaluation_Board is required.
15. **Session length:** to fit the 45 to 65 minute session, each test game has a time cap (defaults: Beginner 4 minutes, Intermediate 8 minutes, Expert 12 minutes) and each Learning_Phase block offers a Continue control after 8 minutes. All caps are set in the Study_Config. The Expert cap and Expert Continue control apply only when the Study_Config includes the Expert tier (see Assumption 20).
16. **Survey length:** the survey has 10 core items (seven 5-point rating items and three open-ended prompts) followed by one demographics item, for 11 items in total.
17. **Leaderboard integrity:** results are submitted by the client. The Backend applies basic plausibility checks, and a determined user could still forge results. This is an accepted limitation for a class project.
18. **Leaderboard ranking:** per-difficulty leaderboards rank by best winning time. Because generated boards differ, the Daily Sweep leaderboard provides the same-board comparison.
19. **Platform:** the target is desktop and laptop browsers (latest stable Chrome, Edge, and Firefox) with a mouse or trackpad.
20. **Optional Expert tier in studies:** the Study_Config carries an includeExpert flag that defaults to off. WHILE includeExpert is off, a Study_Session runs Beginner and Intermediate only: the Learning_Phase skips the Expert learning block and the Post_Test skips Post_Expert, so a Participant completes a session after the Intermediate steps. Free play is unaffected: the Tutorial_Player, Mastery_Checkpoint, Practice_Mode, and Timed_Game keep all three Difficulties available and unlocked at all times, and the Expert Lessons, Checkpoint_Variations, and content remain built and reachable.

## Glossary

### Systems

- **MineLogic**: the complete web platform described in this document.
- **MineLogic client**: the browser application (React, TypeScript, Tailwind CSS, Vite) served as a static site from GitHub Pages.
- **Board_Engine**: the client component that holds a game's Board_State and applies Player_Actions according to the Minesweeper rules.
- **Board_View**: the client component that draws a board, its overlays, and its counters, and turns mouse and trackpad input into Player_Actions.
- **Solver**: the client-side constraint satisfaction solver that classifies covered tiles as Provably_Safe, Provably_Mine, or Undetermined.
- **Board_Generator**: the client-side component that generates No_Guess_Boards.
- **Board_Provider**: the client component that supplies a Board to a game from the Board_Generator, the Puzzle_Bank, or the set of Fixed_Boards.
- **Puzzle_Bank**: the set of pre-computed No_Guess_Boards stored in the Backend.
- **Offline_Generator**: the optional Python program that pre-computes No_Guess_Boards for the Puzzle_Bank.
- **Bank_Importer**: the TypeScript command-line tool that verifies boards with the Solver and loads them into the Puzzle_Bank.
- **Board_Parser**: the component that reads Board_Format text into a Board.
- **Board_Printer**: the component that writes a Board as canonical Board_Format text.
- **Move_Log_Serializer**: the component that writes a Move_Log as text.
- **Move_Log_Parser**: the component that reads Move_Log text into a Move_Log.
- **Pattern_Detector**: the component that finds Pattern_Instances in a Board_State and attributes each one to a Pattern_Type.
- **Metrics_Engine**: the single component that computes Game_Metrics from a Board and a Move_Log, for both learner feedback and Study_Records.
- **Content_Validator**: the build-time check that verifies authored content (Mini_Boards, Skill_Check_Snippets, Checkpoint_Variations, Evaluation_Boards) with the Solver.
- **Onboarding_Flow**: the first-visit sequence of two Background_Questions followed by the Skill_Check.
- **Skill_Check**: the diagnostic of three untimed Skill_Check_Snippets, one per difficulty.
- **Tutorial_Player**: the component that runs Learn-Then-Do Lessons.
- **Video_Panel**: the component that embeds a difficulty's narrated walkthrough video beside the tutorial.
- **Mastery_Checkpoint**: the unassisted test at the end of each difficulty's tutorial.
- **Practice_Mode**: the untimed Follow-Along Practice mode.
- **Hint_Coach**: the Practice_Mode component that produces the two-stage Nudge.
- **Timed_Game**: the timed mode that plays a full No_Guess_Board at a difficulty without hints.
- **Replay_Viewer**: the post-game view that replays a Move_Log and highlights missed safe patterns.
- **Progress_Service**: the component that records milestones and computes Mastery_Bar values.
- **Hub**: the home dashboard showing Mastery_Bars, the Daily_Streak, recommendations, and leaderboards.
- **Daily_Sweep**: the mode that serves the Daily_Sweep_Board for the current Sweep_Day.
- **Streak_Tracker**: the component that computes the Daily_Streak.
- **Leaderboard_Service**: the Backend functions and views that accept, check, and rank leaderboard results.
- **Auth_Service**: the account sign-up and sign-in functions provided through Supabase Auth.
- **Backend**: the Supabase project (PostgreSQL database, Auth, Row Level Security policies, database functions, and storage).
- **Study_Module**: the client component that runs Study_Sessions.
- **Study_Logger**: the component that writes Study_Records to the Backend.
- **Survey_Form**: the in-app post-study survey.
- **Data_Exporter**: the Researcher-only page that exports anonymized Study_Records.
- **Sync_Queue**: the client component that stores pending Backend writes in the browser and retries them.
- **Build_Pipeline**: the GitHub Actions workflow that tests, builds, and deploys MineLogic to GitHub Pages.

### Board and rules terms

- **Tile**: one cell of a board, identified by row and column.
- **Neighbor**: one of the up to eight Tiles that share an edge or corner with a Tile.
- **Number**: the count of mines among a revealed Tile's Neighbors, shown on the Tile.
- **Opening**: a connected region of revealed zero-Number Tiles together with the Tiles bordering the region.
- **Cascade**: the automatic reveal of an Opening when a zero-Number Tile is revealed.
- **Board**: a fixed layout of width, height, mine positions, and either a Start_Tile (full boards) or an initial revealed set (Mini_Boards and Skill_Check_Snippets), plus an identifier.
- **Board_State**: the revealed Tiles with their Numbers, the flagged Tiles, and the Board's dimensions and total mine count at one moment of play.
- **Difficulty**: Beginner (9x9, 10 mines), Intermediate (16x16, 40 mines), or Expert (30 columns x 16 rows, 99 mines).
- **Start_Tile**: the marked Tile on a full Board that has no adjacent mines and must be the first Tile revealed.
- **Board_Format**: the versioned, human-readable, language-neutral text format for Boards, readable by both TypeScript and Python.
- **Fixed_Board**: a Board stored as authored or curated data, such as an Evaluation_Board, a Daily_Sweep_Board, or a Mini_Board.
- **Mini_Board**: a 5x5 Board with an initial revealed set, used in Lessons and Mastery_Checkpoints.
- **Reference_Device**: a laptop with a 4-core CPU released in 2019 or later and 8 GB of RAM, running the latest stable Chrome; used for all timing requirements.

### Player action terms

- **Player_Action**: one player input on a Tile: a Reveal_Click, a Flag_Toggle, or a Chord_Click.
- **Reveal_Click**: a primary click on a covered, unflagged Tile.
- **Flag_Toggle**: a secondary click on a covered Tile, which places or removes a flag.
- **Chord_Click**: a primary click, a middle click, or a simultaneous primary and secondary press on a revealed Number. When the count of flagged Neighbors equals the Number, the Chord_Click reveals every covered, unflagged Neighbor.
- **Wasted_Click**: a Player_Action that changes nothing on the board, such as a Chord_Click on a Number whose flagged-Neighbor count differs from the Number.
- **Reveal_Action**: a Reveal_Click, or a Chord_Click that reveals at least one Tile. The Reveal_Action's Target_Tiles are the clicked Tile for a Reveal_Click and the covered, unflagged Neighbors for a Chord_Click.
- **Move_Log**: the ordered list of every Player_Action in a game, each with its type, Tile, and time in milliseconds since the game started, plus the Board identifier.
- **Total_Clicks**: the number of Player_Actions in a Move_Log, including Wasted_Clicks.

### Solver and metric terms

- **Consistent_Configuration**: an assignment of mine or safe to every covered Tile such that every revealed Number equals the count of mines among its Neighbors and the total count of mines equals the Board's mine count. Flags are not part of the assignment.
- **Provably_Safe**: a covered Tile that is safe in every Consistent_Configuration of a Board_State.
- **Provably_Mine**: a covered Tile that is a mine in every Consistent_Configuration of a Board_State.
- **Undetermined**: a covered Tile that is neither Provably_Safe nor Provably_Mine.
- **Inexact_State**: a Board_State for which the Solver stopped at its time budget before finishing classification.
- **No_Guess_Board**: a full Board on which, starting from the revealed Start_Tile and its Cascade, repeatedly revealing Provably_Safe Tiles reveals every non-mine Tile.
- **Canonical_Solve_Path**: the sequence of Board_States produced by solving a No_Guess_Board from the Start_Tile with the Board_Generator's fixed solving order.
- **Logical_Move**: a Reveal_Action whose Target_Tiles were all Provably_Safe in the Board_State immediately before the action.
- **Guess**: a Reveal_Action that is not a Logical_Move.
- **Wrong_Flag**: a flag placed on a Tile that was not Provably_Mine when the flag was placed.
- **3BV**: Bechtel's Board Benchmark Value: the number of Openings plus the number of non-mine, non-zero Tiles that do not border any zero-Number Tile.
- **Logical_Move_Rate**: the percentage of Counted_Reveal_Actions in a game that are Logical_Moves.
- **Counted_Reveal_Action**: a Reveal_Action other than the Start_Tile reveal and other than an action taken in an Inexact_State.
- **Chording_Efficiency**: Total_Clicks divided by the Board's 3BV.
- **Deduction_Level**: the least reasoning needed to prove a Tile: Single_Clue (one Number, after applying earlier single-Number results), Pair_Clue (two Numbers considered together), Multi_Clue (three or more Numbers considered together, without the mine count), or Mine_Count (requires the total mine count).
- **Reduced_Value**: a Number minus the count of its Neighbors that are Provably_Mine.
- **Pattern_Type**: one entry of the pattern catalog, grouped by tier. Beginner tier: Exposed_Mines (a Number whose Reduced_Value equals its count of covered Neighbors that are not Provably_Mine) and Satisfied_Number (a Number whose Reduced_Value is zero). Intermediate tier: Wall_1_1, Wall_1_2_1, and Wall_1_2_2_1 (straight runs of Numbers with those Reduced_Values beside a straight line of covered Tiles). Expert tier: Subset (a Pair_Clue deduction that matches no wall pattern), Clue_Chain (a Multi_Clue deduction, which connects clues across areas), and Mine_Count_Endgame (a Mine_Count deduction).
- **Pattern_Instance**: a group of covered Tiles that become Provably_Safe as the result of the same Player_Action, are attributed to the same Pattern_Type, and are proven by the same set of revealed Numbers (the Anchor_Numbers).
- **Anchor_Numbers**: the smallest set of revealed Numbers that proves a Pattern_Instance's Tiles safe.
- **Pattern_Recognition_Speed**: for a Pattern_Type in one game, the median number of seconds between a Pattern_Instance's appearance and its resolution, over the resolved Pattern_Instances of that type.
- **Game_Metrics**: Logical_Move_Rate, Pattern_Recognition_Speed per Pattern_Type, Chording_Efficiency, 3BV, Total_Clicks by action type, Guess count, Wrong_Flag count, outcome, and elapsed time.
- **Metrics_Version**: the version identifier of the Metrics_Engine definitions that produced a set of Game_Metrics.

### Learning and engagement terms

- **Lesson**: one tutorial unit that teaches one or two Pattern_Types through Learn_Steps followed by Do_Steps.
- **Learn_Step**: an explanation step that shows overlays and text on a demonstration Mini_Board.
- **Do_Step**: a step in which the learner performs the taught deduction on a Mini_Board to meet its Objective.
- **Objective**: the condition that completes a Do_Step, such as revealing a set of Target_Tiles or revealing them with a Chord_Click.
- **Overlay**: a colored, patterned, and labeled highlight drawn on Tiles to mark interacting Numbers, safe Tiles, or mines.
- **Skill_Check_Snippet**: an untimed, partly revealed Board with exactly one Provably_Safe covered Tile and one or more Trap_Tiles.
- **Trap_Tile**: a covered Tile in a Skill_Check_Snippet that is not Provably_Safe but looks safe to a player who ignores Neighbors shared between Numbers.
- **Checkpoint_Variation**: one unassisted Mini_Board in a Mastery_Checkpoint.
- **Slip**: a Guess or a Wrong_Flag made on a Checkpoint_Variation.
- **Mastery_Bar**: the per-difficulty progress bar on the Hub, from 0% to 100%.
- **Nudge**: the Hint_Coach's response to an intercepted action. Stage 1 outlines the Hint_Region; stage 2 also highlights the Anchor_Numbers.
- **Hint_Target**: the Provably_Safe Tile that a Nudge is built around; the Nudge never marks the Hint_Target itself.
- **Hint_Region**: the smallest rectangle of Tiles that contains the Hint_Target's Anchor_Numbers and all their covered Neighbors.
- **Background_Question**: one of the two onboarding questions (prior experience and input device).
- **Sweep_Day**: one calendar day from 00:00:00 to 23:59:59 UTC.
- **Daily_Sweep_Board**: the single Fixed_Board assigned to a Sweep_Day.
- **Daily_Streak**: the number of consecutive Sweep_Days, ending today or yesterday, on which the player won the Daily_Sweep_Board.
- **Leaderboard_Eligible**: the status of a winning result that meets the gating rule in Assumption 7 and the Backend plausibility checks.
- **Guest**: a person using MineLogic without signing in.
- **Account**: a signed-in identity managed by the Auth_Service.
- **Display_Name**: the public name shown for an Account on leaderboards.
- **Video_Source**: the configured video file URL or YouTube embed URL for one difficulty's walkthrough.

### Study terms

- **Researcher**: an Account that the Backend marks as allowed to read and export Study_Records. Only the project owner can grant this role.
- **Study_Config**: the Backend record that defines a study: Study_Code, active flag, consent text and statements, Evaluation_Boards, time caps, and survey items.
- **Study_Code**: the short code that identifies an active Study_Config.
- **Study_Link**: a MineLogic URL that contains a Study_Code.
- **Participant**: a person who has given consent in a Study_Session.
- **Participant_ID**: a random identifier of at least 122 bits (a version 4 UUID) that keys all of a Participant's Study_Records.
- **Resume_Code**: a random code shown to a Participant that restores the Participant's study identity in another browser.
- **Study_Session**: the in-app sequence of consent, Background_Questions, Pre_Test, Learning_Phase, Post_Test, and Survey_Form.
- **Group_A**: Participants who receive the Intermediate interactive tutorial and the Intermediate video.
- **Group_B**: Participants who receive the Intermediate interactive tutorial without the Intermediate video.
- **Evaluation_Board**: one of the Fixed_Boards used by every Participant: Pre_Beginner, Pre_Intermediate, Post_Beginner, and Post_Intermediate, plus Post_Expert when the Study_Config includes the Expert tier.
- **Pre_Test**: the timed Pre_Beginner and Pre_Intermediate games played before any instruction.
- **Learning_Phase**: the Skill_Check followed by the Beginner and Intermediate learning blocks of a Study_Session, plus the Expert learning block when the Study_Config includes the Expert tier.
- **Post_Test**: the timed Post_Beginner and Post_Intermediate games played after the Learning_Phase, plus Post_Expert when the Study_Config includes the Expert tier.
- **Retention_Window**: the five Sweep_Days after the Sweep_Day on which a Participant completed the Study_Session.
- **Study_Record**: any row the Study_Logger stores for a Participant.

## Requirements

### Requirement 1: Minesweeper Game Rules

**User Story:** As a learner, I want the board to follow the classic Minesweeper rules, so that what I learn transfers to any Minesweeper game.

#### Acceptance Criteria

1. WHEN a full Board is loaded, THE Board_View SHALL display every Tile as covered and mark the Start_Tile with a visible start marker.
2. WHILE no Tile of a full Board has been revealed, THE Board_Engine SHALL ignore every Reveal_Click on a Tile other than the Start_Tile, leave the click out of the Move_Log, and display a prompt to click the marked Start_Tile.
3. WHEN the Start_Tile is revealed, THE Board_Engine SHALL set the game clock to zero and reveal the Start_Tile's Opening.
4. WHEN a Reveal_Click targets a covered, unflagged, non-mine Tile, THE Board_Engine SHALL reveal the Tile and display its Number.
5. WHEN a zero-Number Tile is revealed, THE Board_Engine SHALL reveal every unflagged Tile of the Tile's Opening.
6. WHEN a Flag_Toggle targets a covered Tile, THE Board_Engine SHALL place a flag on the Tile if the Tile has no flag and remove the flag if the Tile has one.
7. WHEN a Chord_Click targets a revealed Number whose count of flagged Neighbors equals the Number, THE Board_Engine SHALL reveal every covered, unflagged Neighbor of that Number.
8. WHEN a Chord_Click targets a revealed Number whose count of flagged Neighbors differs from the Number, THE Board_Engine SHALL leave the Board_State unchanged and record the Chord_Click in the Move_Log as a Wasted_Click.
9. WHEN a Reveal_Action reveals a mine, THE Board_Engine SHALL end the game as a loss, show every mine, and mark every flag that is not on a mine.
10. WHEN every non-mine Tile is revealed, THE Board_Engine SHALL end the game as a win and place a flag on every mine.
11. THE Board_View SHALL display a mine counter equal to the Board's mine count minus the number of flags currently placed.
12. WHEN a Player_Action is applied to an active game, THE Board_Engine SHALL append the Player_Action to the Move_Log with its type, Tile, and the elapsed milliseconds since the Start_Tile was revealed.

### Requirement 2: Board Input and Display

**User Story:** As a learner using a mouse or a trackpad, I want every common Minesweeper input to work and the board to respond at once, so that my input device does not hold me back.

#### Acceptance Criteria

1. WHEN the player presses the primary button on a covered, unflagged Tile, THE Board_View SHALL issue a Reveal_Click for that Tile.
2. WHEN the player presses the secondary button on a covered Tile, THE Board_View SHALL issue a Flag_Toggle for that Tile and suppress the browser context menu.
3. WHEN the player presses the primary button, presses the middle button, or presses the primary and secondary buttons together on a revealed Number, THE Board_View SHALL issue a Chord_Click for that Number.
4. WHEN a Player_Action is issued, THE Board_View SHALL display the resulting Board_State within 50 milliseconds on the Reference_Device for Boards up to Expert size.
5. WHILE the browser viewport is at least 1280 by 720 CSS pixels, THE Board_View SHALL display a complete Expert Board without scrolling, with every Tile at least 24 CSS pixels wide.
6. THE Board_View SHALL draw every Overlay with a distinct border pattern and a text or icon label in addition to its color, so that each Overlay role is distinguishable without color vision.
7. THE Board_View SHALL draw every Number with a contrast ratio of at least 3:1 against the revealed Tile background.

### Requirement 3: Board Format Parsing and Printing

**User Story:** As the developer, I want one text format for Boards that both TypeScript and Python can read and write, so that generated, pre-computed, and hand-authored boards are interchangeable.

#### Acceptance Criteria

1. WHEN valid Board_Format text is provided, THE Board_Parser SHALL produce the Board that the text describes.
2. IF Board_Format text has an unsupported version, a width outside 1 to 30, a height outside 1 to 30, a mine outside the Board, a duplicate mine, a declared mine count that differs from the listed mines, a Start_Tile that is a mine or borders a mine, an initially revealed Tile that is a mine, or neither a Start_Tile nor an initial revealed set, THEN THE Board_Parser SHALL return an error that names the failed rule and the line number where the problem was found.
3. THE Board_Printer SHALL write any Board as canonical Board_Format text, with Tile coordinates listed in row-major order.
4. FOR ALL valid Boards, printing with the Board_Printer, parsing with the Board_Parser, and printing again SHALL produce text identical to the first printing, and the parsed Board SHALL equal the original Board (round-trip property).
5. FOR ALL Board_Format text accepted by the Board_Parser, printing the parsed Board SHALL produce text that the Board_Parser accepts and that parses to the same Board.

### Requirement 4: Constraint Satisfaction Solver

**User Story:** As a learner, I want MineLogic to know exactly which tiles can be proven safe, so that hints, metrics, and board guarantees are based on real logic rather than luck.

#### Acceptance Criteria

1. WHEN the Solver receives a Board_State, THE Solver SHALL classify every covered Tile as Provably_Safe, Provably_Mine, or Undetermined according to the Consistent_Configuration definition, using the revealed Numbers and the Board's total mine count.
2. FOR ALL Board_States, changing only the set of flagged Tiles SHALL leave the Solver's classification unchanged (flag-invariance property).
3. FOR ALL Board_States with at most 20 covered Tiles, the Solver's classification SHALL equal the classification obtained by enumerating every mine placement on the covered Tiles (model-based property).
4. FOR ALL Board_States reached during play on a Board, every Tile the Solver classifies as Provably_Safe SHALL be a non-mine Tile in the Board, and every Tile classified as Provably_Mine SHALL be a mine (soundness property).
5. FOR ALL pairs of Board_States on the same Board where the second reveals every Tile the first reveals plus further non-mine Tiles, every Tile that is Provably_Safe in the first and still covered in the second SHALL be Provably_Safe in the second (monotonicity property).
6. WHEN the Solver classifies a Board_State reached on an Expert No_Guess_Board, THE Solver SHALL return the classification within 100 milliseconds for at least 95% of such Board_States on the Reference_Device.
7. IF the Solver has not finished classifying a Board_State after 1,000 milliseconds, THEN THE Solver SHALL stop, return every classification already proven, return every other covered Tile as Undetermined, and mark the Board_State as an Inexact_State.
8. WHILE the Solver is classifying a Board_State, THE Board_View SHALL keep handling Player_Actions and screen updates within 100 milliseconds.

### Requirement 5: No-Guess Board Generation

**User Story:** As a learner, I want every timed and practice board to be solvable by logic alone, so that good reasoning is never punished by a forced 50/50 guess.

#### Acceptance Criteria

1. WHEN a full Board is requested for a Difficulty, THE Board_Generator SHALL produce a Board with that Difficulty's width, height, and mine count, and with a Start_Tile that has no adjacent mines.
2. THE Board_Generator SHALL output only Boards that the Solver verifies as No_Guess_Boards with no Inexact_State on the Canonical_Solve_Path.
3. FOR ALL Boards output by the Board_Generator and FOR ALL Board_States on those Boards in which the Start_Tile is revealed, no mine is revealed, and at least one non-mine Tile is covered, the Solver SHALL classify at least one covered Tile as Provably_Safe (always-a-safe-move property).
4. WHEN the Board_Generator receives the same seed and runs the same Board_Generator version, THE Board_Generator SHALL produce the same Board.
5. THE Board_Generator SHALL store each output Board's 3BV and its count of Pattern_Instances per Pattern_Type on the Canonical_Solve_Path as Board metadata.
6. WHEN the Board_Generator generates Boards on the Reference_Device, THE Board_Generator SHALL complete at least 90% of Beginner Boards within 500 milliseconds, Intermediate Boards within 1,000 milliseconds, and Expert Boards within 3,000 milliseconds.
7. WHILE the Board_Generator is generating a Board, THE Board_View SHALL keep handling input and screen updates within 100 milliseconds.
8. WHILE the Board_Generator is generating a Board for a game that is waiting to start, THE Board_View SHALL display a progress indicator.

### Requirement 6: Board Supply and Offline Puzzle Bank

**User Story:** As the developer, I want a pre-computed bank of no-guess boards as a fallback, so that Expert play stays smooth on slower computers.

#### Acceptance Criteria

1. WHEN a Timed_Game or a Practice_Mode game starts, THE Board_Provider SHALL supply a No_Guess_Board of the selected Difficulty.
2. WHERE the Puzzle_Bank is enabled for a Difficulty, IF the Board_Generator has not produced a Board within the Difficulty's time limit from Requirement 5, THEN THE Board_Provider SHALL supply a Board from the Puzzle_Bank for that Difficulty.
3. WHERE the Puzzle_Bank is enabled for a Difficulty, THE Board_Provider SHALL supply a Puzzle_Bank Board that the current player has not played, until the player has played every Board for that Difficulty.
4. IF the Puzzle_Bank cannot be reached, THEN THE Board_Provider SHALL continue client-side generation and keep the progress indicator visible until a Board is ready.
5. WHERE the Offline_Generator is used, THE Offline_Generator SHALL write 1,000 No_Guess_Boards per Difficulty as Board_Format text that the Board_Parser accepts.
6. WHEN Boards are imported into the Puzzle_Bank, THE Bank_Importer SHALL verify each Board with the Solver, load only the Boards that are No_Guess_Boards, and report the identifier of every rejected Board.

### Requirement 7: Pattern Detection

**User Story:** As a learner, I want MineLogic to recognize which taught pattern proves each safe tile, so that hints, replays, and speed measures refer to the patterns I studied.

#### Acceptance Criteria

1. WHEN a Board_State is produced during a game, THE Pattern_Detector SHALL attribute every Provably_Safe Tile to a Pattern_Type at the Tile's lowest Deduction_Level.
2. WHEN a Pair_Clue deduction matches the Wall_1_1, Wall_1_2_1, or Wall_1_2_2_1 template, THE Pattern_Detector SHALL attribute the deduction to the matching wall Pattern_Type, and THE Pattern_Detector SHALL attribute every other Pair_Clue deduction to Subset.
3. WHEN a Player_Action makes covered Tiles newly Provably_Safe, THE Pattern_Detector SHALL group those Tiles into Pattern_Instances by Pattern_Type and Anchor_Numbers and record the action's timestamp as each Pattern_Instance's appearance time.
4. WHEN a Player_Action directly targets a Tile of an unresolved Pattern_Instance, either as a Reveal_Click on the Tile or as a Chord_Click on a Number that borders the Tile and reveals the Tile, THE Pattern_Detector SHALL record the action's timestamp as the Pattern_Instance's resolution time.
5. IF every Tile of a Pattern_Instance is revealed by a Cascade or by actions that do not directly target the Pattern_Instance, THEN THE Pattern_Detector SHALL mark the Pattern_Instance as excluded from Pattern_Recognition_Speed.
6. IF a Tile of an unresolved Pattern_Instance becomes provable at a lower Deduction_Level before the Pattern_Instance is resolved, THEN THE Pattern_Detector SHALL mark the Pattern_Instance as superseded and exclude the Pattern_Instance from Pattern_Recognition_Speed.
7. WHEN a game ends, THE Pattern_Detector SHALL mark every Pattern_Instance without a resolution time as unresolved.
8. FOR ALL authored wall-pattern fixtures in the test suite, the Pattern_Detector SHALL attribute the fixture's safe Tiles to the fixture's labeled Pattern_Type (example-based check).

### Requirement 8: Game Metric Definitions

**User Story:** As a learner and as the researcher, I want precise definitions of Logical Move Rate, Pattern Recognition Speed, and Chording Efficiency, so that the numbers separate deductive skill from luck and hardware.

#### Acceptance Criteria

1. WHEN a Timed_Game ends, THE Metrics_Engine SHALL compute the Game_Metrics from the Board and the Move_Log of that game.
2. THE Metrics_Engine SHALL classify each Reveal_Action as a Logical_Move or a Guess using the Solver's classification of the Board_State immediately before that action.
3. THE Metrics_Engine SHALL compute Logical_Move_Rate as 100 times the number of Logical_Moves among the Counted_Reveal_Actions divided by the number of Counted_Reveal_Actions, rounded to one decimal place.
4. IF a game has no Counted_Reveal_Actions, THEN THE Metrics_Engine SHALL report Logical_Move_Rate as not available.
5. THE Metrics_Engine SHALL compute Chording_Efficiency as Total_Clicks divided by the Board's 3BV, rounded to two decimal places, where Total_Clicks counts every Reveal_Click, Flag_Toggle, and Chord_Click from the Start_Tile reveal through the game-ending action, including Wasted_Clicks.
6. FOR ALL Boards, revealing one zero-Number Tile in each Opening and then each still-covered non-mine Tile with one Reveal_Click per Tile SHALL win the game using exactly 3BV Reveal_Clicks (3BV model property).
7. THE Metrics_Engine SHALL compute Pattern_Recognition_Speed for each Pattern_Type as the median, in seconds rounded to one decimal place, of resolution time minus appearance time over that type's resolved Pattern_Instances that are neither excluded nor superseded.
8. IF a Pattern_Type has no resolved Pattern_Instance that is neither excluded nor superseded, THEN THE Metrics_Engine SHALL report that Pattern_Type's Pattern_Recognition_Speed as not available.
9. THE Metrics_Engine SHALL report, per Pattern_Type, the counts of resolved, excluded, superseded, and unresolved Pattern_Instances.
10. THE Metrics_Engine SHALL report the counts of Reveal_Clicks, Flag_Toggles, Chord_Clicks, Wasted_Clicks, Guesses, and Wrong_Flags for each game.
11. IF any Board_State in a game was an Inexact_State, THEN THE Metrics_Engine SHALL mark the Game_Metrics as partial and report the number of Reveal_Actions excluded for that reason.
12. FOR ALL games on No_Guess_Boards whose Reveal_Actions are all Logical_Moves, the Metrics_Engine SHALL report a Logical_Move_Rate of 100.0, and FOR ALL games the reported Logical_Move_Rate SHALL lie between 0.0 and 100.0 inclusive (bounds property).
13. THE Metrics_Engine SHALL label every set of Game_Metrics with the Metrics_Version that produced the Game_Metrics.

### Requirement 9: One Shared Measurement for Learner Feedback and Evaluation

**User Story:** As the researcher, I want the in-game feedback and the study outcome measures to come from the same code and the same stored data, so that assessment and evaluation are identical by construction.

#### Acceptance Criteria

1. THE MineLogic client SHALL compute every Game_Metric shown to learners, stored with leaderboard results, and written to Study_Records with the same Metrics_Engine.
2. FOR ALL Boards and Move_Logs, computing the Game_Metrics twice SHALL produce identical results (determinism property).
3. WHEN Game_Metrics are stored in the Backend, THE MineLogic client SHALL store the Board identifier, the Metrics_Version, and the serialized Move_Log together with the Game_Metrics.
4. FOR ALL stored games, recomputing the Game_Metrics from the stored Board and the parsed stored Move_Log with the stored Metrics_Version SHALL reproduce the stored Game_Metrics exactly (recompute property).
5. THE Move_Log_Serializer SHALL write any Move_Log as versioned text.
6. FOR ALL Move_Logs, serializing with the Move_Log_Serializer and then parsing with the Move_Log_Parser SHALL produce a Move_Log equal to the original (round-trip property).
7. IF Move_Log text has an unknown action type, a Tile outside the Board, a decreasing timestamp, or a missing Board identifier, THEN THE Move_Log_Parser SHALL return an error that names the failed rule and the index of the offending entry.
8. FOR ALL Boards and Move_Logs, replaying the parsed Move_Log on the Board with the Board_Engine SHALL reproduce the original game's final Board_State and outcome (replay property).

### Requirement 10: Onboarding and Diagnostic Skill Check

**User Story:** As a new learner, I want a two-minute check of what I already know, so that MineLogic can show me where my logic breaks down and where to start.

#### Acceptance Criteria

1. WHEN a Guest or a new Account opens MineLogic for the first time, THE Onboarding_Flow SHALL present the two Background_Questions and then the three Skill_Check_Snippets in the order Beginner, Intermediate, Expert.
2. THE Onboarding_Flow SHALL ask about prior experience with the options "new to Minesweeper", "casual player", and "regular player", and about input device with the options "mouse", "trackpad", and "other".
3. WHILE a Skill_Check_Snippet is shown, THE Skill_Check SHALL display no game clock and SHALL treat the learner's first Reveal_Click as the learner's answer.
4. WHEN the learner answers a Skill_Check_Snippet, THE Skill_Check SHALL record the result as Correct if the answer is the Provably_Safe Tile, as Trap with the Trap_Tile's label if the answer is a Trap_Tile, and as Other in every remaining case.
5. WHEN the learner answers a Skill_Check_Snippet, THE Skill_Check SHALL highlight the Provably_Safe Tile and display a short explanation of the deduction that proves the Tile safe.
6. WHEN the Skill_Check is complete, THE Progress_Service SHALL initialize each Mastery_Bar from the Skill_Check results as defined in Requirement 17 and keep all three Difficulties unlocked.
7. WHEN the learner selects Skip during the Onboarding_Flow, THE Onboarding_Flow SHALL end, leave every Mastery_Bar at 0%, and keep all three Difficulties unlocked.
8. THE Content_Validator SHALL verify that each Skill_Check_Snippet has exactly one Provably_Safe covered Tile and at least one Trap_Tile, and that no Trap_Tile is Provably_Safe.
9. THE Content_Validator SHALL verify that each Skill_Check_Snippet's Provably_Safe Tile is attributed to a Pattern_Type of the snippet's tier, with the Intermediate snippet attributed to Wall_1_2_1.

### Requirement 11: Interactive Learn-Then-Do Tutorials

**User Story:** As a learner, I want short interactive lessons that show me why tiles are safe and then make me apply the trick myself, so that I learn each pattern by doing it.

#### Acceptance Criteria

1. THE Tutorial_Player SHALL provide Lessons for Exposed_Mines (corner counting) and Satisfied_Number with chording at Beginner, for Wall_1_1, Wall_1_2_1, and Wall_1_2_2_1 at Intermediate, and for Subset, Clue_Chain, and Mine_Count_Endgame at Expert.
2. WHEN a Learn_Step is shown, THE Tutorial_Player SHALL draw Overlays on the interacting Numbers and on the Tiles those Numbers prove safe or mine, with text that explains why each marked Tile is safe or a mine.
3. THE Tutorial_Player SHALL follow each Lesson's Learn_Steps with two or three Do_Steps, each on its own 5x5 Mini_Board.
4. WHEN the learner performs a Logical_Move or flags a Provably_Mine Tile during a Do_Step, THE Tutorial_Player SHALL apply the action.
5. IF the learner performs a Reveal_Action with a Target_Tile that is not Provably_Safe, or flags a Tile that is not Provably_Mine, during a Do_Step, THEN THE Tutorial_Player SHALL leave the action unapplied, mark the attempted Tile, and explain that the Tile cannot yet be proven safe or a mine.
6. IF a Do_Step's Objective requires a Chord_Click and the learner reveals a Target_Tile with a Reveal_Click, THEN THE Tutorial_Player SHALL reset the Mini_Board to its initial state and ask the learner to reveal the Tiles with a Chord_Click.
7. WHILE a Do_Step's Objective is unmet, THE Tutorial_Player SHALL keep the control for the next step disabled.
8. WHEN a Do_Step's Objective is met, THE Tutorial_Player SHALL mark the Do_Step complete and enable the control for the next step.
9. WHEN the learner completes a Lesson's last Do_Step, THE Progress_Service SHALL record the Lesson as complete.
10. WHEN the learner reopens a partly completed Lesson, THE Tutorial_Player SHALL resume at the first incomplete Do_Step.
11. THE Content_Validator SHALL verify that every Do_Step's Objective can be met from its Mini_Board's initial state using only Logical_Moves and flags on Provably_Mine Tiles, and that at least one Target_Tile is attributed to the Lesson's Pattern_Type.

### Requirement 12: Embedded Video Walkthroughs

**User Story:** As a learner who prefers watching, I want a narrated video beside each tutorial that I can pause, rewind, and scrub, so that I have a second way to learn without a teacher.

#### Acceptance Criteria

1. THE Video_Panel SHALL accept, for each Difficulty, a Video_Source that is either a direct video file URL or a YouTube embed URL.
2. WHILE the viewport is at least 1280 CSS pixels wide, THE Video_Panel SHALL appear beside the Tutorial_Player.
3. WHILE the viewport is narrower than 1280 CSS pixels, THE Video_Panel SHALL appear below the Tutorial_Player.
4. WHEN a Video_Source is configured for the current Difficulty, THE Video_Panel SHALL play the video with controls to play, pause, rewind, and scrub to any position.
5. IF no Video_Source is configured for the current Difficulty, THEN THE Video_Panel SHALL show a placeholder stating that the video is coming soon.
6. IF the configured video fails to load, THEN THE Video_Panel SHALL show an error message in place of the video.
7. WHERE a caption file is configured for a Video_Source, THE Video_Panel SHALL offer captions for that video.
8. THE Tutorial_Player SHALL let the learner complete every Lesson without playing the video.

### Requirement 13: Pattern Mastery Checkpoints

**User Story:** As a learner, I want an unassisted check at the end of each tutorial, so that a full progress bar means I can apply the patterns on my own.

#### Acceptance Criteria

1. WHEN the learner starts a Mastery_Checkpoint for a Difficulty, THE Mastery_Checkpoint SHALL present one Checkpoint_Variation at a time with no Overlays, Nudges, or explanations.
2. WHEN the learner reveals every non-mine Tile of a Checkpoint_Variation without a Slip, THE Mastery_Checkpoint SHALL increase the learner's consecutive-success count by one.
3. IF the learner makes a Slip, THEN THE Mastery_Checkpoint SHALL leave the action unapplied, mark the slipped Tile with an error indicator within 100 milliseconds, reset the consecutive-success count to zero, and present a new Checkpoint_Variation.
4. WHEN the consecutive-success count reaches three, THE Mastery_Checkpoint SHALL record the Mastery_Checkpoint for that Difficulty as passed.
5. WHILE a Mastery_Checkpoint is in progress, THE Mastery_Checkpoint SHALL display the consecutive-success count as three markers.
6. THE Mastery_Checkpoint SHALL draw Checkpoint_Variations from a pool of at least six per Difficulty and present a Checkpoint_Variation different from the one just played.
7. THE Content_Validator SHALL verify that every Checkpoint_Variation can be cleared from its initial state using only Logical_Moves and that its first required deduction is attributed to a Pattern_Type of its Difficulty's tier.

### Requirement 14: Follow-Along Practice with the Two-Stage Nudge

**User Story:** As a learner, I want untimed practice that stops me before I guess and points me toward the numbers to compare without giving away the answer, so that I learn to find safe tiles myself.

#### Acceptance Criteria

1. WHEN the learner starts Practice_Mode at a Difficulty, THE Practice_Mode SHALL present a No_Guess_Board of that Difficulty without a game clock.
2. WHEN the learner performs a Reveal_Action whose Target_Tiles are all Provably_Safe, THE Practice_Mode SHALL apply the action and clear any displayed Nudge.
3. IF the learner performs a Reveal_Action with a Target_Tile that is not Provably_Safe, THEN THE Practice_Mode SHALL leave the action unapplied, display a message that the Tile cannot yet be proven safe, and display stage 1 of a Nudge.
4. WHEN the learner performs another intercepted Reveal_Action or selects the More Help control while stage 1 is displayed, THE Hint_Coach SHALL display stage 2 of the Nudge for the same Hint_Target.
5. WHILE stage 2 of a Nudge is displayed, THE Hint_Coach SHALL keep stage 2 as the most detailed help offered for that Hint_Target.
6. THE Hint_Coach SHALL choose as the Hint_Target the Provably_Safe Tile nearest to the intercepted Tile by Chebyshev distance, breaking ties by lowest Deduction_Level and then by row-major order.
7. THE Hint_Coach SHALL limit stage 1 to an outline around the Hint_Region and limit stage 2 to that outline plus highlights on the Anchor_Numbers and, for a Mine_Count deduction, a highlight on the mine counter.
8. FOR ALL Board_States and intercepted Reveal_Actions, displaying a Nudge SHALL leave the Board_State unchanged and SHALL apply no individual marker, flag, or reveal to any covered Tile (guardrail property).
9. WHEN the learner performs a Flag_Toggle in Practice_Mode, THE Practice_Mode SHALL apply the Flag_Toggle.
10. IF the current Board_State is an Inexact_State, THEN THE Practice_Mode SHALL apply a Reveal_Action whose Target_Tiles are all non-mine Tiles and SHALL block a Reveal_Action that would reveal a mine with a message, without a Nudge.
11. WHEN the learner reveals every non-mine Tile, THE Practice_Mode SHALL record the practice board as complete for that Difficulty and show the counts of intercepted actions and stage 2 Nudges.

### Requirement 15: Timed No-Guess Games

**User Story:** As a learner, I want full timed games at each difficulty on boards that never force a guess, so that I can test my skill without hints and without luck deciding the result.

#### Acceptance Criteria

1. WHEN the learner starts a Timed_Game at a Difficulty, THE Timed_Game SHALL present a No_Guess_Board of that Difficulty from the Board_Provider.
2. WHEN the Start_Tile is revealed, THE Timed_Game SHALL start a visible game clock that shows elapsed whole seconds.
3. WHILE a Timed_Game is active, THE Timed_Game SHALL keep the game clock running when the browser tab is hidden.
4. WHILE a Timed_Game is active, THE Timed_Game SHALL display no Overlays, Nudges, or hints.
5. WHEN a Timed_Game ends, THE Timed_Game SHALL record the elapsed time in milliseconds from the Start_Tile reveal to the game-ending action.
6. WHEN a Timed_Game ends, THE Timed_Game SHALL display a summary with the outcome, the elapsed time, and the Game_Metrics within 2 seconds on the Reference_Device.
7. THE Timed_Game summary SHALL display a one-sentence explanation of each Game_Metric beside its value.
8. WHEN a Timed_Game ends, THE Progress_Service SHALL store the result with its Game_Metrics, Board identifier, and Move_Log in the browser for a Guest and in the Backend for an Account.

### Requirement 16: Post-Game Instant Replay

**User Story:** As a learner who just lost, I want to see the safe tiles and patterns I missed, so that I reflect on my reasoning instead of blaming luck.

#### Acceptance Criteria

1. WHEN a Timed_Game ends, THE Replay_Viewer SHALL offer a replay of the game's Move_Log.
2. THE Replay_Viewer SHALL provide controls to play, pause, step forward one action, step back one action, and jump to any action.
3. WHILE the Replay_Viewer shows an action, THE Replay_Viewer SHALL label the action as a Logical_Move, a Guess, a Flag_Toggle, or a Wasted_Click.
4. WHEN the replay of a lost game opens, THE Replay_Viewer SHALL show the Board_State immediately before the losing action and highlight every Tile that was Provably_Safe in that Board_State, labeled with its Pattern_Type.
5. WHEN the replay of a lost game opens, THE Replay_Viewer SHALL list every unresolved Pattern_Instance with its Pattern_Type and appearance time.
6. WHEN the learner selects a listed Pattern_Instance, THE Replay_Viewer SHALL show the Board_State at the Pattern_Instance's appearance time and highlight its Anchor_Numbers and its Tiles.

### Requirement 17: Mastery Progress and the Hub

**User Story:** As a learner, I want to see my mastery of each difficulty and what to do next, so that I can make progress in short breaks without planning my own curriculum.

#### Acceptance Criteria

1. THE Progress_Service SHALL set a Difficulty's Mastery_Bar to 100% when that Difficulty's Mastery_Checkpoint is passed.
2. WHILE a Difficulty's Mastery_Checkpoint is not passed, THE Progress_Service SHALL set that Difficulty's Mastery_Bar to the lesser of 90% and the sum of 10% (when the Difficulty's Skill_Check result is Correct) and 80% times the fraction of the Difficulty's Lessons completed.
3. FOR ALL sequences of recorded milestones, adding a milestone SHALL leave every Mastery_Bar equal or higher (monotonicity property).
4. THE Hub SHALL display the Mastery_Bar of each Difficulty, the Daily_Streak, the longest Daily_Streak, and links to the leaderboards.
5. THE Hub SHALL display, for each Difficulty, whether all Lessons are complete, whether the Mastery_Checkpoint is passed, whether a Practice_Mode board is complete, and whether a Timed_Game has been won.
6. THE Hub SHALL recommend the first incomplete loop step of the lowest Difficulty whose Skill_Check result is not Correct and whose Mastery_Bar is below 100%, or, when no Difficulty meets both conditions, of the lowest Difficulty whose Mastery_Bar is below 100%.
7. THE Hub SHALL let the learner open any loop step of any Difficulty at any time.

### Requirement 18: Daily Sweep and Daily Streak

**User Story:** As a returning player, I want one shared daily board that mixes the patterns I have learned, so that a short daily habit keeps my streak alive and lets me compare times on the same board.

#### Acceptance Criteria

1. THE Daily_Sweep SHALL provide the same Daily_Sweep_Board to every player during a Sweep_Day.
2. THE Content_Validator SHALL verify that every Daily_Sweep_Board is a No_Guess_Board with Intermediate dimensions and mine count whose Canonical_Solve_Path contains at least one Pattern_Instance from each of the Beginner, Intermediate, and Expert tiers.
3. IF no Daily_Sweep_Board is assigned to the current Sweep_Day, THEN THE Daily_Sweep SHALL select a Board from a reserve pool of validated Daily_Sweep_Boards using the Sweep_Day's date as the selection key, so that every player receives the same Board.
4. WHEN a player starts the Daily_Sweep, THE Daily_Sweep SHALL play the Daily_Sweep_Board as a Timed_Game.
5. WHEN a player wins the Daily_Sweep_Board, THE Streak_Tracker SHALL record the Sweep_Day on which that attempt started as completed for that player.
6. IF a player loses the Daily_Sweep_Board, THEN THE Daily_Sweep SHALL let the player start another attempt on the same Daily_Sweep_Board during the same Sweep_Day.
7. THE Streak_Tracker SHALL compute the Daily_Streak from only the player's set of completed Sweep_Days and the current Sweep_Day.
8. FOR ALL sets of completed Sweep_Days that contain the previous Sweep_Day, adding the current Sweep_Day SHALL increase the Daily_Streak by one, and FOR ALL sets that contain neither the current nor the previous Sweep_Day, the Daily_Streak SHALL be zero (streak properties).
9. THE Streak_Tracker SHALL record the longest Daily_Streak each player has reached.
10. THE Hub SHALL display the time remaining until the next Sweep_Day begins.

### Requirement 19: Leaderboards Gated Behind Practice

**User Story:** As a competitive player, I want leaderboards that open only after untimed practice, so that competition rewards accurate logic rather than reckless speed.

#### Acceptance Criteria

1. THE Leaderboard_Service SHALL keep one leaderboard per Difficulty that ranks each Account's best Leaderboard_Eligible winning time from Timed_Games at that Difficulty, fastest first.
2. THE Leaderboard_Service SHALL keep one leaderboard per Sweep_Day that ranks each Account's first-attempt Daily_Sweep win of that Sweep_Day, fastest first.
3. WHEN two leaderboard results have equal elapsed times, THE Leaderboard_Service SHALL rank the earlier-submitted result first.
4. WHEN an Account submits a winning Timed_Game result for a Difficulty, THE Leaderboard_Service SHALL accept the result only if the Account completed a Practice_Mode board at that Difficulty before the game started.
5. WHEN an Account submits a first-attempt Daily_Sweep win, THE Leaderboard_Service SHALL accept the result only if the Account completed a Practice_Mode board at any Difficulty before the attempt started.
6. IF a winning result fails the practice requirement, THEN THE Timed_Game summary SHALL state which Practice_Mode board the player must complete to enter that leaderboard.
7. IF a submitted result has Board dimensions or a mine count that differ from its Difficulty, an elapsed time below its 3BV divided by 15 seconds, an elapsed time above 3,600 seconds, or a game identifier that was already submitted, THEN THE Leaderboard_Service SHALL reject the result and return the name of the failed check.
8. IF an Account submits more than 30 results within one hour, THEN THE Leaderboard_Service SHALL reject that Account's further submissions until the hour has passed.
9. THE Leaderboard_Service SHALL let Guests and Accounts read every leaderboard, exposing only rank, Display_Name, elapsed time, Logical_Move_Rate, and Chording_Efficiency for each entry.
10. THE Hub SHALL show the top 50 entries of each leaderboard and the signed-in player's own rank on each leaderboard.
11. WHEN a Guest wins a Timed_Game, THE Timed_Game summary SHALL invite the Guest to sign in so that future wins can enter leaderboards.

### Requirement 20: Accounts, Guest Play, and Progress Sync

**User Story:** As a casual player on a short break, I want to play without signing up and keep my progress if I sign up later, so that MineLogic costs me nothing to try.

#### Acceptance Criteria

1. THE MineLogic client SHALL let a Guest use the Onboarding_Flow, Tutorial_Player, Video_Panel, Mastery_Checkpoint, Practice_Mode, Timed_Game, Replay_Viewer, and Daily_Sweep without signing in.
2. WHILE a person is a Guest, THE Progress_Service SHALL store milestones, game results, and completed Sweep_Days in the browser's local storage.
3. THE Auth_Service SHALL let a person create an Account with an email address and a password, sign in, sign out, and reset the password by email.
4. WHEN a person creates an Account, THE Auth_Service SHALL require a Display_Name of 3 to 20 characters, using only letters, digits, underscores, and hyphens, that no other Account uses.
5. IF a submitted Display_Name breaks the Display_Name rules, THEN THE Backend SHALL reject the Display_Name and return the rule that was broken.
6. WHEN a Guest with local progress signs in on that browser for the first time, THE Progress_Service SHALL merge the local progress into the Account as the union of milestones, game results, and completed Sweep_Days.
7. FOR ALL pairs of local and Account progress records, merging in either order SHALL produce the same result, and merging the same records a second time SHALL leave the result unchanged (confluence and idempotence properties).
8. WHILE a person is signed in, THE Progress_Service SHALL store milestones, game results, and completed Sweep_Days in the Backend.
9. IF a Backend write fails, THEN THE Sync_Queue SHALL keep the write in the browser's local storage and retry the write with increasing delays until the write succeeds.
10. FOR ALL writes held by the Sync_Queue, delivering the same write more than once SHALL leave the Backend in the same state as delivering the write once (idempotence property).

### Requirement 21: Study Entry, Consent, and Participant Identity

**User Story:** As the researcher, I want participants to join through a study link, give informed consent before anything is logged, and stay anonymous, so that the evaluation study is ethical and its data cannot identify anyone.

#### Acceptance Criteria

1. WHEN a person opens a Study_Link whose Study_Code matches an active Study_Config, THE Study_Module SHALL show the Study_Config's consent text and consent statements before any other study screen.
2. IF a Study_Link's Study_Code matches no active Study_Config, THEN THE Study_Module SHALL show a message that the study link is not valid.
3. IF the active Study_Config lacks any of the five Evaluation_Boards or the Intermediate Video_Source, THEN THE Study_Module SHALL refuse to start new Study_Sessions and show a configuration error.
4. WHEN the person affirms every consent statement and selects the agree control, THE Study_Module SHALL create a Participant with a new Participant_ID and record the consent time and the consent text version.
5. WHEN the person declines consent, THE Study_Module SHALL show a thank-you screen and end the visit without creating a Participant.
6. THE Backend SHALL accept a Study_Record only when a consent record exists for the record's Participant_ID.
7. THE Study_Module SHALL create each study identity separately from any Account, with no email address attached.
8. WHEN a Participant is created, THE Study_Module SHALL display the Participant's Resume_Code and ask the Participant to save the Resume_Code.
9. WHEN a Participant reopens the Study_Link in the same browser, THE Study_Module SHALL resume the Study_Session at the first incomplete step.
10. WHEN a person enters a valid Resume_Code, THE Study_Module SHALL restore that Participant's study identity and resume the Study_Session at the first incomplete step.
11. THE Study_Module SHALL offer a Withdraw control on every Study_Session screen and on the Resume_Code entry screen.
12. WHEN a Participant confirms withdrawal, THE Backend SHALL delete every Study_Record with that Participant's Participant_ID.
13. WHEN the withdrawal deletion completes, THE Study_Module SHALL show a confirmation and end the Study_Session.

### Requirement 22: Standardized Pre-Test and Post-Test

**User Story:** As the researcher, I want every participant to play the same fixed boards before and after the learning phase, so that before-and-after measures are comparable across participants.

#### Acceptance Criteria

1. WHEN consent is recorded, THE Study_Module SHALL run the Study_Session steps in the order Background_Questions, Pre_Test, Learning_Phase, Post_Test, Survey_Form, completion screen.
2. WHILE a Study_Session is in progress, THE Study_Module SHALL show navigation only to the current Study_Session step.
3. THE Study_Module SHALL use the Study_Config's Pre_Beginner and then Pre_Intermediate Evaluation_Boards for the Pre_Test of every Participant.
4. THE Study_Module SHALL use the Study_Config's Post_Beginner and then Post_Intermediate Evaluation_Boards for the Post_Test of every Participant, and SHALL additionally use Post_Expert after Post_Intermediate only when the Study_Config includes the Expert tier.
5. THE Content_Validator SHALL verify that Post_Beginner has the same dimensions, mine count, and 3BV as Pre_Beginner, and that Post_Intermediate has the same dimensions, mine count, and 3BV as Pre_Intermediate.
6. THE Content_Validator SHALL verify that every Evaluation_Board configured in a Study_Config is a No_Guess_Board whose Canonical_Solve_Path contains at least one Pattern_Instance from every tier up to the Board's Difficulty, and SHALL require a Post_Expert board only when the Study_Config includes the Expert tier.
7. WHEN the Pre_Test starts, THE Study_Module SHALL show a controls reminder that describes the Reveal_Click and the Flag_Toggle only.
8. WHILE a Pre_Test or Post_Test game is active, THE Study_Module SHALL play the game as a Timed_Game with exactly one attempt.
9. WHEN a Pre_Test or Post_Test game reaches its time cap, THE Study_Module SHALL end the game with the outcome Timed_Out and compute the Game_Metrics from the actions made before the cap.
10. WHERE the Study_Config sets no time cap for a Difficulty, THE Study_Module SHALL apply a time cap of 4 minutes for Beginner, 8 minutes for Intermediate, and 12 minutes for Expert test games.
11. WHEN a Pre_Test or Post_Test game ends, THE Study_Module SHALL show only the outcome and the elapsed time before moving to the next step.
12. IF the page is reloaded or closed during a Pre_Test or Post_Test game, THEN THE Study_Module SHALL record the game with the outcome Interrupted, keep the actions logged before the interruption, and resume the Study_Session at the next step.

### Requirement 23: Learning Phase and Group Assignment

**User Story:** As the researcher, I want participants split evenly at random between tutorial-plus-video and tutorial-only on Intermediate, so that I can measure what the video adds.

#### Acceptance Criteria

1. WHEN the Learning_Phase begins, THE Study_Module SHALL run the Skill_Check and then the Beginner and Intermediate learning blocks in that order, and SHALL run the Expert learning block after the Intermediate block only when the Study_Config includes the Expert tier.
2. THE Study_Module SHALL compose each learning block of the Difficulty's Lessons, its Mastery_Checkpoint, and one Practice_Mode board.
3. WHEN a Participant without a group reaches the Intermediate learning block, THE Backend SHALL assign the Participant to the group with fewer assigned Participants, choosing Group_A or Group_B at random when the counts are equal.
4. FOR ALL sequences of assignment requests, including concurrent requests, the numbers of Participants assigned to Group_A and to Group_B SHALL differ by at most one after every assignment (balance property).
5. WHEN a Participant who already has a group resumes a Study_Session, THE Study_Module SHALL keep the Participant's assigned group.
6. WHILE a Group_A Participant is in the Intermediate learning block, THE Study_Module SHALL show the Video_Panel with the Intermediate video beside the Lessons.
7. WHILE a Group_B Participant is in the Intermediate learning block, THE Study_Module SHALL hide the Video_Panel.
8. WHILE a Participant of either group is in the Beginner learning block, or in the Expert learning block when the Study_Config includes the Expert tier, THE Study_Module SHALL show the Video_Panel for that Difficulty.
9. WHEN a learning block has run for its configured duration, with a default of 8 minutes, THE Study_Module SHALL show a Continue control that moves the Participant to the next step.
10. WHEN a Participant continues before completing a learning block, THE Study_Logger SHALL record which parts of the block were incomplete.

### Requirement 24: In-App Survey and Retention Window

**User Story:** As the researcher, I want an in-app survey and a record of daily play in the five days after the session, so that I can measure perceived clarity, pacing, and motivation, and streak retention.

#### Acceptance Criteria

1. WHEN the Post_Test ends, THE Survey_Form SHALL present seven 5-point rating items, then three open-ended prompts, then one demographics item.
2. THE Survey_Form SHALL read the text of every item from the Study_Config.
3. THE Survey_Form SHALL label each rating item's points from 1 (strongly disagree) to 5 (strongly agree).
4. THE Survey_Form SHALL let the Participant submit with any item unanswered.
5. THE Survey_Form SHALL accept open-ended answers of up to 2,000 characters and show the number of characters remaining.
6. WHEN the Participant submits the Survey_Form, THE Study_Logger SHALL store every answer, including unanswered items as blank, with the Participant_ID.
7. WHEN the Survey_Form is submitted, THE Study_Module SHALL show the completion screen with the Resume_Code and an invitation to play the Daily_Sweep during the optional Retention_Window.
8. WHILE a Participant's Retention_Window is open, THE Study_Logger SHALL record each Daily_Sweep attempt with the Sweep_Day, outcome, elapsed time, Game_Metrics, and serialized Move_Log.
9. WHILE a Participant plays the Daily_Sweep, THE Leaderboard_Service SHALL show the Participant's results under a randomly generated alias.

### Requirement 25: Anonymized Study Logging

**User Story:** As the researcher, I want detailed anonymized logs of each participant's games and learning activity, so that I can analyze outcomes and check that each group received its intended treatment.

#### Acceptance Criteria

1. WHEN a Pre_Test, Post_Test, or Retention_Window game ends, THE Study_Logger SHALL store the Participant_ID, phase, Difficulty, Board identifier, outcome, elapsed milliseconds, Game_Metrics, Metrics_Version, and serialized Move_Log.
2. WHILE a Study_Session game is active, THE Study_Logger SHALL record the time of every change in the browser tab's visibility.
3. THE Study_Logger SHALL record the start and end time of every Learning_Phase step.
4. THE Study_Logger SHALL record each Participant's Skill_Check results, Mastery_Checkpoint variations attempted, Slips, and pass time.
5. THE Study_Logger SHALL record each Participant's Practice_Mode intercepted actions and the Nudge stage displayed for each.
6. WHILE the Video_Panel is shown to a Participant, THE Study_Logger SHALL record play, pause, seek, and ended events with video positions, and the number of distinct seconds of video watched.
7. THE Study_Logger SHALL store each Participant's Background_Question answers and group.
8. THE Study_Logger SHALL store Study_Records without email addresses, names, IP addresses, or Account identifiers.
9. THE Study_Logger SHALL timestamp every Study_Record in ISO 8601 UTC format with millisecond precision.
10. THE Study_Logger SHALL send every Study_Record through the Sync_Queue.

### Requirement 26: Anonymized Data Export

**User Story:** As the researcher, I want to download the anonymized study data in a standard format, so that I can compute before-and-after effect sizes and compare Group A with Group B.

#### Acceptance Criteria

1. WHILE a Researcher is signed in, THE Data_Exporter SHALL offer separate CSV downloads for Participants (with group and Background_Question answers), test games, learning events, video events, survey responses, and Retention_Window results.
2. IF a person who is not a Researcher requests export data, THEN THE Backend SHALL deny the request.
3. THE Data_Exporter SHALL write CSV files that follow RFC 4180, use UTF-8 encoding, start with a header row, and include the Participant_ID on every row.
4. FOR ALL sets of Study_Records, including text with commas, quotation marks, line breaks, and non-ASCII characters, exporting to CSV and parsing the result with an RFC 4180 parser SHALL produce records equal to the originals (round-trip property).
5. THE Data_Exporter SHALL include, for each Participant and for each of Beginner and Intermediate, one row that pairs the Pre_Test and Post_Test values of outcome, elapsed time, Logical_Move_Rate, Pattern_Recognition_Speed, and Chording_Efficiency.
6. THE Data_Exporter SHALL include, for each Participant, the number of Retention_Window Sweep_Days with a completed Daily_Sweep and the Daily_Streak at the end of the Retention_Window.
7. THE Data_Exporter SHALL include a data dictionary file that describes every exported column, its unit, and the Metrics_Version definitions used.

### Requirement 27: Security and Data Protection

**User Story:** As the project owner, I want the public client to be unable to read or alter data it does not own, so that a static site with a public anon key stays safe.

#### Acceptance Criteria

1. THE Backend SHALL enable Row Level Security on every table in every schema exposed to the client API.
2. IF a database check finds a client-exposed table without Row Level Security, THEN THE Build_Pipeline SHALL fail the build.
3. THE Backend SHALL allow each Account to read and write only that Account's own profile, progress, and game-result rows.
4. THE Backend SHALL allow a Participant's session to insert Study_Records only for that Participant's Participant_ID and to read only that Participant's own Study_Session progress.
5. THE Backend SHALL allow only Researchers to read Study_Records of any Participant other than the reader.
6. THE Backend SHALL restrict granting the Researcher role to the project owner acting through the Supabase dashboard.
7. THE Backend SHALL restrict updating or deleting stored leaderboard results to the project owner, and SHALL restrict deleting Study_Records to the project owner and the withdrawal function of Requirement 21.
8. THE MineLogic client bundle SHALL contain the Supabase URL and the anon key as its only Backend credentials.
9. IF the built client bundle contains a token whose role claim is service_role, THEN THE Build_Pipeline SHALL fail the build.
10. THE Build_Pipeline SHALL read the Supabase URL and the anon key from repository secrets or environment variables.
11. THE Backend SHALL check the type, range, and length of every client-submitted value with database constraints or database functions before storing the value.

### Requirement 28: Build, Deployment, and Hosting

**User Story:** As the developer, I want MineLogic built, checked, and deployed automatically as a static site, so that peers can always use a working live version.

#### Acceptance Criteria

1. WHEN a commit is pushed to the main branch, THE Build_Pipeline SHALL run the type check, the test suite, and the Content_Validator, build the client, and deploy the client to GitHub Pages only when every step passes.
2. THE MineLogic client SHALL run as a static site on GitHub Pages, with all server-side logic in the Backend.
3. WHEN a person opens any MineLogic URL directly, including a Study_Link, THE MineLogic client SHALL load the screen that the URL names.
4. THE MineLogic client SHALL support the latest stable versions of Chrome, Edge, and Firefox on desktop and laptop computers.
5. IF the Backend cannot be reached, THEN THE MineLogic client SHALL keep the Tutorial_Player, Mastery_Checkpoint, Practice_Mode, and Timed_Game usable with client-generated Boards and show a notice that syncing is paused.
