import { Screenplay, ElementType, REVISION_COLORS } from '../types';
import { getCharacterWithContd } from './contdMore';

/**
 * Export screenplay to Final Draft .fdx XML format
 */

// Mapping from our element types to FDX paragraph types
const TYPE_TO_FDX: Record<ElementType, string> = {
  'scene-heading': 'Scene Heading',
  'action': 'Action',
  'character': 'Character',
  'dialogue': 'Dialogue',
  'parenthetical': 'Parenthetical',
  'transition': 'Transition',
};

/**
 * Export a screenplay to FDX format
 */
export function exportToFdx(screenplay: Screenplay): string {
  const { title, author, elements, contact, draftDate, copyright, revisions } = screenplay;

  // Build XML document
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="4">

<Content>
`;

  // Add title page
  xml += generateTitlePage(title, author, contact, draftDate, copyright);

  // Add paragraphs
  elements.forEach((element, index) => {
    if (element.isDeleted) return; // Skip deleted elements
    
    const fdxType = TYPE_TO_FDX[element.type] || 'Action';
    let content = element.content;

    // For character elements, add CONT'D if applicable
    if (element.type === 'character') {
      content = getCharacterWithContd(elements, index);
    }

    // Escape XML special characters
    content = escapeXml(content);

    // Build paragraph attributes
    let attrs = `Type="${fdxType}"`;
    
    if (element.type === 'scene-heading' && element.sceneNumber) {
      attrs += ` Number="${element.sceneNumber}"`;
    }

    // Handle dual dialogue
    if (element.dualDialogueGroupId && element.dualPosition) {
      if (element.dualPosition === 'left') {
        attrs += ` DualDialogue="Start"`;
      } else if (element.dualPosition === 'right') {
        attrs += ` DualDialogue="End"`;
      }
    }

    // Add revision marks
    if (element.revisionId && revisions) {
      const revision = revisions.find(r => r.id === element.revisionId);
      if (revision) {
        const colorInfo = REVISION_COLORS.find(c => c.value === revision.color);
        if (colorInfo) {
          attrs += ` RevisionID="${element.revisionId}"`;
        }
      }
    }

    xml += `  <Paragraph ${attrs}>
    <Text>${content}</Text>
  </Paragraph>
`;
  });

  xml += `</Content>

</FinalDraft>`;

  return xml;
}

/**
 * Generate title page XML
 */
function generateTitlePage(
  title: string,
  author: string,
  contact?: string,
  draftDate?: string,
  copyright?: string
): string {
  let xml = `<TitlePage>
  <Content Type="Title">
    <Paragraph Type="Text">
      <Text>${escapeXml(title)}</Text>
    </Paragraph>
  </Content>
`;

  if (author) {
    xml += `  <Content Type="Written by">
    <Paragraph Type="Text">
      <Text>${escapeXml(author)}</Text>
    </Paragraph>
  </Content>
`;
  }

  if (contact) {
    xml += `  <Content Type="Contact">
    <Paragraph Type="Text">
      <Text>${escapeXml(contact)}</Text>
    </Paragraph>
  </Content>
`;
  }

  if (draftDate) {
    xml += `  <Content Type="Draft Date">
    <Paragraph Type="Text">
      <Text>${escapeXml(draftDate)}</Text>
    </Paragraph>
  </Content>
`;
  }

  if (copyright) {
    xml += `  <Content Type="Copyright">
    <Paragraph Type="Text">
      <Text>${escapeXml(copyright)}</Text>
    </Paragraph>
  </Content>
`;
  }

  xml += `</TitlePage>
`;

  return xml;
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Download the FDX file
 */
export function downloadFdx(screenplay: Screenplay): void {
  const fdxContent = exportToFdx(screenplay);
  const blob = new Blob([fdxContent], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${screenplay.title || 'screenplay'}.fdx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

