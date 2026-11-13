import { describe, it, expect } from 'vitest';
import {
  validateSnippets,
  validateCheckpoints,
  validateLessons,
  validateAllContent,
} from './validate';

/**
 * The Content_Validator must pass clean on all authored content. These tests
 * exercise the exact logic the `npm run validate:content` CLI runs, so a broken
 * board fails the suite as well as the build gate (Requirement 10.8, 10.9,
 * 11.11, 13.7).
 */

describe('Content_Validator', () => {
  it('reports no issues for the Skill_Check_Snippets (10.8, 10.9)', () => {
    expect(validateSnippets()).toEqual([]);
  });

  it('reports no issues for the Checkpoint_Variations (13.7)', () => {
    expect(validateCheckpoints()).toEqual([]);
  });

  it('reports no issues for the lesson Mini_Boards (11.11)', () => {
    expect(validateLessons()).toEqual([]);
  });

  it('reports no issues overall', () => {
    expect(validateAllContent()).toEqual([]);
  });
});
