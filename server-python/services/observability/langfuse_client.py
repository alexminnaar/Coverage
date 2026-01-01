from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

try:
    from langfuse import Langfuse
except Exception:  # pragma: no cover
    Langfuse = None  # type: ignore


def _env_flag(name: str, default: bool = True) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() not in {"0", "false", "no", "off"}


@dataclass
class LangfuseCtx:
    trace_id: str


class LangfuseClient:
    """Thin wrapper around the Langfuse Python SDK with content gating."""

    def __init__(self) -> None:
        self.enabled = _env_flag("LANGFUSE_ENABLED", True)
        self.log_content = _env_flag("LANGFUSE_LOG_CONTENT", False)

        if not self.enabled or Langfuse is None:
            self._client = None
            return

        public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
        secret_key = os.getenv("LANGFUSE_SECRET_KEY")
        host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

        # Langfuse SDK will disable itself if keys are missing; we still construct safely.
        if public_key and secret_key:
            self._client = Langfuse(public_key=public_key, secret_key=secret_key, host=host)
        else:
            self._client = Langfuse()

    def start_trace(
        self,
        *,
        name: str,
        metadata: Optional[Dict[str, Any]] = None,
        input: Optional[Any] = None,
        tags: Optional[list[str]] = None,
    ) -> Optional[LangfuseCtx]:
        if not self._client:
            return None
        trace = self._client.trace(
            name=name,
            metadata=metadata or None,
            input=input if self.log_content else None,
            tags=tags or None,
            timestamp=time.time(),
        )
        trace_id = getattr(trace, "id", None) or getattr(trace, "trace_id", None)
        if not trace_id:
            # Best-effort: Langfuse SDK still accepts span(trace_id=...) only if we have it.
            return None
        return LangfuseCtx(trace_id=str(trace_id))

    def end_trace(self, ctx: Optional[LangfuseCtx], *, output: Optional[Any] = None) -> None:
        if not self._client or not ctx:
            return
        # Langfuse doesn't require explicit trace end; we attach output by updating the trace.
        try:
            self._client.trace(id=ctx.trace_id, output=output if self.log_content else None)
        except Exception:
            pass

    def span(
        self,
        ctx: Optional[LangfuseCtx],
        *,
        name: str,
        metadata: Optional[Dict[str, Any]] = None,
        input: Optional[Any] = None,
        output: Optional[Any] = None,
        level: Optional[str] = None,
        status_message: Optional[str] = None,
        parent_observation_id: Optional[str] = None,
    ) -> Optional[str]:
        """Create a span. Returns span id if available."""
        if not self._client or not ctx:
            return None
        span = self._client.span(
            trace_id=ctx.trace_id,
            parent_observation_id=parent_observation_id,
            name=name,
            metadata=metadata or None,
            input=input if self.log_content else None,
            output=output if self.log_content else None,
            level=level,
            status_message=status_message,
        )
        span_id = getattr(span, "id", None) or getattr(span, "span_id", None)
        return str(span_id) if span_id else None

    def flush(self) -> None:
        if not self._client:
            return
        try:
            self._client.flush()
        except Exception:
            pass


langfuse_client = LangfuseClient()


