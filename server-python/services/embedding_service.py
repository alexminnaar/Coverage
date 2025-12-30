from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import asyncpg
from openai import AsyncOpenAI

from services.db_service import DBService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbeddingConfig:
    model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    dims: int = int(os.getenv("EMBEDDING_DIMS", "1536"))
    batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "64"))
    top_k: int = int(os.getenv("EMBED_TOP_K", "12"))


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _to_pgvector_literal(vec: Sequence[float]) -> str:
    # pgvector parses: '[0.1,0.2,...]'
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


class EmbeddingService:
    """Compute and store per-element embeddings using pgvector."""

    def __init__(self, *, openai: AsyncOpenAI, db: DBService, config: Optional[EmbeddingConfig] = None):
        self._openai = openai
        self._db = db
        self._cfg = config or EmbeddingConfig()

    async def ensure_schema(self) -> None:
        """Best-effort schema creation (for existing DB volumes)."""
        await self._db.ensure_pool()
        if not self._db.pool:
            return
        async with self._db.pool.acquire() as conn:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS project_element_embeddings (
                    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    element_id TEXT NOT NULL,
                    element_type TEXT NOT NULL,
                    element_index INTEGER NOT NULL,
                    embedding vector(1536) NOT NULL,
                    embedding_model TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (project_id, element_id)
                );
                """
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_project_element_embeddings_project_type ON project_element_embeddings(project_id, element_type);"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_project_element_embeddings_project_index ON project_element_embeddings(project_id, element_index);"
            )
            # HNSW index is optional; supported on pgvector >= 0.5.0.
            try:
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_project_element_embeddings_hnsw_cosine ON project_element_embeddings USING hnsw (embedding vector_cosine_ops);"
                )
            except Exception:
                pass

    async def embed_texts(self, texts: Sequence[str]) -> List[List[float]]:
        """Compute embeddings for texts."""
        if not texts:
            return []
        resp = await self._openai.embeddings.create(model=self._cfg.model, input=list(texts))
        # The OpenAI SDK returns objects with .embedding
        return [list(d.embedding) for d in resp.data]

    async def _fetch_existing_hashes(
        self, project_id: str, element_ids: Sequence[str]
    ) -> Dict[str, str]:
        await self._db.ensure_pool()
        if not self._db.pool or not element_ids:
            return {}
        query = """
            SELECT element_id, content_hash
            FROM project_element_embeddings
            WHERE project_id = $1::uuid
              AND element_id = ANY($2::text[])
        """
        rows = await self._db.pool.fetch(query, project_id, list(element_ids))
        return {row["element_id"]: row["content_hash"] for row in rows}

    async def upsert_project_embeddings(
        self,
        project_id: str,
        *,
        element_types: Optional[List[str]] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, int]:
        """Embed and upsert project elements. Skips unchanged content via hashing."""
        t0 = time.time()
        await self.ensure_schema()

        elements = await self._db.fetch_project_elements_with_index(
            project_id, element_types=element_types, limit=limit
        )
        if not elements:
            return {"total": 0, "embedded": 0, "skipped": 0}

        # Prepare hashes
        ids = [str(e["element_id"]) for e in elements]
        existing_hashes = await self._fetch_existing_hashes(project_id, ids)

        to_embed: List[Dict[str, Any]] = []
        skipped = 0
        for e in elements:
            content = str(e.get("content") or "")
            h = _sha256(content)
            if existing_hashes.get(str(e["element_id"])) == h:
                skipped += 1
                continue
            to_embed.append({**e, "content_hash": h})

        embedded = 0
        await self._db.ensure_pool()
        if not self._db.pool:
            return {"total": len(elements), "embedded": 0, "skipped": skipped}

        # Embed in batches
        for i in range(0, len(to_embed), self._cfg.batch_size):
            batch = to_embed[i : i + self._cfg.batch_size]
            texts = [str(e["content"]) for e in batch]
            vecs = await self.embed_texts(texts)

            records: List[Tuple[Any, ...]] = []
            for e, v in zip(batch, vecs):
                records.append(
                    (
                        project_id,
                        str(e["element_id"]),
                        str(e["element_type"]),
                        int(e["element_index"]),
                        _to_pgvector_literal(v),
                        self._cfg.model,
                        str(e["content_hash"]),
                    )
                )

            upsert_sql = """
                INSERT INTO project_element_embeddings
                    (project_id, element_id, element_type, element_index, embedding, embedding_model, content_hash)
                VALUES ($1::uuid, $2::text, $3::text, $4::int, $5::vector, $6::text, $7::text)
                ON CONFLICT (project_id, element_id)
                DO UPDATE SET
                    element_type = EXCLUDED.element_type,
                    element_index = EXCLUDED.element_index,
                    embedding = EXCLUDED.embedding,
                    embedding_model = EXCLUDED.embedding_model,
                    content_hash = EXCLUDED.content_hash,
                    updated_at = CURRENT_TIMESTAMP
            """
            await self._db.pool.executemany(upsert_sql, records)
            embedded += len(records)

        dt_ms = int((time.time() - t0) * 1000)
        logger.info(
            f"[Embeddings] Upserted project_id={project_id[:8]}... total={len(elements)} embedded={embedded} skipped={skipped} model={self._cfg.model} ({dt_ms}ms)"
        )
        return {"total": len(elements), "embedded": embedded, "skipped": skipped}

    async def vector_search(
        self,
        project_id: str,
        query_text: str,
        *,
        top_k: Optional[int] = None,
        element_types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Return top-k similar elements for query_text."""
        await self.ensure_schema()
        await self._db.ensure_pool()
        if not self._db.pool:
            return []

        q_vec = (await self.embed_texts([query_text]))[0]
        k = int(top_k or self._cfg.top_k)
        params: List[Any] = [project_id, _to_pgvector_literal(q_vec), k]

        sql = """
            SELECT element_id, element_type, element_index,
                   (embedding <=> $2::vector) AS distance
            FROM project_element_embeddings
            WHERE project_id = $1::uuid
        """
        if element_types:
            sql += " AND element_type = ANY($4::text[])"
            params.append(element_types)
        sql += " ORDER BY embedding <=> $2::vector LIMIT $3"

        t0 = time.time()
        rows = await self._db.pool.fetch(sql, *params)
        dt_ms = int((time.time() - t0) * 1000)
        logger.info(
            f"[VecSearch] project_id={project_id[:8]}... top_k={k} types={element_types or 'any'} rows={len(rows)} ({dt_ms}ms)"
        )
        return [
            {
                "element_id": r["element_id"],
                "element_type": r["element_type"],
                "element_index": r["element_index"],
                "distance": float(r["distance"]),
            }
            for r in rows
        ]


