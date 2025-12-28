import { ScriptElement } from '../types';

/**
 * Scene duration estimation based on screenplay industry standards
 * Rule of thumb: 1 page ≈ 1 minute of screen time
 * 
 * For more accuracy:
 * - Action lines: ~4-5 seconds per line (fast visual pacing)
 * - Dialogue: ~2-3 seconds per line (speaking pace)
 * - Scene headings add a few seconds for transitions
 */

// Estimated seconds per element type (per line of content)
const SECONDS_PER_LINE: Record<string, number> = {
  'scene-heading': 3,        // Brief transition
  'action': 4,               // Visual description
  'character': 1,            // Just the name
  'dialogue': 2.5,           // Speaking pace
  'parenthetical': 1,        // Brief direction
  'transition': 2,           // Cut, fade, etc.
};

// Characters per line for estimating line count
const CHARS_PER_LINE: Record<string, number> = {
  'scene-heading': 50,
  'action': 60,
  'character': 30,
  'dialogue': 35,
  'parenthetical': 30,
  'transition': 20,
};

export interface SceneDuration {
  sceneId: string;
  sceneHeading: string;
  durationSeconds: number;
  durationFormatted: string;
  elementCount: number;
  dialogueCount: number;
  actionCount: number;
}

export interface ScriptDurationStats {
  totalDurationSeconds: number;
  totalFormatted: string;
  sceneDurations: SceneDuration[];
  averageSceneDuration: number;
  longestScene: SceneDuration | null;
  shortestScene: SceneDuration | null;
  estimatedPages: number;
}

/**
 * Estimate duration in seconds for a single element
 */
export function estimateElementDuration(element: ScriptElement): number {
  // If there's a manual override, use that
  if (element.durationOverride !== undefined) {
    return element.durationOverride;
  }

  const content = element.content.trim();
  if (!content) return 0;

  const charsPerLine = CHARS_PER_LINE[element.type] || 50;
  const lineCount = Math.max(1, Math.ceil(content.length / charsPerLine));
  const secondsPerLine = SECONDS_PER_LINE[element.type] || 3;

  return lineCount * secondsPerLine;
}

/**
 * Get elements that belong to a scene (from scene heading to next scene heading)
 */
export function getSceneElements(
  elements: ScriptElement[],
  sceneHeadingIndex: number
): ScriptElement[] {
  const sceneElements: ScriptElement[] = [];
  
  for (let i = sceneHeadingIndex; i < elements.length; i++) {
    if (i > sceneHeadingIndex && elements[i].type === 'scene-heading') {
      break;
    }
    sceneElements.push(elements[i]);
  }
  
  return sceneElements;
}

/**
 * Estimate duration for a single scene
 */
export function estimateSceneDuration(
  elements: ScriptElement[],
  sceneHeadingIndex: number
): SceneDuration {
  const sceneElements = getSceneElements(elements, sceneHeadingIndex);
  const sceneHeading = sceneElements[0];
  
  let totalSeconds = 0;
  let dialogueCount = 0;
  let actionCount = 0;

  sceneElements.forEach(el => {
    totalSeconds += estimateElementDuration(el);
    if (el.type === 'dialogue') dialogueCount++;
    if (el.type === 'action') actionCount++;
  });

  // Check for manual override on scene heading
  if (sceneHeading.durationOverride !== undefined) {
    totalSeconds = sceneHeading.durationOverride;
  }

  return {
    sceneId: sceneHeading.id,
    sceneHeading: sceneHeading.content,
    durationSeconds: Math.round(totalSeconds),
    durationFormatted: formatDuration(totalSeconds),
    elementCount: sceneElements.length,
    dialogueCount,
    actionCount,
  };
}

/**
 * Calculate duration statistics for the entire script
 */
export function calculateScriptDuration(elements: ScriptElement[]): ScriptDurationStats {
  const sceneDurations: SceneDuration[] = [];
  
  // Find all scene headings and calculate their durations
  elements.forEach((el, index) => {
    if (el.type === 'scene-heading') {
      sceneDurations.push(estimateSceneDuration(elements, index));
    }
  });

  // Calculate totals
  const totalDurationSeconds = sceneDurations.reduce(
    (sum, scene) => sum + scene.durationSeconds,
    0
  );

  const averageSceneDuration = sceneDurations.length > 0
    ? totalDurationSeconds / sceneDurations.length
    : 0;

  // Find longest and shortest scenes
  let longestScene: SceneDuration | null = null;
  let shortestScene: SceneDuration | null = null;

  sceneDurations.forEach(scene => {
    if (!longestScene || scene.durationSeconds > longestScene.durationSeconds) {
      longestScene = scene;
    }
    if (!shortestScene || scene.durationSeconds < shortestScene.durationSeconds) {
      shortestScene = scene;
    }
  });

  // Estimate pages (1 minute = 1 page)
  const estimatedPages = Math.ceil(totalDurationSeconds / 60);

  return {
    totalDurationSeconds,
    totalFormatted: formatDuration(totalDurationSeconds),
    sceneDurations,
    averageSceneDuration: Math.round(averageSceneDuration),
    longestScene,
    shortestScene,
    estimatedPages,
  };
}

/**
 * Format seconds into a human-readable duration string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  
  if (minutes < 60) {
    return remainingSeconds > 0 
      ? `${minutes}m ${remainingSeconds}s` 
      : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format duration for display in the UI (compact version)
 */
export function formatDurationCompact(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  
  if (minutes < 60) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Get a color based on scene duration (for visual indicators)
 */
export function getDurationColor(seconds: number): string {
  if (seconds < 30) return '#2ecc71';      // Green - short
  if (seconds < 120) return '#3498db';     // Blue - normal
  if (seconds < 300) return '#f39c12';     // Orange - medium
  return '#e74c3c';                         // Red - long
}

