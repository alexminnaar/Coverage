import { useState, useMemo, useCallback } from 'react';
import { X, GitCompare, ChevronUp, ChevronDown, Edit2, Check, Users } from 'lucide-react';
import { Screenplay, ScriptSnapshot, ScriptElement } from '../types';
import { computeDiff } from '../utils/diffEngine';
import { getSceneHeadings, analyzeCharacterPresence, getCharactersByImportance } from '../utils/characterAnalysis';

interface SceneCompareProps {
  isOpen: boolean;
  onClose: () => void;
  currentScreenplay: Screenplay;
  snapshots: ScriptSnapshot[];
  onRenameSnapshot?: (snapshotId: string, newName: string) => void;
  onJumpToScene?: (sceneId: string) => void;
}

export default function SceneCompare({
  isOpen,
  onClose,
  currentScreenplay,
  snapshots,
  onRenameSnapshot,
  onJumpToScene,
}: SceneCompareProps) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    snapshots.length > 0 ? snapshots[0].id : null
  );
  const [currentDiffIndex, setCurrentDiffIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'snapshot' | 'scenes' | 'cast'>('snapshot');
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Format elements for display (better screenplay formatting)
  const formatElements = useCallback((elements: ScriptElement[]): string => {
    return elements
      .filter(el => !el.isDeleted)
      .map(el => {
        const content = el.content.trim();
        if (!content) return '';
        
        switch (el.type) {
          case 'scene-heading':
            return content.toUpperCase();
          case 'character':
            return content.toUpperCase();
          case 'dialogue':
            return content;
          case 'parenthetical':
            return `(${content})`;
          case 'action':
            return content;
          case 'transition':
            return content.toUpperCase();
          default:
            return content;
        }
      })
      .filter(line => line.length > 0)
      .join('\n');
  }, []);

  // Get current and snapshot content
  const currentContent = useMemo(() => {
    return formatElements(currentScreenplay.elements);
  }, [currentScreenplay.elements, formatElements]);

  const snapshotContent = useMemo(() => {
    const snapshot = snapshots.find(s => s.id === selectedSnapshotId);
    if (!snapshot) return '';
    return formatElements(snapshot.elements);
  }, [snapshots, selectedSnapshotId, formatElements]);

  // Compute diff
  const diff = useMemo(() => {
    return computeDiff(snapshotContent, currentContent);
  }, [snapshotContent, currentContent]);

  // Get indices of changes for navigation
  const changeIndices = useMemo(() => {
    return diff.lines
      .map((line, idx) => ({ line, idx }))
      .filter(({ line }) => line.type !== 'unchanged')
      .map(({ idx }) => idx);
  }, [diff.lines]);

  // Navigate to next/previous change
  const goToNextChange = useCallback(() => {
    if (changeIndices.length === 0) return;
    setCurrentDiffIndex(prev => 
      prev < changeIndices.length - 1 ? prev + 1 : 0
    );
  }, [changeIndices]);

  const goToPreviousChange = useCallback(() => {
    if (changeIndices.length === 0) return;
    setCurrentDiffIndex(prev => 
      prev > 0 ? prev - 1 : changeIndices.length - 1
    );
  }, [changeIndices]);

  const selectedSnapshot = snapshots.find(s => s.id === selectedSnapshotId);

  // Get scene count for a snapshot
  // const getSceneCount = useCallback((snapshot: ScriptSnapshot) => {
  //   return snapshot.elements.filter(el => el.type === 'scene-heading').length;
  // }, []);

  // Extract scenes from both versions
  const currentScenes = useMemo(() => getSceneHeadings(currentScreenplay.elements), [currentScreenplay.elements]);
  const snapshotScenes = useMemo(() => {
    if (!selectedSnapshot) return [];
    return getSceneHeadings(selectedSnapshot.elements);
  }, [selectedSnapshot]);

  // Extract characters from both versions
  const currentCharacters = useMemo(() => {
    const charData = analyzeCharacterPresence(currentScreenplay.elements);
    return getCharactersByImportance(charData);
  }, [currentScreenplay.elements]);

  const snapshotCharacters = useMemo(() => {
    if (!selectedSnapshot) return [];
    const charData = analyzeCharacterPresence(selectedSnapshot.elements);
    return getCharactersByImportance(charData);
  }, [selectedSnapshot]);


  // Helper to find scene in diff and navigate to it
  const handleSceneClick = useCallback((sceneId: string) => {
    if (!onJumpToScene) return;
    
    // Find the scene heading element
    const sceneElement = currentScreenplay.elements.find(el => el.id === sceneId);
    if (!sceneElement) return;

    // Try to find the scene in the diff and highlight it
    const sceneHeadingText = sceneElement.content.toUpperCase();
    const lineIndex = diff.lines.findIndex(line => 
      line.content.includes(sceneHeadingText) || 
      line.content === sceneHeadingText
    );

    if (lineIndex >= 0) {
      // Find the change index for this line
      const changeIdx = changeIndices.findIndex(idx => idx === lineIndex);
      if (changeIdx >= 0) {
        setCurrentDiffIndex(changeIdx);
      }
    }

    // Jump to the scene in the main editor
    onJumpToScene(sceneId);
  }, [onJumpToScene, currentScreenplay.elements, diff, changeIndices]);

  // Handle snapshot rename
  const handleStartEdit = useCallback((snapshot: ScriptSnapshot) => {
    setEditingSnapshotId(snapshot.id);
    setEditingName(snapshot.name);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingSnapshotId && editingName.trim() && onRenameSnapshot) {
      onRenameSnapshot(editingSnapshotId, editingName.trim());
    }
    setEditingSnapshotId(null);
    setEditingName('');
  }, [editingSnapshotId, editingName, onRenameSnapshot]);

  const handleCancelEdit = useCallback(() => {
    setEditingSnapshotId(null);
    setEditingName('');
  }, []);

  if (!isOpen) return null;

  const totalScenes = currentScenes.length;
  const totalCharacters = currentCharacters.length;

  return (
    <div className="scene-compare-overlay">
      {/* Toolbar */}
      <div className="scene-compare-toolbar">
        <div className="scene-compare-title">
          <GitCompare size={18} />
          Script Comparison
        </div>

        <div className="scene-compare-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
              {currentScreenplay.title || 'Untitled Screenplay'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {diff.similarity}% similar
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              by {currentScreenplay.author || 'Anonymous'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="diff-stat additions">+{diff.additions}</span>
          <span className="diff-stat deletions">-{diff.deletions}</span>

          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button 
              className="toolbar-btn-sm"
              onClick={goToPreviousChange}
              disabled={changeIndices.length === 0}
              title="Previous change"
            >
              <ChevronUp size={16} />
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 8px' }}>
              {changeIndices.length > 0 
                ? `${currentDiffIndex + 1}/${changeIndices.length}` 
                : 'No changes'}
            </span>
            <button 
              className="toolbar-btn-sm"
              onClick={goToNextChange}
              disabled={changeIndices.length === 0}
              title="Next change"
            >
              <ChevronDown size={16} />
            </button>
          </div>
          </div>

        </div>

        <button className="toolbar-btn" onClick={onClose}>
          <X size={18} />
          <span>Close</span>
        </button>
      </div>

      {/* Content */}
      <div className="scene-compare-content-wrapper">
        {/* Left Sidebar */}
        <div className="scene-compare-sidebar">
          <div className="scene-compare-sidebar-tabs">
            <button
              className={`scene-compare-tab ${activeTab === 'snapshot' ? 'active' : ''}`}
              onClick={() => setActiveTab('snapshot')}
            >
              Snapshot
            </button>
            <button
              className={`scene-compare-tab ${activeTab === 'scenes' ? 'active' : ''}`}
              onClick={() => setActiveTab('scenes')}
            >
              SCENES {totalScenes > 0 && <span className="tab-count">{totalScenes}</span>}
            </button>
            <button
              className={`scene-compare-tab ${activeTab === 'cast' ? 'active' : ''}`}
              onClick={() => setActiveTab('cast')}
            >
              CAST {totalCharacters > 0 && <span className="tab-count">{totalCharacters}</span>}
            </button>
          </div>

          {activeTab === 'snapshot' && (
            <div className="scene-compare-snapshots-list">
              {snapshots.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No snapshots available
                </div>
              ) : (
                snapshots.map((snapshot) => {
                  const isSelected = snapshot.id === selectedSnapshotId;
                  const isEditing = editingSnapshotId === snapshot.id;
                  // const sceneCount = getSceneCount(snapshot);

                  return (
                    <div
                      key={snapshot.id}
                      className={`scene-compare-snapshot-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => !isEditing && setSelectedSnapshotId(snapshot.id)}
                    >
                      {isEditing ? (
                        <div className="scene-compare-snapshot-edit">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              flex: 1,
                              padding: '4px 8px',
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-color)',
                              borderRadius: 4,
                              color: 'var(--text-primary)',
                              fontSize: 13,
                            }}
                          />
                          <button
                            className="btn-icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveEdit();
                            }}
                            style={{ marginLeft: 4 }}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="btn-icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelEdit();
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="scene-compare-snapshot-name">
                            {snapshot.name}
                          </div>
                          {onRenameSnapshot && (
                            <button
                              className="scene-compare-snapshot-edit-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEdit(snapshot);
                              }}
                              title="Rename snapshot"
                            >
                              <Edit2 size={12} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'scenes' && (
            <div className="scene-compare-tab-content">
              {currentScenes.length === 0 && snapshotScenes.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No scenes found
                </div>
              ) : (
                <div className="scene-compare-scenes-list">
                  {/* Create unified scene list */}
                  {(() => {
                    const allSceneIds = new Set([
                      ...currentScenes.map(s => s.id),
                      ...snapshotScenes.map(s => s.id)
                    ]);
                    
                    const unifiedScenes = Array.from(allSceneIds).map(sceneId => {
                      const currentScene = currentScenes.find(s => s.id === sceneId);
                      const snapshotScene = snapshotScenes.find(s => s.id === sceneId);
                      
                      return {
                        id: sceneId,
                        current: currentScene,
                        snapshot: snapshotScene,
                        status: currentScene && snapshotScene ? 'both' : 
                                currentScene ? 'current-only' : 'snapshot-only'
                      };
                    });

                    return unifiedScenes.map(({ id, current, snapshot, status }) => {
                      const scene = current || snapshot;
                      if (!scene) return null;

                      const canNavigate = current && onJumpToScene;

                      return (
                        <div
                          key={id}
                          className={`scene-compare-scene-item scene-compare-scene-${status} ${canNavigate ? 'clickable' : ''}`}
                          onClick={() => canNavigate && handleSceneClick(id)}
                          style={{ cursor: canNavigate ? 'pointer' : 'default' }}
                        >
                          <div className="scene-compare-scene-number">
                            {current ? currentScenes.findIndex(s => s.id === id) + 1 : '—'}
                          </div>
                          <div className="scene-compare-scene-content">
                            <div className="scene-compare-scene-heading">
                              {scene.heading || 'UNTITLED'}
                            </div>
                            <div className="scene-compare-scene-status">
                              {status === 'both' && <span className="status-badge both">Both</span>}
                              {status === 'current-only' && <span className="status-badge added">Added</span>}
                              {status === 'snapshot-only' && <span className="status-badge removed">Removed</span>}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}

          {activeTab === 'cast' && (
            <div className="scene-compare-tab-content">
              {currentCharacters.length === 0 && snapshotCharacters.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Users size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                  <p>No characters found</p>
                  <p style={{ fontSize: 12, marginTop: 8 }}>
                    Add character and dialogue elements to your script
                  </p>
                </div>
              ) : (
                <div className="scene-compare-cast">
                  {(() => {
                    const allCharacterNames = new Set([
                      ...currentCharacters.map(c => c.name),
                      ...snapshotCharacters.map(c => c.name)
                    ]);

                    return Array.from(allCharacterNames).map(charName => {
                      const currentChar = currentCharacters.find(c => c.name === charName);
                      const snapshotChar = snapshotCharacters.find(c => c.name === charName);
                      
                      const status = currentChar && snapshotChar ? 'both' :
                                     currentChar ? 'added' : 'removed';
                      const char = currentChar || snapshotChar;
                      if (!char) return null;

                      return (
                        <div
                          key={charName}
                          className={`scene-compare-character-item scene-compare-character-${status}`}
                        >
                          <div className="character-item-header">
                            <span
                              className="character-color-dot"
                              style={{ backgroundColor: char.color }}
                            />
                            <span className="character-name">{char.name}</span>
                            {status === 'added' && <span className="status-badge added">New</span>}
                            {status === 'removed' && <span className="status-badge removed">Removed</span>}
                          </div>
                          <div className="character-item-stats">
                            {currentChar && (
                              <div className="character-stat">
                                <span className="stat-label">Current:</span>
                                <span className="stat-value">{currentChar.totalDialogues} lines</span>
                              </div>
                            )}
                            {snapshotChar && (
                              <div className="character-stat">
                                <span className="stat-label">Snapshot:</span>
                                <span className="stat-value">{snapshotChar.totalDialogues} lines</span>
                              </div>
                            )}
                            {currentChar && snapshotChar && currentChar.totalDialogues !== snapshotChar.totalDialogues && (
                              <div className="character-stat-diff">
                                {currentChar.totalDialogues > snapshotChar.totalDialogues ? '+' : ''}
                                {currentChar.totalDialogues - snapshotChar.totalDialogues} lines
                              </div>
                            )}
                          </div>
                          {onJumpToScene && currentChar && currentChar.presenceByScene.size > 0 && (
                            <div className="character-scenes">
                              {Array.from(currentChar.presenceByScene.keys()).slice(0, 3).map(sceneId => {
                                const scene = currentScenes.find(s => s.id === sceneId);
                                if (!scene) return null;
                                return (
                                  <button
                                    key={sceneId}
                                    className="character-scene-link"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSceneClick(sceneId);
                                    }}
                                    title={scene.heading}
                                  >
                                    Scene {currentScenes.findIndex(s => s.id === sceneId) + 1}
                                  </button>
                                );
                              })}
                              {currentChar.presenceByScene.size > 3 && (
                                <span className="character-more-scenes">
                                  +{currentChar.presenceByScene.size - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Comparison Area */}
        <div className="scene-compare-main">
        {/* Left Column - Snapshot */}
        <div className="compare-column">
          <div className="compare-column-header">
            <span className="compare-column-title">
              {selectedSnapshot?.name || 'Snapshot'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {selectedSnapshot 
                ? new Date(selectedSnapshot.createdAt).toLocaleString() 
                : ''}
            </span>
          </div>
          <div className="compare-column-content">
            {snapshotContent ? (
              diff.lines.map((line, idx) => {
                if (line.type === 'added') return null; // Don't show additions in left column
                
                const isActive = changeIndices[currentDiffIndex] === idx;
                
                return (
                  <div 
                    key={idx} 
                    className={`diff-line ${line.type}`}
                    style={isActive ? { 
                        outline: '2px solid var(--accent)',
                      outlineOffset: -2,
                    } : undefined}
                  >
                    {line.content || ' '}
                  </div>
                );
              })
            ) : (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
                Select a snapshot to compare
              </p>
            )}
          </div>
        </div>

        {/* Right Column - Current */}
        <div className="compare-column">
          <div className="compare-column-header">
            <span className="compare-column-title">Current Script</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Now
            </span>
          </div>
            <div className="compare-column-content" style={{ background: 'rgba(46, 204, 113, 0.05)' }}>
            {diff.lines.map((line, idx) => {
              if (line.type === 'removed') return null; // Don't show removals in right column
              
              const isActive = changeIndices[currentDiffIndex] === idx;
              
              return (
                <div 
                  key={idx} 
                  className={`diff-line ${line.type}`}
                  style={isActive ? { 
                      outline: '2px solid var(--accent)',
                    outlineOffset: -2,
                  } : undefined}
                >
                  {line.content || ' '}
                </div>
              );
            })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

