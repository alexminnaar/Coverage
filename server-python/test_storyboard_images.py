import asyncio
import base64
from types import SimpleNamespace

from services.storyboard_image_service import StoryboardImageService


class FakeImages:
    def __init__(self):
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            data=[SimpleNamespace(b64_json=base64.b64encode(b"png-data").decode("ascii"))]
        )


class FakeOpenAI:
    def __init__(self):
        self.images = FakeImages()


class FakeS3:
    def __init__(self):
        self.calls = []

    def put_object(self, **kwargs):
        self.calls.append(kwargs)


def configured_service():
    service = StoryboardImageService()
    service.openai_api_key = "test-key"
    service.image_model = "gpt-image-2"
    service.r2_endpoint = "https://account.r2.cloudflarestorage.com"
    service.r2_access_key_id = "access"
    service.r2_secret_access_key = "secret"
    service.r2_bucket = "storyboards"
    service.r2_public_base_url = "https://images.example.com"
    service._openai = FakeOpenAI()
    service._s3 = FakeS3()
    return service


def test_generation_uploads_png_and_returns_permanent_public_url():
    service = configured_service()

    generated = asyncio.run(service.generate(
        project_id="project-1",
        scene_id="scene-1",
        shot_id="shot-1",
        prompt="A figure waits beneath a dead streetlamp.",
        style="Restrained charcoal storyboard",
        aspect_ratio="16:9",
    ))

    assert generated.url.startswith(
        "https://images.example.com/storyboards/project-1/scene-1/shot-1-"
    )
    assert generated.url.endswith(".png")
    assert generated.provider_asset_id.startswith("storyboards/project-1/scene-1/")
    assert service._openai.images.calls[0]["model"] == "gpt-image-2"
    assert service._openai.images.calls[0]["size"] == "1536x1024"
    assert "dead streetlamp" in service._openai.images.calls[0]["prompt"]
    assert service._s3.calls[0]["Body"] == b"png-data"
    assert service._s3.calls[0]["ContentType"] == "image/png"


def test_missing_r2_configuration_is_reported_without_generating():
    service = StoryboardImageService()
    service.openai_api_key = "test-key"
    service.image_model = "gpt-image-2"
    service.r2_endpoint = ""
    service.r2_access_key_id = ""
    service.r2_secret_access_key = ""
    service.r2_bucket = ""
    service.r2_public_base_url = ""

    assert service.is_configured() is False
    assert "R2_ENDPOINT_URL" in service.missing_configuration()
