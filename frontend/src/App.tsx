import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MarsMapController } from './services/mapManager';
import { MarswalkApiClient } from './services/apiClient';
import { 
  Observation, 
  HazardZone, 
  MapLayerConfig, 
  RoutePlanResponse,
  TerrainSummary,
  Waypoint,
  RouteProfile
} from './types/api';
import { Header } from './components/Header';
import { MarsMap } from './components/MarsMap';
import { MarsGlobe } from './components/MarsGlobe';
import { RoutePlannerPanel } from './components/Sidebar/RoutePlannerPanel';
import { LayerControlPanel } from './components/Sidebar/LayerControlPanel';
import { HazardTelemetryPanel } from './components/Sidebar/HazardTelemetryPanel';
import { ScienceObservationsPanel } from './components/Sidebar/ScienceObservationsPanel';
import { EnvironmentalIntelligencePanel } from './components/Sidebar/EnvironmentalIntelligencePanel';
import { ElevationProfileChart } from './components/ElevationProfileChart';
import { MissionReportModal } from './components/MissionReportModal';
import { 
  Navigation, 
  Layers, 
  ShieldAlert, 
  Microscope, 
  Thermometer,
  ChevronRight, 
  ChevronLeft,
  Activity
} from 'lucide-react';

export const App: React.FC = () => {
  const controller = useMemo(() => new MarsMapController(), []);

  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(() => MarswalkApiClient.isBackendConnected());
  const [activeTab, setActiveTab] = useState<'route' | 'layers' | 'hazards' | 'science' | 'environment'>('route');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [showElevationProfile, setShowElevationProfile] = useState<boolean>(true);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);

  const [layers, setLayers] = useState<MapLayerConfig[]>([]);
  const [hazards, setHazards] = useState<HazardZone[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [terrainSummary, setTerrainSummary] = useState<TerrainSummary | null>(null);

  // Start & Goal points
  const [startPoint, setStartPoint] = useState<{ lat: number; lon: number; name?: string }>({
    name: 'Octavia E. Butler Landing (Sol 0)',
    lat: 18.4447,
    lon: 77.4508,
  });

  const [goalPoint, setGoalPoint] = useState<{ lat: number; lon: number; name?: string }>({
    name: 'Belva Crater South Rim',
    lat: 18.5204,
    lon: 77.3752,
  });

  const [plannedRoute, setPlannedRoute] = useState<RoutePlanResponse | null>(null);
  const [activeWaypoints, setActiveWaypoints] = useState<Waypoint[]>([]);
  const [activeAlternativeId, setActiveAlternativeId] = useState<string>('primary');
  const [activeProfile, setActiveProfile] = useState<RouteProfile>('balanced');
  const [selectionMode, setSelectionMode] = useState<'inspect' | 'start' | 'goal'>('inspect');
  const [selectedFeature, setSelectedFeature] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'globe' | 'map'>('globe');
  const routeRequestIdRef = useRef<number>(0);

  const activeReportRoute = useMemo<RoutePlanResponse | null>(() => {
    if (!plannedRoute) return null;
    if (activeAlternativeId === 'primary' || !plannedRoute.alternatives) {
      return plannedRoute;
    }
    const alt = plannedRoute.alternatives.find(a => a.id === activeAlternativeId);
    if (!alt) return plannedRoute;
    const cat: 'LOW' | 'MEDIUM' | 'HIGH' =
      alt.risk_category === 'HIGH' || alt.risk_category === 'MEDIUM' ? alt.risk_category : 'LOW';
    return {
      ...plannedRoute,
      route_id: alt.id,
      profile: alt.profile,
      summary: {
        total_distance_m: alt.distance_m,
        estimated_duration_sols: alt.duration_sols,
        max_slope_deg: alt.max_slope_deg,
        avg_slope_deg: alt.avg_slope_deg,
        overall_risk_score: alt.risk_score,
        risk_category: cat,
        energy_budget_kwh: alt.energy_budget_kwh ?? plannedRoute.summary?.energy_budget_kwh,
      },
      waypoints: alt.waypoints || plannedRoute.waypoints,
      path_coordinates: alt.path_coordinates || plannedRoute.path_coordinates,
    };
  }, [plannedRoute, activeAlternativeId]);

  const handleToggleViewMode = useCallback((mode: 'globe' | 'map') => {
    setViewMode(mode);
  }, []);

  const handleSelectRoute = useCallback((routeId: string) => {
    setActiveAlternativeId(routeId);
    if (plannedRoute) {
      const isPrimary = (routeId === 'primary');
      const selectedAlt = isPrimary ? null : (plannedRoute.alternatives || []).find(a => a.id === routeId);
      const wps = isPrimary ? (plannedRoute.waypoints || []) : (selectedAlt?.waypoints || []);
      setActiveWaypoints(wps);
      const prof = isPrimary ? (plannedRoute.profile || 'balanced') : (selectedAlt?.profile || 'balanced');
      setActiveProfile(prof);
      controller.setPlannedRoute(
        plannedRoute.path_coordinates,
        plannedRoute.waypoints,
        plannedRoute.alternatives || [],
        routeId,
        plannedRoute.profile || 'balanced'
      );
    }
  }, [plannedRoute, controller]);

  // Initialize data on mount and subscribe to connection transitions
  useEffect(() => {
    // 1. Subscribe to immediate connection-state transitions
    const unsubscribe = MarswalkApiClient.subscribe((connected) => {
      setIsBackendConnected(connected);
    });

    const initData = async () => {
      // Trigger health check in parallel with initial data retrieval
      MarswalkApiClient.checkHealth().catch(() => {});

      // Fetch layers, hazards, observations, terrain summary
      const [fetchedLayers, fetchedHazards, fetchedObservations, fetchedTerrain] = await Promise.all([
        MarswalkApiClient.getLayers(),
        MarswalkApiClient.getHazards(),
        MarswalkApiClient.getObservations(),
        MarswalkApiClient.getTerrain(),
      ]);

      setLayers(fetchedLayers);
      setHazards(fetchedHazards);
      setObservations(fetchedObservations);
      setTerrainSummary(fetchedTerrain);

      // Populate map layers
      controller.setHazards(fetchedHazards);
      controller.setObservations(fetchedObservations);
      controller.setMissionPins(startPoint, goalPoint);

      // Pre-compute initial route for immediate demonstration
      const startupReqId = ++routeRequestIdRef.current;
      try {
        const initialPlan = await MarswalkApiClient.planRoute({
          start: startPoint,
          goal: goalPoint,
          profile: 'balanced',
          max_slope_deg: 15.0,
          avoid_sand_dunes: true,
        });
        if (startupReqId !== routeRequestIdRef.current) {
          return; // Discard stale startup response if newer request launched
        }
        setPlannedRoute(initialPlan);
        setActiveWaypoints(initialPlan.waypoints || []);
        setActiveAlternativeId('primary');
        setActiveProfile(initialPlan.profile || 'balanced');
        controller.setPlannedRoute(
          initialPlan.path_coordinates,
          initialPlan.waypoints,
          initialPlan.alternatives,
          'primary',
          initialPlan.profile || 'balanced'
        );
      } catch (err) {
        if (startupReqId === routeRequestIdRef.current) {
          console.error('Failed to pre-compute initial route:', err);
        }
      }
    };

    initData();

    // Periodic backend health ping (every 10s)
    const interval = setInterval(async () => {
      await MarswalkApiClient.checkHealth();
    }, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [controller]);

  const clearPlannedRoute = useCallback(() => {
    routeRequestIdRef.current++;
    setPlannedRoute(null);
    setActiveWaypoints([]);
    setActiveAlternativeId('primary');
    controller.setPlannedRoute([], [], [], 'primary', 'balanced');
  }, [controller]);

  // Handle setting start / goal from map click
  const handleSelectCoordinate = useCallback((type: 'start' | 'goal', lat: number, lon: number, name?: string) => {
    clearPlannedRoute();
    if (type === 'start') {
      const newPt = { lat, lon, name: name || `Custom Site (${lat}°, ${lon}°)` };
      setStartPoint(newPt);
      controller.setMissionPins(newPt, goalPoint);
    } else {
      const newPt = { lat, lon, name: name || `Target Site (${lat}°, ${lon}°)` };
      setGoalPoint(newPt);
      controller.setMissionPins(startPoint, newPt);
    }
  }, [controller, goalPoint, startPoint, clearPlannedRoute]);

  const handleSetStartPoint = useCallback((pt: { lat: number; lon: number; name?: string } | ((prev: { lat: number; lon: number; name?: string }) => { lat: number; lon: number; name?: string })) => {
    clearPlannedRoute();
    setStartPoint(pt);
  }, [clearPlannedRoute]);

  const handleSetGoalPoint = useCallback((pt: { lat: number; lon: number; name?: string } | ((prev: { lat: number; lon: number; name?: string }) => { lat: number; lon: number; name?: string })) => {
    clearPlannedRoute();
    setGoalPoint(pt);
  }, [clearPlannedRoute]);

  const handleToggleLayer = (layerId: string) => {
    setLayers(prev =>
      prev.map(l => (l.id === layerId ? { ...l, visible: !l.visible } : l))
    );
  };

  const handleUpdateOpacity = (layerId: string, opacity: number) => {
    setLayers(prev =>
      prev.map(l => (l.id === layerId ? { ...l, opacity } : l))
    );
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-space-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Header */}
      <Header
        isBackendConnected={isBackendConnected}
        onResetView={() => {
          controller.resetToJezero();
          window.dispatchEvent(new CustomEvent('marswalk:focus-jezero'));
        }}
        onOpenReport={() => setIsReportOpen(true)}
        onToggleLayers={() => setActiveTab('layers')}
        showLayers={activeTab === 'layers'}
        viewMode={viewMode}
        onToggleViewMode={handleToggleViewMode}
      />

      {/* Main Workspace: Map Canvas + Sidebar */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Interactive Mars Planet Globe & Surface Map Canvas */}
        <main className="flex-1 relative h-full">
          {/* 3D Real Spherical Mars Globe */}
          <div className={`w-full h-full ${viewMode === 'globe' ? 'block' : 'hidden'}`}>
            <MarsGlobe
              startPoint={startPoint}
              goalPoint={goalPoint}
              onSelectCoordinate={handleSelectCoordinate}
              selectionMode={selectionMode}
              setSelectionMode={setSelectionMode}
              plannedRoute={plannedRoute}
              activeAlternativeId={activeAlternativeId}
              onSelectRoute={handleSelectRoute}
              hazards={hazards}
              observations={observations}
              selectedFeature={selectedFeature}
              setSelectedFeature={setSelectedFeature}
              viewMode={viewMode}
              onToggleViewMode={handleToggleViewMode}
            />
          </div>

          {/* 2D Jezero Surface Map */}
          <div className={`w-full h-full ${viewMode === 'map' ? 'block' : 'hidden'}`}>
            <MarsMap
              controller={controller}
              selectionMode={selectionMode}
              setSelectionMode={setSelectionMode}
              onSelectCoordinate={handleSelectCoordinate}
              selectedFeature={selectedFeature}
              setSelectedFeature={setSelectedFeature}
              onSelectRoute={handleSelectRoute}
              viewMode={viewMode}
              onToggleViewMode={handleToggleViewMode}
            />
          </div>

          {/* Collapsible Elevation Profile Overlay (Bottom of Map) */}
          {plannedRoute && (
            <div className="absolute bottom-16 right-4 z-20 max-w-lg w-full transition-all">
              {showElevationProfile ? (
                <div className="relative shadow-2xl rounded-xl">
                  <ElevationProfileChart
                    waypoints={activeWaypoints.length > 0 ? activeWaypoints : (plannedRoute.waypoints || [])}
                    profile={activeProfile}
                    onHoverWaypoint={wp => {
                      if (wp) {
                        setSelectedFeature({
                          type: 'waypoint',
                          data: wp,
                        });
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowElevationProfile(false)}
                    className="absolute top-2 right-2 text-slate-400 hover:text-white p-1 rounded bg-space-850/80 hover:bg-space-700 cursor-pointer"
                    title="Collapse Elevation Profile"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowElevationProfile(true)}
                  className="px-3 py-1.5 rounded-lg bg-space-900/90 hover:bg-space-850 backdrop-blur-md border border-space-700 text-xs font-mono text-telemetry-cyan flex items-center space-x-1.5 shadow-xl ml-auto cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5 text-telemetry-cyan" />
                  <span>Show Elevation Profile</span>
                </button>
              )}
            </div>
          )}
        </main>

        {/* Sidebar Toggle Button */}
        <button
          type="button"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`absolute top-4 z-30 p-1.5 rounded-l-lg bg-space-850 border-l border-y border-space-700 text-slate-400 hover:text-white shadow-xl transition-all cursor-pointer ${
            isSidebarOpen ? 'right-0 sm:right-96' : 'right-0'
          }`}
          title={isSidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
        >
          {isSidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* Right Sidebar Control Deck */}
        <aside
          className={`h-full bg-space-900 border-l border-space-750 flex flex-col z-20 shadow-2xl transition-all duration-300 overflow-hidden ${
            isSidebarOpen
              ? 'w-full sm:w-96 max-w-full translate-x-0'
              : 'w-0 max-w-0 translate-x-full border-l-0 pointer-events-none'
          }`}
        >
          {/* Navigation Tabs */}
          <div className="flex border-b border-space-750 bg-space-850/60 p-1 space-x-1 select-none">
            <button
              type="button"
              onClick={() => setActiveTab('route')}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'route'
                  ? 'bg-space-750 text-white border border-mars-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Navigation className="w-3.5 h-3.5 text-mars-400" />
              <span>Route</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('layers')}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'layers'
                  ? 'bg-space-750 text-white border border-telemetry-cyan/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-telemetry-cyan" />
              <span>Layers</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('hazards')}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'hazards'
                  ? 'bg-space-750 text-white border border-rose-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>Hazards</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('science')}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'science'
                  ? 'bg-space-750 text-white border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Microscope className="w-3.5 h-3.5 text-cyan-400" />
              <span>PDS</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('environment')}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'environment'
                  ? 'bg-space-750 text-white border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Thermometer className="w-3.5 h-3.5 text-amber-400" />
              <span>MEDA</span>
            </button>
          </div>

          {/* Active Panel Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'route' && (
              <RoutePlannerPanel
                controller={controller}
                startPoint={startPoint}
                setStartPoint={handleSetStartPoint}
                goalPoint={goalPoint}
                setGoalPoint={handleSetGoalPoint}
                plannedRoute={plannedRoute}
                setPlannedRoute={route => {
                  routeRequestIdRef.current++;
                  setPlannedRoute(route);
                  if (route?.waypoints) {
                    setActiveWaypoints(route.waypoints);
                  }
                  if (route?.profile) {
                    setActiveProfile(route.profile);
                  }
                  setActiveAlternativeId('primary');
                }}
                onSelectWaypoint={wp => {
                  setSelectedFeature({
                    type: 'waypoint',
                    data: wp,
                  });
                }}
                terrainSummary={terrainSummary}
                onActiveWaypointsChange={setActiveWaypoints}
                onOpenReport={() => setIsReportOpen(true)}
                activeAlternativeId={activeAlternativeId}
                setActiveAlternativeId={setActiveAlternativeId}
                onActiveProfileChange={setActiveProfile}
              />
            )}

            {activeTab === 'layers' && (
              <LayerControlPanel
                layers={layers}
                controller={controller}
                onToggleLayer={handleToggleLayer}
                onUpdateOpacity={handleUpdateOpacity}
              />
            )}

            {activeTab === 'hazards' && (
              <HazardTelemetryPanel
                hazards={hazards}
                controller={controller}
                onSelectHazard={haz => {
                  setSelectedFeature({
                    type: 'hazard',
                    data: haz,
                  });
                }}
              />
            )}

            {activeTab === 'science' && (
              <ScienceObservationsPanel
                observations={observations}
                controller={controller}
                onSelectObservation={obs => {
                  setSelectedFeature({
                    type: 'observation',
                    data: obs,
                  });
                }}
              />
            )}

            {activeTab === 'environment' && (
              <EnvironmentalIntelligencePanel />
            )}
          </div>
        </aside>
      </div>

      {/* Printable / Exportable Mission Planning Report Modal */}
      <MissionReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        plannedRoute={activeReportRoute}
        observations={observations}
        hazards={hazards}
        startPoint={startPoint}
        goalPoint={goalPoint}
      />
    </div>
  );
};
export default App;
