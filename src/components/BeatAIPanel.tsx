import { useEffect, useMemo, useRef, useState } from 'react';
import { Marked } from 'marked';
import {
  Sparkles,
  X,
  Send,
  Trash2,
  Square,
  User,
  Bot,
} from 'lucide-react';
import { Beat, ScriptElement } from '../types';
import { useAIChat } from '../hooks/useAIChat';

const marked = new Marked();

interface SceneSummary {
  id: string;
  name: string;
}

interface BeatAIPanelProps {
  isOpen: boolean;
  onClose: () => void;
  beats: Beat[];
  elements?: ScriptElement[];
  projectId?: string;
  groundToScreenplay?: boolean;
  actNames: string[];
  scenes: SceneSummary[];
  selectedBeatId?: string | null;
  onUpdateBeat: (id: string, updates: Partial<Beat>) => void;
  onAddBeat?: (actIndex: number, insertAfterOrder?: number, seed?: Partial<Beat>) => void;
  onDeleteBeat?: (id: string) => void;
  onMoveBeat?: (beatId: string, targetActIndex: number, targetOrder: number) => void;
  onApplyOps?: (ops: BeatOp[]) => void;
}

type BeatOp =
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

type BeatAIPlan = { ops: BeatOp[]; notes?: string };

// Legacy single-suggestion shape (kept for backward compatibility)
type BeatSuggestion = {
  title?: string;
  description?: string;
  targetAct?: number;
  insertAfterOrder?: number;
  reason?: string;
  linkedSceneId?: string;
};

function safeJsonParse(content: string): any | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function extractJson(content: string): string | null {
  const fenced = content.match(/```json\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1];
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return content.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function parseBeatSuggestion(content: string): BeatSuggestion | null {
  const jsonStr = extractJson(content);
  if (!jsonStr) return null;
  const parsed = safeJsonParse(jsonStr);
  if (!parsed) return null;

  // Handle simple object or { suggestion: { ... } }
  const suggestion = parsed.suggestion ?? parsed;
  if (typeof suggestion !== 'object') return null;

  return {
    title: suggestion.title,
    description: suggestion.description,
    targetAct: typeof suggestion.targetAct === 'number' ? suggestion.targetAct : undefined,
    insertAfterOrder:
      typeof suggestion.insertAfterOrder === 'number' ? suggestion.insertAfterOrder : undefined,
    reason: suggestion.reason,
    linkedSceneId: suggestion.linkedSceneId,
  };
}

function parseBeatPlan(content: string): BeatAIPlan | null {
  const jsonStr = extractJson(content);
  if (!jsonStr) return null;
  const parsed = safeJsonParse(jsonStr);
  if (!parsed || typeof parsed !== 'object') return null;

  const plan = (parsed as any).plan ?? parsed;
  if (!plan || typeof plan !== 'object') return null;
  if (!Array.isArray((plan as any).ops)) return null;

  return { ops: (plan as any).ops as BeatOp[], notes: (plan as any).notes };
}

function truncate(text: string, max = 180) {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

// Strip JSON blocks from content for display
function stripJSONFromContent(content: string): string {
  if (!content) return '';
  // Remove JSON code blocks
  let cleaned = content.replace(/```json\s*[\s\S]*?```/g, '');
  // Remove standalone JSON objects that look like beat suggestions
  cleaned = cleaned.replace(/\{\s*"title"\s*:[\s\S]*?\}/g, '');
  cleaned = cleaned.replace(/\{\s*"suggestion"\s*:[\s\S]*?\}/g, '');
  cleaned = cleaned.replace(/\{\s*"ops"\s*:[\s\S]*?\}\s*$/g, '');
  cleaned = cleaned.replace(/\{\s*"plan"\s*:[\s\S]*?\}\s*$/g, '');
  return cleaned.trim();
}

// Check if content looks like it contains JSON (for beat suggestions)
function containsJSON(content: string): boolean {
  if (!content) return false;
  // Check for JSON code blocks
  if (/```json/i.test(content)) return true;
  // Check for JSON object structure with beat fields
  if (/\{\s*"title"/i.test(content)) return true;
  if (/\{\s*"suggestion"/i.test(content)) return true;
  if (/\{\s*"ops"/i.test(content)) return true;
  if (/\{\s*"plan"/i.test(content)) return true;
  return false;
}

export default function BeatAIPanel({
  isOpen,
  onClose,
  beats,
  elements,
  projectId,
  groundToScreenplay = false,
  actNames,
  scenes,
  selectedBeatId,
  onUpdateBeat,
  onAddBeat,
  onDeleteBeat,
  onMoveBeat,
  onApplyOps,
}: BeatAIPanelProps) {
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<BeatAIPlan | null>(null);
  const [includeSceneHeadings, setIncludeSceneHeadings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const mappedElements = useMemo(
    () => elements?.map(el => ({ id: el.id, type: el.type, content: el.content })),
    [elements]
  );

  // IMPORTANT: Beat AI should default to *not* grounding against the screenplay DB/vector store.
  // It should rely on the Beat Board context we build below (plus scene headings) unless explicitly enabled.
  const { messages, isStreaming, error, sendMessage, clearMessages, stopStreaming } = useAIChat(
    groundToScreenplay ? mappedElements : undefined,
    groundToScreenplay ? projectId : undefined
  );

  const selectedBeat = useMemo(
    () => beats.find((b) => b.id === selectedBeatId) || null,
    [beats, selectedBeatId]
  );

  const orderedByAct = useMemo(() => {
    return actNames.map((_, actIndex) =>
      beats
        .filter((b) => b.actIndex === actIndex)
        .sort((a, b) => a.order - b.order)
    );
  }, [beats, actNames]);

  const buildContext = () => {
    const lines: string[] = [];

    lines.push('Beat Board Context:');
    actNames.forEach((actName, actIndex) => {
      lines.push(`ACT ${actIndex + 1}: ${actName}`);
      const actBeats = orderedByAct[actIndex].slice(0, 25); // keep concise but useful
      actBeats.forEach((beat, idx) => {
        const marker = beat.id === selectedBeatId ? '*FOCUS* ' : '';
        lines.push(
          `${marker}#${idx + 1} [id=${beat.id}] ${beat.title || 'Untitled'} — ${truncate(
            beat.description || '',
            140
          )}`
        );
      });
      if (orderedByAct[actIndex].length > actBeats.length) {
        lines.push('… (more beats not shown)');
      }
      lines.push('');
    });

    if (selectedBeat) {
      const sceneName = scenes.find((s) => s.id === selectedBeat.linkedSceneId)?.name;
      lines.push('Selected Beat Details:');
      lines.push(`id: ${selectedBeat.id}`);
      lines.push(`actIndex: ${selectedBeat.actIndex}`);
      lines.push(`order: ${selectedBeat.order}`);
      lines.push(`title: ${selectedBeat.title || 'Untitled beat'}`);
      lines.push(`description: ${selectedBeat.description || '(empty)'}`);
      if (selectedBeat.color) {
        lines.push(`color: ${selectedBeat.color}`);
      }
      if (sceneName) {
        lines.push(`linkedScene: ${sceneName}`);
      }
      lines.push('');
    }

    // By default, Beat AI should not be "reading the screenplay".
    // If enabled, we include scene headings only to allow linking beats to scenes by id.
    if (includeSceneHeadings && scenes.length > 0) {
      lines.push('Scene Headings (optional; for linking only):');
      const limitedScenes = scenes.slice(0, 15);
      lines.push(limitedScenes.map((s) => `[id=${s.id}] ${s.name}`).join(' | '));
      if (scenes.length > limitedScenes.length) {
        lines.push('… (more scenes not shown)');
      }
      lines.push('');
    }

    lines.push('Return ONLY one JSON object. Prefer this schema:');
    lines.push(
      JSON.stringify(
        {
          ops: [
            {
              op: 'update',
              id: 'existing-beat-id',
              updates: { title: '...', description: '...', linkedSceneId: 'optional', color: '#hex-optional' },
              reason: 'optional',
            },
            {
              op: 'create',
              actIndex: 1,
              insertAfterOrder: 2,
              beat: { title: '...', description: '...', linkedSceneId: 'optional', color: '#hex-optional' },
              reason: 'optional',
            },
            { op: 'move', id: 'existing-beat-id', targetActIndex: 1, targetOrder: 0, reason: 'optional' },
            { op: 'delete', id: 'existing-beat-id', reason: 'optional' },
          ],
          notes: 'optional short plain text',
        },
        null,
        2
      )
    );
    lines.push('');
    lines.push('Rules:');
    lines.push('- Output MUST be valid JSON only (no prose).');
    lines.push('- Use existing beat ids when updating/moving/deleting.');
    lines.push('- Keep descriptions 1-2 sentences.');
    lines.push('- Do not invent scene ids; only use the scene ids provided above.');
    lines.push('- Keep ops to <= 12. If you need more, summarize in notes.');

    return lines.join('\n');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.content) {
      const parsedPlan = parseBeatPlan(lastMsg.content);
      if (parsedPlan && parsedPlan.ops?.length) {
        setPlan(parsedPlan);
        return;
      }

      // Back-compat: old single-suggestion shape → convert into ops.
      const legacy = parseBeatSuggestion(lastMsg.content);
      if (legacy) {
        if (selectedBeat) {
          setPlan({
            ops: [
              {
                op: 'update',
                id: selectedBeat.id,
                updates: {
                  title: legacy.title ?? selectedBeat.title,
                  description: legacy.description ?? selectedBeat.description,
                  linkedSceneId: legacy.linkedSceneId ?? selectedBeat.linkedSceneId,
                },
                reason: legacy.reason,
              },
            ],
          });
        } else if (onAddBeat) {
          const targetAct =
            legacy.targetAct !== undefined
              ? Math.min(Math.max(legacy.targetAct, 0), actNames.length - 1)
              : 0;
          setPlan({
            ops: [
              {
                op: 'create',
                actIndex: targetAct,
                insertAfterOrder: legacy.insertAfterOrder,
                beat: { title: legacy.title ?? '', description: legacy.description ?? '', linkedSceneId: legacy.linkedSceneId },
                reason: legacy.reason,
              },
            ],
          });
        }
      }
    }
  }, [messages, selectedBeat, onAddBeat, actNames.length]);

  const lastAssistantContent = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'assistant' && (m.content || '').trim()) return m.content;
    }
    return '';
  }, [messages]);

  const showNoPlanHint = !isStreaming && messages.length > 0 && !plan && !!lastAssistantContent;

  if (!isOpen) return null;

  const handleSend = (prompt?: string) => {
    const text = prompt ?? input;
    if (!text.trim() || isStreaming) return;
    setPlan(null);
    const context = buildContext();
    // Keep the "JSON only" instruction in the context (so we don't pollute the visible user message).
    sendMessage(text, context, 'ask');
    if (!prompt) {
      setInput('');
    }
  };

  const applyOp = (op: BeatOp) => {
    if (!op || typeof op !== 'object') return;

    if (op.op === 'update') {
      if (!op.id) return;
      onUpdateBeat(op.id, op.updates || {});
      return;
    }
    if (op.op === 'create') {
      if (!onAddBeat) return;
      const actIndex = Math.min(Math.max(op.actIndex ?? 0, 0), actNames.length - 1);
      const beatSeed = op.beat || { title: '', description: '' };
      onAddBeat(actIndex, op.insertAfterOrder, {
        title: beatSeed.title ?? '',
        description: beatSeed.description ?? '',
        color: beatSeed.color,
        linkedSceneId: beatSeed.linkedSceneId,
      });
      return;
    }
    if (op.op === 'delete') {
      if (!onDeleteBeat) return;
      if (!op.id) return;
      onDeleteBeat(op.id);
      return;
    }
    if (op.op === 'move') {
      if (!onMoveBeat) return;
      if (!op.id) return;
      const actIndex = Math.min(Math.max(op.targetActIndex ?? 0, 0), actNames.length - 1);
      const targetOrder = Math.max(0, op.targetOrder ?? 0);
      onMoveBeat(op.id, actIndex, targetOrder);
      return;
    }
  };

  const applyAll = () => {
    if (!plan?.ops?.length) return;
    if (onApplyOps) {
      onApplyOps(plan.ops);
    } else {
      for (const op of plan.ops) applyOp(op);
    }
    setPlan(null);
  };

  const opLabel = (op: BeatOp): string => {
    if (op.op === 'create') {
      const title = (op.beat?.title || '').trim();
      const name = title ? `“${truncate(title, 60)}”` : 'Untitled beat';
      return `Create in Act ${op.actIndex + 1}${op.insertAfterOrder !== undefined ? ` after #${op.insertAfterOrder + 1}` : ''}: ${name}`;
    }
    if (op.op === 'update') {
      const beat = beats.find(b => b.id === op.id);
      const name = beat?.title ? `“${truncate(beat.title, 60)}”` : op.id;
      const fields = Object.keys(op.updates || {}).join(', ') || 'fields';
      return `Update ${name}: ${fields}`;
    }
    if (op.op === 'move') {
      const beat = beats.find(b => b.id === op.id);
      const name = beat?.title ? `“${truncate(beat.title, 60)}”` : op.id;
      return `Move ${name} → Act ${op.targetActIndex + 1}, position ${op.targetOrder + 1}`;
    }
    // delete
    {
      const beat = beats.find(b => b.id === op.id);
      const name = beat?.title ? `“${truncate(beat.title, 60)}”` : op.id;
      return `Delete ${name}`;
    }
  };

  return (
    <div className="beat-ai-panel">
      <div className="beat-ai-header">
        <div className="beat-ai-title">
          <Sparkles size={16} />
          <span>Beat AI</span>
        </div>
        <div className="beat-ai-actions">
          {messages.length > 0 && (
            <button className="beat-ai-icon-btn" onClick={clearMessages} title="Clear chat">
              <Trash2 size={14} />
            </button>
          )}
          <button className="beat-ai-icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="beat-ai-selected">
        <div className="beat-ai-selected-label" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>Selected beat</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.8 }}>
            <input
              type="checkbox"
              checked={includeSceneHeadings}
              onChange={(e) => setIncludeSceneHeadings(e.target.checked)}
            />
            Include scene headings (linking only)
          </label>
        </div>
        {selectedBeat ? (
          <div className="beat-ai-selected-body">
            <div className="beat-ai-selected-title">{selectedBeat.title || 'Untitled beat'}</div>
            <div className="beat-ai-selected-desc">
              {selectedBeat.description ? truncate(selectedBeat.description, 200) : 'No description yet.'}
            </div>
          </div>
        ) : (
          <div className="beat-ai-selected-empty">Select a beat to target rewrites.</div>
        )}
      </div>

      <div className="beat-ai-messages">
        {messages.length === 0 && (
          <div className="beat-ai-empty">
            <Sparkles size={28} />
            <p>Ask for beat rewrites, new beats, or structure notes.</p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const isLastMessage = idx === messages.length - 1;
          const isStreamingBeat = isStreaming && isLastMessage && msg.role === 'assistant';
          
          // Get display content - strip JSON if it's a beat suggestion
          let displayContent = '';
          if (msg.content) {
            // During streaming, completely hide content if it contains JSON
            if (isStreamingBeat && containsJSON(msg.content)) {
              displayContent = '';
            } else {
              // Strip JSON from content for display
              const stripped = stripJSONFromContent(msg.content);
              displayContent = stripped;
            }
          }
          
          return (
          <div key={idx} className={`beat-ai-message beat-ai-message--${msg.role}`}>
            <div className="beat-ai-message-avatar">
              {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className="beat-ai-message-bubble">
              <div className="beat-ai-message-content">
                {displayContent && (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(displayContent) as string
                    }}
                  ></div>
                )}
                {msg.role === 'assistant' && plan && idx === messages.length - 1 && (
                  <div className="beat-ai-suggestion">
                    <div className="beat-ai-suggestion-header">Proposed beat changes</div>
                    {plan.notes && <div className="beat-ai-suggestion-reason">{plan.notes}</div>}
                    <div className="beat-ai-suggestion-desc">
                      {(plan.ops || []).slice(0, 20).map((op, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                          <div style={{ flex: 1 }}>{opLabel(op)}</div>
                          <button className="beat-ai-secondary" onClick={() => applyOp(op)}>
                            Apply
                          </button>
                        </div>
                      ))}
                      {plan.ops.length > 20 && <div style={{ marginTop: 8, opacity: 0.8 }}>… more ops not shown</div>}
                    </div>
                    <div className="beat-ai-suggestion-actions">
                      <button
                        className="beat-ai-primary"
                        onClick={applyAll}
                        disabled={!plan.ops.length}
                        title="Apply all proposed changes"
                      >
                        Apply all
                      </button>
                      <button className="beat-ai-secondary" onClick={() => setPlan(null)}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })}
        {error && <div className="beat-ai-error">⚠️ {error}</div>}
        {showNoPlanHint && (
          <div className="beat-ai-suggestion">
            <div className="beat-ai-suggestion-header">No structured ops returned</div>
            <div className="beat-ai-suggestion-desc">
              Beat AI needs to return JSON ops to apply changes. Click below to convert the last answer into ops JSON.
            </div>
            <div className="beat-ai-suggestion-actions">
              <button
                className="beat-ai-primary"
                onClick={() =>
                  handleSend(
                    `Convert the following into a single JSON object with the ops schema (no prose):\n\n${truncate(
                      lastAssistantContent,
                      1800
                    )}`
                  )
                }
              >
                Request ops JSON
              </button>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="beat-ai-input">
        <div className="beat-ai-input-wrapper">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for beat help…"
            rows={1}
            disabled={isStreaming}
          />
          <div className="beat-ai-input-actions">
            {isStreaming ? (
              <button className="beat-ai-stop" onClick={stopStreaming} title="Stop generating">
                <Square size={16} />
              </button>
            ) : (
              <button className="beat-ai-send" onClick={() => handleSend()} disabled={!input.trim()} title="Send message">
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
