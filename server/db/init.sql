-- Screenwriter Database Schema

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

