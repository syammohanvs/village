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


@pytest.mark.asyncio
async def test_a_correction_files_the_judged_crop_under_the_right_class(
    tmp_path: Path,
) -> None:
    """The venue's learning loop: one press, and that frame joins the training tree.

    The name comes from the classify response, so a correction can never land on
    "the most recent crop" -- which is a different picture once the camera has
    looked at anything else.
    """
    settings = make_settings(tmp_path)
    captures = settings.waste_capture_dir
    assert captures is not None
    captures.mkdir(parents=True, exist_ok=True)
    (captures / "20261116T101500-metal-0.65.jpg").write_bytes(b"\xff\xd8notreallyajpeg")

    async with client_for(settings) as (client, _gateway, _app):
        response = await client.post(
            "/api/v1/waste/correction",
            json={"file": "20261116T101500-metal-0.65.jpg", "actual": "plastic"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["actual"] == "Plastic"
    filed = Path(body["saved_as"])
    assert filed.parent.name == "Plastic"
    assert filed.is_file()
    assert filed.name.startswith("venue-")
    # The log beside the tree records what the model had said and what it is.
    log = (settings.waste_samples_dir.parent / "waste-corrections.jsonl").read_text()
    assert "20261116T101500-metal-0.65.jpg" in log and "Plastic" in log


@pytest.mark.asyncio
async def test_a_correction_refuses_an_unusable_target_or_name(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    captures = settings.waste_capture_dir
    assert captures is not None
    captures.mkdir(parents=True, exist_ok=True)

    async with client_for(settings) as (client, _gateway, _app):
        unknown = await client.post(
            "/api/v1/waste/correction",
            json={"file": "x.jpg", "actual": "glass"},
        )
        traversal = await client.post(
            "/api/v1/waste/correction",
            json={"file": "../secrets.jpg", "actual": "paper"},
        )
        missing = await client.post(
            "/api/v1/waste/correction",
            json={"file": "not-there.jpg", "actual": "paper"},
        )

    assert unknown.status_code == 422
    assert traversal.status_code == 422
    assert missing.status_code == 404
    # Nothing was written for a refused correction.
    assert not (settings.waste_samples_dir / "Paper").exists()


@pytest.mark.asyncio
async def test_classify_names_the_crop_it_kept(tmp_path: Path) -> None:
    """The page needs that name to point a correction at the right picture."""
    settings = make_settings(tmp_path)
    original = waste_resnet.classify
    waste_resnet.classify = lambda image: [{"className": "Metal", "probability": 0.6}]  # type: ignore[assignment]
    waste_resnet._last_capture = "20261116T101500-metal-0.60.jpg"  # type: ignore[attr-defined]
    try:
        async with client_for(settings) as (client, _gateway, _app):
            response = await client.post(
                "/api/v1/waste/classify",
                json={"image": "data:image/jpeg;base64,/9j/4AAQSkZJRg=="},
            )
    finally:
        waste_resnet.classify = original  # type: ignore[assignment]

    assert response.status_code == 200
    assert response.json()["file"] == "20261116T101500-metal-0.60.jpg"


def test_crops_are_not_kept_unless_an_operator_asks(tmp_path: Path) -> None:
    """Retention is a training decision, and it is off by default.

    A visitor's press must not silently write a picture of them to disk; the
    exhibit operator turns `VILLAGE_WASTE_SAVE_CROPS` on when the session is
    meant to produce training data.
    """
    from dataclasses import replace

    settings = replace(make_settings(tmp_path), waste_save_crops=False)
    original = waste_resnet._settings
    waste_resnet._settings = lambda: settings  # type: ignore[assignment]
    try:
        kept = waste_resnet._capture(  # type: ignore[attr-defined]
            b"\xff\xd8\xff\xd9",
            [{"className": "Plastic", "probability": 0.91}],
        )
    finally:
        waste_resnet._settings = original  # type: ignore[assignment]

    assert kept is None
    assert not settings.waste_capture_dir.exists()

    # ...and with the setting on, the same call does keep it.
    settings = replace(settings, waste_save_crops=True)
    waste_resnet._settings = lambda: settings  # type: ignore[assignment]
    try:
        kept = waste_resnet._capture(  # type: ignore[attr-defined]
            b"\xff\xd8\xff\xd9",
            [{"className": "Plastic", "probability": 0.91}],
        )
    finally:
        waste_resnet._settings = original  # type: ignore[assignment]

    assert kept is not None
    assert kept.is_file()
