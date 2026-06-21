from __future__ import annotations

import os
import json
import logging
import time
from dataclasses import dataclass
from typing import Optional, List, Dict, Tuple

import asyncpg

from services.search_helpers import build_tsquery, make_snippet, normalize_search_terms

logger = logging.getLogger(__name__)


@dataclass
class SearchHit:
    element_id: str
    element_type: str
    element_index: int
    content: str
    rank: float
    snippet: str


@dataclass
class SceneSummary:
    element_id: str
    element_index: int
    heading: str
    scene_number: int


@dataclass
class CharacterSceneMatch:
    scene_id: str
    scene_number: int
    element_index: int
    heading: str
    match_count: int
    sample_matches: List[str]


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

    async def search_elements(
        self,
        project_id: str,
        *,
        terms: List[str],
        match_mode: str = "any",
        element_types: Optional[List[str]] = None,
        limit: int = 25,
    ) -> List[SearchHit]:
        """Full-text search over screenplay elements with ILIKE fallback."""
        await self.ensure_pool()
        if not self.pool:
            logger.info("[DB Search] No database pool available for element search")
            return []

        cleaned_terms = normalize_search_terms(terms)
        if not cleaned_terms:
            return []

        mode = "all" if match_mode == "all" else "any"
        limit = max(1, min(int(limit), 50))

        hits = await self._search_elements_fts(
            project_id,
            cleaned_terms,
            match_mode=mode,
            element_types=element_types,
            limit=limit,
        )
        if not hits:
            hits = await self._search_elements_ilike(
                project_id,
                cleaned_terms,
                match_mode=mode,
                element_types=element_types,
                limit=limit,
            )
        return hits

    async def _search_elements_fts(
        self,
        project_id: str,
        terms: List[str],
        *,
        match_mode: str,
        element_types: Optional[List[str]],
        limit: int,
    ) -> List[SearchHit]:
        tsquery = build_tsquery(terms, match_mode)
        if not tsquery:
            return []

        try:
            query = """
                WITH indexed_elements AS (
                    SELECT
                        elem->>'id' AS element_id,
                        elem->>'type' AS element_type,
                        (ordinality - 1)::int AS element_index,
                        COALESCE(elem->>'content', '') AS content
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') WITH ORDINALITY t(elem, ordinality)
                    WHERE p.id = $1::uuid
                ),
                filtered AS (
                    SELECT
                        element_id,
                        element_type,
                        element_index,
                        content,
                        to_tsvector('simple', content) AS tsv
                    FROM indexed_elements
                    WHERE ($3::text[] IS NULL OR element_type = ANY($3::text[]))
                )
                SELECT
                    element_id,
                    element_type,
                    element_index,
                    content,
                    ts_rank(filtered.tsv, query) AS rank
                FROM filtered,
                     to_tsquery('simple', $2) AS query
                WHERE filtered.tsv @@ query
                ORDER BY rank DESC, element_index ASC
                LIMIT $4
            """
            t0 = time.time()
            rows = await self.pool.fetch(query, project_id, tsquery, element_types, limit)
            dt_ms = int((time.time() - t0) * 1000)
            logger.info(
                f"[DB Search] FTS project_id={project_id[:8]}... terms={terms[:3]} "
                f"mode={match_mode} rows={len(rows)} ({dt_ms}ms)"
            )
            return [
                SearchHit(
                    element_id=str(row["element_id"]),
                    element_type=str(row["element_type"]),
                    element_index=int(row["element_index"]),
                    content=str(row["content"] or ""),
                    rank=float(row["rank"] or 0.0),
                    snippet=make_snippet(str(row["content"] or ""), terms),
                )
                for row in rows
            ]
        except Exception as e:
            logger.warning(f"[DB Search] FTS failed, will try ILIKE: {type(e).__name__}: {e}")
            return []

    async def _search_elements_ilike(
        self,
        project_id: str,
        terms: List[str],
        *,
        match_mode: str,
        element_types: Optional[List[str]],
        limit: int,
    ) -> List[SearchHit]:
        try:
            patterns = [f"%{term}%" for term in terms]
            content_clause = (
                "(elem->>'content') ILIKE ALL($2::text[])"
                if match_mode == "all"
                else "(elem->>'content') ILIKE ANY($2::text[])"
            )
            query = f"""
                WITH indexed_elements AS (
                    SELECT
                        elem,
                        (ordinality - 1)::int AS element_index
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') WITH ORDINALITY t(elem, ordinality)
                    WHERE p.id = $1::uuid
                )
                SELECT
                    elem->>'id' AS element_id,
                    elem->>'type' AS element_type,
                    element_index,
                    COALESCE(elem->>'content', '') AS content
                FROM indexed_elements
                WHERE {content_clause}
            """
            params: List[object] = [project_id, patterns]
            if element_types:
                query += " AND (elem->>'type') = ANY($3::text[])"
                params.append(element_types)
            query += " ORDER BY element_index ASC LIMIT $%d" % (len(params) + 1)
            params.append(limit)

            t0 = time.time()
            rows = await self.pool.fetch(query, *params)
            dt_ms = int((time.time() - t0) * 1000)
            logger.info(
                f"[DB Search] ILIKE project_id={project_id[:8]}... terms={terms[:3]} "
                f"mode={match_mode} rows={len(rows)} ({dt_ms}ms)"
            )
            return [
                SearchHit(
                    element_id=str(row["element_id"]),
                    element_type=str(row["element_type"]),
                    element_index=int(row["element_index"]),
                    content=str(row["content"] or ""),
                    rank=1.0,
                    snippet=make_snippet(str(row["content"] or ""), terms),
                )
                for row in rows
            ]
        except Exception as e:
            logger.error(f"[DB Search] ILIKE failed: {type(e).__name__}: {e}")
            return []

    async def list_scenes(
        self,
        project_id: str,
        *,
        search_terms: Optional[List[str]] = None,
        limit: int = 50,
    ) -> List[SceneSummary]:
        """List scene headings in script order, optionally filtered by search terms."""
        await self.ensure_pool()
        if not self.pool:
            return []

        limit = max(1, min(int(limit), 100))

        if search_terms:
            hits = await self.search_elements(
                project_id,
                terms=search_terms,
                match_mode="any",
                element_types=["scene-heading"],
                limit=limit,
            )
            all_scenes = await self.list_scenes(project_id, limit=500)
            num_by_id = {s.element_id: s.scene_number for s in all_scenes}
            return [
                SceneSummary(
                    element_id=h.element_id,
                    element_index=h.element_index,
                    heading=h.content.strip() or h.snippet,
                    scene_number=num_by_id.get(h.element_id, i + 1),
                )
                for i, h in enumerate(hits)
            ]

        try:
            query = """
                WITH indexed_elements AS (
                    SELECT
                        elem->>'id' AS element_id,
                        (ordinality - 1)::int AS element_index,
                        COALESCE(elem->>'content', '') AS content
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') WITH ORDINALITY t(elem, ordinality)
                    WHERE p.id = $1::uuid
                      AND elem->>'type' = 'scene-heading'
                )
                SELECT element_id, element_index, content
                FROM indexed_elements
                ORDER BY element_index ASC
                LIMIT $2
            """
            rows = await self.pool.fetch(query, project_id, limit)
            return [
                SceneSummary(
                    element_id=str(row["element_id"]),
                    element_index=int(row["element_index"]),
                    heading=str(row["content"] or "").strip() or "Untitled scene",
                    scene_number=i + 1,
                )
                for i, row in enumerate(rows)
            ]
        except Exception as e:
            logger.error(f"[DB Scenes] list_scenes failed: {type(e).__name__}: {e}")
            return []

    async def find_character_scenes(
        self,
        project_id: str,
        terms: List[str],
        *,
        limit: int = 100,
    ) -> List[CharacterSceneMatch]:
        """Find scenes where character name terms appear in character/action/dialogue lines."""
        cleaned = normalize_search_terms(terms)
        if not cleaned:
            return []

        hits = await self.search_elements(
            project_id,
            terms=cleaned,
            match_mode="any",
            element_types=["character", "dialogue", "action"],
            limit=max(1, min(int(limit), 150)),
        )
        if not hits:
            return []

        enriched = await self.fetch_elements_by_ids(project_id, [h.element_id for h in hits])
        hit_by_id = {h.element_id: h for h in hits}
        all_scenes = await self.list_scenes(project_id, limit=500)
        num_by_id = {s.element_id: s.scene_number for s in all_scenes}
        heading_by_id = {s.element_id: s.heading for s in all_scenes}

        scenes: Dict[str, CharacterSceneMatch] = {}
        for el in enriched:
            eid = str(el.get("element_id") or "")
            hit = hit_by_id.get(eid)
            if not hit:
                continue

            scene_id = str(el.get("scene_id") or "")
            heading = str(el.get("scene_heading") or "").strip()
            etype = str(el.get("element_type") or hit.element_type)
            if etype == "scene-heading":
                scene_id = scene_id or eid
                heading = heading or str(el.get("content") or "")

            if not scene_id:
                continue

            if scene_id not in scenes:
                scenes[scene_id] = CharacterSceneMatch(
                    scene_id=scene_id,
                    scene_number=num_by_id.get(scene_id, 0),
                    element_index=int(el.get("element_index") or hit.element_index),
                    heading=heading or heading_by_id.get(scene_id, "Unknown scene"),
                    match_count=0,
                    sample_matches=[],
                )

            match = scenes[scene_id]
            match.match_count += 1
            if len(match.sample_matches) < 3:
                label = f"[{etype}] {hit.snippet}"
                if label not in match.sample_matches:
                    match.sample_matches.append(label)

        return sorted(scenes.values(), key=lambda s: s.element_index)

    async def query_elements_by_search(
        self,
        project_id: str,
        search_terms: List[str],
        element_types: Optional[List[str]] = None,
    ) -> List[str]:
        """Find element IDs matching search terms (legacy wrapper)."""
        hits = await self.search_elements(
            project_id,
            terms=search_terms,
            match_mode="any",
            element_types=element_types,
            limit=50,
        )
        return [hit.element_id for hit in hits]

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


