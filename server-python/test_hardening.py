import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from models import ChatRequest
from services.db_service import DBService
from services.edit_types import (
    BeatDataInput,
    BeatOperationInput,
    ScreenplayDeps,
    ShotDraftInput,
    ShotUpdatesInput,
    StoryboardOperationInput,
)
from services.observability.langfuse_client import LangfuseClient
from services.screenplay_agent import (
    _dynamic_instructions,
    _manage_shots_impl,
    _validate_snapshot_edit_anchors,
)


class FakeLangfuse:
    def __init__(self):
        self.calls = []

    def trace(self, **kwargs):
        self.calls.append(("trace", kwargs))
        return SimpleNamespace(id="trace-1")

    def span(self, **kwargs):
        self.calls.append(("span", kwargs))

    def generation(self, **kwargs):
        self.calls.append(("generation", kwargs))

    def flush(self):
        self.calls.append(("flush", {}))


def test_agent_logging_omits_content_when_disabled():
    fake = FakeLangfuse()
    client = LangfuseClient.__new__(LangfuseClient)
    client._client = fake
    client.enabled = True
    client.log_content = False

    client.log_agent_run(
        input_prompt="private screenplay prompt",
        output_text="private screenplay response",
        run_items=[
            SimpleNamespace(
                type="tool_call_item",
                tool_name="search_screenplay",
                call_id="call-1",
                raw_item={"arguments": '{"query":"private screenplay content"}'},
            ),
            SimpleNamespace(
                type="tool_call_output_item",
                call_id="call-1",
                output="private tool output",
            ),
        ],
    )

    content_fields = [
        kwargs.get(field)
        for kind, kwargs in fake.calls
        if kind != "flush"
        for field in ("input", "output")
        if field in kwargs
    ]
    assert content_fields
    assert all(value is None for value in content_fields)


def test_element_verification_fails_closed_without_database():
    service = DBService()

    async def leave_pool_unavailable():
        service.pool = None

    service.ensure_pool = leave_pool_unavailable
    result = asyncio.run(service.verify_element_ids("project-id", ["element-1", "element-2"]))

    assert result == {"element-1": False, "element-2": False}


def test_chat_request_accepts_outline_mode():
    request = ChatRequest(
        messages=[{"role": "user", "content": "Help me outline this story."}],
        mode="outline",
    )

    assert request.mode == "outline"


def test_chat_request_accepts_storyboard_mode():
    request = ChatRequest(
        messages=[{"role": "user", "content": "Storyboard the opening scene."}],
        mode="storyboard",
    )

    assert request.mode == "storyboard"


def test_act_one_beat_operation_preserves_zero_index():
    operation = BeatOperationInput(
        op="create",
        actIndex=0,
        beat=BeatDataInput(title="Opening image"),
    )

    assert operation.model_dump(exclude_none=True)["actIndex"] == 0


def test_treatment_operation_preserves_complete_prose():
    operation = BeatOperationInput(
        op="set_treatment",
        treatment="A writer follows a signal through the city and learns who sent it.",
    )

    payload = operation.model_dump(exclude_none=True)
    assert payload["op"] == "set_treatment"
    assert payload["treatment"].startswith("A writer follows")


def test_edit_anchor_validation_rejects_mismatched_and_duplicate_ids():
    snapshot = "\n".join([
        "<screenplay_snapshot>",
        '<elements format="one JSON object per line">',
        '{"id":"first","type":"action","content":"The phone rings."}',
        '{"id":"second","type":"action","content":"He reaches for it."}',
        "</elements>",
        "</screenplay_snapshot>",
    ])
    edits = [
        {
            "elementId": "first",
            "originalContent": "He reaches for it.",
            "newContent": "He snatches it.",
        },
        {
            "elementId": "first",
            "originalContent": "The phone rings.",
            "newContent": "The phone SHRIEKS.",
        },
    ]

    issues = _validate_snapshot_edit_anchors(edits, snapshot)

    assert any("belongs to elementId second" in issue for issue in issues)
    assert any("duplicate elementId" in issue for issue in issues)


def test_ask_mode_instructions_explicitly_forbid_mutation_tools():
    wrapper = SimpleNamespace(context=ScreenplayDeps(scene_context="", mode="ask"))

    instructions = _dynamic_instructions(wrapper, SimpleNamespace())

    assert "strictly read-only" in instructions
    assert "NEVER call submit_edits, manage_beats, or manage_shots" in instructions
    assert "Never claim that changes were submitted" in instructions


def test_storyboard_mode_instructions_require_manage_shots():
    wrapper = SimpleNamespace(context=ScreenplayDeps(scene_context="", mode="storyboard"))

    instructions = _dynamic_instructions(wrapper, SimpleNamespace())

    assert "Active mode: Storyboard" in instructions
    assert "Use manage_shots" in instructions
    assert "Do not call submit_edits or manage_beats" in instructions


def test_manage_shots_rejects_non_storyboard_mode():
    deps = ScreenplayDeps(scene_context="", mode="ask")
    operation = StoryboardOperationInput(
        op="delete",
        sceneId="scene-1",
        id="shot-1",
    )

    result = asyncio.run(
        _manage_shots_impl(SimpleNamespace(context=deps), [operation])
    )

    assert result.startswith("MODE ERROR:")
    assert deps._shot_ops == []


def test_manage_shots_validates_variant_fields_without_staging():
    deps = ScreenplayDeps(scene_context="", mode="storyboard")
    operation = StoryboardOperationInput(
        op="delete",
        sceneId="scene-1",
        id="shot-1",
        targetOrder=2,
    )

    result = asyncio.run(
        _manage_shots_impl(SimpleNamespace(context=deps), [operation])
    )

    assert "Validation FAILED" in result
    assert "targetOrder" in result
    assert deps._shot_ops == []


def test_shot_draft_requires_characters_and_rejects_extra_fields():
    with pytest.raises(ValidationError):
        ShotDraftInput(
            title="Reveal",
            shotType="wide",
            action="The room comes into view.",
        )

    with pytest.raises(ValidationError):
        ShotDraftInput(
            title="Reveal",
            shotType="wide",
            action="The room comes into view.",
            characters=[],
            unsupportedField=True,
        )


def test_manage_shots_stages_and_serializes_valid_operations():
    deps = ScreenplayDeps(scene_context="", mode="storyboard")
    operations = [
        StoryboardOperationInput(
            op="replace",
            sceneId="scene-1",
            shots=[
                ShotDraftInput(
                    title="The warning",
                    shotType="close-up",
                    cameraAngle="eye-level",
                    action="Mara reads the message.",
                    characters=["Mara"],
                    dialogue="Run.",
                    imagePrompt="A tense close-up in cold blue light.",
                )
            ],
            style="neo-noir",
            aspectRatio="2.39:1",
            reason="Establish the visual language.",
        ),
        StoryboardOperationInput(
            op="update",
            sceneId="scene-1",
            id="shot-2",
            updates=ShotUpdatesInput(continuityNotes="Phone remains in Mara's right hand."),
        ),
        StoryboardOperationInput(
            op="move",
            sceneId="scene-1",
            id="shot-2",
            targetOrder=0,
        ),
    ]

    result = asyncio.run(
        _manage_shots_impl(SimpleNamespace(context=deps), operations)
    )

    assert result.startswith("Storyboard operations validated")
    assert deps._shot_ops[0]["shots"][0]["characters"] == ["Mara"]
    assert deps._shot_ops[0]["aspectRatio"] == "2.39:1"
    assert deps._shot_ops[1]["updates"]["continuityNotes"].startswith("Phone")
    assert deps._shot_ops[2]["targetOrder"] == 0
