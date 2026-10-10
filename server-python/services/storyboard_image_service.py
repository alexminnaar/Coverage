from __future__ import annotations

import asyncio
import base64
import os
import re
from dataclasses import dataclass
from typing import Optional
from uuid import uuid4

import boto3
from openai import AsyncOpenAI


@dataclass(frozen=True)
class GeneratedStoryboardImage:
    url: str
    provider_asset_id: str


class StoryboardImageService:
    def __init__(self) -> None:
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.image_model = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2").strip()
        self.r2_endpoint = os.getenv("R2_ENDPOINT_URL", "").strip().rstrip("/")
        self.r2_access_key_id = os.getenv("R2_ACCESS_KEY_ID", "").strip()
        self.r2_secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
        self.r2_bucket = os.getenv("R2_BUCKET_NAME", "").strip()
        self.r2_public_base_url = os.getenv("R2_PUBLIC_BASE_URL", "").strip().rstrip("/")
        self._openai: Optional[AsyncOpenAI] = None
        self._s3 = None

    def is_configured(self) -> bool:
        return all(
            (
                self.openai_api_key,
                self.image_model,
                self.r2_endpoint,
                self.r2_access_key_id,
                self.r2_secret_access_key,
                self.r2_bucket,
                self.r2_public_base_url,
            )
        )

    def missing_configuration(self) -> list[str]:
        values = {
            "OPENAI_API_KEY": self.openai_api_key,
            "OPENAI_IMAGE_MODEL": self.image_model,
            "R2_ENDPOINT_URL": self.r2_endpoint,
            "R2_ACCESS_KEY_ID": self.r2_access_key_id,
            "R2_SECRET_ACCESS_KEY": self.r2_secret_access_key,
            "R2_BUCKET_NAME": self.r2_bucket,
            "R2_PUBLIC_BASE_URL": self.r2_public_base_url,
        }
        return [name for name, value in values.items() if not value]

    def _openai_client(self) -> AsyncOpenAI:
        if self._openai is None:
            self._openai = AsyncOpenAI(api_key=self.openai_api_key)
        return self._openai

    def _s3_client(self):
        if self._s3 is None:
            self._s3 = boto3.client(
                service_name="s3",
                endpoint_url=self.r2_endpoint,
                aws_access_key_id=self.r2_access_key_id,
                aws_secret_access_key=self.r2_secret_access_key,
                region_name="auto",
            )
        return self._s3

    @staticmethod
    def _safe_segment(value: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
        return cleaned[:100] or "unknown"

    @staticmethod
    def _image_size(aspect_ratio: str) -> str:
        return {
            "2.39:1": "1536x640",
            "16:9": "1536x1024",
            "4:3": "1536x1024",
            "1:1": "1024x1024",
            "9:16": "1024x1536",
        }.get(aspect_ratio, "1536x1024")

    @staticmethod
    def _build_prompt(prompt: str, style: str, aspect_ratio: str) -> str:
        return (
            "Create a single film storyboard panel. "
            f"Visual style: {style or 'cinematic storyboard sketch'}. "
            f"Composition target: {aspect_ratio}. "
            "Maintain believable screen direction, staging, wardrobe, props, and lighting. "
            "Do not add captions, labels, borders, camera metadata, or readable text to the image. "
            f"Panel description: {prompt.strip()}"
        )

    async def generate(
        self,
        *,
        project_id: str,
        scene_id: str,
        shot_id: str,
        prompt: str,
        style: str,
        aspect_ratio: str,
        previous_provider_asset_id: Optional[str] = None,
    ) -> GeneratedStoryboardImage:
        if not self.is_configured():
            missing = ", ".join(self.missing_configuration())
            raise RuntimeError(f"Storyboard image generation is not configured. Missing: {missing}")

        response = await self._openai_client().images.generate(
            model=self.image_model,
            prompt=self._build_prompt(prompt, style, aspect_ratio),
            n=1,
            size=self._image_size(aspect_ratio),
        )
        if not response.data or not response.data[0].b64_json:
            raise RuntimeError("The image provider returned no image data.")

        try:
            image_bytes = base64.b64decode(response.data[0].b64_json, validate=True)
        except Exception as error:
            raise RuntimeError("The image provider returned invalid image data.") from error

        object_key = (
            "storyboards/"
            f"{self._safe_segment(project_id)}/"
            f"{self._safe_segment(scene_id)}/"
            f"{self._safe_segment(shot_id)}-{uuid4().hex}.png"
        )
        await asyncio.to_thread(
            self._s3_client().put_object,
            Bucket=self.r2_bucket,
            Key=object_key,
            Body=image_bytes,
            ContentType="image/png",
            CacheControl="public, max-age=31536000, immutable",
        )

        project_prefix = f"storyboards/{self._safe_segment(project_id)}/"
        if (
            previous_provider_asset_id
            and previous_provider_asset_id != object_key
            and previous_provider_asset_id.startswith(project_prefix)
        ):
            try:
                await asyncio.to_thread(
                    self._s3_client().delete_object,
                    Bucket=self.r2_bucket,
                    Key=previous_provider_asset_id,
                )
            except Exception:
                # The new image is already durable. An orphaned prior asset can be
                # cleaned up later without turning a successful generation into a failure.
                pass

        return GeneratedStoryboardImage(
            url=f"{self.r2_public_base_url}/{object_key}",
            provider_asset_id=object_key,
        )


storyboard_image_service = StoryboardImageService()
