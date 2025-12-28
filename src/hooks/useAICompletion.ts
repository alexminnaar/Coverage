import { useState, useEffect, useRef, useCallback } from 'react';
import { streamCompletion, CompletionContext } from '../services/aiClient';

interface UseAICompletionOptions {
  enabled: boolean;
  debounceMs?: number;
}

interface UseAICompletionResult {
  suggestion: string;
  isLoading: boolean;
  error: string | null;
  accept: () => string;
  dismiss: () => void;
  requestCompletion: (context: CompletionContext) => void;
}

export function useAICompletion(options: UseAICompletionOptions): UseAICompletionResult {
  const { enabled, debounceMs = 500 } = options;
  
  const [suggestion, setSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContextRef = useRef<CompletionContext | null>(null);

  // Cancel any pending request
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Request completion with debounce
  const requestCompletion = useCallback((context: CompletionContext) => {
    if (!enabled) return;
    
    lastContextRef.current = context;
    cancelRequest();
    
    // Don't request if content is empty or too short
    if (!context.currentContent || context.currentContent.length < 3) {
      setSuggestion('');
      return;
    }

    debounceTimerRef.current = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      setSuggestion('');

      abortControllerRef.current = new AbortController();
      
      try {
        let fullSuggestion = '';
        for await (const chunk of streamCompletion(context, abortControllerRef.current.signal)) {
          fullSuggestion += chunk;
          setSuggestion(fullSuggestion);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Request was cancelled, ignore
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to get completion');
        setSuggestion('');
      } finally {
        setIsLoading(false);
      }
    }, debounceMs);
  }, [enabled, debounceMs, cancelRequest]);

  // Accept current suggestion
  const accept = useCallback(() => {
    const accepted = suggestion;
    setSuggestion('');
    cancelRequest();
    return accepted;
  }, [suggestion, cancelRequest]);

  // Dismiss suggestion
  const dismiss = useCallback(() => {
    setSuggestion('');
    cancelRequest();
  }, [cancelRequest]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRequest();
    };
  }, [cancelRequest]);

  // Clear suggestion when disabled
  useEffect(() => {
    if (!enabled) {
      setSuggestion('');
      cancelRequest();
    }
  }, [enabled, cancelRequest]);

  return {
    suggestion,
    isLoading,
    error,
    accept,
    dismiss,
    requestCompletion,
  };
}

