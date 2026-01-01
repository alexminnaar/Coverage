import type { ScriptElement } from '../types';

export interface GlobalIndexOptions {
  maxScenes?: number;
  maxCharacters?: number;
  maxChars?: number;
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function clampLines(lines: string[], maxChars: number): string {
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) break;
    out += line + '\n';
  }
  return out.trimEnd();
}

export function buildGlobalIndex(
  elements: ScriptElement[],
  opts: GlobalIndexOptions = {}
): string {
  const maxScenes = opts.maxScenes ?? 60;
  const maxCharacters = opts.maxCharacters ?? 20;
  const maxChars = opts.maxChars ?? 2800;

  const sceneLines: string[] = [];
  let sceneNo = 0;
  for (const el of elements) {
    if (el.type !== 'scene-heading') continue;
    sceneNo += 1;
    if (sceneNo > maxScenes) break;
    const heading = (el.content || 'Untitled Scene').trim();
    sceneLines.push(`${sceneNo}. ${heading} (sceneId=${el.id})`);
  }

  // Character “line counts”: count dialogue elements that immediately follow a character element.
  const counts = new Map<string, number>();
  let currentCharacter: string | null = null;
  for (const el of elements) {
    if (el.type === 'character') {
      const name = normalizeName(el.content || '');
      currentCharacter = name || null;
      continue;
    }
    if (el.type === 'dialogue') {
      if (currentCharacter) {
        counts.set(currentCharacter, (counts.get(currentCharacter) ?? 0) + 1);
      }
      continue;
    }
    // Reset character on other structural elements (keeps it conservative)
    if (el.type === 'scene-heading' || el.type === 'action' || el.type === 'transition') {
      currentCharacter = null;
    }
  }

  const characterLines: string[] = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCharacters)
    .map(([name, n]) => `${name} — ${n} dialogue lines`);

  const lines: string[] = [];
  lines.push('Global Index v1');
  lines.push('');
  lines.push('Scenes:');
  lines.push(...(sceneLines.length ? sceneLines : ['(none)']));
  lines.push('');
  lines.push('Characters:');
  lines.push(...(characterLines.length ? characterLines : ['(none)']));

  return clampLines(lines, maxChars);
}


