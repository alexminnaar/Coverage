import { describe, expect, it } from 'vitest';
import type { Screenplay } from '../types';
import { estimatePageCount } from './pageEstimate';
import { getPageCount } from './pageBreaks';

const screenplay = (elements: Screenplay['elements']): Screenplay => ({
  id: 'script',
  title: 'Test',
  author: '',
  createdAt: 1,
  updatedAt: 1,
  elements,
});

describe('estimatePageCount', () => {
  it('returns at least one page for an empty screenplay', () => {
    expect(estimatePageCount(screenplay([]))).toBe(1);
  });

  it('uses the same screenplay-aware pagination as print preview', () => {
    const elements = Array.from({ length: 51 }, (_, index) => ({
      id: `element-${index}`,
      type: 'action' as const,
      content: 'A short action line.',
    }));

    expect(estimatePageCount(screenplay(elements))).toBe(3);
    expect(estimatePageCount(screenplay(elements))).toBe(getPageCount(elements));
  });
});
