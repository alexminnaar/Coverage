import { useState, useCallback } from 'react';
import { X, BookOpen, Check } from 'lucide-react';
import { STORY_TEMPLATES, StoryTemplate } from '../data/storyTemplates';
import { Beat } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface TemplateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTemplate: (beats: Beat[]) => void;
}

export default function TemplateSelector({
  isOpen,
  onClose,
  onApplyTemplate,
}: TemplateSelectorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<StoryTemplate | null>(null);

  const handleApply = useCallback(() => {
    if (!selectedTemplate) return;

    // Convert template beats to Beat objects
    const actsCount = 3; // Default to 3-act structure for beat board
    const beatsPerAct = Math.ceil(selectedTemplate.beats.length / actsCount);

    const beats: Beat[] = selectedTemplate.beats.map((beat, index) => ({
      id: uuidv4(),
      title: beat.name,
      description: beat.description,
      actIndex: Math.min(Math.floor(index / beatsPerAct), actsCount - 1),
      order: index % beatsPerAct,
    }));

    onApplyTemplate(beats);
    onClose();
  }, [selectedTemplate, onApplyTemplate, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal template-selector-modal" 
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>
            <BookOpen size={20} />
            Story Structure Templates
          </h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* Template Grid */}
          <div className="template-grid">
            {STORY_TEMPLATES.map(template => (
              <div
                key={template.id}
                className={`template-card ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
                onClick={() => setSelectedTemplate(template)}
              >
                {selectedTemplate?.id === template.id && (
                  <div className="template-check">
                    <Check size={16} />
                  </div>
                )}
                <div className="template-card-title">{template.name}</div>
                <div className="template-card-description">{template.description}</div>
                <div className="template-card-beats">{template.beats.length} beats • {template.source}</div>
              </div>
            ))}
          </div>

          {/* Selected Template Preview */}
          {selectedTemplate && (
            <div className="template-preview">
              <div className="template-preview-title">
                {selectedTemplate.name} Structure
              </div>
              <div className="template-beat-list">
                {selectedTemplate.beats.map((beat, index) => (
                  <div key={index} className="template-beat-item">
                    <span className="beat-number">{index + 1}</span>
                    <div className="beat-info">
                      <div className="beat-name">{beat.name}</div>
                      <div className="beat-description">{beat.description}</div>
                    </div>
                    <div className="beat-pages">
                      {beat.pageRange[0]}% - {beat.pageRange[1]}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="btn-primary" 
            onClick={handleApply}
            disabled={!selectedTemplate}
          >
            Apply to Beat Board
          </button>
        </div>
      </div>
    </div>
  );
}

