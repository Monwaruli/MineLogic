// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import StudyModule, { type StudyModuleServices } from './StudyModule';
import type { StudyConfig, Participant } from './studyService';
import {
  loadStudySession,
  saveStudySession,
  type StorageLike,
} from './studySessionStorage';

afterEach(cleanup);

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

function config(overrides: Partial<StudyConfig> = {}): StudyConfig {
  return {
    id: 'cfg-1',
    studyCode: 'STUDY1',
    consentText: 'Consent text here.',
    consentVersion: 'v1',
    consentStatements: ['I am 18+', 'I agree'],
    includesExpert: false,
    preBeginner: 'pb',
    preIntermediate: 'pi',
    postBeginner: 'ob',
    postIntermediate: 'oi',
    postExpert: null,
    intermediateVideoSource: 'https://v',
    surveyRatingItems: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
    surveyOpenPrompts: ['o1', 'o2', 'o3'],
    surveyDemographicsItem: 'demo',
    ...overrides,
  };
}

/**
 * A set of valid, winnable Evaluation_Boards (as Board_Format text) so a
 * resumed session that lands on the Pre_Test step can render a real test game
 * instead of a parse error.
 */
function playableBoards(): Partial<StudyConfig> {
  const b = [
    'version 1',
    'id eval',
    'width 3',
    'height 3',
    'mines 1',
    'mine 0 2',
    'start 2 0',
    '',
  ].join('\n');
  return { preBeginner: b, preIntermediate: b, postBeginner: b, postIntermediate: b };
}

/** Build injectable services with scripted behavior and call tracking. */
function services(over: Partial<StudyModuleServices> = {}): {
  svc: Partial<StudyModuleServices>;
  created: { calls: number };
  withdrawn: { calls: string[] };
} {
  const created = { calls: 0 };
  const withdrawn: { calls: string[] } = { calls: [] };
  const svc: Partial<StudyModuleServices> = {
    getActiveConfig: async () => config(),
    createParticipant: async () => {
      created.calls += 1;
      return { participantId: 'p-1', resumeCode: 'MLS-ABCD-EFGH', studyGroup: null } as Participant;
    },
    resumeByCode: async () => null,
    withdraw: async (id: string) => {
      withdrawn.calls.push(id);
      return 3;
    },
    ...over,
  };
  return { svc, created, withdrawn };
}

describe('StudyModule routing (21.1, 21.2, 21.3)', () => {
  it('shows the consent screen first for a valid active code (21.1)', async () => {
    const { svc } = services();
    render(<StudyModule studyCode="STUDY1" services={svc} storage={memoryStorage()} />);
    expect(await screen.findByTestId('study-consent')).toBeTruthy();
    expect(screen.getByTestId('consent-text').textContent).toContain('Consent text here.');
  });

  it('shows an invalid-link message for an unknown code (21.2)', async () => {
    const { svc } = services({ getActiveConfig: async () => null });
    render(<StudyModule studyCode="NOPE" services={svc} storage={memoryStorage()} />);
    expect(await screen.findByTestId('study-invalid')).toBeTruthy();
  });

  it('shows a configuration error when a board or video is missing (21.3)', async () => {
    const { svc } = services({
      getActiveConfig: async () => config({ intermediateVideoSource: null, postBeginner: null }),
    });
    render(<StudyModule studyCode="STUDY1" services={svc} storage={memoryStorage()} />);
    const err = await screen.findByTestId('study-config-error');
    expect(err.textContent).toContain('Post_Beginner');
    expect(err.textContent).toContain('Intermediate Video_Source');
  });
});

describe('StudyModule consent (21.4, 21.5, 21.8)', () => {
  it('disables Agree until every statement is affirmed (21.4)', async () => {
    const { svc } = services();
    render(<StudyModule studyCode="STUDY1" services={svc} storage={memoryStorage()} />);
    await screen.findByTestId('study-consent');

    const agree = screen.getByTestId('consent-agree') as HTMLButtonElement;
    expect(agree.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('consent-statement-0'));
    expect(agree.disabled).toBe(true); // one still unaffirmed
    fireEvent.click(screen.getByTestId('consent-statement-1'));
    expect(agree.disabled).toBe(false); // all affirmed
  });

  it('agree creates a Participant and surfaces the Resume_Code (21.4, 21.8)', async () => {
    const storage = memoryStorage();
    const { svc, created } = services();
    render(<StudyModule studyCode="STUDY1" services={svc} storage={storage} now={() => 1000} />);
    await screen.findByTestId('study-consent');

    fireEvent.click(screen.getByTestId('consent-statement-0'));
    fireEvent.click(screen.getByTestId('consent-statement-1'));
    fireEvent.click(screen.getByTestId('consent-agree'));

    const display = await screen.findByTestId('resume-code-display');
    expect(display.textContent).toBe('MLS-ABCD-EFGH');
    expect(created.calls).toBe(1);
    // The local pointer was written so a same-browser reopen resumes (21.9).
    expect(loadStudySession('STUDY1', storage)?.participantId).toBe('p-1');
  });

  it('decline shows a thank-you and creates no Participant (21.5)', async () => {
    const storage = memoryStorage();
    const { svc, created } = services();
    render(<StudyModule studyCode="STUDY1" services={svc} storage={storage} />);
    await screen.findByTestId('study-consent');

    fireEvent.click(screen.getByTestId('consent-decline'));
    expect(await screen.findByTestId('study-declined')).toBeTruthy();
    expect(created.calls).toBe(0);
    expect(loadStudySession('STUDY1', storage)).toBeNull();
  });
});

describe('StudyModule resume (21.9, 21.10)', () => {
  it('auto-resumes in the same browser at the first incomplete step (21.9)', async () => {
    const storage = memoryStorage();
    saveStudySession(
      {
        studyCode: 'STUDY1',
        participantId: 'p-7',
        resumeCode: 'MLS-ABCD-EFGH',
        completedSteps: ['Background_Questions'],
      },
      1,
      storage,
    );
    const { svc } = services({ getActiveConfig: async () => config({ ...playableBoards() }) });
    render(<StudyModule studyCode="STUDY1" services={svc} storage={storage} />);
    // Background_Questions is complete, so the session resumes at the Pre_Test
    // step (first incomplete), which renders the test-game phase.
    await screen.findByTestId('study-step-pretest');
  });

  it('a valid Resume_Code restores identity and resumes (21.10)', async () => {
    const storage = memoryStorage();
    const { svc } = services({
      resumeByCode: async () =>
        ({ participantId: 'p-restored', resumeCode: 'MLS-ABCD-EFGH', studyGroup: null }) as Participant,
    });
    render(<StudyModule studyCode="STUDY1" services={svc} storage={storage} />);
    await screen.findByTestId('study-consent');

    fireEvent.click(screen.getByTestId('goto-resume'));
    fireEvent.change(screen.getByTestId('resume-input'), { target: { value: 'mls-abcd-efgh' } });
    fireEvent.click(screen.getByTestId('resume-submit'));

    // With no completed steps, the session resumes at Background_Questions.
    await screen.findByTestId('study-step-background');
    expect(loadStudySession('STUDY1', storage)?.participantId).toBe('p-restored');
  });

  it('rejects an invalid Resume_Code (21.10)', async () => {
    const { svc } = services({ resumeByCode: async () => null });
    render(<StudyModule studyCode="STUDY1" services={svc} storage={memoryStorage()} />);
    await screen.findByTestId('study-consent');

    fireEvent.click(screen.getByTestId('goto-resume'));
    fireEvent.change(screen.getByTestId('resume-input'), { target: { value: 'BAD' } });
    fireEvent.click(screen.getByTestId('resume-submit'));

    expect(await screen.findByTestId('resume-error')).toBeTruthy();
    expect(screen.queryByTestId('study-session')).toBeNull();
  });
});

describe('StudyModule withdraw (21.11, 21.12, 21.13)', () => {
  it('offers Withdraw on the Study_Session screen (21.11)', async () => {
    const storage = memoryStorage();
    saveStudySession(
      { studyCode: 'STUDY1', participantId: 'p-1', resumeCode: 'MLS-ABCD-EFGH', completedSteps: [] },
      1,
      storage,
    );
    const { svc } = services();
    render(<StudyModule studyCode="STUDY1" services={svc} storage={storage} />);
    await screen.findByTestId('study-step-background');
    expect(screen.getByTestId('withdraw')).toBeTruthy();
  });

  it('offers Withdraw on the Resume_Code entry screen (21.11)', async () => {
    const { svc } = services();
    render(<StudyModule studyCode="STUDY1" services={svc} storage={memoryStorage()} />);
    await screen.findByTestId('study-consent');
    fireEvent.click(screen.getByTestId('goto-resume'));
    expect(screen.getByTestId('resume-withdraw')).toBeTruthy();
  });

  it('confirming withdrawal calls the RPC and shows confirmation (21.12, 21.13)', async () => {
    const storage = memoryStorage();
    saveStudySession(
      { studyCode: 'STUDY1', participantId: 'p-1', resumeCode: 'MLS-ABCD-EFGH', completedSteps: [] },
      1,
      storage,
    );
    const { svc, withdrawn } = services();
    render(<StudyModule studyCode="STUDY1" services={svc} storage={storage} />);
    await screen.findByTestId('study-step-background');

    fireEvent.click(screen.getByTestId('withdraw'));
    fireEvent.click(screen.getByTestId('withdraw-confirm'));

    await screen.findByTestId('study-withdrawn');
    expect(withdrawn.calls).toEqual(['p-1']);
    // The browser pointer is cleared so it no longer links to the identity.
    await waitFor(() => expect(loadStudySession('STUDY1', storage)).toBeNull());
  });
});
