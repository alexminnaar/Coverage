import { useState, useCallback, useRef } from 'react';

interface UseHistoryOptions {
  maxHistory?: number;
}

interface UseHistoryReturn<T> {
  state: T;
  setState: (newState: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearHistory: () => void;
  resetState: (newState: T) => void;
}

export function useHistory<T>(
  initialState: T | (() => T),
  options: UseHistoryOptions = {}
): UseHistoryReturn<T> {
  const { maxHistory = 50 } = options;
  
  // Use refs to avoid recreating functions on every render
  const historyRef = useRef<T[]>([]);
  const currentIndexRef = useRef(-1);
  
  // Initialize state
  const [state, setStateInternal] = useState<T>(() => {
    const initial = typeof initialState === 'function' 
      ? (initialState as () => T)() 
      : initialState;
    historyRef.current = [initial];
    currentIndexRef.current = 0;
    return initial;
  });
  const [, setHistoryVersion] = useState(0);

  // Wrapper to track if we're in an undo/redo operation
  const isUndoRedoRef = useRef(false);

  const setState = useCallback((newState: T | ((prev: T) => T)) => {
    setStateInternal(prevState => {
      const nextState = typeof newState === 'function'
        ? (newState as (prev: T) => T)(prevState)
        : newState;
      
      // Don't add to history if this is an undo/redo operation
      if (isUndoRedoRef.current) {
        return nextState;
      }

      // State updates in the editor are immutable, so reference equality is
      // sufficient and avoids serializing an entire screenplay per keystroke.
      if (Object.is(prevState, nextState)) {
        return prevState;
      }

      // Truncate any future history (if we've undone and now making a new change)
      const newHistory = historyRef.current.slice(0, currentIndexRef.current + 1);
      
      // Add new state
      newHistory.push(nextState);
      
      // Limit history size
      if (newHistory.length > maxHistory) {
        newHistory.shift();
      } else {
        currentIndexRef.current++;
      }
      
      historyRef.current = newHistory;
      
      return nextState;
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    if (currentIndexRef.current > 0) {
      currentIndexRef.current--;
      isUndoRedoRef.current = true;
      setStateInternal(historyRef.current[currentIndexRef.current]);
      // Reset flag after state update
      setTimeout(() => { isUndoRedoRef.current = false; }, 0);
    }
  }, []);

  const redo = useCallback(() => {
    if (currentIndexRef.current < historyRef.current.length - 1) {
      currentIndexRef.current++;
      isUndoRedoRef.current = true;
      setStateInternal(historyRef.current[currentIndexRef.current]);
      // Reset flag after state update
      setTimeout(() => { isUndoRedoRef.current = false; }, 0);
    }
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = [state];
    currentIndexRef.current = 0;
    setHistoryVersion(version => version + 1);
  }, [state]);

  const resetState = useCallback((newState: T) => {
    historyRef.current = [newState];
    currentIndexRef.current = 0;
    isUndoRedoRef.current = false;
    setStateInternal(newState);
    setHistoryVersion(version => version + 1);
  }, []);

  return {
    state,
    setState,
    undo,
    redo,
    canUndo: currentIndexRef.current > 0,
    canRedo: currentIndexRef.current < historyRef.current.length - 1,
    clearHistory,
    resetState,
  };
}

