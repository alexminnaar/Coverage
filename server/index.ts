// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import projectRoutes from './routes/projects.js';
import writingRoutes from './routes/writing.js';
import { testConnection } from './services/db.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://frontend:5173'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/projects', projectRoutes);
app.use('/api/writing', writingRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({ 
    name: 'Screenwriter Backend Server',
    version: '1.0.0',
    endpoints: [
      'GET  /api/projects - List all projects',
      'GET  /api/projects/:id - Get project by ID',
      'POST /api/projects - Create new project',
      'PUT  /api/projects/:id - Update project',
      'DELETE /api/projects/:id - Delete project',
      'GET  /api/writing/goals/:projectId? - Get writing goal',
      'POST /api/writing/goals - Save writing goal',
      'GET  /api/writing/sessions/:projectId - Get writing sessions',
      'POST /api/writing/sessions - Save writing sessions'
    ],
    note: 'AI endpoints have been moved to Python service on port 3002'
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🎬 Screenwriter Backend Server running on http://localhost:${PORT}`);
  
  // Test database connection
  const dbConnected = await testConnection();
  if (dbConnected) {
    console.log(`   Database: Connected`);
  } else {
    console.log(`   Database: Connection failed`);
  }
});

