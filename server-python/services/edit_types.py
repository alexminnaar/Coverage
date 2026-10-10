from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

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
    treatment: Optional[str] = Field(
        default=None,
        description="Complete replacement treatment text for a set_treatment operation.",
    )
    actIndex: Optional[int] = Field(
        default=None,
        description="Zero-based destination act index for create: Act 1 is 0, Act 2 is 1.",
    )
    insertAfterOrder: Optional[int] = Field(
        default=None,
        description="Zero-based beat order after which to insert.",
    )
    beat: Optional[BeatDataInput] = None
    updates: Optional[BeatUpdatesInput] = None
    targetActIndex: Optional[int] = Field(
        default=None,
        description="Zero-based destination act index for move: Act 1 is 0, Act 2 is 1.",
    )
    targetOrder: Optional[int] = Field(
        default=None,
        description="Zero-based destination order within the act.",
    )
    reason: Optional[str] = None


class ShotDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1)
    shotType: str = Field(min_length=1)
    cameraAngle: Optional[str] = None
    action: str = Field(min_length=1)
    characters: List[str]
    dialogue: Optional[str] = None
    continuityNotes: Optional[str] = None
    imagePrompt: Optional[str] = None


class ShotUpdatesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = Field(default=None, min_length=1)
    shotType: Optional[str] = Field(default=None, min_length=1)
    cameraAngle: Optional[str] = None
    action: Optional[str] = Field(default=None, min_length=1)
    characters: Optional[List[str]] = None
    dialogue: Optional[str] = None
    continuityNotes: Optional[str] = None
    imagePrompt: Optional[str] = None


class StoryboardOperationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["replace", "create", "update", "delete", "move"]
    sceneId: str = Field(min_length=1)
    shots: Optional[List[ShotDraftInput]] = None
    style: Optional[str] = None
    aspectRatio: Optional[Literal["2.39:1", "16:9", "4:3", "1:1", "9:16"]] = None
    insertAfterOrder: Optional[int] = None
    shot: Optional[ShotDraftInput] = None
    id: Optional[str] = None
    updates: Optional[ShotUpdatesInput] = None
    targetOrder: Optional[int] = None
    reason: Optional[str] = None


@dataclass
class ScreenplayDeps:
    scene_context: str
    mode: str = "ask"
    project_id: Optional[str] = None
    db_pool: Optional[object] = None
    global_index: Optional[str] = None
    selected_element_id: Optional[str] = None
    selected_text: Optional[str] = None
    beat_context: Optional[str] = None
    _plan: Optional[PlanState] = None
    _submitted_edits: List[Dict[str, Any]] = field(default_factory=list)
    _beat_ops: List[Dict[str, Any]] = field(default_factory=list)
    _shot_ops: List[Dict[str, Any]] = field(default_factory=list)
