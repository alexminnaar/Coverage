import { v4 as uuidv4 } from 'uuid';
import type { ElementType, PendingEdit, Screenplay, ScriptElement } from '../types';

export function applyPendingEdit(
  screenplay: Screenplay,
  elementId: string,
  edit: PendingEdit,
  createId: () => string = uuidv4,
): Screenplay {
  const index = screenplay.elements.findIndex(element => element.id === elementId);
  if (index === -1) return screenplay;

  const oldElement = screenplay.elements[index];
  if (oldElement.content !== edit.originalContent) return screenplay;

  const parts = edit.newContent.split(/\n\n+/);
  const isSimpleUpdate = parts.length <= 1 && (!edit.newElements || edit.newElements.length === 0);

  if (isSimpleUpdate) {
    return {
      ...screenplay,
      elements: screenplay.elements.map(element =>
        element.id === elementId ? { ...element, content: edit.newContent } : element
      ),
    };
  }

  const isInsertOnly = edit.originalContent === edit.newContent;
  const updatedFirstElement = {
    ...oldElement,
    content: isInsertOnly ? oldElement.content : edit.newContent,
  };
  const newElements: ScriptElement[] = [];

  if (edit.newElements?.length) {
    for (const structuredElement of edit.newElements) {
      newElements.push({
        id: createId(),
        type: structuredElement.type,
        content: structuredElement.content,
      });
    }
  } else {
    updatedFirstElement.content = parts[0];

    for (let partIndex = 1; partIndex < parts.length; partIndex++) {
      const content = parts[partIndex].trim();
      if (!content) continue;

      let type: ElementType = 'action';
      if (content === content.toUpperCase() && content.length < 50) {
        type = 'character';
      } else if (content.startsWith('(') && content.endsWith(')')) {
        type = 'parenthetical';
      } else if (/^(INT|EXT)\./i.test(content)) {
        type = 'scene-heading';
      } else {
        const previousType = newElements.length > 0
          ? newElements[newElements.length - 1].type
          : updatedFirstElement.type;
        if (previousType === 'character') type = 'dialogue';
      }

      if (content.includes('\n') && type === 'action') {
        const subParts = content.split('\n');
        if (subParts.length === 2 && subParts[0] === subParts[0].toUpperCase()) {
          newElements.push(
            { id: createId(), type: 'character', content: subParts[0].trim() },
            { id: createId(), type: 'dialogue', content: subParts[1].trim() },
          );
          continue;
        }
      }

      newElements.push({ id: createId(), type, content });
    }
  }

  const elements = [...screenplay.elements];
  elements.splice(index, 1, updatedFirstElement, ...newElements);
  return { ...screenplay, elements };
}
