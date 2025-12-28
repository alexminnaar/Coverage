/**
 * Simple diff engine for comparing script content
 */

export type DiffType = 'unchanged' | 'added' | 'removed';

export interface DiffLine {
  type: DiffType;
  content: string;
  lineNumber?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  similarity: number;
}

/**
 * Calculate Longest Common Subsequence (LCS) for diff
 */
function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

/**
 * Compare two text strings and produce a diff
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Handle empty inputs
  if (oldLines.length === 0 && newLines.length === 0) {
    return { lines: [], additions: 0, deletions: 0, similarity: 100 };
  }

  if (oldLines.length === 0) {
    return {
      lines: newLines.map((line, i) => ({ type: 'added', content: line, lineNumber: i + 1 })),
      additions: newLines.length,
      deletions: 0,
      similarity: 0,
    };
  }

  if (newLines.length === 0) {
    return {
      lines: oldLines.map((line, i) => ({ type: 'removed', content: line, lineNumber: i + 1 })),
      additions: 0,
      deletions: oldLines.length,
      similarity: 0,
    };
  }

  const dp = lcs(oldLines, newLines);
  const result: DiffLine[] = [];
  
  // Use iterative approach to avoid stack overflow
  const m = oldLines.length;
  const n = newLines.length;
  let i = m;
  let j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i === 0) {
      stack.push({ type: 'added', content: newLines[j - 1], lineNumber: j });
      j--;
    } else if (j === 0) {
      stack.push({ type: 'removed', content: oldLines[i - 1], lineNumber: i });
      i--;
    } else if (oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'unchanged', content: oldLines[i - 1], lineNumber: i });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      stack.push({ type: 'removed', content: oldLines[i - 1], lineNumber: i });
      i--;
    } else {
      stack.push({ type: 'added', content: newLines[j - 1], lineNumber: j });
      j--;
    }
  }

  // Reverse the stack to get correct order
  while (stack.length > 0) {
    result.push(stack.pop()!);
  }

  // Count additions and deletions
  const additions = result.filter(l => l.type === 'added').length;
  const deletions = result.filter(l => l.type === 'removed').length;
  const unchanged = result.filter(l => l.type === 'unchanged').length;

  // Calculate similarity percentage
  const totalLines = Math.max(oldLines.length, newLines.length);
  const similarity = totalLines > 0 
    ? Math.round((unchanged / totalLines) * 100) 
    : 100;

  return {
    lines: result,
    additions,
    deletions,
    similarity,
  };
}

/**
 * Get a simplified inline diff for display
 */
export function getSimpleDiff(
  oldText: string, 
  newText: string
): { left: string[]; right: string[]; changes: number } {
  const diff = computeDiff(oldText, newText);
  
  const left: string[] = [];
  const right: string[] = [];

  for (const line of diff.lines) {
    if (line.type === 'unchanged') {
      left.push(line.content);
      right.push(line.content);
    } else if (line.type === 'removed') {
      left.push(line.content);
    } else if (line.type === 'added') {
      right.push(line.content);
    }
  }

  return {
    left,
    right,
    changes: diff.additions + diff.deletions,
  };
}

