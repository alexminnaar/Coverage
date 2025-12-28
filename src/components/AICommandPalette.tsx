import { useState, useEffect, useRef } from 'react';
import { executeCommand } from '../services/aiClient';
import { ScriptElement } from '../types';

interface AICommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  selectedElement: ScriptElement | null;
  precedingElements: ScriptElement[];
  onApplyResult: (elementId: string, newContent: string) => void;
}

const PRESET_COMMANDS = [
  { label: 'Continue', command: 'Continue writing this naturally', icon: '→' },
  { label: 'Make funnier', command: 'Make this funnier while keeping the meaning', icon: '😄' },
  { label: 'Add subtext', command: 'Add subtext and underlying tension', icon: '💭' },
  { label: 'Make dramatic', command: 'Make this more dramatic and intense', icon: '🎭' },
  { label: 'Shorten', command: 'Shorten this while preserving the key information', icon: '✂️' },
  { label: 'Expand', command: 'Expand this with more detail', icon: '📝' },
  { label: 'More visual', command: 'Make this more visual and cinematic', icon: '🎬' },
  { label: 'Simplify', command: 'Simplify the language, make it more natural', icon: '✨' },
];

export default function AICommandPalette({
  isOpen,
  onClose,
  selectedElement,
  precedingElements,
  onApplyResult,
}: AICommandPaletteProps) {
  const [customCommand, setCustomCommand] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setResult(null);
      setError(null);
      setCustomCommand('');
    }
  }, [isOpen]);

  const runCommand = async (command: string) => {
    if (!selectedElement) return;
    
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await executeCommand({
        command,
        selectedText: selectedElement.content,
        elementType: selectedElement.type,
        context: precedingElements.map(el => ({ type: el.type, content: el.content })),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Command failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetClick = (command: string) => {
    runCommand(command);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customCommand.trim()) {
      runCommand(customCommand);
    }
  };

  const handleApply = () => {
    if (result && selectedElement) {
      onApplyResult(selectedElement.id, result);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="ai-command-overlay" onClick={onClose}>
      <div 
        className="ai-command-palette" 
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="ai-command-header">
          <h3>AI Command</h3>
          <button className="btn btn-xs" onClick={onClose}>×</button>
        </div>

        {!selectedElement && (
          <div className="ai-command-empty">
            <p>Select a block in the script to use AI commands</p>
          </div>
        )}

        {selectedElement && !result && (
          <>
            <div className="ai-command-context">
              <span className="context-type">{selectedElement.type}</span>
              <p className="context-preview">
                {selectedElement.content.slice(0, 100)}
                {selectedElement.content.length > 100 ? '...' : ''}
              </p>
            </div>

            <form onSubmit={handleCustomSubmit} className="ai-command-input">
              <input
                ref={inputRef}
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder="Type a custom command..."
                disabled={isLoading}
              />
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={!customCommand.trim() || isLoading}
              >
                {isLoading ? '...' : 'Run'}
              </button>
            </form>

            <div className="ai-command-presets">
              {PRESET_COMMANDS.map((preset, i) => (
                <button
                  key={i}
                  className="preset-btn"
                  onClick={() => handlePresetClick(preset.command)}
                  disabled={isLoading}
                >
                  <span className="preset-icon">{preset.icon}</span>
                  <span className="preset-label">{preset.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {result && (
          <div className="ai-command-result">
            <div className="result-header">
              <span>Result</span>
              <div className="result-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setResult(null)}>
                  Try Again
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleApply}>
                  Apply
                </button>
              </div>
            </div>
            <div className="result-content">
              <div className="result-original">
                <span className="result-label">Original:</span>
                <p>{selectedElement?.content}</p>
              </div>
              <div className="result-new">
                <span className="result-label">New:</span>
                <p>{result}</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="ai-command-error">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="ai-command-loading">
            <div className="loading-spinner" />
            <span>Running command...</span>
          </div>
        )}
      </div>
    </div>
  );
}

