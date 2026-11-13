# MineLogic requirements detailing: shared decisions

Staging notes for the requirements detailing pass. Every refined requirement must follow these. They are merged into requirements.md at the end.

## New glossary terms

- **Active_Game**: a game that has started and has not ended. A game on a full Board starts with the Reveal_Click on its Start_Tile. A game on a Board with an initial revealed set starts when the Board is loaded. A game ends when a Reveal_Action wins or loses it, or when another component ends it with an outcome such as Timed_Out or Interrupted.
- **Press_Gesture**: the interval from a mouse or trackpad button press made while no button is held until every button is released. A trackpad click that the operating system reports as a secondary click counts as a secondary press.
- **Well_Formed_Board**: a Board that breaks none of the Board_Format validity rules in Requirement 3.
- **Board_Equality**: two Boards are equal when they have the same identifier, width, height, and set of mine Tiles, and either the same Start_Tile or the same set of initially revealed Tiles. Listing order does not matter.
- **Generation_Seed**: an integer from 0 to 4,294,967,295 that, with the Difficulty and the Generator_Version, determines the Board that the Board_Generator outputs.
- **Generator_Version**: the version identifier of the Board_Generator's rules, solving order, and Step_Budget. It changes whenever a change could alter the Board output for any Difficulty and Generation_Seed.
- **Step_Budget**: a fixed number of Solver search steps, recorded in both the Metrics_Version and the Generator_Version, calibrated so that the Solver reaches it in about 1,000 milliseconds on the Reference_Device.
- **Inexact_State** (revised definition): a Board_State for which the Solver used its whole Step_Budget before finishing the classification. It depends only on the Board_State and the Step_Budget, never on device speed or load.
- **Assigned_Fixed_Board**: the Fixed_Board a game must be played on: the current Sweep_Day's Daily_Sweep_Board for a Daily_Sweep game, or the game's Evaluation_Board for a Pre_Test or Post_Test game. No other game has one.
- **Bank_History**: the identifiers of the Puzzle_Bank Boards supplied to one player, each with the time it was last supplied. It is stored in the browser's local storage for a Guest and in the Backend for an Account.
- **End_Entry**: the closing item of the Move_Log of an ended game. It records the outcome (Won, Lost, Timed_Out, or Interrupted) and the elapsed milliseconds at which the game ended. It is not a Player_Action and does not count toward Total_Clicks. A game in progress has no End_Entry.
- **Objective_Tiles**: the non-empty set of covered, non-mine Tiles on a Do_Step's Mini_Board that its Objective requires the learner to reveal. This is separate from a Reveal_Action's Target_Tiles.
- **Chord_Objective**: an Objective that is met only when every Objective_Tile was revealed by a Chord_Click, directly or through a Cascade that the Chord_Click starts.
- **Practiced_Pattern_Type**: the one Pattern_Type, taken from its Lesson's taught Pattern_Types, that a Do_Step exercises.
- **Video_Event**: a play, pause, seek, or ended event emitted by the Video_Panel, with its type, the playback position in seconds (for a seek, the positions before and after), and the Watched_Seconds count since the Video_Panel appeared for that Difficulty.
- **Watched_Seconds**: the number of distinct whole seconds of a video's timeline that overlap a played interval. Replayed seconds count once. Seconds skipped by a seek do not count.

## Global decisions

- D1. Device-independent Solver budget: the Solver stops at its Step_Budget instead of a wall-clock limit, so Inexact_States, Game_Metrics, recomputation, board generation, and Content_Validator results are identical on every device. A separate performance criterion requires the Step_Budget to be reached within about 1,000 milliseconds on the Reference_Device.
- D2. Every stored game (browser or Backend: game results, leaderboard results, and Study_Records) stores the Board identifier, the Board's canonical Board_Format text, the Metrics_Version, the Game_Metrics, and the serialized Move_Log including the End_Entry. The Backend rejects a write that has Game_Metrics but lacks any of these.
- D3. Each Move_Log entry has an action type, a Tile, whole elapsed milliseconds since the game started (the Start_Tile's Reveal_Click is at 0), and a Wasted_Click mark. The Board_Engine writes the End_Entry for Won and Lost. The Study_Module writes it for Timed_Out (time = the time cap) and for Interrupted (time = the last logged entry's time, or 0 when there is none). A Timed_Game's elapsed time equals its End_Entry time.
- D4. Canonical_Solve_Path: starting from the Board_State after the Start_Tile reveal and its Cascade (or from the initial revealed set), each step reveals the first Provably_Safe covered Tile in row-major order, with its Cascade, until every non-mine Tile is revealed.
- D5. Board metadata (Generation_Seed, Generator_Version, 3BV, Pattern_Instance counts, Trap_Tile labels, and explanation text) is stored beside the Board_Format text in content or metadata records, never inside the Board_Format text.
- D6. Content_Validator failures: when any check fails, the Content_Validator fails the run and reports each failing content item's identifier and the name of the failed check. One shared criterion in Requirement 28 states this.
- D7. Bank_History is part of stored and merged progress (Requirement 20). It is merged as the union of Board identifiers, keeping the later supply time for each.
- D8. When the Backend cannot be reached (Requirement 28), games with an Assigned_Fixed_Board (Daily_Sweep, Pre_Test, Post_Test) never fall back to a generated Board. They show the no-Board error with a retry control.
- D9. The Content_Validator rejects a Daily_Sweep_Board or Evaluation_Board whose mine positions, as placed, rotated, or reflected, match a Puzzle_Bank Board, and the Bank_Importer rejects the reverse case.
- D10. Latency: the result of an applied Player_Action is displayed within 50 milliseconds of the input on the Reference_Device. The 100 millisecond bound applies only to screen updates that do not depend on a pending Solver classification.
- D11. Practice_Mode, Do_Steps, and Mastery_Checkpoints gate actions on the Solver's classification. The client classifies each new Board_State right after every applied action. An action made before that classification is ready is held, then applied or intercepted when the classification arrives, with a busy indicator if the wait passes 100 milliseconds.
- D12. Before the Start_Tile is revealed, Reveal_Clicks on other Tiles and all Flag_Toggles are ignored and not logged, and a prompt points to the Start_Tile.
- D13. A chord input on any revealed Tile, including a zero-Number Tile, issues a Chord_Click. A Chord_Click that changes nothing is a Wasted_Click and counts toward Total_Clicks. Zero-Number Tiles connect through all eight Neighbors in an Opening and a Cascade, and a flagged Tile stops a Cascade and stays covered.
- D14. Video: Requirement 23.8 shows the Video_Panel beside the Lessons only, never during a Mastery_Checkpoint. Requirement 21.3 checks the Intermediate Difficulty's Video_Source from Requirement 12. Requirement 25.6 records Video_Events and Watched_Seconds per Video_Panel appearance, and records when the video error message is shown to a Participant.
- D15. The glossary entry for Objective uses Objective_Tiles, not Target_Tiles.
- D16. Single-clue attribution (Requirement 7): a safe Tile proved by one Number is attributed to Satisfied_Number only if the mines that Number relies on were already Provably_Mine before the Player_Action that made the Tile provable. A Tile that is already provable in a Board's initial state, or whose supporting mines became Provably_Mine in the same action, is attributed to Exposed_Mines. A Satisfied_Number Do_Step therefore needs an Objective_Tile that becomes Provably_Safe only after an earlier learner action.

## More glossary terms (from Requirements 7, 8, 10, 13, 14)

- **Prior_Mines**: for a Provably_Safe Tile, the Tiles that were Provably_Mine in the Board_State immediately before the Reveal_Action after which the Tile first became Provably_Safe. It is empty for a Tile already Provably_Safe in the initial Board_State of a Board with an initial revealed set. It is fixed when the Tile first becomes Provably_Safe.
- **Reduced_Value** (revised definition): for a Tile being attributed, a revealed Number minus the count of that Number's Neighbors that are among the Tile's Prior_Mines.
- **Deduction_Level** (revised definition): the lowest of four levels, ordered Single_Clue, Pair_Clue, Multi_Clue, Mine_Count, at which a covered Tile is proven safe. Single_Clue: a chain of deductions that each use one revealed Number, with the Tile's Prior_Mines and every Tile proven earlier in the chain. Pair_Clue: the same, with each deduction using at most two revealed Numbers. Multi_Clue: all revealed Numbers together, without the total mine count. Mine_Count: also uses the total mine count.
- **Wall_Run**: a run of 2, 3, or 4 revealed Numbers on consecutive Tiles of one row or column whose Reduced_Values read exactly 1-1 (Wall_1_1), 1-2-1 (Wall_1_2_1), or 1-2-2-1 (Wall_1_2_2_1), and whose covered Neighbors that are not Prior_Mines all lie in the one line of Tiles directly beside and parallel to the run. It proves a Tile in that line that is provable at Pair_Clue level from the run's Numbers and the Tile's Prior_Mines alone. If several runs prove a Tile, the run whose first Number comes first in row-major order is used.
- **Anchor_Numbers** (revised definition): for a Tile attributed to a wall Pattern_Type, the Numbers of its Wall_Run. Otherwise, the smallest set of revealed Numbers that proves the Tile at its Deduction_Level with its Prior_Mines (and, for Mine_Count, the total mine count), with ties broken by comparing the sets as row-major sorted lists. Only a Mine_Count Tile can have an empty set.
- **Pattern_Instance_Status**: one of open, resolved, excluded, superseded, or unresolved. A Pattern_Instance is open from its appearance until it gets one of the other four statuses, which is final.
- **Metrics_Version** (revised definition): the version identifier of the Metrics_Engine definitions, the Pattern_Detector rules, and the Step_Budget that produced a set of Game_Metrics. It changes whenever a change could alter any Game_Metric for some Board and Move_Log.
- **Game_Metrics** (revised definition): outcome, elapsed milliseconds, Logical_Move_Rate, Chording_Efficiency, 3BV, Total_Clicks, counts of Reveal_Clicks, Flag_Toggles, Chord_Clicks, Wasted_Clicks, Guesses, and Wrong_Flags, Pattern_Recognition_Speed and the counts of superseded, excluded, resolved, and unresolved Pattern_Instances per Pattern_Type, and the partial mark with its two excluded counts.
- **Onboarding_Milestone**: the milestone stored when the Skill_Check is complete or the learner skips the Onboarding_Flow. Stored like other milestones (Requirement 20).
- **Checkpoint_Attempt**: one run of a Difficulty's Mastery_Checkpoint, from its start until it is passed or the learner leaves the screen, reloads, or closes the page. Hiding the tab does not end it. Its consecutive-success count never carries into another Checkpoint_Attempt.
- **Intercepted_Action**: in Practice_Mode, a Reveal_Click other than the Start_Tile reveal, or a revealing Chord_Click, made in an Active_Game when one of its Target_Tiles is not Provably_Safe (in a Board_State that is not an Inexact_State) or is a mine (in an Inexact_State). Its clicked Tile is the covered Tile of a Reveal_Click or the revealed Tile of a Chord_Click.
- **Revealing Chord_Click** (glossary refinement): a Chord_Click on a Number whose count of flagged Neighbors equals the Number and that has at least one covered, unflagged Neighbor. Gated modes judge a Chord_Click by this rule before applying it.

## More global decisions

- D17. Chording_Efficiency is reported only for Won games. For Lost, Timed_Out, and Interrupted games it is not available, while Total_Clicks and 3BV are still reported. This affects Requirements 15.6, 15.7, 26.5, and Assumptions 3 and 13.
- D18. Pattern_Instance counts on the Canonical_Solve_Path (Requirements 5.5, 18.2, 22.6) use the resolved counts that Requirement 7 criterion 10 reports.
- D19. Each Pattern_Instance ends with exactly one status. When counting, the order is superseded, excluded, resolved, unresolved (Requirements 7, 8.9, 16.5).
- D20. Replay labels (Requirement 16.3) include labels for the Start_Tile reveal and for Reveal_Actions taken in an Inexact_State (unclassified), matching the Metrics_Engine.
- D21. Skill_Check results and the Onboarding_Milestone are milestones (Requirement 20). After a merge, a Difficulty counts as Correct if any stored Skill_Check result for it is Correct, which keeps Requirement 17.3 monotonicity and Requirement 20.7 confluence.
- D22. In a Study_Session, the Background_Questions use the Requirement 10 choices and the Skill_Check runs under Requirement 10 rules without a Skip control. The Onboarding_Flow never runs during a Study_Session.
- D23. Offline (Requirement 28.5): authored content (Skill_Check_Snippets, Lesson Mini_Boards, Checkpoint_Variations) is bundled with the client, so the Onboarding_Flow, Tutorial_Player, and Mastery_Checkpoint stay usable offline. Milestones recorded offline show at once and wait in the Sync_Queue.
- D24. Study logging (Requirements 25.4, 25.5): for each Checkpoint_Attempt, log each presented Checkpoint_Variation's identifier and result, each Slip's type (Guess or Wrong_Flag) and Tile, and the pass time. For each Intercepted_Action, log the clicked Tile, elapsed time, and the Nudge stage shown after it. Also log More Help selections.
- D25. For an action held under D11, the 50 millisecond display bound of Requirement 2.4 runs from the moment the Solver's classification is ready.
- D26. The Video_Panel is hidden during a Mastery_Checkpoint, even when the checkpoint shares the Tutorial_Player's screen (Requirement 12).

## More glossary terms (from Requirements 15 to 19)

- **Replay_Position**: a whole number from 0 to the number of Player_Actions in the replayed Move_Log. Position 0 shows the Board before its first Player_Action. Position k shows the Board_State immediately after the k-th Player_Action. For a lost game, the next-to-last position shows the Board_State immediately before the losing action.
- **Loop_Step**: one of the four steps the Hub shows for each Difficulty, in Loop_Step order: Lessons, Mastery_Checkpoint, Practice_Mode, Timed_Game. The replay is offered after each Timed_Game and is not a Loop_Step.
- **Current_Sweep_Day**: the Sweep_Day that contains the current UTC time on the Backend's clock. While the Backend cannot be reached, the client uses the device clock converted to UTC, only for the Hub countdown and Daily_Streak.
- **Sweep_Reserve**: the Fixed_Boards, not assigned to any Sweep_Day, from which the Daily_Sweep chooses the board of a Sweep_Day that has no assigned Board.
- **Sweep_Attempt**: one Daily_Sweep game, from the Start_Tile reveal until it ends or is abandoned (the player leaves the screen, reloads, or closes the page). Its Sweep_Day is the Current_Sweep_Day at the game request. Its attempt number is one more than the player's earlier recorded Sweep_Attempts of that Sweep_Day.
- **Game_Identifier**: a random version 4 UUID that the client assigns to a game when its Start_Tile is revealed, stored and submitted with the game's result.
- **Game_Start_Time**: the UTC time, in milliseconds from the player's computer clock, at which the client applied the Start_Tile's Reveal_Click.
- **First_Attempt**: for a player and a Sweep_Day, the Sweep_Attempt with attempt number 1.
- **Leaderboard_Eligible** (revised definition): the status of a winning result that the Leaderboard_Service accepted after the rate limit, plausibility, and practice checks of Requirement 19.

## More global decisions

- D27. Hub recommendation (Requirement 17.6): the target Difficulty is the lowest Difficulty with an incomplete Loop_Step and no Correct Skill_Check result, or else the lowest Difficulty with an incomplete Loop_Step, so a learner finishes one Difficulty's whole loop before moving on.
- D28. Sync_Queue retry policy (Requirement 20.9): retry only writes that failed because the Backend could not be reached (with increasing delays), retry rate-limit rejections after the 3,600-second window, and drop any other rejected write, keeping a local copy and showing a notice. If local storage is full or unavailable, show a notice that progress cannot be saved in this browser.
- D29. Sweep_Attempt records, completed Sweep_Days, Bank_History, milestones, and game results are all stored and merged as unions (Requirement 20). The longest Daily_Streak is derived from the merged set, never stored separately.
- D30. Retention logging (Requirements 24.8, 26.6): log each Sweep_Attempt's attempt number. The end-of-window Daily_Streak uses Requirement 18 criterion 7 with the last Retention_Window Sweep_Day as D.
- D31. Study separation: activity inside a Study_Session (Background_Questions, Skill_Check, Lessons, checkpoints, practice, test games) is stored only as Study_Records and never counts as the browser's Guest or Account progress. A Participant's Daily_Sweep plays during the Retention_Window are logged as Study_Records and also follow normal Guest or Account rules. Their leaderboard entries appear only for an Account, under the Account's Display_Name, never an alias, so Requirement 24.9's alias rule is replaced by this one.

## More glossary terms (from Requirements 20 to 24)

- **Progress_Record**: one recorded item of a person's progress outside a Study_Session: a milestone (completed Do_Step, completed Lesson, passed Mastery_Checkpoint, completed Practice_Mode board with its UTC completion time, Skill_Check result, or Onboarding_Milestone), a game result (Requirement 15.8), a completed Sweep_Day, a Sweep_Attempt record (with its Game_Identifier), or a Bank_History entry.
- **Guest_Progress**: the Progress_Records stored in one browser's local storage for a Guest.
- **Progress_Union**: for two sets of Progress_Records, the set holding every record of either set, with equal records held once and, for each Board identifier, only the Bank_History entry with the later supply time.
- **Study_Identity**: a Participant's Participant_ID and Resume_Code, with the Study_Code of the Study_Config under which the Participant consented, held in the browser's local storage.
- **Study_Step**: one part of a Study_Session after consent, in Study_Step order: Resume_Code display, Background_Questions, Pre_Beginner game, Pre_Intermediate game, Skill_Check, Beginner, Intermediate, and Expert learning blocks, Post_Beginner game, Post_Intermediate game, Post_Expert game, Survey_Form, completion screen.
- **Resume_Code** (revised definition): 12 characters chosen at random from A to Z and 2 to 9 without I and O, unique among Participants, shown as three hyphen-separated groups of four and matched ignoring letter case, spaces, and hyphens.
- **Test_Game**: one Pre_Test or Post_Test game, played as a Timed_Game with one Evaluation_Board as its Assigned_Fixed_Board.
- **Time_Cap**: the longest elapsed time a Test_Game may run: the Study_Config's value for the Difficulty when it is a whole number of seconds from 60 to 3,600, otherwise 240, 480, or 720 seconds for Beginner, Intermediate, or Expert.
- **Survey_Response**: the one Study_Record that holds a Participant's accepted Survey_Form submission.
- **Unanswered_Item**: a rating or demographics item with nothing selected, or an open-ended prompt with no characters, when the submission is accepted.
- **Survey_Submission_Day**: the Current_Sweep_Day when the Survey_Form accepts a Participant's submission.
- **Retention_Window** (revised definition): the five consecutive Sweep_Days after the Participant's Survey_Submission_Day. A Participant without a Survey_Response has none.

## More global decisions

- D32. The Backend keeps at most one Test_Game Study_Record per Participant_ID and Evaluation_Board: it keeps the first, accepts a repeated delivery of the same record, and rejects a different one (Requirement 25). Test_Game Study_Records also store the Time_Cap in milliseconds.
- D33. Under D31, a signed-in Participant's Sweep_Day leaderboard time could be matched to a Retention_Window Study_Record. The consent text must disclose this, and the Data_Exporter exports Retention_Window elapsed times rounded to whole seconds.
- D34. Requirement 26.6 counts Retention_Window Sweep_Days with a Won Study_Record, and the end-of-window Daily_Streak is computed from those Won Sweep_Days only.
- D35. Within a Study_Session, components that normally read or write progress through the Progress_Service (Requirements 10.6, 11.9, 11.10, 13.4, 14.11) use only the Participant's Study_Records. The group request (Requirement 23.3) is a direct Backend call, not a Sync_Queue write. The consent record is the Participant's first write.
- D36. The leaderboard submission is queued as a separate write from the game result, so a dropped leaderboard rejection never removes the game result from progress.
