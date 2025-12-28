import { ScriptElement } from '../types';

/**
 * Determines if a character element should have "(CONT'D)" appended
 * This happens when the same character speaks again after an interruption
 * (action, scene heading, or another character's dialogue)
 */
export function shouldShowContd(
  elements: ScriptElement[],
  characterIndex: number
): boolean {
  const currentElement = elements[characterIndex];
  if (currentElement.type !== 'character') return false;
  
  const currentCharacter = normalizeCharacterName(currentElement.content);
  if (!currentCharacter) return false;
  
  // Look backwards to find the previous character
  let foundInterruption = false;
  for (let i = characterIndex - 1; i >= 0; i--) {
    const el = elements[i];
    
    // If we hit a scene heading, no CONT'D needed (new scene)
    if (el.type === 'scene-heading') {
      return false;
    }
    
    // If we find action or transition, mark as interruption
    if (el.type === 'action' || el.type === 'transition') {
      foundInterruption = true;
      continue;
    }
    
    // If we find a character element
    if (el.type === 'character') {
      const prevCharacter = normalizeCharacterName(el.content);
      
      // Same character after an interruption = CONT'D
      if (prevCharacter === currentCharacter && foundInterruption) {
        return true;
      }
      
      // Different character or same character without interruption
      return false;
    }
    
    // Dialogue and parenthetical belong to the last character
    // so we keep looking backwards
  }
  
  return false;
}

/**
 * Normalize character name by removing extensions like (V.O.), (O.S.), etc.
 */
export function normalizeCharacterName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s*\([^)]*\)\s*$/g, '') // Remove trailing parentheticals
    .replace(/\s*\(CONT'D\)\s*$/gi, '') // Remove existing CONT'D
    .trim();
}

/**
 * Get character name with CONT'D suffix if needed
 */
export function getCharacterWithContd(
  elements: ScriptElement[],
  characterIndex: number
): string {
  const element = elements[characterIndex];
  if (element.type !== 'character') return element.content;
  
  const baseName = element.content.trim();
  
  // Check if already has CONT'D
  if (/\(CONT'D\)\s*$/i.test(baseName)) {
    return baseName;
  }
  
  if (shouldShowContd(elements, characterIndex)) {
    return `${baseName} (CONT'D)`;
  }
  
  return baseName;
}

/**
 * Process elements to add CONT'D markers where needed
 * Returns a map of element ID to whether it needs CONT'D
 */
export function processContdMarkers(elements: ScriptElement[]): Map<string, boolean> {
  const markers = new Map<string, boolean>();
  
  elements.forEach((el, index) => {
    if (el.type === 'character') {
      markers.set(el.id, shouldShowContd(elements, index));
    }
  });
  
  return markers;
}

// ============================================
// PAGE BREAK AND (MORE)/(CONT'D) LOGIC
// ============================================

// Approximate lines per page in a screenplay (standard is ~55)
const LINES_PER_PAGE = 55;

// Line heights for different element types (in lines)
const ELEMENT_LINE_HEIGHTS: Record<string, number> = {
  'scene-heading': 2,   // Scene heading + blank line after
  'action': 1,          // Per line of action
  'character': 2,       // Character + space
  'dialogue': 1,        // Per line of dialogue
  'parenthetical': 1,   // Single line
  'transition': 2,      // Transition + blank line
};

export interface PageBreakInfo {
  pageNumber: number;
  elementIndex: number;
  splitAtLine?: number;     // For dialogue that needs to split
  showMore?: boolean;       // Show (MORE) at bottom
  showContdTop?: boolean;   // Show (CONT'D) at top of next page
  characterName?: string;   // Character name for CONT'D header
}

/**
 * Calculate where page breaks should occur
 */
export function calculatePageBreaks(elements: ScriptElement[]): PageBreakInfo[] {
  const pageBreaks: PageBreakInfo[] = [];
  let currentLine = 0;
  let pageNumber = 1;
  let currentCharacter: string | null = null;
  
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const lines = estimateElementLines(el);
    
    // Track current character for dialogue
    if (el.type === 'character') {
      currentCharacter = normalizeCharacterName(el.content);
    }
    
    // Check if this element would overflow the page
    if (currentLine + lines > LINES_PER_PAGE) {
      // Determine where to break
      const linesRemaining = LINES_PER_PAGE - currentLine;
      
      // Never break scene headings
      if (el.type === 'scene-heading') {
        pageBreaks.push({
          pageNumber: pageNumber + 1,
          elementIndex: i,
        });
        pageNumber++;
        currentLine = lines;
        continue;
      }
      
      // For dialogue, we can split it
      if (el.type === 'dialogue' && lines > linesRemaining && linesRemaining >= 2) {
        // Split the dialogue
        pageBreaks.push({
          pageNumber: pageNumber + 1,
          elementIndex: i,
          splitAtLine: linesRemaining - 1, // -1 for (MORE)
          showMore: true,
          showContdTop: true,
          characterName: currentCharacter || undefined,
        });
        pageNumber++;
        currentLine = lines - linesRemaining + 2; // +2 for CHARACTER (CONT'D)
        continue;
      }
      
      // For character+dialogue, keep them together
      if (el.type === 'character' && i + 1 < elements.length && elements[i + 1].type === 'dialogue') {
        pageBreaks.push({
          pageNumber: pageNumber + 1,
          elementIndex: i,
        });
        pageNumber++;
        currentLine = lines;
        continue;
      }
      
      // Default: break before this element
      pageBreaks.push({
        pageNumber: pageNumber + 1,
        elementIndex: i,
      });
      pageNumber++;
      currentLine = lines;
      continue;
    }
    
    currentLine += lines;
    
    // Clear character after non-dialogue elements
    if (el.type !== 'dialogue' && el.type !== 'parenthetical' && el.type !== 'character') {
      currentCharacter = null;
    }
  }
  
  return pageBreaks;
}

/**
 * Estimate how many lines an element will take
 */
export function estimateElementLines(element: ScriptElement): number {
  const baseHeight = ELEMENT_LINE_HEIGHTS[element.type] || 1;
  
  if (element.type === 'action' || element.type === 'dialogue') {
    // Estimate based on content length
    // Approximately 60 characters per line for action, 35 for dialogue
    const charsPerLine = element.type === 'action' ? 60 : 35;
    const contentLines = Math.ceil(element.content.length / charsPerLine) || 1;
    return contentLines + (element.type === 'action' ? 1 : 0); // Action gets blank line after
  }
  
  return baseHeight;
}

/**
 * Get page number for a given element index
 */
export function getPageForElement(
  pageBreaks: PageBreakInfo[],
  elementIndex: number
): number {
  let page = 1;
  for (const pb of pageBreaks) {
    if (pb.elementIndex <= elementIndex) {
      page = pb.pageNumber;
    } else {
      break;
    }
  }
  return page;
}

/**
 * Calculate total pages
 */
export function calculateTotalPages(elements: ScriptElement[]): number {
  const pageBreaks = calculatePageBreaks(elements);
  return pageBreaks.length > 0 ? pageBreaks[pageBreaks.length - 1].pageNumber : 1;
}

