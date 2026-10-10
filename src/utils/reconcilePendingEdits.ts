import type { PendingEdit, ScriptElement } from '../types';

function comparableContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').trimEnd();
}

export function reconcilePendingEdits(
  edits: PendingEdit[],
  elements: ScriptElement[],
): PendingEdit[] {
  return edits.map((edit) => {
    const target = elements.find((element) => element.id === edit.elementId);
    if (target?.content === edit.originalContent) return edit;

    if (
      target
      && comparableContent(target.content) === comparableContent(edit.originalContent)
    ) {
      return { ...edit, originalContent: target.content };
    }

    const exactMatches = elements.filter(
      (element) => element.content === edit.originalContent,
    );
    if (exactMatches.length === 1) {
      return { ...edit, elementId: exactMatches[0].id };
    }

    const normalizedMatches = elements.filter(
      (element) =>
        comparableContent(element.content) === comparableContent(edit.originalContent),
    );
    if (normalizedMatches.length === 1) {
      return {
        ...edit,
        elementId: normalizedMatches[0].id,
        originalContent: normalizedMatches[0].content,
      };
    }

    return edit;
  });
}
