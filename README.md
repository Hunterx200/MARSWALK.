# MARSWALK — Intelligent Mars Exploration & Mission Planning System

> *Explore smarter. Navigate safer. Discover more.*

[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)](https://fastapi.tiangolo.com/)
[![React 18](https://img.shields.io/badge/React-18.3-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6.svg)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r187-black.svg)](https://threejs.org/)
[![OpenLayers](https://img.shields.io/badge/OpenLayers-10.2-1f6b75.svg)](https://openlayers.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646cff.svg)](https://vitejs.dev/)

---

## 1. Project Overview & Purpose

**MARSWALK** is an advanced, full-stack planetary exploration and rover mission planning platform designed for the surface of Mars. Focused on **Jezero Crater**—the landing and operational site of NASA's Mars 2020 *Perseverance* rover—MARSWALK bridges planetary cartography, scientific telemetry, and autonomous robotics pathfinding into an intuitive, high-performance web interface.

The platform enables mission planners, researchers, and space exploration enthusiasts to:
- Seamlessly transition between global planetary exploration and high-resolution crater cartography.
- Analyze topographic slopes, surface roughness, and hazardous Martian terrain.
- Compute optimal, traversability-constrained rover paths using custom **A\*** pathfinding algorithms.
- Simulate environmental conditions inspired by the Mars 2020 MEDA instrument suite.
- Plan and document scientific observation waypoints along candidate traversal routes.
- Generate and export detailed mission summary reports for operational review.

---

## 2. Main Features

### 🪐 Interactive 3D Mars Visualization
- Photorealistic 3D Mars globe powered by **Three.js**.
- High-fidelity global surface textures, atmospheric scattering shaders, coordinate rings, and interactive orbit controls.
- Smooth camera focal transitions between global views and regional targets like Jezero Crater.

### 🗺️ Jezero Crater Exploration & NASA Map Layers
- High-precision 2D geospatial mapping powered by **OpenLayers**.
- Bounded to the Jezero Crater operational zone ($77.0^\circ\text{E} - 77.8^\circ\text{E}$, $18.2^\circ\text{N} - 18.7^\circ\text{N}$, Martian CRS EPSG:4326).
- Multi-layer basemap support integrating:
  - **NASA Trek WMTS** planetary tile services.
  - **Viking MDIM2.1** global mosaic.
  - **MOLA (Mars Orbiter Laser Altimeter)** shaded relief and elevation models.
  - High-resolution **CTX / HiRISE** Jezero imagery.
  - Elevation contour overlays and geological point-of-interest markers (Western Delta, Séítah, Crater Rim).

### ⚠️ Terrain & Hazard Analysis
- Real-time slope gradient calculation derived from 128 PPD MOLA Digital Elevation Models (DEM).
- Multi-factor hazard classification categorizing zones into **Safe**, **Cautionary**, and **Critical / Non-Traversable**.
- Proximity buffers and obstacle avoidance zones around rock fields, steep crater scarps, and loose aeolian bedforms.

### 🧭 A* Route Planning & Alternative Trajectories
- 8-connectivity grid-based **A\*** pathfinding engine tailored for planetary rover dynamics.
- Traversability cost function factoring in distance, slope steepness penalties, and hazard proximity buffers.
- Multi-route calculation providing mission controllers with both the primary optimal path and conservative/alternative candidate routes.
- Real-time elevation profile computation displaying path distance, elevation deltas, and maximum slope angles.

### 📊 Mission Reports & Scientific Observations
- Interactive placement and logging of science observation waypoints (e.g., delta sediment sampling, bedrock spectroscopy).
- Environmental intelligence telemetry inspired by the Mars 2020 **MEDA** (Mars Environmental Dynamics Analyzer) instrument, displaying surface pressure, atmospheric temperature profiles, and wind vectors.
- Comprehensive mission brief generation summarizing distance, traversal duration, energy estimates, hazard exposure, and scientific milestones.

---

## 3. Technology Stack

### Frontend
- **Framework & Language:** React 18 with TypeScript 5.6
- **Build Tool & Dev Server:** Vite 5
- **3D Graphics:** Three.js
- **2D Cartography & Geospatial:** OpenLayers 10
- **Styling:** Tailwind CSS with PostCSS & Autoprefixer
- **UI Components & Icons:** Lucide React

### Backend & Algorithms
- **Runtime & Framework:** Python 3.11+ / 3.12 with FastAPI
- **Data Validation & Settings:** Pydantic v2 & Pydantic-Settings
- **Scientific Computing:** NumPy & SciPy
- **HTTP Client:** HTTPX (async client with upstream timeouts and error handling)
- **ASGI Web Server:** Uvicorn
- **Testing:** Pytest & Pytest-Asyncio

---

## 4. Prerequisites

Before installing MARSWALK locally, ensure you have the following installed on your system:

- **Node.js**: `v18.x` or `v20.x` (LTS recommended) — [Download Node.js](https://nodejs.org/)
- **npm**: `v9.x` or `v10.x` (bundled with Node.js)
- **Python**: `3.11` or `3.12` — [Download Python](https://www.python.org/)
- **Git**: [Download Git](https://git-scm.com/)
- **Docker** *(optional, for containerized execution)*: [Download Docker Desktop](https://www.docker.com/)

---

## 5. Local Development Setup

To run MARSWALK locally, execute the backend and frontend services in separate terminal windows.

### Step 1: Clone Repository

```bash
git clone https://github.com/Hunterx200/MARSWALK..git
cd MARSWALK-live
```

---

### Step 2: Start the Backend Service

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```

2. Create a Python virtual environment:
   - **Linux / macOS:**
     ```bash
     python3 -m venv venv
     source venv/bin/activate
     ```
   - **Windows (PowerShell):**
     ```powershell
     python -m venv venv
     .\venv\Scripts\Activate.ps1
     ```
   - **Windows (CMD):**
     ```cmd
     python -m venv venv
     .\venv\Scripts\activate.bat
     ```

3. Install backend dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Launch the FastAPI server with hot-reload:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

5. Verify backend status:
   - **API Root / Health:** [http://localhost:8000/api/health](http://localhost:8000/api/health)
   - **Interactive API Docs (Swagger UI):** [http://localhost:8000/docs](http://localhost:8000/docs)
   - **Alternative API Docs (ReDoc):** [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

### Step 3: Start the Frontend Service

1. In a new terminal window, navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Vite development server:
   ```bash
   npm run dev
   ```

4. Open the application:
   - Navigate to [http://localhost:5173](http://localhost:5173) in your web browser.
   - The Vite development server automatically proxies API requests (`/api/*`) to `http://localhost:8000`.

---

## 6. Environment Configuration

MARSWALK is designed with sensible defaults, allowing it to run out of the box without manual environment setup. If custom configuration is needed, create a `.env` file in the `backend/` or `frontend/` directory.

> **Security Note:** Never commit `.env` or `.env.local` files containing secrets or credentials to source control.

### Backend Configuration (`backend/.env`)

Variables use the `MARSWALK_` prefix (managed via Pydantic Settings):

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | `int` | `8000` | Port to bind the server to (standard cloud provider port). |
| `MARSWALK_STATIC_DIR` | `string` | *(auto-detected)* | Path to compiled frontend assets (`frontend/dist`). |
| `MARSWALK_UPSTREAM_TIMEOUT_SECONDS` | `float` | `8.0` | Maximum timeout (seconds) for upstream NASA API queries. |
| `MARSWALK_CORS_ORIGINS` | `list` | `["*"]` | Allowed CORS origins for cross-domain browser requests. |
| `MARSWALK_DEBUG` | `bool` | `False` | Enable extended diagnostic debug logging. |

### Frontend Configuration (`frontend/.env` or `frontend/.env.local`)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `VITE_API_BASE_URL` | `string` | `""` (empty) | Base URL for backend API requests. If empty or omitted, requests use relative path `/api`, routed via Vite proxy in development or served directly by FastAPI in production. |

---

## 7. Docker & Render Deployment

MARSWALK includes a production-grade multi-stage `Dockerfile` and a `render.yaml` infrastructure-as-code specification.

### Multi-Stage Dockerfile Overview
- **Stage 1 (`node:20-alpine`)**: Builds the optimized React/Vite single-page application into static assets.
- **Stage 2 (`python:3.12-slim`)**: Installs Python dependencies, copies backend and algorithm modules, mounts compiled frontend assets, establishes an unprivileged security user (`appuser`), and exposes `/api/health` for orchestrator health probes.

### Running with Docker Locally

1. Build the Docker container image:
   ```bash
   docker build -t marswalk .
   ```

2. Run the container:
   ```bash
   docker run -d -p 8000:8000 -e PORT=8000 --name marswalk-app marswalk
   ```

3. Test container health and access the app:
   ```bash
   curl http://localhost:8000/api/health
   ```
   Open [http://localhost:8000](http://localhost:8000) in your browser.

---

### Deploying to Render

The repository includes a ready-to-use `render.yaml` Blueprint file:

1. Push your repository to GitHub.
2. Sign in to the [Render Dashboard](https://dashboard.render.com/).
3. Click **New** > **Blueprint** and connect your repository.
4. Render automatically parses `render.yaml`, provisions the Web Service using Docker runtime, and routes traffic through port `10000`.
5. Once built, Render provisions an HTTPS URL where both the frontend UI and the FastAPI backend are served from a single unified domain.

---

## 8. Project Directory Structure

```
MARSWALK-live/
├── algorithms/                    # Core mathematical & planetary algorithms
│   ├── grid/                      # Martian coordinate transforms & grid sampling
│   ├── hazards/                   # Hazard proximity & multi-factor risk scoring
│   ├── routing/                   # A* pathfinding & alternative route evaluation
│   ├── science/                   # Scientific observation planning
│   ├── terrain/                   # MOLA DEM slope & roughness cost models
│   └── tests/                     # Automated algorithm unit tests
│
├── backend/                       # FastAPI backend application
│   ├── app/
│   │   ├── api/                   # REST API route handlers (/api/*)
│   │   │   ├── routes_environment.py # MEDA simulated weather & atmosphere
│   │   │   ├── routes_hazards.py     # Hazard telemetry endpoints
│   │   │   ├── routes_health.py      # Health check probe (/api/health)
│   │   │   ├── routes_layers.py      # NASA WMTS & cartographic layers
│   │   │   ├── routes_missions.py    # Mission briefs & report generation
│   │   │   ├── routes_regions.py     # Exploration region metadata
│   │   │   ├── routes_routes.py      # A* route planning execution
│   │   │   └── routes_terrain.py     # Elevation & slope profiles
│   │   ├── core/                  # Errors, exception handlers & provenance
│   │   ├── data/                  # Jezero MOLA DEM datasets & provenance metadata
│   │   ├── schemas/               # Pydantic data contract models
│   │   ├── services/              # Business logic, terrain caching & NASA clients
│   │   ├── config.py              # Application settings & environment parsing
│   │   └── main.py                # FastAPI entrypoint & SPA static asset mount
│   ├── tests/                     # Backend contract, regression & integration tests
│   └── requirements.txt           # Python backend dependencies
│
├── frontend/                      # React + TypeScript + Vite frontend
│   ├── src/
│   │   ├── components/            # UI components
│   │   │   ├── Sidebar/           # Mission panels (Route, Hazard, Layers, etc.)
│   │   │   ├── ElevationProfileChart.tsx # Route elevation profile visualizer
│   │   │   ├── ErrorBoundary.tsx  # React crash guard & error recovery UI
│   │   │   ├── Header.tsx         # Mission title bar & system status
│   │   │   ├── MarsGlobe.tsx      # Three.js photorealistic 3D Mars globe
│   │   │   ├── MarsMap.tsx        # OpenLayers 2D Jezero geospatial map
│   │   │   └── MissionReportModal.tsx # Mission debrief & report modal
│   │   ├── services/              # API client and OpenLayers map manager
│   │   ├── types/                 # TypeScript data contracts & interfaces
│   │   ├── App.tsx                # Main application layout & state machine
│   │   ├── index.css              # Tailwind CSS styles & map styling
│   │   ├── main.tsx               # React application entrypoint
│   │   └── vite-env.d.ts          # Vite client TypeScript declarations
│   ├── package.json               # Frontend package manifest & scripts
│   └── vite.config.ts             # Vite build configuration & API reverse proxy
│
├── .dockerignore                  # Docker build exclusion rules
├── .gitignore                     # Git repository exclusion rules
├── Dockerfile                     # Multi-stage production container build
├── package.json                   # Root package script shortcuts
├── pytest.ini                     # Pytest pythonpath configuration
├── README.md                      # Project documentation
└── render.yaml                    # Render Cloud Blueprint specification
```

---

## 9. Testing & Code Quality

### Backend & Algorithm Test Suite
Run the comprehensive Pytest test suite (covering A* routing, DEM regression, API contracts, and hazard models):

```bash
# Run all tests
pytest backend/tests algorithms/tests

# Run with verbose output and coverage
pytest -v backend/tests algorithms/tests
```

### Frontend Typechecking & Production Build
Ensure zero TypeScript compilation errors and verify the production bundle:

```bash
# Typecheck TypeScript codebase
npm --prefix frontend run lint

# Compile production bundle
npm --prefix frontend run build
```

---

## 10. Limitations & Disclaimer

- **Educational & Demonstration MVP:** MARSWALK is built as an educational demonstration and research prototype for planetary exploration concepts.
- **Not for Real Mission Operations:** The pathfinding algorithms, cost models, simulated weather data, and hazard classifications are simplified models. They are **not certified** for operational rover navigation, active space mission commanding, flight software, or real-time autonomous hardware guidance.
- **Data Fidelity:** While based on real NASA MOLA and orbital datasets of Jezero Crater, some hazard points and environmental sensor feeds incorporate synthetic benchmarks for demonstration and testing purposes.

---

## 11. Contributing

Contribution guidelines, code style standards, and pull request procedures are **not yet specified** for this repository. If you are interested in contributing or proposing features, please open an issue to discuss your ideas with the project maintainers.

---

## 12. License

A software license has **not yet been specified** for this repository. All rights are reserved by the original authors and contributors unless explicitly noted otherwise.
