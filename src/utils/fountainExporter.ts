import { Screenplay } from '../types';

/**
 * Exports a Screenplay to Fountain format
 * See: https://fountain.io/syntax
 */

export function exportToFountain(screenplay: Screenplay): string {
  const lines: string[] = [];
  
  // Title page
  lines.push(`Title: ${screenplay.title || 'Untitled'}`);
  if (screenplay.author) {
    lines.push(`Author: ${screenplay.author}`);
  }
  if (screenplay.contact) {
    lines.push(`Contact: ${screenplay.contact}`);
  }
  if (screenplay.draftDate) {
    lines.push(`Draft date: ${screenplay.draftDate}`);
  }
  if (screenplay.copyright) {
    lines.push(`Copyright: ${screenplay.copyright}`);
  }
  if (screenplay.basedOn) {
    lines.push(`Source: ${screenplay.basedOn}`);
  }
  
  // Empty line to end title page
  lines.push('');
  lines.push('');
  
  // Convert elements
  let lastType: string | null = null;
  
  for (const element of screenplay.elements) {
    const content = element.content.trim();
    if (!content && element.type !== 'scene-heading') continue;
    
    // Add appropriate spacing
    if (lastType !== null) {
      // Scene headings get extra blank line before
      if (element.type === 'scene-heading') {
        lines.push('');
      }
      // Character names get blank line before (unless after scene heading)
      else if (element.type === 'character' && lastType !== 'scene-heading') {
        lines.push('');
      }
      // Transitions get blank line before
      else if (element.type === 'transition') {
        lines.push('');
      }
    }
    
    // Format based on type
    switch (element.type) {
      case 'scene-heading':
        // Scene headings are auto-detected if they start with INT./EXT.
        // Otherwise, force with a leading period
        const upper = content.toUpperCase();
        if (upper.startsWith('INT') || upper.startsWith('EXT') || upper.startsWith('I/E')) {
          lines.push(upper);
        } else {
          lines.push('.' + upper);
        }
        break;
        
      case 'action':
        lines.push(content);
        break;
        
      case 'character':
        // Character names are uppercase and centered
        lines.push(content.toUpperCase());
        break;
        
      case 'dialogue':
        lines.push(content);
        break;
        
      case 'parenthetical':
        // Parentheticals are wrapped in parentheses
        if (content.startsWith('(') && content.endsWith(')')) {
          lines.push(content);
        } else {
          lines.push(`(${content})`);
        }
        break;
        
      case 'transition':
        // Transitions end with TO: or use > prefix
        const transUpper = content.toUpperCase();
        if (transUpper.endsWith('TO:') || transUpper === 'FADE IN:' || transUpper.endsWith('.')) {
          lines.push(transUpper);
        } else {
          lines.push('> ' + transUpper);
        }
        break;
    }
    
    lastType = element.type;
  }
  
  return lines.join('\n');
}

/**
 * Download screenplay as a .fountain file
 */
export function downloadFountain(screenplay: Screenplay): void {
  const content = exportToFountain(screenplay);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const filename = (screenplay.title || 'screenplay')
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase() + '.fountain';
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

