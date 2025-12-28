import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { ScriptElement, ElementType } from '../types';
import ScriptBlock from './ScriptBlock';
import { groupDualDialogue, ElementGroup } from '../utils/dualDialogue';
import { useTypewriterScroll } from '../hooks/useTypewriterScroll';

import { PendingEdit } from '../types';

interface ScriptEditorProps {
  elements: ScriptElement[];
  focusedElementId: string | null;
  onElementChange: (id: string, content: string) => void;
  onElementTypeChange: (id: string, type: ElementType) => void;
  onAddElement: (afterId: string, type?: ElementType) => string;
  onDeleteElement: (id: string) => void;
  onFocusConsumed: () => void;
  searchQuery?: string; // Optional search highlight
  onStartDualDialogue?: (characterId: string) => void;
  autoContd?: boolean;
  typewriterMode?: boolean;
  focusMode?: boolean;
  // Inline AI Edits
  pendingEdits?: Map<string, PendingEdit>;
  onAcceptEdit?: (id: string) => void;
  onRejectEdit?: (id: string) => void;
  // Callback when active element changes (for notes panel)
  onActiveElementChange?: (elementId: string | null) => void;
}

export default function ScriptEditor({
  elements,
  focusedElementId,
  onElementChange,
  onElementTypeChange,
  onAddElement,
  onDeleteElement,
  onFocusConsumed,
  searchQuery: _searchQuery, // Unused for now, could highlight matches later
  onStartDualDialogue,
  autoContd = true,
  typewriterMode = false,
  focusMode = false,
  pendingEdits,
  onAcceptEdit,
  onRejectEdit,
  onActiveElementChange,
}: ScriptEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [activeElementId, setActiveElementId] = useState<string | null>(null);

  // Typewriter scroll behavior
  useTypewriterScroll({
    enabled: typewriterMode,
    editorRef,
    activeElementId,
  });

  // Group elements for dual dialogue rendering
  const elementGroups = useMemo(() => groupDualDialogue(elements), [elements]);

  // Track active element for typewriter mode
  const handleElementFocus = useCallback((id: string) => {
    setActiveElementId(id);
    onActiveElementChange?.(id);
  }, [onActiveElementChange]);

  // Notify parent when active element changes
  useEffect(() => {
    onActiveElementChange?.(activeElementId);
  }, [activeElementId, onActiveElementChange]);

  // Handle focus requests
  useEffect(() => {
    if (focusedElementId) {
      const target = blockRefs.current.get(focusedElementId);
      if (target) {
        // Scroll into view even if this is a pending-edit wrapper (non-textarea)
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Focus if possible (textarea or focusable element)
        if ('focus' in target && typeof target.focus === 'function') {
          target.focus();
        }

        onFocusConsumed();
      }
    }
  }, [focusedElementId, onFocusConsumed]);

  const registerRef = (id: string, ref: HTMLElement | null) => {
    if (ref) {
      blockRefs.current.set(id, ref);
    } else {
      blockRefs.current.delete(id);
    }
  };

  // Navigate to previous/next block
  const focusPrevious = (currentId: string) => {
    const idx = elements.findIndex(el => el.id === currentId);
    if (idx > 0) {
      const prevId = elements[idx - 1].id;
      const target = blockRefs.current.get(prevId);
      if (target instanceof HTMLTextAreaElement) {
        target.focus();
        // Move cursor to end
        target.selectionStart = target.value.length;
        target.selectionEnd = target.value.length;
      }
    }
  };

  const focusNext = (currentId: string) => {
    const idx = elements.findIndex(el => el.id === currentId);
    if (idx < elements.length - 1) {
      const nextId = elements[idx + 1].id;
      const target = blockRefs.current.get(nextId);
      if (target instanceof HTMLTextAreaElement) {
        target.focus();
        target.selectionStart = 0;
        target.selectionEnd = 0;
      }
    }
  };

  const renderElement = (element: ScriptElement, index: number) => (
    <ScriptBlock
      key={element.id}
      element={element}
      allElements={elements}
      isFirst={index === 0}
      registerRef={registerRef}
      onContentChange={(content) => onElementChange(element.id, content)}
      onTypeChange={(type) => onElementTypeChange(element.id, type)}
      onAddElement={(type) => onAddElement(element.id, type)}
      onDeleteElement={() => onDeleteElement(element.id)}
      onFocusPrevious={() => focusPrevious(element.id)}
      onFocusNext={() => focusNext(element.id)}
      onStartDualDialogue={onStartDualDialogue}
      autoContd={autoContd}
      onFocus={() => handleElementFocus(element.id)}
      isDimmed={focusMode && activeElementId !== null && activeElementId !== element.id}
      pendingEdit={pendingEdits?.get(element.id)}
      onAcceptEdit={() => onAcceptEdit?.(element.id)}
      onRejectEdit={() => onRejectEdit?.(element.id)}
    />
  );

  const renderGroup = (group: ElementGroup) => {
    if (group.type === 'single') {
      const el = group.elements[0];
      const index = elements.findIndex(e => e.id === el.id);
      return renderElement(el, index);
    }

    // Dual dialogue group
    const leftElements = group.elements.filter(e => e.dualPosition === 'left');
    const rightElements = group.elements.filter(e => e.dualPosition === 'right');

    return (
      <div key={group.groupId} className="dual-dialogue-group">
        <div className="dual-dialogue-left">
          {leftElements.map(el => {
            const index = elements.findIndex(e => e.id === el.id);
            return renderElement(el, index);
          })}
        </div>
        <div className="dual-dialogue-right">
          {rightElements.map(el => {
            const index = elements.findIndex(e => e.id === el.id);
            return renderElement(el, index);
          })}
        </div>
      </div>
    );
  };

  const editorClasses = [
    'script-editor',
    typewriterMode ? 'typewriter-mode' : '',
    focusMode ? 'focus-mode' : '',
  ].filter(Boolean).join(' ');

  return (
    <main className={editorClasses} ref={editorRef}>
      <div className="script-paper">
        {elementGroups.map((group) => renderGroup(group))}
      </div>
    </main>
  );
}

