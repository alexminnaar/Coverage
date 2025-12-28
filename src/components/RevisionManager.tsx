import { useState } from 'react';
import { Screenplay, Revision, RevisionColor, REVISION_COLORS } from '../types';
import { Plus, Check, X, Clock, FileText, ArrowRight } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface RevisionManagerProps {
  screenplay: Screenplay;
  onClose: () => void;
  onCreateRevision: (revision: Revision) => void;
  onSetActiveRevision: (revisionId: string | null) => void;
  onCompareRevisions: (rev1Id: string, rev2Id: string) => void;
}

export default function RevisionManager({
  screenplay,
  onClose,
  onCreateRevision,
  onSetActiveRevision,
  onCompareRevisions,
}: RevisionManagerProps) {
  const [showNewRevision, setShowNewRevision] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState<RevisionColor>('blue');
  const [compareMode, setCompareMode] = useState(false);
  const [compareFrom, setCompareFrom] = useState<string | null>(null);

  const revisions = screenplay.revisions || [];
  const currentRevisionId = screenplay.currentRevisionId;

  const handleCreateRevision = () => {
    const revision: Revision = {
      id: uuidv4(),
      color: newColor,
      date: Date.now(),
      description: newDescription.trim() || 'New Revision',
    };
    onCreateRevision(revision);
    setShowNewRevision(false);
    setNewDescription('');
    setNewColor('blue');
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getColorHex = (color: RevisionColor) => {
    return REVISION_COLORS.find(c => c.value === color)?.hex || '#ffffff';
  };

  const handleRevisionClick = (revId: string) => {
    if (compareMode) {
      if (compareFrom === null) {
        setCompareFrom(revId);
      } else if (compareFrom !== revId) {
        onCompareRevisions(compareFrom, revId);
        setCompareMode(false);
        setCompareFrom(null);
      }
    } else {
      onSetActiveRevision(revId === currentRevisionId ? null : revId);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content revision-manager-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="revision-header-title">
            <FileText size={20} />
            <h2>Revisions</h2>
            {currentRevisionId && (
              <span 
                className="current-revision-badge"
                style={{ background: getColorHex(revisions.find(r => r.id === currentRevisionId)?.color || 'white') }}
              >
                {revisions.find(r => r.id === currentRevisionId)?.color.toUpperCase()}
              </span>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* New Revision Form */}
          {showNewRevision ? (
            <div className="new-revision-form">
              <div className="form-group">
                <label>Revision Color</label>
                <div className="revision-color-grid">
                  {REVISION_COLORS.map(color => (
                    <button
                      key={color.value}
                      className={`revision-color-btn ${newColor === color.value ? 'active' : ''}`}
                      style={{ background: color.hex }}
                      onClick={() => setNewColor(color.value)}
                      title={color.name}
                    >
                      {newColor === color.value && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="e.g., Studio Notes, Director's Pass"
                  autoFocus
                />
              </div>
              <div className="new-revision-actions">
                <button className="btn btn-secondary" onClick={() => setShowNewRevision(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleCreateRevision}>
                  Create Revision
                </button>
              </div>
            </div>
          ) : (
            <div className="revision-actions-bar">
              <button className="btn btn-primary" onClick={() => setShowNewRevision(true)}>
                <Plus size={16} />
                New Revision
              </button>
              {revisions.length >= 2 && (
                <button 
                  className={`btn ${compareMode ? 'btn-primary' : 'btn-secondary'}`} 
                  onClick={() => {
                    setCompareMode(!compareMode);
                    setCompareFrom(null);
                  }}
                >
                  {compareMode ? 'Cancel Compare' : 'Compare Revisions'}
                </button>
              )}
            </div>
          )}

          {/* Compare Mode Instructions */}
          {compareMode && (
            <div className="compare-instructions">
              <ArrowRight size={16} />
              <span>
                {compareFrom 
                  ? `Select second revision to compare with "${revisions.find(r => r.id === compareFrom)?.description}"`
                  : 'Select the first revision to compare'
                }
              </span>
            </div>
          )}

          {/* Revisions List */}
          <div className="revisions-list">
            <div 
              className={`revision-item ${!currentRevisionId ? 'active' : ''} ${compareMode && !compareFrom ? 'compare-selectable' : ''}`}
              onClick={() => !compareMode && onSetActiveRevision(null)}
            >
              <div className="revision-color-indicator" style={{ background: '#ffffff', border: '1px solid #ddd' }} />
              <div className="revision-info">
                <h4>Original (White)</h4>
                <span className="revision-meta">No active revision</span>
              </div>
              {!currentRevisionId && !compareMode && (
                <span className="revision-active-badge">Active</span>
              )}
            </div>

            {revisions.map(revision => (
              <div 
                key={revision.id}
                className={`revision-item ${currentRevisionId === revision.id ? 'active' : ''} ${compareMode ? 'compare-selectable' : ''} ${compareFrom === revision.id ? 'compare-selected' : ''}`}
                onClick={() => handleRevisionClick(revision.id)}
              >
                <div 
                  className="revision-color-indicator" 
                  style={{ background: getColorHex(revision.color) }}
                />
                <div className="revision-info">
                  <h4>{revision.description}</h4>
                  <span className="revision-meta">
                    <Clock size={12} />
                    {formatDate(revision.date)}
                  </span>
                </div>
                {currentRevisionId === revision.id && !compareMode && (
                  <span className="revision-active-badge">Active</span>
                )}
              </div>
            ))}
          </div>

          {revisions.length === 0 && !showNewRevision && (
            <div className="revisions-empty">
              <p>No revisions yet.</p>
              <p className="hint">Create a revision to start tracking changes with industry-standard color coding.</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span>Changes made while a revision is active will be marked with that revision's color.</span>
        </div>
      </div>
    </div>
  );
}

