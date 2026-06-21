from typing import Optional, List, Literal
from pydantic import BaseModel


class PrecedingElement(BaseModel):
    type: str
    content: str


class CompletionContext(BaseModel):
    elementType: str
    currentContent: str
    precedingElements: List[PrecedingElement]
    characterNames: List[str]
    cursorPosition: Optional[int] = None


class ChatMessage(BaseModel):
    role: Literal['user', 'assistant', 'system']
    content: str


class CommandRequest(BaseModel):
    command: str
    selectedText: str
    elementType: str
    context: List[PrecedingElement]


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    sceneContext: Optional[str] = None
    globalIndex: Optional[str] = None
    mode: Optional[Literal['ask', 'edit']] = 'ask'
    projectId: Optional[str] = None  # UUID of the screenplay project
    # Optional model override for chat agents (e.g., "gpt-4.1", "gpt-5", "gpt-5-mini").
    model: Optional[str] = None
    # Selection/context metadata to help the backend reason about scope.
    selectedElementId: Optional[str] = None
    selectedText: Optional[str] = None
    contextPolicy: Optional[Literal["scene_plus_adjacent", "full"]] = "scene_plus_adjacent"
    contextElementIds: Optional[List[str]] = None
    # Streaming typed events (status/final/etc). In edit mode, typed events are the default.
    # Set streamEvents=false to force legacy behavior (plain-text status + one final raw edits JSON).
    streamEvents: Optional[bool] = None


class HealthResponse(BaseModel):
    status: str
    configured: bool
    database_connected: Optional[bool] = None


class CommandResponse(BaseModel):
    result: str


class Beat(BaseModel):
    id: str
    title: str
    description: str
    actIndex: int
    order: int
    color: Optional[str] = None
    linkedSceneId: Optional[str] = None


class SceneSummary(BaseModel):
    id: str
    name: str


class BeatChatRequest(BaseModel):
    messages: List[ChatMessage]
    beats: List[Beat]
    actNames: List[str]
    selectedBeatId: Optional[str] = None
    scenes: Optional[List[SceneSummary]] = None
    projectId: Optional[str] = None
    model: Optional[str] = None

