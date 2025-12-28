import { ScriptElement, ElementType } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parses Fountain format text into ScriptElements
 * 
 * Fountain is a plain-text markup language for screenwriting.
 * See: https://fountain.io/syntax
 */

// Scene heading patterns
const SCENE_HEADING_PATTERN = /^(INT|EXT|EST|INT\.\/EXT|INT\/EXT|I\/E)[.\s]/i;
const FORCED_SCENE_HEADING = /^\./;

// Transition patterns
const TRANSITION_PATTERN = /^[A-Z\s]+TO:$/;
const FORCED_TRANSITION = /^>(?!>)/;

// Character pattern: all caps, potentially with extensions
const CHARACTER_PATTERN = /^[A-Z][A-Z0-9\s\-'\.]+(\s*\([^)]+\))?$/;
const FORCED_CHARACTER = /^@/;

// Parenthetical pattern
const PARENTHETICAL_PATTERN = /^\([^)]+\)$/;

// Dual dialogue marker
const DUAL_DIALOGUE_MARKER = /\s*\^$/;

interface ParseState {
  elements: ScriptElement[];
  lastType: ElementType | null;
  inDialogue: boolean;
}

export function parseFountain(text: string): ScriptElement[] {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split into lines
  const lines = normalized.split('\n');
  
  const state: ParseState = {
    elements: [],
    lastType: null,
    inDialogue: false,
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines but track them for dialogue breaks
    if (trimmed === '') {
      state.inDialogue = false;
      i++;
      continue;
    }

    // Skip title page elements (Title:, Credit:, Author:, etc.)
    if (/^(Title|Credit|Author|Source|Draft date|Contact|Copyright):/i.test(trimmed)) {
      i++;
      continue;
    }

    // Skip notes [[...]]
    if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
      i++;
      continue;
    }

    // Skip boneyard (comments) /* ... */
    if (trimmed.startsWith('/*')) {
      while (i < lines.length && !lines[i].includes('*/')) {
        i++;
      }
      i++;
      continue;
    }

    // Skip synopses = ...
    if (trimmed.startsWith('=') && !trimmed.startsWith('==')) {
      i++;
      continue;
    }

    // Skip section headers # ## ###
    if (/^#{1,3}\s/.test(trimmed)) {
      i++;
      continue;
    }

    // Parse the line
    const element = parseLine(trimmed, line, state);
    if (element) {
      state.elements.push(element);
      state.lastType = element.type;
      
      // Track if we're in dialogue mode
      if (element.type === 'character') {
        state.inDialogue = true;
      }
    }

    i++;
  }

  return state.elements;
}

function parseLine(trimmed: string, _originalLine: string, state: ParseState): ScriptElement | null {
  // Forced scene heading
  if (FORCED_SCENE_HEADING.test(trimmed)) {
    return createElement('scene-heading', trimmed.substring(1).trim());
  }

  // Scene heading
  if (SCENE_HEADING_PATTERN.test(trimmed)) {
    return createElement('scene-heading', trimmed);
  }

  // Forced transition
  if (FORCED_TRANSITION.test(trimmed)) {
    return createElement('transition', trimmed.substring(1).trim());
  }

  // Transition (TO: at end, all caps)
  if (TRANSITION_PATTERN.test(trimmed)) {
    return createElement('transition', trimmed);
  }

  // Centered text (for now, treat as action)
  if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
    return createElement('action', trimmed.slice(1, -1).trim());
  }

  // Forced character
  if (FORCED_CHARACTER.test(trimmed)) {
    const content = trimmed.substring(1).replace(DUAL_DIALOGUE_MARKER, '').trim();
    return createElement('character', content);
  }

  // Character (all caps, after an empty line, followed by dialogue)
  if (CHARACTER_PATTERN.test(trimmed) && !state.inDialogue) {
    // Check if it looks like a character name (not too long, not a transition)
    if (trimmed.length < 50 && !trimmed.endsWith(':')) {
      const content = trimmed.replace(DUAL_DIALOGUE_MARKER, '').trim();
      return createElement('character', content);
    }
  }

  // Parenthetical (in dialogue context)
  if (PARENTHETICAL_PATTERN.test(trimmed) && state.inDialogue) {
    // Remove outer parentheses for storage
    return createElement('parenthetical', trimmed.slice(1, -1).trim());
  }

  // Dialogue (after character or parenthetical)
  if (state.inDialogue && (state.lastType === 'character' || state.lastType === 'parenthetical' || state.lastType === 'dialogue')) {
    return createElement('dialogue', trimmed);
  }

  // Default to action
  return createElement('action', trimmed);
}

function createElement(type: ElementType, content: string): ScriptElement {
  return {
    id: uuidv4(),
    type,
    content: cleanContent(content),
  };
}

function cleanContent(content: string): string {
  // Remove Fountain emphasis markers for clean text
  // Bold: **text** or __text__
  // Italic: *text* or _text_
  // Underline: _text_
  // We'll keep the text but remove markers
  
  return content
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // Bold
    .replace(/__([^_]+)__/g, '$1')       // Bold alt
    .replace(/\*([^*]+)\*/g, '$1')       // Italic
    .replace(/_([^_]+)_/g, '$1')         // Italic alt/underline
    .trim();
}

/**
 * Parse a Fountain file from a File object
 */
export async function parseFountainFile(file: File): Promise<ScriptElement[]> {
  const text = await file.text();
  return parseFountain(text);
}

/**
 * Extract title and author from Fountain title page
 */
export function extractTitlePage(text: string): { title: string; author: string } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  
  let title = '';
  let author = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.toLowerCase().startsWith('title:')) {
      title = trimmed.substring(6).trim();
    } else if (trimmed.toLowerCase().startsWith('author:')) {
      author = trimmed.substring(7).trim();
    }
    
    // Stop after first blank line (end of title page)
    if (trimmed === '' && (title || author)) {
      break;
    }
  }
  
  return { title, author };
}

