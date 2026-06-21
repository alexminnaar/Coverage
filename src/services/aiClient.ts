// AI Client for communicating with the backend

import { ElementType } from '../types';
import type { BeatOp } from '../utils/applyBeatOps';

const API_BASE = 'http://localhost:3002/api';

export interface CompletionContext {
  elementType: string;
  currentContent: string;
  precedingElements: Array<{ type: string; content: string }>;
  characterNames: string[];
  cursorPosition?: number;
}

export interface EditProposal {
  elementId: string;
  elementType: string;
  originalContent: string;
  newContent: string;
  reason?: string;
  newElements?: Array<{ type: ElementType; content: string }>;
}

export type { BeatOp };

export type TodoStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'blocked'
  | 'cancelled';

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  rationale?: string;
  related_files?: string[];
}

export interface PlanState {
  summary: string;
  todos: TodoItem[];
  known_facts?: string[];
  risks?: string[];
}

export type AIStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'decision'; action: string; why?: string }
  | { type: 'tool_call'; tool: string; [key: string]: any }
  | { type: 'tool_result'; tool: string; [key: string]: any }
  | { type: 'plan_updated'; plan: PlanState }
  | { type: 'plan_todos'; todos: Array<{ id: string; label: string; status: string }> }
  | { type: 'todo_update'; id: string; status: string; label?: string }
  | { type: 'apply_started'; elementIds: string[]; label?: string }
  | { type: 'apply_done' }
  | { type: 'final'; edits: { edits: EditProposal[] } }
  | { type: 'final'; beatOps: { ops: BeatOp[] } }
  | { type: string; [key: string]: any };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  edits?: EditProposal[]; // Only in edit mode
  beatOps?: BeatOp[];
  events?: AIStreamEvent[]; // Typed streaming events (primarily in edit mode)
}

export interface CommandRequest {
  command: string;
  selectedText: string;
  elementType: string;
  context: Array<{ type: string; content: string }>;
}

function getSSEData(frame: string): string | null {
  const dataLines = frame
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;
  return dataLines.join('\n');
}

// Check if AI server is available and configured
export async function checkAIHealth(): Promise<{ available: boolean; configured: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return { available: false, configured: false };
    const data = await response.json();
    return { available: true, configured: data.configured };
  } catch {
    return { available: false, configured: false };
  }
}

// Stream inline completion
export async function* streamCompletion(
  context: CompletionContext,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch(`${API_BASE}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get completion');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) yield parsed.content;
          if (parsed.error) throw new Error(parsed.error);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
}

// Stream chat response
export async function* streamChat(
  messages: ChatMessage[],
  sceneContext?: string,
  mode?: 'ask' | 'edit',
  projectId?: string,
  signal?: AbortSignal,
  requestMeta?: {
    selectedElementId?: string | null;
    selectedText?: string | null;
    contextPolicy?: 'scene_plus_adjacent' | 'full';
    contextElementIds?: string[];
    globalIndex?: string;
    model?: string;
  }
): AsyncGenerator<AIStreamEvent | string> {
  // Typed streaming events are now the default for both ask + edit (Cursor-like).
  const streamEvents = true;
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Opt-in to typed status/final events in edit mode so the UI can display progress updates.
    body: JSON.stringify({
      messages,
      sceneContext,
      mode: mode || 'ask',
      projectId,
      streamEvents,
      model: requestMeta?.model ?? undefined,
      selectedElementId: requestMeta?.selectedElementId ?? undefined,
      selectedText: requestMeta?.selectedText ?? undefined,
      contextPolicy: requestMeta?.contextPolicy ?? undefined,
      contextElementIds: requestMeta?.contextElementIds ?? undefined,
      globalIndex: requestMeta?.globalIndex ?? undefined,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get chat response');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const data = getSSEData(frame);
      if (!data) continue;
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(parsed.error);

        // Backward compatibility with the old chat envelope:
        //   data: {"content":"{\"type\":\"text_delta\",...}"}
        if (typeof parsed.content === 'string') {
          try {
            yield JSON.parse(parsed.content) as AIStreamEvent;
          } catch {
            yield parsed.content;
          }
          continue;
        }

        yield parsed as AIStreamEvent;
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

// Stream beat chat response (Beat AI)
export async function* streamBeatChat(
  messages: ChatMessage[],
  beats: Array<{ id: string; title: string; description: string; actIndex: number; order: number; color?: string; linkedSceneId?: string }>,
  actNames: string[],
  selectedBeatId?: string | null,
  scenes?: Array<{ id: string; name: string }>,
  projectId?: string,
  signal?: AbortSignal,
  requestMeta?: {
    model?: string;
  }
): AsyncGenerator<string> {
  const response = await fetch(`${API_BASE}/beat-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      beats,
      actNames,
      selectedBeatId: selectedBeatId ?? undefined,
      scenes: scenes ?? undefined,
      projectId,
      model: requestMeta?.model ?? undefined,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get beat chat response');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) yield parsed.content;
          if (parsed.error) throw new Error(parsed.error);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
}

// Execute command
export async function executeCommand(request: CommandRequest): Promise<string> {
  const response = await fetch(`${API_BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to execute command');
  }

  const data = await response.json();
  return data.result;
}
