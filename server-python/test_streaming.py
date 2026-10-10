import json

from services.streaming import format_buffer_item, format_final_payload


def test_typed_events_are_serialized_without_legacy_duplication():
    event = {
        "type": "tool_call",
        "tool": "search_screenplay",
        "tool_call_id": "call-1",
    }

    assert json.loads(format_buffer_item(event, stream_events=True)) == event


def test_ready_outline_operations_are_serialized_as_typed_events():
    event = {
        "type": "outline_ops_ready",
        "beatOps": {
            "ops": [
                {
                    "op": "set_treatment",
                    "treatment": "A complete treatment.",
                }
            ]
        },
    }

    assert json.loads(format_buffer_item(event, stream_events=True)) == event


def test_ready_storyboard_operations_are_serialized_as_typed_events():
    event = {
        "type": "storyboard_ops_ready",
        "storyboardOps": {
            "ops": [
                {
                    "op": "create",
                    "sceneId": "scene-1",
                    "shot": {
                        "title": "Reveal",
                        "shotType": "wide",
                        "action": "The empty room comes into view.",
                        "characters": [],
                    },
                }
            ]
        },
    }

    assert json.loads(format_buffer_item(event, stream_events=True)) == event


def test_storyboard_operations_are_included_in_typed_final_payload():
    operations = [
        {
            "op": "move",
            "sceneId": "scene-1",
            "id": "shot-1",
            "targetOrder": 0,
        }
    ]

    rendered = json.loads(
        format_final_payload(True, shot_ops=operations)
    )

    assert rendered == {
        "type": "final",
        "storyboardOps": {"ops": operations},
    }


def test_legacy_tool_call_uses_human_readable_status():
    rendered = format_buffer_item(
        {"type": "tool_call", "tool": "search_screenplay"},
        stream_events=False,
    )

    assert rendered == "[Searching] Querying screenplay\n"


def test_legacy_tool_result_uses_human_readable_status():
    rendered = format_buffer_item(
        {"type": "tool_result", "tool": "search_screenplay"},
        stream_events=False,
    )

    assert rendered == "[Searching] Done\n"


def test_plan_updated_is_sufficient_for_legacy_plan_display():
    rendered = format_buffer_item(
        {
            "type": "plan_updated",
            "plan": {
                "summary": "Revise the scene",
                "todos": [
                    {"id": "one", "title": "Find the scene", "status": "done"},
                    {"id": "two", "title": "Rewrite dialogue", "status": "in_progress"},
                ],
            },
        },
        stream_events=False,
    )

    assert rendered == "[Plan] Find the scene (done) → Rewrite dialogue (in_progress)\n"
