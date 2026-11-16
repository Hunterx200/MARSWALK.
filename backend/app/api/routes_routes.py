"""Route planning endpoint."""
from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool
from app.schemas.route import RoutePlanRequest, RoutePlanResponse
from app.services.route_service import route_service

router = APIRouter(tags=["Routes"])


@router.post("/routes/plan", response_model=RoutePlanResponse)
async def plan_route(request: RoutePlanRequest):
    """
    Plan a Mars rover traverse between geographic coordinates in Jezero Crater.
    Uses A* pathfinding over terrain grid evaluating slope and hazard risks.
    Generates alternative paths by weighting distance vs slope/hazard avoidance.
    """
    return await run_in_threadpool(route_service.plan_route, request)
