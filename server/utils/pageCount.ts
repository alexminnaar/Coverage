import { Screenplay } from '../../../src/types.js';

// Simple page count estimation based on word count
// Standard screenplay format: ~250 words per page
export function estimatePageCount(screenplay: Screenplay): number {
  const wordCount = screenplay.elements.reduce((total, el) => {
    if (el.isDeleted) return total;
    const words = el.content.trim().split(/\s+/).filter(w => w.length > 0);
    return total + words.length;
  }, 0);
  
  // Add 1 for title page, then estimate based on word count
  return Math.max(1, Math.ceil(wordCount / 250) + 1);
}

