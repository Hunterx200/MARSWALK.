"""Mission schema definitions."""
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class MissionSummary(BaseModel):
    distance_meters: float
    risk_level: Literal["low", "medium", "high"]
    mean_slope_degrees: float
    maximum_slope_degrees: float
    hazard_score: float
    observations: int = 0


class MissionSection(BaseModel):
    title: str
    content: str


class MissionReport(BaseModel):
    title: str = "MARSWALK Mission Plan"
    sections: List[MissionSection] = Field(default_factory=list)


class MissionCreateRequest(BaseModel):
    region_id: str = Field(default="jezero_crater", max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    route_id: str = Field(..., min_length=1, max_length=128)
    notes: Optional[str] = Field(default=None, max_length=2000)


class MissionResponse(BaseModel):
    id: str
    name: str
    region_id: str
    route_id: str
    created_at: str
    status: str = "draft"
    summary: MissionSummary
    report: MissionReport
    notes: Optional[str] = None
