from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

try:
    from langfuse import Langfuse
except Exception:  # pragma: no cover
    Langfuse = None  # type: ignore

logger = logging.getLogger(__name__)


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

    def log_agent_run(
        self,
        *,
        name: str = "screenplay-agent",
        input_prompt: str,
        output_text: str,
        run_items: List[Any],
        metadata: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
    ) -> None:
        """Log a complete OpenAI Agents SDK run to Langfuse.

        Parses ``RunResult.new_items`` and creates:
        - A root **trace** (input=prompt, output=answer).
        - A child **generation** for each assistant message output item.
        - A child **span** for each tool call and tool output item.
        """
        if not self._client:
            return

        try:
            trace = self._client.trace(
                name=name,
                input=input_prompt,
                output=output_text,
                metadata=metadata,
                tags=tags,
            )
            trace_id = getattr(trace, "id", None) or getattr(trace, "trace_id", None)
            if not trace_id:
                return

            pending_tool_calls: Dict[str, Dict[str, Any]] = {}
            step = 0

            for item in run_items:
                item_type = getattr(item, "type", "")

                if item_type == "tool_call_item":
                    step += 1
                    tool_name = getattr(item, "tool_name", None) or "unknown"
                    tool_call_id = getattr(item, "call_id", None) or ""
                    raw = getattr(item, "raw_item", None)
                    args: Any = None
                    if raw is not None:
                        if isinstance(raw, dict):
                            args = raw.get("arguments")
                        else:
                            args = getattr(raw, "arguments", None)
                    pending_tool_calls[str(tool_call_id)] = {
                        "tool_name": tool_name,
                        "args": args,
                        "step": step,
                    }
                    self._client.span(
                        trace_id=trace_id,
                        name=f"tool:{tool_name}",
                        input=self._safe_serialize(args),
                        metadata={"step": step, "tool_call_id": tool_call_id},
                    )

                elif item_type == "tool_call_output_item":
                    tool_call_id = str(getattr(item, "call_id", None) or "")
                    output = getattr(item, "output", None)
                    call_info = pending_tool_calls.pop(tool_call_id, {})
                    tool_name = call_info.get("tool_name", "unknown")
                    step_num = call_info.get("step", step)
                    self._client.span(
                        trace_id=trace_id,
                        name=f"tool-result:{tool_name}",
                        output=self._safe_serialize(output, max_len=4000),
                        metadata={"step": step_num, "tool_call_id": tool_call_id},
                    )

                elif item_type == "message_output_item":
                    step += 1
                    try:
                        from agents import ItemHelpers

                        content = ItemHelpers.text_message_output(item)
                    except Exception:
                        content = str(getattr(item, "raw_item", ""))
                    self._client.generation(
                        trace_id=trace_id,
                        name="model-response",
                        output=content[:4000] if content else None,
                        metadata={"step": step},
                    )

            self._client.flush()

        except Exception as e:
            logger.warning(f"[Langfuse] log_agent_run failed: {e}")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_serialize(obj: Any, max_len: int = 8000) -> Any:
        """Best-effort JSON-safe serialization, truncated to *max_len*."""
        if obj is None:
            return None
        if isinstance(obj, str):
            return obj[:max_len]
        try:
            text = json.dumps(obj, default=str)
            return text[:max_len]
        except Exception:
            text = str(obj)
            return text[:max_len]

    def flush(self) -> None:
        if not self._client:
            return
        try:
            self._client.flush()
        except Exception:
            pass


langfuse_client = LangfuseClient()


