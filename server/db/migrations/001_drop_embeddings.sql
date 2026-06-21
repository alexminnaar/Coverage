-- Drop legacy pgvector embedding table (agentic full-text search replaced vector retrieval).
-- Safe to run on databases that never had embeddings.
DROP TABLE IF EXISTS project_element_embeddings;
