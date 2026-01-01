from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pydantic_ai.messages import ModelMessage
from typing_extensions import NotRequired, TypedDict


# Structured output for edit mode
class NewElement(TypedDict):
    type: str
    content: str


class EditProposal(TypedDict):
    elementId: str
    elementType: str
    originalContent: str
    newContent: str
    reason: NotRequired[str]
    newElements: NotRequired[List[NewElement]]


class EditResponse(TypedDict):
    edits: List[EditProposal]


# Dependencies for chat agents
@dataclass
class ChatDeps:
    scene_context: str
    mode: str


# Graph state for edit mode
@dataclass
class EditGraphState:
    user_prompt: str
    scene_context: str
    message_history: List[ModelMessage] = field(default_factory=list)
    intent: Optional[str] = None
    relevant_scene_ids: List[str] = field(default_factory=list)
    loaded_context: Optional[str] = None
    understanding: Optional[str] = None
    proposed_edits: Optional[EditResponse] = None
    applied_edits: Optional[EditResponse] = None
    verification_result: Optional[str] = None
    final_summary: Optional[str] = None
    # stream_buffer items are "typed events" with the minimal schema:
    # {"type": "status", "message": "<human readable status>"}
    #
    # These are rendered for clients in two ways:
    # - streamEvents=True: each item is streamed as JSON (one object per SSE message)
    # - streamEvents=False/None: status messages are streamed as plain text lines
    stream_buffer: List[Dict[str, Any]] = field(default_factory=list)


# Graph dependencies for edit mode
@dataclass
class EditGraphDeps:
    scene_context: str
    message_history: List[ModelMessage]
    project_id: Optional[str] = None  # UUID of the screenplay project
    db_pool: Optional[object] = None  # PostgreSQL connection pool
    global_index: Optional[str] = None


