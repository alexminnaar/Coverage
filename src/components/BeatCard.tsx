import { useState, useRef, useEffect } from 'react';
import { GripVertical, Palette, X, Film } from 'lucide-react';
import { Beat, BEAT_COLORS } from '../types';

interface BeatCardProps {
  beat: Beat;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<Beat>) => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  linkedSceneName?: string;
}

export default function BeatCard({
  beat,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onDragStart,
  onDragEnd,
  linkedSceneName,
}: BeatCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(beat.title);
  const [editDescription, setEditDescription] = useState(beat.description);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    onUpdate({ title: editTitle, description: editDescription });
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setEditTitle(beat.title);
      setEditDescription(beat.description);
      setIsEditing(false);
    }
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isEditing) {
      e.preventDefault();
      setIsEditing(true);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete();
    }
  };

  const handleColorSelect = (color: string) => {
    onUpdate({ color: beat.color === color ? undefined : color });
    setShowColorPicker(false);
  };

  return (
    <div
      className={`beat-card ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`}
      style={{ '--beat-color': beat.color || 'transparent' } as React.CSSProperties}
      onClick={onSelect}
      onDoubleClick={() => setIsEditing(true)}
      onKeyDown={handleCardKeyDown}
      tabIndex={0}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {beat.color && <div className="beat-color-tag" />}
      
      <div className="beat-card-header">
        <div className="beat-drag-handle">
          <GripVertical size={14} />
        </div>
        <div className="beat-actions">
          <button 
            className="beat-action-btn"
            onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
            title="Set color"
          >
            <Palette size={12} />
          </button>
          <button 
            className="beat-action-btn beat-delete-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete beat"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {showColorPicker && (
        <div className="beat-color-picker" onClick={(e) => e.stopPropagation()}>
          {BEAT_COLORS.map((c) => (
            <button
              key={c.value}
              className={`color-swatch ${beat.color === c.value ? 'active' : ''}`}
              style={{ backgroundColor: c.value }}
              onClick={() => handleColorSelect(c.value)}
              title={c.name}
            />
          ))}
          {beat.color && (
            <button
              className="color-swatch clear"
              onClick={() => handleColorSelect('')}
              title="Clear color"
            >
              <X size={10} />
            </button>
          )}
        </div>
      )}

      {isEditing ? (
        <div className="beat-edit-form">
          <input
            ref={titleInputRef}
            type="text"
            className="beat-title-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Beat title..."
          />
          <textarea
            className="beat-description-input"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What happens in this beat?"
            rows={3}
          />
          <div className="beat-edit-actions">
            <button className="beat-cancel-btn" onClick={() => {
              setEditTitle(beat.title);
              setEditDescription(beat.description);
              setIsEditing(false);
            }}>
              Cancel
            </button>
            <button className="beat-save-btn" onClick={handleSave}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="beat-content">
          <h4 className="beat-title">{beat.title || 'Untitled Beat'}</h4>
          {beat.description && (
            <p className="beat-description">{beat.description}</p>
          )}
          {linkedSceneName && (
            <div className="beat-linked-scene" title={linkedSceneName}>
              <Film size={10} />
              <span>{linkedSceneName}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
