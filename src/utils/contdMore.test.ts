import { describe, expect, it } from 'vitest';
import type { ScriptElement } from '../types';
import { processContdMarkers } from './contdMore';

const element = (id: string, type: ScriptElement['type'], content: string): ScriptElement => ({
  id,
  type,
  content,
});

describe('processContdMarkers', () => {
  it('marks the same character continuing after an action interruption', () => {
    const markers = processContdMarkers([
      element('john-1', 'character', 'JOHN'),
      element('line-1', 'dialogue', 'Wait here.'),
      element('action-1', 'action', 'The lights go out.'),
      element('john-2', 'character', 'JOHN'),
    ]);

    expect(markers.get('john-1')).toBe(false);
    expect(markers.get('john-2')).toBe(true);
  });

  it('does not carry continuation across scenes or different speakers', () => {
    const markers = processContdMarkers([
      element('john-1', 'character', 'JOHN'),
      element('action-1', 'action', 'A beat.'),
      element('mary', 'character', 'MARY'),
      element('scene-2', 'scene-heading', 'EXT. STREET - DAY'),
      element('john-2', 'character', 'JOHN'),
    ]);

    expect(markers.get('mary')).toBe(false);
    expect(markers.get('john-2')).toBe(false);
  });

  it('normalizes character extensions when comparing names', () => {
    const markers = processContdMarkers([
      element('john-1', 'character', 'JOHN (V.O.)'),
      element('action-1', 'action', 'The recording crackles.'),
      element('john-2', 'character', 'JOHN'),
    ]);

    expect(markers.get('john-2')).toBe(true);
  });
});
