import { useState, useCallback, useMemo } from 'react';
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
  Sparkles,
} from 'lucide-react';
import { Beat, BeatStructure, BEAT_STRUCTURES, ScriptElement } from '../types';
import BeatColumn from './BeatColumn';
import TemplateSelector from './TemplateSelector';
import BeatAIPanel from './BeatAIPanel';

interface BeatBoardProps {
  beats: Beat[];
  beatStructure: BeatStructure;
  elements: ScriptElement[];
  onBeatsChange: (beats: Beat[]) => void;
  onStructureChange: (structure: BeatStructure) => void;
  onClose: () => void;
}

export default function BeatBoard({
  beats,
  beatStructure,
  elements,
  onBeatsChange,
  onStructureChange,
  onClose,
}: BeatBoardProps) {
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [draggedBeatId, setDraggedBeatId] = useState<string | null>(null);
  const [showStructureMenu, setShowStructureMenu] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);

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

  const handleAddBeatWithSeed = useCallback(
    (actIndex: number, insertAfterOrder?: number, seed?: Partial<Beat>) => {
      const actBeats = beats
        .filter((b) => b.actIndex === actIndex)
        .sort((a, b) => a.order - b.order);

      const targetIndex =
        insertAfterOrder !== undefined
          ? Math.min(Math.max(insertAfterOrder + 1, 0), actBeats.length)
          : actBeats.length;

      const newBeat: Beat = {
        id: uuidv4(),
        title: seed?.title ?? '',
        description: seed?.description ?? '',
        actIndex,
        order: targetIndex,
        linkedSceneId: seed?.linkedSceneId,
        color: seed?.color,
      };

      const nextBeats = [...actBeats];
      nextBeats.splice(targetIndex, 0, newBeat);
      const renumbered = nextBeats.map((b, i) => ({ ...b, order: i }));
      const other = beats.filter((b) => b.actIndex !== actIndex);
      onBeatsChange([...other, ...renumbered]);
      setSelectedBeatId(newBeat.id);
    },
    [beats, onBeatsChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
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

  return (
    <div className="beat-board" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="beat-board-header">
        <button className="beat-back-btn" onClick={onClose}>
          <ArrowLeft size={18} />
          <span>Back to Script</span>
        </button>
        
        <div className="beat-board-title">
          <LayoutGrid size={20} />
          <h2>Beat Board</h2>
          <span className="beat-total-badge">{beats.length} beats</span>
        </div>
        
        <div className="beat-board-actions">
          <button
            className={`beat-ai-btn ${showAIPanel ? 'active' : ''}`}
            onClick={() => setShowAIPanel((prev) => !prev)}
            title="Open Beat AI"
          >
            <Sparkles size={16} />
            <span>Beat AI</span>
          </button>
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

      <div className="beat-board-content">
        <div className="beat-columns">
          {actNames.map((actName, actIndex) => (
            <BeatColumn
              key={actIndex}
              title={actName}
              actIndex={actIndex}
              beats={beatsByAct[actIndex]}
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

      <div className="beat-board-footer">
        <div className="beat-board-hints">
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
      <BeatAIPanel
        isOpen={showAIPanel}
        onClose={() => setShowAIPanel(false)}
        beats={beats}
        actNames={actNames}
        scenes={scenes}
        selectedBeatId={selectedBeatId}
        onUpdateBeat={handleUpdateBeat}
        onAddBeat={handleAddBeatWithSeed}
      />
    </div>
  );
}
