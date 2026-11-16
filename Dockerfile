# ==========================================
# STAGE 1: Build React/Vite Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend

# Copy package manifests for deterministic install
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy frontend source and build production bundle
COPY frontend/ ./
RUN npm run build

# ==========================================
# STAGE 2: Python / FastAPI Production Runner
# ==========================================
FROM python:3.12-slim AS production-runner

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/app/backend:/app" \
    MARSWALK_STATIC_DIR="/app/frontend/dist"

WORKDIR /app

# Install curl for container health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install backend Python dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy algorithms core engine and backend application
COPY algorithms/ ./algorithms/
COPY backend/ ./backend/

# Copy compiled frontend assets from Stage 1
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# Configure non-root application user for production security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/backend

# Default port 8000; Render dynamically overrides via $PORT at runtime
EXPOSE 8000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/health || exit 1

# Launch FastAPI via Uvicorn bound to dynamic $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
