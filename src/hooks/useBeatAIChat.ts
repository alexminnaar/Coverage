import { useState, useCallback, useRef } from 'react';
import { streamBeatChat, ChatMessage } from '../services/aiClient';
import { Beat } from '../types';

interface UseBeatAIChatResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (
    content: string,
    beats: Beat[],
    actNames: string[],
    selectedBeatId?: string | null,
    scenes?: Array<{ id: string; name: string }>,
    projectId?: string,
    model?: string
  ) => Promise<void>;
  clearMessages: () => void;
  stopStreaming: () => void;
}

export function useBeatAIChat(): UseBeatAIChatResult {
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
    beats: Beat[],
    actNames: string[],
    selectedBeatId?: string | null,
    scenes?: Array<{ id: string; name: string }>,
    projectId?: string,
    model?: string
  ) => {
    if (!content.trim()) return;

    setError(null);

    // Add user message
    const userMessage: ChatMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);

    // Start streaming assistant response
    setIsStreaming(true);
    abortControllerRef.current = new AbortController();

    // Add empty assistant message
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      let fullResponse = '';
      const allMessages = [...messages, userMessage];

      for await (const chunk of streamBeatChat(
        allMessages,
        beats,
        actNames,
        selectedBeatId,
        scenes,
        projectId,
        abortControllerRef.current.signal,
        { model }
      )) {
        fullResponse += chunk;
        // Update the last assistant message with accumulated content
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
            newMessages[lastIdx] = { ...newMessages[lastIdx], content: fullResponse };
          }
          return newMessages;
        });
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to get beat AI response';
      setError(errorMessage);
      // Update the last assistant message with error
      setMessages(prev => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
          newMessages[lastIdx] = { ...newMessages[lastIdx], content: `Error: ${errorMessage}` };
        }
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [messages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    stopStreaming();
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

