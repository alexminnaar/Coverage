import { useState, useCallback, useRef } from 'react';
import { streamChat, ChatMessage, EditProposal, AIStreamEvent } from '../services/aiClient';
import { ElementType } from '../types';

interface UseAIChatResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (
    content: string,
    sceneContext?: string,
    mode?: 'ask' | 'edit',
    requestMeta?: {
      selectedElementId?: string | null;
      selectedText?: string | null;
      contextPolicy?: 'scene_plus_adjacent' | 'full';
      contextElementIds?: string[];
    }
  ) => Promise<void>;
  clearMessages: () => void;
  stopStreaming: () => void;
}

// Parse edit proposals from AI response
// Now handles typed events: {"type":"status","message":"..."} and {"type":"final","edits":{...}}
function parseEditProposals(
  content: string,
  elements: Array<{ id: string; type: ElementType; content: string }>
): EditProposal[] {
  const edits: EditProposal[] = [];

  // Try to parse as typed events - look for final event with edits
  const lines = content.split('\n').filter(line => line.trim());
  let finalEvent: any = null;
  
  // Look for the last "final" type event
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      const event = JSON.parse(line);
      if (event.type === 'final' && event.edits) {
        finalEvent = event;
        break;
      }
    } catch (e) {
      // Not valid JSON, continue
      continue;
    }
  }
  
  // If we found a final event, use it
  if (finalEvent && finalEvent.edits) {
    try {
      const parsed = finalEvent.edits;
      if (parsed.edits && Array.isArray(parsed.edits)) {
        const processedEdits = parsed.edits.filter((edit: any) => {
          // Validate edit proposal
          const elementExists = elements.some(el => el.id === edit.elementId);
          if (!elementExists) {
            console.warn(`AI proposed edit for non-existent element: ${edit.elementId}`);
          }
          return edit.elementId &&
            edit.originalContent !== undefined &&
            edit.newContent !== undefined &&
            elementExists;
        }).map((edit: any) => {
          const result = {
            elementId: edit.elementId,
            elementType: edit.elementType || 'action',
            originalContent: edit.originalContent || '',
            newContent: edit.newContent || '',
            reason: edit.reason,
            newElements: edit.newElements && Array.isArray(edit.newElements)
              ? edit.newElements.map((el: any) => ({
                type: el.type || 'action',
                content: el.content || ''
              }))
              : undefined,
          };

          return result;
        });

        return processedEdits;
      }
    } catch (e) {
      // Fallthrough to other parsing methods if JSON fails
      // Fallthrough to other parsing methods if JSON fails
    }
  }

  // 2. Legacy/Fallback: Try to find markdown-style edit blocks
  // This is kept for backward compatibility or if the AI ignores the JSON instruction
  const editBlocks = content.match(/##\s*Edit\s*[\d]+:?\s*([\s\S]*?)(?=##\s*Edit|$)/gi);
  if (editBlocks) {
    editBlocks.forEach(block => {
      // Try multiple ID patterns
      const elementIdMatch = block.match(/Element\s+ID:\s*([a-f0-9-]+)/i) ||
        block.match(/ID:\s*([a-f0-9-]+)/i) ||
        block.match(/id:\s*([a-f0-9-]+)/i) ||
        block.match(/elementId["\s:]+([a-f0-9-]+)/i);
      const originalMatch = block.match(/Original:\s*```[\s\S]*?```\s*([\s\S]*?)(?=New:|$)/i) ||
        block.match(/Original:\s*([^\n]+)/i) ||
        block.match(/originalContent["\s:]+["']?([^"']+)["']?/i);
      const newMatch = block.match(/New:\s*```[\s\S]*?```\s*([\s\S]*?)(?=Reason:|$)/i) ||
        block.match(/New:\s*([^\n]+)/i) ||
        block.match(/newContent["\s:]+["']?([^"']+)["']?/i);
      const reasonMatch = block.match(/Reason:\s*(.+?)(?=\n\n|$)/i) ||
        block.match(/reason["\s:]+["']?([^"']+)["']?/i);

      if (elementIdMatch && originalMatch && newMatch) {
        const elementId = elementIdMatch[1];
        if (elements.some(el => el.id === elementId)) {
          edits.push({
            elementId,
            elementType: 'action', // Default, could be extracted from context
            originalContent: originalMatch[1].trim(),
            newContent: newMatch[1].trim(),
            reason: reasonMatch?.[1]?.trim(),
          });
        }
      }
    });
  }

  return edits;
}

// Extract complete JSON objects from a stream where objects may arrive concatenated (e.g. `}{`) or with whitespace.
// This is used to robustly parse edit-mode typed events over streaming transport.
function extractJsonObjects(input: string): { objects: string[]; remainder: string } {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (start === -1) {
      if (ch === '{') {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        objects.push(input.slice(start, i + 1));
        start = -1;
      }
    }
  }

  const remainder = start === -1 ? '' : input.slice(start);
  return { objects, remainder };
}

export function useAIChat(
  elements?: Array<{ id: string; type: ElementType; content: string }>,
  projectId?: string
): UseAIChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(async (
    content: string,
    sceneContext?: string,
    mode: 'ask' | 'edit' = 'ask',
    requestMeta?: {
      selectedElementId?: string | null;
      selectedText?: string | null;
      contextPolicy?: 'scene_plus_adjacent' | 'full';
      contextElementIds?: string[];
    }
  ) => {
    if (!content.trim()) return;

    setError(null);

    // Add user message
    const userMessage: ChatMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);

    // Start streaming assistant response
    setIsStreaming(true);
    abortControllerRef.current = new AbortController();

    // Add empty assistant message (in edit mode we also track typed streaming events)
    setMessages(prev => [
      ...prev,
      { role: 'assistant', content: '', events: (mode === 'edit' || mode === 'ask') ? [] : undefined }
    ]);

    try {
      let fullResponse = '';
      const allMessages = [...messages, userMessage];

      let finalEdits: EditProposal[] | undefined = undefined;
      let eventBuffer = '';
      let typedEvents: AIStreamEvent[] = [];
      
      for await (const chunk of streamChat(
        allMessages,
        sceneContext,
        mode,
        projectId,
        abortControllerRef.current.signal,
        requestMeta
      )) {
        // Edit mode: chunks may contain concatenated JSON events; parse robustly using a small stateful buffer.
        if (mode === 'edit') {
          eventBuffer += chunk;
          const { objects, remainder } = extractJsonObjects(eventBuffer);
          eventBuffer = remainder;

          // If we couldn't extract any complete JSON objects, don't mutate fullResponse yet (likely partial JSON).
          if (objects.length === 0) {
            continue;
          }

          for (const objStr of objects) {
        try {
              const event = JSON.parse(objStr) as AIStreamEvent;
              typedEvents.push(event);
          
          if (event.type === 'status') {
                fullResponse += (event as any).message + '\n';
              } else if (event.type === 'final' && (event as any).edits) {
                const editsPayload = (event as any).edits;
                if (editsPayload.edits && Array.isArray(editsPayload.edits)) {
                  finalEdits = editsPayload.edits
                    .filter((edit: any) => {
                const elementExists = elements?.some(el => el.id === edit.elementId);
                      return (
                        edit.elementId &&
                        edit.originalContent !== undefined &&
                        edit.newContent !== undefined &&
                        elementExists
                      );
                    })
                    .map((edit: any) => ({
                elementId: edit.elementId,
                elementType: edit.elementType || 'action',
                originalContent: edit.originalContent || '',
                newContent: edit.newContent || '',
                reason: edit.reason,
                newElements: edit.newElements,
              }));
            }
              } else if (event && Array.isArray((event as any).edits)) {
                // Legacy final payload shape: {"edits":[...]} (no typed wrapper)
                finalEdits = (event as any).edits
                  .filter((edit: any) => {
                    const elementExists = elements?.some(el => el.id === edit.elementId);
                    return (
                      edit.elementId &&
                      edit.originalContent !== undefined &&
                      edit.newContent !== undefined &&
                      elementExists
                    );
                  })
                  .map((edit: any) => ({
                    elementId: edit.elementId,
                    elementType: edit.elementType || 'action',
                    originalContent: edit.originalContent || '',
                    newContent: edit.newContent || '',
                    reason: edit.reason,
                    newElements: edit.newElements,
                  }));
              } else {
                // Non-status typed event; keep in typedEvents but don't add noise to transcript.
              }
            } catch (e) {
              fullResponse += objStr;
            }
          }
        } else {
          // Ask mode: typed events by default. We still tolerate plain text.
          try {
            const event = JSON.parse(chunk) as AIStreamEvent;
            typedEvents.push(event);

            if (event.type === 'status') {
              fullResponse += (event as any).message + '\n';
            } else if (event.type === 'final' && (event as any).content) {
              // Final answer payload
              fullResponse = String((event as any).content);
            } else {
              // decision/tool events: keep them in typedEvents, don't pollute transcript
            }
          } catch (e) {
            fullResponse += chunk;
          }
        }
        
        // Update the last message (assistant)
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];

          // In edit mode, use finalEdits if available, otherwise try to parse
          if (mode === 'edit' && elements) {
            const edits = finalEdits || parseEditProposals(fullResponse, elements);
            updated[updated.length - 1] = {
              ...lastMsg,
              content: fullResponse,
              edits: edits.length > 0 ? edits : undefined,
              events: typedEvents
            };
          } else {
            updated[updated.length - 1] = { ...(lastMsg as any), role: 'assistant', content: fullResponse, events: typedEvents };
          }
          return updated;
        });
      }

      // Final parse of edits after streaming completes (in case JSON was split across chunks)
      if (mode === 'edit' && elements) {
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg.role === 'assistant') {
            const edits = parseEditProposals(fullResponse, elements);
            updated[updated.length - 1] = {
              ...lastMsg,
              edits: edits.length > 0 ? edits : lastMsg.edits,
              events: typedEvents.length > 0 ? typedEvents : lastMsg.events
            };
          }
          return updated;
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to get response');
      // Remove the empty assistant message on error
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [messages, elements, projectId]);

  const clearMessages = useCallback(() => {
    stopStreaming();
    setMessages([]);
    setError(null);
  }, [stopStreaming]);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearMessages,
    stopStreaming,
  };
}

