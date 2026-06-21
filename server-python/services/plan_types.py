from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class TodoStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    done = "done"
    blocked = "blocked"
    cancelled = "cancelled"


class TodoItem(BaseModel):
    id: str
    title: str
    status: TodoStatus = TodoStatus.pending
    rationale: Optional[str] = None
    related_files: List[str] = Field(default_factory=list)


class PlanState(BaseModel):
    summary: str = ""
    todos: List[TodoItem] = Field(default_factory=list)
    known_facts: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
