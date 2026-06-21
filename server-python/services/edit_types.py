from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from services.plan_types import PlanState


class NewElementInput(BaseModel):
    type: str
    content: str


class EditProposalInput(BaseModel):
    elementId: str
    elementType: str
    originalContent: str
    newContent: str
    reason: Optional[str] = None
    newElements: Optional[List[NewElementInput]] = None


class BeatDataInput(BaseModel):
    title: str
    description: Optional[str] = None
    color: Optional[str] = None
    linkedSceneId: Optional[str] = None


class BeatUpdatesInput(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    linkedSceneId: Optional[str] = None


class BeatOperationInput(BaseModel):
    op: str
    id: Optional[str] = None
    actIndex: Optional[int] = None
    insertAfterOrder: Optional[int] = None
    beat: Optional[BeatDataInput] = None
    updates: Optional[BeatUpdatesInput] = None
    targetActIndex: Optional[int] = None
    targetOrder: Optional[int] = None
    reason: Optional[str] = None


@dataclass
class ScreenplayDeps:
    scene_context: str
    project_id: Optional[str] = None
    db_pool: Optional[object] = None
    global_index: Optional[str] = None
    selected_element_id: Optional[str] = None
    selected_text: Optional[str] = None
    beat_context: Optional[str] = None
    _plan: Optional[PlanState] = None
    _submitted_edits: List[Dict[str, Any]] = field(default_factory=list)
    _beat_ops: List[Dict[str, Any]] = field(default_factory=list)
