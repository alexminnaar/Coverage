import { describe, expect, it, vi } from 'vitest';
import type { Beat } from '../types';
import { applyBeatOps } from './applyBeatOps';

const beats: Beat[] = [
  { id: 'setup', title: 'Setup', description: '', actIndex: 0, order: 0 },
  { id: 'turn', title: 'First turn', description: '', actIndex: 0, order: 1 },
  { id: 'midpoint', title: 'Midpoint', description: '', actIndex: 1, order: 0 },
];

describe('applyBeatOps', () => {
  it('moves beats between acts and renumbers both acts', () => {
    const result = applyBeatOps(
      beats,
      [{ op: 'move', id: 'turn', targetActIndex: 1, targetOrder: 0 }],
      3,
    );

    expect(result.filter(beat => beat.actIndex === 0)).toMatchObject([
      { id: 'setup', order: 0 },
    ]);
    expect(result.filter(beat => beat.actIndex === 1)).toMatchObject([
      { id: 'turn', order: 0 },
      { id: 'midpoint', order: 1 },
    ]);
  });

  it('clamps newly created beats to a valid act', () => {
    const result = applyBeatOps(
      beats,
      [{
        op: 'create',
        actIndex: 99,
        beat: { title: 'Climax', description: 'The final confrontation.' },
      }],
      3,
    );

    expect(result).toContainEqual(expect.objectContaining({
      title: 'Climax',
      actIndex: 2,
      order: 0,
    }));
  });

  it('creates Act 1 beats using zero-based act index 0', () => {
    const result = applyBeatOps(
      beats,
      [{
        op: 'create',
        actIndex: 0,
        insertAfterOrder: 0,
        beat: { title: 'Catalyst', description: 'The story begins to turn.' },
      }],
      3,
    );

    expect(result.filter(beat => beat.actIndex === 0)).toMatchObject([
      { id: 'setup', order: 0 },
      { title: 'Catalyst', order: 1 },
      { id: 'turn', order: 2 },
    ]);
  });

  it('reports deleted beat IDs', () => {
    const onDeleted = vi.fn();
    const result = applyBeatOps(beats, [{ op: 'delete', id: 'turn' }], 3, onDeleted);

    expect(result.some(beat => beat.id === 'turn')).toBe(false);
    expect(onDeleted).toHaveBeenCalledWith('turn');
  });

  it('leaves beats unchanged for a treatment-only operation', () => {
    const result = applyBeatOps(
      beats,
      [{ op: 'set_treatment', treatment: 'A complete prose treatment.' }],
      3,
    );

    expect(result).toEqual(beats);
  });
});
