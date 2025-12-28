import { useCallback, useRef, useEffect } from 'react';

interface UseTypewriterScrollOptions {
  enabled: boolean;
  editorRef: React.RefObject<HTMLElement>;
  activeElementId: string | null;
  offset?: number; // Vertical offset from center (default 0)
  delay?: number;  // Debounce delay in ms (default 100)
}

/**
 * Custom hook for typewriter-style scrolling behavior
 * Keeps the active element vertically centered in the editor
 */
export function useTypewriterScroll({
  enabled,
  editorRef,
  activeElementId,
  offset = 0,
  delay = 100,
}: UseTypewriterScrollOptions) {
  const timeoutRef = useRef<number | null>(null);
  const isManualScrollRef = useRef(false);
  const lastScrollTimeRef = useRef(0);

  // Detect manual scrolling to temporarily pause auto-scroll
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) return;

    const handleScroll = () => {
      const now = Date.now();
      // If scroll happened within 50ms of our programmatic scroll, ignore it
      if (now - lastScrollTimeRef.current < 50) return;
      
      isManualScrollRef.current = true;
      
      // Reset after 2 seconds of no manual scrolling
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        isManualScrollRef.current = false;
      }, 2000);
    };

    editor.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      editor.removeEventListener('scroll', handleScroll);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [editorRef, enabled]);

  // Scroll to center the active element
  const scrollToCenter = useCallback((elementId: string) => {
    if (!enabled || isManualScrollRef.current) return;

    const editor = editorRef.current;
    if (!editor) return;

    // Find the active element
    const activeElement = editor.querySelector(`[data-element-id="${elementId}"]`);
    if (!activeElement) return;

    // Get positions relative to the editor container
    const editorRect = editor.getBoundingClientRect();
    const elementRect = activeElement.getBoundingClientRect();

    // Calculate where the element center is relative to the editor's visible area
    const elementTop = elementRect.top - editorRect.top + editor.scrollTop;
    const elementCenter = elementTop + elementRect.height / 2;
    
    // Target scroll position to center the element
    const targetScrollTop = elementCenter - editorRect.height / 2 + offset;
    const currentScrollTop = editor.scrollTop;
    const scrollOffset = targetScrollTop - currentScrollTop;

    // Only scroll if the element is not already roughly centered (within 50px)
    if (Math.abs(scrollOffset) > 50) {
      lastScrollTimeRef.current = Date.now();
      editor.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      });
    }
  }, [enabled, editorRef, offset]);

  // Reset manual scroll flag when typewriter mode is enabled
  useEffect(() => {
    if (enabled) {
      isManualScrollRef.current = false;
    }
  }, [enabled]);

  // Debounced scroll effect when active element changes
  useEffect(() => {
    if (!enabled || !activeElementId) return;

    // Reset manual scroll flag when a new element is focused (user wants to center it)
    isManualScrollRef.current = false;

    const timer = setTimeout(() => {
      scrollToCenter(activeElementId);
    }, delay);

    return () => clearTimeout(timer);
  }, [enabled, activeElementId, scrollToCenter, delay]);

  // Force scroll (bypasses manual scroll pause)
  const forceScrollToCenter = useCallback((elementId: string) => {
    isManualScrollRef.current = false;
    scrollToCenter(elementId);
  }, [scrollToCenter]);

  return {
    scrollToCenter,
    forceScrollToCenter,
    isManuallyScrolling: isManualScrollRef.current,
  };
}

