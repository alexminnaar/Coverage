export type ElementType =
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition';

export interface ScriptElement {
  id: string;
  type: ElementType;
  content: string;
  // For scene-headings: optional synopsis and notes
  synopsis?: string;
  notes?: string;
  // For scene numbering
  sceneNumber?: string;
  isSceneLocked?: boolean;
  // For dual dialogue
  dualDialogueGroupId?: string;
  dualPosition?: 'left' | 'right';
  // For revision tracking
  revisionId?: string;
  isDeleted?: boolean;
  previousContent?: string;
  // For duration estimation (manual override in seconds)
  durationOverride?: number;
}

// Inline AI Edit Proposal
export interface StructuredElement {
  type: ElementType;
  content: string;
}

export interface PendingEdit {
  elementId: string;
  originalContent: string;
  newContent: string;
  reason?: string;
  // Optional: structured new elements with explicit types
  newElements?: StructuredElement[];
}

// Revision tracking types
export type RevisionColor = 'white' | 'blue' | 'pink' | 'yellow' | 'green' | 'goldenrod' | 'buff' | 'salmon';

export interface Revision {
  id: string;
  color: RevisionColor;
  date: number;
  description: string;
}

export const REVISION_COLORS: { name: string; value: RevisionColor; hex: string }[] = [
  { name: 'White (Original)', value: 'white', hex: '#ffffff' },
  { name: 'Blue', value: 'blue', hex: '#add8e6' },
  { name: 'Pink', value: 'pink', hex: '#ffb6c1' },
  { name: 'Yellow', value: 'yellow', hex: '#ffff99' },
  { name: 'Green', value: 'green', hex: '#90ee90' },
  { name: 'Goldenrod', value: 'goldenrod', hex: '#daa520' },
  { name: 'Buff', value: 'buff', hex: '#f0dc82' },
  { name: 'Salmon', value: 'salmon', hex: '#fa8072' },
];

// Script snapshot for version control
export interface ScriptSnapshot {
  id: string;
  name: string;
  createdAt: number;
  elements: ScriptElement[];
  title: string;
  author: string;
}

// Script notes / annotations
export interface ScriptNote {
  id: string;
  elementId: string;        // Which element this note is attached to
  content: string;
  author?: string;
  createdAt: number;
  color?: string;           // For categorization
  resolved?: boolean;
}

export interface Screenplay {
  id: string;
  title: string;
  author: string;
  elements: ScriptElement[];
  updatedAt: number;
  createdAt: number;
  // Title page fields
  contact?: string;
  draftDate?: string;
  copyright?: string;
  basedOn?: string;
  // Beat board
  beats?: Beat[];
  beatStructure?: BeatStructure;
  // Scene numbering
  sceneNumberingEnabled?: boolean;
  scenesLocked?: boolean;
  // Revisions
  revisions?: Revision[];
  currentRevisionId?: string;
  // Snapshots
  snapshots?: ScriptSnapshot[];
  // Script notes
  scriptNotes?: ScriptNote[];
  // Settings
  autoContd?: boolean;  // Auto-generate CONT'D (default true)
}

// Theme type
export type Theme = 'dark' | 'light' | 'system';

// Beat Board types
export type BeatStructure = 'three-act' | 'four-act' | 'five-act';

export interface Beat {
  id: string;
  title: string;
  description: string;
  color?: string; // hex color for tag
  actIndex: number; // 0-2 for 3-act, 0-3 for 4-act, etc.
  order: number; // position within act
  linkedSceneId?: string; // optional link to scene
}

export const BEAT_COLORS = [
  { name: 'Red', value: '#e74c3c' },
  { name: 'Orange', value: '#e67e22' },
  { name: 'Yellow', value: '#f1c40f' },
  { name: 'Green', value: '#27ae60' },
  { name: 'Blue', value: '#3498db' },
  { name: 'Purple', value: '#9b59b6' },
  { name: 'Pink', value: '#e91e8b' },
  { name: 'Gray', value: '#7f8c8d' },
];

export const BEAT_STRUCTURES: Record<BeatStructure, string[]> = {
  'three-act': ['Act 1', 'Act 2', 'Act 3'],
  'four-act': ['Act 1', 'Act 2A', 'Act 2B', 'Act 3'],
  'five-act': ['Act 1', 'Act 2', 'Act 3', 'Act 4', 'Act 5'],
};

// Project metadata for the project list
export interface ProjectMeta {
  id: string;
  title: string;
  author: string;
  updatedAt: number;
  createdAt: number;
  pageCount: number;
}

export const ELEMENT_LABELS: Record<ElementType, string> = {
  'scene-heading': 'Scene Heading',
  'action': 'Action',
  'character': 'Character',
  'dialogue': 'Dialogue',
  'parenthetical': 'Parenthetical',
  'transition': 'Transition',
};

// Element type cycling order when pressing Tab
export const ELEMENT_CYCLE: ElementType[] = [
  'action',
  'character',
  'dialogue',
  'parenthetical',
];

export function getNextElementType(current: ElementType): ElementType {
  // Scene heading and transition don't cycle
  if (current === 'scene-heading' || current === 'transition') {
    return 'action';
  }

  const idx = ELEMENT_CYCLE.indexOf(current);
  if (idx === -1) return 'action';
  return ELEMENT_CYCLE[(idx + 1) % ELEMENT_CYCLE.length];
}

export function getDefaultNextType(current: ElementType): ElementType {
  switch (current) {
    case 'scene-heading':
      return 'action';
    case 'action':
      return 'action';
    case 'character':
      return 'dialogue';
    case 'dialogue':
      return 'action';
    case 'parenthetical':
      return 'dialogue';
    case 'transition':
      return 'scene-heading';
    default:
      return 'action';
  }
}

// Writing Goals types
export type GoalType = 'pages' | 'words' | 'scenes' | 'time';
export type GoalPeriod = 'daily' | 'weekly' | 'session';

export interface WritingGoal {
  id: string;
  type: GoalType;
  target: number;
  period: GoalPeriod;
  createdAt: number;
  enabled: boolean;
}

export interface WritingSession {
  id: string;
  date: string; // YYYY-MM-DD
  projectId: string;
  startPages: number;
  startWords: number;
  endPages: number;
  endWords: number;
  duration: number; // minutes
  goalMet: boolean;
}

export interface WritingStats {
  currentStreak: number;
  longestStreak: number;
  totalDaysWritten: number;
  todayProgress: { current: number; target: number; type: GoalType };
  weekProgress: WritingSession[];
}

