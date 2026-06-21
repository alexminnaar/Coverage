import { v4 as uuidv4 } from 'uuid';
import { Beat } from '../types';

export type BeatOp =
  | {
      op: 'create';
      actIndex: number;
      insertAfterOrder?: number;
      beat: { title: string; description: string; color?: string; linkedSceneId?: string };
      reason?: string;
    }
  | {
      op: 'update';
      id: string;
      updates: Partial<Pick<Beat, 'title' | 'description' | 'color' | 'linkedSceneId'>>;
      reason?: string;
    }
  | { op: 'delete'; id: string; reason?: string }
  | { op: 'move'; id: string; targetActIndex: number; targetOrder: number; reason?: string };

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function renumberAct(all: Beat[], actIndex: number): Beat[] {
  const act = all
    .filter(b => b.actIndex === actIndex)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((b, i) => ({ ...b, order: i }));
  const other = all.filter(b => b.actIndex !== actIndex);
  return [...other, ...act];
}

export function applyBeatOps(
  beats: Beat[],
  ops: BeatOp[],
  actCount: number,
  onDeletedBeatId?: (id: string) => void
): Beat[] {
  if (!ops || ops.length === 0) return beats;

  let nextBeats = beats.slice();

  for (const raw of ops) {
    const op = raw as BeatOp;
    if (!op || typeof op !== 'object') continue;

    if (op.op === 'update' && op.id && op.updates && typeof op.updates === 'object') {
      nextBeats = nextBeats.map(b => (b.id === op.id ? { ...b, ...op.updates } : b));
      continue;
    }

    if (op.op === 'delete' && op.id) {
      nextBeats = nextBeats.filter(b => b.id !== op.id);
      onDeletedBeatId?.(op.id);
      continue;
    }

    if (op.op === 'create' && op.beat) {
      const actIndex = clamp(Number(op.actIndex ?? 0), 0, actCount - 1);
      const insertAfterOrder = op.insertAfterOrder;
      const actBeats = nextBeats
        .filter(b => b.actIndex === actIndex)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const insertAt =
        typeof insertAfterOrder === 'number'
          ? clamp(insertAfterOrder + 1, 0, actBeats.length)
          : actBeats.length;

      const newBeat: Beat = {
        id: uuidv4(),
        title: op.beat.title ?? '',
        description: op.beat.description ?? '',
        color: op.beat.color,
        linkedSceneId: op.beat.linkedSceneId,
        actIndex,
        order: insertAt,
      };

      const updatedAct = actBeats.slice();
      updatedAct.splice(insertAt, 0, newBeat);
      const renumberedAct = updatedAct.map((b, i) => ({ ...b, order: i }));
      const other = nextBeats.filter(b => b.actIndex !== actIndex);
      nextBeats = [...other, ...renumberedAct];
      continue;
    }

    if (op.op === 'move' && op.id) {
      const beat = nextBeats.find(b => b.id === op.id);
      if (!beat) continue;
      const fromAct = beat.actIndex;
      const toAct = clamp(Number(op.targetActIndex ?? 0), 0, actCount - 1);

      const without = nextBeats.filter(b => b.id !== op.id);
      const targetActBeats = without
        .filter(b => b.actIndex === toAct)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      const insertAt = clamp(Number(op.targetOrder ?? 0), 0, targetActBeats.length);
      const movedBeat: Beat = { ...beat, actIndex: toAct, order: insertAt };
      targetActBeats.splice(insertAt, 0, movedBeat);

      const renumberedTarget = targetActBeats.map((b, i) => ({ ...b, order: i }));
      const other = without.filter(b => b.actIndex !== toAct);
      nextBeats = [...other, ...renumberedTarget];

      if (fromAct !== toAct) {
        nextBeats = renumberAct(nextBeats, fromAct);
      }
    }
  }

  for (let i = 0; i < actCount; i++) {
    nextBeats = renumberAct(nextBeats, i);
  }

  return nextBeats;
}
