// AI Client for communicating with the backend

import { ElementType } from '../types';

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

export type AIStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'decision'; action: string; why?: string }
  | { type: 'tool_call'; tool: string; [key: string]: any }
  | { type: 'tool_result'; tool: string; [key: string]: any }
  | { type: 'apply_started'; elementIds: string[]; label?: string }
  | { type: 'apply_done' }
  | { type: 'final'; edits: { edits: EditProposal[] } }
  | { type: string; [key: string]: any };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  edits?: EditProposal[]; // Only in edit mode
  events?: AIStreamEvent[]; // Typed streaming events (primarily in edit mode)
}

export interface CommandRequest {
  command: string;
  selectedText: string;
  elementType: string;
  context: Array<{ type: string; content: string }>;
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
  }
): AsyncGenerator<string> {
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

