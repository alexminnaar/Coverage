import { useState, useEffect } from 'react';
import { checkAIHealth } from '../services/aiClient';

interface AISettingsProps {
  isOpen: boolean;
  onClose: () => void;
  aiEnabled: boolean;
  onToggleAI: (enabled: boolean) => void;
}

export default function AISettings({
  isOpen,
  onClose,
  aiEnabled,
  onToggleAI,
}: AISettingsProps) {
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline' | 'unconfigured'>('checking');

  useEffect(() => {
    if (isOpen) {
      checkServerStatus();
    }
  }, [isOpen]);

  const checkServerStatus = async () => {
    setServerStatus('checking');
    const health = await checkAIHealth();
    if (!health.available) {
      setServerStatus('offline');
    } else if (!health.configured) {
      setServerStatus('unconfigured');
    } else {
      setServerStatus('online');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>AI Settings</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-content">
          <div className="setting-group">
            <div className="setting-row">
              <div className="setting-info">
                <h4>Enable AI Features</h4>
                <p>Turn on inline completion, chat, and commands</p>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => onToggleAI(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          <div className="setting-group">
            <h4>Server Status</h4>
            <div className="server-status">
              <div className={`status-indicator status-${serverStatus}`}>
                {serverStatus === 'checking' && '⏳ Checking...'}
                {serverStatus === 'online' && '✅ Connected'}
                {serverStatus === 'offline' && '❌ Server offline'}
                {serverStatus === 'unconfigured' && '⚠️ API key not configured'}
              </div>
              <button className="btn btn-xs btn-secondary" onClick={checkServerStatus}>
                Refresh
              </button>
            </div>

            {serverStatus === 'offline' && (
              <div className="status-help">
                <p>Start the AI server:</p>
                <code>cd server && npm install && npm run dev</code>
              </div>
            )}

            {serverStatus === 'unconfigured' && (
              <div className="status-help">
                <p>Add your OpenAI API key:</p>
                <ol>
                  <li>Copy <code>server/env.example.txt</code> to <code>server/.env</code></li>
                  <li>Add your <code>OPENAI_API_KEY</code></li>
                  <li>Restart the server</li>
                </ol>
              </div>
            )}
          </div>

          <div className="setting-group">
            <h4>Keyboard Shortcuts</h4>
            <div className="shortcuts-list">
              <div className="shortcut-item">
                <kbd>Tab</kbd>
                <span>Accept inline suggestion</span>
              </div>
              <div className="shortcut-item">
                <kbd>Esc</kbd>
                <span>Dismiss suggestion</span>
              </div>
              <div className="shortcut-item">
                <kbd>⌘K</kbd>
                <span>Open AI command palette</span>
              </div>
              <div className="shortcut-item">
                <kbd>⌘/</kbd>
                <span>Toggle AI chat</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

