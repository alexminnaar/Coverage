import { ScriptElement, WritingGoal, WritingSession, WritingStats, GoalType } from '../types';

const WORDS_PER_PAGE = 250; // Approximate screenplay words per page

/**
 * Count words in script elements
 */
export function countWords(elements: ScriptElement[]): number {
  return elements.reduce((total, el) => {
    if (el.isDeleted) return total;
    const words = el.content.trim().split(/\s+/).filter(w => w.length > 0);
    return total + words.length;
  }, 0);
}

/**
 * Count scenes in script elements
 */
export function countScenes(elements: ScriptElement[]): number {
  return elements.filter(el => el.type === 'scene-heading' && !el.isDeleted).length;
}

/**
 * Estimate pages from word count
 */
export function estimatePages(wordCount: number): number {
  return Math.ceil(wordCount / WORDS_PER_PAGE);
}

/**
 * Get today's date string
 */
export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calculate current progress towards goal
 */
export function calculateProgress(
  elements: ScriptElement[],
  goal: WritingGoal,
  todaySession?: WritingSession
): { current: number; target: number; percentage: number } {
  const wordCount = countWords(elements);
  const pageCount = estimatePages(wordCount);
  const sceneCount = countScenes(elements);

  let current = 0;
  
  switch (goal.type) {
    case 'pages':
      if (todaySession) {
        current = pageCount - todaySession.startPages;
      } else {
        current = 0; // No session started
      }
      break;
    case 'words':
      if (todaySession) {
        current = wordCount - todaySession.startWords;
      } else {
        current = 0;
      }
      break;
    case 'scenes':
      // For scenes, we count total since it's cumulative
      current = sceneCount;
      break;
    case 'time':
      if (todaySession) {
        current = todaySession.duration;
      } else {
        current = 0;
      }
      break;
  }

  // Ensure current is not negative
  current = Math.max(0, current);

  const percentage = Math.min(100, (current / goal.target) * 100);

  return {
    current,
    target: goal.target,
    percentage,
  };
}

/**
 * Calculate writing streak
 */
export function calculateStreak(sessions: WritingSession[]): number {
  if (sessions.length === 0) return 0;

  // Sort sessions by date descending
  const sortedSessions = [...sessions]
    .filter(s => s.goalMet)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (sortedSessions.length === 0) return 0;

  const today = getTodayString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayString = yesterday.toISOString().split('T')[0];

  // Check if we have today or yesterday
  const mostRecent = sortedSessions[0].date;
  if (mostRecent !== today && mostRecent !== yesterdayString) {
    return 0; // Streak broken
  }

  let streak = 1;
  let currentDate = new Date(mostRecent);

  for (let i = 1; i < sortedSessions.length; i++) {
    const expectedDate = new Date(currentDate);
    expectedDate.setDate(expectedDate.getDate() - 1);
    const expectedString = expectedDate.toISOString().split('T')[0];

    if (sortedSessions[i].date === expectedString) {
      streak++;
      currentDate = expectedDate;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Calculate longest streak ever
 */
export function calculateLongestStreak(sessions: WritingSession[]): number {
  if (sessions.length === 0) return 0;

  const sortedSessions = [...sessions]
    .filter(s => s.goalMet)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (sortedSessions.length === 0) return 0;

  let maxStreak = 1;
  let currentStreak = 1;
  
  for (let i = 1; i < sortedSessions.length; i++) {
    const prevDate = new Date(sortedSessions[i - 1].date);
    const currDate = new Date(sortedSessions[i].date);
    
    prevDate.setDate(prevDate.getDate() + 1);
    
    if (prevDate.toISOString().split('T')[0] === currDate.toISOString().split('T')[0]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  return maxStreak;
}

/**
 * Get the last 7 days of sessions for the calendar
 */
export function getWeekSessions(sessions: WritingSession[]): WritingSession[] {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  return sessions.filter(s => new Date(s.date) >= weekAgo);
}

/**
 * Create a new writing session
 */
export function createWritingSession(
  projectId: string,
  elements: ScriptElement[]
): WritingSession {
  const wordCount = countWords(elements);
  const pageCount = estimatePages(wordCount);

  return {
    id: `session-${Date.now()}`,
    date: getTodayString(),
    projectId,
    startPages: pageCount,
    startWords: wordCount,
    endPages: pageCount,
    endWords: wordCount,
    duration: 0,
    goalMet: false,
  };
}

/**
 * Update an existing session
 */
export function updateWritingSession(
  session: WritingSession,
  elements: ScriptElement[],
  goal: WritingGoal
): WritingSession {
  const wordCount = countWords(elements);
  const pageCount = estimatePages(wordCount);
  
  const progress = calculateProgress(elements, goal, session);

  return {
    ...session,
    endPages: pageCount,
    endWords: wordCount,
    goalMet: progress.percentage >= 100,
  };
}

/**
 * Get goal type label
 */
export function getGoalTypeLabel(type: GoalType): string {
  switch (type) {
    case 'pages': return 'pages';
    case 'words': return 'words';
    case 'scenes': return 'scenes';
    case 'time': return 'minutes';
  }
}

/**
 * Get complete writing stats
 */
export function getWritingStats(
  sessions: WritingSession[],
  goal: WritingGoal,
  elements: ScriptElement[],
  currentSession?: WritingSession
): WritingStats {
  const progress = calculateProgress(elements, goal, currentSession);

  return {
    currentStreak: calculateStreak(sessions),
    longestStreak: calculateLongestStreak(sessions),
    totalDaysWritten: new Set(sessions.filter(s => s.goalMet).map(s => s.date)).size,
    todayProgress: {
      current: progress.current,
      target: goal.target,
      type: goal.type,
    },
    weekProgress: getWeekSessions(sessions),
  };
}

