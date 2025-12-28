import { useState, useEffect, useMemo, useCallback } from 'react';
import { ScriptElement, ElementType } from '../types';
import { getCharacterNames, findCharacterMatch, extractLocations } from '../utils/characterUtils';

interface UseCharacterSuggestionProps {
  elements: ScriptElement[];
  currentContent: string;
  currentType: ElementType;
  isActive: boolean;
}

interface UseCharacterSuggestionReturn {
  suggestion: string | null;
  remainingText: string | null;
  acceptSuggestion: () => string | null;
  dismissSuggestion: () => void;
}

export function useCharacterSuggestion({
  elements,
  currentContent,
  currentType,
  isActive,
}: UseCharacterSuggestionProps): UseCharacterSuggestionReturn {
  const [dismissed, setDismissed] = useState(false);

  // Extract all known characters from the script
  const characters = useMemo(() => getCharacterNames(elements), [elements]);
  
  // Extract all known locations from the script
  const locations = useMemo(() => extractLocations(elements), [elements]);

  // Reset dismissed state when content changes
  useEffect(() => {
    setDismissed(false);
  }, [currentContent]);

  // Find matching suggestion based on current type and content
  const suggestion = useMemo(() => {
    if (!isActive || dismissed || !currentContent.trim()) {
      return null;
    }

    // Character name suggestion
    if (currentType === 'character') {
      return findCharacterMatch(currentContent, characters);
    }

    // Scene heading location suggestion
    if (currentType === 'scene-heading') {
      const upper = currentContent.toUpperCase();
      
      // Check if we're after INT./EXT. prefix
      const prefixMatch = upper.match(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.*)$/);
      if (prefixMatch) {
        const locationPart = prefixMatch[2];
        
        // Don't suggest if we already have a time of day (contains " - ")
        if (locationPart.includes(' - ')) {
          return null;
        }
        
        // Find matching location
        const match = locations.find(loc => 
          loc.startsWith(locationPart.toUpperCase()) && loc !== locationPart.toUpperCase()
        );
        
        return match || null;
      }
    }

    return null;
  }, [currentContent, currentType, characters, locations, isActive, dismissed]);

  // Calculate remaining text to show as ghost text
  const remainingText = useMemo(() => {
    if (!suggestion) return null;
    
    if (currentType === 'character') {
      // Show the remaining part of the character name
      const prefix = currentContent.toUpperCase().trim();
      if (suggestion.startsWith(prefix)) {
        return suggestion.slice(prefix.length);
      }
    }
    
    if (currentType === 'scene-heading') {
      const upper = currentContent.toUpperCase();
      const prefixMatch = upper.match(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.*)$/);
      if (prefixMatch) {
        const locationPart = prefixMatch[2];
        if (suggestion.startsWith(locationPart.toUpperCase())) {
          return suggestion.slice(locationPart.length);
        }
      }
    }
    
    return null;
  }, [suggestion, currentContent, currentType]);

  // Accept the current suggestion
  const acceptSuggestion = useCallback(() => {
    if (!suggestion || !remainingText) return null;
    
    // Return the full text that should replace current content
    if (currentType === 'character') {
      return suggestion;
    }
    
    if (currentType === 'scene-heading') {
      const upper = currentContent.toUpperCase();
      const prefixMatch = upper.match(/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.*)$/);
      if (prefixMatch) {
        return prefixMatch[1] + ' ' + suggestion;
      }
    }
    
    return null;
  }, [suggestion, remainingText, currentContent, currentType]);

  // Dismiss the current suggestion
  const dismissSuggestion = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    suggestion,
    remainingText,
    acceptSuggestion,
    dismissSuggestion,
  };
}

