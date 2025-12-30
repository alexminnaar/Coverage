import { useRef, useEffect, useState, useMemo, KeyboardEvent, ChangeEvent } from 'react';
import { ScriptElement, ElementType, ELEMENT_LABELS, getNextElementType } from '../types';
import { useCharacterSuggestion } from '../hooks/useCharacterSuggestion';
import { shouldShowContd } from '../utils/contdMore';

import { PendingEdit } from '../types';
import { Check, X } from 'lucide-react';

interface ScriptBlockProps {
  element: ScriptElement;
  allElements: ScriptElement[];
  isFirst: boolean;
  registerRef: (id: string, ref: HTMLElement | null) => void;
  onContentChange: (content: string) => void;
  onTypeChange: (type: ElementType) => void;
  onAddElement: (type?: ElementType) => void;
  onDeleteElement: () => void;
  onFocusPrevious: () => void;
  onFocusNext: () => void;
  onStartDualDialogue?: (characterId: string) => void;
  autoContd?: boolean;
  onFocus?: () => void;
  isDimmed?: boolean;
  pendingEdit?: PendingEdit;
  onAcceptEdit?: () => void;
  onRejectEdit?: () => void;
}

export default function ScriptBlock({
  element,
  allElements,
  isFirst,
  registerRef,
  onContentChange,
  onTypeChange,
  onAddElement,
  onDeleteElement,
  onFocusPrevious,
  onFocusNext,
  onStartDualDialogue,
  autoContd = true,
  onFocus,
  isDimmed = false,
  pendingEdit,
  onAcceptEdit,
  onRejectEdit,
}: ScriptBlockProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingEditRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Calculate if this character element should show (CONT'D)
  const showContd = useMemo(() => {
    if (!autoContd || element.type !== 'character') return false;
    const index = allElements.findIndex(el => el.id === element.id);
    return index >= 0 && shouldShowContd(allElements, index);
  }, [autoContd, element.type, element.id, allElements]);

  // Character/location suggestion hook
  const {
    remainingText: suggestionText,
    acceptSuggestion,
    dismissSuggestion,
  } = useCharacterSuggestion({
    elements: allElements,
    currentContent: element.content,
    currentType: element.type,
    isActive: isFocused && (element.type === 'character' || element.type === 'scene-heading'),
  });

  // Register ref with parent
  // Register a focus/scroll target: textarea for normal blocks, wrapper for pending edits
  useEffect(() => {
    const focusTarget = pendingEdit ? pendingEditRef.current : textareaRef.current;
    registerRef(element.id, focusTarget);
    return () => registerRef(element.id, null);
  }, [element.id, registerRef, pendingEdit]);

  // Force textarea resize whenever content changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height computation
      textarea.style.height = '0px';
      // Force reflow
      textarea.offsetHeight;
      // Set to scroll height
      const newHeight = textarea.scrollHeight + 'px';
      textarea.style.height = newHeight;
    }
  }, [element.content, element.id, pendingEdit]);

  // Resize textarea when focus state changes (to account for focus style changes)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height computation
      textarea.style.height = '0px';
      // Force reflow
      textarea.offsetHeight;
      // Set to scroll height
      const newHeight = textarea.scrollHeight + 'px';
      textarea.style.height = newHeight;
    }
  }, [isFocused, element.id, element.type]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    let content = e.target.value;

    // Auto-detect scene headings
    if (element.type !== 'scene-heading') {
      const upper = content.toUpperCase();
      if (upper.startsWith('INT.') || upper.startsWith('EXT.') ||
        upper.startsWith('INT/EXT.') || upper.startsWith('I/E.')) {
        onTypeChange('scene-heading');
      }
    }

    // Auto-detect transitions
    if (element.type !== 'transition') {
      const upper = content.toUpperCase().trim();
      if (upper.endsWith('TO:') || upper === 'FADE IN:' || upper === 'FADE OUT.' || upper === 'CUT TO BLACK.') {
        onTypeChange('transition');
      }
    }

    onContentChange(content);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    const isAtStart = selectionStart === 0 && selectionEnd === 0;
    const isAtEnd = selectionStart === value.length && selectionEnd === value.length;
    const isEmpty = value.length === 0;

    // Tab: accept suggestion if available, otherwise cycle element type
    if (e.key === 'Tab') {
      e.preventDefault();
      if (suggestionText) {
        const fullText = acceptSuggestion();
        if (fullText) {
          onContentChange(fullText);
          return;
        }
      }
      const newType = getNextElementType(element.type);
      onTypeChange(newType);
      return;
    }

    // Escape: dismiss suggestion
    if (e.key === 'Escape' && suggestionText) {
      e.preventDefault();
      dismissSuggestion();
      return;
    }

    // Ctrl+D: Start dual dialogue (on character elements only)
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    if (modKey && e.key === 'd' && element.type === 'character' && onStartDualDialogue && !element.dualDialogueGroupId) {
      e.preventDefault();
      onStartDualDialogue(element.id);
      return;
    }

    // Enter: create new element
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      // If cursor is at end, create new element
      if (isAtEnd) {
        onAddElement();
      } else {
        // Split the content - keep text before cursor in current element
        const before = value.substring(0, selectionStart);
        onContentChange(before);
        // Create new element (content after cursor could be passed here in a future enhancement)
        onAddElement();
      }
      return;
    }

    // Backspace on empty element: delete it (unless it's the first one)
    if (e.key === 'Backspace' && isEmpty && !isFirst) {
      e.preventDefault();
      onDeleteElement();
      return;
    }

    // Backspace at start of non-empty element: merge with previous
    if (e.key === 'Backspace' && isAtStart && !isEmpty && !isFirst) {
      e.preventDefault();
      // Just move focus to previous - we could implement merge later
      onFocusPrevious();
      return;
    }

    // Arrow up at start: focus previous element
    if (e.key === 'ArrowUp' && isAtStart) {
      e.preventDefault();
      onFocusPrevious();
      return;
    }

    // Arrow down at end: focus next element
    if (e.key === 'ArrowDown' && isAtEnd) {
      e.preventDefault();
      onFocusNext();
      return;
    }
  };

  // Get placeholder based on element type
  const getPlaceholder = (): string => {
    switch (element.type) {
      case 'scene-heading':
        return 'INT./EXT. LOCATION - TIME';
      case 'action':
        return 'Describe the action...';
      case 'character':
        return 'CHARACTER NAME';
      case 'dialogue':
        return 'Dialogue...';
      case 'parenthetical':
        return '(emotion/direction)';
      case 'transition':
        return 'CUT TO:';
      default:
        return '';
    }
  };

  const showSceneNumber = element.type === 'scene-heading' && element.sceneNumber;

  // Get revision color for this element
  const revisionColor = element.revisionId ? 'blue' : undefined; // TODO: look up actual color from revisions

  const blockClasses = [
    'script-block',
    `script-block--${element.type}`,
    element.isDeleted ? 'deleted' : '',
    isDimmed ? 'dimmed' : '',
  ].filter(Boolean).join(' ');

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const renderStandardBlock = () => (
    <div
      className={blockClasses}
      data-revision-color={revisionColor}
      data-element-id={element.id}
    >
      <div className="block-type-indicator">
        <select
          className="type-select"
          value={element.type}
          onChange={(e) => onTypeChange(e.target.value as ElementType)}
        >
          {Object.entries(ELEMENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {showSceneNumber && (
        <div className={`scene-number-margin ${element.isSceneLocked ? 'locked' : ''}`}>
          {element.sceneNumber}
        </div>
      )}
      <div className="block-content-wrapper">
        <textarea
          ref={textareaRef}
          className="block-content"
          value={element.content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={() => {
            setIsFocused(false);
          }}
          placeholder={getPlaceholder()}
          rows={1}
          spellCheck
        />
        {suggestionText && isFocused && (
          <span className="ghost-suggestion">
            {element.content}{suggestionText}
          </span>
        )}
        {showContd && (
          <span className="contd-suffix"> (CONT'D)</span>
        )}
      </div>
    </div>
  );

  // Render Diff View if there is a pending edit
  if (pendingEdit) {
    // Check if this is an insert-only operation (content unchanged)
    const isInsertOnly = pendingEdit.newContent === pendingEdit.originalContent;

    const showOriginal = !isInsertOnly;
    const showNewContent = !isInsertOnly;
    const showNewElements = !!pendingEdit.newElements && pendingEdit.newElements.length > 0;

    if (isInsertOnly) {
    return (
      <div className="pending-insert-wrapper" ref={pendingEditRef}>
          {/* Unchanged block rendered normally (outside preview container) */}
          {renderStandardBlock()}

          <div className="pending-edit-container pending-insert-container">
            {showNewElements && (
              <div className="pending-edit-new-elements">
                <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                  Adding after this element:
                </div>
                {pendingEdit.newElements && pendingEdit.newElements.map((newEl, idx) => (
                  <div key={idx} className={`script-block script-block--${newEl.type}`} style={{ marginTop: '0.5rem' }}>
                    <div className="block-content-wrapper">
                      <div className="block-type-indicator" style={{ fontSize: '0.75rem', color: '#10b981', marginBottom: '0.25rem' }}>
                        [{ELEMENT_LABELS[newEl.type]}]
                      </div>
                      <div className="block-content" style={{ color: '#10b981', fontWeight: 500 }}>
                        {newEl.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pending-edit-actions">
              <button
                className="edit-action-btn accept"
                onClick={(e) => { e.stopPropagation(); onAcceptEdit?.(); }}
                title="Accept Change"
              >
                <Check size={16} />
              </button>
              <button
                className="edit-action-btn reject"
                onClick={(e) => { e.stopPropagation(); onRejectEdit?.(); }}
                title="Reject Change"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`script-block script-block--${element.type} pending-edit-container`}
        ref={pendingEditRef}
      >
        <div className="pending-edit-comparison">
          {/* Original Content (Red) - only show if content is changing */}
          {showOriginal && (
            <div className="pending-edit-original">
              <div className="block-content-wrapper">
                <div
                  className="block-content"
                  style={{ opacity: 0.7, color: '#ef4444' }}
                >
                  {element.content || '(empty)'}
                </div>
              </div>
            </div>
          )}

          {/* New Content (Green) - only show if content is actually changing */}
          {showNewContent && (
            <div className="pending-edit-new">
              <div className="block-content-wrapper">
                <div className="block-content" style={{ color: '#10b981', fontWeight: 500 }}>
                  {pendingEdit.newContent}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* New Elements (if any) */}
        {showNewElements && pendingEdit.newElements && (
          <div className="pending-edit-new-elements">
            <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem', fontStyle: 'italic' }}>
              Then adding:
            </div>
            {pendingEdit.newElements.map((newEl, idx) => (
              <div key={idx} className={`script-block script-block--${newEl.type}`} style={{ marginTop: '0.5rem' }}>
                <div className="block-content-wrapper">
                  <div className="block-type-indicator" style={{ fontSize: '0.75rem', color: '#10b981', marginBottom: '0.25rem' }}>
                    [{ELEMENT_LABELS[newEl.type]}]
                  </div>
                  <div className="block-content" style={{ color: '#10b981', fontWeight: 500 }}>
                    {newEl.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="pending-edit-actions">
          <button
            className="edit-action-btn accept"
            onClick={(e) => { e.stopPropagation(); onAcceptEdit?.(); }}
            title="Accept Change"
          >
            <Check size={16} />
          </button>
          <button
            className="edit-action-btn reject"
            onClick={(e) => { e.stopPropagation(); onRejectEdit?.(); }}
            title="Reject Change"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return renderStandardBlock();
}

