export interface StoryTemplateBeat {
  name: string;
  description: string;
  pageRange: [number, number]; // [start%, end%] of total page count
}

export interface StoryTemplate {
  id: string;
  name: string;
  description: string;
  source: string;
  beats: StoryTemplateBeat[];
}

export const STORY_TEMPLATES: StoryTemplate[] = [
  {
    id: 'save-the-cat',
    name: 'Save the Cat!',
    description: 'Blake Snyder\'s 15-beat structure for commercial screenplays',
    source: 'Blake Snyder',
    beats: [
      { name: 'Opening Image', description: 'Visual that represents the starting point and tone', pageRange: [0, 1] },
      { name: 'Theme Stated', description: 'Someone poses the thematic question/lesson', pageRange: [4, 6] },
      { name: 'Set-Up', description: 'Establish the hero\'s world, flaws, and stakes', pageRange: [1, 10] },
      { name: 'Catalyst', description: 'Inciting incident that disrupts the hero\'s world', pageRange: [10, 12] },
      { name: 'Debate', description: 'Hero hesitates, considers options', pageRange: [12, 25] },
      { name: 'Break into Two', description: 'Hero makes a choice and enters the new world', pageRange: [25, 27] },
      { name: 'B Story', description: 'Introduce the love/friendship subplot', pageRange: [27, 30] },
      { name: 'Fun and Games', description: 'Promise of the premise - what we came to see', pageRange: [30, 50] },
      { name: 'Midpoint', description: 'False victory/defeat, stakes raise', pageRange: [50, 55] },
      { name: 'Bad Guys Close In', description: 'Pressure intensifies, team fractures', pageRange: [55, 75] },
      { name: 'All Is Lost', description: 'Opposite of the midpoint, rock bottom', pageRange: [75, 80] },
      { name: 'Dark Night of the Soul', description: 'Hero wallows, then has an epiphany', pageRange: [80, 85] },
      { name: 'Break into Three', description: 'Solution found, hero commits to action', pageRange: [85, 87] },
      { name: 'Finale', description: 'Hero executes plan, proves transformation', pageRange: [87, 99] },
      { name: 'Final Image', description: 'Opposite of opening image, showing change', pageRange: [99, 100] },
    ],
  },
  {
    id: 'heros-journey',
    name: 'Hero\'s Journey',
    description: 'Joseph Campbell\'s 12-stage mythological structure',
    source: 'Joseph Campbell',
    beats: [
      { name: 'Ordinary World', description: 'Hero\'s normal life before the adventure', pageRange: [0, 10] },
      { name: 'Call to Adventure', description: 'Hero receives a challenge or invitation', pageRange: [10, 15] },
      { name: 'Refusal of the Call', description: 'Hero hesitates or expresses fear', pageRange: [15, 20] },
      { name: 'Meeting the Mentor', description: 'Hero gains guidance, training, or a gift', pageRange: [20, 25] },
      { name: 'Crossing the Threshold', description: 'Hero commits to the adventure', pageRange: [25, 30] },
      { name: 'Tests, Allies, Enemies', description: 'Hero faces challenges and makes friends/foes', pageRange: [30, 50] },
      { name: 'Approach to the Inmost Cave', description: 'Hero prepares for the major ordeal', pageRange: [50, 60] },
      { name: 'The Ordeal', description: 'Hero faces their greatest fear or challenge', pageRange: [60, 70] },
      { name: 'Reward (Seizing the Sword)', description: 'Hero gains what they sought', pageRange: [70, 75] },
      { name: 'The Road Back', description: 'Hero begins journey home, pursued by forces', pageRange: [75, 85] },
      { name: 'Resurrection', description: 'Final test, hero is transformed', pageRange: [85, 95] },
      { name: 'Return with the Elixir', description: 'Hero returns home, changed, with a boon', pageRange: [95, 100] },
    ],
  },
  {
    id: 'three-act',
    name: 'Three-Act Structure',
    description: 'Classic setup, confrontation, resolution format',
    source: 'Aristotle / Syd Field',
    beats: [
      { name: 'Act 1: Setup', description: 'Establish world, character, and conflict', pageRange: [0, 25] },
      { name: 'Plot Point 1', description: 'Turning point that spins story in new direction', pageRange: [22, 27] },
      { name: 'Act 2A: Rising Action', description: 'Hero pursues goal, faces obstacles', pageRange: [25, 50] },
      { name: 'Midpoint', description: 'Major reversal or revelation', pageRange: [48, 52] },
      { name: 'Act 2B: Complications', description: 'Stakes rise, obstacles multiply', pageRange: [50, 75] },
      { name: 'Plot Point 2', description: 'Darkest moment, launching final act', pageRange: [73, 77] },
      { name: 'Act 3: Resolution', description: 'Climax and resolution of all conflicts', pageRange: [75, 100] },
    ],
  },
  {
    id: 'five-act',
    name: 'Five-Act Structure',
    description: 'Shakespearean dramatic structure',
    source: 'Gustav Freytag',
    beats: [
      { name: 'Act 1: Exposition', description: 'Introduce characters, setting, initial conflict', pageRange: [0, 15] },
      { name: 'Act 2: Rising Action', description: 'Complications develop, tension builds', pageRange: [15, 40] },
      { name: 'Act 3: Climax', description: 'Turning point, highest drama', pageRange: [40, 60] },
      { name: 'Act 4: Falling Action', description: 'Events unfold toward resolution', pageRange: [60, 85] },
      { name: 'Act 5: Resolution', description: 'Final outcome and loose ends tied', pageRange: [85, 100] },
    ],
  },
  {
    id: 'story-circle',
    name: 'Dan Harmon\'s Story Circle',
    description: '8-step structure for episodic TV and storytelling',
    source: 'Dan Harmon',
    beats: [
      { name: '1. You (A character in comfort)', description: 'Establish protagonist in their zone', pageRange: [0, 12] },
      { name: '2. Need (But they want something)', description: 'Character desires something', pageRange: [12, 20] },
      { name: '3. Go (Enter unfamiliar situation)', description: 'Cross threshold into new world', pageRange: [20, 30] },
      { name: '4. Search (Adapt to it)', description: 'Navigate challenges, learn rules', pageRange: [30, 50] },
      { name: '5. Find (Get what they wanted)', description: 'Achieve the goal', pageRange: [50, 60] },
      { name: '6. Take (Pay a heavy price)', description: 'Face consequences', pageRange: [60, 75] },
      { name: '7. Return (Go back to start)', description: 'Return to the familiar', pageRange: [75, 90] },
      { name: '8. Change (Having changed)', description: 'Show transformation', pageRange: [90, 100] },
    ],
  },
  {
    id: 'sequence-approach',
    name: 'Sequence Approach',
    description: '8-sequence structure for pacing',
    source: 'Frank Daniel',
    beats: [
      { name: 'Sequence 1: Status Quo & Inciting Incident', description: 'World setup and disruption', pageRange: [0, 12] },
      { name: 'Sequence 2: Predicament & Lock In', description: 'Character commits to solving problem', pageRange: [12, 25] },
      { name: 'Sequence 3: First Obstacle & Raising Stakes', description: 'Initial attempts and complications', pageRange: [25, 37] },
      { name: 'Sequence 4: First Culmination & Midpoint', description: 'Major revelation or reversal', pageRange: [37, 50] },
      { name: 'Sequence 5: Subplot & Rising Action', description: 'Deepen relationships, raise stakes', pageRange: [50, 62] },
      { name: 'Sequence 6: Main Culmination & All Is Lost', description: 'Hero hits rock bottom', pageRange: [62, 75] },
      { name: 'Sequence 7: New Tension & Twist', description: 'New information changes everything', pageRange: [75, 87] },
      { name: 'Sequence 8: Resolution', description: 'Climax and wrap-up', pageRange: [87, 100] },
    ],
  },
];

/**
 * Get beats as Beat objects for the Beat Board
 */
export function templateToBeats(template: StoryTemplate): { title: string; description: string; actIndex: number }[] {
  return template.beats.map((beat, index) => ({
    title: beat.name,
    description: beat.description,
    actIndex: Math.min(Math.floor(index / (template.beats.length / 3)), 2), // Distribute across 3 acts
  }));
}

