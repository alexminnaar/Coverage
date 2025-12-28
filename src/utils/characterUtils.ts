import { ScriptElement } from '../types';

export interface CharacterInfo {
  name: string;
  count: number;
  firstAppearance: number;
}

/**
 * Extract all unique character names from script elements
 * Returns sorted by frequency (most used first)
 */
export function extractCharacters(elements: ScriptElement[]): CharacterInfo[] {
  const characterMap = new Map<string, CharacterInfo>();
  
  elements.forEach((el, index) => {
    if (el.type === 'character' && el.content.trim()) {
      // Normalize character name (trim, uppercase for comparison)
      const name = el.content.trim().toUpperCase();
      
      // Remove parentheticals like (V.O.) or (O.S.)
      const cleanName = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
      
      if (cleanName) {
        const existing = characterMap.get(cleanName);
        if (existing) {
          existing.count++;
        } else {
          characterMap.set(cleanName, {
            name: cleanName,
            count: 1,
            firstAppearance: index,
          });
        }
      }
    }
  });
  
  // Sort by frequency (descending), then by first appearance
  return Array.from(characterMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.firstAppearance - b.firstAppearance;
  });
}

/**
 * Get character names as a simple string array
 */
export function getCharacterNames(elements: ScriptElement[]): string[] {
  return extractCharacters(elements).map(c => c.name);
}

/**
 * Find the best matching character for a given prefix
 */
export function findCharacterMatch(prefix: string, characters: string[]): string | null {
  if (!prefix.trim()) return null;
  
  const normalizedPrefix = prefix.toUpperCase().trim();
  
  // Find first character that starts with the prefix
  const match = characters.find(name => 
    name.startsWith(normalizedPrefix) && name !== normalizedPrefix
  );
  
  return match || null;
}

/**
 * Extract all unique locations from scene headings
 */
export function extractLocations(elements: ScriptElement[]): string[] {
  const locationSet = new Set<string>();
  
  elements.forEach(el => {
    if (el.type === 'scene-heading' && el.content.trim()) {
      const content = el.content.toUpperCase().trim();
      
      // Extract location from scene heading (after INT./EXT. and before - TIME)
      const match = content.match(/^(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.+?)(?:\s*-\s*.+)?$/);
      if (match && match[1]) {
        locationSet.add(match[1].trim());
      }
    }
  });
  
  return Array.from(locationSet).sort();
}

/**
 * Get common time-of-day options for scene headings
 */
export function getTimeOfDayOptions(): string[] {
  return [
    'DAY',
    'NIGHT',
    'MORNING',
    'AFTERNOON',
    'EVENING',
    'DAWN',
    'DUSK',
    'LATER',
    'CONTINUOUS',
    'SAME',
    'MOMENTS LATER',
  ];
}

