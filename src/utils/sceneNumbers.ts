import { ScriptElement, Screenplay } from '../types';

/**
 * Generate sequential scene numbers for all scene headings
 * Returns a new elements array with sceneNumber set
 */
export function generateSceneNumbers(elements: ScriptElement[]): ScriptElement[] {
  let sceneCount = 0;
  
  return elements.map(el => {
    if (el.type === 'scene-heading') {
      sceneCount++;
      // If scene is already locked, keep its number
      if (el.isSceneLocked && el.sceneNumber) {
        return el;
      }
      return { ...el, sceneNumber: String(sceneCount) };
    }
    return el;
  });
}

/**
 * Lock all current scene numbers
 * This prevents them from being renumbered
 */
export function lockSceneNumbers(elements: ScriptElement[]): ScriptElement[] {
  return elements.map(el => {
    if (el.type === 'scene-heading' && el.sceneNumber) {
      return { ...el, isSceneLocked: true };
    }
    return el;
  });
}

/**
 * Unlock all scene numbers
 */
export function unlockSceneNumbers(elements: ScriptElement[]): ScriptElement[] {
  return elements.map(el => {
    if (el.type === 'scene-heading') {
      return { ...el, isSceneLocked: false };
    }
    return el;
  });
}

/**
 * Clear all scene numbers
 */
export function clearSceneNumbers(elements: ScriptElement[]): ScriptElement[] {
  return elements.map(el => {
    if (el.type === 'scene-heading') {
      const { sceneNumber, isSceneLocked, ...rest } = el;
      return rest as ScriptElement;
    }
    return el;
  });
}

/**
 * Generate scene number for an inserted scene
 * Uses letter suffixes (A, B, C) after the previous scene number
 */
export function getInsertedSceneNumber(
  elements: ScriptElement[],
  insertAfterIndex: number
): string {
  // Find the scene at or before insertAfterIndex
  let prevSceneNumber: string | null = null;
  let nextSceneNumber: string | null = null;
  
  for (let i = insertAfterIndex; i >= 0; i--) {
    if (elements[i].type === 'scene-heading' && elements[i].sceneNumber) {
      prevSceneNumber = elements[i].sceneNumber!;
      break;
    }
  }
  
  for (let i = insertAfterIndex + 1; i < elements.length; i++) {
    if (elements[i].type === 'scene-heading' && elements[i].sceneNumber) {
      nextSceneNumber = elements[i].sceneNumber!;
      break;
    }
  }
  
  if (!prevSceneNumber) {
    return '1';
  }
  
  // Parse the previous scene number to get base and suffix
  const prevMatch = prevSceneNumber.match(/^(\d+)([A-Z]*)$/);
  if (!prevMatch) {
    return prevSceneNumber + 'A';
  }
  
  const baseNumber = prevMatch[1];
  const suffix = prevMatch[2];
  
  // If next scene is the base+1, we need to add a suffix
  const nextBaseMatch = nextSceneNumber?.match(/^(\d+)/);
  if (nextBaseMatch && parseInt(nextBaseMatch[1]) === parseInt(baseNumber) + 1) {
    // Add letter suffix
    if (!suffix) {
      return baseNumber + 'A';
    } else {
      // Increment letter suffix
      const lastChar = suffix.slice(-1);
      const nextChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
      return baseNumber + suffix.slice(0, -1) + nextChar;
    }
  }
  
  // Otherwise, just increment
  return String(parseInt(baseNumber) + 1);
}

/**
 * Update screenplay with scene numbering toggle
 */
export function toggleSceneNumbering(screenplay: Screenplay, enabled: boolean): Screenplay {
  if (enabled) {
    return {
      ...screenplay,
      sceneNumberingEnabled: true,
      elements: generateSceneNumbers(screenplay.elements),
    };
  } else {
    return {
      ...screenplay,
      sceneNumberingEnabled: false,
      elements: clearSceneNumbers(screenplay.elements),
    };
  }
}

/**
 * Lock/unlock all scene numbers
 */
export function toggleScenesLocked(screenplay: Screenplay, locked: boolean): Screenplay {
  return {
    ...screenplay,
    scenesLocked: locked,
    elements: locked 
      ? lockSceneNumbers(screenplay.elements)
      : unlockSceneNumbers(screenplay.elements),
  };
}

