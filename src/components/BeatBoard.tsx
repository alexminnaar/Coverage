import { useEffect, useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft,
  ChevronDown,
  LayoutGrid,
  Grip,
  ArrowUpDown,
  ArrowLeftRight,
  Keyboard,
  BookOpen,
  FileText,
} from 'lucide-react';
import { Beat, BeatStructure, BEAT_STRUCTURES, ScriptElement } from '../types';
import BeatColumn from './BeatColumn';
import TemplateSelector from './TemplateSelector';

interface BeatBoardProps {
  beats: Beat[];
  beatStructure: BeatStructure;
  elements: ScriptElement[];
  treatment: string;
  onBeatsChange: (beats: Beat[]) => void;
  onTreatmentChange: (treatment: string) => void;
  onStructureChange: (structure: BeatStructure) => void;
  activeView: 'board' | 'treatment';
  onViewChange: (view: 'board' | 'treatment') => void;
  selectedBeatId?: string | null;
  onClose: () => void;
}

export default function BeatBoard({
  beats,
  beatStructure,
  elements,
  treatment,
  onBeatsChange,
  onTreatmentChange,
  onStructureChange,
  activeView,
  onViewChange,
  selectedBeatId: externalSelectedBeatId = null,
  onClose,
}: BeatBoardProps) {
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(externalSelectedBeatId);
  const [draggedBeatId, setDraggedBeatId] = useState<string | null>(null);
  const [showStructureMenu, setShowStructureMenu] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact');

  useEffect(() => {
    setSelectedBeatId(externalSelectedBeatId);
  }, [externalSelectedBeatId]);

  // Handle applying a template
  const handleApplyTemplate = useCallback((templateBeats: Beat[]) => {
    // Confirm before replacing existing beats
    if (beats.length > 0) {
      if (!confirm('This will replace your current beats. Continue?')) {
        return;
      }
    }
    onBeatsChange(templateBeats);
  }, [beats.length, onBeatsChange]);

  const actNames = BEAT_STRUCTURES[beatStructure];

  // Get scene headings for linking
  const scenes = useMemo(() => {
    return elements
      .filter((el) => el.type === 'scene-heading')
      .map((el) => ({
        id: el.id,
        name: el.content || 'Untitled Scene',
      }));
  }, [elements]);

  const getLinkedSceneName = useCallback(
    (sceneId?: string) => {
      if (!sceneId) return undefined;
      const scene = scenes.find((s) => s.id === sceneId);
      return scene?.name;
    },
    [scenes]
  );

  // Group beats by act
  const beatsByAct = useMemo(() => {
    const grouped: Beat[][] = actNames.map(() => []);
    for (const beat of beats) {
      if (beat.actIndex >= 0 && beat.actIndex < actNames.length) {
        grouped[beat.actIndex].push(beat);
      }
    }
    return grouped;
  }, [beats, actNames]);

  const linkedBeatCount = useMemo(
    () => beats.filter((beat) => beat.linkedSceneId).length,
    [beats]
  );
  const treatmentWordCount = useMemo(
    () => treatment.trim() ? treatment.trim().split(/\s+/).length : 0,
    [treatment]
  );

  const beatOffsets = useMemo(() => {
    let offset = 0;
    return beatsByAct.map((actBeats) => {
      const currentOffset = offset;
      offset += actBeats.length;
      return currentOffset;
    });
  }, [beatsByAct]);

  const handleAddBeat = useCallback(
    (actIndex: number) => {
      const actsBeats = beats.filter((b) => b.actIndex === actIndex);
      const maxOrder = actsBeats.length > 0 
        ? Math.max(...actsBeats.map((b) => b.order)) 
        : -1;

      const newBeat: Beat = {
        id: uuidv4(),
        title: '',
        description: '',
        actIndex,
        order: maxOrder + 1,
      };

      onBeatsChange([...beats, newBeat]);
      setSelectedBeatId(newBeat.id);
    },
    [beats, onBeatsChange]
  );

  const handleUpdateBeat = useCallback(
    (id: string, updates: Partial<Beat>) => {
      onBeatsChange(
        beats.map((beat) => (beat.id === id ? { ...beat, ...updates } : beat))
      );
    },
    [beats, onBeatsChange]
  );

  const handleDeleteBeat = useCallback(
    (id: string) => {
      onBeatsChange(beats.filter((beat) => beat.id !== id));
      if (selectedBeatId === id) {
        setSelectedBeatId(null);
      }
    },
    [beats, onBeatsChange, selectedBeatId]
  );

  const handleMoveBeat = useCallback(
    (beatId: string, targetActIndex: number, targetOrder: number) => {
      const beat = beats.find((b) => b.id === beatId);
      if (!beat) return;

      if (beat.actIndex === targetActIndex && beat.order === targetOrder) {
        return;
      }

      const otherBeats = beats.filter((b) => b.id !== beatId);
      
      const targetActBeats = otherBeats
        .filter((b) => b.actIndex === targetActIndex)
        .sort((a, b) => a.order - b.order);

      targetActBeats.splice(targetOrder, 0, {
        ...beat,
        actIndex: targetActIndex,
        order: targetOrder,
      });

      const renumberedTargetBeats = targetActBeats.map((b, i) => ({
        ...b,
        order: i,
      }));

      const otherActBeats = otherBeats.filter(
        (b) => b.actIndex !== targetActIndex
      );

      onBeatsChange([...otherActBeats, ...renumberedTargetBeats]);
    },
    [beats, onBeatsChange]
  );

  const handleStructureChange = (structure: BeatStructure) => {
    onStructureChange(structure);
    setShowStructureMenu(false);
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('.ai-chat')) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        onClose();
        e.stopPropagation();
        return;
      }

      if (!selectedBeatId) return;

      const beat = beats.find((b) => b.id === selectedBeatId);
      if (!beat) return;

      if (e.key === 'ArrowLeft' && beat.actIndex > 0) {
        e.preventDefault();
        handleMoveBeat(beat.id, beat.actIndex - 1, 0);
      }
      if (e.key === 'ArrowRight' && beat.actIndex < actNames.length - 1) {
        e.preventDefault();
        handleMoveBeat(beat.id, beat.actIndex + 1, 0);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newOrder = Math.max(0, beat.order - 1);
        handleMoveBeat(beat.id, beat.actIndex, newOrder);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const actBeats = beats.filter((b) => b.actIndex === beat.actIndex);
        const newOrder = Math.min(actBeats.length - 1, beat.order + 1);
        handleMoveBeat(beat.id, beat.actIndex, newOrder);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteBeat(beat.id);
      }
    },
    [selectedBeatId, beats, actNames, handleMoveBeat, handleDeleteBeat, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className={`beat-board density-${density}`} tabIndex={-1}>
      <div className="beat-board-header">
        <div className="beat-board-heading">
          <button className="beat-back-btn" onClick={onClose}>
            <ArrowLeft size={17} />
            <span>Back to script</span>
          </button>
          <span className="beat-heading-divider" aria-hidden="true" />
          <div className="beat-board-title">
            <span className="beat-title-icon"><LayoutGrid size={17} /></span>
            <div>
              <span className="beat-board-kicker">Story structure</span>
              <h2>Beat Board</h2>
            </div>
          </div>
        </div>
        
        <div className="beat-board-actions">
          <div className="beat-density-toggle" role="group" aria-label="Beat card density">
            <button
              type="button"
              className={density === 'compact' ? 'active' : ''}
              onClick={() => setDensity('compact')}
              aria-pressed={density === 'compact'}
            >
              Compact
            </button>
            <button
              type="button"
              className={density === 'comfortable' ? 'active' : ''}
              onClick={() => setDensity('comfortable')}
              aria-pressed={density === 'comfortable'}
            >
              Expanded
            </button>
          </div>
          <button 
            className="template-btn"
            onClick={() => setShowTemplateSelector(true)}
            title="Apply Story Template"
          >
            <BookOpen size={16} />
            <span>Templates</span>
          </button>
          <div className="structure-dropdown">
            <button
              className={`structure-trigger ${showStructureMenu ? 'active' : ''}`}
              onClick={() => setShowStructureMenu(!showStructureMenu)}
            >
              <span>{beatStructure.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}</span>
              <ChevronDown size={14} />
            </button>
            {showStructureMenu && (
              <div className="structure-menu">
                {Object.keys(BEAT_STRUCTURES).map((key) => (
                  <button
                    key={key}
                    className={key === beatStructure ? 'active' : ''}
                    onClick={() => handleStructureChange(key as BeatStructure)}
                  >
                    {key.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="beat-board-overview">
        <div className="beat-overview-label">
          <span>Story map</span>
          <strong>{beats.length} beats</strong>
        </div>
        <div className="beat-distribution" aria-label="Beat distribution across acts">
          {actNames.map((actName, actIndex) => {
            const count = beatsByAct[actIndex].length;
            const percentage = beats.length ? Math.round((count / beats.length) * 100) : 0;
            return (
              <div
                className={`beat-distribution-segment act-${actIndex + 1}`}
                key={actName}
                style={{ flexGrow: Math.max(count, 1) }}
                title={`${actName}: ${count} beats (${percentage}%)`}
              >
                <span>{actName}</span>
                <strong>{percentage}%</strong>
              </div>
            );
          })}
        </div>
        <span className="beat-linked-summary">
          {linkedBeatCount} of {beats.length} linked to scenes
        </span>
      </div>

      <div className="beat-workspace-tabs" role="tablist" aria-label="Outline views">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'board'}
          className={activeView === 'board' ? 'active' : ''}
          onClick={() => onViewChange('board')}
        >
          <LayoutGrid size={14} />
          Board
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'treatment'}
          className={activeView === 'treatment' ? 'active' : ''}
          onClick={() => onViewChange('treatment')}
        >
          <FileText size={14} />
          Treatment
          {treatmentWordCount > 0 && <span>{treatmentWordCount}</span>}
        </button>
      </div>

      {activeView === 'board' ? (
        <div className="beat-board-content" role="tabpanel">
          <div className="beat-columns">
            {actNames.map((actName, actIndex) => (
              <BeatColumn
                key={actIndex}
                title={actName}
                actIndex={actIndex}
                beats={beatsByAct[actIndex]}
                totalBeats={beats.length}
                beatNumberOffset={beatOffsets[actIndex]}
                selectedBeatId={selectedBeatId}
                onSelectBeat={setSelectedBeatId}
                onUpdateBeat={handleUpdateBeat}
                onDeleteBeat={handleDeleteBeat}
                onAddBeat={() => handleAddBeat(actIndex)}
                onMoveBeat={handleMoveBeat}
                getLinkedSceneName={getLinkedSceneName}
                draggedBeatId={draggedBeatId}
                setDraggedBeatId={setDraggedBeatId}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="treatment-workspace" role="tabpanel">
          <div className="treatment-editor-shell">
            <header>
              <div>
                <span className="treatment-kicker">Story document</span>
                <h3>Treatment</h3>
              </div>
              <div className="treatment-meta">
                <strong>{treatmentWordCount.toLocaleString()}</strong>
                <span>{treatmentWordCount === 1 ? 'word' : 'words'}</span>
              </div>
            </header>
            <p className="treatment-guidance">
              Tell the complete story in prose: characters, major turns, ending, and emotional arc.
            </p>
            <textarea
              value={treatment}
              onChange={(event) => onTreatmentChange(event.target.value)}
              placeholder="Write the treatment here, or ask Coverage in Outline mode to draft one from your beats and screenplay…"
              aria-label="Screenplay treatment"
              spellCheck
            />
            <footer>
              <span>Saved with this screenplay</span>
              <span>Outline AI can read and propose changes to this treatment</span>
            </footer>
          </div>
        </div>
      )}

      <div className="beat-board-footer">
        <div className="beat-board-hints">
          {activeView === 'board' && (
            <>
              <div className="hint-item">
                <ArrowUpDown size={12} />
                <span>Reorder</span>
              </div>
              <div className="hint-item">
                <ArrowLeftRight size={12} />
                <span>Move acts</span>
              </div>
              <div className="hint-item">
                <Grip size={12} />
                <span>Drag & drop</span>
              </div>
            </>
          )}
          <div className="hint-item">
            <Keyboard size={12} />
            <span>Esc to close</span>
          </div>
        </div>
      </div>

      {/* Template Selector Modal */}
      <TemplateSelector
        isOpen={showTemplateSelector}
        onClose={() => setShowTemplateSelector(false)}
        onApplyTemplate={handleApplyTemplate}
      />
    </div>
  );
}
