import { ScriptElement, Screenplay, ElementType } from '../types';

/**
 * Parse Final Draft .fdx XML format
 * FDX is XML-based and follows a specific structure
 */

// Mapping from FDX paragraph types to our element types
const FDX_TYPE_MAP: Record<string, ElementType> = {
  'Scene Heading': 'scene-heading',
  'Action': 'action',
  'Character': 'character',
  'Dialogue': 'dialogue',
  'Parenthetical': 'parenthetical',
  'Transition': 'transition',
  'General': 'action',
  'Shot': 'action',
};

interface FdxParseResult {
  screenplay: Partial<Screenplay>;
  errors: string[];
}

/**
 * Parse an FDX file content into screenplay elements
 */
export function parseFdx(xmlContent: string): FdxParseResult {
  const errors: string[] = [];
  const elements: ScriptElement[] = [];
  let title = 'Untitled';
  let author = '';
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'application/xml');
    
    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      errors.push('Invalid XML format: ' + parseError.textContent);
      return { screenplay: { elements: [] }, errors };
    }

    // Extract title page info
    const titlePage = doc.querySelector('TitlePage');
    if (titlePage) {
      const titleContent = titlePage.querySelector('Content[Type="Title"]');
      if (titleContent) {
        title = extractTextContent(titleContent) || 'Untitled';
      }
      
      const authorContent = titlePage.querySelector('Content[Type="Written by"]');
      if (authorContent) {
        author = extractTextContent(authorContent) || '';
      }
    }

    // Extract paragraphs from content
    const paragraphs = doc.querySelectorAll('Paragraph');
    let dualDialogueGroup: string | null = null;
    let dualPosition: 'left' | 'right' | null = null;

    paragraphs.forEach((para, index) => {
      const type = para.getAttribute('Type') || 'Action';
      const elementType = FDX_TYPE_MAP[type] || 'action';
      
      // Check for dual dialogue
      const isDualDialogue = para.hasAttribute('DualDialogue') || 
                             para.closest('DualDialogue') !== null;
      
      if (isDualDialogue) {
        if (!dualDialogueGroup) {
          dualDialogueGroup = `dual-${Date.now()}-${index}`;
          dualPosition = 'left';
        }
      } else {
        if (dualDialogueGroup && dualPosition === 'left') {
          dualPosition = 'right';
        } else {
          dualDialogueGroup = null;
          dualPosition = null;
        }
      }

      // Extract text content
      let content = '';
      const textNodes = para.querySelectorAll('Text');
      textNodes.forEach(textNode => {
        content += textNode.textContent || '';
      });
      
      // Fallback to direct text content
      if (!content && para.textContent) {
        content = para.textContent.trim();
      }

      // Skip empty paragraphs
      if (!content.trim()) return;

      // Get scene number if present
      const sceneNumber = para.getAttribute('Number') || undefined;

      const element: ScriptElement = {
        id: `fdx-${Date.now()}-${index}`,
        type: elementType,
        content: content.trim(),
        sceneNumber,
      };

      // Add dual dialogue info if applicable
      if (dualDialogueGroup) {
        element.dualDialogueGroupId = dualDialogueGroup;
        element.dualPosition = dualPosition || undefined;
      }

      elements.push(element);
    });

  } catch (error) {
    errors.push(`Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    screenplay: {
      title,
      author,
      elements,
    },
    errors,
  };
}

/**
 * Extract text content from an FDX element, handling nested Text nodes
 */
function extractTextContent(element: Element): string {
  const textNodes = element.querySelectorAll('Text');
  let text = '';
  textNodes.forEach(node => {
    text += node.textContent || '';
  });
  return text.trim() || element.textContent?.trim() || '';
}

/**
 * Validate if content is a valid FDX file
 */
export function isFdxFile(content: string): boolean {
  return content.includes('<FinalDraft') || content.includes('<?xml');
}

/**
 * Get FDX version from content
 */
export function getFdxVersion(content: string): string | null {
  const match = content.match(/Version="([^"]+)"/);
  return match ? match[1] : null;
}

