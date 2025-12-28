import { useState } from 'react';
import { Screenplay, ScriptSnapshot } from '../types';
import { Clock, Plus, RotateCcw, Trash2, Edit2, Check, X, History, Archive } from 'lucide-react';

interface SnapshotsPanelProps {
  screenplay: Screenplay;
  onClose: () => void;
  onCreateSnapshot: (name: string) => void;
  onRestoreSnapshot: (snapshotId: string) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
  onRenameSnapshot: (snapshotId: string, newName: string) => void;
}

export default function SnapshotsPanel({
  screenplay,
  onClose,
  onCreateSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onRenameSnapshot,
}: SnapshotsPanelProps) {
  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const snapshots = screenplay.snapshots || [];

  const handleCreateSnapshot = () => {
    const name = newSnapshotName.trim() || `Snapshot ${new Date().toLocaleDateString()}`;
    onCreateSnapshot(name);
    setNewSnapshotName('');
  };

  const handleStartEdit = (snapshot: ScriptSnapshot) => {
    setEditingId(snapshot.id);
    setEditingName(snapshot.name);
  };

  const handleSaveEdit = () => {
    if (editingId && editingName.trim()) {
      onRenameSnapshot(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleRestore = (snapshotId: string) => {
    onRestoreSnapshot(snapshotId);
    setConfirmRestore(null);
  };

  const handleDelete = (snapshotId: string) => {
    onDeleteSnapshot(snapshotId);
    setConfirmDelete(null);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getElementCount = (snapshot: ScriptSnapshot) => {
    return snapshot.elements.length;
  };

  const getSceneCount = (snapshot: ScriptSnapshot) => {
    return snapshot.elements.filter(e => e.type === 'scene-heading').length;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content snapshots-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="snapshots-header-title">
            <History size={20} />
            <h2>Script Snapshots</h2>
            <span className="snapshot-count-badge">{snapshots.length}</span>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* Create New Snapshot */}
          <div className="snapshot-create-section">
            <div className="snapshot-create-input">
              <input
                type="text"
                placeholder="Snapshot name (optional)"
                value={newSnapshotName}
                onChange={(e) => setNewSnapshotName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateSnapshot()}
              />
              <button className="btn btn-primary snapshot-create-btn" onClick={handleCreateSnapshot}>
                <Plus size={16} />
                Create Snapshot
              </button>
            </div>
            <p className="snapshot-create-hint">
              Save a copy of your current script. You can restore it at any time.
            </p>
          </div>

          {/* Snapshots List */}
          <div className="snapshots-list">
            {snapshots.length === 0 ? (
              <div className="snapshots-empty">
                <Archive size={48} />
                <h3>No Snapshots Yet</h3>
                <p>Create a snapshot to save a version of your script that you can restore later.</p>
              </div>
            ) : (
              snapshots.map((snapshot) => (
                <div key={snapshot.id} className="snapshot-item">
                  {confirmRestore === snapshot.id ? (
                    <div className="snapshot-confirm">
                      <p>Restore this snapshot? Your current script will be backed up automatically.</p>
                      <div className="snapshot-confirm-actions">
                        <button className="btn btn-secondary" onClick={() => setConfirmRestore(null)}>
                          Cancel
                        </button>
                        <button className="btn btn-primary" onClick={() => handleRestore(snapshot.id)}>
                          Restore
                        </button>
                      </div>
                    </div>
                  ) : confirmDelete === snapshot.id ? (
                    <div className="snapshot-confirm snapshot-confirm-delete">
                      <p>Delete this snapshot? This cannot be undone.</p>
                      <div className="snapshot-confirm-actions">
                        <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
                          Cancel
                        </button>
                        <button className="btn btn-danger" onClick={() => handleDelete(snapshot.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="snapshot-info">
                        {editingId === snapshot.id ? (
                          <div className="snapshot-edit-name">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              autoFocus
                            />
                            <button className="btn-icon-sm" onClick={handleSaveEdit}>
                              <Check size={14} />
                            </button>
                            <button className="btn-icon-sm" onClick={handleCancelEdit}>
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <h4 className="snapshot-name">{snapshot.name}</h4>
                        )}
                        <div className="snapshot-meta">
                          <span className="snapshot-date">
                            <Clock size={12} />
                            {formatDate(snapshot.createdAt)}
                          </span>
                          <span className="snapshot-stats">
                            {getSceneCount(snapshot)} scenes • {getElementCount(snapshot)} elements
                          </span>
                        </div>
                        <div className="snapshot-details">
                          <span className="snapshot-title">"{snapshot.title}"</span>
                          {snapshot.author && <span className="snapshot-author">by {snapshot.author}</span>}
                        </div>
                      </div>
                      <div className="snapshot-actions">
                        <button
                          className="snapshot-action-btn"
                          onClick={() => handleStartEdit(snapshot)}
                          title="Rename"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="snapshot-action-btn snapshot-restore-btn"
                          onClick={() => setConfirmRestore(snapshot.id)}
                          title="Restore"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          className="snapshot-action-btn snapshot-delete-btn"
                          onClick={() => setConfirmDelete(snapshot.id)}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span>Snapshots are stored locally • Maximum 20 snapshots</span>
        </div>
      </div>
    </div>
  );
}

