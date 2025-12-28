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
import { Beat } from '../types';
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
  actNames: string[];
  scenes: SceneSummary[];
  selectedBeatId?: string | null;
  onUpdateBeat: (id: string, updates: Partial<Beat>) => void;
  onAddBeat?: (actIndex: number, insertAfterOrder?: number, seed?: Partial<Beat>) => void;
}

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
  return false;
}

export default function BeatAIPanel({
  isOpen,
  onClose,
  beats,
  actNames,
  scenes,
  selectedBeatId,
  onUpdateBeat,
  onAddBeat,
}: BeatAIPanelProps) {
  const [input, setInput] = useState('');
  const [suggestion, setSuggestion] = useState<BeatSuggestion | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, isStreaming, error, sendMessage, clearMessages, stopStreaming } = useAIChat();

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
      const actBeats = orderedByAct[actIndex].slice(0, 10); // keep concise
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
      if (sceneName) {
        lines.push(`linkedScene: ${sceneName}`);
      }
      lines.push('');
    }

    if (scenes.length > 0) {
      lines.push('Scene Headings:');
      const limitedScenes = scenes.slice(0, 15);
      lines.push(
        limitedScenes.map((s) => `[id=${s.id}] ${s.name}`).join(' | ')
      );
      if (scenes.length > limitedScenes.length) {
        lines.push('… (more scenes not shown)');
      }
    }

    lines.push(
      'When proposing beats, keep titles concise and descriptions to 1-2 sentences. Prefer JSON: {"title":"...","description":"...","targetAct":<index>,"insertAfterOrder":<order>,"reason":"...","linkedSceneId":"optional"}'
    );

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
      const parsed = parseBeatSuggestion(lastMsg.content);
      if (parsed) {
        setSuggestion(parsed);
      }
    }
  }, [messages]);

  if (!isOpen) return null;

  const handleSend = (prompt?: string) => {
    const text = prompt ?? input;
    if (!text.trim() || isStreaming) return;
    const context = buildContext();
    sendMessage(text, context, 'ask');
    if (!prompt) {
      setInput('');
    }
  };

  const handleApplyToSelected = () => {
    if (!suggestion || !selectedBeat) return;
    onUpdateBeat(selectedBeat.id, {
      title: suggestion.title ?? selectedBeat.title,
      description: suggestion.description ?? selectedBeat.description,
      linkedSceneId: suggestion.linkedSceneId ?? selectedBeat.linkedSceneId,
    });
    setSuggestion(null);
  };

  const handleAddNewBeat = () => {
    if (!suggestion || onAddBeat === undefined) return;
    const targetAct =
      suggestion.targetAct !== undefined
        ? Math.min(Math.max(suggestion.targetAct, 0), actNames.length - 1)
        : selectedBeat?.actIndex ?? 0;
    const insertAfter = suggestion.insertAfterOrder ?? (selectedBeat ? selectedBeat.order : undefined);
    onAddBeat(targetAct, insertAfter, {
      title: suggestion.title,
      description: suggestion.description,
      linkedSceneId: suggestion.linkedSceneId,
    });
    setSuggestion(null);
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
        <div className="beat-ai-selected-label">Selected beat</div>
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
                {msg.role === 'assistant' && suggestion && idx === messages.length - 1 && (
                  <div className="beat-ai-suggestion">
                    <div className="beat-ai-suggestion-header">Suggested beat</div>
                    {suggestion.title && <div className="beat-ai-suggestion-title">{suggestion.title}</div>}
                    {suggestion.description && (
                      <div className="beat-ai-suggestion-desc">{suggestion.description}</div>
                    )}
                    {suggestion.reason && (
                      <div className="beat-ai-suggestion-reason">Reason: {suggestion.reason}</div>
                    )}
                    <div className="beat-ai-suggestion-actions">
                      <button
                        className="beat-ai-primary"
                        onClick={handleApplyToSelected}
                        disabled={!selectedBeat}
                        title="Apply to selected beat"
                      >
                        Apply to selected
                      </button>
                      {onAddBeat && (
                        <button className="beat-ai-secondary" onClick={handleAddNewBeat}>
                          Add as new beat
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })}
        {error && <div className="beat-ai-error">⚠️ {error}</div>}
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
