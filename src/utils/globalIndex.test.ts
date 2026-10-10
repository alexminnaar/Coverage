import { describe, expect, it } from 'vitest';
import type { ScriptElement } from '../types';
import { buildGlobalIndex } from './globalIndex';
import { getPageCount } from './pageBreaks';

describe('buildGlobalIndex', () => {
  it('includes the canonical script page count for AI context', () => {
    const elements: ScriptElement[] = Array.from({ length: 51 }, (_, index) => ({
      id: `element-${index}`,
      type: index === 0 ? 'scene-heading' : 'action',
      content: index === 0 ? 'INT. TEST ROOM - DAY' : 'A short action line.',
    }));

    const index = buildGlobalIndex(elements);

    expect(index).toContain(`Script pages: ${getPageCount(elements)} (title page excluded)`);
    expect(index).toContain('Scenes: 1');
    expect(index).toContain('Elements: 51');
  });
});
