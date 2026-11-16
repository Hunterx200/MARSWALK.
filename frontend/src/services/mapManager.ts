import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style';
import TileGrid from 'ol/tilegrid/TileGrid';
import { ScaleLine, Attribution } from 'ol/control';
import { Observation, HazardZone, Waypoint, RouteAlternative, RouteProfile } from '../types/api';
import { PERSEVERANCE_TRAVERSE_TRACK } from './apiClient';

// Jezero Center Coordinates (Mars Plate Carrée / EPSG:4326)
export const JEZERO_CENTER: [number, number] = [77.4508, 18.4447]; // Octavia E. Butler Landing

// Calculate resolutions for Mars Equirectangular projection (360 deg width, 2 tiles at z=0)
const resolutions: number[] = [];
for (let z = 0; z <= 18; ++z) {
  resolutions[z] = 360 / (256 * Math.pow(2, z + 1));
}

// NASA Mars Trek WMTS provides imagery tiles strictly for zoom levels 0 through 7.
// Setting tile grid resolutions to slice(0, 8) ensures OpenLayers requests valid z=0..7 tiles
// and smoothly upsamples them at higher view zoom levels without returning 404 errors.
export const marsWmtsTileGrid = new TileGrid({
  extent: [-180, -90, 180, 90],
  origin: [-180, 90],
  resolutions: resolutions.slice(0, 8),
  tileSize: [256, 256],
});

export interface RouteProfileStyle {
  main: string;
  glow: string;
  label: string;
  badgeClass: string;
}

export function getRouteProfileColor(profile: string | undefined): RouteProfileStyle {
  const p = (profile || 'balanced').toLowerCase();
  if (p === 'direct' || p === 'fastest') {
    return {
      main: '#f97316', // Orange
      glow: 'rgba(249, 115, 22, 0.45)',
      label: 'Fastest (Direct)',
      badgeClass: 'text-amber-400 bg-amber-950/80 border-amber-500/50',
    };
  }
  if (p === 'safe' || p === 'safest') {
    return {
      main: '#10b981', // Green
      glow: 'rgba(16, 185, 129, 0.45)',
      label: 'Safest',
      badgeClass: 'text-emerald-400 bg-emerald-950/80 border-emerald-500/50',
    };
  }
  // Default: balanced / primary
  return {
    main: '#06b6d4', // Cyan
    glow: 'rgba(6, 182, 212, 0.45)',
    label: 'Balanced',
    badgeClass: 'text-cyan-400 bg-cyan-950/80 border-cyan-500/50',
  };
}

export class MarsMapController {
  public map: Map | null = null;
  private vikingLayer: TileLayer<XYZ>;
  private molaLayer: TileLayer<XYZ>;
  private contourLayer: VectorLayer<VectorSource>;
  private hazardLayer: VectorLayer<VectorSource>;
  private observationLayer: VectorLayer<VectorSource>;
  private traverseLayer: VectorLayer<VectorSource>;
  private routeLayer: VectorLayer<VectorSource>;
  private pinLayer: VectorLayer<VectorSource>;

  private hazardSource = new VectorSource();
  private observationSource = new VectorSource();
  private traverseSource = new VectorSource();
  private routeSource = new VectorSource();
  private pinSource = new VectorSource();
  private contourSource = new VectorSource();

  constructor() {
    // NASA Mars Trek Viking Color Mosaic
    this.vikingLayer = new TileLayer({
      source: new XYZ({
        url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
        projection: 'EPSG:4326',
        tileGrid: marsWmtsTileGrid,
        attributions: 'NASA / JPL / USGS Mars Trek (Viking MDIM2.1)',
        crossOrigin: 'anonymous',
      }),
      visible: true,
      opacity: 1.0,
      zIndex: 1,
    });

    // NASA Mars Trek MOLA Shaded Topography
    // Initialized as visible: false so Mars's natural reddish-terracotta Viking mosaic is displayed.
    // (MOLA ClrShade uses false-color elevation palette where Jezero basin at -2500m appears green).
    this.molaLayer = new TileLayer({
      source: new XYZ({
        url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
        projection: 'EPSG:4326',
        tileGrid: marsWmtsTileGrid,
        attributions: 'NASA / MGS / MOLA Team (Mars Trek)',
        crossOrigin: 'anonymous',
      }),
      visible: false,
      opacity: 0.6,
      zIndex: 2,
    });

    // Jezero Crater Geological Contour and Delta Feature Vectors
    this.contourLayer = new VectorLayer({
      source: this.contourSource,
      zIndex: 5,
      visible: true,
    });

    // Hazard Zones
    this.hazardLayer = new VectorLayer({
      source: this.hazardSource,
      zIndex: 10,
      visible: true,
    });

    // NASA PDS Observations
    this.observationLayer = new VectorLayer({
      source: this.observationSource,
      zIndex: 15,
      visible: true,
    });

    // Perseverance Traverse Track
    this.traverseLayer = new VectorLayer({
      source: this.traverseSource,
      zIndex: 12,
      visible: true,
    });

    // Active Planned Route & Alternatives
    this.routeLayer = new VectorLayer({
      source: this.routeSource,
      zIndex: 20,
      visible: true,
    });

    // Start / Goal / Waypoint pins
    this.pinLayer = new VectorLayer({
      source: this.pinSource,
      zIndex: 25,
      visible: true,
    });

    this.initGeologicalFeatures();
    this.initTraverseTrack();
  }

  public initMap(targetElement: HTMLElement): Map {
    // If map already exists, attach to targetElement if needed and return stable instance
    if (this.map) {
      const currentTarget = this.map.getTarget();
      if (currentTarget !== targetElement) {
        while (targetElement.firstChild) {
          targetElement.removeChild(targetElement.firstChild);
        }
        this.map.setTarget(targetElement);
      }
      return this.map;
    }

    // Ensure target element has no stale children
    while (targetElement.firstChild) {
      targetElement.removeChild(targetElement.firstChild);
    }

    this.map = new Map({
      target: targetElement,
      layers: [
        this.vikingLayer,
        this.molaLayer,
        this.contourLayer,
        this.hazardLayer,
        this.traverseLayer,
        this.routeLayer,
        this.observationLayer,
        this.pinLayer,
      ],
      view: new View({
        projection: 'EPSG:4326',
        center: JEZERO_CENTER,
        zoom: 11.5,
        minZoom: 2,
        maxZoom: 17,
      }),
      controls: [
        new ScaleLine({ units: 'metric' }),
        new Attribution({ collapsible: true }),
      ],
    });

    return this.map;
  }

  public detachMap(): void {
    if (this.map) {
      this.map.setTarget(null);
    }
  }

  public destroyMap(): void {
    if (this.map) {
      this.map.setTarget(null);
      this.map.dispose();
      this.map = null;
    }
  }

  // Populate Jezero Crater rim, Western Delta, and canyon contours
  private initGeologicalFeatures() {
    // Jezero Western Delta Fan Outline (fan shape)
    const deltaFanPolygon = new Polygon([[
      [77.400, 18.440],
      [77.410, 18.420],
      [77.435, 18.425],
      [77.442, 18.448],
      [77.430, 18.468],
      [77.408, 18.462],
      [77.400, 18.440],
    ]]);

    const deltaFeature = new Feature({
      geometry: deltaFanPolygon,
      name: 'Jezero Western Delta Fan',
      type: 'geology_formation',
    });
    deltaFeature.setStyle([
      new Style({
        stroke: new Stroke({ color: 'rgba(234, 88, 12, 0.45)', width: 4 }),
      }),
      new Style({
        stroke: new Stroke({ color: 'rgba(249, 115, 22, 0.95)', width: 1.8, lineDash: [6, 4] }),
        fill: new Fill({ color: 'rgba(194, 65, 12, 0.08)' }),
        text: new Text({
          text: 'JEZERO DELTA FAN • PALEO-LAKE',
          font: 'bold 11px ui-monospace, monospace',
          fill: new Fill({ color: '#fed7aa' }),
          stroke: new Stroke({ color: '#07090e', width: 3.5 }),
          offsetY: -10,
        }),
      }),
    ]);
    this.contourSource.addFeature(deltaFeature);

    // Neretva Vallis (Inflow River Channel entering Jezero from the west)
    const neretvaVallis = new LineString([
      [77.340, 18.475],
      [77.360, 18.468],
      [77.385, 18.455],
      [77.400, 18.445],
    ]);
    const riverFeature = new Feature({
      geometry: neretvaVallis,
      name: 'Neretva Vallis Inflow Channel',
      type: 'channel',
    });
    riverFeature.setStyle([
      new Style({
        stroke: new Stroke({ color: 'rgba(217, 119, 6, 0.4)', width: 6 }),
      }),
      new Style({
        stroke: new Stroke({ color: '#ea580c', width: 2.2 }),
        text: new Text({
          text: 'Neretva Vallis Ancient Inflow Channel',
          font: 'bold 10px ui-monospace, monospace',
          fill: new Fill({ color: '#fdba74' }),
          stroke: new Stroke({ color: '#07090e', width: 3 }),
          offsetY: -8,
        }),
      }),
    ]);
    this.contourSource.addFeature(riverFeature);

    // Jezero Crater Landing Ellipse (Octavia E. Butler Landing zone: 7.7 x 6.6 km)
    const landingCenter = [77.4508, 18.4447];
    const ellipsePoints: [number, number][] = [];
    const rx = 0.065; // ~7.7 km in longitude degrees at 18.4°N
    const ry = 0.055; // ~6.5 km in latitude degrees
    for (let a = 0; a <= 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      ellipsePoints.push([
        landingCenter[0] + rx * Math.cos(rad),
        landingCenter[1] + ry * Math.sin(rad),
      ]);
    }
    const ellipseFeature = new Feature({
      geometry: new Polygon([ellipsePoints]),
      name: 'Mars 2020 Landing Ellipse',
    });
    ellipseFeature.setStyle([
      new Style({
        stroke: new Stroke({ color: 'rgba(245, 158, 11, 0.35)', width: 4 }),
      }),
      new Style({
        stroke: new Stroke({ color: '#f59e0b', width: 1.8, lineDash: [8, 5] }),
        fill: new Fill({ color: 'rgba(245, 158, 11, 0.05)' }),
        text: new Text({
          text: 'M2020 LANDING ELLIPSE (7.7 × 6.6 km)',
          font: 'bold 10px ui-monospace, monospace',
          fill: new Fill({ color: '#fde68a' }),
          stroke: new Stroke({ color: '#07090e', width: 3 }),
          offsetY: -16,
        }),
      }),
    ]);
    this.contourSource.addFeature(ellipseFeature);

    // Jezero Crater Rim (~45km diameter impact crater structure)
    const rimCenter = [77.45, 18.38];
    const rimPoints: [number, number][] = [];
    const rimRx = 0.385;
    const rimRy = 0.365;
    for (let a = 0; a <= 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      rimPoints.push([
        rimCenter[0] + rimRx * Math.cos(rad),
        rimCenter[1] + rimRy * Math.sin(rad),
      ]);
    }
    const rimFeature = new Feature({
      geometry: new Polygon([rimPoints]),
      name: 'Jezero Crater Rim (45km Diameter)',
      type: 'geology_formation',
    });
    rimFeature.setStyle([
      new Style({
        stroke: new Stroke({ color: 'rgba(244, 63, 94, 0.35)', width: 4 }),
      }),
      new Style({
        stroke: new Stroke({ color: 'rgba(251, 113, 133, 0.85)', width: 2.0, lineDash: [10, 6] }),
        fill: new Fill({ color: 'rgba(244, 63, 94, 0.03)' }),
        text: new Text({
          text: 'JEZERO CRATER RIM (Ø 45 km)',
          font: 'bold 11px ui-monospace, monospace',
          fill: new Fill({ color: '#fda4af' }),
          stroke: new Stroke({ color: '#07090e', width: 4 }),
          offsetY: -12,
        }),
      }),
    ]);
    this.contourSource.addFeature(rimFeature);

    // South Séítah Dune Field (Active sand ripple corridor explored by Perseverance)
    const seitahPoints: [number, number][] = [
      [77.432, 18.428],
      [77.446, 18.432],
      [77.452, 18.420],
      [77.442, 18.412],
      [77.430, 18.418],
      [77.432, 18.428],
    ];
    const seitahFeature = new Feature({
      geometry: new Polygon([seitahPoints]),
      name: 'South Séítah Dune Field (High Wheel-Slip Hazard)',
      type: 'geology_formation',
    });
    seitahFeature.setStyle([
      new Style({
        stroke: new Stroke({ color: 'rgba(234, 179, 8, 0.35)', width: 4 }),
      }),
      new Style({
        stroke: new Stroke({ color: 'rgba(234, 179, 8, 0.85)', width: 1.8, lineDash: [5, 4] }),
        fill: new Fill({ color: 'rgba(234, 179, 8, 0.10)' }),
        text: new Text({
          text: 'SOUTH SÉÍTAH DUNE FIELD (HIGH SLIP)',
          font: 'bold 10px ui-monospace, monospace',
          fill: new Fill({ color: '#fef08a' }),
          stroke: new Stroke({ color: '#07090e', width: 3.5 }),
          offsetY: 0,
        }),
      }),
    ]);
    this.contourSource.addFeature(seitahFeature);
  }

  // Draw actual historic Perseverance traverse track
  public initTraverseTrack() {
    this.traverseSource.clear();

    const trackLine = new LineString(PERSEVERANCE_TRAVERSE_TRACK);
    const trackFeature = new Feature({
      geometry: trackLine,
      name: 'Perseverance Rover Traverse (Sol 0 - 1000+)',
    });

    trackFeature.setStyle([
      new Style({
        stroke: new Stroke({
          color: 'rgba(6, 182, 212, 0.35)',
          width: 7,
        }),
      }),
      new Style({
        stroke: new Stroke({
          color: '#06b6d4',
          width: 2.5,
          lineDash: [6, 4],
        }),
      }),
    ]);
    this.traverseSource.addFeature(trackFeature);

    // Add milestone points
    PERSEVERANCE_TRAVERSE_TRACK.forEach((coord, idx) => {
      if (idx === 0 || idx === 4 || idx === 11 || idx === 14 || idx === PERSEVERANCE_TRAVERSE_TRACK.length - 1) {
        const ptFeature = new Feature({
          geometry: new Point(coord),
          name: idx === 0 ? 'Sol 0 Landing' : idx === 4 ? 'Sol 198 Séítah' : idx === 11 ? 'Sol 654 Three Forks' : idx === 14 ? 'Sol 510 Skinner Ridge' : 'Sol 755 Belva',
        });
        ptFeature.setStyle(new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: '#06b6d4' }),
            stroke: new Stroke({ color: '#ffffff', width: 2 }),
          }),
        }));
        this.traverseSource.addFeature(ptFeature);
      }
    });
  }

  // Render Hazard Zones on the map
  public setHazards(hazards: HazardZone[]) {
    this.hazardSource.clear();
    if (!Array.isArray(hazards)) return;

    hazards.forEach(haz => {
      if (!haz || typeof haz.lat !== 'number' || typeof haz.lon !== 'number') return;
      // Create circular polygon representation based on radius
      // ~1 deg latitude on Mars is ~59,160 meters
      const radiusDeg = (haz.radius_m || 250) / 59160;
      const points: [number, number][] = [];
      for (let i = 0; i <= 360; i += 15) {
        const rad = (i * Math.PI) / 180;
        points.push([
          haz.lon + (radiusDeg / Math.cos(haz.lat * Math.PI / 180)) * Math.cos(rad),
          haz.lat + radiusDeg * Math.sin(rad),
        ]);
      }

      const polygon = new Polygon([points]);
      const feature = new Feature({
        geometry: polygon,
        data: haz,
        type: 'hazard',
      });

      const color = haz.severity === 'CRITICAL'
        ? { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.25)' }
        : haz.severity === 'HIGH'
          ? { stroke: '#f97316', fill: 'rgba(249, 115, 22, 0.22)' }
          : { stroke: '#eab308', fill: 'rgba(234, 179, 8, 0.18)' };

      feature.setStyle(new Style({
        stroke: new Stroke({ color: color.stroke, width: 2, lineDash: [4, 4] }),
        fill: new Fill({ color: color.fill }),
        text: new Text({
          text: `⚠ ${haz.name || 'Hazard'} (${haz.slope_deg ? haz.slope_deg + '°' : haz.type || 'slope'})`,
          font: 'bold 10px ui-monospace, monospace',
          fill: new Fill({ color: color.stroke }),
          stroke: new Stroke({ color: '#000000', width: 2.5 }),
          offsetY: 0,
        }),
      }));

      this.hazardSource.addFeature(feature);
    });
  }

  // Render Science Observations on the map
  public setObservations(observations: Observation[]) {
    this.observationSource.clear();
    if (!Array.isArray(observations)) return;

    observations.forEach(obs => {
      if (!obs || typeof obs.lat !== 'number' || typeof obs.lon !== 'number') return;
      const feature = new Feature({
        geometry: new Point([obs.lon, obs.lat]),
        data: obs,
        type: 'observation',
      });

      const color = obs.scientific_value === 'CRITICAL' ? '#ec4899' : '#38bdf8';

      feature.setStyle(new Style({
        image: new CircleStyle({
          radius: 7,
          fill: new Fill({ color: color }),
          stroke: new Stroke({ color: '#ffffff', width: 2 }),
        }),
        text: new Text({
          text: `🔬 ${obs.target_name || 'Observation'} [Sol ${obs.sol ?? 0}]`,
          font: '10px ui-monospace, monospace',
          fill: new Fill({ color: '#ffffff' }),
          stroke: new Stroke({ color: '#0f172a', width: 3 }),
          offsetY: -14,
        }),
      }));

      this.observationSource.addFeature(feature);
    });
  }

  // Render Planned Route & Waypoints with distinct profile colors & independent visualization
  public setPlannedRoute(
    pathCoordinates: [number, number][],
    waypoints: Waypoint[],
    alternatives: RouteAlternative[] = [],
    selectedRouteId: string = 'primary',
    primaryProfile: RouteProfile = 'balanced'
  ) {
    this.routeSource.clear();
    this.pinSource.clear();

    const safePathCoords = Array.isArray(pathCoordinates) ? pathCoordinates : [];
    const safeWaypoints = Array.isArray(waypoints) ? waypoints : [];
    const safeAlternatives = Array.isArray(alternatives) ? alternatives : [];

    // Build unified list of all available routes
    const routesToRender: Array<{
      id: string;
      name: string;
      profile: RouteProfile;
      coords: [number, number][];
      waypoints: Waypoint[];
      isSelected: boolean;
      data?: any;
    }> = [];

    // Primary route
    if (safePathCoords.length > 1) {
      routesToRender.push({
        id: 'primary',
        name: `Primary Route (${primaryProfile.toUpperCase()})`,
        profile: primaryProfile,
        coords: safePathCoords,
        waypoints: safeWaypoints,
        isSelected: selectedRouteId === 'primary',
      });
    }

    // Alternatives
    safeAlternatives.forEach(alt => {
      if (alt && Array.isArray(alt.path_coordinates) && alt.path_coordinates.length > 1) {
        routesToRender.push({
          id: alt.id,
          name: alt.name || `Alternative (${alt.profile.toUpperCase()})`,
          profile: alt.profile,
          coords: alt.path_coordinates,
          waypoints: alt.waypoints || [],
          isSelected: selectedRouteId === alt.id,
          data: alt,
        });
      }
    });

    // Ensure selected route is added last so it renders on top
    routesToRender.sort((a, b) => (a.isSelected ? 1 : 0) - (b.isSelected ? 1 : 0));

    // Render each route independently with distinct profile colors:
    // Balanced: cyan, Fastest / Direct: orange, Safest: green
    routesToRender.forEach(route => {
      const line = new LineString(route.coords);
      const feature = new Feature({
        geometry: line,
        name: route.name,
        type: 'route_path',
        routeId: route.id,
        profile: route.profile,
        isSelected: route.isSelected,
        data: route.data,
      });

      const styleConfig = getRouteProfileColor(route.profile);

      if (route.isSelected) {
        // Selected route: bold solid stroke, glowing halo underlayer, white center core
        feature.setStyle([
          // Glow halo
          new Style({
            stroke: new Stroke({
              color: styleConfig.glow,
              width: 10,
            }),
            zIndex: 40,
          }),
          // Profile main color
          new Style({
            stroke: new Stroke({
              color: styleConfig.main,
              width: 5,
            }),
            zIndex: 45,
          }),
          // High-contrast center core line
          new Style({
            stroke: new Stroke({
              color: '#ffffff',
              width: 1.5,
            }),
            zIndex: 50,
          }),
        ]);

        // Render waypoint markers exclusively for the currently active/selected route
        const activeWps = route.waypoints.length > 0 ? route.waypoints : safeWaypoints;
        activeWps.forEach((wp, idx) => {
          const wpFeature = new Feature({
            geometry: new Point([wp.lon, wp.lat]),
            data: wp,
            type: 'waypoint',
          });

          const isStart = idx === 0;
          const isGoal = idx === activeWps.length - 1;

          if (isStart || isGoal) {
            wpFeature.setStyle(new Style({
              image: new CircleStyle({
                radius: 9,
                fill: new Fill({ color: isStart ? '#10b981' : '#f59e0b' }),
                stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
              }),
              text: new Text({
                text: isStart ? '🚩 START' : '🎯 GOAL',
                font: 'bold 11px ui-monospace, monospace',
                fill: new Fill({ color: isStart ? '#34d399' : '#fbbf24' }),
                stroke: new Stroke({ color: '#07090e', width: 3 }),
                offsetY: isStart ? 16 : -16,
              }),
              zIndex: 60,
            }));
          } else {
            // Intermediate waypoint
            const riskColor = wp.risk_level === 'HIGH' ? '#ef4444' : wp.risk_level === 'MEDIUM' ? '#f59e0b' : styleConfig.main;
            wpFeature.setStyle(new Style({
              image: new CircleStyle({
                radius: 4.5,
                fill: new Fill({ color: riskColor }),
                stroke: new Stroke({ color: '#07090e', width: 1.5 }),
              }),
              text: new Text({
                text: `WP-${wp.index} (${wp.slope_deg}°)`,
                font: '9px ui-monospace, monospace',
                fill: new Fill({ color: '#cbd5e1' }),
                stroke: new Stroke({ color: '#07090e', width: 2 }),
                offsetY: idx % 2 === 0 ? -10 : 10,
              }),
              zIndex: 55,
            }));
          }

          this.pinSource.addFeature(wpFeature);
        });
      } else {
        // Unselected route: distinct profile color, dashed line to visually differentiate
        feature.setStyle(new Style({
          stroke: new Stroke({
            color: styleConfig.main,
            width: 3.2,
            lineDash: [8, 6],
          }),
          zIndex: 25,
        }));
      }

      this.routeSource.addFeature(feature);
    });
  }

  // Set Start & Goal pins directly
  public setMissionPins(start: { lat: number; lon: number }, goal: { lat: number; lon: number }) {
    this.pinSource.clear();

    const startFeature = new Feature({
      geometry: new Point([start.lon, start.lat]),
      type: 'start_pin',
    });
    startFeature.setStyle(new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: '#10b981' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      text: new Text({
        text: '🚩 START',
        font: 'bold 11px ui-monospace, monospace',
        fill: new Fill({ color: '#34d399' }),
        stroke: new Stroke({ color: '#07090e', width: 3 }),
        offsetY: -14,
      }),
    }));
    this.pinSource.addFeature(startFeature);

    const goalFeature = new Feature({
      geometry: new Point([goal.lon, goal.lat]),
      type: 'goal_pin',
    });
    goalFeature.setStyle(new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: '#f59e0b' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      text: new Text({
        text: '🎯 GOAL',
        font: 'bold 11px ui-monospace, monospace',
        fill: new Fill({ color: '#fbbf24' }),
        stroke: new Stroke({ color: '#07090e', width: 3 }),
        offsetY: -14,
      }),
    }));
    this.pinSource.addFeature(goalFeature);
  }

  // Toggle Layer Visibilities
  public setLayerVisibility(layerId: string, visible: boolean) {
    switch (layerId) {
      case 'nasa_mars_trek_viking':
      case 'viking_global_color':
        this.vikingLayer.setVisible(visible);
        break;
      case 'nasa_mars_trek_mola_shade':
      case 'mola_elevation_shaded':
        this.molaLayer.setVisible(visible);
        break;
      case 'nasa_mars_trek_ctx':
        // Optional context layer toggle
        break;
      case 'hazard_risk_heatmap':
      case 'steep_slope':
        this.hazardLayer.setVisible(visible);
        break;
      case 'science_targets':
      case 'observations':
        this.observationLayer.setVisible(visible);
        break;
      case 'perseverance_traverse':
        this.traverseLayer.setVisible(visible);
        break;
      case 'jezero_hirise_mosaic':
      case 'contour_layer':
        this.contourLayer.setVisible(visible);
        break;
      case 'route_layer':
        this.routeLayer.setVisible(visible);
        this.pinLayer.setVisible(visible);
        break;
    }
  }

  // Set Layer Opacity
  public setLayerOpacity(layerId: string, opacity: number) {
    switch (layerId) {
      case 'nasa_mars_trek_viking':
      case 'viking_global_color':
        this.vikingLayer.setOpacity(opacity);
        break;
      case 'nasa_mars_trek_mola_shade':
      case 'mola_elevation_shaded':
        this.molaLayer.setOpacity(opacity);
        break;
      case 'hazard_risk_heatmap':
        this.hazardLayer.setOpacity(opacity);
        break;
      case 'jezero_hirise_mosaic':
        this.contourLayer.setOpacity(opacity);
        break;
    }
  }

  // Center on Jezero Crater or specific coordinates
  public panTo(lon: number, lat: number, zoom = 12) {
    if (!this.map) return;
    this.map.getView().animate({
      center: [lon, lat],
      zoom: zoom,
      duration: 1000,
    });
  }

  public resetToJezero() {
    this.panTo(JEZERO_CENTER[0], JEZERO_CENTER[1], 11.5);
  }
}
