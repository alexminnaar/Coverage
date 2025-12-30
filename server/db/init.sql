-- Screenwriter Database Schema

-- Vector extension (pgvector) for semantic retrieval
CREATE EXTENSION IF NOT EXISTS vector;

-- Projects table (stores complete screenplay data as JSONB)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255) DEFAULT '',
    data JSONB NOT NULL, -- Stores the complete Screenplay object
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_title ON projects(title);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- Writing goals table
CREATE TABLE IF NOT EXISTS writing_goals (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('pages', 'words', 'scenes', 'time')),
    target INTEGER NOT NULL,
    period VARCHAR(20) NOT NULL CHECK (period IN ('daily', 'weekly', 'session')),
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_writing_goals_project_id ON writing_goals(project_id);

-- Writing sessions table
CREATE TABLE IF NOT EXISTS writing_sessions (
    id VARCHAR(255) PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_pages INTEGER DEFAULT 0,
    start_words INTEGER DEFAULT 0,
    end_pages INTEGER DEFAULT 0,
    end_words INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 0, -- minutes
    goal_met BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_writing_sessions_project_id ON writing_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_writing_sessions_date ON writing_sessions(date DESC);
CREATE INDEX IF NOT EXISTS idx_writing_sessions_project_date ON writing_sessions(project_id, date DESC);

-- ============================================================
-- Semantic search (pgvector) - per-element embeddings
-- ============================================================
-- NOTE: This is used by ai-service for ask/edit retrieval.
-- Dims are fixed for the chosen embedding model (default: 1536).
CREATE TABLE IF NOT EXISTS project_element_embeddings (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    element_id TEXT NOT NULL,
    element_type TEXT NOT NULL,
    element_index INTEGER NOT NULL,
    embedding vector(1536) NOT NULL,
    embedding_model TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, element_id)
);

CREATE INDEX IF NOT EXISTS idx_project_element_embeddings_project_type
    ON project_element_embeddings(project_id, element_type);

CREATE INDEX IF NOT EXISTS idx_project_element_embeddings_project_index
    ON project_element_embeddings(project_id, element_index);

-- Approximate nearest neighbor index (cosine distance)
-- Requires pgvector >= 0.5.0 for HNSW; safe to run on supported versions.
CREATE INDEX IF NOT EXISTS idx_project_element_embeddings_hnsw_cosine
    ON project_element_embeddings USING hnsw (embedding vector_cosine_ops);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_writing_goals_updated_at BEFORE UPDATE ON writing_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

