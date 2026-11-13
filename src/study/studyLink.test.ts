import { describe, it, expect } from 'vitest';
import { detectStudyCode, STUDY_PARAM } from './studyLink';

describe('Study_Link detection (Requirement 21.1 / 28.3)', () => {
  it('extracts the code from a ?study= query string', () => {
    expect(detectStudyCode('?study=SPRING2025')).toBe('SPRING2025');
  });

  it('works without the leading question mark', () => {
    expect(detectStudyCode('study=ABC')).toBe('ABC');
  });

  it('picks the study param out of a multi-param query', () => {
    expect(detectStudyCode('?foo=1&study=XYZ&bar=2')).toBe('XYZ');
  });

  it('trims surrounding whitespace', () => {
    expect(detectStudyCode('?study=%20CODE%20')).toBe('CODE');
  });

  it('returns null when there is no study param', () => {
    expect(detectStudyCode('?other=1')).toBeNull();
    expect(detectStudyCode('')).toBeNull();
  });

  it('returns null for an empty study value', () => {
    expect(detectStudyCode('?study=')).toBeNull();
    expect(detectStudyCode('?study=%20%20')).toBeNull();
  });

  it('exposes the param name used by Study_Links', () => {
    expect(STUDY_PARAM).toBe('study');
  });
});
