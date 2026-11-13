from __future__ import annotations

from pathlib import Path

import pytest

from app import waste_resnet

from conftest import client_for, make_settings


@pytest.mark.asyncio
async def test_classify_returns_the_distribution_the_page_groups(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seen: list[str] = []

    def fake_classify(image: str):
        seen.append(image)
        return [
            {"className": "Plastic", "probability": 0.91},
            {"className": "Paper", "probability": 0.04},
        ]

    original = waste_resnet.classify
    waste_resnet.classify = fake_classify  # type: ignore[assignment]
    try:
        async with client_for(settings) as (client, _gateway, _app):
            response = await client.post(
                "/api/v1/waste/classify",
                json={"image": "data:image/jpeg;base64,/9j/4AAQSkZJRg=="},
            )
    finally:
        waste_resnet.classify = original  # type: ignore[assignment]

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "resnet50"
    assert body["predictions"][0]["className"] == "Plastic"
    assert body["predictions"][0]["probability"] == pytest.approx(0.91)
    assert seen and seen[0].startswith("data:image/jpeg")


@pytest.mark.asyncio
async def test_classify_reports_a_missing_model_as_503(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)

    def missing(_image: str):
        raise waste_resnet.WasteModelError(503, "MODEL_MISSING", "the model file is missing")

    original = waste_resnet.classify
    waste_resnet.classify = missing  # type: ignore[assignment]
    try:
        async with client_for(settings) as (client, _gateway, _app):
            response = await client.post(
                "/api/v1/waste/classify",
                json={"image": "data:image/jpeg;base64,/9j/4AAQSkZJRg=="},
            )
    finally:
        waste_resnet.classify = original  # type: ignore[assignment]

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "MODEL_MISSING"


@pytest.mark.asyncio
async def test_classify_refuses_an_unreadable_image(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)

    def bad(_image: str):
        raise waste_resnet.WasteModelError(422, "BAD_IMAGE", "the image could not be read")

    original = waste_resnet.classify
    waste_resnet.classify = bad  # type: ignore[assignment]
    try:
        async with client_for(settings) as (client, _gateway, _app):
            response = await client.post("/api/v1/waste/classify", json={"image": "x" * 40})
    finally:
        waste_resnet.classify = original  # type: ignore[assignment]

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "BAD_IMAGE"


@pytest.mark.asyncio
async def test_resnet_status_names_the_classes(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    async with client_for(settings) as (client, _gateway, _app):
        response = await client.get("/api/v1/waste/resnet-status")
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "resnet50"
    assert len(body["classes"]) == 11
