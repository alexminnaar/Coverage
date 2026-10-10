import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Screenplay, ScriptElement, ElementType, getDefaultNextType, ProjectMeta, Theme, Beat, BeatStructure, BEAT_STRUCTURES, Revision, PendingEdit, ELEMENT_LABELS, SceneStoryboard as SceneStoryboardData } from './types';
import { applyBeatOps } from './utils/applyBeatOps';
import { applyStoryboardOps } from './utils/applyStoryboardOps';
import type { StoryboardOp } from './utils/applyStoryboardOps';
import { generateStoryboardImage } from './services/aiClient';
import type { AIChatMode } from './services/aiClient';
import {
  loadCurrentScreenplayAsync,
  createDefaultScreenplay,
  saveProject,
  debounce,
  createNewProjectAsync,
  loadProjectsList,
  loadProjectsListSync,
  loadProject,
  setCurrentProjectId,
  deleteProject,
  createSnapshot,
  restoreFromSnapshot,
  deleteSnapshot,
  renameSnapshot,
} from './storage';
import { initAPIMode } from './services/apiClient';
import { estimatePageCount } from './utils/pageEstimate';
import { useHistory } from './hooks/useHistory';
import { parseFountainFile, extractTitlePage } from './utils/fountainParser';
import { downloadFountain } from './utils/fountainExporter';
import { toggleSceneNumbering, toggleScenesLocked } from './utils/sceneNumbers';
import { startDualDialogue } from './utils/dualDialogue';
import Header from './components/Header';
import SceneNavigator from './components/SceneNavigator';
import ScriptEditor from './components/ScriptEditor';
import EditReviewBar from './components/EditReviewBar';
import KeyboardHelp from './components/KeyboardHelp';
import FindReplace from './components/FindReplace';
import ProjectList from './components/ProjectList';
import NotesPanel from './components/NotesPanel';
import { downloadFdx } from './utils/fdxExporter';
import { ScriptNote, WritingGoal, WritingSession } from './types';
import {
  loadWritingGoal,
  saveWritingGoal,
  loadWritingSessions,
  updateTodaySession,
} from './storage';
import { calculateStreak, calculateLongestStreak, countWords, estimatePages } from './utils/writingStats';
import { applyPendingEdit } from './utils/applyPendingEdit';
import { reconcilePendingEdits } from './utils/reconcilePendingEdits';

const TitlePageEditor = lazy(() => import('./components/TitlePageEditor'));
const Statistics = lazy(() => import('./components/Statistics'));
const BeatBoard = lazy(() => import('./components/BeatBoard'));
const SceneStoryboard = lazy(() => import('./components/SceneStoryboard'));
const AIChat = lazy(() => import('./components/AIChat'));
const AICommandPalette = lazy(() => import('./components/AICommandPalette'));
const AISettings = lazy(() => import('./components/AISettings'));
const SnapshotsPanel = lazy(() => import('./components/SnapshotsPanel'));
const RevisionManager = lazy(() => import('./components/RevisionManager'));
const PrintPreview = lazy(() => import('./components/PrintPreview'));
const WritingGoals = lazy(() => import('./components/WritingGoals'));
const CharacterTracker = lazy(() => import('./components/CharacterTracker'));
const SceneCompare = lazy(() => import('./components/SceneCompare'));

function ToolLoadingFallback() {
  return (
    <div className="tool-loading-fallback" role="status" aria-live="polite">
      Loading tool…
    </div>
  );
}

function RightPanelLoadingFallback() {
  return (
    <aside className="right-panel-loading" role="status" aria-live="polite">
      Loading AI…
    </aside>
  );
}

// AI enabled storage
function getStoredAIEnabled(): boolean {
  const stored = localStorage.getItem('screenwriter_ai_enabled');
  return stored === 'true';
}

// Theme helpers
function getStoredTheme(): Theme {
  const stored = localStorage.getItem('screenwriter_theme');
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function getEffectiveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

type SaveStatus = 'saving' | 'saved' | 'error';

function App() {
  // Use history hook for undo/redo
  const {
    state: screenplay,
    setState: setScreenplay,
    undo,
    redo,
    canUndo,
    canRedo,
    resetState,
  } = useHistory<Screenplay>(() => createDefaultScreenplay(), { maxHistory: 50 });

  const [focusedElementId, setFocusedElementId] = useState<string | null>(null);
  const [activeElementId, setActiveElementId] = useState<string | null>(null); // Currently active/focused element in editor
  const [showHelp, setShowHelp] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showProjectList, setShowProjectList] = useState(false);
  const [showTitlePage, setShowTitlePage] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [showBeatBoard, setShowBeatBoard] = useState(false);
  const [beatBoardSelectedBeatId, setBeatBoardSelectedBeatId] = useState<string | null>(null);
  const [beatBoardView, setBeatBoardView] = useState<'board' | 'treatment'>('board');
  const [showStoryboard, setShowStoryboard] = useState(false);
  const [storyboardSceneId, setStoryboardSceneId] = useState<string | null>(null);
  const screenplayWorkspaceRef = useRef<HTMLDivElement>(null);
  const beatBoardReturnFocusRef = useRef<HTMLElement | null>(null);
  const beatBoardWasOpenRef = useRef(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>(() => loadProjectsListSync());

  // Theme state
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [effectiveTheme, setEffectiveTheme] = useState<'dark' | 'light'>(() => getEffectiveTheme(getStoredTheme()));

  // Distraction-free mode
  const [distractionFree, setDistractionFree] = useState(false);

  // Typewriter and Focus modes
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // Writing goals state
  const [showWritingGoals, setShowWritingGoals] = useState(false);
  const [writingGoal, setWritingGoal] = useState<WritingGoal | null>(() => loadWritingGoal());
  const [writingSessions, setWritingSessions] = useState<WritingSession[]>(() => loadWritingSessions());

  // Character Tracker state
  const [showCharacterTracker, setShowCharacterTracker] = useState(false);

  // Scene Compare state
  const [showSceneCompare, setShowSceneCompare] = useState(false);

  // AI features state
  const [aiEnabled, setAIEnabled] = useState(() => getStoredAIEnabled());
  const [showAIChat, setShowAIChat] = useState(false);
  const [hasOpenedAIChat, setHasOpenedAIChat] = useState(false);
  const [showAICommand, setShowAICommand] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiPanelWidth, setAIPanelWidth] = useState(400);
  const [requestedAIChatMode, setRequestedAIChatMode] = useState<AIChatMode | undefined>();
  const [requestedAIChatPrompt, setRequestedAIChatPrompt] = useState<{ id: string; content: string }>();

  // Pending AI edits (Cursor-style inline edits)
  const [pendingEdits, setPendingEdits] = useState<Map<string, PendingEdit>>(new Map());
  const [reviewElementId, setReviewElementId] = useState<string | null>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [isHydrated, setIsHydrated] = useState(false);
  const saveVersionRef = useRef(0);
  const screenplayElementsRef = useRef(screenplay.elements);
  screenplayElementsRef.current = screenplay.elements;

  useEffect(() => {
    setPendingEdits(new Map());
    setReviewElementId(null);
  }, [screenplay.id]);

  useEffect(() => {
    const workspace = screenplayWorkspaceRef.current;
    if (!workspace) return;
    const overlayOpen = showBeatBoard || showStoryboard;
    if (overlayOpen) {
      workspace.setAttribute('inert', '');
    } else {
      workspace.removeAttribute('inert');
    }

    if (overlayOpen && !beatBoardWasOpenRef.current) {
      beatBoardReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.beat-board, .scene-storyboard')?.focus();
      });
    } else if (!overlayOpen && beatBoardWasOpenRef.current) {
      requestAnimationFrame(() => beatBoardReturnFocusRef.current?.focus());
    }
    beatBoardWasOpenRef.current = overlayOpen;
  }, [showBeatBoard, showStoryboard]);

  // Resolve the database-backed active project before enabling autosave. This
  // prevents a stale synchronous local copy from overwriting newer remote work.
  useEffect(() => {
    let cancelled = false;
    initAPIMode();

    const hydrate = async () => {
      try {
        const loadedScreenplay = await loadCurrentScreenplayAsync();
        const loadedProjects = await loadProjectsList();
        if (cancelled) return;
        resetState(loadedScreenplay);
        setProjects(loadedProjects);
        setSaveStatus('saved');
      } catch (error) {
        console.error('Failed to hydrate screenplay:', error);
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [resetState]);

  // Apply theme to document
  useEffect(() => {
    const effective = getEffectiveTheme(theme);
    setEffectiveTheme(effective);
    document.documentElement.setAttribute('data-theme', effective);
    localStorage.setItem('screenwriter_theme', theme);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        const effective = getEffectiveTheme('system');
        setEffectiveTheme(effective);
        document.documentElement.setAttribute('data-theme', effective);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Debounced save function
  const debouncedSave = useMemo(
    () => debounce(async (sp: Screenplay) => {
      const saveVersion = ++saveVersionRef.current;
      setSaveStatus('saving');
      try {
        await saveProject(sp);
        // Refresh projects list
        const updatedProjects = await loadProjectsList();
        setProjects(updatedProjects);
        if (saveVersion === saveVersionRef.current) {
          setSaveStatus('saved');
        }
      } catch (error) {
        console.error('Failed to save project:', error);
        if (saveVersion === saveVersionRef.current) {
          setSaveStatus('error');
        }
      }
    }, 500),
    []
  );

  // Auto-save when screenplay changes
  useEffect(() => {
    if (!isHydrated) return;
    debouncedSave(screenplay);
  }, [screenplay, debouncedSave, isHydrated]);

  // Update title
  const handleTitleChange = useCallback((title: string) => {
    setScreenplay(prev => ({ ...prev, title }));
  }, [setScreenplay]);

  // Update author
  const handleAuthorChange = useCallback((author: string) => {
    setScreenplay(prev => ({ ...prev, author }));
  }, [setScreenplay]);

  // Update element content
  const handleElementChange = useCallback((id: string, content: string) => {
    setScreenplay(prev => ({
      ...prev,
      elements: prev.elements.map(el =>
        el.id === id ? { ...el, content } : el
      ),
    }));
  }, [setScreenplay]);

  // Update element type
  const handleElementTypeChange = useCallback((id: string, type: ElementType) => {
    setScreenplay(prev => ({
      ...prev,
      elements: prev.elements.map(el =>
        el.id === id ? { ...el, type } : el
      ),
    }));
  }, [setScreenplay]);

  // Update element synopsis (for scene headings)
  const handleSynopsisChange = useCallback((id: string, synopsis: string) => {
    setScreenplay(prev => ({
      ...prev,
      elements: prev.elements.map(el =>
        el.id === id ? { ...el, synopsis } : el
      ),
    }));
  }, [setScreenplay]);

  // Update element notes (for scene headings)
  const handleNotesChange = useCallback((id: string, notes: string) => {
    setScreenplay(prev => ({
      ...prev,
      elements: prev.elements.map(el =>
        el.id === id ? { ...el, notes } : el
      ),
    }));
  }, [setScreenplay]);

  // Add new element after the given element
  const handleAddElement = useCallback((afterId: string, type?: ElementType) => {
    const afterElement = screenplay.elements.find(el => el.id === afterId);
    const newType = type ?? getDefaultNextType(afterElement?.type ?? 'action');

    const newElement: ScriptElement = {
      id: uuidv4(),
      type: newType,
      content: '',
    };

    setScreenplay(prev => {
      const idx = prev.elements.findIndex(el => el.id === afterId);
      const newElements = [...prev.elements];
      newElements.splice(idx + 1, 0, newElement);
      return { ...prev, elements: newElements };
    });

    // Focus the new element
    setFocusedElementId(newElement.id);
    return newElement.id;
  }, [screenplay.elements, setScreenplay]);

  // Delete element
  const handleDeleteElement = useCallback((id: string) => {
    setScreenplay(prev => {
      // Don't delete if it's the only element
      if (prev.elements.length <= 1) {
        return prev;
      }

      const idx = prev.elements.findIndex(el => el.id === id);
      const deletedElement = prev.elements[idx];
      const newElements = prev.elements.filter(el => el.id !== id);

      // Focus the previous element, or the next if deleting the first
      const focusIdx = Math.max(0, idx - 1);
      if (newElements[focusIdx]) {
        setFocusedElementId(newElements[focusIdx].id);
      }

      if (deletedElement?.type === 'scene-heading' && prev.storyboards?.[id]) {
        const storyboards = { ...prev.storyboards };
        delete storyboards[id];
        return { ...prev, elements: newElements, storyboards };
      }

      return { ...prev, elements: newElements };
    });
  }, [setScreenplay]);

  // Reorder elements (for drag and drop)
  const handleReorderElements = useCallback((newElements: ScriptElement[]) => {
    setScreenplay(prev => ({ ...prev, elements: newElements }));
  }, [setScreenplay]);

  // Focus a specific element (used by scene navigator)
  const handleFocusElement = useCallback((id: string) => {
    setFocusedElementId(id);
    setSelectedElementId(id);  // Also update selected element for notes
  }, []);

  // Clear focus tracking after it's been used
  const handleFocusConsumed = useCallback(() => {
    setFocusedElementId(null);
  }, []);

  // Export to PDF
  const handleExportPDF = useCallback(async () => {
    const { exportToPDF } = await import('./pdfExport');
    exportToPDF(screenplay);
  }, [screenplay]);

  // Export to Fountain
  const handleExportFountain = useCallback(() => {
    downloadFountain(screenplay);
  }, [screenplay]);

  // Create new screenplay
  const handleNew = useCallback(async () => {
    try {
      const newProject = await createNewProjectAsync();
      resetState(newProject);
      const updatedProjects = await loadProjectsList();
      setProjects(updatedProjects);
      setShowProjectList(false);
    } catch (error) {
      console.error('Failed to create new project:', error);
    }
  }, [resetState]);

  // Switch to a different project
  const handleSwitchProject = useCallback(async (id: string) => {
    try {
      const project = await loadProject(id);
      if (project) {
        setCurrentProjectId(id);
        resetState(project);
        setShowProjectList(false);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  }, [resetState]);

  // Delete a project
  const handleDeleteProject = useCallback(async (id: string) => {
    if (confirm('Delete this screenplay? This cannot be undone.')) {
      try {
        await deleteProject(id);
        const updatedProjects = await loadProjectsList();
        setProjects(updatedProjects);

        // If we deleted the current project, switch to another
        if (id === screenplay.id) {
          if (updatedProjects.length > 0) {
            await handleSwitchProject(updatedProjects[0].id);
          } else {
            await handleNew();
          }
        }
      } catch (error) {
        console.error('Failed to delete project:', error);
      }
    }
  }, [screenplay.id, handleSwitchProject, handleNew]);

  // Import Fountain file
  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const { title, author } = extractTitlePage(text);
      const elements = await parseFountainFile(file);

      if (elements.length === 0) {
        alert('No content found in the file.');
        return;
      }

      const now = Date.now();
      const imported: Screenplay = {
        id: uuidv4(),
        title: title || file.name.replace(/\.(fountain|txt)$/i, '') || 'Imported Screenplay',
        author: author || '',
        elements,
        updatedAt: now,
        createdAt: now,
      };

      await saveProject(imported);
      setCurrentProjectId(imported.id);
      resetState(imported);
      const updatedProjects = await loadProjectsList();
      setProjects(updatedProjects);
    } catch (e) {
      console.error('Failed to import file:', e);
      alert('Failed to import file. Please check the format.');
    }
  }, [resetState]);

  // Find and replace
  const handleReplaceAll = useCallback((find: string, replace: string, caseSensitive: boolean) => {
    if (!find) return 0;

    let count = 0;
    setScreenplay(prev => ({
      ...prev,
      elements: prev.elements.map(el => {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        const matches = el.content.match(regex);
        if (matches) {
          count += matches.length;
          return { ...el, content: el.content.replace(regex, replace) };
        }
        return el;
      }),
    }));

    return count;
  }, [setScreenplay]);

  // Save title page data
  const handleSaveTitlePage = useCallback((data: {
    title: string;
    author: string;
    contact: string;
    draftDate: string;
    copyright: string;
    basedOn: string;
  }) => {
    setScreenplay(prev => ({
      ...prev,
      title: data.title,
      author: data.author,
      contact: data.contact,
      draftDate: data.draftDate,
      copyright: data.copyright,
      basedOn: data.basedOn,
    }));
  }, [setScreenplay]);

  // Beat board handlers
  const handleBeatsChange = useCallback((beats: Beat[]) => {
    setScreenplay(prev => ({ ...prev, beats }));
  }, [setScreenplay]);

  const handleTreatmentChange = useCallback((treatment: string) => {
    setScreenplay(prev => ({ ...prev, treatment }));
  }, [setScreenplay]);

  const handleApplyBeatOps = useCallback((ops: Parameters<typeof applyBeatOps>[1]) => {
    const treatmentOp = [...ops]
      .reverse()
      .find((op) => op.op === 'set_treatment');
    setScreenplay(prev => {
      const structure = prev.beatStructure || 'three-act';
      const actCount = (BEAT_STRUCTURES[structure] ?? BEAT_STRUCTURES['three-act']).length;
      return {
        ...prev,
        beats: applyBeatOps(prev.beats || [], ops, actCount),
        treatment: treatmentOp?.op === 'set_treatment'
          ? treatmentOp.treatment
          : prev.treatment,
      };
    });
    setBeatBoardView(treatmentOp ? 'treatment' : 'board');
    setShowBeatBoard(true);
  }, [setScreenplay]);

  const handleBeatStructureChange = useCallback((beatStructure: BeatStructure) => {
    setScreenplay(prev => ({ ...prev, beatStructure }));
  }, [setScreenplay]);

  const handleStoryboardsChange = useCallback((storyboards: Record<string, SceneStoryboardData>) => {
    setScreenplay(prev => ({ ...prev, storyboards }));
  }, [setScreenplay]);

  const handleApplyStoryboardOps = useCallback((ops: StoryboardOp[]) => {
    setScreenplay(prev => ({
      ...prev,
      storyboards: applyStoryboardOps(prev.storyboards || {}, ops),
    }));
    const proposedSceneId = ops.find(op => op.sceneId)?.sceneId;
    if (proposedSceneId) setStoryboardSceneId(proposedSceneId);
    setShowBeatBoard(false);
    setShowStoryboard(true);
  }, [setScreenplay]);

  const handleGenerateStoryboardShot = useCallback(async (sceneId: string, shotId: string) => {
    const storyboard = screenplay.storyboards?.[sceneId];
    const shot = storyboard?.shots.find(item => item.id === shotId);
    if (!storyboard || !shot) {
      throw new Error('This storyboard shot no longer exists.');
    }

    setScreenplay(prev => {
      const current = prev.storyboards?.[sceneId];
      if (!current) return prev;
      return {
        ...prev,
        storyboards: {
          ...prev.storyboards,
          [sceneId]: {
            ...current,
            shots: current.shots.map(item => item.id === shotId
              ? {
                  ...item,
                  image: {
                    ...item.image,
                    status: 'generating',
                    error: undefined,
                  },
                }
              : item),
            updatedAt: Date.now(),
          },
        },
      };
    });

    const prompt = [
      shot.imagePrompt || shot.action,
      `Shot: ${shot.shotType}${shot.cameraAngle ? `, ${shot.cameraAngle}` : ''}.`,
      shot.characters.length ? `Characters: ${shot.characters.join(', ')}.` : '',
      shot.dialogue ? `Moment of dialogue: ${shot.dialogue}` : '',
      shot.continuityNotes ? `Continuity: ${shot.continuityNotes}` : '',
    ].filter(Boolean).join('\n');

    try {
      const generated = await generateStoryboardImage({
        projectId: screenplay.id,
        sceneId,
        shotId,
        prompt,
        style: storyboard.style,
        aspectRatio: storyboard.aspectRatio,
        previousProviderAssetId: shot.image?.providerAssetId,
      });
      setScreenplay(prev => {
        const current = prev.storyboards?.[sceneId];
        if (!current) return prev;
        return {
          ...prev,
          storyboards: {
            ...prev.storyboards,
            [sceneId]: {
              ...current,
              shots: current.shots.map(item => item.id === shotId
                ? {
                    ...item,
                    image: {
                      status: 'complete',
                      url: generated.url,
                      providerAssetId: generated.providerAssetId,
                      createdAt: Date.now(),
                    },
                  }
                : item),
              updatedAt: Date.now(),
            },
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed.';
      setScreenplay(prev => {
        const current = prev.storyboards?.[sceneId];
        if (!current) return prev;
        return {
          ...prev,
          storyboards: {
            ...prev.storyboards,
            [sceneId]: {
              ...current,
              shots: current.shots.map(item => item.id === shotId
                ? {
                    ...item,
                    image: {
                      ...item.image,
                      status: 'failed',
                      error: message,
                    },
                  }
                : item),
              updatedAt: Date.now(),
            },
          },
        };
      });
      throw error;
    }
  }, [screenplay, setScreenplay]);


  // Snapshot handlers
  const handleCreateSnapshot = useCallback(async (name: string) => {
    const updated = await createSnapshot(screenplay, name);
    setScreenplay(updated);
  }, [screenplay, setScreenplay]);

  const handleRestoreSnapshot = useCallback(async (snapshotId: string) => {
    const updated = await restoreFromSnapshot(screenplay, snapshotId);
    if (updated) {
      resetState(updated);
    }
  }, [screenplay, resetState]);

  const handleDeleteSnapshot = useCallback(async (snapshotId: string) => {
    const updated = await deleteSnapshot(screenplay, snapshotId);
    setScreenplay(updated);
  }, [screenplay, setScreenplay]);

  const handleRenameSnapshot = useCallback(async (snapshotId: string, newName: string) => {
    const updated = await renameSnapshot(screenplay, snapshotId, newName);
    setScreenplay(updated);
  }, [screenplay, setScreenplay]);

  // Scene numbering handlers
  const handleToggleSceneNumbering = useCallback(() => {
    const updated = toggleSceneNumbering(screenplay, !screenplay.sceneNumberingEnabled);
    setScreenplay(updated);
  }, [screenplay, setScreenplay]);

  const handleToggleScenesLocked = useCallback(() => {
    const updated = toggleScenesLocked(screenplay, !screenplay.scenesLocked);
    setScreenplay(updated);
  }, [screenplay, setScreenplay]);

  // Dual dialogue handler
  const handleStartDualDialogue = useCallback((characterId: string) => {
    const updatedElements = startDualDialogue(screenplay.elements, characterId);
    setScreenplay(prev => ({ ...prev, elements: updatedElements }));
  }, [screenplay.elements, setScreenplay]);

  // Revision handlers
  const handleCreateRevision = useCallback((revision: Revision) => {
    setScreenplay(prev => ({
      ...prev,
      revisions: [revision, ...(prev.revisions || [])],
      currentRevisionId: revision.id,
    }));
  }, [setScreenplay]);

  const handleSetActiveRevision = useCallback((revisionId: string | null) => {
    setScreenplay(prev => ({
      ...prev,
      currentRevisionId: revisionId ?? undefined,
    }));
  }, [setScreenplay]);

  const handleCompareRevisions = useCallback((rev1Id: string, rev2Id: string) => {
    // TODO: Open revision compare modal
    void rev1Id;
    void rev2Id;
  }, []);

  // Toggle distraction-free mode
  const toggleDistractionFree = useCallback(() => {
    setDistractionFree(prev => !prev);
  }, []);

  // Toggle typewriter mode
  const toggleTypewriterMode = useCallback(() => {
    setTypewriterMode(prev => !prev);
  }, []);

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    setFocusMode(prev => !prev);
  }, []);

  // Update writing goal
  const handleUpdateWritingGoal = useCallback(async (goal: WritingGoal) => {
    setWritingGoal(goal);
    await saveWritingGoal(goal);
  }, []);

  // Track writing progress when screenplay changes
  useEffect(() => {
    if (!writingGoal || !screenplay.id) return;

    const timeoutId = window.setTimeout(() => {
      (async () => {
        try {
          const updatedSession = await updateTodaySession(screenplay.id, screenplay.elements, writingGoal);
          setWritingSessions(prev => {
            const today = new Date().toISOString().split('T')[0];
            const existing = prev.find(s => s.date === today && s.projectId === screenplay.id);
            if (existing) {
              return prev.map(s => s.id === existing.id ? updatedSession : s);
            }
            return [...prev, updatedSession];
          });
        } catch (error) {
          console.error('Failed to update writing session:', error);
        }
      })();
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [screenplay.elements, screenplay.id, writingGoal]);

  // Cycle theme - toggle between dark and light (skip system for direct toggle)
  const cycleTheme = useCallback(() => {
    setTheme(prev => {
      // If currently system, determine current effective theme and toggle to opposite
      if (prev === 'system') {
        const currentEffective = getEffectiveTheme('system');
        return currentEffective === 'dark' ? 'light' : 'dark';
      }
      // Otherwise, toggle between dark and light
      return prev === 'dark' ? 'light' : 'dark';
    });
  }, []);

  // Toggle AI enabled
  const toggleAI = useCallback((enabled: boolean) => {
    setAIEnabled(enabled);
    localStorage.setItem('screenwriter_ai_enabled', String(enabled));
  }, []);

  const toggleAIChatPanel = useCallback(() => {
    setShowAIChat(previous => {
      const next = !previous;
      if (next) {
        setHasOpenedAIChat(true);
        setShowNotesPanel(false);
      }
      return next;
    });
  }, []);

  const toggleNotesPanel = useCallback(() => {
    setShowNotesPanel(previous => {
      const next = !previous;
      if (next) setShowAIChat(false);
      return next;
    });
  }, []);

  // Apply AI command result
  const handleApplyAIResult = useCallback((elementId: string, newContent: string) => {
    setScreenplay(prev => ({
      ...prev,
      elements: prev.elements.map(el =>
        el.id === elementId ? { ...el, content: newContent } : el
      ),
    }));
  }, [setScreenplay]);

  // Inline AI Edit Handlers
  const handleProposeEdits = useCallback((edits: PendingEdit[]) => {
    if (edits.length === 0) return;
    const reconciledEdits = reconcilePendingEdits(edits, screenplayElementsRef.current);
    setPendingEdits(prev => {
      const next = new Map(prev);
      reconciledEdits.forEach(edit => next.set(edit.elementId, edit));
      return next;
    });
    setReviewElementId(current => current ?? reconciledEdits[0].elementId);
  }, []);

  const pendingEditList = useMemo(() => {
    const elementOrder = new Map(screenplay.elements.map((element, index) => [element.id, index]));
    return Array.from(pendingEdits.entries())
      .sort(([leftId], [rightId]) =>
        (elementOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER)
        - (elementOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER)
      );
  }, [pendingEdits, screenplay.elements]);

  const currentReviewIndex = Math.max(
    0,
    pendingEditList.findIndex(([elementId]) => elementId === reviewElementId),
  );
  const currentReviewEntry = pendingEditList[currentReviewIndex];
  const currentReviewElement = currentReviewEntry
    ? screenplay.elements.find(element => element.id === currentReviewEntry[0])
    : undefined;
  const currentReviewIsStale = Boolean(
    currentReviewEntry
    && (!currentReviewElement || currentReviewElement.content !== currentReviewEntry[1].originalContent)
  );
  const hasStalePendingEdit = pendingEditList.some(([elementId, edit]) => {
    const element = screenplay.elements.find(candidate => candidate.id === elementId);
    return !element || element.content !== edit.originalContent;
  });

  const focusReviewEdit = useCallback((elementId: string) => {
    setReviewElementId(elementId);
  }, []);

  useEffect(() => {
    if (reviewElementId) setFocusedElementId(reviewElementId);
  }, [reviewElementId]);

  const moveReview = useCallback((direction: -1 | 1) => {
    if (pendingEditList.length === 0) return;
    const nextIndex = Math.min(
      pendingEditList.length - 1,
      Math.max(0, currentReviewIndex + direction),
    );
    focusReviewEdit(pendingEditList[nextIndex][0]);
  }, [currentReviewIndex, focusReviewEdit, pendingEditList]);

  const advanceAfterDecision = useCallback((elementId: string) => {
    const decisionIndex = pendingEditList.findIndex(([id]) => id === elementId);
    const remaining = pendingEditList.filter(([id]) => id !== elementId);
    const nextEntry = remaining[Math.min(Math.max(decisionIndex, 0), remaining.length - 1)];
    if (nextEntry) {
      focusReviewEdit(nextEntry[0]);
    } else {
      setReviewElementId(null);
    }
  }, [focusReviewEdit, pendingEditList]);

  const handleAcceptEdit = useCallback((elementId: string) => {
    const edit = pendingEdits.get(elementId);
    if (!edit) return;
    const currentElement = screenplay.elements.find(element => element.id === elementId);
    if (!currentElement || currentElement.content !== edit.originalContent) return;

    setScreenplay(current => applyPendingEdit(current, elementId, edit));
    setPendingEdits(current => {
      const next = new Map(current);
      next.delete(elementId);
      return next;
    });
    advanceAfterDecision(elementId);
  }, [advanceAfterDecision, pendingEdits, screenplay.elements, setScreenplay]);

  const handleRejectEdit = useCallback((elementId: string) => {
    setPendingEdits(prev => {
      const next = new Map(prev);
      next.delete(elementId);
      return next;
    });
    advanceAfterDecision(elementId);
  }, [advanceAfterDecision]);

  const handleAcceptAllEdits = useCallback(() => {
    const validEdits = pendingEditList.filter(([elementId, edit]) =>
      screenplay.elements.some(element =>
        element.id === elementId && element.content === edit.originalContent
      )
    );
    if (validEdits.length !== pendingEditList.length) return;

    setScreenplay(current =>
      validEdits.reduce(
        (nextScreenplay, [elementId, edit]) =>
          applyPendingEdit(nextScreenplay, elementId, edit),
        current,
      )
    );
    setPendingEdits(new Map());
    setReviewElementId(null);
  }, [pendingEditList, screenplay.elements, setScreenplay]);

  const handleRejectAllEdits = useCallback(() => {
    setPendingEdits(new Map());
    setReviewElementId(null);
  }, []);

  // Script notes handlers
  const handleAddNote = useCallback((note: Omit<ScriptNote, 'id' | 'createdAt'>) => {
    const newNote: ScriptNote = {
      ...note,
      id: uuidv4(),
      createdAt: Date.now(),
    };
    setScreenplay(prev => ({
      ...prev,
      scriptNotes: [...(prev.scriptNotes || []), newNote],
    }));
  }, [setScreenplay]);

  const handleUpdateNote = useCallback((id: string, updates: Partial<ScriptNote>) => {
    setScreenplay(prev => ({
      ...prev,
      scriptNotes: (prev.scriptNotes || []).map(note =>
        note.id === id ? { ...note, ...updates } : note
      ),
    }));
  }, [setScreenplay]);

  const handleDeleteNote = useCallback((id: string) => {
    setScreenplay(prev => ({
      ...prev,
      scriptNotes: (prev.scriptNotes || []).filter(note => note.id !== id),
    }));
  }, [setScreenplay]);


  // Export to FDX
  const handleExportFdx = useCallback(() => {
    downloadFdx(screenplay);
  }, [screenplay]);

  // Get selected element for AI commands
  const selectedElement = useMemo(() => {
    if (!focusedElementId) return null;
    return screenplay.elements.find(el => el.id === focusedElementId) || null;
  }, [focusedElementId, screenplay.elements]);

  // Get preceding elements for AI context
  const precedingElements = useMemo(() => {
    if (!focusedElementId) return [];
    const currentIndex = screenplay.elements.findIndex(el => el.id === focusedElementId);
    if (currentIndex === -1) return [];
    return screenplay.elements.slice(Math.max(0, currentIndex - 10), currentIndex);
  }, [focusedElementId, screenplay.elements]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      // Undo: Cmd/Ctrl+Z
      if (modKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y
      if ((modKey && e.key === 'z' && e.shiftKey) || (modKey && e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // Find: Cmd/Ctrl+F
      if (modKey && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        setShowFindReplace(true);
        return;
      }

      // New screenplay: Cmd/Ctrl+N
      if (modKey && e.key === 'n') {
        e.preventDefault();
        handleNew();
        return;
      }

      // Help is available even while editing.
      if (e.key === 'F1') {
        e.preventDefault();
        setShowHelp(previous => !previous);
        return;
      }

      // F11: Toggle distraction-free mode
      if (e.key === 'F11') {
        e.preventDefault();
        toggleDistractionFree();
        return;
      }

      // Cmd/Ctrl+Shift+T: Toggle typewriter mode
      if (modKey && e.shiftKey && e.key === 't') {
        e.preventDefault();
        toggleTypewriterMode();
        return;
      }

      // Cmd/Ctrl+Shift+F: Toggle focus mode
      if (modKey && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        toggleFocusMode();
        return;
      }

      // Cmd/Ctrl+K: AI Command Palette
      if (modKey && e.key === 'k' && aiEnabled) {
        e.preventDefault();
        setShowAICommand(prev => !prev);
        return;
      }

      // Cmd/Ctrl+/: Toggle AI Chat
      if (modKey && e.key === '/' && aiEnabled) {
        e.preventDefault();
        toggleAIChatPanel();
        return;
      }

      // Don't trigger other shortcuts if typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        return;
      }

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowHelp(prev => !prev);
      }

      if (e.key === 'Escape') {
        if (showAICommand) {
          setShowAICommand(false);
        } else if (showAIChat) {
          setShowAIChat(false);
        } else if (showNotesPanel) {
          setShowNotesPanel(false);
        } else if (distractionFree) {
          setDistractionFree(false);
        } else {
          setShowHelp(false);
          setShowFindReplace(false);
          setShowProjectList(false);
          setShowTitlePage(false);
          setShowStatistics(false);
          setShowAISettings(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, handleNew, toggleDistractionFree, toggleTypewriterMode, toggleFocusMode, toggleAIChatPanel, distractionFree, aiEnabled, showAICommand, showAIChat, showNotesPanel, showBeatBoard]);

  const pageCount = estimatePageCount(screenplay);

  // Extract scenes for navigator
  const scenes = useMemo(() => {
    return screenplay.elements
      .filter(el => el.type === 'scene-heading')
      .map((el, idx) => ({
        id: el.id,
        number: idx + 1,
        heading: el.content || 'UNTITLED SCENE',
        synopsis: el.synopsis || '',
        notes: el.notes || '',
      }));
  }, [screenplay.elements]);

  // Extract characters with line counts
  const characters = useMemo(() => {
    const charMap = new Map<string, number>();

    let currentCharacter: string | null = null;

    for (const el of screenplay.elements) {
      if (el.type === 'character' && el.content.trim()) {
        // Normalize character name (uppercase, trim)
        currentCharacter = el.content.trim().toUpperCase();
        // Initialize if new character
        if (!charMap.has(currentCharacter)) {
          charMap.set(currentCharacter, 0);
        }
      } else if (el.type === 'dialogue' && currentCharacter) {
        // Count dialogue lines for the current character
        charMap.set(currentCharacter, (charMap.get(currentCharacter) || 0) + 1);
      } else if (el.type !== 'parenthetical') {
        // Reset current character for non-dialogue elements
        currentCharacter = null;
      }
    }

    // Convert to sorted array
    return Array.from(charMap.entries())
      .map(([name, lineCount]) => ({ name, lineCount }))
      .sort((a, b) => b.lineCount - a.lineCount); // Most lines first
  }, [screenplay.elements]);

  // Title page data for editor
  const titlePageData = useMemo(() => ({
    title: screenplay.title || '',
    author: screenplay.author || '',
    contact: screenplay.contact || '',
    draftDate: screenplay.draftDate || '',
    copyright: screenplay.copyright || '',
    basedOn: screenplay.basedOn || '',
  }), [screenplay]);

  // Calculate total duration for display
  const totalDuration = useMemo(() => {
    // Simple duration estimate: ~1 min per page
    const estimatedMinutes = pageCount;
    if (estimatedMinutes < 60) {
      return `${estimatedMinutes}m`;
    }
    const hours = Math.floor(estimatedMinutes / 60);
    const mins = estimatedMinutes % 60;
    return `${hours}h ${mins}m`;
  }, [pageCount]);

  // Calculate writing goal progress
  const goalProgress = useMemo(() => {
    if (!writingGoal) return undefined;

    const today = new Date().toISOString().split('T')[0];
    const todaySession = writingSessions.find(s => s.date === today && s.projectId === screenplay.id);

    if (!todaySession) return { current: 0, target: writingGoal.target, type: writingGoal.type === 'pages' ? 'pages' : 'words' };

    const wordCount = countWords(screenplay.elements);
    const pageCount = estimatePages(wordCount);

    let current = 0;
    if (writingGoal.type === 'pages') {
      current = Math.max(0, pageCount - todaySession.startPages);
    } else if (writingGoal.type === 'words') {
      current = Math.max(0, wordCount - todaySession.startWords);
    }

    return {
      current,
      target: writingGoal.target,
      type: writingGoal.type === 'pages' ? 'pages' : 'words',
    };
  }, [writingGoal, writingSessions, screenplay.id, screenplay.elements]);

  // Calculate writing streaks
  const currentStreak = useMemo(() => calculateStreak(writingSessions), [writingSessions]);
  const longestStreak = useMemo(() => calculateLongestStreak(writingSessions), [writingSessions]);

  const openBeatBoard = useCallback((beatId?: string) => {
    setBeatBoardSelectedBeatId(beatId ?? null);
    setBeatBoardView('board');
    setShowNotesPanel(false);
    setShowAICommand(false);
    setShowStoryboard(false);
    setShowBeatBoard(true);
  }, []);

  const currentSceneId = useMemo(() => {
    const targetId = activeElementId ?? focusedElementId;
    const targetIndex = targetId
      ? screenplay.elements.findIndex(element => element.id === targetId)
      : -1;
    for (let index = targetIndex >= 0 ? targetIndex : 0; index >= 0; index--) {
      if (screenplay.elements[index]?.type === 'scene-heading') {
        return screenplay.elements[index].id;
      }
    }
    return screenplay.elements.find(element => element.type === 'scene-heading')?.id || null;
  }, [activeElementId, focusedElementId, screenplay.elements]);

  const openStoryboard = useCallback((sceneId?: string | null) => {
    setStoryboardSceneId(sceneId || currentSceneId);
    setShowNotesPanel(false);
    setShowAICommand(false);
    setShowBeatBoard(false);
    setShowStoryboard(true);
  }, [currentSceneId]);

  const requestStoryboardAI = useCallback((sceneId: string) => {
    setStoryboardSceneId(sceneId);
    setRequestedAIChatMode('storyboard');
    setRequestedAIChatPrompt({
      id: uuidv4(),
      content: 'Create a complete visual shot list for the current scene. Use the screenplay, treatment, beats, adjacent scenes, and existing storyboard context to preserve tone and continuity.',
    });
    setShowAIChat(true);
    setHasOpenedAIChat(true);
  }, []);

  const handleAIChatModeChange = useCallback((mode: AIChatMode) => {
    setRequestedAIChatMode(undefined);
    if (mode === 'outline') {
      setShowNotesPanel(false);
      setShowAIChat(true);
      setHasOpenedAIChat(true);
      setBeatBoardView('board');
      setShowStoryboard(false);
      setShowBeatBoard(true);
    } else if (mode === 'storyboard') {
      setShowNotesPanel(false);
      setShowAIChat(true);
      setHasOpenedAIChat(true);
      setShowBeatBoard(false);
      setShowStoryboard(true);
      setStoryboardSceneId(currentSceneId);
    } else {
      setShowBeatBoard(false);
      setBeatBoardSelectedBeatId(null);
      setShowStoryboard(false);
    }
  }, [currentSceneId]);

  return (
    <div
      className={`app ${showAIChat ? 'ai-chat-open' : ''} ${showNotesPanel ? 'notes-panel-open' : ''} ${showBeatBoard ? 'beat-board-open' : ''} ${showStoryboard ? 'storyboard-open' : ''} ${distractionFree ? 'distraction-free' : ''}`}
      style={{
        '--ai-panel-width': `${aiPanelWidth}px`,
        '--right-panel-width': showAIChat ? `${aiPanelWidth}px` : '360px',
      } as React.CSSProperties}
    >
      {!isHydrated && (
        <div className="startup-loading" role="status" aria-live="polite">
          Loading screenplay…
        </div>
      )}
      <Header
        title={screenplay.title}
        author={screenplay.author}
        pageCount={pageCount}
        onTitleChange={handleTitleChange}
        onAuthorChange={handleAuthorChange}
        onExportPDF={handleExportPDF}
        onExportFountain={handleExportFountain}
        onNew={handleNew}
        onShowHelp={() => setShowHelp(true)}
        onShowProjects={() => setShowProjectList(true)}
        onShowTitlePage={() => setShowTitlePage(true)}
        onShowStatistics={() => setShowStatistics(true)}
        onShowBeatBoard={() => openBeatBoard()}
        onShowStoryboard={() => openStoryboard()}
        onShowSnapshots={() => setShowSnapshots(true)}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onImport={handleImport}
        theme={effectiveTheme}
        onToggleTheme={cycleTheme}
        distractionFree={distractionFree}
        onToggleDistractionFree={toggleDistractionFree}
        aiEnabled={aiEnabled}
        onToggleAIChat={toggleAIChatPanel}
        onShowAISettings={() => setShowAISettings(true)}
        showAIChat={showAIChat}
        sceneNumberingEnabled={screenplay.sceneNumberingEnabled}
        scenesLocked={screenplay.scenesLocked}
        onToggleSceneNumbering={handleToggleSceneNumbering}
        onToggleScenesLocked={handleToggleScenesLocked}
        onShowRevisions={() => setShowRevisions(true)}
        onShowPrintPreview={() => setShowPrintPreview(true)}
        onShowNotesPanel={toggleNotesPanel}
        onExportFdx={handleExportFdx}
        showNotesPanel={showNotesPanel}
        totalDuration={totalDuration}
        typewriterMode={typewriterMode}
        focusMode={focusMode}
        onToggleTypewriterMode={toggleTypewriterMode}
        onToggleFocusMode={toggleFocusMode}
        onShowWritingGoals={() => setShowWritingGoals(true)}
        goalProgress={goalProgress}
        onShowCharacterTracker={() => setShowCharacterTracker(true)}
        onShowSceneCompare={() => setShowSceneCompare(true)}
        saveStatus={saveStatus}
      />
      <div
        ref={screenplayWorkspaceRef}
        className="screenplay-workspace"
        aria-hidden={showBeatBoard || showStoryboard || undefined}
      >
      <div className="main-content">
        <SceneNavigator
          scenes={scenes}
          characters={characters}
          elements={screenplay.elements}
          beats={screenplay.beats || []}
          beatStructure={screenplay.beatStructure || 'three-act'}
          onOpenBeatBoard={openBeatBoard}
          onSceneClick={handleFocusElement}
          onSynopsisChange={handleSynopsisChange}
          onNotesChange={handleNotesChange}
          onReorderElements={handleReorderElements}
        />
        <div className="editor-container">
          <ScriptEditor
            elements={screenplay.elements}
            focusedElementId={focusedElementId}
            onElementChange={handleElementChange}
            onElementTypeChange={handleElementTypeChange}
            onAddElement={handleAddElement}
            onDeleteElement={handleDeleteElement}
            onFocusConsumed={handleFocusConsumed}
            onStartDualDialogue={handleStartDualDialogue}
            autoContd={screenplay.autoContd}
            typewriterMode={typewriterMode}
            focusMode={focusMode}
            // Inline AI Edits
            pendingEdits={pendingEdits}
            reviewElementId={currentReviewEntry?.[0] || null}
            // Track active element for notes panel
            onActiveElementChange={setActiveElementId}
          />
        </div>
      </div>
      {currentReviewEntry && (
        <EditReviewBar
          current={currentReviewIndex + 1}
          total={pendingEditList.length}
          edit={currentReviewEntry[1]}
          label={currentReviewElement ? ELEMENT_LABELS[currentReviewElement.type] : 'Screenplay element'}
          hasPrevious={currentReviewIndex > 0}
          hasNext={currentReviewIndex < pendingEditList.length - 1}
          isStale={currentReviewIsStale}
          hasConflicts={hasStalePendingEdit}
          onPrevious={() => moveReview(-1)}
          onNext={() => moveReview(1)}
          onAccept={() => handleAcceptEdit(currentReviewEntry[0])}
          onReject={() => handleRejectEdit(currentReviewEntry[0])}
          onAcceptAll={handleAcceptAllEdits}
          onRejectAll={handleRejectAllEdits}
        />
      )}
      </div>
      {showBeatBoard && (
        <div className="beat-board-overlay" role="region" aria-label="Story outline">
          <Suspense fallback={<ToolLoadingFallback />}>
            <BeatBoard
              beats={screenplay.beats || []}
              beatStructure={screenplay.beatStructure || 'three-act'}
              elements={screenplay.elements}
              treatment={screenplay.treatment || ''}
              onBeatsChange={handleBeatsChange}
              onTreatmentChange={handleTreatmentChange}
              onStructureChange={handleBeatStructureChange}
              activeView={beatBoardView}
              onViewChange={setBeatBoardView}
              selectedBeatId={beatBoardSelectedBeatId}
              onClose={() => {
                setShowBeatBoard(false);
                setBeatBoardSelectedBeatId(null);
              }}
            />
          </Suspense>
        </div>
      )}
      {showStoryboard && (
        <div className="scene-storyboard-overlay" role="region" aria-label="Scene storyboard">
          <Suspense fallback={<ToolLoadingFallback />}>
            <SceneStoryboard
              elements={screenplay.elements}
              storyboards={screenplay.storyboards || {}}
              initialSceneId={storyboardSceneId}
              onStoryboardsChange={handleStoryboardsChange}
              onRequestAI={requestStoryboardAI}
              onGenerateShot={handleGenerateStoryboardShot}
              onJumpToScene={(sceneId) => {
                setShowStoryboard(false);
                handleFocusElement(sceneId);
              }}
              onClose={() => setShowStoryboard(false)}
            />
          </Suspense>
        </div>
      )}
      <KeyboardHelp isOpen={showHelp} onClose={() => setShowHelp(false)} />
      <FindReplace
        isOpen={showFindReplace}
        onClose={() => setShowFindReplace(false)}
        elements={screenplay.elements}
        onReplaceAll={handleReplaceAll}
        onFocusElement={handleFocusElement}
      />
      <ProjectList
        isOpen={showProjectList}
        onClose={() => setShowProjectList(false)}
        projects={projects}
        currentProjectId={screenplay.id}
        onSelectProject={handleSwitchProject}
        onNewProject={handleNew}
        onDeleteProject={handleDeleteProject}
      />
      <Suspense fallback={<ToolLoadingFallback />}>
        {showTitlePage && (
          <TitlePageEditor
            isOpen
            onClose={() => setShowTitlePage(false)}
            data={titlePageData}
            onSave={handleSaveTitlePage}
          />
        )}
        {showStatistics && (
          <Statistics
            isOpen
            onClose={() => setShowStatistics(false)}
            elements={screenplay.elements}
            pageCount={pageCount}
          />
        )}
      </Suspense>

      {/* AI Features */}
      {hasOpenedAIChat && (
        <Suspense fallback={showAIChat ? <RightPanelLoadingFallback /> : null}>
          <AIChat
            isOpen={showAIChat}
            onClose={() => setShowAIChat(false)}
            screenplay={screenplay}
            // Prefer the editor's currently active element; fall back to navigator-driven focus.
            currentElementId={showStoryboard && storyboardSceneId
              ? storyboardSceneId
              : activeElementId ?? focusedElementId}
            onProposeEdits={handleProposeEdits}
            onApplyBeatOps={handleApplyBeatOps}
            onApplyStoryboardOps={handleApplyStoryboardOps}
            projectId={screenplay.id}
            pendingEdits={pendingEdits}
            onJumpToElement={handleFocusElement}
            width={aiPanelWidth}
            onWidthChange={setAIPanelWidth}
            onModeChange={handleAIChatModeChange}
            requestedMode={requestedAIChatMode}
            requestedPrompt={requestedAIChatPrompt}
          />
        </Suspense>
      )}
      <Suspense fallback={<ToolLoadingFallback />}>
        {showAICommand && (
          <AICommandPalette
            isOpen
            onClose={() => setShowAICommand(false)}
            selectedElement={selectedElement}
            precedingElements={precedingElements}
            onApplyResult={handleApplyAIResult}
          />
        )}
        {showAISettings && (
          <AISettings
            isOpen
            onClose={() => setShowAISettings(false)}
            aiEnabled={aiEnabled}
            onToggleAI={toggleAI}
          />
        )}
      </Suspense>

      {/* Writing Goals */}
      <Suspense fallback={<ToolLoadingFallback />}>
        {showWritingGoals && (
          <WritingGoals
            isOpen
            onClose={() => setShowWritingGoals(false)}
            goal={writingGoal}
            sessions={writingSessions}
            currentStreak={currentStreak}
            longestStreak={longestStreak}
            todayProgress={goalProgress || { current: 0, target: 3 }}
            onUpdateGoal={handleUpdateWritingGoal}
          />
        )}

      {/* Character Tracker */}
      {showCharacterTracker && (
        <CharacterTracker
          isOpen={showCharacterTracker}
          onClose={() => setShowCharacterTracker(false)}
          elements={screenplay.elements}
          onJumpToScene={handleFocusElement}
        />
      )}

      {/* Scene Compare */}
      {showSceneCompare && (
        <SceneCompare
          isOpen={showSceneCompare}
          onClose={() => setShowSceneCompare(false)}
          currentScreenplay={screenplay}
          snapshots={screenplay.snapshots || []}
          onRenameSnapshot={handleRenameSnapshot}
          onJumpToScene={handleFocusElement}
        />
      )}

      {/* Snapshots Panel */}
      {showSnapshots && (
        <SnapshotsPanel
          screenplay={screenplay}
          onClose={() => setShowSnapshots(false)}
          onCreateSnapshot={handleCreateSnapshot}
          onRestoreSnapshot={handleRestoreSnapshot}
          onDeleteSnapshot={handleDeleteSnapshot}
          onRenameSnapshot={handleRenameSnapshot}
        />
      )}

      {/* Revision Manager */}
      {showRevisions && (
        <RevisionManager
          screenplay={screenplay}
          onClose={() => setShowRevisions(false)}
          onCreateRevision={handleCreateRevision}
          onSetActiveRevision={handleSetActiveRevision}
          onCompareRevisions={handleCompareRevisions}
        />
      )}

      {/* Print Preview */}
        {showPrintPreview && (
          <PrintPreview
            isOpen
            onClose={() => setShowPrintPreview(false)}
            screenplay={screenplay}
          />
        )}
      </Suspense>

      {/* Notes Panel */}
      <NotesPanel
        isOpen={showNotesPanel}
        onClose={() => setShowNotesPanel(false)}
        notes={screenplay.scriptNotes || []}
        elements={screenplay.elements}
        selectedElementId={selectedElementId}
        focusedElementId={activeElementId}
        onAddNote={handleAddNote}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
        onJumpToElement={handleFocusElement}
      />
    </div>
  );
}

export default App;
