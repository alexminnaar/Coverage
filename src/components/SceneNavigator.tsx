import { useMemo, useRef, useState } from 'react';
import { Beat, BeatStructure, BEAT_STRUCTURES, ScriptElement } from '../types';

interface Scene {
  id: string;
  number: number;
  heading: string;
  synopsis: string;
  notes: string;
}

interface Character {
  name: string;
  lineCount: number;
}

interface SceneNavigatorProps {
  scenes: Scene[];
  characters: Character[];
  elements: ScriptElement[];
  beats: Beat[];
  beatStructure: BeatStructure;
  onOpenBeatBoard: (beatId?: string) => void;
  onSceneClick: (id: string) => void;
  onSynopsisChange: (id: string, synopsis: string) => void;
  onNotesChange: (id: string, notes: string) => void;
  onReorderElements: (elements: ScriptElement[]) => void;
}

type TabType = 'scenes' | 'characters' | 'beats';

export default function SceneNavigator({ 
  scenes, 
  characters, 
  elements,
  beats,
  beatStructure,
  onOpenBeatBoard,
  onSceneClick,
  onSynopsisChange,
  onNotesChange,
  onReorderElements,
}: SceneNavigatorProps) {
  const [activeTab, setActiveTab] = useState<TabType>('scenes');
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);
  const [dragOverSceneId, setDragOverSceneId] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const actNames = useMemo(() => {
    return BEAT_STRUCTURES[beatStructure] ?? BEAT_STRUCTURES['three-act'];
  }, [beatStructure]);

  const beatsByAct = useMemo(() => {
    const grouped: Beat[][] = actNames.map(() => []);
    for (const beat of beats) {
      if (beat.actIndex >= 0 && beat.actIndex < actNames.length) {
        grouped[beat.actIndex].push(beat);
      }
    }
    for (const g of grouped) g.sort((a, b) => a.order - b.order);
    return grouped;
  }, [beats, actNames]);

  const toggleNotes = (sceneId: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return next;
    });
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, sceneId: string) => {
    setDraggedSceneId(sceneId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sceneId);
    // Add a slight delay for visual feedback
    setTimeout(() => {
      (e.target as HTMLElement).classList.add('dragging');
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove('dragging');
    setDraggedSceneId(null);
    setDragOverSceneId(null);
    dragCounter.current = 0;
  };

  const handleDragEnter = (e: React.DragEvent, sceneId: string) => {
    e.preventDefault();
    dragCounter.current++;
    if (sceneId !== draggedSceneId) {
      setDragOverSceneId(sceneId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverSceneId(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetSceneId: string) => {
    e.preventDefault();
    setDragOverSceneId(null);
    dragCounter.current = 0;
    
    if (!draggedSceneId || draggedSceneId === targetSceneId) return;

    // Find the indices of the dragged and target scenes in the elements array
    const draggedIndex = elements.findIndex(el => el.id === draggedSceneId);
    const targetIndex = elements.findIndex(el => el.id === targetSceneId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;

    // Find the range of elements to move (from scene heading to next scene heading or end)
    const findSceneRange = (startIndex: number): [number, number] => {
      let endIndex = startIndex + 1;
      while (endIndex < elements.length && elements[endIndex].type !== 'scene-heading') {
        endIndex++;
      }
      return [startIndex, endIndex];
    };

    const [dragStart, dragEnd] = findSceneRange(draggedIndex);
    const elementsToMove = elements.slice(dragStart, dragEnd);
    
    // Remove the dragged elements
    const withoutDragged = [
      ...elements.slice(0, dragStart),
      ...elements.slice(dragEnd)
    ];
    
    // Find where to insert (after the target scene's block)
    let newTargetIndex = withoutDragged.findIndex(el => el.id === targetSceneId);
    if (newTargetIndex === -1) return;
    
    // If dragging down, insert after target scene block
    // If dragging up, insert before target scene
    if (draggedIndex > targetIndex) {
      // Dragging up - insert before target
      const reordered = [
        ...withoutDragged.slice(0, newTargetIndex),
        ...elementsToMove,
        ...withoutDragged.slice(newTargetIndex)
      ];
      onReorderElements(reordered);
    } else {
      // Dragging down - insert after target scene block
      const [, targetEnd] = findSceneRange(newTargetIndex);
      const adjustedEnd = Math.min(targetEnd, withoutDragged.length);
      const reordered = [
        ...withoutDragged.slice(0, adjustedEnd),
        ...elementsToMove,
        ...withoutDragged.slice(adjustedEnd)
      ];
      onReorderElements(reordered);
    }
  };

  const hasLinkedScene = (sceneId?: string) => {
    if (!sceneId) return false;
    return elements.some((el) => el.id === sceneId && el.type === 'scene-heading');
  };

  return (
    <aside className="scene-navigator">
      <div className="navigator-tabs">
        <button
          className={`nav-tab ${activeTab === 'scenes' ? 'active' : ''}`}
          onClick={() => setActiveTab('scenes')}
        >
          Scenes
          <span className="tab-count">{scenes.length}</span>
        </button>
        <button
          className={`nav-tab ${activeTab === 'characters' ? 'active' : ''}`}
          onClick={() => setActiveTab('characters')}
        >
          Cast
          <span className="tab-count">{characters.length}</span>
        </button>
        <button
          className={`nav-tab ${activeTab === 'beats' ? 'active' : ''}`}
          onClick={() => setActiveTab('beats')}
        >
          Beats
          <span className="tab-count">{beats.length}</span>
        </button>
      </div>
      
      <div className="navigator-content">
        {activeTab === 'scenes' && (
          <div className="scene-list">
            {scenes.length === 0 ? (
              <div className="no-items">
                <p>No scenes yet.</p>
                <p className="hint">Start with INT. or EXT. to create a scene heading.</p>
              </div>
            ) : (
              scenes.map((scene) => {
                const isExpanded = expandedNotes.has(scene.id);
                return (
                <div key={scene.id} className="scene-item-wrapper">
                  <div
                    className={`scene-item ${dragOverSceneId === scene.id ? 'drag-over' : ''} ${draggedSceneId === scene.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, scene.id)}
                    onDragEnd={handleDragEnd}
                    onDragEnter={(e) => handleDragEnter(e, scene.id)}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, scene.id)}
                  >
                    <div className="scene-drag-handle">⋮⋮</div>
                    <button
                      className="scene-content"
                      onClick={() => onSceneClick(scene.id)}
                    >
                      <span className="scene-number">{scene.number}</span>
                      <span className="scene-heading">{scene.heading.toUpperCase()}</span>
                    </button>
                    <button 
                        className={`scene-notes-toggle ${scene.notes || scene.synopsis ? 'has-notes' : ''}`}
                      onClick={() => toggleNotes(scene.id)}
                        title={isExpanded ? 'Hide details' : 'Show details'}
                    >
                      📝
                    </button>
                  </div>
                    {isExpanded && (
                      <div className="scene-details-panel">
                        <div className="scene-synopsis-section">
                          <label className="scene-detail-label">Synopsis</label>
                          <textarea
                            className="scene-synopsis-input"
                            placeholder="What happens in this scene?"
                            value={scene.synopsis}
                            onChange={(e) => onSynopsisChange(scene.id, e.target.value)}
                            rows={2}
                          />
                        </div>
                        <div className="scene-notes-section">
                          <label className="scene-detail-label">Notes</label>
                      <textarea
                        className="scene-notes-input"
                        placeholder="Add notes for this scene..."
                        value={scene.notes}
                        onChange={(e) => onNotesChange(scene.id, e.target.value)}
                            rows={2}
                      />
                    </div>
          </div>
        )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'characters' && (
          <div className="character-list">
            {characters.length === 0 ? (
              <div className="no-items">
                <p>No characters yet.</p>
                <p className="hint">Add character elements to see them listed here.</p>
              </div>
            ) : (
              characters.map((character) => (
                <div key={character.name} className="character-item">
                  <span className="character-name">{character.name.toUpperCase()}</span>
                  <span className="character-lines">{character.lineCount} {character.lineCount === 1 ? 'line' : 'lines'}</span>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'beats' && (
          <div className="beat-list">
            {beats.length === 0 ? (
              <div className="no-items">
                <p>No beats yet.</p>
                <p className="hint">Open Beat Board to add beats.</p>
                <button className="beat-open-board-btn" onClick={() => onOpenBeatBoard()}>
                  Open Beat Board
                </button>
              </div>
            ) : (
              actNames.map((actName, actIndex) => {
                const actBeats = beatsByAct[actIndex] ?? [];
                return (
                  <div key={actIndex} className="beat-act">
                    <div className="beat-act-header">
                      <span className="beat-act-title">{actName}</span>
                      <span className="beat-act-count">{actBeats.length}</span>
                    </div>

                    {actBeats.length === 0 ? (
                      <div className="beat-act-empty">No beats in this act</div>
                    ) : (
                      <div className="beat-act-items">
                        {actBeats.map((beat) => {
                          const linkedOk = hasLinkedScene(beat.linkedSceneId);
                          const handleClick = () => {
                            if (linkedOk && beat.linkedSceneId) {
                              onSceneClick(beat.linkedSceneId);
                              return;
                            }
                            onOpenBeatBoard(beat.id);
                          };

                          return (
                            <button
                              key={beat.id}
                              className={`beat-item ${linkedOk ? 'linked' : ''}`}
                              onClick={handleClick}
                              title={beat.description || undefined}
                              type="button"
                            >
                              {beat.color ? (
                                <span className="beat-color-dot" style={{ backgroundColor: beat.color }} />
                              ) : (
                                <span className="beat-color-dot empty" />
                              )}
                              <span className="beat-title-text">{beat.title || 'Untitled Beat'}</span>
                              {linkedOk && <span className="beat-linked-indicator">Scene</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
      
      <div className="navigator-footer">
        <div className="keyboard-hint">
          <span className="key">⌘Z</span>
          <span className="hint-text">Undo</span>
        </div>
        <div className="keyboard-hint">
          <span className="key">⌘F</span>
          <span className="hint-text">Find</span>
        </div>
        <div className="keyboard-hint">
          <span className="key">?</span>
          <span className="hint-text">Help</span>
        </div>
      </div>
    </aside>
  );
}
