import { useState, useCallback, useMemo } from 'react';
import { X, Target } from 'lucide-react';
import { WritingGoal, WritingSession, GoalType, GoalPeriod } from '../types';
import { getGoalTypeLabel, getTodayString } from '../utils/writingStats';

interface WritingGoalsProps {
  isOpen: boolean;
  onClose: () => void;
  goal: WritingGoal | null;
  sessions: WritingSession[];
  currentStreak: number;
  longestStreak: number;
  todayProgress: { current: number; target: number };
  onUpdateGoal: (goal: WritingGoal) => void;
}

export default function WritingGoals({
  isOpen,
  onClose,
  goal,
  sessions,
  currentStreak,
  longestStreak,
  todayProgress,
  onUpdateGoal,
}: WritingGoalsProps) {
  const [goalType, setGoalType] = useState<GoalType>(goal?.type || 'pages');
  const [goalTarget, setGoalTarget] = useState(goal?.target || 3);
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>(goal?.period || 'daily');

  // Get last 28 days for calendar
  const calendarDays = useMemo(() => {
    const days: { date: string; met: boolean; partial: boolean; isToday: boolean }[] = [];
    const today = getTodayString();
    
    for (let i = 27; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toISOString().split('T')[0];
      
      const session = sessions.find(s => s.date === dateString);
      
      days.push({
        date: dateString,
        met: session?.goalMet || false,
        partial: !!(session && !session.goalMet && session.endWords > session.startWords),
        isToday: dateString === today,
      });
    }
    
    return days;
  }, [sessions]);

  const handleSaveGoal = useCallback(() => {
    const newGoal: WritingGoal = {
      id: goal?.id || `goal-${Date.now()}`,
      type: goalType,
      target: goalTarget,
      period: goalPeriod,
      createdAt: goal?.createdAt || Date.now(),
      enabled: true,
    };
    onUpdateGoal(newGoal);
    onClose();
  }, [goal, goalType, goalTarget, goalPeriod, onUpdateGoal, onClose]);

  if (!isOpen) return null;

  const progressPercentage = Math.min(100, (todayProgress.current / todayProgress.target) * 100);
  const goalMet = progressPercentage >= 100;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal writing-goals-modal" 
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>
            <Target size={20} />
            Writing Goals
          </h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* Goal Settings - Move to top */}
          <div className="goals-section">
            <h4>Set Your Goal</h4>
            <div className="goal-input-group">
              <label>Write</label>
              <input
                type="number"
                min="1"
                max="100"
                value={goalTarget}
                onChange={e => setGoalTarget(parseInt(e.target.value) || 1)}
              />
              <select value={goalType} onChange={e => setGoalType(e.target.value as GoalType)}>
                <option value="pages">pages</option>
                <option value="words">words</option>
                <option value="scenes">scenes</option>
                <option value="time">minutes</option>
              </select>
              <select value={goalPeriod} onChange={e => setGoalPeriod(e.target.value as GoalPeriod)}>
                <option value="daily">per day</option>
                <option value="session">per session</option>
              </select>
            </div>
          </div>

          {/* Today's Progress and Streak - Side by side */}
          <div className="goals-section goals-row">
            <div className="goals-col">
              <h4>Today's Progress</h4>
              <div className={`today-progress ${goalMet ? 'goal-celebration' : ''}`}>
                <div className="progress-ring">
                  <svg viewBox="0 0 100 100" className="progress-svg">
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="rgba(255,255,255,0.1)"
                      strokeWidth="10"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke={goalMet ? '#2ecc71' : 'var(--accent-gold)'}
                      strokeWidth="10"
                      strokeDasharray={`${progressPercentage * 2.83} 283`}
                      strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                    />
                  </svg>
                  <div className="progress-text">
                    <span className="progress-current">{todayProgress.current}</span>
                    <span className="progress-target">/{todayProgress.target}</span>
                  </div>
                </div>
                <div className="progress-label">
                  {goalMet ? '🎉 Goal Met!' : `${getGoalTypeLabel(goal?.type || 'pages')} today`}
                </div>
              </div>
            </div>

            <div className="goals-col">
              <h4>Writing Streak</h4>
              <div className="streak-display">
                <div className="streak-info">
                  <span className="streak-number">{currentStreak}</span>
                  <span className="streak-label">Current</span>
                </div>
                <div className="streak-fire">
                  {currentStreak > 0 ? '🔥' : '💨'}
                </div>
                <div className="streak-info">
                  <span className="streak-number">{longestStreak}</span>
                  <span className="streak-label">Best</span>
                </div>
              </div>
            </div>
          </div>

          {/* Calendar Heatmap */}
          <div className="goals-section">
            <h4>Last 4 Weeks</h4>
            <div className="goals-calendar">
              {calendarDays.map(day => (
                <div
                  key={day.date}
                  className={`calendar-day ${day.met ? 'met' : ''} ${day.partial ? 'partial' : ''} ${day.isToday ? 'today' : ''}`}
                  title={`${day.date}${day.met ? ' - Goal met!' : day.partial ? ' - Partial progress' : ''}`}
                >
                  {new Date(day.date).getDate()}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSaveGoal}>
            Save Goal
          </button>
        </div>
      </div>
    </div>
  );
}

