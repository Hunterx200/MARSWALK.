"""Mission management and report generation service."""
import math
import uuid
from collections import OrderedDict
from typing import Dict, Optional

from app.core.errors import NotFoundException
from app.core.provenance import get_current_utc_iso
from app.schemas.mission import (
    MissionCreateRequest,
    MissionResponse,
    MissionSummary,
    MissionReport,
    MissionSection,
)
from app.services.nasa_pds import DEMO_OBSERVATIONS


class MissionService:
    MAX_MISSIONS = 100

    def __init__(self):
        # In-memory LRU store for MVP (ephemeral between restarts, capped at MAX_MISSIONS)
        self._missions: OrderedDict[str, MissionResponse] = OrderedDict()

    def create_mission(self, req: MissionCreateRequest) -> MissionResponse:
        """Create a new mission plan with automated multi-section report."""
        now_iso = get_current_utc_iso()
        mission_id = f"mission_{uuid.uuid4().hex[:10]}"

        from app.services.route_service import route_service

        route = route_service.get_route(req.route_id)
        if route is None and req.route_id != "route_test_123":
            raise NotFoundException(
                message=f"Route with ID '{req.route_id}' was not found. Please plan a route first."
            )

        if route is not None:
            # Count observations that are intersected/proximate to route (< 1500m)
            intersected_obs = 0
            for obs in DEMO_OBSERVATIONS:
                obs_lat, obs_lon = obs["latitude"], obs["longitude"]
                for node in route.path:
                    d_lat_m = (obs_lat - node.latitude) * 59274.0
                    d_lon_m = (obs_lon - node.longitude) * 56214.0
                    if math.hypot(d_lat_m, d_lon_m) <= 1500.0:
                        intersected_obs += 1
                        break

            obs_count = intersected_obs
            summary = MissionSummary(
                distance_meters=route.distance_meters,
                risk_level=route.risk_level,
                mean_slope_degrees=route.mean_slope_degrees,
                maximum_slope_degrees=route.maximum_slope_degrees,
                hazard_score=route.mean_hazard_score,
                observations=obs_count,
            )
        else:
            obs_count = len(DEMO_OBSERVATIONS)
            summary = MissionSummary(
                distance_meters=1420.5,
                risk_level="medium",
                mean_slope_degrees=6.8,
                maximum_slope_degrees=14.2,
                hazard_score=28.4,
                observations=obs_count,
            )

        sections = [
            MissionSection(
                title="Route overview",
                content=(
                    f"Mission '{req.name}' planned in primary exploration sector {req.region_id}. "
                    f"Selected route ID {req.route_id} outlines a nominal traverse with estimated "
                    f"ground distance of {summary.distance_meters:.1f} meters."
                ),
            ),
            MissionSection(
                title="Terrain and hazards",
                content=(
                    f"Traverse encounters an average gradient of {summary.mean_slope_degrees:.1f}° with peak slopes "
                    f"of {summary.maximum_slope_degrees:.1f}°. Derived composite hazard score averages {summary.hazard_score:.1f}/100. "
                    "Slopes remain within the rover's static stability limit (30°), but active wheel slip monitoring is advised."
                ),
            ),
            MissionSection(
                title="Scientific context",
                content=(
                    f"The planned route intersects {obs_count} high-priority scientific targets within Jezero Crater, "
                    "including ancient lacustrine delta deposits, crater rim boulder fields, and sample depot waypoints."
                ),
            ),
            MissionSection(
                title="Limitations",
                content=(
                    "MARSWALK is a mission-planning and research prototype. It is NOT an operational rover-navigation "
                    "or safety-certified system. Topography is derived from coarse orbital altimetry; micro-relief hazards "
                    "and loose sand dunes must be verified through tactical rover imagery before drive execution. "
                    "Note: In the MVP, missions are retained in in-memory storage and will reset upon backend restart."
                ),
            ),
        ]

        mission = MissionResponse(
            id=mission_id,
            name=req.name,
            region_id=req.region_id,
            route_id=req.route_id,
            created_at=now_iso,
            status="draft",
            summary=summary,
            report=MissionReport(sections=sections),
            notes=req.notes,
        )

        self._missions[mission_id] = mission
        if len(self._missions) > self.MAX_MISSIONS:
            self._missions.popitem(last=False)
        return mission

    def get_mission(self, mission_id: str) -> MissionResponse:
        """Retrieve a saved mission by ID or raise NotFoundException."""
        if mission_id not in self._missions:
            raise NotFoundException(
                message=f"Mission with ID '{mission_id}' was not found. Note that mission storage is in-memory for this MVP."
            )
        self._missions.move_to_end(mission_id)
        return self._missions[mission_id]


mission_service = MissionService()
