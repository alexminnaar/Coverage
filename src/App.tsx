import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Screenplay, ScriptElement, ElementType, getDefaultNextType, ProjectMeta, Theme, Beat, BeatStructure, Revision, PendingEdit } from './types';
import {
  loadCurrentScreenplay,
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
import { exportToPDF, estimatePageCount } from './pdfExport';
import { useHistory } from './hooks/useHistory';
import { parseFountainFile, extractTitlePage } from './utils/fountainParser';
import { downloadFountain } from './utils/fountainExporter';
import { toggleSceneNumbering, toggleScenesLocked } from './utils/sceneNumbers';
import { startDualDialogue } from './utils/dualDialogue';
import Header from './components/Header';
import SceneNavigator from './components/SceneNavigator';
import ScriptEditor from './components/ScriptEditor';
import KeyboardHelp from './components/KeyboardHelp';
import FindReplace from './components/FindReplace';
import ProjectList from './components/ProjectList';
import TitlePageEditor from './components/TitlePageEditor';
import Statistics from './components/Statistics';
import BeatBoard from './components/BeatBoard';
import AIChat from './components/AIChat';
import AICommandPalette from './components/AICommandPalette';
import AISettings from './components/AISettings';
import SnapshotsPanel from './components/SnapshotsPanel';
import RevisionManager from './components/RevisionManager';
import PrintPreview from './components/PrintPreview';
import NotesPanel from './components/NotesPanel';
import WritingGoals from './components/WritingGoals';
import CharacterTracker from './components/CharacterTracker';
import SceneCompare from './components/SceneCompare';
import { downloadFdx } from './utils/fdxExporter';
import { ScriptNote, WritingGoal, WritingSession } from './types';
import {
  loadWritingGoal,
  saveWritingGoal,
  loadWritingSessions,
  updateTodaySession,
} from './storage';
import { calculateStreak, calculateLongestStreak, countWords, estimatePages } from './utils/writingStats';

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

function App() {
  // Use history hook for undo/redo
  const {
    state: screenplay,
    setState: setScreenplay,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory
  } = useHistory<Screenplay>(() => loadCurrentScreenplay(), { maxHistory: 50 });

  const [focusedElementId, setFocusedElementId] = useState<string | null>(null);
  const [activeElementId, setActiveElementId] = useState<string | null>(null); // Currently active/focused element in editor
  const [showHelp, setShowHelp] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showProjectList, setShowProjectList] = useState(false);
  const [showTitlePage, setShowTitlePage] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [showBeatBoard, setShowBeatBoard] = useState(false);
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
  const [showAICommand, setShowAICommand] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiPanelWidth, setAIPanelWidth] = useState(400);

  // Pending AI edits (Cursor-style inline edits)
  const [pendingEdits, setPendingEdits] = useState<Map<string, PendingEdit>>(new Map());

  // Track if we're saving to avoid undo issues
  const isSavingRef = useRef(false);

  // Initialize API mode and load projects on mount
  useEffect(() => {
    initAPIMode();
    const loadProjects = async () => {
      try {
        const loadedProjects = await loadProjectsList();
        setProjects(loadedProjects);
      } catch (error) {
        console.error('Failed to load projects:', error);
      }
    };
    loadProjects();
  }, []);

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
      isSavingRef.current = true;
      try {
        await saveProject(sp);
        // Refresh projects list
        const updatedProjects = await loadProjectsList();
        setProjects(updatedProjects);
      } catch (error) {
        console.error('Failed to save project:', error);
      } finally {
        isSavingRef.current = false;
      }
    }, 500),
    []
  );

  // Auto-save when screenplay changes
  useEffect(() => {
    debouncedSave(screenplay);
  }, [screenplay, debouncedSave]);

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
      const newElements = prev.elements.filter(el => el.id !== id);

      // Focus the previous element, or the next if deleting the first
      const focusIdx = Math.max(0, idx - 1);
      if (newElements[focusIdx]) {
        setFocusedElementId(newElements[focusIdx].id);
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
  const handleExportPDF = useCallback(() => {
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
      setScreenplay(newProject);
      clearHistory();
      const updatedProjects = await loadProjectsList();
      setProjects(updatedProjects);
      setShowProjectList(false);
    } catch (error) {
      console.error('Failed to create new project:', error);
    }
  }, [setScreenplay, clearHistory]);

  // Switch to a different project
  const handleSwitchProject = useCallback(async (id: string) => {
    try {
      const project = await loadProject(id);
      if (project) {
        setCurrentProjectId(id);
        setScreenplay(project);
        clearHistory();
        setShowProjectList(false);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  }, [setScreenplay, clearHistory]);

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
      setScreenplay(imported);
      clearHistory();
      const updatedProjects = await loadProjectsList();
      setProjects(updatedProjects);
    } catch (e) {
      console.error('Failed to import file:', e);
      alert('Failed to import file. Please check the format.');
    }
  }, [setScreenplay, clearHistory]);

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

  const handleBeatStructureChange = useCallback((beatStructure: BeatStructure) => {
    setScreenplay(prev => ({ ...prev, beatStructure }));
  }, [setScreenplay]);


  // Snapshot handlers
  const handleCreateSnapshot = useCallback(async (name: string) => {
    const updated = await createSnapshot(screenplay, name);
    setScreenplay(updated);
  }, [screenplay, setScreenplay]);

  const handleRestoreSnapshot = useCallback(async (snapshotId: string) => {
    const updated = await restoreFromSnapshot(screenplay, snapshotId);
    if (updated) {
      setScreenplay(updated);
      clearHistory();
    }
  }, [screenplay, setScreenplay, clearHistory]);

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
    if (writingGoal && screenplay.id) {
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
    }
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
    setPendingEdits(prev => {
      const next = new Map(prev);
      edits.forEach(edit => next.set(edit.elementId, edit));
      return next;
    });
  }, []);

  const handleAcceptEdit = useCallback((elementId: string) => {
    setPendingEdits(prev => {
      const edit = prev.get(elementId);
      if (!edit) {
        console.warn('No edit found for', elementId);
        return prev;
      }

      // Parse the new content to check for multiple elements
      // Split by double newline which typically separates elements in Fountain/screenplays

      // Check if this is a simple update (single element) or complex (multiple elements)
      // Complex if: multiple parts in newContent OR newElements array exists
      // We need to check parts.length, so split here
      const parts = edit.newContent.split(/\n\n+/);
      const isSimpleUpdate = parts.length <= 1 && (!edit.newElements || edit.newElements.length === 0);

      if (isSimpleUpdate) {
        // Simple update if only one part and no new elements
        setScreenplay(sp => ({
          ...sp,
          elements: sp.elements.map(el =>
            el.id === elementId ? { ...el, content: edit.newContent } : el
          )
        }));
      } else {
        // Complex update: split into multiple elements
        setScreenplay(sp => {
          const index = sp.elements.findIndex(el => el.id === elementId);
          if (index === -1) return sp;

          const oldElement = sp.elements[index];

          // Check if this is an insert-only operation (no actual edit to the element)
          const isInsertOnly = edit.originalContent === edit.newContent;

          // Only update the element content if it actually changed
          const updatedFirstElement = isInsertOnly
            ? oldElement  // Keep original element unchanged
            : { ...oldElement, content: edit.newContent };  // Update with new content

          const newElements: ScriptElement[] = [];

          // Check if we have structured elements from the AI
          if (edit.newElements && edit.newElements.length > 0) {
            // Use structured elements directly - no parsing needed!
            for (const structuredEl of edit.newElements) {
              newElements.push({
                id: uuidv4(),
                type: structuredEl.type,
                content: structuredEl.content
              });
            }
          } else {
            // Fallback: parse newContent for backward compatibility
            // First part updates the existing element
            const firstContent = parts[0];
            updatedFirstElement.content = firstContent;

            // Subsequent parts become new elements - use heuristics
            for (let i = 1; i < parts.length; i++) {
              const content = parts[i].trim();
              if (!content) continue;

              let type: ElementType = 'action';

              // Simple heuristics for element type
              if (content === content.toUpperCase() && content.length < 50) {
                type = 'character';
              } else if (content.startsWith('(') && content.endsWith(')')) {
                type = 'parenthetical';
              } else if (content.toUpperCase().startsWith('INT.') || content.toUpperCase().startsWith('EXT.')) {
                type = 'scene-heading';
              } else {
                // If previous was character, this is likely dialogue
                const prevType = newElements.length > 0
                  ? newElements[newElements.length - 1].type
                  : (i === 1 ? updatedFirstElement.type : 'action');

                if (prevType === 'character') {
                  type = 'dialogue';
                } else if (prevType === 'dialogue') {
                  type = 'action';
                }
              }

              // Special case: if the AI output "Character\nDialogue", split that too
              if (content.includes('\n') && type === 'action') {
                const subParts = content.split('\n');
                if (subParts.length === 2 && subParts[0] === subParts[0].toUpperCase()) {
                  // It's likely Character\nDialogue
                  newElements.push({
                    id: uuidv4(),
                    type: 'character',
                    content: subParts[0].trim()
                  });
                  newElements.push({
                    id: uuidv4(),
                    type: 'dialogue',
                    content: subParts[1].trim()
                  });
                  continue;
                }
              }

              newElements.push({
                id: uuidv4(),
                type,
                content
              });
            }
          }

          const newElementList = [...sp.elements];
          newElementList.splice(index, 1, updatedFirstElement, ...newElements);

          return {
            ...sp,
            elements: newElementList
          };
        });
      }
      // Remove from pending
      const next = new Map(prev);
      next.delete(elementId);
      return next;
    });
  }, [setScreenplay]);

  const handleRejectEdit = useCallback((elementId: string) => {
    setPendingEdits(prev => {
      const next = new Map(prev);
      next.delete(elementId);
      return next;
    });
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
      if (modKey && e.key === 'f') {
        e.preventDefault();
        setShowFindReplace(true);
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
        setShowAIChat(prev => !prev);
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
  }, [undo, redo, toggleDistractionFree, toggleTypewriterMode, toggleFocusMode, distractionFree, aiEnabled, showAICommand, showAIChat]);

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

  // If Beat Board is open, show it instead of the main editor
  if (showBeatBoard) {
    return (
      <div className={`app ${distractionFree ? 'distraction-free' : ''}`}>
        <BeatBoard
          beats={screenplay.beats || []}
          beatStructure={screenplay.beatStructure || 'three-act'}
          elements={screenplay.elements}
          onBeatsChange={handleBeatsChange}
          onStructureChange={handleBeatStructureChange}
          onClose={() => setShowBeatBoard(false)}
        />
      </div>
    );
  }


  return (
    <div
      className={`app ${showAIChat ? 'ai-chat-open' : ''}`}
      style={{ '--ai-panel-width': `${aiPanelWidth}px` } as React.CSSProperties}
    >
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
        onShowBeatBoard={() => setShowBeatBoard(true)}
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
        onToggleAIChat={() => setShowAIChat(prev => !prev)}
        onShowAISettings={() => setShowAISettings(true)}
        showAIChat={showAIChat}
        sceneNumberingEnabled={screenplay.sceneNumberingEnabled}
        scenesLocked={screenplay.scenesLocked}
        onToggleSceneNumbering={handleToggleSceneNumbering}
        onToggleScenesLocked={handleToggleScenesLocked}
        onShowRevisions={() => setShowRevisions(true)}
        onShowPrintPreview={() => setShowPrintPreview(true)}
        onShowNotesPanel={() => setShowNotesPanel(prev => !prev)}
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
      />
      <div className="main-content">
        <SceneNavigator
          scenes={scenes}
          characters={characters}
          elements={screenplay.elements}
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
            onAcceptEdit={handleAcceptEdit}
            onRejectEdit={handleRejectEdit}
            // Track active element for notes panel
            onActiveElementChange={setActiveElementId}
          />
        </div>
      </div>
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
      <TitlePageEditor
        isOpen={showTitlePage}
        onClose={() => setShowTitlePage(false)}
        data={titlePageData}
        onSave={handleSaveTitlePage}
      />
      <Statistics
        isOpen={showStatistics}
        onClose={() => setShowStatistics(false)}
        elements={screenplay.elements}
        pageCount={pageCount}
      />

      {/* AI Features */}
      <AIChat
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        elements={screenplay.elements}
        // Prefer the editor's currently active element; fall back to navigator-driven focus.
        currentElementId={activeElementId ?? focusedElementId}
        onProposeEdits={handleProposeEdits}
        projectId={screenplay.id}
        pendingEdits={pendingEdits}
        onJumpToElement={handleFocusElement}
        onAcceptEdit={handleAcceptEdit}
        onRejectEdit={handleRejectEdit}
        width={aiPanelWidth}
        onWidthChange={setAIPanelWidth}
      />
      <AICommandPalette
        isOpen={showAICommand}
        onClose={() => setShowAICommand(false)}
        selectedElement={selectedElement}
        precedingElements={precedingElements}
        onApplyResult={handleApplyAIResult}
      />
      <AISettings
        isOpen={showAISettings}
        onClose={() => setShowAISettings(false)}
        aiEnabled={aiEnabled}
        onToggleAI={toggleAI}
      />

      {/* Writing Goals */}
      <WritingGoals
        isOpen={showWritingGoals}
        onClose={() => setShowWritingGoals(false)}
        goal={writingGoal}
        sessions={writingSessions}
        currentStreak={currentStreak}
        longestStreak={longestStreak}
        todayProgress={goalProgress || { current: 0, target: 3 }}
        onUpdateGoal={handleUpdateWritingGoal}
      />

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
      <PrintPreview
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        screenplay={screenplay}
      />

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
