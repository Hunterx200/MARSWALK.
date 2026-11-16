"""FastAPI main application entrypoint for MARSWALK."""
import logging
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.core.errors import (
    MarswalkException,
    marswalk_exception_handler,
    validation_exception_handler,
    http_exception_handler,
    general_exception_handler,
)
from app.api import (
    routes_health,
    routes_regions,
    routes_layers,
    routes_observations,
    routes_terrain,
    routes_hazards,
    routes_routes,
    routes_missions,
    routes_environment,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("marswalk")

app = FastAPI(
    title="MARSWALK Backend API",
    version=settings.version,
    description="MARSWALK: Intelligent Mars Exploration & Mission Planning MVP API",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS configuration: avoid wildcard with credentials
is_wildcard_cors = "*" in settings.cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=not is_wildcard_cors,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exception handlers ensuring consistent error envelope
app.add_exception_handler(MarswalkException, marswalk_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

# Include API routes under /api
app.include_router(routes_health.router, prefix="/api")
app.include_router(routes_regions.router, prefix="/api")
app.include_router(routes_layers.router, prefix="/api")
app.include_router(routes_observations.router, prefix="/api")
app.include_router(routes_terrain.router, prefix="/api")
app.include_router(routes_hazards.router, prefix="/api")
app.include_router(routes_routes.router, prefix="/api")
app.include_router(routes_missions.router, prefix="/api")
app.include_router(routes_environment.router, prefix="/api")

# Static frontend assets and SPA fallback configuration
STATIC_DIR = os.getenv(
    "MARSWALK_STATIC_DIR",
    str(Path(__file__).resolve().parent.parent.parent / "frontend" / "dist")
)

# Mount compiled assets directory (/assets) if present
assets_dir = os.path.join(STATIC_DIR, "assets")
if os.path.isdir(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/", include_in_schema=False)
async def serve_root():
    """Serve index.html at root, or return API status if frontend is not built."""
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return {
        "service": "MARSWALK Backend API",
        "version": settings.version,
        "docs": "/docs",
        "health": "/api/health",
        "note": "Frontend static assets not built. Run 'npm run build' in frontend directory."
    }


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa_or_static(full_path: str):
    """Serve compiled frontend static assets and SPA fallback for non-API routes."""
    # Ensure unknown /api/* requests strictly return JSON 404 (never the HTML page)
    if full_path.startswith("api/") or full_path == "api":
        raise StarletteHTTPException(status_code=404, detail="API endpoint not found")

    # Pass through docs and openapi routes if requested without slash
    if full_path in ("docs", "redoc", "openapi.json"):
        raise StarletteHTTPException(status_code=404, detail="Not Found")

    # If an exact static file exists (e.g. favicon.ico, logo.svg), serve it
    file_path = os.path.join(STATIC_DIR, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)

    # For any frontend route (including nested client routes), return index.html
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)

    raise StarletteHTTPException(status_code=404, detail="Resource not found")
