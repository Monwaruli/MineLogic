// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import SurveyForm, { OPEN_ENDED_MAX } from './SurveyForm';
import type { SurveyAnswers } from './studyLogger';

afterEach(cleanup);

const RATING_ITEMS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
const OPEN_PROMPTS = ['o1', 'o2', 'o3'];
const DEMO = 'about you';

function renderForm(onSubmit: (a: SurveyAnswers) => void) {
  return render(
    <SurveyForm
      ratingItems={RATING_ITEMS}
      openPrompts={OPEN_PROMPTS}
      demographicsItem={DEMO}
      onSubmit={onSubmit}
    />,
  );
}

describe('SurveyForm structure (Requirement 24.1)', () => {
  it('renders seven rating items, three open-ended prompts, and one demographics item, in order', () => {
    renderForm(() => {});
    const ratings = screen.getAllByTestId(/^survey-rating-\d+$/);
    expect(ratings).toHaveLength(7);
    const opens = screen.getAllByTestId(/^survey-open-\d+$/);
    expect(opens).toHaveLength(3);
    expect(screen.getByTestId('survey-demographics')).toBeTruthy();

    // Order: ratings section precedes open section precedes demographics.
    const form = screen.getByTestId('survey-form');
    const html = form.innerHTML;
    expect(html.indexOf('survey-ratings')).toBeLessThan(html.indexOf('survey-open'));
    expect(html.indexOf('survey-open')).toBeLessThan(html.indexOf('survey-demographics'));
  });

  it('labels each rating item 1 (strongly disagree) to 5 (strongly agree) (24.3)', () => {
    renderForm(() => {});
    const first = screen.getByTestId('survey-rating-0');
    for (let v = 1; v <= 5; v++) {
      expect(within(first).getByTestId(`survey-rating-0-point-${v}`)).toBeTruthy();
    }
    expect(within(first).getByLabelText('1 — Strongly disagree')).toBeTruthy();
    expect(within(first).getByLabelText('5 — Strongly agree')).toBeTruthy();
  });
});

describe('SurveyForm submission (Requirement 24.4, 24.6)', () => {
  it('submits with every item unanswered; unanswered items are blank', () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);
    fireEvent.click(screen.getByTestId('survey-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const answers = onSubmit.mock.calls[0]![0] as SurveyAnswers;
    expect(answers.ratings).toEqual([null, null, null, null, null, null, null]);
    expect(answers.openEnded).toEqual(['', '', '']);
    expect(answers.demographics).toBe('');
  });

  it('captures answered ratings and leaves others null (24.6)', () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);
    fireEvent.click(screen.getByTestId('survey-rating-0-point-5'));
    fireEvent.click(screen.getByTestId('survey-rating-2-point-3'));
    fireEvent.change(screen.getByTestId('survey-open-0-input'), { target: { value: 'hello' } });
    fireEvent.change(screen.getByTestId('survey-demographics-input'), { target: { value: '30s' } });
    fireEvent.click(screen.getByTestId('survey-submit'));
    const answers = onSubmit.mock.calls[0]![0] as SurveyAnswers;
    expect(answers.ratings).toEqual([5, null, 3, null, null, null, null]);
    expect(answers.openEnded[0]).toBe('hello');
    expect(answers.demographics).toBe('30s');
  });
});

describe('SurveyForm open-ended cap and remaining count (Requirement 24.5)', () => {
  it('shows remaining characters out of 2000 and updates on input', () => {
    renderForm(() => {});
    expect(screen.getByTestId('survey-open-0-remaining').textContent).toContain(
      `${OPEN_ENDED_MAX} characters remaining`,
    );
    fireEvent.change(screen.getByTestId('survey-open-0-input'), { target: { value: 'abcde' } });
    expect(screen.getByTestId('survey-open-0-remaining').textContent).toContain(
      `${OPEN_ENDED_MAX - 5} characters remaining`,
    );
  });

  it('caps an open-ended answer at 2000 characters', () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);
    const long = 'x'.repeat(OPEN_ENDED_MAX + 50);
    fireEvent.change(screen.getByTestId('survey-open-1-input'), { target: { value: long } });
    fireEvent.click(screen.getByTestId('survey-submit'));
    const answers = onSubmit.mock.calls[0]![0] as SurveyAnswers;
    expect(answers.openEnded[1]!.length).toBe(OPEN_ENDED_MAX);
    expect(screen.getByTestId('survey-open-1-remaining').textContent).toContain('0 characters remaining');
  });
});
