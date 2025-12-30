import { Router, Request, Response } from 'express';
import { query } from '../services/db.js';
import { Screenplay, ProjectMeta } from '../../../src/types.js';
import { estimatePageCount } from '../utils/pageCount.js';

const router = Router();

function triggerProjectEmbedding(projectId: string): void {
  // Best-effort: do not block the request. ai-service runs on the docker-compose network as `ai-service`.
  const base = process.env.AI_SERVICE_URL || 'http://ai-service:3002';
  fetch(`${base}/api/embed/project/${projectId}`, { method: 'POST' }).catch(() => {});
}

// Get all projects (metadata only)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query<{
      id: string;
      title: string;
      author: string;
      updated_at: Date;
      created_at: Date;
      data: Screenplay;
    }>(
      `SELECT id, title, author, updated_at, created_at, data 
       FROM projects 
       ORDER BY updated_at DESC`
    );

    const projects: ProjectMeta[] = result.rows.map((row) => {
      const screenplay = row.data as Screenplay;
      return {
        id: row.id,
        title: row.title,
        author: row.author,
        updatedAt: new Date(row.updated_at).getTime(),
        createdAt: new Date(row.created_at).getTime(),
        pageCount: estimatePageCount(screenplay),
      };
    });

    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get a single project by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query<{
      id: string;
      title: string;
      author: string;
      data: Screenplay;
      created_at: Date;
      updated_at: Date;
    }>('SELECT id, title, author, data, created_at, updated_at FROM projects WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const row = result.rows[0];
    const screenplay: Screenplay = {
      ...row.data,
      id: row.id,
      title: row.title,
      author: row.author,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };

    res.json(screenplay);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create a new project
router.post('/', async (req: Request, res: Response) => {
  try {
    const screenplay: Screenplay = req.body;

    // Validate required fields
    if (!screenplay.id || !screenplay.title || !screenplay.elements) {
      return res.status(400).json({ error: 'Invalid project data' });
    }

    // Ensure we have at least one element
    if (screenplay.elements.length === 0) {
      screenplay.elements = [{
        id: crypto.randomUUID(),
        type: 'scene-heading',
        content: '',
      }];
    }

    const now = new Date();
    const result = await query(
      `INSERT INTO projects (id, title, author, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, author, created_at, updated_at`,
      [
        screenplay.id,
        screenplay.title,
        screenplay.author || '',
        JSON.stringify(screenplay),
        new Date(screenplay.createdAt || now.getTime()),
        new Date(screenplay.updatedAt || now.getTime()),
      ]
    );

    const row = result.rows[0];
    const created: Screenplay = {
      ...screenplay,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };

    triggerProjectEmbedding(screenplay.id);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Error creating project:', error);
    if (error.code === '23505') {
      // Unique violation
      return res.status(409).json({ error: 'Project with this ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update an existing project
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const screenplay: Screenplay = req.body;

    // Ensure IDs match
    if (screenplay.id !== id) {
      return res.status(400).json({ error: 'Project ID mismatch' });
    }

    // Ensure we have at least one element
    if (!screenplay.elements || screenplay.elements.length === 0) {
      screenplay.elements = [{
        id: crypto.randomUUID(),
        type: 'scene-heading',
        content: '',
      }];
    }

    const result = await query(
      `UPDATE projects 
       SET title = $1, author = $2, data = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, title, author, created_at, updated_at`,
      [
        screenplay.title,
        screenplay.author || '',
        JSON.stringify(screenplay),
        id,
      ]
    );

    if (result.rows.length === 0) {
      // Upsert behavior: if the project doesn't exist yet, create it.
      // This avoids noisy 404s during normal flows (new project + autosave).
      const now = new Date();
      const inserted = await query(
        `INSERT INTO projects (id, title, author, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         RETURNING id, title, author, created_at, updated_at`,
        [
          screenplay.id,
          screenplay.title,
          screenplay.author || '',
          JSON.stringify(screenplay),
          new Date(screenplay.createdAt || now.getTime()),
        ]
      );

      const row = inserted.rows[0];
      const created: Screenplay = {
        ...screenplay,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      };

      triggerProjectEmbedding(screenplay.id);
      return res.json(created);
    }

    const row = result.rows[0];
    const updated: Screenplay = {
      ...screenplay,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };

    triggerProjectEmbedding(screenplay.id);
    res.json(updated);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete a project
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM projects WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;

