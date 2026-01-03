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


# ----------------------------
# Ask loop structured outputs
# ----------------------------
class AskPlanTodo(TypedDict):
    id: str
    label: str


class AskPlanCoverage(TypedDict):
    must_include_scene_ids: List[str]
    must_include_element_ids: List[str]


class AskPlanResponse(TypedDict):
    todos: List[AskPlanTodo]
    intent: str
    next_action: str
    use_context: bool
    clarifying_questions: List[str]
    coverage: AskPlanCoverage
    query_variants: List[str]
    answer_outline: List[str]


class AskRerankEvidence(TypedDict):
    elementId: str
    why: str


class AskRerankResponse(TypedDict):
    selectedElementIds: List[str]
    evidence: List[AskRerankEvidence]


class AskGroundingResponse(TypedDict):
    grounded: bool
    missing: List[str]
    next_action: str


# ----------------------------
# Edit loop structured outputs
# ----------------------------
class PlanIntentTodo(TypedDict):
    id: str
    label: str


class PlanIntentResponse(TypedDict):
    intent: str
    next_action: str
    clarifying_questions: List[str]
    todos: List[PlanIntentTodo]


# Dependencies for chat agents
@dataclass
class ChatDeps:
    scene_context: str
    mode: str


# Graph dependencies for edit mode
@dataclass
class EditGraphDeps:
    scene_context: str
    message_history: List[ModelMessage]
    project_id: Optional[str] = None  # UUID of the screenplay project
    db_pool: Optional[object] = None  # PostgreSQL connection pool
    global_index: Optional[str] = None


