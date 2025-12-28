import { useState, useEffect, useRef, useMemo } from 'react';
import { ScriptElement } from '../types';

interface Match {
  elementId: string;
  startIndex: number;
  endIndex: number;
}

interface FindReplaceProps {
  isOpen: boolean;
  onClose: () => void;
  elements: ScriptElement[];
  onReplaceAll: (find: string, replace: string, caseSensitive: boolean) => number;
  onFocusElement: (id: string) => void;
}

export default function FindReplace({
  isOpen,
  onClose,
  elements,
  onReplaceAll,
  onFocusElement,
}: FindReplaceProps) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [message, setMessage] = useState('');
  
  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && findInputRef.current) {
      findInputRef.current.focus();
      findInputRef.current.select();
    }
  }, [isOpen]);

  // Find all matches
  const matches = useMemo((): Match[] => {
    if (!findText) return [];
    
    const results: Match[] = [];
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    
    for (const el of elements) {
      let match;
      while ((match = regex.exec(el.content)) !== null) {
        results.push({
          elementId: el.id,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }
    
    return results;
  }, [findText, caseSensitive, elements]);

  // Reset current match when matches change
  useEffect(() => {
    setCurrentMatchIndex(0);
    setMessage('');
  }, [matches.length]);

  // Navigate to current match
  useEffect(() => {
    if (matches.length > 0 && matches[currentMatchIndex]) {
      onFocusElement(matches[currentMatchIndex].elementId);
    }
  }, [currentMatchIndex, matches, onFocusElement]);

  const handlePrevious = () => {
    if (matches.length === 0) return;
    setCurrentMatchIndex(prev => 
      prev <= 0 ? matches.length - 1 : prev - 1
    );
  };

  const handleNext = () => {
    if (matches.length === 0) return;
    setCurrentMatchIndex(prev => 
      prev >= matches.length - 1 ? 0 : prev + 1
    );
  };

  const handleReplaceAll = () => {
    if (!findText) return;
    const count = onReplaceAll(findText, replaceText, caseSensitive);
    setMessage(`Replaced ${count} occurrence${count !== 1 ? 's' : ''}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevious();
      } else {
        handleNext();
      }
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="find-replace-panel">
      <div className="find-replace-header">
        <span>Find & Replace</span>
        <button className="find-replace-close" onClick={onClose}>×</button>
      </div>
      
      <div className="find-replace-row">
        <input
          ref={findInputRef}
          type="text"
          className="find-input"
          placeholder="Find..."
          value={findText}
          onChange={(e) => setFindText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="find-nav">
          <button 
            className="find-nav-btn" 
            onClick={handlePrevious}
            disabled={matches.length === 0}
            title="Previous (Shift+Enter)"
          >
            ↑
          </button>
          <button 
            className="find-nav-btn" 
            onClick={handleNext}
            disabled={matches.length === 0}
            title="Next (Enter)"
          >
            ↓
          </button>
        </div>
        <span className="match-count">
          {findText ? `${matches.length > 0 ? currentMatchIndex + 1 : 0} of ${matches.length}` : ''}
        </span>
      </div>
      
      <div className="find-replace-row">
        <input
          type="text"
          className="find-input"
          placeholder="Replace with..."
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button 
          className="replace-btn"
          onClick={handleReplaceAll}
          disabled={matches.length === 0}
        >
          Replace All
        </button>
      </div>
      
      <div className="find-replace-options">
        <label className="option-label">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Case sensitive
        </label>
        {message && <span className="find-message">{message}</span>}
      </div>
    </div>
  );
}

