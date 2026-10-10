import { describe, expect, it } from 'vitest';
import type { PendingEdit, ScriptElement } from '../types';
import { reconcilePendingEdits } from './reconcilePendingEdits';

const elements: ScriptElement[] = [
  { id: 'first', type: 'action', content: 'The phone rings.' },
  { id: 'second', type: 'action', content: 'He reaches for it.' },
];

const edit = (overrides: Partial<PendingEdit> = {}): PendingEdit => ({
  elementId: 'first',
  originalContent: 'The phone rings.',
  newContent: 'The phone SHRIEKS.',
  ...overrides,
});

describe('reconcilePendingEdits', () => {
  it('keeps a correctly anchored edit unchanged', () => {
    const proposal = edit();
    expect(reconcilePendingEdits([proposal], elements)[0]).toBe(proposal);
  });

  it('remaps a wrong ID when the original text has one exact match', () => {
    const proposal = edit({
      elementId: 'first',
      originalContent: 'He reaches for it.',
      newContent: 'He snatches it.',
    });

    expect(reconcilePendingEdits([proposal], elements)[0].elementId).toBe('second');
  });

  it('normalizes harmless line-ending differences against current content', () => {
    const proposal = edit({ originalContent: 'The phone rings.\r\n' });
    const reconciled = reconcilePendingEdits([proposal], elements)[0];

    expect(reconciled.elementId).toBe('first');
    expect(reconciled.originalContent).toBe('The phone rings.');
  });

  it('leaves ambiguous text unresolved so the stale-edit guard remains active', () => {
    const duplicates: ScriptElement[] = [
      ...elements,
      { id: 'third', type: 'action', content: 'He reaches for it.' },
    ];
    const proposal = edit({ originalContent: 'He reaches for it.' });

    expect(reconcilePendingEdits([proposal], duplicates)[0]).toBe(proposal);
  });
});
