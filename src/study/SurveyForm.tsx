/**
 * Survey_Form (task 9.3, Requirement 24.1, 24.3, 24.4, 24.5, 24.6).
 *
 * Shown when the Post_Test ends. It presents, IN ORDER (24.1):
 *   1. seven 5-point rating items,
 *   2. three open-ended prompts,
 *   3. one demographics item.
 *
 * Item text is read from the Study_Config (24.2) — the parent passes the config
 * arrays (StudyConfig.surveyRatingItems / surveyOpenPrompts /
 * surveyDemographicsItem; the service fills defaults when a config omits them).
 *
 * Each rating item is labeled 1 (strongly disagree) … 5 (strongly agree)
 * (24.3). The Participant may submit with ANY item unanswered (24.4); on submit,
 * unanswered ratings are reported as null and unanswered text as '' so the
 * Study_Logger stores them as blank (24.6). Open-ended answers accept up to
 * 2,000 characters and show a live remaining-characters count (24.5).
 *
 * This component is pure UI: it collects answers and calls onSubmit with the
 * structured SurveyAnswers. The actual Study_Record write (24.6) is done by the
 * parent (StudySession) via the Study_Logger, keeping logging in one place.
 */

import { useCallback, useMemo, useState } from 'react';
import type { SurveyAnswers } from './studyLogger';

/** The maximum length of an open-ended answer (24.5). */
export const OPEN_ENDED_MAX = 2000;

export interface SurveyFormProps {
  /** Seven rating item statements, in order (24.1, 24.2). */
  ratingItems: string[];
  /** Three open-ended prompts, in order (24.1, 24.2). */
  openPrompts: string[];
  /** One demographics item (24.1, 24.2). */
  demographicsItem: string;
  /** Called with the structured answers when the Participant submits (24.6). */
  onSubmit: (answers: SurveyAnswers) => void;
}

/** The five rating points, labeled 1 (strongly disagree) … 5 (strongly agree) (24.3). */
const RATING_POINTS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' },
];

export default function SurveyForm({
  ratingItems,
  openPrompts,
  demographicsItem,
  onSubmit,
}: SurveyFormProps) {
  // Ratings start unanswered (null) so submitting with blanks is allowed (24.4).
  const [ratings, setRatings] = useState<Array<number | null>>(() =>
    ratingItems.map(() => null),
  );
  const [openEnded, setOpenEnded] = useState<string[]>(() => openPrompts.map(() => ''));
  const [demographics, setDemographics] = useState('');

  const setRating = useCallback((index: number, value: number) => {
    setRatings((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const setOpen = useCallback((index: number, raw: string) => {
    // Enforce the 2,000-character cap (24.5).
    const value = raw.length > OPEN_ENDED_MAX ? raw.slice(0, OPEN_ENDED_MAX) : raw;
    setOpenEnded((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    // 24.6 — report every answer, unanswered items as blank (null rating / '').
    onSubmit({
      ratings,
      openEnded,
      demographics: demographics.length > OPEN_ENDED_MAX
        ? demographics.slice(0, OPEN_ENDED_MAX)
        : demographics,
    });
  }, [ratings, openEnded, demographics, onSubmit]);

  const remaining = useMemo(
    () => openEnded.map((v) => OPEN_ENDED_MAX - v.length),
    [openEnded],
  );

  return (
    <div className="flex flex-col gap-6" data-testid="survey-form">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">One last survey</h1>
        <p className="text-slate-300 text-sm">
          Your feedback helps improve MineLogic. Every question is optional — you
          can submit with any item left blank.
        </p>
      </header>

      {/* Seven 5-point rating items (24.1, 24.3). */}
      <section className="flex flex-col gap-4" data-testid="survey-ratings">
        <h2 className="text-sm font-semibold text-slate-200">Rate your experience</h2>
        {ratingItems.map((item, i) => (
          <fieldset key={`rating-${i}`} className="flex flex-col gap-2" data-testid={`survey-rating-${i}`}>
            <legend className="text-sm text-slate-200">{item}</legend>
            <div
              className="flex gap-2 flex-wrap"
              role="radiogroup"
              aria-label={item}
            >
              {RATING_POINTS.map((point) => {
                const checked = ratings[i] === point.value;
                return (
                  <label
                    key={point.value}
                    className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-sm border ${
                      checked
                        ? 'bg-sky-600 border-sky-400 text-white'
                        : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name={`rating-${i}`}
                      checked={checked}
                      onChange={() => setRating(i, point.value)}
                      data-testid={`survey-rating-${i}-point-${point.value}`}
                      aria-label={`${point.value} — ${point.label}`}
                    />
                    <span aria-hidden="true">{point.value}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>1 = strongly disagree</span>
              <span>5 = strongly agree</span>
            </div>
          </fieldset>
        ))}
      </section>

      {/* Three open-ended prompts (24.1, 24.5). */}
      <section className="flex flex-col gap-4" data-testid="survey-open">
        <h2 className="text-sm font-semibold text-slate-200">In your own words</h2>
        {openPrompts.map((prompt, i) => (
          <label key={`open-${i}`} className="flex flex-col gap-1" data-testid={`survey-open-${i}`}>
            <span className="text-sm text-slate-200">{prompt}</span>
            <textarea
              className="rounded bg-slate-900 border border-slate-600 p-2 text-sm text-slate-100"
              rows={3}
              maxLength={OPEN_ENDED_MAX}
              value={openEnded[i] ?? ''}
              onChange={(e) => setOpen(i, e.target.value)}
              data-testid={`survey-open-${i}-input`}
            />
            <span
              className="text-xs text-slate-400 self-end"
              data-testid={`survey-open-${i}-remaining`}
            >
              {remaining[i]} characters remaining
            </span>
          </label>
        ))}
      </section>

      {/* One demographics item (24.1). */}
      <section className="flex flex-col gap-2" data-testid="survey-demographics">
        <h2 className="text-sm font-semibold text-slate-200">About you</h2>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-200">{demographicsItem}</span>
          <textarea
            className="rounded bg-slate-900 border border-slate-600 p-2 text-sm text-slate-100"
            rows={2}
            maxLength={OPEN_ENDED_MAX}
            value={demographics}
            onChange={(e) =>
              setDemographics(
                e.target.value.length > OPEN_ENDED_MAX
                  ? e.target.value.slice(0, OPEN_ENDED_MAX)
                  : e.target.value,
              )
            }
            data-testid="survey-demographics-input"
          />
        </label>
      </section>

      <button
        className="self-start px-4 py-2 rounded bg-sky-600 text-white"
        onClick={handleSubmit}
        data-testid="survey-submit"
      >
        Submit and finish
      </button>
    </div>
  );
}
