import { ScriptElement } from '../types';
import { normalizeCharacterName } from './contdMore';

// Page dimensions in lines (based on 12pt Courier)
const LINES_PER_PAGE = 54;       // Standard screenplay page
const HEADER_LINES = 2;          // Page number header
const FOOTER_LINES = 2;          // Bottom margin
const USABLE_LINES = LINES_PER_PAGE - HEADER_LINES - FOOTER_LINES;

// Line counts for different element types
const LINE_HEIGHTS: Record<string, number> = {
  'scene-heading': 2,      // Heading + blank line
  'action': 1,             // Per line (wrapped)
  'character': 2,          // Character + margin
  'dialogue': 1,           // Per line (wrapped)
  'parenthetical': 1,      // Single line
  'transition': 2,         // Transition + margin
};

// Characters per line for different element types
const CHARS_PER_LINE: Record<string, number> = {
  'scene-heading': 55,
  'action': 60,
  'character': 35,
  'dialogue': 35,
  'parenthetical': 25,
  'transition': 15,
};

export interface PageElement {
  element: ScriptElement;
  startLine: number;
  lineCount: number;
  // For split elements
  isSplit?: boolean;
  splitPart?: 'first' | 'continuation';
  originalContent?: string;
}

export interface Page {
  pageNumber: number;
  elements: PageElement[];
  hasMore?: boolean;         // Shows (MORE) at bottom
  hasContdHeader?: boolean;  // Shows CHARACTER (CONT'D) at top
  contdCharacter?: string;   // Character name for CONT'D
}

/**
 * Calculate line count for an element's content
 */
export function calculateElementLines(element: ScriptElement): number {
  const content = element.content.trim();
  if (!content) return LINE_HEIGHTS[element.type] || 1;

  const charsPerLine = CHARS_PER_LINE[element.type] || 60;
  const contentLines = Math.ceil(content.length / charsPerLine);
  const baseHeight = LINE_HEIGHTS[element.type] || 1;

  // For multi-line elements (action, dialogue), multiply by content lines
  if (element.type === 'action' || element.type === 'dialogue') {
    return Math.max(contentLines, 1) + (element.type === 'action' ? 1 : 0);
  }

  return baseHeight;
}

/**
 * Split dialogue content at a specific line
 */
function splitDialogue(content: string, atLine: number): { first: string; rest: string } {
  const charsPerLine = CHARS_PER_LINE.dialogue;
  const words = content.split(' ');
  let currentLine = 0;
  let charCount = 0;
  let splitIndex = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (charCount + word.length + 1 > charsPerLine) {
      currentLine++;
      charCount = word.length;
    } else {
      charCount += word.length + 1;
    }

    if (currentLine >= atLine) {
      splitIndex = i;
      break;
    }
    splitIndex = i + 1;
  }

  return {
    first: words.slice(0, splitIndex).join(' '),
    rest: words.slice(splitIndex).join(' '),
  };
}

/**
 * Calculate pages with proper page breaks
 */
export function calculatePages(elements: ScriptElement[]): Page[] {
  const pages: Page[] = [];
  let currentPage: Page = { pageNumber: 1, elements: [] };
  let currentLine = 0;
  let lastCharacter: string | null = null;

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const lineCount = calculateElementLines(element);

    // Track current character for dialogue
    if (element.type === 'character') {
      lastCharacter = normalizeCharacterName(element.content);
    }

    // Check if element fits on current page
    if (currentLine + lineCount <= USABLE_LINES) {
      // Element fits
      currentPage.elements.push({
        element,
        startLine: currentLine,
        lineCount,
      });
      currentLine += lineCount;

      // Clear character after non-dialogue elements
      if (element.type !== 'dialogue' && element.type !== 'parenthetical' && element.type !== 'character') {
        lastCharacter = null;
      }
    } else {
      // Element doesn't fit - need page break
      const linesRemaining = USABLE_LINES - currentLine;

      // Rule 1: Never split scene headings
      if (element.type === 'scene-heading') {
        // Start new page
        pages.push(currentPage);
        currentPage = { pageNumber: pages.length + 1, elements: [] };
        currentLine = 0;

        currentPage.elements.push({
          element,
          startLine: currentLine,
          lineCount,
        });
        currentLine += lineCount;
        continue;
      }

      // Rule 2: Keep character with at least first line of dialogue
      if (element.type === 'character') {
        const nextEl = elements[i + 1];
        if (nextEl && (nextEl.type === 'dialogue' || nextEl.type === 'parenthetical')) {
          if (linesRemaining < 4) {
            // Not enough room, move to next page
            pages.push(currentPage);
            currentPage = { pageNumber: pages.length + 1, elements: [] };
            currentLine = 0;

            currentPage.elements.push({
              element,
              startLine: currentLine,
              lineCount,
            });
            currentLine += lineCount;
            lastCharacter = normalizeCharacterName(element.content);
            continue;
          }
        }
      }

      // Rule 3: Split long dialogue if possible
      if (element.type === 'dialogue' && lineCount > 2 && linesRemaining >= 2) {
        // Split the dialogue
        const splitLine = linesRemaining - 1; // -1 for (MORE)
        const { first, rest } = splitDialogue(element.content, splitLine);

        if (first.trim() && rest.trim()) {
          // Add first part to current page
          currentPage.elements.push({
            element: { ...element, content: first },
            startLine: currentLine,
            lineCount: splitLine,
            isSplit: true,
            splitPart: 'first',
            originalContent: element.content,
          });
          currentPage.hasMore = true;

          // Start new page with continuation
          pages.push(currentPage);
          currentPage = {
            pageNumber: pages.length + 1,
            elements: [],
            hasContdHeader: true,
            contdCharacter: lastCharacter || undefined,
          };
          currentLine = 2; // Account for CHARACTER (CONT'D) header

          currentPage.elements.push({
            element: { ...element, content: rest },
            startLine: currentLine,
            lineCount: calculateElementLines({ ...element, content: rest }),
            isSplit: true,
            splitPart: 'continuation',
            originalContent: element.content,
          });
          currentLine += calculateElementLines({ ...element, content: rest });
          continue;
        }
      }

      // Default: move entire element to next page
      pages.push(currentPage);
      currentPage = { pageNumber: pages.length + 1, elements: [] };
      currentLine = 0;

      currentPage.elements.push({
        element,
        startLine: currentLine,
        lineCount,
      });
      currentLine += lineCount;
    }
  }

  // Add final page
  if (currentPage.elements.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

/**
 * Get total page count
 */
export function getPageCount(elements: ScriptElement[]): number {
  return calculatePages(elements).length || 1;
}

/**
 * Get page number for a specific element
 */
export function getPageForElement(
  pages: Page[],
  elementId: string
): number {
  for (const page of pages) {
    for (const pe of page.elements) {
      if (pe.element.id === elementId) {
        return page.pageNumber;
      }
    }
  }
  return 1;
}

