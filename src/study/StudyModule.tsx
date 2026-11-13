/**
 * Study_Module entry screen (task 9.1, Requirement 21).
 *
 * This component owns the whole study-entry flow for a Study_Link:
 *
 *   loading        — looking up the ACTIVE Study_Config by Study_Code.
 *   invalid        — no ACTIVE config matches the code (21.2).
 *   config-error   — the config is missing an Evaluation_Board or the
 *                    Intermediate Video_Source (21.3).
 *   consent        — the config's consent text + statements, shown BEFORE any
 *                    other study screen (21.1); Agree enabled only when every
 *                    statement is affirmed (21.4); Decline ends the visit (21.5).
 *   resume-code    — enter a Resume_Code to restore an identity (21.10); offered
 *                    alongside consent, and carries its own Withdraw control
 *                    (21.11).
 *   resume-saved   — shows the Resume_Code and asks the Participant to save it
 *                    (21.8) before entering the Study_Session.
 *   session        — a placeholder landing for the current step; the real steps
 *                    are tasks 9.2/9.3. Routes to the first incomplete step
 *                    (21.9/21.10). Carries a Withdraw control (21.11).
 *   declined       — thank-you screen, no Participant created (21.5).
 *   withdrawn      — confirmation after withdrawal deletion (21.13).
 *
 * Same-browser auto-resume (21.9): on mount, if this browser already holds a
 * local pointer for the Study_Code, we skip consent and resume at the first
 * incomplete step. The Backend service functions and the local storage are
 * injected so the whole flow is testable without a live DB or real DOM storage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createParticipant as createParticipantRpc,
  getActiveConfig as getActiveConfigRpc,
  missingConfigPieces,
  resumeByCode as resumeByCodeRpc,
  withdraw as withdrawRpc,
  type Participant,
  type StudyConfig,
} from './studyService';
import {
  clearStudySession,
  clearTestMarker,
  loadStudySession,
  loadTestMarker,
  markStepComplete,
  saveStudySession,
  type StorageLike,
  type StudySessionPointer,
} from './studySessionStorage';
import { firstIncompleteStep, type StudyStep } from './steps';
import StudySession from './StudySession';

/** The injectable Backend surface, so tests can supply fakes. */
export interface StudyModuleServices {
  getActiveConfig: typeof getActiveConfigRpc;
  createParticipant: typeof createParticipantRpc;
  resumeByCode: typeof resumeByCodeRpc;
  withdraw: typeof withdrawRpc;
}

/** Default services wire straight to the RPC client. */
const defaultServices: StudyModuleServices = {
  getActiveConfig: getActiveConfigRpc,
  createParticipant: createParticipantRpc,
  resumeByCode: resumeByCodeRpc,
  withdraw: withdrawRpc,
};

export interface StudyModuleProps {
  /** The Study_Code from the Study_Link (21.1). */
  studyCode: string;
  /** Leave the study module (e.g. back to normal MineLogic). Optional. */
  onExit?: () => void;
  /** Backend services; defaults to the live RPC client. Injected in tests. */
  services?: Partial<StudyModuleServices>;
  /** Local session storage; defaults to window.localStorage. Injected in tests. */
  storage?: StorageLike;
  /** Clock for timestamps; defaults to Date.now. */
  now?: () => number;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'config-error'; missing: string[] }
  | { kind: 'consent' }
  | { kind: 'resume-code' }
  | { kind: 'resume-saved'; participant: Participant; step: StudyStep }
  | { kind: 'session'; participant: Participant; step: StudyStep }
  | { kind: 'declined' }
  | { kind: 'withdrawing'; participant: Participant }
  | { kind: 'withdrawn'; deleted: number };

export default function StudyModule({
  studyCode,
  onExit,
  services,
  storage,
  now = Date.now,
}: StudyModuleProps) {
  const svc = useMemo<StudyModuleServices>(
    () => ({ ...defaultServices, ...services }),
    [services],
  );

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [config, setConfig] = useState<StudyConfig | null>(null);
  // Which consent statements have been affirmed (index -> affirmed).
  const [affirmed, setAffirmed] = useState<boolean[]>([]);
  const [resumeInput, setResumeInput] = useState('');
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- Load: resolve the config, honoring a same-browser session (21.9) ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 21.9 — same-browser reopen resumes at the first incomplete step.
      const pointer = loadStudySession(studyCode, storage);
      const cfg = await svc.getActiveConfig(studyCode);
      if (cancelled) return;

      if (!cfg) {
        setPhase({ kind: 'invalid' }); // 21.2
        return;
      }
      setConfig(cfg);

      const missing = missingConfigPieces(cfg);
      if (missing.length > 0) {
        setPhase({ kind: 'config-error', missing }); // 21.3
        return;
      }

      if (pointer) {
        // 22.12 — if a test game was in progress when the page was reloaded or
        // closed, the "test in progress" marker survives. Record the game
        // Interrupted (the detailed Study_Record write is 9.3; here we mark the
        // test phase step complete locally) and resume at the NEXT step. The
        // actions logged before the interruption stay in the engine's Move_Log
        // for 9.3 to persist; locally we only advance the resume pointer.
        const marker = loadTestMarker(studyCode, storage);
        let completed = pointer.completedSteps;
        if (marker) {
          const updated = markStepComplete(studyCode, marker.step, now(), storage);
          if (updated) completed = updated.completedSteps;
          clearTestMarker(studyCode, storage);
        }

        // Resume this browser's existing Participant at the first incomplete step.
        const participant: Participant = {
          participantId: pointer.participantId,
          resumeCode: pointer.resumeCode,
          studyGroup: null,
        };
        setPhase({
          kind: 'session',
          participant,
          step: firstIncompleteStep(completed),
        });
        return;
      }

      // 21.1 — consent is shown before any other study screen.
      setAffirmed(new Array(cfg.consentStatements.length).fill(false));
      setPhase({ kind: 'consent' });
    })();
    return () => {
      cancelled = true;
    };
  }, [studyCode, svc, storage]);

  const allAffirmed = affirmed.length > 0 && affirmed.every(Boolean);

  const toggleStatement = useCallback((index: number) => {
    setAffirmed((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }, []);

  // --- Agree: create a Participant and show the Resume_Code (21.4, 21.8) ---
  const onAgree = useCallback(async () => {
    if (!config || !allAffirmed || busy) return;
    setBusy(true);
    const participant = await svc.createParticipant(config.id, config.consentVersion);
    setBusy(false);
    if (!participant) return; // transient error: stay on consent to retry
    // Persist the local pointer so a same-browser reopen resumes (21.9).
    const pointer: Omit<StudySessionPointer, 'updatedAt'> = {
      studyCode,
      participantId: participant.participantId,
      resumeCode: participant.resumeCode,
      completedSteps: [],
    };
    saveStudySession(pointer, now(), storage);
    setPhase({
      kind: 'resume-saved',
      participant,
      step: firstIncompleteStep([]),
    });
  }, [config, allAffirmed, busy, svc, studyCode, now, storage]);

  // --- Decline: thank-you, no Participant created (21.5) ---
  const onDecline = useCallback(() => {
    clearStudySession(studyCode, storage);
    setPhase({ kind: 'declined' });
  }, [studyCode, storage]);

  // --- Resume by code (21.10) ---
  const onSubmitResumeCode = useCallback(async () => {
    const code = resumeInput.trim().toUpperCase();
    if (!code || busy) return;
    setResumeError(null);
    setBusy(true);
    const participant = await svc.resumeByCode(code);
    setBusy(false);
    if (!participant) {
      setResumeError('That resume code was not recognized. Check it and try again.');
      return;
    }
    // Rebind this browser to the restored identity so same-browser resume works.
    saveStudySession(
      {
        studyCode,
        participantId: participant.participantId,
        resumeCode: participant.resumeCode,
        completedSteps: [],
      },
      now(),
      storage,
    );
    // Without server progress yet, resume at the first incomplete step.
    const pointer = loadStudySession(studyCode, storage);
    setPhase({
      kind: 'session',
      participant,
      step: firstIncompleteStep(pointer?.completedSteps ?? []),
    });
  }, [resumeInput, busy, svc, studyCode, now, storage]);

  // --- Withdraw (21.11, 21.12, 21.13) ---
  const onWithdraw = useCallback(
    async (participant: Participant) => {
      if (busy) return;
      setBusy(true);
      const deleted = await svc.withdraw(participant.participantId);
      setBusy(false);
      if (deleted === null) return; // transient error: let the user retry
      clearStudySession(studyCode, storage); // sever this browser from the identity
      setPhase({ kind: 'withdrawn', deleted });
    },
    [busy, svc, studyCode, storage],
  );

  const enterSession = useCallback((participant: Participant, step: StudyStep) => {
    setPhase({ kind: 'session', participant, step });
  }, []);

  // ----------------------------------------------------------------------
  // Rendering
  // ----------------------------------------------------------------------
  const panel =
    'w-full max-w-xl bg-slate-800 rounded-xl p-6 flex flex-col gap-4 shadow-lg';

  if (phase.kind === 'loading') {
    return (
      <section className={panel} data-testid="study-loading" aria-busy="true">
        <p className="text-slate-300">Loading the study…</p>
      </section>
    );
  }

  if (phase.kind === 'invalid') {
    return (
      <section className={panel} data-testid="study-invalid" role="alert">
        <h1 className="text-xl font-semibold">This study link is not valid</h1>
        <p className="text-slate-300">
          The link you opened does not match an active study. Check the link or
          contact the researcher.
        </p>
        {onExit && (
          <button className="self-start text-sky-400 underline" onClick={onExit}>
            Go to MineLogic
          </button>
        )}
      </section>
    );
  }

  if (phase.kind === 'config-error') {
    return (
      <section className={panel} data-testid="study-config-error" role="alert">
        <h1 className="text-xl font-semibold">This study isn’t ready yet</h1>
        <p className="text-slate-300">
          The study is missing required content and cannot start new sessions.
        </p>
        <ul className="list-disc pl-6 text-slate-400 text-sm">
          {phase.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>
    );
  }

  if (phase.kind === 'declined') {
    return (
      <section className={panel} data-testid="study-declined">
        <h1 className="text-xl font-semibold">Thank you</h1>
        <p className="text-slate-300">
          You declined to take part, so nothing has been recorded. You can close
          this tab.
        </p>
        {onExit && (
          <button className="self-start text-sky-400 underline" onClick={onExit}>
            Go to MineLogic
          </button>
        )}
      </section>
    );
  }

  if (phase.kind === 'withdrawn') {
    return (
      <section className={panel} data-testid="study-withdrawn">
        <h1 className="text-xl font-semibold">You’ve withdrawn</h1>
        <p className="text-slate-300">
          Your study data has been deleted. The session is over and nothing more
          will be recorded.
        </p>
      </section>
    );
  }

  if (phase.kind === 'consent' && config) {
    return (
      <section className={panel} data-testid="study-consent">
        <h1 className="text-xl font-semibold">Before you begin</h1>
        <div
          className="text-slate-300 whitespace-pre-wrap text-sm max-h-60 overflow-auto"
          data-testid="consent-text"
        >
          {config.consentText}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-slate-200 font-medium mb-1">
            Please confirm each statement
          </legend>
          {config.consentStatements.map((statement, i) => (
            <label key={i} className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={affirmed[i] ?? false}
                onChange={() => toggleStatement(i)}
                data-testid={`consent-statement-${i}`}
              />
              <span>{statement}</span>
            </label>
          ))}
        </fieldset>

        <div className="flex gap-3">
          <button
            className="px-4 py-2 rounded bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onAgree}
            disabled={!allAffirmed || busy}
            data-testid="consent-agree"
          >
            I agree — begin
          </button>
          <button
            className="px-4 py-2 rounded bg-slate-600 text-white"
            onClick={onDecline}
            data-testid="consent-decline"
          >
            I don’t want to take part
          </button>
        </div>

        <button
          className="self-start text-slate-400 underline text-sm"
          onClick={() => {
            setResumeError(null);
            setResumeInput('');
            setPhase({ kind: 'resume-code' });
          }}
          data-testid="goto-resume"
        >
          I already have a resume code
        </button>
      </section>
    );
  }

  if (phase.kind === 'resume-code') {
    return (
      <section className={panel} data-testid="study-resume-code">
        <h1 className="text-xl font-semibold">Resume your session</h1>
        <p className="text-slate-300 text-sm">
          Enter the resume code you saved to pick up where you left off.
        </p>
        <input
          type="text"
          className="px-3 py-2 rounded bg-slate-900 text-slate-100 border border-slate-600"
          value={resumeInput}
          onChange={(e) => setResumeInput(e.target.value)}
          placeholder="MLS-XXXX-XXXX"
          data-testid="resume-input"
          aria-label="Resume code"
        />
        {resumeError && (
          <p className="text-rose-400 text-sm" role="alert" data-testid="resume-error">
            {resumeError}
          </p>
        )}
        <div className="flex gap-3">
          <button
            className="px-4 py-2 rounded bg-sky-600 text-white disabled:opacity-40"
            onClick={onSubmitResumeCode}
            disabled={busy || resumeInput.trim().length === 0}
            data-testid="resume-submit"
          >
            Resume
          </button>
          <button
            className="px-4 py-2 rounded bg-slate-600 text-white"
            onClick={() => setPhase({ kind: 'consent' })}
            data-testid="resume-back"
          >
            Back
          </button>
        </div>

        {/* 21.11 — the Resume_Code entry screen also offers Withdraw. With no
            identity restored yet there is nothing to delete, so withdrawing
            here simply ends the visit without recording anything. */}
        <button
          className="self-start text-rose-400 underline text-sm"
          onClick={() => setPhase({ kind: 'withdrawn', deleted: 0 })}
          data-testid="resume-withdraw"
        >
          Withdraw from the study
        </button>
      </section>
    );
  }

  if (phase.kind === 'resume-saved') {
    const { participant, step } = phase;
    return (
      <section className={panel} data-testid="study-resume-saved">
        <h1 className="text-xl font-semibold">Save your resume code</h1>
        <p className="text-slate-300 text-sm">
          Write this down. You can use it to return to your session on any
          device.
        </p>
        <p
          className="text-2xl font-mono tracking-widest text-emerald-300 bg-slate-900 rounded p-3 text-center"
          data-testid="resume-code-display"
        >
          {participant.resumeCode}
        </p>
        <button
          className="self-start px-4 py-2 rounded bg-sky-600 text-white"
          onClick={() => enterSession(participant, step)}
          data-testid="resume-saved-continue"
        >
          I’ve saved it — continue
        </button>
        <WithdrawControl
          busy={busy}
          onConfirm={() => onWithdraw(participant)}
        />
      </section>
    );
  }

  if (phase.kind === 'session' && config) {
    const { participant, step } = phase;
    // The Study_Session step router (22.1/22.2, Requirements 22 and 23). The
    // Withdraw control (21.11) is passed down so it stays on every step screen.
    return (
      <StudySession
        studyCode={studyCode}
        participantId={participant.participantId}
        resumeCode={participant.resumeCode}
        config={config}
        initialGroup={
          participant.studyGroup === 'Group_A' || participant.studyGroup === 'Group_B'
            ? participant.studyGroup
            : null
        }
        startStep={step}
        storage={storage}
        now={now}
        withdrawControl={
          <WithdrawControl busy={busy} onConfirm={() => onWithdraw(participant)} />
        }
      />
    );
  }

  // withdrawing (transient) — show a minimal busy state.
  return (
    <section className={panel} data-testid="study-busy" aria-busy="true">
      <p className="text-slate-300">Working…</p>
    </section>
  );
}

/**
 * The Withdraw control offered on every Study_Session screen (21.11). It asks
 * for a confirmation before deleting, satisfying "confirms withdrawal" (21.12).
 */
function WithdrawControl({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        className="self-start text-rose-400 underline text-sm"
        onClick={() => setConfirming(true)}
        data-testid="withdraw"
      >
        Withdraw from the study
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-slate-700 pt-3">
      <p className="text-slate-300 text-sm">
        Withdrawing deletes all of your study data. This can’t be undone.
      </p>
      <div className="flex gap-3">
        <button
          className="px-4 py-2 rounded bg-rose-600 text-white disabled:opacity-40"
          onClick={onConfirm}
          disabled={busy}
          data-testid="withdraw-confirm"
        >
          Yes, withdraw and delete my data
        </button>
        <button
          className="px-4 py-2 rounded bg-slate-600 text-white"
          onClick={() => setConfirming(false)}
          data-testid="withdraw-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
