"""Unit and API integration tests for Perseverance MEDA Environmental Intelligence."""
import os
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.services.meda_service import meda_service, _parse_float, _parse_int


def test_meda_parser_rules():
    """Verify parsing empty strings and 999999999 sentinel as None."""
    assert _parse_float("") is None
    assert _parse_float("   ") is None
    assert _parse_float("999999999") is None
    assert _parse_float(None) is None
    assert _parse_float("239.86") == 239.86

    assert _parse_int("") is None
    assert _parse_int("999999999") is None
    assert _parse_int("1") == 1
    assert _parse_int("0") == 0


@pytest.mark.asyncio
async def test_available_sols_endpoint():
    """Verify listing available verified Sols."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/environment/sols")
        assert resp.status_code == 200
        sols = resp.json()
        assert isinstance(sols, list)
        assert 74 in sols
        assert 755 in sols


@pytest.mark.asyncio
async def test_sol_755_telemetry_contract():
    """Verify Sol 755 telemetry: unarchived wind, unresolved pressure uncertainty, 5 ATS channels."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/environment/telemetry?sol=755&sclk=733967483.0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sol"] == 755
        assert data["site_location"] == "Jezero Crater, Mars"
        assert data["is_historical_archive"] is True
        assert data["dust_optical_depth"] is None

        # ATS: 5 separate channels, no arithmetic mean
        ats = data["ats"]
        assert ats["available"] is True
        assert ats["sclk"] == 733967483.0
        assert "mean_ambient_temp_k" not in ats
        assert ats["ats_local_temp1_k"] == 239.86
        assert ats["ats_local_temp2_k"] == 239.08
        assert ats["ats_local_temp3_k"] == 246.35
        assert ats["ats_local_temp4_k"] == 254.64
        assert ats["ats_local_temp5_k"] == 257.57
        assert ats["provenance"]["product_filename"].startswith("WE__0755")
        assert ats["provenance"]["processing_level"] == "Calibrated"

        # Pressure: Pa pressure, raw uncertainty, unresolved unit status
        pressure = data["pressure"]
        assert pressure["available"] is True
        assert pressure["pressure_pa"] == 739.62
        assert pressure["source_declared_unit"] == "kelvin"
        assert pressure["physical_unit_status"] == "UNRESOLVED_IN_UPSTREAM_METADATA"
        assert "pressure_uncertainty_pa" not in pressure

        # TIRS: Air temp and Ground brightness temp
        tirs = data["tirs"]
        assert tirs["available"] is True
        assert tirs["air_temp_k"] == 230.33
        assert tirs["ground_brightness_temp_k"] == 269.24
        assert tirs["ground_temp_uncertainty_k"] == 0.56

        # Wind: Sol 755 wind is NOT archived in PDS
        wind = data["wind"]
        assert wind["available"] is False
        assert wind["status_reason"] == "PRODUCT_NOT_ARCHIVED_IN_PDS"
        assert wind["horizontal_wind_speed_ms"] is None
        assert wind["wind_direction_deg"] is None

        # RDS: LAT1 in amps, optical channels in W/m2 with exact archive description
        rds = data["rds"]
        assert rds["available"] is True
        assert rds["rds_lat_1_amp"] == 3.548e-12
        assert len(rds["rds_top_channels"]) == 8
        assert len(rds["rds_lat_channels"]) == 7
        assert rds["optical_channels_unit"] == "watt/m2"
        assert rds["archive_description"] == "radiance integrated over Field of View"
        assert rds["physical_interpretation_status"] == "UNRESOLVED_RADIANCE_VS_FLUX"


@pytest.mark.asyncio
async def test_sol_74_wind_operational():
    """Verify Sol 74 has operational wind sensor readings."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/environment/telemetry?sol=74&sclk=673507031.0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sol"] == 74

        wind = data["wind"]
        assert wind["available"] is True
        assert wind["status_reason"] == "OPERATIONAL"
        assert wind["horizontal_wind_speed_ms"] == 1.16
        assert wind["wind_direction_deg"] == 227.13


@pytest.mark.asyncio
async def test_sol_validation_errors():
    """Verify input validation for invalid or missing Sols."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Negative Sol -> 422 validation error
        resp_neg = await ac.get("/api/environment/telemetry?sol=-5")
        assert resp_neg.status_code == 422

        # Non-existent Sol -> 404 error
        resp_missing = await ac.get("/api/environment/telemetry?sol=9999")
        assert resp_missing.status_code == 404
        assert "No MEDA telemetry archived for Sol 9999" in resp_missing.json()["error"]["message"]


@pytest.mark.asyncio
async def test_sol_summary_endpoint():
    """Verify Sol summary calculations and operational statistics."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/environment/summary?sol=755")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sol"] == 755
        assert data["sensors_available"]["ats"] is True
        assert data["sensors_available"]["pressure"] is True
        assert data["sensors_available"]["wind"] is False
        assert data["sensor_summaries"]["wind"]["status_reason"] == "PRODUCT_NOT_ARCHIVED_IN_PDS"
        assert data["sensor_summaries"]["ats"]["valid_records"] > 0


@pytest.mark.asyncio
async def test_sol_timeseries_endpoint():
    """Verify sampled time series endpoint for frontend charts."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/environment/timeseries?sol=755&max_points=50")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sol"] == 755
        assert len(data["samples"]) > 0
        assert len(data["samples"]) <= 50
        first_pt = data["samples"][0]
        assert "sclk" in first_pt
        assert "lmst" in first_pt
        assert "ltst" in first_pt


def test_timeseries_cache_numerical_equivalence():
    """Verify disk cache samples are 100% numerically equivalent (<= 6 decimal places) to raw CSV output."""
    # Test Sol 74 (standard 100 points)
    cached_74 = meda_service._load_timeseries_from_disk_cache(74, 100)
    raw_74 = meda_service._parse_timeseries_from_csv(74, 100)

    assert cached_74 is not None
    assert len(cached_74.samples) == len(raw_74.samples) == 100

    for i, (c, r) in enumerate(zip(cached_74.samples, raw_74.samples)):
        assert c.sclk == pytest.approx(r.sclk, abs=1e-6)
        assert c.lmst == r.lmst
        assert c.ltst == r.ltst
        if r.ats_temp1_k is not None:
            assert c.ats_temp1_k == pytest.approx(r.ats_temp1_k, abs=1e-6)
        else:
            assert c.ats_temp1_k is None
        if r.pressure_pa is not None:
            assert c.pressure_pa == pytest.approx(r.pressure_pa, abs=1e-6)
        else:
            assert c.pressure_pa is None
        if r.air_temp_k is not None:
            assert c.air_temp_k == pytest.approx(r.air_temp_k, abs=1e-6)
        else:
            assert c.air_temp_k is None
        if r.ground_brightness_temp_k is not None:
            assert c.ground_brightness_temp_k == pytest.approx(r.ground_brightness_temp_k, abs=1e-6)
        else:
            assert c.ground_brightness_temp_k is None
        if r.wind_speed_ms is not None:
            assert c.wind_speed_ms == pytest.approx(r.wind_speed_ms, abs=1e-6)
        else:
            assert c.wind_speed_ms is None
        if r.wind_direction_deg is not None:
            assert c.wind_direction_deg == pytest.approx(r.wind_direction_deg, abs=1e-6)
        else:
            assert c.wind_direction_deg is None
        assert c.rds_top_7 == r.rds_top_7

    # Test Sol 755 (50 points)
    cached_755 = meda_service._load_timeseries_from_disk_cache(755, 50)
    raw_755 = meda_service._parse_timeseries_from_csv(755, 50)

    assert cached_755 is not None
    assert len(cached_755.samples) == len(raw_755.samples) == 50
    for c, r in zip(cached_755.samples, raw_755.samples):
        assert c.sclk == pytest.approx(r.sclk, abs=1e-6)
        assert c.lmst == r.lmst
        assert c.ltst == r.ltst
        assert c.wind_speed_ms is None and r.wind_speed_ms is None


def test_timeseries_variable_max_points_and_fallback():
    """Verify disk cache handles supported resolutions and cleanly falls back to CSV for custom/large resolutions."""
    # Supported resolution: 20 points
    res_20 = meda_service.get_sol_timeseries(74, 20)
    assert len(res_20.samples) == 20

    # Large resolution > 200 (e.g. 250): must fall back to CSV parser without error or truncation
    res_250 = meda_service.get_sol_timeseries(74, 250)
    assert len(res_250.samples) == 250
    assert res_250.samples[0].sclk > 0


def test_timeseries_corrupt_cache_fallback(tmp_path):
    """Verify that corrupt, malformed, or missing JSON caches safely fall back to raw CSV parsing."""
    import shutil
    from app.services.meda_service import MedaService

    # Create temporary service directory with a corrupt cache file
    temp_dir = tmp_path / "meda"
    temp_dir.mkdir()

    # Copy raw CSV sol_0074 data to temp
    shutil.copytree(os.path.join(meda_service.data_dir, "sol_0074"), temp_dir / "sol_0074")

    # Write malformed JSON cache
    corrupt_cache_file = temp_dir / "timeseries_cache_sol_0074.json"
    corrupt_cache_file.write_text("{corrupt: json! invalid", encoding="utf-8")

    temp_service = MedaService(data_dir=str(temp_dir))
    # Must not raise an exception; must log warning and fall back to raw CSV parser
    res = temp_service.get_sol_timeseries(74, 50)
    assert res is not None
    assert len(res.samples) == 50
    assert res.samples[0].ats_temp1_k is not None

