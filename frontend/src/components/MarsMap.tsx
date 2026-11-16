import React, { useEffect, useRef, useState } from 'react';
import { MarsMapController, JEZERO_CENTER, getRouteProfileColor } from '../services/mapManager';
import { 
  Crosshair, 
  MapPin, 
  Flag, 
  Target, 
  ShieldAlert, 
  Microscope, 
  Navigation,
  Globe2,
  Map as MapIcon,
  X,
  Compass,
  Radio,
  RotateCcw,
  ZoomIn,
  ZoomOut
} from 'lucide-react';

interface MarsMapProps {
  controller: MarsMapController;
  onSelectCoordinate?: (type: 'start' | 'goal', lat: number, lon: number, name?: string) => void;
  selectionMode: 'inspect' | 'start' | 'goal';
  setSelectionMode: (mode: 'inspect' | 'start' | 'goal') => void;
  selectedFeature: any | null;
  setSelectedFeature: (feature: any | null) => void;
  onSelectRoute?: (routeId: string) => void;
  viewMode?: 'globe' | 'map';
  onToggleViewMode?: (mode: 'globe' | 'map') => void;
}

export const MarsMap: React.FC<MarsMapProps> = ({
  controller,
  onSelectCoordinate,
  selectionMode,
  setSelectionMode,
  selectedFeature,
  setSelectedFeature,
  onSelectRoute,
  viewMode = 'map',
  onToggleViewMode,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState<{ lat: number; lon: number } | null>({
    lat: JEZERO_CENTER[1],
    lon: JEZERO_CENTER[0],
  });
  const [zoomLevel, setZoomLevel] = useState<number>(11.5);

  // Store callbacks and interactive modes in refs to avoid recreating map listeners
  const selectionModeRef = useRef(selectionMode);
  selectionModeRef.current = selectionMode;

  const onSelectCoordinateRef = useRef(onSelectCoordinate);
  onSelectCoordinateRef.current = onSelectCoordinate;

  const setSelectionModeRef = useRef(setSelectionMode);
  setSelectionModeRef.current = setSelectionMode;

  const onSelectRouteRef = useRef(onSelectRoute);
  onSelectRouteRef.current = onSelectRoute;

  const setSelectedFeatureRef = useRef(setSelectedFeature);
  setSelectedFeatureRef.current = setSelectedFeature;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    let attachedMap: any = null;

    // Track cursor coordinates
    const pointerMoveHandler = (evt: any) => {
      const coords = evt.coordinate;
      if (coords && coords.length >= 2) {
        setCursorPos({
          lon: parseFloat(coords[0].toFixed(5)),
          lat: parseFloat(coords[1].toFixed(5)),
        });
      }
    };

    // Track zoom level changes
    const moveEndHandler = () => {
      if (!attachedMap) return;
      const view = attachedMap.getView();
      setZoomLevel(parseFloat((view.getZoom() || 11.5).toFixed(1)));
    };

    // Click handler using refs for dynamic state/callbacks
    const clickHandler = (evt: any) => {
      if (!attachedMap) return;
      const coords = evt.coordinate;
      if (!coords) return;

      const clickLon = parseFloat(coords[0].toFixed(5));
      const clickLat = parseFloat(coords[1].toFixed(5));

      if (selectionModeRef.current === 'start') {
        onSelectCoordinateRef.current?.('start', clickLat, clickLon, `Custom Site (${clickLat}°, ${clickLon}°)`);
        setSelectionModeRef.current?.('inspect');
        return;
      }

      if (selectionModeRef.current === 'goal') {
        onSelectCoordinateRef.current?.('goal', clickLat, clickLon, `Target Site (${clickLat}°, ${clickLon}°)`);
        setSelectionModeRef.current?.('inspect');
        return;
      }

      let clickedFeature: any = null;
      attachedMap.forEachFeatureAtPixel(evt.pixel, (feature: any) => {
        if (!clickedFeature && feature.get('type')) {
          clickedFeature = feature;
        }
      });

      if (clickedFeature) {
        const featureType = clickedFeature.get('type');
        const routeId = clickedFeature.get('routeId');

        if (featureType === 'route_path' && routeId && onSelectRouteRef.current) {
          onSelectRouteRef.current(routeId);
        }

        setSelectedFeatureRef.current?.({
          type: featureType,
          name: clickedFeature.get('name'),
          data: clickedFeature.get('data') || {
            routeId: routeId,
            profile: clickedFeature.get('profile'),
            isSelected: clickedFeature.get('isSelected'),
          },
        });
      } else {
        setSelectedFeatureRef.current?.(null);
      }
    };

    const attachEvents = (map: any) => {
      map.on('pointermove', pointerMoveHandler);
      map.on('moveend', moveEndHandler);
      map.on('click', clickHandler);
    };

    const detachEvents = (map: any) => {
      map.un('pointermove', pointerMoveHandler);
      map.un('moveend', moveEndHandler);
      map.un('click', clickHandler);
    };

    const initOrUpdateMap = () => {
      if (!attachedMap) {
        // First initialization against valid non-zero container in this lifecycle
        attachedMap = controller.initMap(container);
        attachEvents(attachedMap);
      } else {
        // Stable reuse of existing map instance
        attachedMap = controller.initMap(container);
        attachedMap.updateSize();
      }
    };

    // ResizeObserver watches container visibility and size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          initOrUpdateMap();
        }
      }
    });

    resizeObserver.observe(container);

    // Initial check if container is already visible on mount
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      initOrUpdateMap();
    }

    return () => {
      resizeObserver.disconnect();
      if (attachedMap) {
        detachEvents(attachedMap);
        attachedMap = null;
      }
      controller.detachMap();
    };
  }, [controller]);

  // Compute estimated elevation in Jezero basin for HUD
  const estimateElevation = (lat: number, lon: number): number => {
    // Jezero basin floor slopes generally downwards towards delta center (-2540m to -2580m)
    const dCenter = Math.hypot(lat - 18.44, lon - 77.45);
    return Math.round(-2535 - dCenter * 200);
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden hud-bracket"
      style={{
        background: 'radial-gradient(ellipse at 50% 50%, #471b10 0%, #2b1109 55%, #130604 100%)',
      }}
    >
      {/* OpenLayers Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Center Targeting Reticle (Subtle Tactical Sci-Fi HUD) */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
        <div className="relative w-8 h-8 opacity-25">
          <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-telemetry-cyan" />
          <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-telemetry-cyan" />
          <div className="absolute inset-0 border border-telemetry-cyan/60 rounded-full" />
        </div>
      </div>

      {/* Map Interactive Mode Pills (Top Left) */}
      <div className="absolute top-4 left-4 z-20 flex items-center space-x-1.5 p-1 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700/80 shadow-xl font-mono text-xs">
        {onToggleViewMode && (
          <>
            <button
              type="button"
              onClick={() => onToggleViewMode('globe')}
              className={`px-2.5 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer ${
                viewMode === 'globe'
                  ? 'bg-mars-600 text-white font-semibold shadow-md shadow-mars-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Switch to 3D Spherical Mars Planetary View"
            >
              <Globe2 className="w-3.5 h-3.5 text-mars-300" />
              <span>3D Globe</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleViewMode('map')}
              className={`px-2.5 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer ${
                viewMode === 'map'
                  ? 'bg-space-750 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Switch to 2D High-Resolution Jezero Surface Map"
            >
              <MapIcon className="w-3.5 h-3.5 text-telemetry-cyan" />
              <span>2D Map</span>
            </button>

            <div className="w-[1px] h-4 bg-space-700 mx-1" />
          </>
        )}

        <button
          onClick={() => setSelectionMode('inspect')}
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
            selectionMode === 'inspect'
              ? 'bg-space-750 text-white shadow-sm border border-space-600'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          title="Inspect map features, hazards, and waypoints"
        >
          <Crosshair className="w-3.5 h-3.5 text-telemetry-cyan" />
          <span>Inspect</span>
        </button>

        <button
          onClick={() => setSelectionMode('start')}
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
            selectionMode === 'start'
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/60 shadow-sm'
              : 'text-slate-400 hover:text-emerald-400'
          }`}
          title="Click on the map to set Rover Start Point"
        >
          <Flag className="w-3.5 h-3.5 text-emerald-400" />
          <span>Set Start</span>
        </button>

        <button
          onClick={() => setSelectionMode('goal')}
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
            selectionMode === 'goal'
              ? 'bg-amber-950/80 text-amber-300 border border-amber-500/60 shadow-sm'
              : 'text-slate-400 hover:text-amber-400'
          }`}
          title="Click on the map to set Scientific Target Goal"
        >
          <Target className="w-3.5 h-3.5 text-amber-400" />
          <span>Set Goal</span>
        </button>
      </div>

      {/* Top Right Quick Controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center space-x-1.5 p-1 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700/80 shadow-xl font-mono text-xs">
        <button
          type="button"
          onClick={() => controller.resetToJezero()}
          className="px-2.5 py-1.5 rounded-md flex items-center space-x-1.5 text-slate-300 hover:text-telemetry-cyan hover:bg-space-800 transition-all cursor-pointer"
          title="Reset View to Jezero Crater Center"
        >
          <RotateCcw className="w-3.5 h-3.5 text-telemetry-cyan" />
          <span className="hidden sm:inline">Jezero Focus</span>
        </button>
        <div className="w-[1px] h-4 bg-space-700" />
        <button
          type="button"
          onClick={() => {
            const v = controller.map?.getView();
            if (v) v.animate({ zoom: (v.getZoom() || 11.5) + 1, duration: 250 });
          }}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-space-800 transition-all cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            const v = controller.map?.getView();
            if (v) v.animate({ zoom: (v.getZoom() || 11.5) - 1, duration: 250 });
          }}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-space-800 transition-all cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Selection Mode Notice Banner (When in Set Start / Set Goal mode) */}
      {selectionMode !== 'inspect' && (
        <div className="absolute top-16 left-4 z-20 px-3 py-1.5 rounded-md bg-space-900/95 border border-telemetry-cyan/60 text-xs text-telemetry-cyan font-mono shadow-lg flex items-center space-x-2 animate-pulse-subtle">
          <MapPin className="w-4 h-4 text-telemetry-cyan" />
          <span>Click anywhere on Jezero map to position {selectionMode.toUpperCase()} point...</span>
          <button 
            onClick={() => setSelectionMode('inspect')}
            className="ml-2 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Live Coordinate HUD & Telemetry Bar (Bottom Left) */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center space-x-3 px-3 py-2 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700/80 text-xs font-mono shadow-xl text-slate-300 select-none">
        <div className="flex items-center space-x-1.5 text-telemetry-cyan">
          <Radio className="w-3.5 h-3.5 animate-pulse text-telemetry-cyan" />
          <span className="text-[10px] tracking-wider font-semibold text-cyan-300 hidden xl:inline">RADAR ACTIVE</span>
        </div>
        <span className="text-slate-600 hidden xl:inline">|</span>
        <div className="flex items-center space-x-1">
          <span className="text-slate-500">LAT:</span>
          <span className="text-mars-300 font-bold">
            {cursorPos ? `${cursorPos.lat.toFixed(4)}°N` : '18.4447°N'}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <span className="text-slate-500">LON:</span>
          <span className="text-mars-300 font-bold">
            {cursorPos ? `${cursorPos.lon.toFixed(4)}°E` : '77.4508°E'}
          </span>
        </div>

        <div className="hidden sm:flex items-center space-x-1 text-telemetry-cyan">
          <span className="text-slate-500">ELEV:</span>
          <span>{cursorPos ? `${estimateElevation(cursorPos.lat, cursorPos.lon)}m` : '-2530m'}</span>
        </div>

        <div className="hidden md:flex items-center space-x-1 text-slate-400">
          <span className="text-slate-500">ZOOM:</span>
          <span>{zoomLevel}x</span>
        </div>
      </div>

      {/* Mars Mission Legend & NASA Data Badge (Bottom Center) */}
      <div className="hidden lg:flex absolute bottom-4 left-1/2 -translate-x-1/2 z-20 items-center space-x-3 px-3.5 py-1.5 rounded-full bg-space-900/90 backdrop-blur-md border border-space-700/80 text-[11px] font-mono shadow-2xl text-slate-300 select-none">
        {/* Route Profile Indicators */}
        <div className="flex items-center space-x-1.5 text-cyan-300">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
          <span className="font-semibold">Balanced</span>
        </div>

        <div className="flex items-center space-x-1.5 text-amber-300">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
          <span className="font-semibold">Fastest</span>
        </div>

        <div className="flex items-center space-x-1.5 text-emerald-300">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <span className="font-semibold">Safest</span>
        </div>

        <span className="text-slate-600">|</span>

        {/* NASA Imagery Provenance */}
        <div className="flex items-center space-x-1.5 text-slate-400">
          <span className="text-mars-400">NASA Viking MDIM2.1 Color (True Mars)</span>
        </div>
      </div>

      {/* Planetary True North & Geodetic Reference (Bottom Right) */}
      <div className="hidden sm:flex absolute bottom-4 right-4 z-20 items-center space-x-2 px-3 py-1.5 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700/80 font-mono text-[11px] text-slate-300 shadow-xl select-none">
        <Compass className="w-3.5 h-3.5 text-telemetry-cyan" />
        <span className="text-slate-400">NORTH:</span>
        <span className="text-telemetry-cyan font-semibold">+90.0°</span>
        <span className="text-slate-600">|</span>
        <span className="text-slate-500 text-[10px]">MOLA AREOID</span>
      </div>

      {/* Feature Details Inspector Card (Floating Modal on Click) */}
      {selectedFeature && (
        <div className="absolute top-16 right-4 z-30 w-80 max-h-[80vh] overflow-y-auto rounded-xl bg-space-900/95 backdrop-blur-md border border-telemetry-cyan/40 p-4 shadow-2xl text-slate-200 animate-in fade-in zoom-in-95 hud-panel-accent hud-bracket">
          <div className="flex items-start justify-between pb-2 border-b border-space-750">
            <div className="flex items-center space-x-2">
              {selectedFeature.type === 'hazard' && <ShieldAlert className="w-4 h-4 text-rose-400" />}
              {selectedFeature.type === 'observation' && <Microscope className="w-4 h-4 text-telemetry-cyan" />}
              {selectedFeature.type === 'waypoint' && <MapPin className="w-4 h-4 text-amber-400" />}
              {selectedFeature.type === 'route_path' && <Navigation className="w-4 h-4 text-cyan-400" />}
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                {selectedFeature.type === 'route_path' ? 'ROUTE TRAVERSE' : selectedFeature.type}
              </span>
            </div>
            <button
              onClick={() => setSelectedFeature(null)}
              className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-space-750"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Route Path Details */}
          {selectedFeature.type === 'route_path' && (
            <div className="mt-3 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">{selectedFeature.name}</h4>
                {selectedFeature.data?.profile && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getRouteProfileColor(selectedFeature.data.profile).badgeClass}`}>
                    {selectedFeature.data.profile.toUpperCase()}
                  </span>
                )}
              </div>

              {selectedFeature.data && selectedFeature.data.distance_m && (
                <div className="p-2 rounded bg-space-850/80 border border-space-700 space-y-1 text-[11px]">
                  <div className="text-slate-400">Traverse Distance: <span className="text-white font-bold">{(selectedFeature.data.distance_m / 1000).toFixed(2)} km</span></div>
                  <div className="text-slate-400">Duration: <span className="text-telemetry-cyan font-bold">{selectedFeature.data.duration_sols} sols</span></div>
                  <div className="text-slate-400">Max / Avg Slope: <span className="text-amber-400 font-bold">{selectedFeature.data.max_slope_deg}° / {selectedFeature.data.avg_slope_deg}°</span></div>
                  <div className="text-slate-400">Hazard Risk: <span className="text-emerald-400 font-bold">{selectedFeature.data.risk_category} ({selectedFeature.data.risk_score}/100)</span></div>
                  {selectedFeature.data.energy_budget_kwh && (
                    <div className="text-slate-400">Energy Estimate: <span className="text-amber-300 font-bold">{selectedFeature.data.energy_budget_kwh} kWh</span></div>
                  )}
                </div>
              )}

              <p className="text-slate-400 text-[11px]">
                {selectedFeature.data?.isSelected
                  ? 'Currently active and highlighted mission route.'
                  : 'Alternative route. Click in Route Planner panel to switch active trajectory.'}
              </p>
            </div>
          )}

          {/* Hazard Details */}
          {selectedFeature.type === 'hazard' && selectedFeature.data && (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">{selectedFeature.data.name}</h4>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  selectedFeature.data.severity === 'CRITICAL'
                    ? 'bg-rose-950 text-rose-400 border border-rose-500/40'
                    : 'bg-amber-950 text-amber-400 border border-amber-500/40'
                }`}>
                  {selectedFeature.data.severity}
                </span>
              </div>

              <div className="p-2 rounded bg-space-850/80 border border-space-700 font-mono text-[11px] space-y-1">
                <div className="text-slate-400">Hazard Type: <span className="text-slate-200">{selectedFeature.data.type}</span></div>
                {selectedFeature.data.slope_deg && (
                  <div className="text-slate-400">Peak Slope: <span className="text-rose-400 font-bold">{selectedFeature.data.slope_deg}°</span></div>
                )}
                <div className="text-slate-400">Radius Buffer: <span className="text-slate-200">{selectedFeature.data.radius_m} meters</span></div>
              </div>

              <div>
                <span className="text-slate-400 font-semibold">Mobility Risk:</span>
                <p className="text-slate-300 mt-0.5">{selectedFeature.data.mobility_risk}</p>
              </div>

              <div>
                <span className="text-emerald-400 font-semibold">Mitigation Protocol:</span>
                <p className="text-slate-300 mt-0.5">{selectedFeature.data.mitigation_protocol}</p>
              </div>

              <div className="pt-2 border-t border-space-750 text-[10px] text-slate-500">
                Source: {selectedFeature.data.source_provenance}
              </div>
            </div>
          )}

          {/* Science Observation Details */}
          {selectedFeature.type === 'observation' && selectedFeature.data && (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">{selectedFeature.data.target_name}</h4>
                <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-500/40 text-[10px] font-mono font-bold">
                  SOL {selectedFeature.data.sol}
                </span>
              </div>

              <div className="p-2 rounded bg-space-850/80 border border-space-700 font-mono text-[11px] space-y-1">
                <div className="text-slate-400">Feature: <span className="text-slate-200">{selectedFeature.data.feature_type}</span></div>
                <div className="text-slate-400">Elevation: <span className="text-slate-200">{selectedFeature.data.elevation_m != null ? `${selectedFeature.data.elevation_m} m` : 'Unknown'}</span></div>
                {selectedFeature.data.sample_tube_id && (
                  <div className="text-slate-400">Sample Tube: <span className="text-emerald-400 font-bold">{selectedFeature.data.sample_tube_id}</span></div>
                )}
              </div>

              <div>
                <span className="text-slate-400 font-semibold">Science Instruments:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(selectedFeature.data.instruments || []).length > 0 ? (
                    (selectedFeature.data.instruments || []).map((inst: string) => (
                      <span key={inst} className="px-1.5 py-0.5 rounded bg-space-750 text-slate-300 text-[10px] font-mono border border-space-700">
                        {inst}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500 text-[10px] font-mono">None listed</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-semibold">Description:</span>
                <p className="text-slate-300 mt-0.5">{selectedFeature.data.description}</p>
              </div>

              <div className="pt-2 border-t border-space-750 text-[10px] text-slate-500">
                PDS Ref: {selectedFeature.data.nasa_pds_reference}
              </div>
            </div>
          )}

          {/* Waypoint Details */}
          {selectedFeature.type === 'waypoint' && selectedFeature.data && (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">Waypoint {selectedFeature.data.index}</h4>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  selectedFeature.data.risk_level === 'HIGH'
                    ? 'bg-rose-950 text-rose-400'
                    : selectedFeature.data.risk_level === 'MEDIUM'
                    ? 'bg-amber-950 text-amber-400'
                    : 'bg-emerald-950 text-emerald-400'
                }`}>
                  {selectedFeature.data.risk_level} RISK
                </span>
              </div>

              <div className="p-2 rounded bg-space-850/80 border border-space-700 font-mono text-[11px] space-y-1">
                <div className="text-slate-400">Coordinates: <span className="text-slate-200">{selectedFeature.data.lat}°N, {selectedFeature.data.lon}°E</span></div>
                <div className="text-slate-400">Elevation: <span className="text-slate-200">{selectedFeature.data.elevation_m} m</span></div>
                <div className="text-slate-400">Slope: <span className="text-amber-400 font-bold">{selectedFeature.data.slope_deg}°</span></div>
                <div className="text-slate-400">Distance from Start: <span className="text-slate-200">{selectedFeature.data.cumulative_distance_m} m</span></div>
                <div className="text-slate-400">Sol Traversal Est: <span className="text-telemetry-cyan font-bold">{selectedFeature.data.estimated_sol} sols</span></div>
              </div>

              {selectedFeature.data.notes && (
                <p className="text-slate-300 italic">{selectedFeature.data.notes}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
