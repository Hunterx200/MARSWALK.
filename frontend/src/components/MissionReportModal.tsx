import React, { useState } from 'react';
import { RoutePlanResponse, Observation, HazardZone, SaveMissionResponse } from '../types/api';
import { MarswalkApiClient } from '../services/apiClient';
import {
  X,
  Download,
  Printer,
  FileText,
  ShieldAlert,
  Compass,
  AlertTriangle,
  Microscope,
  Save,
  CheckCircle
} from 'lucide-react';

interface MissionReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  plannedRoute: RoutePlanResponse | null;
  observations: Observation[];
  hazards: HazardZone[];
  startPoint: { lat: number; lon: number; name?: string };
  goalPoint: { lat: number; lon: number; name?: string };
}

export const MissionReportModal: React.FC<MissionReportModalProps> = ({
  isOpen,
  onClose,
  plannedRoute,
  observations = [],
  hazards = [],
  startPoint,
  goalPoint,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [savedMission, setSavedMission] = useState<SaveMissionResponse | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!isOpen) return null;

  const safeWaypoints = plannedRoute?.waypoints || [];
  const safeObs = Array.isArray(observations) ? observations : [];
  const safeHaz = Array.isArray(hazards) ? hazards : [];

  const handleSaveToBackend = async () => {
    if (!plannedRoute) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const res = await MarswalkApiClient.saveMission({
        region_id: 'jezero_crater',
        name: `Jezero Traverse (${(plannedRoute.profile || 'balanced').toUpperCase()})`,
        route_id: plannedRoute.route_id,
        notes: `Operational report generated with ${safeWaypoints.length} nodes and ${safeObs.length} science targets.`,
      });
      setSavedMission(res);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save mission to backend.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportJSON = () => {
    const reportData = {
      project: 'MARSWALK — Intelligent Mars Exploration & Mission Planning System',
      mission_id: savedMission?.id || plannedRoute?.route_id || `marswalk_jezero_${Date.now()}`,
      backend_status: savedMission?.status || 'draft',
      generated_at: new Date().toISOString(),
      target_region: {
        name: 'Jezero Crater, Mars',
        center: { lat: 18.4447, lon: 77.4508 },
        landing_site: 'Octavia E. Butler Landing (Sol 0)',
        elevation_range_m: { min: -2719, max: -1537, datum: 'Mars MOLA Geoid (areoid)' }
      },
      trajectory: {
        start: startPoint,
        goal: goalPoint,
        profile: plannedRoute?.profile || 'balanced',
        summary: plannedRoute?.summary,
        waypoints: safeWaypoints,
      },
      hazards_mitigated: safeHaz,
      science_observations: safeObs,
      report_sections: savedMission?.report?.sections || [
        {
          title: 'Route overview',
          content: `Mission planned in primary exploration sector jezero_crater. Ground distance: ${plannedRoute?.summary?.total_distance_m || 0}m.`
        },
        {
          title: 'Terrain and hazards',
          content: `Peak slope: ${plannedRoute?.summary?.max_slope_deg || 0}°, Average slope: ${plannedRoute?.summary?.avg_slope_deg || 0}°. Risk score: ${plannedRoute?.summary?.overall_risk_score || 0}/100.`
        },
        {
          title: 'Scientific context',
          content: `Intersects ${safeObs.length} high-priority scientific targets within Jezero Crater.`
        },
        {
          title: 'Limitations',
          content: 'MARSWALK is a mission-planning prototype. Not certified for flight operations or autonomous rover navigation.'
        }
      ],
      data_provenance: plannedRoute?.provenance,
      disclaimer: 'This mission plan is a research prototype generated with A* pathfinding over NASA MGS MOLA digital terrain models. Not certified for flight operations or autonomous rover navigation.'
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MARSWALK_MISSION_REPORT_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  // Automated report sections (from backend if saved, or generated synthesis)
  const reportSections = savedMission?.report?.sections || [
    {
      title: '1. Route Overview & Trajectory Profile',
      content: `Mission planned in primary exploration sector Jezero Crater (77.0°E - 77.8°E, 18.2°N - 18.7°N). Selected ${(plannedRoute?.profile || 'balanced').toUpperCase()} profile outlines a nominal traverse with total ground distance of ${((plannedRoute?.summary?.total_distance_m || 0) / 1000).toFixed(2)} km across ${safeWaypoints.length} navigational nodes.`
    },
    {
      title: '2. Terrain & Topographic Hazard Assessment',
      content: `Traverse encounters an average gradient of ${plannedRoute?.summary?.avg_slope_deg || 0}° with peak local slopes of ${plannedRoute?.summary?.max_slope_deg || 0}°. Derived composite hazard score averages ${plannedRoute?.summary?.overall_risk_score || 0}/100 (${plannedRoute?.summary?.risk_category || 'NOMINAL'} risk). Slopes remain within the rover's static stability limit (30°), but active wheel slip monitoring is advised across Séítah dune corridors.`
    },
    {
      title: '3. Scientific Context & PDS Waypoint Intersections',
      content: `The planned traverse intersects ${safeObs.length} high-priority scientific investigation targets within Jezero Crater, including ancient Noachian/Hesperian lacustrine delta deposits, crater rim boulder fields, and titanium sample depot locations.`
    },
    {
      title: '4. Engineering Provenance & Operational Limitations',
      content: 'MARSWALK is a mission-planning and research prototype. It is NOT an operational rover-navigation or flight-certified system. Topography is derived from NASA MGS MOLA MEGDR elevation models; micro-relief hazards (<1m) and loose sand dune softness must be verified through tactical rover camera imagery before drive execution.'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none animate-in fade-in">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-space-900 border border-space-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 bg-space-850 border-b border-space-750 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-mars-600/20 border border-mars-500/40 text-mars-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono tracking-wider">
                MARSWALK MISSION PLANNING REPORT
              </h2>
              <p className="text-xs text-slate-400">
                Jezero Crater Surface Trajectory Assessment &bull; Document Ref: MW-JZ-2026-MVP
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Save Mission button */}
            <button
              type="button"
              onClick={handleSaveToBackend}
              disabled={isSaving || !plannedRoute}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 border transition-all cursor-pointer ${
                savedMission
                  ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                  : 'bg-space-750 hover:bg-space-700 text-slate-200 hover:text-white border-space-650'
              }`}
            >
              {isSaving ? (
                <span>Saving...</span>
              ) : savedMission ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Saved: {savedMission.id}</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Save Mission</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportJSON}
              className="px-3 py-1.5 rounded-lg bg-space-750 hover:bg-space-700 text-xs font-mono font-medium flex items-center space-x-1.5 border border-space-650 transition-all text-slate-200 hover:text-white cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-telemetry-cyan" />
              <span>Export JSON</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-space-750 hover:bg-space-700 text-xs font-mono font-medium flex items-center space-x-1.5 border border-space-650 transition-all text-slate-200 hover:text-white cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-300" />
              <span>Print Brief</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-space-750 transition-all ml-2 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 font-mono text-xs">
          {saveError && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300">
              {saveError}
            </div>
          )}

          {/* Mission Metadata Banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-space-850 border border-space-750">
              <span className="text-[10px] text-slate-500 uppercase">Target Basin</span>
              <div className="text-sm font-bold text-white mt-0.5">Jezero Crater</div>
              <div className="text-[10px] text-slate-400">18.44°N, 77.45°E</div>
            </div>

            <div className="p-3 rounded-lg bg-space-850 border border-space-750">
              <span className="text-[10px] text-slate-500 uppercase">Calculation Mode</span>
              <div className={`text-sm font-bold mt-0.5 ${plannedRoute?.isLiveBackend ? 'text-emerald-400' : 'text-amber-400'}`}>
                {plannedRoute?.isLiveBackend ? 'LIVE BACKEND API' : 'DEMO SIMULATION'}
              </div>
              <div className="text-[10px] text-slate-400">
                {plannedRoute?.isLiveBackend ? 'FastAPI A* Engine' : 'Offline Prototype Grid'}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-space-850 border border-space-750">
              <span className="text-[10px] text-slate-500 uppercase">Total Traverse</span>
              <div className="text-sm font-bold text-telemetry-cyan mt-0.5">
                {plannedRoute ? `${((plannedRoute.summary?.total_distance_m || 0) / 1000).toFixed(2)} km` : 'N/A'}
              </div>
              <div className="text-[10px] text-slate-400">
                {plannedRoute ? `${plannedRoute.summary?.estimated_duration_sols || 0} sols est.` : ''}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-space-850 border border-space-750">
              <span className="text-[10px] text-slate-500 uppercase">Risk Evaluation</span>
              <div className={`text-sm font-bold mt-0.5 ${
                plannedRoute?.summary?.risk_category === 'HIGH' ? 'text-rose-400' : 'text-emerald-400'
              }`}>
                {plannedRoute ? `${plannedRoute.summary?.risk_category || 'NOMINAL'} (${plannedRoute.summary?.overall_risk_score || 0}/100)` : 'N/A'}
              </div>
              <div className="text-[10px] text-slate-400">Peak slope {plannedRoute?.summary?.max_slope_deg || 0}°</div>
            </div>
          </div>

          {/* Automated Multi-Section Mission Synthesis */}
          <div className="p-4 rounded-xl bg-space-850 border border-space-750 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center justify-between">
              <span className="flex items-center">
                <FileText className="w-4 h-4 text-telemetry-cyan mr-2" />
                Synthesized Mission Brief ({reportSections.length} Sections)
              </span>
              {savedMission && (
                <span className="text-[10px] text-emerald-400 font-normal">
                  ID: {savedMission.id} &bull; Status: {savedMission.status}
                </span>
              )}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {reportSections.map((sec, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-space-900 border border-space-750 space-y-1">
                  <h4 className="font-bold text-slate-200 text-xs text-mars-300">
                    {sec.title}
                  </h4>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {sec.content}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Traverse Parameters & Waypoint Log */}
          <div className="p-4 rounded-xl bg-space-850 border border-space-750 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center">
              <Compass className="w-4 h-4 text-mars-400 mr-2" />
              Traverse Nodes &amp; Waypoint Log ({safeWaypoints.length} Nodes)
            </h3>

            {safeWaypoints.length > 0 ? (
              <div className="overflow-x-auto max-h-56">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-space-850">
                    <tr className="border-b border-space-700 text-slate-500 text-[10px]">
                      <th className="py-2 px-2">WP#</th>
                      <th className="py-2 px-2">Coordinates</th>
                      <th className="py-2 px-2">Elevation</th>
                      <th className="py-2 px-2">Slope</th>
                      <th className="py-2 px-2">Distance</th>
                      <th className="py-2 px-2">Sol</th>
                      <th className="py-2 px-2">Risk</th>
                      <th className="py-2 px-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-space-800">
                    {safeWaypoints.map(wp => (
                      <tr key={wp.index} className="hover:bg-space-800/50">
                        <td className="py-1.5 px-2 font-bold text-slate-300">{wp.index}</td>
                        <td className="py-1.5 px-2 text-slate-300">{wp.lat.toFixed(4)}°N, {wp.lon.toFixed(4)}°E</td>
                        <td className="py-1.5 px-2 text-slate-400">{wp.elevation_m}m</td>
                        <td className={`py-1.5 px-2 font-bold ${wp.slope_deg > 12 ? 'text-rose-400' : wp.slope_deg > 7 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {wp.slope_deg}°
                        </td>
                        <td className="py-1.5 px-2 text-slate-400">{wp.cumulative_distance_m}m</td>
                        <td className="py-1.5 px-2 text-telemetry-cyan font-bold">{wp.estimated_sol}</td>
                        <td className="py-1.5 px-2">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            wp.risk_level === 'HIGH' ? 'bg-rose-950 text-rose-400' : wp.risk_level === 'MEDIUM' ? 'bg-amber-950 text-amber-400' : 'bg-emerald-950 text-emerald-400'
                          }`}>
                            {wp.risk_level}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-slate-400 italic">{wp.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-500">No active route computed. Plan a route in the Route Planner panel.</p>
            )}
          </div>

          {/* Scientific Targets & Hazard Mitigations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Science Targets */}
            <div className="p-4 rounded-xl bg-space-850 border border-space-750 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center">
                <Microscope className="w-4 h-4 text-telemetry-cyan mr-2" />
                NASA PDS Science Targets ({safeObs.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {safeObs.slice(0, 5).map(obs => (
                  <div key={obs.id} className="p-2 rounded bg-space-900 border border-space-800 text-[11px]">
                    <div className="flex justify-between font-bold text-slate-200">
                      <span>{obs.target_name}</span>
                      <span className="text-telemetry-cyan">SOL {obs.sol}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{obs.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Hazard Mitigations */}
            <div className="p-4 rounded-xl bg-space-850 border border-space-750 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center">
                <ShieldAlert className="w-4 h-4 text-rose-400 mr-2" />
                Regional Hazard Buffers ({safeHaz.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {safeHaz.map(haz => (
                  <div key={haz.id} className="p-2 rounded bg-space-900 border border-space-800 text-[11px]">
                    <div className="flex justify-between font-bold text-slate-200">
                      <span>{haz.name}</span>
                      <span className="text-rose-400">{haz.severity}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{haz.mitigation_protocol}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Dataset Provenance & Engineering Limitations */}
          <div className="p-4 rounded-xl bg-space-950 border border-space-800 space-y-2 text-[11px] text-slate-400">
            <h4 className="font-bold text-slate-300 text-xs uppercase tracking-wider flex items-center text-amber-400">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Verified NASA Provenance &amp; System Limitations
            </h4>
            <ul className="list-disc list-inside space-y-1 text-slate-400 leading-relaxed">
              <li>Basemap imagery served live from NASA Solar System Treks WMTS (Viking MDIM2.1 Global Color Mosaic, 232m/pixel).</li>
              <li>Regional topography derived from verified NASA Mars Global Surveyor MOLA MEGDR elevation models (463m/pixel, shape 65x103).</li>
              <li>Hazard boundaries, slope maps, and risk scores are project-generated models produced for this mission planning prototype.</li>
              <li>Satellite and orbital imagery cannot resolve sub-meter rocks, loose regolith softness, or micro-dune slips.</li>
              <li><strong className="text-slate-300">DISCLAIMER:</strong> This prototype is built for research and mission planning. Generated trajectories are NOT guaranteed safe and are not certified for operational rover navigation.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-space-850 border-t border-space-750 flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>MARSWALK MVP &bull; Jezero Crater Mission Control</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-space-750 hover:bg-space-700 text-white font-medium transition-all cursor-pointer"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};
