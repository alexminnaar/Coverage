import { v4 as uuidv4 } from 'uuid';
import type {
  SceneStoryboard,
  StoryboardAspectRatio,
  StoryboardShot,
} from '../types';

export type StoryboardShotDraft = Omit<StoryboardShot, 'id' | 'order' | 'image'>;

export type StoryboardOp =
  | {
      op: 'replace';
      sceneId: string;
      shots: StoryboardShotDraft[];
      style?: string;
      aspectRatio?: StoryboardAspectRatio;
      reason?: string;
    }
  | {
      op: 'create';
      sceneId: string;
      insertAfterOrder?: number;
      shot: StoryboardShotDraft;
      reason?: string;
    }
  | {
      op: 'update';
      sceneId: string;
      id: string;
      updates: Partial<StoryboardShotDraft>;
      reason?: string;
    }
  | { op: 'delete'; sceneId: string; id: string; reason?: string }
  | { op: 'move'; sceneId: string; id: string; targetOrder: number; reason?: string };

const DEFAULT_STYLE = 'Cinematic storyboard sketch';
const DEFAULT_ASPECT_RATIO: StoryboardAspectRatio = '16:9';

const normalizeShots = (shots: StoryboardShot[]): StoryboardShot[] =>
  shots.map((shot, order) => ({ ...shot, order }));

const makeShot = (draft: StoryboardShotDraft, order: number): StoryboardShot => ({
  ...draft,
  id: uuidv4(),
  order,
  characters: Array.isArray(draft.characters) ? draft.characters : [],
});

function createStoryboard(
  sceneId: string,
  style = DEFAULT_STYLE,
  aspectRatio: StoryboardAspectRatio = DEFAULT_ASPECT_RATIO,
): SceneStoryboard {
  const now = Date.now();
  return {
    sceneId,
    style,
    aspectRatio,
    shots: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function applyStoryboardOps(
  storyboards: Record<string, SceneStoryboard>,
  ops: StoryboardOp[],
): Record<string, SceneStoryboard> {
  if (!ops.length) return storyboards;

  const next = { ...storyboards };

  for (const operation of ops) {
    if (!operation?.sceneId) continue;
    const current = next[operation.sceneId] || createStoryboard(operation.sceneId);
    let shots = current.shots.slice().sort((a, b) => a.order - b.order);
    let style = current.style;
    let aspectRatio = current.aspectRatio;

    if (operation.op === 'replace') {
      shots = operation.shots.map(makeShot);
      style = operation.style || style;
      aspectRatio = operation.aspectRatio || aspectRatio;
    } else if (operation.op === 'create') {
      const insertAt = operation.insertAfterOrder === undefined
        ? shots.length
        : Math.max(0, Math.min(operation.insertAfterOrder + 1, shots.length));
      shots.splice(insertAt, 0, makeShot(operation.shot, insertAt));
    } else if (operation.op === 'update') {
      shots = shots.map(shot =>
        shot.id === operation.id
          ? {
              ...shot,
              ...operation.updates,
              characters: operation.updates.characters ?? shot.characters,
            }
          : shot
      );
    } else if (operation.op === 'delete') {
      shots = shots.filter(shot => shot.id !== operation.id);
    } else if (operation.op === 'move') {
      const sourceIndex = shots.findIndex(shot => shot.id === operation.id);
      if (sourceIndex >= 0) {
        const [shot] = shots.splice(sourceIndex, 1);
        const target = Math.max(0, Math.min(operation.targetOrder, shots.length));
        shots.splice(target, 0, shot);
      }
    }

    next[operation.sceneId] = {
      ...current,
      style,
      aspectRatio,
      shots: normalizeShots(shots),
      updatedAt: Date.now(),
    };
  }

  return next;
}
