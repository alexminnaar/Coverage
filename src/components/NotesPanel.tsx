import { useState, useCallback, useMemo } from 'react';
import { X, MessageSquare, Plus, Check, Trash2 } from 'lucide-react';
import { ScriptNote, ScriptElement } from '../types';

interface NotesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notes: ScriptNote[];
  elements: ScriptElement[];
  selectedElementId: string | null;
  focusedElementId?: string | null; // Currently focused element in editor
  onAddNote: (note: Omit<ScriptNote, 'id' | 'createdAt'>) => void;
  onUpdateNote: (id: string, updates: Partial<ScriptNote>) => void;
  onDeleteNote: (id: string) => void;
  onJumpToElement: (elementId: string) => void;
}

type FilterMode = 'all' | 'unresolved' | 'resolved';

export default function NotesPanel({
  isOpen,
  onClose,
  notes,
  elements,
  selectedElementId,
  focusedElementId,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onJumpToElement,
}: NotesPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteElementId, setNewNoteElementId] = useState<string | null>(null);

  // Get element info for display
  const getElementInfo = useCallback((elementId: string): string => {
    const element = elements.find(el => el.id === elementId);
    if (!element) return 'Unknown element';
    
    const content = element.content.substring(0, 30);
    return `${element.type}: ${content}${element.content.length > 30 ? '...' : ''}`;
  }, [elements]);

  // Filter notes based on mode
  const filteredNotes = useMemo(() => {
    let filtered = [...notes];
    
    if (filterMode === 'unresolved') {
      filtered = filtered.filter(n => !n.resolved);
    } else if (filterMode === 'resolved') {
      filtered = filtered.filter(n => n.resolved);
    }
    
    // Sort by creation date, newest first
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, filterMode]);

  // Notes for selected element
  const selectedElementNotes = useMemo(() => {
    if (!selectedElementId) return [];
    return notes.filter(n => n.elementId === selectedElementId);
  }, [notes, selectedElementId]);

  // Determine which element the new note will attach to (matches handleAddNote logic)
  const targetElementId = useMemo(() => {
    return newNoteElementId || focusedElementId || selectedElementId || (elements.length > 0 ? elements[0].id : null);
  }, [newNoteElementId, focusedElementId, selectedElementId, elements]);

  const handleAddNote = useCallback(() => {
    if (!newNoteContent.trim()) return;
    
    // Try to find an element to attach to: focused > selected > first element
    // Prioritize focusedElementId over selectedElementId so new notes attach to what you're currently working on
    const elementId = newNoteElementId || focusedElementId || selectedElementId || (elements.length > 0 ? elements[0].id : null);
    if (!elementId) {
      alert('No script elements found. Please add content to your script first.');
      return;
    }

    onAddNote({
      elementId,
      content: newNoteContent.trim(),
    });

    setNewNoteContent('');
    setNewNoteElementId(null);
  }, [newNoteContent, newNoteElementId, selectedElementId, focusedElementId, elements, onAddNote]);

  const handleResolve = useCallback((noteId: string, resolved: boolean) => {
    onUpdateNote(noteId, { resolved });
  }, [onUpdateNote]);

  if (!isOpen) return null;

  return (
    <div className="notes-panel">
      {/* Header */}
      <div className="notes-panel-header">
        <div className="notes-panel-title">
          <MessageSquare size={16} />
          Script Notes
          <span style={{ opacity: 0.6 }}>({notes.length})</span>
        </div>
        <button className="notes-header-btn-minimal" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>

      {/* Filters */}
      <div className="notes-panel-filters">
        <button
          className={`notes-filter-btn ${filterMode === 'all' ? 'active' : ''}`}
          onClick={() => setFilterMode('all')}
        >
          All
        </button>
        <button
          className={`notes-filter-btn ${filterMode === 'unresolved' ? 'active' : ''}`}
          onClick={() => setFilterMode('unresolved')}
        >
          Unresolved
        </button>
        <button
          className={`notes-filter-btn ${filterMode === 'resolved' ? 'active' : ''}`}
          onClick={() => setFilterMode('resolved')}
        >
          Resolved
        </button>
      </div>

      {/* Selected element notes highlight */}
      {selectedElementId && selectedElementNotes.length > 0 && (
        <div className="notes-selected-element-banner">
          <div className="notes-selected-element-label">
            <MessageSquare size={12} />
            Notes for selected element ({selectedElementNotes.length})
          </div>
        </div>
      )}

      {/* Notes list */}
      <div className="notes-list">
        {filteredNotes.length === 0 ? (
          <div className="notes-empty-state">
            <div className="notes-empty-icon">
              <MessageSquare size={40} />
            </div>
            <h3 className="notes-empty-title">No notes yet</h3>
            <p className="notes-empty-description">
              {filterMode === 'unresolved' 
                ? 'All notes are resolved!' 
                : filterMode === 'resolved'
                ? 'No resolved notes yet'
                : 'Add notes to track feedback and ideas'}
            </p>
          </div>
        ) : (
          filteredNotes.map(note => (
            <div 
              key={note.id} 
              className={`note-item ${note.resolved ? 'resolved' : ''}`}
              style={{ borderLeftColor: note.color || 'var(--accent-gold)' }}
            >
              <div className="note-item-header">
                <span 
                  className="note-element-ref"
                  onClick={() => onJumpToElement(note.elementId)}
                  style={{ cursor: 'pointer' }}
                >
                  {getElementInfo(note.elementId)}
                </span>
                <span className="note-date">
                  {new Date(note.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="note-content">
                {note.content}
              </div>
              <div className="note-actions">
                <button
                  className={`note-action-btn resolve`}
                  onClick={() => handleResolve(note.id, !note.resolved)}
                >
                  <Check size={12} />
                  {note.resolved ? 'Unresolve' : 'Resolve'}
                </button>
                <button
                  className="note-action-btn delete"
                  onClick={() => onDeleteNote(note.id)}
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add note form */}
      <div className="add-note-form">
        <div className="add-note-input-wrapper">
          <textarea
            className="add-note-textarea"
            placeholder={targetElementId
              ? "Add a note for the current element..." 
              : "Add a note (will attach to first element if none selected)..."}
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            rows={1}
          />
          {newNoteContent.trim() && (
            <button 
              className="add-note-send-btn"
              onClick={handleAddNote}
              title="Add note"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
        {targetElementId && (
          <div className="add-note-attachment-info">
            <MessageSquare size={11} />
            <span>Attaching to: {getElementInfo(targetElementId)}</span>
          </div>
        )}
        <div className="add-note-actions">
          <button 
            className="btn-secondary"
            onClick={() => setNewNoteContent('')}
            disabled={!newNoteContent}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

