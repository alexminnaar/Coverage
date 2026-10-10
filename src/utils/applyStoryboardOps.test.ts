import { describe, expect, it } from 'vitest';
import type { SceneStoryboard } from '../types';
import { applyStoryboardOps } from './applyStoryboardOps';

const existing: Record<string, SceneStoryboard> = {
  scene: {
    sceneId: 'scene',
    style: 'Pencil',
    aspectRatio: '16:9',
    createdAt: 1,
    updatedAt: 1,
    shots: [
      {
        id: 'wide',
        order: 0,
        title: 'Wide',
        shotType: 'Wide shot',
        action: 'Two characters enter.',
        characters: ['MARA', 'JON'],
      },
      {
        id: 'close',
        order: 1,
        title: 'Close-up',
        shotType: 'Close-up',
        action: 'Mara reacts.',
        characters: ['MARA'],
        image: { status: 'complete', url: 'https://example.com/frame.png' },
      },
    ],
  },
};

describe('applyStoryboardOps', () => {
  it('replaces a scene shot list and assigns stable client IDs', () => {
    const result = applyStoryboardOps(existing, [{
      op: 'replace',
      sceneId: 'scene',
      style: 'Ink',
      aspectRatio: '4:3',
      shots: [{
        title: 'Establishing',
        shotType: 'Extreme wide',
        action: 'The house sits alone in the rain.',
        characters: [],
      }],
    }]);

    expect(result.scene).toMatchObject({
      style: 'Ink',
      aspectRatio: '4:3',
      shots: [{ title: 'Establishing', order: 0 }],
    });
    expect(result.scene.shots[0].id).toBeTruthy();
  });

  it('updates shot direction without discarding a generated image', () => {
    const result = applyStoryboardOps(existing, [{
      op: 'update',
      sceneId: 'scene',
      id: 'close',
      updates: { action: 'Mara suppresses a smile.' },
    }]);

    expect(result.scene.shots[1]).toMatchObject({
      action: 'Mara suppresses a smile.',
      image: { status: 'complete', url: 'https://example.com/frame.png' },
    });
  });

  it('moves and renumbers shots', () => {
    const result = applyStoryboardOps(existing, [{
      op: 'move',
      sceneId: 'scene',
      id: 'close',
      targetOrder: 0,
    }]);

    expect(result.scene.shots).toMatchObject([
      { id: 'close', order: 0 },
      { id: 'wide', order: 1 },
    ]);
  });
});
