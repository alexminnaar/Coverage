import { useMemo } from 'react';
import { X, Users } from 'lucide-react';
import { ScriptElement } from '../types';
import { 
  analyzeCharacterPresence, 
  getSceneHeadings, 
  getCharactersByImportance,
  getMaxDialogueCount,
} from '../utils/characterAnalysis';

interface CharacterTrackerProps {
  isOpen: boolean;
  onClose: () => void;
  elements: ScriptElement[];
  onJumpToScene: (sceneId: string) => void;
}

export default function CharacterTracker({
  isOpen,
  onClose,
  elements,
  onJumpToScene,
}: CharacterTrackerProps) {
  // Analyze character presence
  const characterData = useMemo(() => analyzeCharacterPresence(elements), [elements]);
  const characters = useMemo(() => getCharactersByImportance(characterData), [characterData]);
  const scenes = useMemo(() => getSceneHeadings(elements), [elements]);
  const maxDialogue = useMemo(() => getMaxDialogueCount(characterData), [characterData]);

  const handleCellClick = (sceneId: string) => {
    onJumpToScene(sceneId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="character-tracker-overlay">
      {/* Toolbar */}
      <div className="character-tracker-toolbar">
        <div className="character-tracker-title">
          <Users size={18} />
          Character Tracker
          <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: 8 }}>
            ({characters.length} characters across {scenes.length} scenes)
          </span>
        </div>
        <button className="toolbar-btn" onClick={onClose}>
          <X size={18} />
          <span>Close</span>
        </button>
      </div>

      {/* Content */}
      <div className="character-tracker-content">
        {characters.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
            <Users size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
            <p>No characters found</p>
            <p style={{ fontSize: 13 }}>Add character and dialogue elements to your script</p>
          </div>
        ) : (
          <div className="character-timeline">
            {/* Header row with scene names */}
            <div className="timeline-header">
              <div className="timeline-corner">Character</div>
              <div className="timeline-scene-headers">
                {scenes.map((scene, idx) => (
                  <div 
                    key={scene.id} 
                    className="timeline-scene-header"
                    title={scene.heading}
                    onClick={() => handleCellClick(scene.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {idx + 1}
                  </div>
                ))}
              </div>
            </div>

            {/* Character rows */}
            {characters.map(character => (
              <div key={character.name} className="timeline-row">
                <div className="timeline-character-name">
                  <span 
                    className="character-color-dot" 
                    style={{ backgroundColor: character.color }}
                  />
                  <span>{character.name}</span>
                  <span style={{ 
                    marginLeft: 'auto', 
                    fontSize: 11, 
                    opacity: 0.6 
                  }}>
                    {character.totalDialogues} lines
                  </span>
                </div>
                <div className="timeline-cells">
                  {scenes.map(scene => {
                    const presence = character.presenceByScene.get(scene.id);
                    const intensity = presence 
                      ? Math.min(1, presence.dialogueCount / maxDialogue)
                      : 0;
                    
                    return (
                      <div
                        key={scene.id}
                        className={`timeline-cell ${presence ? 'present' : ''} ${presence && intensity > 0.6 ? 'high' : ''} ${presence?.isFirstAppearance ? 'first-appearance' : ''}`}
                        style={{
                          '--cell-color': presence 
                            ? `rgba(${hexToRgb(character.color)}, ${0.2 + intensity * 0.5})`
                            : 'transparent',
                        } as React.CSSProperties}
                        onClick={() => presence && handleCellClick(scene.id)}
                        title={presence 
                          ? `${character.name}: ${presence.dialogueCount} dialogue${presence.dialogueCount !== 1 ? 's' : ''}${presence.isFirstAppearance ? ' (First Appearance)' : ''}`
                          : `${character.name} not in this scene`
                        }
                      >
                        {presence && (
                          <span className="dialogue-count-badge">
                            {presence.dialogueCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to convert hex color to RGB
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '255, 255, 255';
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

