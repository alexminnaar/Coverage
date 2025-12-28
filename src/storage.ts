import { Screenplay, ScriptElement, ProjectMeta, ScriptSnapshot } from './types';
import { v4 as uuidv4 } from 'uuid';
import { estimatePageCount } from './pdfExport';
import * as apiClient from './services/apiClient';

const MAX_SNAPSHOTS = 20;

// Storage keys
const PROJECTS_LIST_KEY = 'screenwriter_projects';
const PROJECT_PREFIX = 'screenwriter_project_';
const CURRENT_PROJECT_KEY = 'screenwriter_current_project';
const LEGACY_KEY = 'screenwriter_screenplay'; // Old single-project key

// Create a new empty screenplay
export function createDefaultScreenplay(): Screenplay {
  const now = Date.now();
  const defaultElement: ScriptElement = {
    id: uuidv4(),
    type: 'scene-heading',
    content: '',
  };

  return {
    id: uuidv4(),
    title: 'Untitled Screenplay',
    author: '',
    elements: [defaultElement],
    updatedAt: now,
    createdAt: now,
  };
}

// Get project metadata from a screenplay
function getProjectMeta(screenplay: Screenplay): ProjectMeta {
  return {
    id: screenplay.id,
    title: screenplay.title,
    author: screenplay.author,
    updatedAt: screenplay.updatedAt,
    createdAt: screenplay.createdAt,
    pageCount: estimatePageCount(screenplay),
  };
}

// Load all project metadata
export async function loadProjectsList(): Promise<ProjectMeta[]> {
  try {
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI) {
      return await apiClient.fetchProjects();
    }
  } catch (e) {
    console.warn('API unavailable, falling back to localStorage:', e);
    apiClient.setUseAPI(false);
  }
  
  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(PROJECTS_LIST_KEY);
    if (stored) {
      return JSON.parse(stored) as ProjectMeta[];
    }
  } catch (e) {
    console.error('Failed to load projects list:', e);
  }
  return [];
}

// Synchronous version for backward compatibility (returns empty array, will be loaded async)
export function loadProjectsListSync(): ProjectMeta[] {
  try {
    const stored = localStorage.getItem(PROJECTS_LIST_KEY);
    if (stored) {
      return JSON.parse(stored) as ProjectMeta[];
    }
  } catch (e) {
    console.error('Failed to load projects list:', e);
  }
  return [];
}

// Save project metadata list
function saveProjectsList(projects: ProjectMeta[]): void {
  try {
    localStorage.setItem(PROJECTS_LIST_KEY, JSON.stringify(projects));
  } catch (e) {
    console.error('Failed to save projects list:', e);
  }
}

// Update a project's metadata in the list (sync version for backward compatibility)
function updateProjectInList(meta: ProjectMeta): void {
  const projects = loadProjectsListSync();
  const idx = projects.findIndex(p => p.id === meta.id);
  if (idx >= 0) {
    projects[idx] = meta;
  } else {
    projects.unshift(meta); // Add new project at the beginning
  }
  // Sort by updatedAt descending
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  saveProjectsList(projects);
}

// Remove a project from the list (sync version for backward compatibility)
function removeProjectFromList(id: string): void {
  const projects = loadProjectsListSync().filter(p => p.id !== id);
  saveProjectsList(projects);
}

// Load a specific project
export async function loadProject(id: string): Promise<Screenplay | null> {
  try {
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI) {
      try {
        return await apiClient.fetchProject(id);
      } catch (e: any) {
        if (e.message === 'Project not found') {
          return null;
        }
        throw e;
      }
    }
  } catch (e) {
    console.warn('API unavailable, falling back to localStorage:', e);
    apiClient.setUseAPI(false);
  }
  
  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(PROJECT_PREFIX + id);
    if (stored) {
      const parsed = JSON.parse(stored) as Screenplay;
      // Ensure we have at least one element
      if (!parsed.elements || parsed.elements.length === 0) {
        parsed.elements = [{
          id: uuidv4(),
          type: 'scene-heading',
          content: '',
        }];
      }
      // Ensure createdAt exists
      if (!parsed.createdAt) {
        parsed.createdAt = parsed.updatedAt || Date.now();
      }
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load project:', e);
  }
  return null;
}

// Synchronous version for backward compatibility
export function loadProjectSync(id: string): Screenplay | null {
  try {
    const stored = localStorage.getItem(PROJECT_PREFIX + id);
    if (stored) {
      const parsed = JSON.parse(stored) as Screenplay;
      // Ensure we have at least one element
      if (!parsed.elements || parsed.elements.length === 0) {
        parsed.elements = [{
          id: uuidv4(),
          type: 'scene-heading',
          content: '',
        }];
      }
      // Ensure createdAt exists
      if (!parsed.createdAt) {
        parsed.createdAt = parsed.updatedAt || Date.now();
      }
      return parsed;
    }
  } catch (e) {
    console.error('Failed to load project:', e);
  }
  return null;
}

// Save a project
export async function saveProject(screenplay: Screenplay): Promise<void> {
  try {
    const toSave = {
      ...screenplay,
      updatedAt: Date.now(),
    };
    
    // Try API first
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI) {
      try {
        // Check if project exists
        const existing = await apiClient.fetchProject(screenplay.id).catch(() => null);
        if (existing) {
          await apiClient.updateProject(toSave);
        } else {
          await apiClient.createProject(toSave);
        }
        // Also save to localStorage as backup
        localStorage.setItem(PROJECT_PREFIX + screenplay.id, JSON.stringify(toSave));
        updateProjectInList(getProjectMeta(toSave));
        return;
      } catch (e) {
        console.warn('API save failed, falling back to localStorage:', e);
        apiClient.setUseAPI(false);
      }
    }
    
    // Fallback to localStorage
    localStorage.setItem(PROJECT_PREFIX + screenplay.id, JSON.stringify(toSave));
    updateProjectInList(getProjectMeta(toSave));
  } catch (e) {
    console.error('Failed to save project:', e);
  }
}

// Synchronous version for backward compatibility (saves to localStorage only)
export function saveProjectSync(screenplay: Screenplay): void {
  try {
    const toSave = {
      ...screenplay,
      updatedAt: Date.now(),
    };
    localStorage.setItem(PROJECT_PREFIX + screenplay.id, JSON.stringify(toSave));
    updateProjectInList(getProjectMeta(toSave));
  } catch (e) {
    console.error('Failed to save project:', e);
  }
}

// Delete a project
export async function deleteProject(id: string): Promise<void> {
  try {
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI) {
      try {
        await apiClient.deleteProjectById(id);
        // Also remove from localStorage
        localStorage.removeItem(PROJECT_PREFIX + id);
        removeProjectFromList(id);
        return;
      } catch (e) {
        console.warn('API delete failed, falling back to localStorage:', e);
        apiClient.setUseAPI(false);
      }
    }
    
    // Fallback to localStorage
    localStorage.removeItem(PROJECT_PREFIX + id);
    removeProjectFromList(id);
  } catch (e) {
    console.error('Failed to delete project:', e);
  }
}

// Synchronous version for backward compatibility
export function deleteProjectSync(id: string): void {
  try {
    localStorage.removeItem(PROJECT_PREFIX + id);
    removeProjectFromList(id);
  } catch (e) {
    console.error('Failed to delete project:', e);
  }
}

// Get/set current project ID
export function getCurrentProjectId(): string | null {
  return localStorage.getItem(CURRENT_PROJECT_KEY);
}

export function setCurrentProjectId(id: string): void {
  localStorage.setItem(CURRENT_PROJECT_KEY, id);
}

// Migrate legacy data to new format
function migrateLegacyData(): Screenplay | null {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Screenplay;
      // Ensure it has required fields
      if (!parsed.createdAt) {
        parsed.createdAt = parsed.updatedAt || Date.now();
      }
      // Save in new format
      saveProject(parsed);
      setCurrentProjectId(parsed.id);
      // Remove legacy data
      localStorage.removeItem(LEGACY_KEY);
      return parsed;
    }
  } catch (e) {
    console.error('Failed to migrate legacy data:', e);
  }
  return null;
}

// Load the current screenplay (with migration support) - async version
export async function loadCurrentScreenplayAsync(): Promise<Screenplay> {
  // Try to migrate legacy data first
  const migrated = migrateLegacyData();
  if (migrated) {
    await saveProject(migrated);
    return migrated;
  }

  // Check for current project
  const currentId = getCurrentProjectId();
  if (currentId) {
    const project = await loadProject(currentId);
    if (project) {
      return project;
    }
  }

  // Check if there are any projects
  const projects = await loadProjectsList();
  if (projects.length > 0) {
    const project = await loadProject(projects[0].id);
    if (project) {
      setCurrentProjectId(project.id);
      return project;
    }
  }

  // Create a new default project
  const newProject = createDefaultScreenplay();
  await saveProject(newProject);
  setCurrentProjectId(newProject.id);
  return newProject;
}

// Load the current screenplay (with migration support) - sync version for backward compatibility
export function loadCurrentScreenplay(): Screenplay {
  // Try to migrate legacy data first
  const migrated = migrateLegacyData();
  if (migrated) {
    return migrated;
  }

  // Check for current project
  const currentId = getCurrentProjectId();
  if (currentId) {
    const project = loadProjectSync(currentId);
    if (project) {
      return project;
    }
  }

  // Check if there are any projects
  const projects = loadProjectsListSync();
  if (projects.length > 0) {
    const project = loadProjectSync(projects[0].id);
    if (project) {
      setCurrentProjectId(project.id);
      return project;
    }
  }

  // Create a new default project
  const newProject = createDefaultScreenplay();
  saveProjectSync(newProject);
  setCurrentProjectId(newProject.id);
  return newProject;
}

// Create a new project and return it - async version
export async function createNewProjectAsync(): Promise<Screenplay> {
  const newProject = createDefaultScreenplay();
  await saveProject(newProject);
  setCurrentProjectId(newProject.id);
  return newProject;
}

// Create a new project and return it - sync version for backward compatibility
export function createNewProject(): Screenplay {
  const newProject = createDefaultScreenplay();
  saveProjectSync(newProject);
  setCurrentProjectId(newProject.id);
  return newProject;
}

// Debounce utility for auto-save
export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// ============================================
// SNAPSHOT FUNCTIONS
// ============================================

/**
 * Create a snapshot of the current screenplay state
 */
export async function createSnapshot(screenplay: Screenplay, name: string): Promise<Screenplay> {
  const snapshot: ScriptSnapshot = {
    id: uuidv4(),
    name,
    createdAt: Date.now(),
    elements: JSON.parse(JSON.stringify(screenplay.elements)), // Deep clone
    title: screenplay.title,
    author: screenplay.author,
  };

  const updatedScreenplay = {
    ...screenplay,
    snapshots: [snapshot, ...(screenplay.snapshots || [])].slice(0, MAX_SNAPSHOTS),
    updatedAt: Date.now(),
  };

  await saveProject(updatedScreenplay);
  return updatedScreenplay;
}

/**
 * Restore a screenplay from a snapshot
 */
export async function restoreFromSnapshot(screenplay: Screenplay, snapshotId: string): Promise<Screenplay | null> {
  const snapshots = screenplay.snapshots || [];
  const snapshot = snapshots.find(s => s.id === snapshotId);
  
  if (!snapshot) {
    return null;
  }

  // Create a backup snapshot before restoring
  const backupSnapshot: ScriptSnapshot = {
    id: uuidv4(),
    name: `Backup before restoring "${snapshot.name}"`,
    createdAt: Date.now(),
    elements: JSON.parse(JSON.stringify(screenplay.elements)),
    title: screenplay.title,
    author: screenplay.author,
  };

  const updatedScreenplay: Screenplay = {
    ...screenplay,
    title: snapshot.title,
    author: snapshot.author,
    elements: JSON.parse(JSON.stringify(snapshot.elements)), // Deep clone
    snapshots: [backupSnapshot, ...snapshots].slice(0, MAX_SNAPSHOTS),
    updatedAt: Date.now(),
  };

  await saveProject(updatedScreenplay);
  return updatedScreenplay;
}

/**
 * Delete a snapshot
 */
export async function deleteSnapshot(screenplay: Screenplay, snapshotId: string): Promise<Screenplay> {
  const updatedScreenplay = {
    ...screenplay,
    snapshots: (screenplay.snapshots || []).filter(s => s.id !== snapshotId),
    updatedAt: Date.now(),
  };

  await saveProject(updatedScreenplay);
  return updatedScreenplay;
}

/**
 * Rename a snapshot
 */
export async function renameSnapshot(screenplay: Screenplay, snapshotId: string, newName: string): Promise<Screenplay> {
  const updatedScreenplay = {
    ...screenplay,
    snapshots: (screenplay.snapshots || []).map(s => 
      s.id === snapshotId ? { ...s, name: newName } : s
    ),
    updatedAt: Date.now(),
  };

  await saveProject(updatedScreenplay);
  return updatedScreenplay;
}

// ============================================
// WRITING GOALS STORAGE
// ============================================

import { WritingGoal, WritingSession } from './types';

const WRITING_GOAL_KEY = 'screenwriter_writing_goal';
const WRITING_SESSIONS_KEY = 'screenwriter_writing_sessions';

/**
 * Save writing goal
 */
export async function saveWritingGoal(goal: WritingGoal): Promise<void> {
  try {
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI) {
      try {
        await apiClient.saveWritingGoal(goal);
        // Also save to localStorage as backup
        localStorage.setItem(WRITING_GOAL_KEY, JSON.stringify(goal));
        return;
      } catch (e) {
        console.warn('API save failed, falling back to localStorage:', e);
        apiClient.setUseAPI(false);
      }
    }
    
    // Fallback to localStorage
    localStorage.setItem(WRITING_GOAL_KEY, JSON.stringify(goal));
  } catch (error) {
    console.error('Failed to save writing goal:', error);
  }
}

/**
 * Load writing goal
 */
export async function loadWritingGoalAsync(): Promise<WritingGoal | null> {
  try {
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI) {
      try {
        return await apiClient.fetchWritingGoal();
      } catch (e) {
        console.warn('API unavailable, falling back to localStorage:', e);
        apiClient.setUseAPI(false);
      }
    }
  } catch (e) {
    console.warn('API check failed, falling back to localStorage:', e);
    apiClient.setUseAPI(false);
  }
  
  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(WRITING_GOAL_KEY);
    if (stored) {
      return JSON.parse(stored) as WritingGoal;
    }
  } catch (error) {
    console.error('Failed to load writing goal:', error);
  }
  return null;
}

// Synchronous version for backward compatibility
export function loadWritingGoal(): WritingGoal | null {
  try {
    const stored = localStorage.getItem(WRITING_GOAL_KEY);
    if (stored) {
      return JSON.parse(stored) as WritingGoal;
    }
  } catch (error) {
    console.error('Failed to load writing goal:', error);
  }
  return null;
}

/**
 * Save writing sessions
 */
export async function saveWritingSessions(sessions: WritingSession[]): Promise<void> {
  try {
    // Only keep last 90 days of sessions
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffString = cutoff.toISOString().split('T')[0];
    
    const filteredSessions = sessions.filter(s => s.date >= cutoffString);
    
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI && filteredSessions.length > 0) {
      try {
        await apiClient.saveWritingSessions(filteredSessions);
        // Also save to localStorage as backup
        localStorage.setItem(WRITING_SESSIONS_KEY, JSON.stringify(filteredSessions));
        return;
      } catch (e) {
        console.warn('API save failed, falling back to localStorage:', e);
        apiClient.setUseAPI(false);
      }
    }
    
    // Fallback to localStorage
    localStorage.setItem(WRITING_SESSIONS_KEY, JSON.stringify(filteredSessions));
  } catch (error) {
    console.error('Failed to save writing sessions:', error);
  }
}

/**
 * Load writing sessions
 */
export async function loadWritingSessionsAsync(projectId?: string): Promise<WritingSession[]> {
  try {
    const useAPI = await apiClient.shouldUseAPI();
    if (useAPI && projectId) {
      try {
        return await apiClient.fetchWritingSessions(projectId, 90);
      } catch (e) {
        console.warn('API unavailable, falling back to localStorage:', e);
        apiClient.setUseAPI(false);
      }
    }
  } catch (e) {
    console.warn('API check failed, falling back to localStorage:', e);
    apiClient.setUseAPI(false);
  }
  
  // Fallback to localStorage
  try {
    const stored = localStorage.getItem(WRITING_SESSIONS_KEY);
    if (stored) {
      return JSON.parse(stored) as WritingSession[];
    }
  } catch (error) {
    console.error('Failed to load writing sessions:', error);
  }
  return [];
}

// Synchronous version for backward compatibility
export function loadWritingSessions(): WritingSession[] {
  try {
    const stored = localStorage.getItem(WRITING_SESSIONS_KEY);
    if (stored) {
      return JSON.parse(stored) as WritingSession[];
    }
  } catch (error) {
    console.error('Failed to load writing sessions:', error);
  }
  return [];
}

/**
 * Get or create today's session
 */
export async function getOrCreateTodaySession(projectId: string, elements: ScriptElement[]): Promise<WritingSession> {
  const sessions = await loadWritingSessionsAsync(projectId);
  const today = new Date().toISOString().split('T')[0];
  
  let todaySession = sessions.find(s => s.date === today && s.projectId === projectId);
  
  if (!todaySession) {
    // Calculate current stats
    const wordCount = elements.reduce((total, el) => {
      if (el.isDeleted) return total;
      const words = el.content.trim().split(/\s+/).filter(w => w.length > 0);
      return total + words.length;
    }, 0);
    const pageCount = Math.ceil(wordCount / 250);

    todaySession = {
      id: `session-${Date.now()}`,
      date: today,
      projectId,
      startPages: pageCount,
      startWords: wordCount,
      endPages: pageCount,
      endWords: wordCount,
      duration: 0,
      goalMet: false,
    };
    
    sessions.push(todaySession);
    await saveWritingSessions(sessions);
  }
  
  return todaySession;
}

/**
 * Update today's session
 */
export async function updateTodaySession(
  projectId: string, 
  elements: ScriptElement[],
  goal: WritingGoal | null
): Promise<WritingSession> {
  const sessions = await loadWritingSessionsAsync(projectId);
  const today = new Date().toISOString().split('T')[0];
  
  const wordCount = elements.reduce((total, el) => {
    if (el.isDeleted) return total;
    const words = el.content.trim().split(/\s+/).filter(w => w.length > 0);
    return total + words.length;
  }, 0);
  const pageCount = Math.ceil(wordCount / 250);

  const sessionIndex = sessions.findIndex(s => s.date === today && s.projectId === projectId);
  
  if (sessionIndex >= 0) {
    const session = sessions[sessionIndex];
    const pagesWritten = pageCount - session.startPages;
    const wordsWritten = wordCount - session.startWords;
    
    let goalMet = false;
    if (goal) {
      switch (goal.type) {
        case 'pages':
          goalMet = pagesWritten >= goal.target;
          break;
        case 'words':
          goalMet = wordsWritten >= goal.target;
          break;
        default:
          goalMet = false;
      }
    }

    sessions[sessionIndex] = {
      ...session,
      endPages: pageCount,
      endWords: wordCount,
      goalMet,
    };
    
    await saveWritingSessions(sessions);
    return sessions[sessionIndex];
  }
  
  // Create new session if none exists
  return getOrCreateTodaySession(projectId, elements);
}
