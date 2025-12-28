import { useState, useRef, useEffect, useMemo } from 'react';
import { Marked } from 'marked';
import {
  X,
  Trash2,
  Send,
  Square,
  Sparkles,
  MessageSquare,
  Lightbulb,
  Search,
  Palette,
  Timer,
  Drama,
  User,
  Bot,
  Edit3,
  MessageCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useAIChat } from '../hooks/useAIChat';
import { PendingEdit, ScriptElement, ELEMENT_LABELS, ElementType } from '../types';
import type { AIStreamEvent } from '../services/aiClient';

interface AIChatProps {
  isOpen: boolean;
  onClose: () => void;
  elements: ScriptElement[];
  currentElementId?: string | null;
  onProposeEdits: (edits: PendingEdit[]) => void;
  pendingEdits?: Map<string, PendingEdit>;
  onJumpToElement?: (id: string) => void;
  onAcceptEdit?: (id: string) => void;
  onRejectEdit?: (id: string) => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  projectId?: string;
}

const marked = new Marked();

const QUICK_PROMPTS = [
  {
    label: 'Analyze scene',
    prompt: 'Analyze this scene. What works well and what could be improved?',
    icon: Search,
    color: '#3b82f6'
  },
  {
    label: 'Improve dialogue',
    prompt: 'Suggest some alternative dialogue options that feel more natural.',
    icon: MessageSquare,
    color: '#8b5cf6'
  },
  {
    label: 'Find issues',
    prompt: 'What potential plot holes or continuity issues do you see?',
    icon: Lightbulb,
    color: '#f59e0b'
  },
  {
    label: 'Add subtext',
    prompt: 'How can I add more subtext to this dialogue?',
    icon: Drama,
    color: '#ec4899'
  },
  {
    label: 'Visual ideas',
    prompt: 'How can I make this scene more visually interesting?',
    icon: Palette,
    color: '#10b981'
  },
  {
    label: 'Fix pacing',
    prompt: 'How is the pacing? Any suggestions to improve it?',
    icon: Timer,
    color: '#ef4444'
  },
];

export default function AIChat({
  isOpen,
  onClose,
  elements,
  currentElementId,
  onProposeEdits,
  pendingEdits,
  onJumpToElement,
  onAcceptEdit,
  onRejectEdit,
  width = 400,
  onWidthChange,
  projectId,
}: AIChatProps) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'ask' | 'edit'>('ask');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showEditList, setShowEditList] = useState(false);
  const [selectionSnapshot, setSelectionSnapshot] = useState<string>('');
  const [activeTextareaElementId, setActiveTextareaElementId] = useState<string | null>(null);

  // Resize state
  const [isDragging, setIsDragging] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const { messages, isStreaming, error, sendMessage, clearMessages, stopStreaming } = useAIChat(
    elements.map(el => ({ id: el.id, type: el.type, content: el.content })),
    projectId
  );

  const pendingEditList = useMemo(() => {
    if (!pendingEdits || pendingEdits.size === 0) return [];

    const orderMap = new Map<string, number>();
    elements.forEach((el, idx) => orderMap.set(el.id, idx));

    return Array.from(pendingEdits.values())
      .map(edit => ({
        edit,
        element: elements.find(el => el.id === edit.elementId),
        order: orderMap.get(edit.elementId) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.order - b.order);
  }, [pendingEdits, elements]);

  // Sync edits from messages to parent
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg?.edits) {
      // Convert to PendingEdit format
      const pendingEdits: PendingEdit[] = lastMsg.edits.map(e => ({
        elementId: e.elementId,
        originalContent: e.originalContent,
        newContent: e.newContent,
        reason: e.reason,
        newElements: e.newElements  // ✅ Include structured elements!
      }));
      // Safety check: ensure onProposeEdits is defined before calling
      if (onProposeEdits) {
        onProposeEdits(pendingEdits);
      }
    }
  }, [messages, onProposeEdits]);

  // Resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      // Calculate new width based on mouse position from right edge of screen
      const newWidth = window.innerWidth - e.clientX;

      // Clamp width between min and max values
      if (newWidth >= 300 && newWidth <= 800) {
        onWidthChange?.(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isDragging, onWidthChange]);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const formatSnippet = (text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return 'No content provided';
    if (clean.length <= 90) return clean;
    return `${clean.slice(0, 90)}…`;
  };

  // Strip JSON blocks from content for display
  const stripJSONFromContent = (content: string): string => {
    if (!content) return '';
    // Remove JSON code blocks
    let cleaned = content.replace(/```json\s*[\s\S]*?```/g, '');
    // Remove standalone JSON objects that look like edit proposals
    cleaned = cleaned.replace(/\{\s*"edits"\s*:[\s\S]*?\}/g, '');
    return cleaned.trim();
  };

  // Check if content looks like it contains JSON (for edit mode)
  const containsJSON = (content: string): boolean => {
    if (!content) return false;
    // Check for JSON code blocks
    if (/```json/i.test(content)) return true;
    // Check for JSON object structure with edits
    if (/\{\s*"edits"/i.test(content)) return true;
    // Check for common JSON patterns
    if (/\{\s*"elementId"/i.test(content)) return true;
    return false;
  };

  // Detect if content contains JSON that suggests edits are being generated
  const detectEditingElements = (content: string, elements: ScriptElement[]): Array<{ elementId: string; elementType: string }> => {
    if (!content) return [];
    const editing: Array<{ elementId: string; elementType: string }> = [];
    
    // Look for partial JSON that mentions elementId
    const elementIdMatches = content.matchAll(/"elementId"\s*:\s*"([^"]+)"/g);
    for (const match of elementIdMatches) {
      const elementId = match[1];
      const element = elements.find(el => el.id === elementId);
      if (element && !editing.find(e => e.elementId === elementId)) {
        editing.push({ elementId, elementType: element.type });
      }
    }

    // Also support plain-text status messages (e.g. "[Applying] Editing ... <uuid>, <uuid>")
    // by extracting UUIDs and mapping them back to known elements.
    const uuidMatches = content.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi);
    for (const match of uuidMatches) {
      const elementId = match[0];
      const element = elements.find(el => el.id === elementId);
      if (element && !editing.find(e => e.elementId === elementId)) {
        editing.push({ elementId, elementType: element.type });
      }
    }
    
    return editing;
  };

  const extractProgressSteps = (content: string): string[] => {
    if (!content) return [];
    // Capture bracketed steps even when multiple appear on one line.
    // We keep only the first line of each step to avoid dumping multi-line analyses into the status stack.
    const matches = content.match(/\[[^\]]+\][^\n\[]*/g) || [];
    const steps = matches
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.split('\n')[0].trim())
      .filter(s => /^\[[^\]]+\]/.test(s));

    // De-dupe consecutive duplicates and keep the most recent steps
    const deduped: string[] = [];
    for (const s of steps) {
      if (deduped.length === 0 || deduped[deduped.length - 1] !== s) deduped.push(s);
    }
    return deduped.slice(-12);
  };

  const timelineLinesFromEvents = (events?: AIStreamEvent[]): string[] => {
    if (!events || events.length === 0) return [];
    const lines: string[] = [];
    for (const evt of events) {
      if (!evt || typeof evt !== 'object') continue;
      if (evt.type === 'status' && (evt as any).message) {
        lines.push(String((evt as any).message));
      } else if (evt.type === 'decision' && (evt as any).action) {
        const why = (evt as any).why ? ` — ${(evt as any).why}` : '';
        lines.push(`[Decision] ${(evt as any).action}${why}`);
      } else if (evt.type === 'tool_call' && (evt as any).tool) {
        lines.push(`[Tool] ${(evt as any).tool}`);
      } else if (evt.type === 'tool_result' && (evt as any).tool) {
        const count = (evt as any).count;
        lines.push(`[Tool] ${(evt as any).tool}${typeof count === 'number' ? ` (${count})` : ''}`);
      } else if (evt.type === 'apply_started') {
        lines.push(`[Applying] ${(evt as any).label || 'Applying edits'}`);
      } else if (evt.type === 'apply_done') {
        lines.push('[Applying] Done');
      }
    }

    // De-dupe consecutive duplicates and keep the most recent lines
    const deduped: string[] = [];
    for (const s of lines) {
      const t = String(s || '').trim();
      if (!t) continue;
      if (deduped.length === 0 || deduped[deduped.length - 1] !== t) deduped.push(t);
    }
    return deduped.slice(-12);
  };

  const getApplyingElementIds = (events?: AIStreamEvent[]): string[] => {
    if (!events || events.length === 0) return [];
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i];
      if (evt && evt.type === 'apply_started' && Array.isArray((evt as any).elementIds)) {
        return (evt as any).elementIds;
      }
    }
    return [];
  };

  const getApplyMeta = (events?: AIStreamEvent[]): { label: string; elementIds: string[] } | null => {
    if (!events || events.length === 0) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i];
      if (evt && evt.type === 'apply_started') {
        const elementIds = Array.isArray((evt as any).elementIds) ? (evt as any).elementIds : [];
        const label = (evt as any).label ? String((evt as any).label) : 'Applying edits';
        return { label, elementIds };
      }
    }
    return null;
  };

  const stripProgressMarkers = (content: string): string => {
    if (!content) return '';
    // Remove bracketed progress segments from the text body.
    // This is intentionally conservative (only removes "[...]" segments and trailing text up to EOL).
    return content
      .replace(/\s*\[[^\]]+\][^\n]*\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const handleJumpToEdit = (elementId: string) => {
    onJumpToElement?.(elementId);
  };

  const handleAccept = (e: React.MouseEvent, elementId: string) => {
    e.stopPropagation();
    onAcceptEdit?.(elementId);
  };

  const handleReject = (e: React.MouseEvent, elementId: string) => {
    e.stopPropagation();
    onRejectEdit?.(elementId);
  };

  // Get current scene context - send full screenplay for better AI understanding
  const getSelectionText = () => {
    try {
      // If the user is selecting within a textarea (ScriptBlock), window.getSelection() will be empty.
      const active = document.activeElement;
      if (active && active instanceof HTMLTextAreaElement) {
        const { selectionStart, selectionEnd, value } = active;
        if (
          typeof selectionStart === 'number' &&
          typeof selectionEnd === 'number' &&
          selectionEnd > selectionStart
        ) {
          const slice = value.substring(selectionStart, selectionEnd).trim();
          if (slice.length > 2000) return slice.slice(0, 2000);
          return slice;
        }
      }

      const txt = window.getSelection?.()?.toString() || '';
      const cleaned = txt.trim();
      // Avoid huge accidental selections
      if (cleaned.length > 2000) return cleaned.slice(0, 2000);
      return cleaned;
    } catch {
      return '';
    }
  };

  const getActiveTextareaElementId = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement)) return null;
    const wrapper = active.closest?.('[data-element-id]') as HTMLElement | null;
    const id = wrapper?.getAttribute?.('data-element-id');
    return id || null;
  };

  useEffect(() => {
    if (isOpen) {
      // Snapshot current selection when opening the panel (best-effort).
      setSelectionSnapshot(getSelectionText());
      setActiveTextareaElementId(getActiveTextareaElementId());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let raf = 0;
    const updateFromSelection = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Ignore selections inside the AI panel itself (preview text, input, etc.)
        const sel = window.getSelection?.();
        const node = sel?.anchorNode as Node | null;
        if (node && sidebarRef.current && sidebarRef.current.contains(node)) return;

        setSelectionSnapshot(getSelectionText());
        setActiveTextareaElementId(getActiveTextareaElementId());
      });
    };

    document.addEventListener('selectionchange', updateFromSelection);
    // Some browsers are flaky with selectionchange when selection is made via mouse drag;
    // these ensure we catch it reliably.
    window.addEventListener('mouseup', updateFromSelection);
    window.addEventListener('keyup', updateFromSelection);
    window.addEventListener('focusin', updateFromSelection);

    return () => {
      document.removeEventListener('selectionchange', updateFromSelection);
      window.removeEventListener('mouseup', updateFromSelection);
      window.removeEventListener('keyup', updateFromSelection);
      window.removeEventListener('focusin', updateFromSelection);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, currentElementId]);

  const buildScenePlusAdjacentContext = (
    selectedText: string,
    selectedElementIdOverride?: string | null
  ): {
    sceneContext: string;
    contextElementIds: string[];
    selectedElementId?: string | null;
    selectedText?: string;
    sceneHeadings: string[];
    contextCharCount: number;
  } => {
    const allElements = elements.length > 0 ? elements : [];
    const selectedElementId = selectedElementIdOverride ?? null;

    const currentIdx = selectedElementId ? allElements.findIndex(el => el.id === selectedElementId) : -1;
    const selectedElement = currentIdx >= 0 ? allElements[currentIdx] : null;

    // Find scene-heading indices
    const sceneHeadingIdxs = allElements
      .map((el, idx) => (el.type === 'scene-heading' ? idx : -1))
      .filter(idx => idx >= 0);

    const findSceneHeadingForIndex = (idx: number) => {
      if (sceneHeadingIdxs.length === 0) return -1;
      let h = -1;
      for (const sh of sceneHeadingIdxs) {
        if (sh <= idx) h = sh;
        else break;
      }
      return h;
    };

    const currentSceneHeading = currentIdx >= 0 ? findSceneHeadingForIndex(currentIdx) : (sceneHeadingIdxs[0] ?? -1);
    const currentScenePos = currentSceneHeading >= 0 ? sceneHeadingIdxs.indexOf(currentSceneHeading) : -1;
    const prevSceneHeading = currentScenePos > 0 ? sceneHeadingIdxs[currentScenePos - 1] : 0;
    const nextNextSceneHeading =
      currentScenePos >= 0 && currentScenePos < sceneHeadingIdxs.length - 2 ? sceneHeadingIdxs[currentScenePos + 2] : -1;

    const startIdx = Math.max(0, prevSceneHeading);
    const endIdx = nextNextSceneHeading >= 0 ? nextNextSceneHeading : allElements.length;
    const windowEls = allElements.slice(startIdx, endIdx);
    const contextElementIds = windowEls.map(e => e.id);
    const sceneHeadings = windowEls
      .filter(e => e.type === 'scene-heading')
      .map(e => (e.content || '').trim())
      .filter(Boolean)
      .slice(0, 3);

    let sceneCount = 0;
    const formatted = windowEls
      .map((el, idx) => {
        const absoluteIdx = startIdx + idx;
        if (el.type === 'scene-heading') sceneCount++;
        const prefix = mode === 'edit' ? `Element ${absoluteIdx + 1} (ID: ${el.id}, Type: ${el.type}):` : '';
        const tag = `[${el.type.toUpperCase()}] ${el.content}`;
        return mode === 'edit' ? `${prefix}\n${tag}` : tag;
      })
      .join('\n\n');

    const selectionHeaderParts: string[] = [];
    if (selectedElementId) selectionHeaderParts.push(`SelectedElementId: ${selectedElementId}`);
    if (selectedElement) selectionHeaderParts.push(`SelectedElementType: ${selectedElement.type}`);
    if (selectedElement && selectedElement.content) {
      const snippet = selectedElement.content.trim();
      selectionHeaderParts.push(`SelectedElementSnippet: ${snippet.length > 240 ? snippet.slice(0, 240) + '…' : snippet}`);
    }

    const selectionBlock = selectedText
      ? `SelectedText:\n${selectedText}\n\n${selectionHeaderParts.length ? selectionHeaderParts.join('\n') + '\n\n' : ''}---\n\n`
      : selectionHeaderParts.length
        ? `${selectionHeaderParts.join('\n')}\n\n---\n\n`
        : '';

    return {
      sceneContext: `${selectionBlock}${formatted}`,
      contextElementIds,
      selectedElementId,
      selectedText: selectedText || undefined,
      sceneHeadings,
      contextCharCount: (`${selectionBlock}${formatted}`).length,
    };
  };

  const selectedElementForLabel = useMemo(() => {
    if (!currentElementId) return null;
    return elements.find(el => el.id === currentElementId) || null;
  }, [elements, currentElementId]);

  const selectionLabel = useMemo(() => {
    const sel = (selectionSnapshot || '').trim();
    if (sel) {
      const snippet = sel.length > 60 ? sel.slice(0, 60) + '…' : sel;
      return `“${snippet}” (${sel.length} chars)`;
    }
    // Only show element snippet when that element's textarea is actively focused.
    if (
      selectedElementForLabel &&
      activeTextareaElementId &&
      selectedElementForLabel.id === activeTextareaElementId
    ) {
      const typeLabel = ELEMENT_LABELS[selectedElementForLabel.type] || selectedElementForLabel.type;
      const content = (selectedElementForLabel.content || '').trim();
      const snippet = content ? (content.length > 60 ? content.slice(0, 60) + '…' : content) : '';
      return snippet ? `${typeLabel} — ${snippet}` : `${typeLabel}`;
    }
    return 'No selection';
  }, [selectionSnapshot, selectedElementForLabel, activeTextareaElementId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const selectedText = getSelectionText();
    const bundle = buildScenePlusAdjacentContext(selectedText, activeTextareaElementId);
    sendMessage(input, bundle.sceneContext, mode, {
      selectedElementId: bundle.selectedElementId,
      selectedText: bundle.selectedText,
      contextPolicy: 'scene_plus_adjacent',
      contextElementIds: bundle.contextElementIds,
    });
    setInput('');
  };

  const handleQuickPrompt = (prompt: string) => {
    const selectedText = getSelectionText();
    const bundle = buildScenePlusAdjacentContext(selectedText, activeTextareaElementId);
    sendMessage(prompt, bundle.sceneContext, mode, {
      selectedElementId: bundle.selectedElementId,
      selectedText: bundle.selectedText,
      contextPolicy: 'scene_plus_adjacent',
      contextElementIds: bundle.contextElementIds,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="ai-chat"
      style={{ width: `${width}px` }}
      ref={sidebarRef}
    >
      {/* Resize Handle */}
      <div
        className="ai-chat-resize-handle"
        onMouseDown={startResizing}
      />

      {/* Minimal header with mode toggle and actions */}
      <div className="ai-chat-header-minimal">
        <div className="ai-mode-toggle">
          <button
            className={`ai-mode-btn ${mode === 'ask' ? 'active' : ''}`}
            onClick={() => setMode('ask')}
            title="Ask mode - Chat only"
          >
            <MessageCircle size={14} />
            <span>Ask</span>
          </button>
          <button
            className={`ai-mode-btn ${mode === 'edit' ? 'active' : ''}`}
            onClick={() => setMode('edit')}
            title="Edit mode - AI can propose edits"
          >
            <Edit3 size={14} />
            <span>Edit</span>
          </button>
        </div>
        <div className="ai-header-actions">
          {messages.length > 0 && (
            <button
              className="ai-header-btn-minimal"
              onClick={clearMessages}
              title="Clear conversation"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button className="ai-header-btn-minimal" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="ai-chat-messages">
        {messages.length === 0 && (
          <div className="ai-chat-welcome">
            <div className="ai-welcome-icon">
              <Sparkles size={32} />
            </div>
            <h4>How can I help?</h4>
            <p>Ask me anything about your screenplay, or try one of these:</p>

            <div className="ai-quick-prompts-grid">
              {QUICK_PROMPTS.map((qp, i) => {
                const Icon = qp.icon;
                return (
                  <button
                    key={i}
                    className="ai-quick-prompt"
                    onClick={() => handleQuickPrompt(qp.prompt)}
                    style={{ '--prompt-color': qp.color } as React.CSSProperties}
                  >
                    <Icon size={16} />
                    <span>{qp.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const hasEdits = msg.edits && msg.edits.length > 0;
          const isLastMessage = i === messages.length - 1;
          const isStreamingEdit = isStreaming && isLastMessage && mode === 'edit' && msg.role === 'assistant';
          
          const progressSource = msg.content ? stripJSONFromContent(msg.content) : '';
          const progressSteps =
            mode === 'edit'
              ? (timelineLinesFromEvents(msg.events) || (progressSource ? extractProgressSteps(progressSource) : []))
              : [];
          const applyingElementIds = isStreamingEdit ? getApplyingElementIds(msg.events) : [];
          const applyMeta = mode === 'edit' ? getApplyMeta(msg.events) : null;

          // Get all elements being edited - from completed edits or detected during streaming
          const completedEditElements = hasEdits && msg.edits
            ? msg.edits.map(e => {
                const element = elements.find(el => el.id === e.elementId);
                return {
                  elementId: e.elementId,
                  elementType: element?.type || e.elementType || 'action',
                  isComplete: true
                };
              })
            : [];
          
          const editingElements =
            isStreamingEdit && applyingElementIds.length > 0
              ? applyingElementIds
                  .map(elementId => {
                    const element = elements.find(el => el.id === elementId);
                    // If the element isn't in the current list, still surface the apply pill (below)
                    // and skip per-element pills for unknown IDs.
                    if (!element) return null;
                    return { elementId, elementType: element.type, isComplete: false };
                  })
                  .filter(Boolean) as Array<{ elementId: string; elementType: string; isComplete: boolean }>
              : // legacy fallback: try to infer from streamed text
                (isStreamingEdit ? detectEditingElements(msg.content || '', elements).map(e => ({ ...e, isComplete: false })) : []);
          
          // Combine and deduplicate - prefer completed edits over streaming ones
          const allEditElements = [...completedEditElements, ...editingElements].reduce((acc, curr) => {
            const existing = acc.find(e => e.elementId === curr.elementId);
            if (!existing) {
              acc.push(curr);
            } else if (curr.isComplete && !existing.isComplete) {
              // Replace streaming with completed
              const index = acc.indexOf(existing);
              acc[index] = curr;
            }
            return acc;
          }, [] as Array<{ elementId: string; elementType: string; isComplete: boolean }>);
          
          // Get display content - show reasons from edits if available, otherwise strip JSON
          let displayContent = '';

          if (hasEdits && msg.edits && msg.edits.length > 0) {
            // Show reasons from edits (preferred)
            const reasons = msg.edits
              .map(e => e.reason)
              .filter((r): r is string => !!r);
            if (reasons.length > 0) {
              displayContent = reasons.join('\n\n');
            }
          } else if (isStreamingEdit) {
            // In edit mode while streaming, only show the progress stack (Cursor-like),
            // not the verbose planning/analysis text.
            displayContent = '';
          } else if (msg.content) {
            // In edit mode during streaming, completely hide content if it contains JSON
            if (isStreamingEdit && containsJSON(msg.content)) {
              displayContent = '';
            } else {
              // Strip JSON from content for display
              const stripped = stripJSONFromContent(msg.content);
              // In edit mode, hide progress markers from the message body to avoid duplication/noise.
              displayContent = mode === 'edit' ? stripProgressMarkers(stripped) : stripped;
            }
          }

          return (
            <div key={i} className={`ai-message ai-message--${msg.role}`}>
              <div className="ai-message-avatar">
                {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
              </div>
              <div className="ai-message-bubble">
                {/* Edit-mode progress (Cursor-like) */}
                {isStreamingEdit && progressSteps.length > 0 && (
                  <div className="ai-progress">
                    {progressSteps.map((line, idx) => {
                      const isActive = idx === progressSteps.length - 1;
                      return (
                        <div
                          key={`${idx}-${line}`}
                          className={`ai-progress-line ${isActive ? 'ai-progress-line--active' : ''}`}
                        >
                          {line}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Apply-phase pill (Cursor-like): show only for the most recent edit run (Cursor doesn't keep old pills around) */}
                {mode === 'edit' && isLastMessage && applyMeta && (isStreamingEdit || hasEdits) && (
                  <div className="ai-edit-loading-container">
                    <div
                      className={`ai-edit-loading ${hasEdits ? 'ai-edit-complete' : ''} ${hasEdits && msg.edits?.[0]?.elementId ? 'ai-edit-clickable' : ''}`}
                      onClick={hasEdits && msg.edits?.[0]?.elementId ? () => handleJumpToEdit(msg.edits![0].elementId) : undefined}
                      style={hasEdits && msg.edits?.[0]?.elementId ? { cursor: 'pointer' } : undefined}
                      title={hasEdits && msg.edits?.[0]?.elementId ? 'Click to jump to first edit' : undefined}
                    >
                      {hasEdits ? (
                        <Check size={14} className="ai-edit-complete-icon" />
                      ) : (
                        <Loader2 size={14} className="ai-edit-loading-spinner" />
                      )}
                      <span>{hasEdits ? 'Edited Dialogue' : applyMeta.label}</span>
                    </div>
                  </div>
                )}

                {/* Fallback (no apply_started events): show per-element pills (also only for most recent run) */}
                {mode === 'edit' && isLastMessage && !applyMeta && allEditElements.length > 0 && (
                  <div className="ai-edit-loading-container">
                    {allEditElements.map(({ elementId, elementType, isComplete }) => (
                      <div
                        key={elementId}
                        className={`ai-edit-loading ${isComplete ? 'ai-edit-complete' : ''} ${isComplete ? 'ai-edit-clickable' : ''}`}
                        onClick={isComplete ? () => handleJumpToEdit(elementId) : undefined}
                        style={isComplete ? { cursor: 'pointer' } : undefined}
                        title={isComplete ? 'Click to jump to edit' : undefined}
                      >
                        {isComplete ? (
                          <Check size={14} className="ai-edit-complete-icon" />
                        ) : (
                          <Loader2 size={14} className="ai-edit-loading-spinner" />
                        )}
                        <span>
                          {isComplete ? 'Edited' : 'Editing'} {ELEMENT_LABELS[elementType as ElementType] || elementType}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Display content - reasons or cleaned content */}
                {displayContent && (
                  <div
                    className="ai-message-content"
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(displayContent) as string
                    }}
                  ></div>
                )}

                {/* Show typing indicator if streaming and no content yet */}
                {isStreaming && isLastMessage && !displayContent && editingElements.length === 0 && progressSteps.length === 0 && (
                  <div className="ai-message-content">
                    <span className="ai-typing"><span></span><span></span><span></span></span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {error && (
          <div className="ai-chat-error">
            <span>⚠️</span> {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="ai-chat-input-container">
        <div className="ai-context-bar">
          <div className="ai-context-chip">
            <div className="ai-context-line">{selectionLabel}</div>
          </div>
        </div>

        {pendingEditList.length > 0 && (
          <div className="ai-edit-summary">
            <button
              className="ai-edit-summary-toggle"
              onClick={() => setShowEditList(prev => !prev)}
              aria-expanded={showEditList}
            >
              <div className="ai-edit-summary-label">
                <Sparkles size={14} />
                <span>
                  {pendingEditList.length === 1
                    ? '1 edit proposed'
                    : `${pendingEditList.length} edits proposed`}
                </span>
              </div>
              <div className="ai-edit-summary-chevron">
                {showEditList ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            </button>

            {showEditList && (
              <div className="ai-edit-summary-list">
                {pendingEditList.map(({ edit, element }) => (
                  <button
                    key={edit.elementId}
                    className="ai-edit-summary-row"
                    onClick={() => handleJumpToEdit(edit.elementId)}
                  >
                    <div className="ai-edit-summary-row-main">
                      <div className="ai-edit-summary-title">
                        {element ? ELEMENT_LABELS[element.type] : 'Screenplay element'}
                      </div>
                      <div className="ai-edit-summary-snippet">
                        {formatSnippet(edit.reason || edit.newContent || edit.originalContent)}
                      </div>
                    </div>
                    <div className="ai-edit-summary-actions">
                      <button
                        className="ai-edit-action accept"
                        onClick={(e) => handleAccept(e, edit.elementId)}
                        title="Accept edit"
                      >
                        <Check size={14} />
                        <span>Accept</span>
                      </button>
                      <button
                        className="ai-edit-action reject"
                        onClick={(e) => handleReject(e, edit.elementId)}
                        title="Reject edit"
                      >
                        <X size={14} />
                        <span>Reject</span>
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="ai-chat-input-wrapper">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'edit' ? 'Request edits to your screenplay...' : 'Ask about your screenplay...'}
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              className="ai-send-btn ai-stop-btn"
              onClick={stopStreaming}
              title="Stop generating"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              className="ai-send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
              title="Send message"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <div className="ai-input-hint">
          <kbd>↵</kbd> to send · <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
