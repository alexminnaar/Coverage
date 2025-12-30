// API Client for database operations

import { Screenplay, ProjectMeta, WritingGoal, WritingSession } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function resolveApiUrl(path: string): string {
  // When API_BASE is relative (e.g. "/api"), `new URL("/api/...")` throws unless a base is provided.
  // We always want this to work in browser environments behind nginx proxying.
  if (API_BASE.startsWith('http://') || API_BASE.startsWith('https://')) {
    return `${API_BASE}${path}`;
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  return new URL(`${API_BASE}${path}`, origin).toString();
}

// Check if API is available
export async function checkAPIAvailability(): Promise<boolean> {
  try {
    const response = await fetch(resolveApiUrl('/health'));
    return response.ok;
  } catch {
    return false;
  }
}

// Projects API
export async function fetchProjects(): Promise<ProjectMeta[]> {
  const response = await fetch(`${API_BASE}/projects`);
  if (!response.ok) {
    throw new Error('Failed to fetch projects');
  }
  return response.json();
}

export async function fetchProject(id: string): Promise<Screenplay> {
  const response = await fetch(`${API_BASE}/projects/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Project not found');
    }
    throw new Error('Failed to fetch project');
  }
  return response.json();
}

export async function createProject(screenplay: Screenplay): Promise<Screenplay> {
  const response = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(screenplay),
  });
  if (!response.ok) {
    throw new Error('Failed to create project');
  }
  return response.json();
}

export async function updateProject(screenplay: Screenplay): Promise<Screenplay> {
  const response = await fetch(`${API_BASE}/projects/${screenplay.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(screenplay),
  });
  if (!response.ok) {
    throw new Error('Failed to update project');
  }
  return response.json();
}

export async function deleteProjectById(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete project');
  }
}

// Writing Goals API
export async function fetchWritingGoal(projectId?: string): Promise<WritingGoal | null> {
  const url = projectId 
    ? `${API_BASE}/writing/goals/${projectId}`
    : `${API_BASE}/writing/goals`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch writing goal');
  }
  return response.json();
}

export async function saveWritingGoal(goal: WritingGoal): Promise<WritingGoal> {
  const response = await fetch(`${API_BASE}/writing/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(goal),
  });
  if (!response.ok) {
    throw new Error('Failed to save writing goal');
  }
  return response.json();
}

// Writing Sessions API
export async function fetchWritingSessions(projectId: string, limit?: number): Promise<WritingSession[]> {
  const url = new URL(resolveApiUrl(`/writing/sessions/${projectId}`));
  if (limit) url.searchParams.set('limit', limit.toString());
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error('Failed to fetch writing sessions');
  }
  return response.json();
}

export async function saveWritingSessions(sessions: WritingSession[]): Promise<void> {
  const response = await fetch(`${API_BASE}/writing/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessions),
  });
  if (!response.ok) {
    throw new Error('Failed to save writing sessions');
  }
}

// Storage mode detection
let useAPI: boolean | null = null;
let lastAvailabilityCheckMs = 0;
const API_AVAILABILITY_TTL_MS = 10_000;

export async function shouldUseAPI(): Promise<boolean> {
  const now = Date.now();

  // Fast path: recently checked
  if (useAPI !== null && now - lastAvailabilityCheckMs < API_AVAILABILITY_TTL_MS) {
    return useAPI;
  }

  // Always (re)check availability periodically so we can recover from transient outages
  // (e.g. backend container restarting). Avoid permanently pinning to localStorage-only mode.
  const available = await checkAPIAvailability();
  useAPI = available;
  lastAvailabilityCheckMs = now;

  // Store last known state for reloads; we may still re-check on next call.
  localStorage.setItem('screenwriter_use_api', available ? 'true' : 'false');

  return available;
}

// Force API mode (for testing or explicit preference)
export function setUseAPI(value: boolean): void {
  useAPI = value;
  localStorage.setItem('screenwriter_use_api', value ? 'true' : 'false');
}

// Initialize API mode from localStorage
export function initAPIMode(): void {
  const stored = localStorage.getItem('screenwriter_use_api');
  if (stored === 'true') {
    useAPI = true;
  } else if (stored === 'false') {
    useAPI = false;
  }
}

