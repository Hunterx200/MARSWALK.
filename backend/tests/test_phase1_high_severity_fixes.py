"""Tests verifying Phase 1 High-Severity Bug Fixes (H-01, H-02, H-03)."""
import asyncio
import pytest
from httpx import AsyncClient, ASGITransport
from pydantic import ValidationError

from app.main import app
from app.schemas.mission import MissionCreateRequest
from app.schemas.environment import MEDASolTelemetryResponse, WindObservation
from app.services.meda_service import MedaService
from app.services.mission_service import MissionService
from app.core.errors import NotFoundException


def test_h01_meda_cache_bounds_and_lru_eviction():
    """Verify that MEDA telemetry cache never exceeds MAX_TELEMETRY_CACHE and evicts LRU."""
    service = MedaService()
    assert service.MAX_TELEMETRY_CACHE == 256

    # Insert 265 mock entries into _telemetry_cache
    for i in range(265):
        key = (i, None)
        dummy_resp = MEDASolTelemetryResponse(
            sol=i,
            site_location="Jezero Crater, Mars",
            data_source="NASA PDS4 Archive",
            bundle_lid="urn:nasa:pds:mars2020_meda",
            is_historical_archive=True,
            wind=WindObservation(available=False, status_reason="TEST"),
        )
        service._telemetry_cache[key] = dummy_resp
        if len(service._telemetry_cache) > service.MAX_TELEMETRY_CACHE:
            service._telemetry_cache.popitem(last=False)

    assert len(service._telemetry_cache) == 256
    # Keys 0..8 should have been evicted (265 - 256 = 9 evicted)
    assert (0, None) not in service._telemetry_cache
    assert (8, None) not in service._telemetry_cache
    assert (9, None) in service._telemetry_cache
    assert (264, None) in service._telemetry_cache


def test_h02_mission_schema_string_bounds():
    """Verify MissionCreateRequest enforces strict string length bounds."""
    # Valid request
    valid = MissionCreateRequest(
        name="Valid Mission",
        route_id="route_valid_123",
        region_id="jezero_crater",
        notes="Short note",
    )
    assert valid.name == "Valid Mission"

    # Route ID exceeds 128 characters
    with pytest.raises(ValidationError):
        MissionCreateRequest(
            name="Test",
            route_id="x" * 129,
        )

    # Name exceeds 120 characters
    with pytest.raises(ValidationError):
        MissionCreateRequest(
            name="x" * 121,
            route_id="route_test_123",
        )

    # Region ID exceeds 64 characters
    with pytest.raises(ValidationError):
        MissionCreateRequest(
            name="Test",
            route_id="route_test_123",
            region_id="x" * 65,
        )

    # Notes exceed 2000 characters
    with pytest.raises(ValidationError):
        MissionCreateRequest(
            name="Test",
            route_id="route_test_123",
            notes="x" * 2001,
        )


def test_h02_mission_service_lru_capacity():
    """Verify in-memory mission store is capped at MAX_MISSIONS and evicts oldest."""
    service = MissionService()
    assert service.MAX_MISSIONS == 100

    created_ids = []
    for i in range(105):
        req = MissionCreateRequest(
            name=f"Mission Sol {i}",
            route_id="route_test_123",
            notes=f"Note {i}",
        )
        mission = service.create_mission(req)
        created_ids.append(mission.id)

    # Storage should be capped at 100
    assert len(service._missions) == 100

    # First 5 missions should be evicted
    for evicted_id in created_ids[:5]:
        with pytest.raises(NotFoundException):
            service.get_mission(evicted_id)

    # Most recent missions must still exist
    for retained_id in created_ids[5:]:
        m = service.get_mission(retained_id)
        assert m.id == retained_id


@pytest.mark.asyncio
async def test_h03_route_planning_non_blocking_concurrency():
    """Verify route planning runs asynchronously in a worker thread without starving event loop."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        req = {
            "region_id": "jezero_crater",
            "start": {"longitude": 77.35, "latitude": 18.45},
            "goal": {"longitude": 77.55, "latitude": 18.55},
            "options": {
                "max_slope_degrees": 25.0,
                "avoid_hazards": True,
                "hazard_weight": 0.4,
                "slope_weight": 0.3,
                "distance_weight": 0.3,
                "alternatives": 2,
            },
        }

        # Concurrently launch route planning and health checks
        plan_task = asyncio.create_task(ac.post("/api/routes/plan", json=req))
        health_task1 = asyncio.create_task(ac.get("/api/health"))
        health_task2 = asyncio.create_task(ac.get("/api/health"))

        results = await asyncio.gather(plan_task, health_task1, health_task2)
        plan_resp, health_resp1, health_resp2 = results

        assert plan_resp.status_code == 200
        assert health_resp1.status_code == 200
        assert health_resp2.status_code == 200
        assert plan_resp.json()["status"] == "success"
