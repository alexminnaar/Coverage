import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Image,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type {
  SceneStoryboard as SceneStoryboardData,
  ScriptElement,
  StoryboardAspectRatio,
  StoryboardShot,
} from '../types';
import { checkAIHealth } from '../services/aiClient';

interface SceneStoryboardProps {
  elements: ScriptElement[];
  storyboards: Record<string, SceneStoryboardData>;
  initialSceneId?: string | null;
  onStoryboardsChange: (storyboards: Record<string, SceneStoryboardData>) => void;
  onRequestAI: (sceneId: string) => void;
  onGenerateShot: (sceneId: string, shotId: string) => Promise<void>;
  onJumpToScene: (sceneId: string) => void;
  onClose: () => void;
}

const DEFAULT_STYLE = 'Cinematic storyboard sketch';

function emptyStoryboard(sceneId: string): SceneStoryboardData {
  const now = Date.now();
  return {
    sceneId,
    style: DEFAULT_STYLE,
    aspectRatio: '16:9',
    shots: [],
    createdAt: now,
    updatedAt: now,
  };
}

function emptyShot(order: number): StoryboardShot {
  return {
    id: uuidv4(),
    order,
    title: `Shot ${order + 1}`,
    shotType: 'Medium shot',
    action: '',
    characters: [],
    imagePrompt: '',
  };
}

export default function SceneStoryboard({
  elements,
  storyboards,
  initialSceneId,
  onStoryboardsChange,
  onRequestAI,
  onGenerateShot,
  onJumpToScene,
  onClose,
}: SceneStoryboardProps) {
  const scenes = useMemo(
    () => elements
      .filter(element => element.type === 'scene-heading')
      .map((element, index) => ({
        id: element.id,
        label: element.content.trim() || `Untitled scene ${index + 1}`,
        number: element.sceneNumber || String(index + 1),
      })),
    [elements]
  );
  const [selectedSceneId, setSelectedSceneId] = useState(
    initialSceneId && scenes.some(scene => scene.id === initialSceneId)
      ? initialSceneId
      : scenes[0]?.id || ''
  );
  const [generatingShotIds, setGeneratingShotIds] = useState<Set<string>>(new Set());
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [imageGenerationConfigured, setImageGenerationConfigured] = useState<boolean | undefined>();
  const [expandedShotId, setExpandedShotId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkAIHealth().then(health => {
      if (!cancelled) setImageGenerationConfigured(health.imageGenerationConfigured);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialSceneId && scenes.some(scene => scene.id === initialSceneId)) {
      setSelectedSceneId(initialSceneId);
    }
  }, [initialSceneId, scenes]);

  useEffect(() => {
    if (!selectedSceneId && scenes[0]) setSelectedSceneId(scenes[0].id);
  }, [scenes, selectedSceneId]);

  const selectedScene = scenes.find(scene => scene.id === selectedSceneId);
  const storyboard = storyboards[selectedSceneId] || (
    selectedSceneId ? emptyStoryboard(selectedSceneId) : null
  );
  const expandedShot = storyboard?.shots.find(shot => shot.id === expandedShotId) || null;

  useEffect(() => {
    setExpandedShotId(null);
  }, [selectedSceneId]);

  useEffect(() => {
    if (!expandedShotId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedShotId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedShotId]);

  const commit = (nextStoryboard: SceneStoryboardData) => {
    onStoryboardsChange({
      ...storyboards,
      [nextStoryboard.sceneId]: {
        ...nextStoryboard,
        shots: nextStoryboard.shots.map((shot, order) => ({ ...shot, order })),
        updatedAt: Date.now(),
      },
    });
  };

  const updateShot = (id: string, updates: Partial<StoryboardShot>) => {
    if (!storyboard) return;
    commit({
      ...storyboard,
      shots: storyboard.shots.map(shot => shot.id === id ? { ...shot, ...updates } : shot),
    });
  };

  const moveShot = (id: string, direction: -1 | 1) => {
    if (!storyboard) return;
    const shots = storyboard.shots.slice().sort((a, b) => a.order - b.order);
    const from = shots.findIndex(shot => shot.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= shots.length) return;
    [shots[from], shots[to]] = [shots[to], shots[from]];
    commit({ ...storyboard, shots });
  };

  const generateShot = async (shotId: string) => {
    if (!selectedSceneId || generatingShotIds.has(shotId)) return false;
    if (imageGenerationConfigured === false) {
      setGenerationError('Panel generation needs Cloudflare R2 credentials in the AI service.');
      return false;
    }
    setGenerationError(null);
    setGeneratingShotIds(previous => new Set(previous).add(shotId));
    try {
      await onGenerateShot(selectedSceneId, shotId);
      return true;
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Image generation failed.');
      return false;
    } finally {
      setGeneratingShotIds(previous => {
        const next = new Set(previous);
        next.delete(shotId);
        return next;
      });
    }
  };

  const generateMissingShots = async () => {
    if (!storyboard) return;
    const missing = storyboard.shots
      .filter(shot => shot.image?.status !== 'complete')
      .sort((a, b) => a.order - b.order);
    for (const shot of missing) {
      const succeeded = await generateShot(shot.id);
      if (!succeeded) break;
    }
  };

  return (
    <section className="scene-storyboard" tabIndex={-1} aria-label="Scene storyboard">
      <header className="scene-storyboard-header">
        <div>
          <span className="scene-storyboard-eyebrow">Visual planning</span>
          <h2>Scene Storyboard</h2>
        </div>
        <div className="scene-storyboard-header-actions">
          {selectedScene && (
            <button className="storyboard-secondary-btn" onClick={() => onJumpToScene(selectedScene.id)}>
              View in script
            </button>
          )}
          <button className="storyboard-close-btn" onClick={onClose} aria-label="Close storyboard">
            <X size={20} />
          </button>
        </div>
      </header>

      {scenes.length === 0 ? (
        <div className="storyboard-empty">
          <Clapperboard size={38} />
          <h3>Add a scene heading first</h3>
          <p>Storyboards are attached to screenplay scenes.</p>
        </div>
      ) : storyboard && selectedScene ? (
        <>
          <div className="scene-storyboard-toolbar">
            <label>
              <span>Scene</span>
              <select value={selectedSceneId} onChange={event => setSelectedSceneId(event.target.value)}>
                {scenes.map(scene => (
                  <option key={scene.id} value={scene.id}>
                    {scene.number}. {scene.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Visual style</span>
              <input
                value={storyboard.style}
                onChange={event => commit({ ...storyboard, style: event.target.value })}
                placeholder={DEFAULT_STYLE}
              />
            </label>
            <label className="storyboard-ratio-field">
              <span>Frame</span>
              <select
                value={storyboard.aspectRatio}
                onChange={event => commit({
                  ...storyboard,
                  aspectRatio: event.target.value as StoryboardAspectRatio,
                })}
              >
                <option value="2.39:1">2.39:1</option>
                <option value="16:9">16:9</option>
                <option value="4:3">4:3</option>
                <option value="1:1">1:1</option>
                <option value="9:16">9:16</option>
              </select>
            </label>
            <div className="storyboard-toolbar-actions">
              <button className="storyboard-ai-btn" onClick={() => onRequestAI(selectedSceneId)}>
                <Sparkles size={16} />
                Generate shot list
              </button>
              {storyboard.shots.length > 0 && (
                <button
                  className="storyboard-secondary-btn"
                  onClick={generateMissingShots}
                  disabled={
                    imageGenerationConfigured === false
                    || generatingShotIds.size > 0
                    || storyboard.shots.every(shot => shot.image?.status === 'complete')
                  }
                >
                  {generatingShotIds.size > 0 ? <Loader2 className="storyboard-spin" size={16} /> : <Image size={16} />}
                  Generate panels
                </button>
              )}
            </div>
          </div>

          {imageGenerationConfigured === false && (
            <div className="storyboard-generation-setup" role="status">
              Panel generation is ready in the app, but Cloudflare R2 credentials still need to be added to the AI service.
            </div>
          )}

          {generationError && (
            <div className="storyboard-generation-error" role="alert">{generationError}</div>
          )}

          {storyboard.shots.length === 0 ? (
            <div className="storyboard-empty">
              <Clapperboard size={38} />
              <h3>No shots planned for this scene</h3>
              <p>Ask AI to interpret the scene with screenplay context, or add the first shot manually.</p>
              <div className="storyboard-empty-actions">
                <button className="storyboard-ai-btn" onClick={() => onRequestAI(selectedSceneId)}>
                  <Sparkles size={16} />
                  Generate with AI
                </button>
                <button
                  className="storyboard-secondary-btn"
                  onClick={() => commit({ ...storyboard, shots: [emptyShot(0)] })}
                >
                  <Plus size={16} />
                  Add shot
                </button>
              </div>
            </div>
          ) : (
            <div className="storyboard-shot-grid">
              {storyboard.shots
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((shot, index) => (
                  <article className="storyboard-shot-card" key={shot.id}>
                    <div className={`storyboard-frame storyboard-frame--${storyboard.aspectRatio.replace(/[:.]/g, '-')}`}>
                      <div className="storyboard-frame-number">{index + 1}</div>
                      {shot.image?.url ? (
                        <button
                          className="storyboard-image-open"
                          onClick={() => setExpandedShotId(shot.id)}
                          aria-label={`Maximize storyboard panel ${index + 1}`}
                        >
                          <img src={shot.image.url} alt={`Storyboard panel ${index + 1}: ${shot.title}`} />
                          <span><Maximize2 size={15} /> Maximize</span>
                        </button>
                      ) : (
                        <>
                          {generatingShotIds.has(shot.id) || shot.image?.status === 'generating'
                            ? <Loader2 className="storyboard-spin" size={28} />
                            : <Clapperboard size={28} />}
                          <span>
                            {generatingShotIds.has(shot.id) || shot.image?.status === 'generating'
                              ? 'Generating storyboard panel…'
                              : shot.imagePrompt || shot.action || 'Describe the visual direction below'}
                          </span>
                        </>
                      )}
                      {(generatingShotIds.has(shot.id) || shot.image?.status === 'generating') && shot.image?.url && (
                        <div className="storyboard-image-status">
                          <Loader2 className="storyboard-spin" size={16} />
                          Regenerating…
                        </div>
                      )}
                      <button
                        className="storyboard-generate-panel-btn"
                        onClick={() => generateShot(shot.id)}
                        disabled={imageGenerationConfigured === false || generatingShotIds.has(shot.id)}
                      >
                        {shot.image?.url ? <RefreshCw size={14} /> : <Image size={14} />}
                        {shot.image?.url ? 'Regenerate' : 'Generate'}
                      </button>
                    </div>
                    <div className="storyboard-shot-fields">
                      <div className="storyboard-shot-title-row">
                        <input
                          className="storyboard-shot-title"
                          value={shot.title}
                          onChange={event => updateShot(shot.id, { title: event.target.value })}
                          aria-label={`Shot ${index + 1} title`}
                        />
                        <div className="storyboard-shot-actions">
                          <button onClick={() => moveShot(shot.id, -1)} disabled={index === 0} aria-label="Move shot earlier">
                            <ArrowUp size={15} />
                          </button>
                          <button
                            onClick={() => moveShot(shot.id, 1)}
                            disabled={index === storyboard.shots.length - 1}
                            aria-label="Move shot later"
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            onClick={() => commit({
                              ...storyboard,
                              shots: storyboard.shots.filter(item => item.id !== shot.id),
                            })}
                            aria-label="Delete shot"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <div className="storyboard-field-row">
                        <input
                          value={shot.shotType}
                          onChange={event => updateShot(shot.id, { shotType: event.target.value })}
                          placeholder="Shot type"
                          aria-label="Shot type"
                        />
                        <input
                          value={shot.cameraAngle || ''}
                          onChange={event => updateShot(shot.id, { cameraAngle: event.target.value })}
                          placeholder="Camera angle"
                          aria-label="Camera angle"
                        />
                      </div>
                      <textarea
                        value={shot.action}
                        onChange={event => updateShot(shot.id, { action: event.target.value })}
                        placeholder="What happens in this shot?"
                        aria-label="Shot action"
                        rows={3}
                      />
                      <input
                        value={shot.characters.join(', ')}
                        onChange={event => updateShot(shot.id, {
                          characters: event.target.value.split(',').map(value => value.trim()).filter(Boolean),
                        })}
                        placeholder="Characters, comma separated"
                        aria-label="Characters"
                      />
                      <textarea
                        value={shot.dialogue || ''}
                        onChange={event => updateShot(shot.id, { dialogue: event.target.value })}
                        placeholder="Dialogue or caption"
                        aria-label="Dialogue or caption"
                        rows={2}
                      />
                      <textarea
                        value={shot.continuityNotes || ''}
                        onChange={event => updateShot(shot.id, { continuityNotes: event.target.value })}
                        placeholder="Continuity notes: wardrobe, props, screen direction…"
                        aria-label="Continuity notes"
                        rows={2}
                      />
                      <textarea
                        value={shot.imagePrompt || ''}
                        onChange={event => updateShot(shot.id, { imagePrompt: event.target.value })}
                        placeholder="Image-generation prompt"
                        aria-label="Image prompt"
                        rows={3}
                      />
                    </div>
                  </article>
                ))}
              <button
                className="storyboard-add-shot"
                onClick={() => commit({
                  ...storyboard,
                  shots: [...storyboard.shots, emptyShot(storyboard.shots.length)],
                })}
              >
                <Plus size={20} />
                Add shot
              </button>
            </div>
          )}

          {expandedShot?.image?.url && (
            <div
              className="storyboard-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={`Storyboard panel: ${expandedShot.title}`}
              onMouseDown={event => {
                if (event.target === event.currentTarget) setExpandedShotId(null);
              }}
            >
              <button
                className="storyboard-lightbox-close"
                onClick={() => setExpandedShotId(null)}
                aria-label="Close maximized storyboard panel"
              >
                <X size={22} />
              </button>
              <figure>
                <img src={expandedShot.image.url} alt={expandedShot.title} />
                <figcaption>
                  <strong>{expandedShot.title}</strong>
                  <span>{expandedShot.shotType}{expandedShot.cameraAngle ? ` · ${expandedShot.cameraAngle}` : ''}</span>
                </figcaption>
              </figure>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
