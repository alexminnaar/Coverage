import { Router, Request, Response } from 'express';
import { query, getClient } from '../services/db.js';
import { WritingGoal, WritingSession } from '../../../src/types.js';

const router = Router();

// Get writing goal for a project (or global)
router.get('/goals/:projectId?', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    let result;

    if (projectId) {
      result = await query<WritingGoal & { created_at: Date; updated_at: Date }>(
        'SELECT * FROM writing_goals WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
        [projectId]
      );
    } else {
      result = await query<WritingGoal & { created_at: Date; updated_at: Date }>(
        'SELECT * FROM writing_goals WHERE project_id IS NULL ORDER BY created_at DESC LIMIT 1'
      );
    }

    if (result.rows.length === 0) {
      return res.json(null);
    }

    const row = result.rows[0];
    const goal: WritingGoal = {
      id: row.id,
      type: row.type as WritingGoal['type'],
      target: row.target,
      period: row.period as WritingGoal['period'],
      enabled: row.enabled,
      createdAt: new Date(row.created_at).getTime(),
    };

    res.json(goal);
  } catch (error) {
    console.error('Error fetching writing goal:', error);
    res.status(500).json({ error: 'Failed to fetch writing goal' });
  }
});

// Save writing goal
router.post('/goals', async (req: Request, res: Response) => {
  try {
    const goal: WritingGoal = req.body;

    // Check if goal exists
    const existing = await query(
      'SELECT id FROM writing_goals WHERE id = $1',
      [goal.id]
    );

    if (existing.rows.length > 0) {
      // Update existing
      await query(
        `UPDATE writing_goals 
         SET type = $1, target = $2, period = $3, enabled = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [goal.type, goal.target, goal.period, goal.enabled, goal.id]
      );
    } else {
      // Insert new
      await query(
        `INSERT INTO writing_goals (id, project_id, type, target, period, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          goal.id,
          null, // For now, no project-specific goals
          goal.type,
          goal.target,
          goal.period,
          goal.enabled,
          new Date(goal.createdAt),
          new Date(goal.createdAt),
        ]
      );
    }

    res.json(goal);
  } catch (error) {
    console.error('Error saving writing goal:', error);
    res.status(500).json({ error: 'Failed to save writing goal' });
  }
});

// Get writing sessions for a project
router.get('/sessions/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { limit = '90' } = req.query; // Default to last 90 days

    const result = await query<WritingSession & { created_at: Date }>(
      `SELECT * FROM writing_sessions 
       WHERE project_id = $1 
       ORDER BY date DESC 
       LIMIT $2`,
      [projectId, parseInt(limit as string)]
    );

    const sessions: WritingSession[] = result.rows.map((row) => ({
      id: row.id,
      date: row.date,
      projectId: row.project_id,
      startPages: row.start_pages,
      startWords: row.start_words,
      endPages: row.end_pages,
      endWords: row.end_words,
      duration: row.duration,
      goalMet: row.goal_met,
    }));

    res.json(sessions);
  } catch (error) {
    console.error('Error fetching writing sessions:', error);
    res.status(500).json({ error: 'Failed to fetch writing sessions' });
  }
});

// Save writing sessions (bulk upsert)
router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions: WritingSession[] = req.body;

    // Use a transaction for bulk operations
    const client = await getClient();
    
    try {
      await client.query('BEGIN');
      
      for (const session of sessions) {
        // Check if session exists
        const existing = await client.query(
          'SELECT id FROM writing_sessions WHERE id = $1',
          [session.id]
        );

        if (existing.rows.length > 0) {
          // Update existing
          await client.query(
            `UPDATE writing_sessions 
             SET start_pages = $1, start_words = $2, end_pages = $3, end_words = $4, 
                 duration = $5, goal_met = $6
             WHERE id = $7`,
            [
              session.startPages,
              session.startWords,
              session.endPages,
              session.endWords,
              session.duration,
              session.goalMet,
              session.id,
            ]
          );
        } else {
          // Insert new
          await client.query(
            `INSERT INTO writing_sessions 
             (id, project_id, date, start_pages, start_words, end_pages, end_words, duration, goal_met)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              session.id,
              session.projectId,
              session.date,
              session.startPages,
              session.startWords,
              session.endPages,
              session.endWords,
              session.duration,
              session.goalMet,
            ]
          );
        }
      }

      await client.query('COMMIT');
      client.release();
      res.json({ success: true, count: sessions.length });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  } catch (error) {
    console.error('Error saving writing sessions:', error);
    res.status(500).json({ error: 'Failed to save writing sessions' });
  }
});

// Delete old sessions (cleanup utility)
router.delete('/sessions/cleanup', async (req: Request, res: Response) => {
  try {
    const { days = '90' } = req.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days as string));

    const result = await query(
      'DELETE FROM writing_sessions WHERE date < $1 RETURNING id',
      [cutoffDate.toISOString().split('T')[0]]
    );

    res.json({ deleted: result.rowCount });
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
    res.status(500).json({ error: 'Failed to cleanup sessions' });
  }
});

export default router;

