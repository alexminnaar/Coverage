interface KeyboardHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: ['⌘/Ctrl', 'Z'], description: 'Undo' },
  { keys: ['⌘/Ctrl', 'Shift', 'Z'], description: 'Redo' },
  { keys: ['⌘/Ctrl', 'F'], description: 'Find & Replace' },
  { keys: ['F11'], description: 'Toggle distraction-free mode' },
  { keys: ['Tab'], description: 'Cycle element type (Action → Character → Dialogue → Parenthetical)' },
  { keys: ['Enter'], description: 'Create new element below' },
  { keys: ['Shift', 'Enter'], description: 'Line break within element' },
  { keys: ['Backspace'], description: 'Delete empty element' },
  { keys: ['↑'], description: 'Move to previous element (when at start)' },
  { keys: ['↓'], description: 'Move to next element (when at end)' },
];

const autoFormats = [
  { trigger: 'INT. or EXT.', result: 'Automatically converts to Scene Heading' },
  { trigger: 'CUT TO: or FADE IN:', result: 'Automatically converts to Transition' },
];

export default function KeyboardHelp({ isOpen, onClose }: KeyboardHelpProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <section className="shortcut-section">
            <h3>Navigation & Editing</h3>
            <div className="shortcut-list">
              {shortcuts.map((shortcut, idx) => (
                <div key={idx} className="shortcut-item">
                  <div className="shortcut-keys">
                    {shortcut.keys.map((key, i) => (
                      <span key={i}>
                        <kbd>{key}</kbd>
                        {i < shortcut.keys.length - 1 && <span className="key-plus">+</span>}
                      </span>
                    ))}
                  </div>
                  <span className="shortcut-desc">{shortcut.description}</span>
                </div>
              ))}
            </div>
          </section>
          
          <section className="shortcut-section">
            <h3>Auto-Formatting</h3>
            <div className="shortcut-list">
              {autoFormats.map((format, idx) => (
                <div key={idx} className="shortcut-item">
                  <code className="auto-trigger">{format.trigger}</code>
                  <span className="shortcut-desc">{format.result}</span>
                </div>
              ))}
            </div>
          </section>
          
          <section className="shortcut-section">
            <h3>Element Types</h3>
            <div className="element-types-grid">
              <div className="element-type">
                <span className="type-badge type-scene">Scene Heading</span>
                <p>INT./EXT. LOCATION - DAY/NIGHT</p>
              </div>
              <div className="element-type">
                <span className="type-badge type-action">Action</span>
                <p>Describe what happens on screen</p>
              </div>
              <div className="element-type">
                <span className="type-badge type-character">Character</span>
                <p>Character name before dialogue</p>
              </div>
              <div className="element-type">
                <span className="type-badge type-dialogue">Dialogue</span>
                <p>What the character says</p>
              </div>
              <div className="element-type">
                <span className="type-badge type-paren">Parenthetical</span>
                <p>(emotion or action)</p>
              </div>
              <div className="element-type">
                <span className="type-badge type-transition">Transition</span>
                <p>CUT TO:, FADE OUT., etc.</p>
              </div>
            </div>
          </section>
        </div>
        
        <div className="modal-footer">
          <p>Press <kbd>?</kbd> to toggle this help</p>
        </div>
      </div>
    </div>
  );
}

