from __future__ import annotations

import os
import json
import logging
from dataclasses import dataclass
from typing import Optional, List, Dict, Tuple

import asyncpg

logger = logging.getLogger(__name__)


@dataclass
class DBConfig:
    """Database configuration used to initialize the asyncpg pool."""

    database_url: Optional[str] = None
    min_size: int = 1
    max_size: int = 5
    command_timeout: int = 60

    @staticmethod
    def from_env() -> "DBConfig":
        return DBConfig(database_url=os.getenv("DATABASE_URL"))

    def resolve_url(self) -> str:
        if self.database_url:
            return self.database_url
        # Build from individual env vars (Docker-friendly)
        db_host = os.getenv("DB_HOST", "localhost")
        db_port = int(os.getenv("DB_PORT", "5432"))
        db_name = os.getenv("DB_NAME", "screenwriter")
        db_user = os.getenv("DB_USER", "screenwriter")
        db_password = os.getenv("DB_PASSWORD", "screenwriter")
        return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


class DBService:
    """Thin wrapper around asyncpg for screenplay element queries."""

    def __init__(self, config: Optional[DBConfig] = None):
        self.config = config or DBConfig.from_env()
        self.pool: Optional[asyncpg.Pool] = None

    async def ensure_pool(self) -> None:
        if self.pool is not None:
            return
        try:
            db_url = self.config.resolve_url()
            self.pool = await asyncpg.create_pool(
                db_url,
                min_size=self.config.min_size,
                max_size=self.config.max_size,
                command_timeout=self.config.command_timeout,
            )
            logger.info("✅ Database connection pool created")
        except Exception as e:
            logger.warning(f"⚠️  Database connection failed: {e}. Graph will use fallback mode.")
            self.pool = None

    async def query_elements_by_search(
        self,
        project_id: str,
        search_terms: List[str],
        element_types: Optional[List[str]] = None,
    ) -> List[str]:
        """Find element IDs matching search terms (ILIKE)."""
        await self.ensure_pool()
        if not self.pool:
            logger.info("[DB Query] No database pool available for element search")
            return []

        try:
            search_patterns = [f"%{term}%" for term in search_terms]
            query = """
                WITH elements AS (
                    SELECT elem
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') elem
                    WHERE p.id = $1::uuid
                )
                SELECT DISTINCT elem->>'id' AS id
                FROM elements
                WHERE (elem->>'content') ILIKE ANY($2::text[])
            """
            params = [project_id, search_patterns]
            if element_types:
                query += " AND (elem->>'type') = ANY($3::text[])"
                params.append(element_types)

            logger.info(
                f"[DB Query] Searching for elements: project_id={project_id[:8]}..., "
                f"search_terms={search_terms[:3]}, element_types={element_types}"
            )
            rows = await self.pool.fetch(query, *params)
            element_ids = [row["id"] for row in rows]
            logger.info(f"[DB Query] ✅ Found {len(element_ids)} matching elements")
            return element_ids
        except Exception as e:
            logger.error(f"[DB Query] ❌ Error querying elements: {type(e).__name__}: {e}")
            return []

    async def extract_element_context(
        self,
        project_id: str,
        element_ids: List[str],
        context_size: int = 3,
    ) -> Tuple[str, Optional[str]]:
        """Extract elements with surrounding context from PostgreSQL.

        Returns: (context_string, error_message)
        """
        await self.ensure_pool()
        if not self.pool:
            return "", "No database pool available"
        if not element_ids:
            return "", "No element IDs provided"

        try:
            query = """
                WITH indexed_elements AS (
                    SELECT 
                        elem,
                        elem->>'id' AS id,
                        ordinality - 1 AS idx
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') WITH ORDINALITY t(elem, ordinality)
                    WHERE p.id = $1::uuid
                ),
                target_indices AS (
                    SELECT idx FROM indexed_elements
                    WHERE id = ANY($2::text[])
                ),
                context_range AS (
                    SELECT 
                        GREATEST(0, MIN(idx) - $3) AS start_idx,
                        MAX(idx) + $3 AS end_idx
                    FROM target_indices
                )
                SELECT
                    elem,
                    idx,
                    (
                        SELECT sh.elem->>'id'
                        FROM indexed_elements sh
                        WHERE (sh.elem->>'type') = 'scene-heading'
                          AND sh.idx <= indexed_elements.idx
                        ORDER BY sh.idx DESC
                        LIMIT 1
                    ) AS scene_id,
                    (
                        SELECT sh.elem->>'content'
                        FROM indexed_elements sh
                        WHERE (sh.elem->>'type') = 'scene-heading'
                          AND sh.idx <= indexed_elements.idx
                        ORDER BY sh.idx DESC
                        LIMIT 1
                    ) AS scene_heading
                FROM indexed_elements, context_range
                WHERE idx BETWEEN start_idx AND end_idx
                ORDER BY idx
            """

            logger.info(
                f"[DB Context] Extracting context: project_id={project_id[:8]}..., "
                f"element_ids={len(element_ids)}, context_size={context_size}"
            )
            rows = await self.pool.fetch(query, project_id, element_ids, context_size)
            logger.info(f"[DB Context] ✅ Query returned {len(rows)} rows")

            if len(rows) == 0:
                return "", "Query returned 0 rows (element IDs may not exist in database)"

            formatted = []
            for row in rows:
                elem = row["elem"]
                if isinstance(elem, str):
                    elem = json.loads(elem)
                elif not isinstance(elem, dict):
                    elem = dict(elem) if elem else {}

                elem_id = elem.get("id", "")
                elem_type = elem.get("type", "")
                elem_content = elem.get("content", "")
                elem_index = row.get("idx")
                scene_id = row.get("scene_id") or ""
                scene_heading = row.get("scene_heading") or ""
                formatted.append(
                    "Element:\n"
                    f"- id: {elem_id}\n"
                    f"- type: {elem_type}\n"
                    f"- elementIndex: {elem_index}\n"
                    + (f"- sceneId: {scene_id}\n" if scene_id else "")
                    + (f"- sceneHeading: {scene_heading}\n" if scene_heading else "")
                    + f"- content: {elem_content}"
                )

            context_str = "\n\n".join(formatted)
            logger.info(
                f"[DB Context] ✅ Formatted {len(formatted)} elements into context string ({len(context_str)} chars)"
            )
            return context_str, None
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            logger.error(f"[DB Context] ❌ Error extracting context: {error_msg}")
            return "", error_msg

    async def verify_element_ids(self, project_id: str, element_ids: List[str]) -> Dict[str, bool]:
        """Verify that element IDs exist in the screenplay."""
        await self.ensure_pool()
        if not self.pool:
            logger.info("[DB Verify] No database pool available, assuming all IDs valid")
            return {eid: True for eid in element_ids}

        try:
            query = """
                WITH elements AS (
                    SELECT elem
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') elem
                    WHERE p.id = $1::uuid
                )
                SELECT DISTINCT elem->>'id' AS id
                FROM elements
                WHERE (elem->>'id') = ANY($2::text[])
            """
            logger.info(
                f"[DB Verify] Verifying {len(element_ids)} element IDs: project_id={project_id[:8]}..."
            )
            rows = await self.pool.fetch(query, project_id, element_ids)
            existing_ids = {row["id"] for row in rows}
            verified = {eid: eid in existing_ids for eid in element_ids}
            valid_count = sum(1 for v in verified.values() if v)
            invalid_count = len(element_ids) - valid_count
            logger.info(f"[DB Verify] ✅ Verified: {valid_count} valid, {invalid_count} invalid")
            return verified
        except Exception as e:
            logger.error(f"[DB Verify] ❌ Error verifying element IDs: {type(e).__name__}: {e}")
            return {eid: True for eid in element_ids}

    async def fetch_project_elements_with_index(
        self,
        project_id: str,
        *,
        element_types: Optional[List[str]] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, object]]:
        """Fetch screenplay elements from the `projects` JSONB with stable ordering.

        Returns a list of dicts:
        - element_id (str)
        - element_type (str)
        - element_index (int) 0-based
        - content (str)
        """
        await self.ensure_pool()
        if not self.pool:
            return []

        try:
            query = """
                WITH indexed_elements AS (
                    SELECT
                        elem->>'id' AS element_id,
                        elem->>'type' AS element_type,
                        (ordinality - 1)::int AS element_index,
                        elem->>'content' AS content
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') WITH ORDINALITY t(elem, ordinality)
                    WHERE p.id = $1::uuid
                )
                SELECT element_id, element_type, element_index, content
                FROM indexed_elements
            """
            params: list[object] = [project_id]

            if element_types:
                query += " WHERE element_type = ANY($2::text[])"
                params.append(element_types)

            query += " ORDER BY element_index"
            if limit is not None:
                query += " LIMIT $%d" % (len(params) + 1)
                params.append(int(limit))

            rows = await self.pool.fetch(query, *params)
            return [
                {
                    "element_id": row["element_id"],
                    "element_type": row["element_type"],
                    "element_index": row["element_index"],
                    "content": row["content"] or "",
                }
                for row in rows
            ]
        except Exception as e:
            logger.error(f"[DB Elements] ❌ Error fetching project elements: {type(e).__name__}: {e}")
            return []

    async def fetch_elements_by_ids(
        self,
        project_id: str,
        element_ids: List[str],
    ) -> List[Dict[str, object]]:
        """Fetch specific screenplay elements by ID.

        Returns list of dicts:
        - element_id (str)
        - element_type (str)
        - element_index (int)
        - content (str)
        """
        await self.ensure_pool()
        if not self.pool:
            return []
        if not element_ids:
            return []

        try:
            query = """
                WITH indexed_elements AS (
                    SELECT 
                        elem->>'id' AS element_id,
                        elem->>'type' AS element_type,
                        (ordinality - 1)::int AS element_index,
                        elem->>'content' AS content
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') WITH ORDINALITY t(elem, ordinality)
                    WHERE p.id = $1::uuid
                )
                SELECT
                    element_id,
                    element_type,
                    element_index,
                    content,
                    (
                        SELECT sh.element_id
                        FROM indexed_elements sh
                        WHERE sh.element_type = 'scene-heading'
                          AND sh.element_index <= indexed_elements.element_index
                        ORDER BY sh.element_index DESC
                        LIMIT 1
                    ) AS scene_id,
                    (
                        SELECT sh.content
                        FROM indexed_elements sh
                        WHERE sh.element_type = 'scene-heading'
                          AND sh.element_index <= indexed_elements.element_index
                        ORDER BY sh.element_index DESC
                        LIMIT 1
                    ) AS scene_heading
                FROM indexed_elements
                WHERE element_id = ANY($2::text[])
            """
            rows = await self.pool.fetch(query, project_id, element_ids)
            # Preserve input order
            by_id: Dict[str, Dict[str, object]] = {
                str(r["element_id"]): {
                    "element_id": r["element_id"],
                    "element_type": r["element_type"],
                    "element_index": r["element_index"],
                    "content": r["content"] or "",
                    "scene_id": r.get("scene_id"),
                    "scene_heading": r.get("scene_heading"),
                }
                for r in rows
            }
            return [by_id[eid] for eid in element_ids if eid in by_id]
        except Exception as e:
            logger.error(f"[DB Elements] ❌ Error fetching elements by ids: {type(e).__name__}: {e}")
            return []


