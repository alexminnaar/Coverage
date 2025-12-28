import { ScriptElement } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Group elements by dual dialogue group ID
 * Returns an array of element groups, where a group can be:
 * - A single element (not part of dual dialogue)
 * - An array of [left, right] elements for dual dialogue
 */
export interface ElementGroup {
  type: 'single' | 'dual';
  elements: ScriptElement[];
  groupId?: string;
}

export function groupDualDialogue(elements: ScriptElement[]): ElementGroup[] {
  const groups: ElementGroup[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    
    if (processed.has(el.id)) continue;
    
    if (el.dualDialogueGroupId) {
      // Find all elements in this dual dialogue group
      const groupElements = elements.filter(
        e => e.dualDialogueGroupId === el.dualDialogueGroupId
      );
      
      // Sort by position (left first)
      const leftElements = groupElements.filter(e => e.dualPosition === 'left');
      const rightElements = groupElements.filter(e => e.dualPosition === 'right');
      
      groups.push({
        type: 'dual',
        elements: [...leftElements, ...rightElements],
        groupId: el.dualDialogueGroupId,
      });
      
      groupElements.forEach(e => processed.add(e.id));
    } else {
      groups.push({
        type: 'single',
        elements: [el],
      });
      processed.add(el.id);
    }
  }

  return groups;
}

/**
 * Start a dual dialogue from a character element
 * This marks the current character/dialogue as left side
 * and creates placeholder for right side
 */
export function startDualDialogue(
  elements: ScriptElement[],
  characterId: string
): ScriptElement[] {
  const characterIdx = elements.findIndex(e => e.id === characterId);
  if (characterIdx === -1) return elements;
  
  const characterEl = elements[characterIdx];
  if (characterEl.type !== 'character') return elements;
  
  const groupId = uuidv4();
  const newElements = [...elements];
  
  // Mark the character as left side
  newElements[characterIdx] = {
    ...characterEl,
    dualDialogueGroupId: groupId,
    dualPosition: 'left',
  };
  
  // Find dialogue elements that follow this character (until next character or scene heading)
  let dialogueIdx = characterIdx + 1;
  while (dialogueIdx < elements.length) {
    const nextEl = elements[dialogueIdx];
    if (nextEl.type === 'character' || nextEl.type === 'scene-heading' || nextEl.type === 'action') {
      break;
    }
    if (nextEl.type === 'dialogue' || nextEl.type === 'parenthetical') {
      newElements[dialogueIdx] = {
        ...nextEl,
        dualDialogueGroupId: groupId,
        dualPosition: 'left',
      };
    }
    dialogueIdx++;
  }
  
  // Create right side character placeholder
  const rightCharacter: ScriptElement = {
    id: uuidv4(),
    type: 'character',
    content: '',
    dualDialogueGroupId: groupId,
    dualPosition: 'right',
  };
  
  // Create right side dialogue placeholder
  const rightDialogue: ScriptElement = {
    id: uuidv4(),
    type: 'dialogue',
    content: '',
    dualDialogueGroupId: groupId,
    dualPosition: 'right',
  };
  
  // Insert right side elements after the left side elements
  newElements.splice(dialogueIdx, 0, rightCharacter, rightDialogue);
  
  return newElements;
}

/**
 * Remove dual dialogue grouping from an element
 */
export function removeDualDialogue(
  elements: ScriptElement[],
  groupId: string
): ScriptElement[] {
  return elements.map(el => {
    if (el.dualDialogueGroupId === groupId) {
      const { dualDialogueGroupId, dualPosition, ...rest } = el;
      return rest as ScriptElement;
    }
    return el;
  });
}

