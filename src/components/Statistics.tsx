import { useMemo } from 'react';
import { ScriptElement } from '../types';

interface StatisticsProps {
  isOpen: boolean;
  onClose: () => void;
  elements: ScriptElement[];
  pageCount: number;
}

interface CharacterStat {
  name: string;
  lines: number;
  words: number;
}

export default function Statistics({
  isOpen,
  onClose,
  elements,
  pageCount,
}: StatisticsProps) {
  const stats = useMemo(() => {
    let totalWords = 0;
    let intScenes = 0;
    let extScenes = 0;
    let totalScenes = 0;
    const characterStats = new Map<string, { lines: number; words: number }>();
    
    let currentCharacter: string | null = null;
    
    for (const el of elements) {
      const content = el.content.trim();
      const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
      totalWords += wordCount;
      
      if (el.type === 'scene-heading') {
        totalScenes++;
        const upper = content.toUpperCase();
        if (upper.startsWith('INT')) {
          intScenes++;
        } else if (upper.startsWith('EXT')) {
          extScenes++;
        }
        currentCharacter = null;
      } else if (el.type === 'character' && content) {
        currentCharacter = content.toUpperCase();
        if (!characterStats.has(currentCharacter)) {
          characterStats.set(currentCharacter, { lines: 0, words: 0 });
        }
      } else if (el.type === 'dialogue' && currentCharacter) {
        const stat = characterStats.get(currentCharacter);
        if (stat) {
          stat.lines++;
          stat.words += wordCount;
        }
      } else if (el.type !== 'parenthetical') {
        currentCharacter = null;
      }
    }
    
    // Convert to sorted array
    const characters: CharacterStat[] = Array.from(characterStats.entries())
      .map(([name, { lines, words }]) => ({ name, lines, words }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10); // Top 10
    
    const maxLines = characters.length > 0 ? characters[0].lines : 0;
    
    return {
      totalWords,
      totalScenes,
      intScenes,
      extScenes,
      characters,
      maxLines,
      estimatedRuntime: pageCount, // 1 page ≈ 1 minute
      avgSceneLength: totalScenes > 0 ? Math.round(totalWords / totalScenes) : 0,
    };
  }, [elements, pageCount]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content statistics-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Statistics</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{pageCount}</div>
              <div className="stat-label">Pages</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">~{stats.estimatedRuntime}</div>
              <div className="stat-label">Minutes</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.totalWords.toLocaleString()}</div>
              <div className="stat-label">Words</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.totalScenes}</div>
              <div className="stat-label">Scenes</div>
            </div>
          </div>
          
          <div className="stats-section">
            <h3>Scene Breakdown</h3>
            <div className="scene-breakdown">
              <div className="breakdown-item">
                <span className="breakdown-label">Interior (INT.)</span>
                <div className="breakdown-bar-container">
                  <div 
                    className="breakdown-bar interior"
                    style={{ width: `${stats.totalScenes > 0 ? (stats.intScenes / stats.totalScenes) * 100 : 0}%` }}
                  />
                </div>
                <span className="breakdown-value">{stats.intScenes}</span>
              </div>
              <div className="breakdown-item">
                <span className="breakdown-label">Exterior (EXT.)</span>
                <div className="breakdown-bar-container">
                  <div 
                    className="breakdown-bar exterior"
                    style={{ width: `${stats.totalScenes > 0 ? (stats.extScenes / stats.totalScenes) * 100 : 0}%` }}
                  />
                </div>
                <span className="breakdown-value">{stats.extScenes}</span>
              </div>
              <div className="breakdown-item">
                <span className="breakdown-label">Other</span>
                <div className="breakdown-bar-container">
                  <div 
                    className="breakdown-bar other"
                    style={{ width: `${stats.totalScenes > 0 ? ((stats.totalScenes - stats.intScenes - stats.extScenes) / stats.totalScenes) * 100 : 0}%` }}
                  />
                </div>
                <span className="breakdown-value">{stats.totalScenes - stats.intScenes - stats.extScenes}</span>
              </div>
            </div>
          </div>
          
          <div className="stats-section">
            <h3>Top Characters by Dialogue</h3>
            {stats.characters.length === 0 ? (
              <p className="no-data">No dialogue yet.</p>
            ) : (
              <div className="character-bars">
                {stats.characters.map((char) => (
                  <div key={char.name} className="character-bar-item">
                    <div className="character-bar-header">
                      <span className="character-bar-name">{char.name}</span>
                      <span className="character-bar-count">{char.lines} lines • {char.words} words</span>
                    </div>
                    <div className="character-bar-container">
                      <div 
                        className="character-bar"
                        style={{ width: `${stats.maxLines > 0 ? (char.lines / stats.maxLines) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="stats-footer">
            <p>Average scene length: ~{stats.avgSceneLength} words</p>
          </div>
        </div>
      </div>
    </div>
  );
}

