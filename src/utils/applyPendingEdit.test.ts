import { describe, expect, it } from 'vitest';
import type { PendingEdit, Screenplay } from '../types';
import { applyPendingEdit } from './applyPendingEdit';

const screenplay = (): Screenplay => ({
  id: 'script',
  title: 'Test',
  author: '',
  createdAt: 1,
  updatedAt: 1,
  elements: [{ id: 'action-1', type: 'action', content: 'Before.' }],
});

describe('applyPendingEdit', () => {
  it('applies a matching edit', () => {
    const edit: PendingEdit = {
      elementId: 'action-1',
      originalContent: 'Before.',
      newContent: 'After.',
    };

    expect(applyPendingEdit(screenplay(), edit.elementId, edit).elements[0].content).toBe('After.');
  });

  it('refuses a stale edit whose original content no longer matches', () => {
    const edit: PendingEdit = {
      elementId: 'action-1',
      originalContent: 'Different original.',
      newContent: 'After.',
    };

    const original = screenplay();
    expect(applyPendingEdit(original, edit.elementId, edit)).toBe(original);
  });

  it('inserts structured elements after the edited element', () => {
    const edit: PendingEdit = {
      elementId: 'action-1',
      originalContent: 'Before.',
      newContent: 'Before.',
      newElements: [{ type: 'character', content: 'RILEY' }],
    };

    const result = applyPendingEdit(screenplay(), edit.elementId, edit, () => 'new-id');

    expect(result.elements).toEqual([
      { id: 'action-1', type: 'action', content: 'Before.' },
      { id: 'new-id', type: 'character', content: 'RILEY' },
    ]);
  });
});
