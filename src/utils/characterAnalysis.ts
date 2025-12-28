import { ScriptElement } from '../types';

export interface CharacterPresence {
  characterName: string;
  sceneId: string;
  sceneIndex: number;
  dialogueCount: number;
  isFirstAppearance: boolean;
}

export interface CharacterData {
  name: string;
  color: string;
  totalDialogues: number;
  sceneCount: number;
  firstAppearance: number;
  presenceByScene: Map<string, CharacterPresence>;
}

// Colors for characters
const CHARACTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff9800', '#8bc34a',
  '#673ab7', '#009688', '#ff5722', '#795548', '#607d8b',
];

/**
 * Extract all unique characters from the script
 */
export function extractCharacters(elements: ScriptElement[]): string[] {
  const characters = new Set<string>();
  
  elements.forEach(el => {
    if (el.type === 'character' && el.content.trim()) {
      // Normalize: uppercase, remove extensions like (V.O.), (O.S.), (CONT'D)
      const name = el.content
        .toUpperCase()
        .replace(/\s*\([^)]*\)\s*$/g, '')
        .trim();
      if (name) {
        characters.add(name);
      }
    }
  });
  
  return Array.from(characters).sort();
}

/**
 * Get scene headings with their indices
 */
export function getSceneHeadings(elements: ScriptElement[]): { id: string; index: number; heading: string }[] {
  return elements
    .map((el, index) => ({ el, index }))
    .filter(({ el }) => el.type === 'scene-heading')
    .map(({ el, index }) => ({
      id: el.id,
      index,
      heading: el.content || 'UNTITLED',
    }));
}

/**
 * Get scene index for an element
 */
function getSceneIndexForElement(elements: ScriptElement[], elementIndex: number): number {
  let sceneIndex = -1;
  for (let i = elementIndex; i >= 0; i--) {
    if (elements[i].type === 'scene-heading') {
      sceneIndex = i;
      break;
    }
  }
  return sceneIndex;
}

/**
 * Analyze character presence across scenes
 */
export function analyzeCharacterPresence(elements: ScriptElement[]): Map<string, CharacterData> {
  const characterMap = new Map<string, CharacterData>();
  
  let colorIndex = 0;
  
  // Track first appearances
  const firstAppearances = new Map<string, number>();
  
  // First pass: identify characters and their first appearances
  elements.forEach((el, index) => {
    if (el.type === 'character' && el.content.trim()) {
      const name = el.content.toUpperCase().replace(/\s*\([^)]*\)\s*$/g, '').trim();
      if (name && !firstAppearances.has(name)) {
        firstAppearances.set(name, getSceneIndexForElement(elements, index));
      }
    }
  });
  
  // Second pass: count dialogues per scene
  let currentCharacter: string | null = null;
  let currentSceneId: string | null = null;
  let currentSceneIndex = -1;
  
  elements.forEach((el, index) => {
    if (el.type === 'scene-heading') {
      currentSceneId = el.id;
      currentSceneIndex = index;
      currentCharacter = null;
    } else if (el.type === 'character' && el.content.trim()) {
      currentCharacter = el.content.toUpperCase().replace(/\s*\([^)]*\)\s*$/g, '').trim();
      
      // Initialize character data if not exists
      if (currentCharacter && !characterMap.has(currentCharacter)) {
        characterMap.set(currentCharacter, {
          name: currentCharacter,
          color: CHARACTER_COLORS[colorIndex % CHARACTER_COLORS.length],
          totalDialogues: 0,
          sceneCount: 0,
          firstAppearance: firstAppearances.get(currentCharacter) || 0,
          presenceByScene: new Map(),
        });
        colorIndex++;
      }
    } else if (el.type === 'dialogue' && currentCharacter && currentSceneId) {
      const charData = characterMap.get(currentCharacter);
      if (charData) {
        charData.totalDialogues++;
        
        let presence = charData.presenceByScene.get(currentSceneId);
        if (!presence) {
          presence = {
            characterName: currentCharacter,
            sceneId: currentSceneId,
            sceneIndex: currentSceneIndex,
            dialogueCount: 0,
            isFirstAppearance: charData.firstAppearance === currentSceneIndex,
          };
          charData.presenceByScene.set(currentSceneId, presence);
          charData.sceneCount++;
        }
        presence.dialogueCount++;
      }
    } else if (el.type !== 'parenthetical') {
      currentCharacter = null;
    }
  });
  
  return characterMap;
}

/**
 * Get characters sorted by importance (dialogue count)
 */
export function getCharactersByImportance(characterData: Map<string, CharacterData>): CharacterData[] {
  return Array.from(characterData.values())
    .sort((a, b) => b.totalDialogues - a.totalDialogues);
}

/**
 * Get max dialogue count for any character in any scene (for heat map scaling)
 */
export function getMaxDialogueCount(characterData: Map<string, CharacterData>): number {
  let max = 0;
  characterData.forEach(char => {
    char.presenceByScene.forEach(presence => {
      if (presence.dialogueCount > max) {
        max = presence.dialogueCount;
      }
    });
  });
  return max || 1;
}

