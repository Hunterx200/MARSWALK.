import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { 
  Observation, 
  HazardZone, 
  Waypoint, 
  RoutePlanResponse, 
  RouteProfile 
} from '../types/api';
import { JEZERO_CENTER, getRouteProfileColor } from '../services/mapManager';
import { 
  Crosshair, 
  Flag, 
  Target, 
  RotateCcw, 
  Play, 
  Pause, 
  ZoomIn, 
  ZoomOut, 
  MapPin, 
  ShieldAlert, 
  Microscope, 
  Navigation,
  Globe2,
  Map as MapIcon,
  X,
  Sparkles,
  Layers,
  Compass,
  Radio
} from 'lucide-react';

interface MarsGlobeProps {
  startPoint: { lat: number; lon: number; name?: string };
  goalPoint: { lat: number; lon: number; name?: string };
  onSelectCoordinate?: (type: 'start' | 'goal', lat: number, lon: number, name?: string) => void;
  selectionMode: 'inspect' | 'start' | 'goal';
  setSelectionMode: (mode: 'inspect' | 'start' | 'goal') => void;
  plannedRoute: RoutePlanResponse | null;
  activeAlternativeId: string;
  onSelectRoute?: (routeId: string) => void;
  hazards: HazardZone[];
  observations: Observation[];
  selectedFeature: any | null;
  setSelectedFeature: (feature: any | null) => void;
  viewMode: 'globe' | 'map';
  onToggleViewMode: (mode: 'globe' | 'map') => void;
}

// 2.8 radius gives an optimal fit inside the 40° FOV viewport without cropping
const GLOBE_RADIUS = 2.8;

// Convert Mars geographic coordinates (lat, lon) to 3D Cartesian coordinates
export function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = lat * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);
  const x = radius * Math.cos(phi) * Math.cos(theta);
  const y = radius * Math.sin(phi);
  const z = -radius * Math.cos(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

// Convert 3D Cartesian vector back to Mars geographic coordinates
export function vector3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const norm = v.clone().normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, norm.y))) * (180 / Math.PI);
  const lon = Math.atan2(-norm.z, norm.x) * (180 / Math.PI);
  return {
    lat: parseFloat(lat.toFixed(5)),
    lon: parseFloat(lon.toFixed(5)),
  };
}

// Create a soft-edged radial star sprite texture for realistic astronomical pinpricks
function createStarTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.2, 'rgba(240, 248, 255, 0.85)');
  grad.addColorStop(0.5, 'rgba(180, 215, 255, 0.35)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// Generate realistic, high-contrast Martian surface texture canvas with authentic albedo topography
function drawProceduralMarsCanvas(canvas: HTMLCanvasElement) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d')!;

  // 1. Authentic Martian Terracotta and Ferric Iron Oxide soil gradient
  const baseGrad = ctx.createLinearGradient(0, 0, 0, height);
  baseGrad.addColorStop(0.00, '#a84318'); // North polar perimeter
  baseGrad.addColorStop(0.15, '#bd4c1b'); // Northern lowlands (Vastitas Borealis)
  baseGrad.addColorStop(0.35, '#c6521e'); // Isidis & Elysium plains (true Mars rust-terracotta)
  baseGrad.addColorStop(0.50, '#ba4718'); // Equatorial canyon terrain
  baseGrad.addColorStop(0.65, '#832d0c'); // Southern cratered highlands (Noachis oxidized crust)
  baseGrad.addColorStop(0.85, '#963510'); // Polar highlands
  baseGrad.addColorStop(1.00, '#a63e15'); // South polar perimeter
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  // Helper: map lat/lon to canvas x, y (Equirectangular Plate Carrée)
  const toXY = (lat: number, lon: number): [number, number] => {
    const x = ((lon + 180) / 360) * width;
    const y = ((90 - lat) / 180) * height;
    return [x, y];
  };

  // 2. Major authentic dark volcanic basalt albedo features
  const drawAlbedo = (lat: number, lon: number, rx: number, ry: number, color: string, blur = 28) => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = color;
    ctx.beginPath();
    const [cx, cy] = toXY(lat, lon);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Syrtis Major Planum (Major dark basalt shield right adjacent to Jezero Crater at 70°E, 10°N)
  drawAlbedo(10, 70, 90, 115, 'rgba(20, 9, 4, 0.95)', 22);

  // Sinus Sabaeus & Meridiani Planum (Equatorial dark strip)
  drawAlbedo(-6, 0, 175, 48, 'rgba(26, 11, 5, 0.90)', 26);
  drawAlbedo(-10, 340, 130, 42, 'rgba(26, 11, 5, 0.88)', 26);

  // Acidalia Planitia (Northern dark basin)
  drawAlbedo(45, -35, 120, 100, 'rgba(28, 12, 6, 0.85)', 30);

  // Mare Tyrrhenum & Mare Cimmerium (Southern highlands volcanic belts)
  drawAlbedo(-25, 140, 190, 60, 'rgba(24, 10, 5, 0.92)', 30);
  drawAlbedo(-30, 220, 170, 55, 'rgba(24, 10, 5, 0.92)', 30);
  drawAlbedo(-25, -85, 120, 50, 'rgba(26, 11, 5, 0.88)', 28); // Solis Lacus ("Eye of Mars")

  // 3. Pale Impact Basins
  // Hellas Planitia (Giant circular impact basin)
  drawAlbedo(-42, 70, 95, 85, 'rgba(215, 125, 65, 0.85)', 20);
  // Argyre Planitia
  drawAlbedo(-50, -43, 70, 60, 'rgba(205, 120, 62, 0.80)', 18);
  // Isidis Planitia (Immediately East of Jezero Crater)
  drawAlbedo(13, 87, 65, 60, 'rgba(210, 122, 65, 0.78)', 18);

  // 4. Valles Marineris (Great Equatorial Canyon System)
  ctx.save();
  ctx.filter = 'blur(10px)';
  ctx.strokeStyle = 'rgba(22, 10, 5, 0.95)';
  ctx.lineWidth = 15;
  ctx.beginPath();
  const [vmX1, vmY1] = toXY(-8, -85);
  const [vmX2, vmY2] = toXY(-12, -45);
  ctx.moveTo(vmX1, vmY1);
  ctx.lineTo(vmX2, vmY2);
  ctx.stroke();
  ctx.restore();

  // Branching canyons: Noctis Labyrinthus & Melas Chasma
  ctx.save();
  ctx.filter = 'blur(6px)';
  ctx.strokeStyle = 'rgba(28, 12, 6, 0.90)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  const [nlX, nlY] = toXY(-7, -100);
  ctx.moveTo(nlX, nlY);
  ctx.lineTo(vmX1, vmY1);
  ctx.stroke();
  ctx.restore();

  // 5. Tharsis Volcanic Plateau & Olympus Mons
  const drawShield = (lat: number, lon: number, r: number) => {
    ctx.save();
    ctx.filter = 'blur(8px)';
    const [sx, sy] = toXY(lat, lon);
    const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, r);
    grad.addColorStop(0.0, 'rgba(26, 12, 6, 0.95)');
    grad.addColorStop(0.5, 'rgba(155, 70, 35, 0.65)');
    grad.addColorStop(1.0, 'rgba(195, 95, 50, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawShield(18.6, -133.8, 38); // Olympus Mons (Solar System's largest volcano)
  drawShield(11.8, -104.5, 24); // Ascraeus Mons
  drawShield(0.8, -112.9, 24);  // Pavonis Mons
  drawShield(-9.3, -120.9, 24); // Arsia Mons
  drawShield(25.0, 147.0, 26);  // Elysium Mons

  // 6. Impact Craters across ancient Southern Highlands
  const drawCrater = (lat: number, lon: number, r: number) => {
    ctx.save();
    ctx.filter = 'blur(4px)';
    const [cx, cy] = toXY(lat, lon);
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    grad.addColorStop(0.0, 'rgba(38, 18, 10, 0.92)'); // Dark crater floor
    grad.addColorStop(0.7, 'rgba(65, 28, 14, 0.70)');
    grad.addColorStop(0.9, 'rgba(225, 140, 85, 0.85)'); // Raised ejecta rim
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawCrater(-5.4, 137.8, 18);   // Gale Crater (Curiosity Landing)
  drawCrater(-14.6, 175.4, 19);  // Gusev Crater (Spirit Landing)
  drawCrater(-2.7, 16.7, 24);    // Schiaparelli Crater
  drawCrater(-9.0, 55.0, 22);    // Huygens Crater

  // 7. Polar Ice Caps (Bright White CO2 & H2O Ice) with spiral chasmata
  ctx.save();
  ctx.fillStyle = 'rgba(245, 250, 255, 0.98)';
  ctx.filter = 'blur(6px)';
  ctx.beginPath();
  ctx.arc(width / 2, 0, 88, 0, Math.PI * 2); // Planum Boreum
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width / 2, height, 78, 0, Math.PI * 2); // Planum Australe
  ctx.fill();
  ctx.restore();

  // 8. Jezero Crater Regional Highlight (paleo-lake depression + river delta fan)
  ctx.save();
  const [jX, jY] = toXY(JEZERO_CENTER[1], JEZERO_CENTER[0]);
  // Outer rim glow & delta fan
  const jGrad = ctx.createRadialGradient(jX, jY, 1, jX, jY, 22);
  jGrad.addColorStop(0.0, 'rgba(235, 180, 120, 0.95)'); // Pale river delta sediments
  jGrad.addColorStop(0.4, 'rgba(48, 22, 12, 0.88)');    // Dark basalt crater floor
  jGrad.addColorStop(0.8, 'rgba(210, 110, 55, 0.75)');   // Raised crater rim
  jGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = jGrad;
  ctx.beginPath();
  ctx.arc(jX, jY, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Generate companion procedural bump map canvas to give Mars 3D tactile elevation relief
function drawProceduralBumpCanvas(canvas: HTMLCanvasElement) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d')!;

  // Neutral mid-gray datum (0 elevation)
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);

  const toXY = (lat: number, lon: number): [number, number] => {
    const x = ((lon + 180) / 360) * width;
    const y = ((90 - lat) / 180) * height;
    return [x, y];
  };

  // Northern lowlands depression
  ctx.save();
  ctx.filter = 'blur(20px)';
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(0, 0, width, height * 0.38);
  ctx.restore();

  // Southern highlands elevated plateau
  ctx.save();
  ctx.filter = 'blur(24px)';
  ctx.fillStyle = '#a2a2a2';
  ctx.fillRect(0, height * 0.44, width, height * 0.56);
  ctx.restore();

  // Impact basins (deep depressions)
  const drawBasin = (lat: number, lon: number, rx: number, ry: number, depth: string) => {
    ctx.save();
    ctx.filter = 'blur(16px)';
    ctx.fillStyle = depth;
    ctx.beginPath();
    const [cx, cy] = toXY(lat, lon);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawBasin(-42, 70, 55, 48, '#252525'); // Hellas Basin (-7 km)
  drawBasin(-50, -43, 38, 32, '#353535'); // Argyre Basin
  drawBasin(13, 87, 34, 30, '#383838');  // Isidis Basin

  // Valles Marineris canyon rift
  ctx.save();
  ctx.filter = 'blur(5px)';
  ctx.strokeStyle = '#181818';
  ctx.lineWidth = 8;
  ctx.beginPath();
  const [vmX1, vmY1] = toXY(-8, -85);
  const [vmX2, vmY2] = toXY(-12, -45);
  ctx.moveTo(vmX1, vmY1);
  ctx.lineTo(vmX2, vmY2);
  ctx.stroke();
  ctx.restore();

  // Tharsis Volcanic Peaks (Olympus Mons + Tharsis Montes)
  const drawPeak = (lat: number, lon: number, r: number, peakColor: string) => {
    ctx.save();
    ctx.filter = 'blur(6px)';
    const [sx, sy] = toXY(lat, lon);
    const grad = ctx.createRadialGradient(sx, sy, 1, sx, sy, r);
    grad.addColorStop(0.0, peakColor);
    grad.addColorStop(0.6, '#b5b5b5');
    grad.addColorStop(1.0, '#808080');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawPeak(18.6, -133.8, 24, '#ffffff'); // Olympus Mons (+21 km)
  drawPeak(11.8, -104.5, 16, '#f2f2f2'); // Ascraeus Mons
  drawPeak(0.8, -112.9, 16, '#eeeeee');  // Pavonis Mons
  drawPeak(-9.3, -120.9, 16, '#eaeaea'); // Arsia Mons
  drawPeak(25.0, 147.0, 18, '#f0f0f0');  // Elysium Mons
}

/** Disposes all geometry and materials inside a Three.js Group before clearing */
const disposeGroup = (group: THREE.Group) => {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => mat.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  });
  group.clear();
};

export const MarsGlobe: React.FC<MarsGlobeProps> = ({
  startPoint,
  goalPoint,
  onSelectCoordinate,
  selectionMode,
  setSelectionMode,
  plannedRoute,
  activeAlternativeId,
  onSelectRoute,
  hazards,
  observations,
  selectedFeature,
  setSelectedFeature,
  viewMode,
  onToggleViewMode,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const marsMeshRef = useRef<THREE.Mesh | null>(null);
  const routesGroupRef = useRef<THREE.Group | null>(null);
  const pinsGroupRef = useRef<THREE.Group | null>(null);
  const hazardsGroupRef = useRef<THREE.Group | null>(null);
  const jezeroMarkerGroupRef = useRef<THREE.Group | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);

  // Animated elements refs
  const jezeroReticleOuterRef = useRef<THREE.Mesh | null>(null);
  const jezeroReticleInnerRef = useRef<THREE.Mesh | null>(null);
  const jezeroBeaconCrystalRef = useRef<THREE.Mesh | null>(null);
  const radarRingsRef = useRef<THREE.Mesh[]>([]);
  const floatingCrystalsRef = useRef<THREE.Object3D[]>([]);
  const activeRouteCurveRef = useRef<THREE.CatmullRomCurve3 | null>(null);
  const pulseBeadRef = useRef<THREE.Mesh | null>(null);

  // Smooth camera flight target
  const targetCameraPosRef = useRef<THREE.Vector3 | null>(null);

  // Interaction state
  const isDraggingRef = useRef<boolean>(false);
  const previousMousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const autoRotateRef = useRef<boolean>(false);
  autoRotateRef.current = autoRotate;

  const [showGrid, setShowGrid] = useState<boolean>(true);
  const showGridRef = useRef<boolean>(true);
  showGridRef.current = showGrid;

  const [cursorGeo, setCursorGeo] = useState<{ lat: number; lon: number } | null>({
    lat: JEZERO_CENTER[1],
    lon: JEZERO_CENTER[0],
  });
  const [cameraDistance, setCameraDistance] = useState<number>(7.6);
  const [textureStatus, setTextureStatus] = useState<string>('Initializing Mars Surface...');
  const [isNasaTextureLoaded, setIsNasaTextureLoaded] = useState<boolean>(false);

  // Focus Camera Directly on Jezero Crater (18.44°N, 77.45°E) with smooth flight interpolation
  const focusOnJezero = useCallback(() => {
    if (!globeGroupRef.current) return;
    // Align globe rotation smoothly
    globeGroupRef.current.rotation.set(0, 0, 0);

    // Initial position aligned with Jezero Crater at standard planetary inspection distance (7.6)
    const jezeroVec = latLonToVector3(JEZERO_CENTER[1], JEZERO_CENTER[0], 7.6);
    targetCameraPosRef.current = jezeroVec;
  }, []);

  // Initialize Three.js Scene, Camera, High-Visibility Lighting, and Mars Sphere
  useEffect(() => {
    if (!canvasContainerRef.current) return;
    const container = canvasContainerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 40° FOV allows the whole planet sphere (R=2.8) to fit comfortably within the viewport
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 120);
    cameraRef.current = camera;
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 1. Deep Space Multi-Spectral Starfield
    const starCount = 2400;
    const starGeom = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    // Astronomical star spectral color palette
    const colorPalette = [
      new THREE.Color(0xdce7ff), // Blue-white O/B
      new THREE.Color(0xffffff), // White A
      new THREE.Color(0xfff5ea), // Yellow-white F/G
      new THREE.Color(0xffdfb8), // Orange K
      new THREE.Color(0xffb896), // Red M
      new THREE.Color(0x7dd3fc), // Distant cyan emission
    ];

    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 38 + Math.random() * 32;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);

      const col = colorPalette[Math.floor(Math.random() * colorPalette.length)];
      starColors[i * 3] = col.r;
      starColors[i * 3 + 1] = col.g;
      starColors[i * 3 + 2] = col.b;
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

    const starTexture = createStarTexture();
    const starMat = new THREE.PointsMaterial({
      size: 1.1,
      map: starTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.88,
    });
    const starField = new THREE.Points(starGeom, starMat);
    scene.add(starField);

    // 2. Cinematic Celestial Lighting (Calibrated for True Red Planet Mars)
    // Directional Solar Light (Warm Sun from angled terminator)
    const sunLight = new THREE.DirectionalLight(0xffeedb, 1.25);
    sunLight.position.set(12, 6, 10);
    scene.add(sunLight);

    // Camera-following headlight ensures the visible side of Mars is ALWAYS well-lit without blowing out red saturation
    const cameraHeadlight = new THREE.DirectionalLight(0xffecd4, 0.95);
    cameraHeadlight.position.set(0, 0, 1);
    camera.add(cameraHeadlight);

    // Deep space ambient fill (Warm ferric dust albedo, so shadows stay rich dark basalt rather than blue-gray)
    const ambientLight = new THREE.AmbientLight(0x28160e, 0.55);
    scene.add(ambientLight);

    // Subtle atmospheric warm terracotta limb rim light (Warm Martian terminator backscatter, eliminating cold cyan)
    const rimLight = new THREE.DirectionalLight(0xe05a2b, 0.50);
    rimLight.position.set(-14, -8, -14);
    scene.add(rimLight);

    // Globe Root Group
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    // 3. Create Albedo Canvas & Bump Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    drawProceduralMarsCanvas(canvas);
    setTextureStatus('Mars High-Resolution Albedo Map: Active');

    const marsTexture = new THREE.CanvasTexture(canvas);
    marsTexture.wrapS = THREE.ClampToEdgeWrapping;
    marsTexture.wrapT = THREE.ClampToEdgeWrapping;
    marsTexture.minFilter = THREE.LinearFilter;
    marsTexture.magFilter = THREE.LinearFilter;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 1024;
    bumpCanvas.height = 512;
    drawProceduralBumpCanvas(bumpCanvas);
    const marsBumpTexture = new THREE.CanvasTexture(bumpCanvas);

    // Mars 3D Sphere Mesh with tactile elevation relief
    const marsGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96);
    const marsMaterial = new THREE.MeshStandardMaterial({
      map: marsTexture,
      bumpMap: marsBumpTexture,
      bumpScale: 0.032,
      roughness: 0.88,
      metalness: 0.0,
    });
    const marsMesh = new THREE.Mesh(marsGeometry, marsMaterial);
    marsMesh.name = 'MarsGlobeMesh';
    globeGroup.add(marsMesh);
    marsMeshRef.current = marsMesh;

    // 4. Authentic Martian Dual-Layer Atmospheric Scattering
    // Inner warm Martian terracotta dust haze
    const innerAtmoGeom = new THREE.SphereGeometry(GLOBE_RADIUS * 1.010, 64, 64);
    const innerAtmoMat = new THREE.MeshBasicMaterial({
      color: 0xe0562e,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    const innerAtmoMesh = new THREE.Mesh(innerAtmoGeom, innerAtmoMat);
    globeGroup.add(innerAtmoMesh);

    // Outer warm Martian dust limb halo (Martian amber-terracotta glow, authentic to Mars photography)
    const outerAtmoGeom = new THREE.SphereGeometry(GLOBE_RADIUS * 1.036, 64, 64);
    const outerAtmoMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    const outerAtmoMesh = new THREE.Mesh(outerAtmoGeom, outerAtmoMat);
    globeGroup.add(outerAtmoMesh);

    // 5. Dynamic Groups for Routes, Pins, Hazards, Jezero Reticle, Orbital Grid
    const routesGroup = new THREE.Group();
    const pinsGroup = new THREE.Group();
    const hazardsGroup = new THREE.Group();
    const jezeroMarkerGroup = new THREE.Group();
    const gridGroup = new THREE.Group();

    globeGroup.add(routesGroup);
    globeGroup.add(pinsGroup);
    globeGroup.add(hazardsGroup);
    globeGroup.add(jezeroMarkerGroup);
    globeGroup.add(gridGroup);

    routesGroupRef.current = routesGroup;
    pinsGroupRef.current = pinsGroup;
    hazardsGroupRef.current = hazardsGroup;
    jezeroMarkerGroupRef.current = jezeroMarkerGroup;
    gridGroupRef.current = gridGroup;

    // 6. Orbital Coordinate Telemetry Grid Lines (Equator & Parallels)
    const createGridRing = (latDeg: number, opacity: number = 0.15) => {
      const radiusAtLat = GLOBE_RADIUS * Math.cos(latDeg * (Math.PI / 180)) + 0.003;
      const yAtLat = GLOBE_RADIUS * Math.sin(latDeg * (Math.PI / 180));
      const ringGeom = new THREE.RingGeometry(radiusAtLat - 0.003, radiusAtLat + 0.003, 72);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = yAtLat;
      gridGroup.add(ringMesh);
    };

    createGridRing(0, 0.20);   // Equator
    createGridRing(25, 0.12);  // Tropic of Cancer (Mars)
    createGridRing(-25, 0.12); // Tropic of Capricorn (Mars)
    createGridRing(50, 0.08);
    createGridRing(-50, 0.08);

    // 7. Authentic Jezero Crater Targeting Reticle & Holographic Orbital Beacon
    const jezeroPos = latLonToVector3(JEZERO_CENTER[1], JEZERO_CENTER[0], GLOBE_RADIUS + 0.008);
    const jezeroNormal = jezeroPos.clone().normalize();

    // Outer animated dashed targeting ring (Warm Mars amber-gold)
    const reticleOuterGeom = new THREE.RingGeometry(0.075, 0.088, 48);
    const reticleOuterMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const reticleOuterMesh = new THREE.Mesh(reticleOuterGeom, reticleOuterMat);
    reticleOuterMesh.position.copy(jezeroPos);
    reticleOuterMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), jezeroNormal);
    jezeroMarkerGroup.add(reticleOuterMesh);
    jezeroReticleOuterRef.current = reticleOuterMesh;

    // Inner pulsing targeting ring (Vibrant Mars orange)
    const reticleInnerGeom = new THREE.RingGeometry(0.038, 0.048, 36);
    const reticleInnerMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    const reticleInnerMesh = new THREE.Mesh(reticleInnerGeom, reticleInnerMat);
    reticleInnerMesh.position.copy(jezeroPos);
    reticleInnerMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), jezeroNormal);
    jezeroMarkerGroup.add(reticleInnerMesh);
    jezeroReticleInnerRef.current = reticleInnerMesh;

    // Crosshair ticks
    const tickMat = new THREE.LineBasicMaterial({ color: 0xfde68a, linewidth: 2 });
    [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach(angle => {
      const p1 = new THREE.Vector3(Math.cos(angle) * 0.095, Math.sin(angle) * 0.095, 0);
      const p2 = new THREE.Vector3(Math.cos(angle) * 0.125, Math.sin(angle) * 0.125, 0);
      const tickGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const tickLine = new THREE.Line(tickGeom, tickMat);
      tickLine.position.copy(jezeroPos);
      tickLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), jezeroNormal);
      jezeroMarkerGroup.add(tickLine);
    });

    // Holographic vertical laser beacon pillar ascending from Jezero into orbit (Warm amber laser)
    const beaconHeight = 0.16;
    const beaconGeom = new THREE.CylinderGeometry(0.003, 0.012, beaconHeight, 16, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.40,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beaconMesh = new THREE.Mesh(beaconGeom, beaconMat);
    const beaconCenterPos = jezeroPos.clone().add(jezeroNormal.clone().multiplyScalar(beaconHeight / 2));
    beaconMesh.position.copy(beaconCenterPos);
    beaconMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), jezeroNormal);
    jezeroMarkerGroup.add(beaconMesh);

    // Glowing holographic beacon crystal at the apex of the laser pillar
    const crystalGeom = new THREE.OctahedronGeometry(0.012);
    const crystalMat = new THREE.MeshBasicMaterial({
      color: 0xffedd5,
      transparent: true,
      opacity: 0.95,
      wireframe: false,
    });
    const crystalMesh = new THREE.Mesh(crystalGeom, crystalMat);
    const crystalApexPos = jezeroPos.clone().add(jezeroNormal.clone().multiplyScalar(beaconHeight));
    crystalMesh.position.copy(crystalApexPos);
    jezeroMarkerGroup.add(crystalMesh);
    jezeroBeaconCrystalRef.current = crystalMesh;

    // 8. Initial Camera Position: Aligned with Jezero Crater (R=7.6)
    const initialPos = latLonToVector3(JEZERO_CENTER[1], JEZERO_CENTER[0], 7.6);
    camera.position.copy(initialPos);
    camera.lookAt(0, 0, 0);

    // 9. NASA Mars Trek Viking MDIM2.1 Global Mosaic Asynchronous Loader
    const ctx = canvas.getContext('2d')!;
    let tilesCompleted = 0;
    const totalTiles = 2;

    const loadTile = (x: number, y: number, colX: number, tileWidth: number) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          ctx.drawImage(img, colX, 0, tileWidth, canvas.height);
          marsTexture.needsUpdate = true;
          tilesCompleted += 1;
          if (tilesCompleted === totalTiles) {
            setIsNasaTextureLoaded(true);
            setTextureStatus('NASA Viking MDIM2.1 Global Mosaic: 100% Loaded');
          } else {
            setTextureStatus(`Streaming NASA Viking Mosaic (${tilesCompleted}/${totalTiles} Hemispheres)...`);
          }
        } catch (err) {
          console.warn('Canvas tile draw fallback active:', err);
        }
      };
      img.onerror = () => {
        setTextureStatus('NASA Mars Trek Offline — High-Fidelity Albedo Fallback Active');
      };
      img.src = `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/0/${y}/${x}.jpg`;
    };

    // Load Western & Eastern Hemispheres
    loadTile(0, 0, 0, canvas.width / 2);
    loadTile(1, 0, canvas.width / 2, canvas.width / 2);

    // 10. Animation Loop with Real-Time HUD and Particle Pulses
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Auto-rotation when active and not dragging
      if (autoRotateRef.current && globeGroupRef.current && !isDraggingRef.current) {
        globeGroupRef.current.rotation.y += 0.0016;
      }

      // Smooth camera interpolation toward target flight destination
      if (targetCameraPosRef.current && cameraRef.current) {
        cameraRef.current.position.lerp(targetCameraPosRef.current, 0.06);
        cameraRef.current.lookAt(0, 0, 0);
        setCameraDistance(parseFloat(cameraRef.current.position.length().toFixed(1)));
        if (cameraRef.current.position.distanceTo(targetCameraPosRef.current) < 0.05) {
          targetCameraPosRef.current = null;
        }
      }

      // Animated Jezero Crater reticle rotation & pulse
      if (jezeroReticleOuterRef.current) {
        jezeroReticleOuterRef.current.rotation.z = elapsedTime * 0.35;
      }
      if (jezeroReticleInnerRef.current) {
        const pulseScale = 1.0 + Math.sin(elapsedTime * 3.0) * 0.12;
        jezeroReticleInnerRef.current.scale.set(pulseScale, pulseScale, 1);
      }
      if (jezeroBeaconCrystalRef.current) {
        jezeroBeaconCrystalRef.current.rotation.y = elapsedTime * 1.5;
        jezeroBeaconCrystalRef.current.rotation.x = elapsedTime * 0.8;
      }

      // Animate surface radar sonar ripple rings
      radarRingsRef.current.forEach((ring, idx) => {
        const ringTime = (elapsedTime * 1.2 + idx * 0.8) % 2.0;
        const scaleVal = 1.0 + ringTime * 1.6;
        ring.scale.set(scaleVal, scaleVal, 1);
        const mat = ring.material as THREE.MeshBasicMaterial;
        if (mat) {
          mat.opacity = Math.max(0, 0.85 * (1.0 - ringTime / 2.0));
        }
      });

      // Animate floating science observation crystals (hovering bob motion)
      floatingCrystalsRef.current.forEach((obj, idx) => {
        obj.rotation.y = elapsedTime * 1.2 + idx;
        const originalY = obj.userData?.originalOffset || 0.016;
        const bob = Math.sin(elapsedTime * 2.5 + idx * 1.2) * 0.004;
        if (obj.userData?.normal && obj.userData?.basePos) {
          obj.position.copy(
            obj.userData.basePos.clone().add(obj.userData.normal.clone().multiplyScalar(originalY + bob))
          );
        }
      });

      // Animate traveling photon pulse bead along the planned route traverse
      if (pulseBeadRef.current && activeRouteCurveRef.current) {
        const routeProgress = (elapsedTime * 0.22) % 1.0;
        const beadPoint = activeRouteCurveRef.current.getPointAt(routeProgress);
        pulseBeadRef.current.position.copy(beadPoint);
        const beadScale = 1.0 + Math.sin(elapsedTime * 6.0) * 0.25;
        pulseBeadRef.current.scale.set(beadScale, beadScale, beadScale);
      }

      renderer.render(scene, camera);
    };
    animate();

    // 11. Window Resize Handler & Observer
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => handleResize())
      : null;
    if (resizeObserver && container) {
      resizeObserver.observe(container);
    }

    const handleFocusEvent = () => {
      focusOnJezero();
    };
    window.addEventListener('marswalk:focus-jezero', handleFocusEvent);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('marswalk:focus-jezero', handleFocusEvent);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (routesGroupRef.current) disposeGroup(routesGroupRef.current);
      if (pinsGroupRef.current) disposeGroup(pinsGroupRef.current);
      if (hazardsGroupRef.current) disposeGroup(hazardsGroupRef.current);
      if (jezeroMarkerGroupRef.current) disposeGroup(jezeroMarkerGroupRef.current);
      if (gridGroupRef.current) disposeGroup(gridGroupRef.current);
      renderer.dispose();
      marsGeometry.dispose();
      marsMaterial.dispose();
      marsTexture.dispose();
      marsBumpTexture.dispose();
      starGeom.dispose();
      starMat.dispose();
      starTexture.dispose();
    };
  }, [focusOnJezero]);

  // Toggle Grid Visibility
  useEffect(() => {
    if (gridGroupRef.current) {
      gridGroupRef.current.visible = showGrid;
    }
  }, [showGrid]);

  // Update Route Trajectories on Globe with Glowing Neon Curves & Photon Pulse
  useEffect(() => {
    if (!routesGroupRef.current || !globeGroupRef.current) return;
    const routesGroup = routesGroupRef.current;
    disposeGroup(routesGroup);
    activeRouteCurveRef.current = null;
    pulseBeadRef.current = null;

    if (!plannedRoute || !plannedRoute.path_coordinates || plannedRoute.path_coordinates.length < 2) {
      return;
    }

    interface RouteItemData {
      id: string;
      name: string;
      profile: RouteProfile;
      coords: [number, number][];
      waypoints: Waypoint[];
      isSelected: boolean;
    }

    const routes: RouteItemData[] = [];

    // Primary route
    routes.push({
      id: 'primary',
      name: `Primary Route (${(plannedRoute.profile || 'balanced').toUpperCase()})`,
      profile: plannedRoute.profile || 'balanced',
      coords: plannedRoute.path_coordinates,
      waypoints: plannedRoute.waypoints || [],
      isSelected: activeAlternativeId === 'primary',
    });

    // Alternatives
    (plannedRoute.alternatives || []).forEach(alt => {
      if (alt.path_coordinates && alt.path_coordinates.length > 1) {
        routes.push({
          id: alt.id,
          name: alt.name,
          profile: alt.profile,
          coords: alt.path_coordinates,
          waypoints: alt.waypoints || [],
          isSelected: activeAlternativeId === alt.id,
        });
      }
    });

    routes.forEach(route => {
      const styleConfig = getRouteProfileColor(route.profile);
      const points: THREE.Vector3[] = [];
      const elevationOffset = route.isSelected ? 0.016 : 0.011;

      route.coords.forEach(([lon, lat]) => {
        points.push(latLonToVector3(lat, lon, GLOBE_RADIUS + elevationOffset));
      });

      if (points.length < 2) return;

      const curve = new THREE.CatmullRomCurve3(points);
      const smoothPoints = curve.getPoints(Math.max(28, points.length * 2));
      const geom = new THREE.BufferGeometry().setFromPoints(smoothPoints);

      if (route.isSelected) {
        activeRouteCurveRef.current = curve;

        // Active selected route: Bold glowing neon tube + white core laser line
        const tubeGeom = new THREE.TubeGeometry(curve, 64, 0.0052, 8, false);
        const tubeMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(styleConfig.main),
        });
        const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
        tubeMesh.userData = { type: 'route_path', routeId: route.id, profile: route.profile, name: route.name };
        routesGroup.add(tubeMesh);

        // Core white laser highlight
        const coreMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
        const coreLine = new THREE.Line(geom, coreMat);
        coreLine.userData = { type: 'route_path', routeId: route.id, profile: route.profile, name: route.name };
        routesGroup.add(coreLine);

        // Traveling photon pulse bead along the traverse path
        const beadGeom = new THREE.SphereGeometry(0.011, 12, 12);
        const beadMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          wireframe: false,
        });
        const beadMesh = new THREE.Mesh(beadGeom, beadMat);
        beadMesh.position.copy(points[0]);
        routesGroup.add(beadMesh);
        pulseBeadRef.current = beadMesh;
      } else {
        // Unselected alternative route: Distinct dashed profile line
        const lineMat = new THREE.LineDashedMaterial({
          color: new THREE.Color(styleConfig.main),
          dashSize: 0.015,
          gapSize: 0.01,
          linewidth: 2,
        });
        const line = new THREE.Line(geom, lineMat);
        line.computeLineDistances();
        line.userData = { type: 'route_path', routeId: route.id, profile: route.profile, name: route.name };
        routesGroup.add(line);
      }
    });

    return () => {
      disposeGroup(routesGroup);
    };
  }, [plannedRoute, activeAlternativeId]);

  // Update Pins, Waypoints, Hazards on Globe with Holographic Beacons
  useEffect(() => {
    if (!pinsGroupRef.current || !hazardsGroupRef.current) return;
    const pinsGroup = pinsGroupRef.current;
    const hazardsGroup = hazardsGroupRef.current;
    disposeGroup(pinsGroup);
    disposeGroup(hazardsGroup);
    radarRingsRef.current = [];
    floatingCrystalsRef.current = [];

    // Helper: Create a prominent 3D holographic beacon pin on the surface of the sphere
    const createBeacon = (
      lat: number,
      lon: number,
      color: number,
      label: string,
      type: string,
      data?: any
    ) => {
      const pos = latLonToVector3(lat, lon, GLOBE_RADIUS);
      const normal = pos.clone().normalize();
      const beaconGroup = new THREE.Group();

      // Expanding radar sonar pulse ring
      const radarRingGeom = new THREE.RingGeometry(0.018, 0.034, 24);
      const radarRingMat = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      const radarRingMesh = new THREE.Mesh(radarRingGeom, radarRingMat);
      radarRingMesh.position.copy(pos.clone().add(normal.clone().multiplyScalar(0.007)));
      radarRingMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      beaconGroup.add(radarRingMesh);
      radarRingsRef.current.push(radarRingMesh);

      // Base footprint ring
      const baseRingGeom = new THREE.RingGeometry(0.008, 0.016, 24);
      const baseRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const baseRingMesh = new THREE.Mesh(baseRingGeom, baseRingMat);
      baseRingMesh.position.copy(pos.clone().add(normal.clone().multiplyScalar(0.006)));
      baseRingMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      beaconGroup.add(baseRingMesh);

      // Vertical mast stem
      const stemHeight = 0.075;
      const stemGeom = new THREE.CylinderGeometry(0.003, 0.003, stemHeight, 8);
      const stemMat = new THREE.MeshBasicMaterial({ color: color });
      const stemMesh = new THREE.Mesh(stemGeom, stemMat);
      const stemPos = pos.clone().add(normal.clone().multiplyScalar(stemHeight / 2));
      stemMesh.position.copy(stemPos);
      stemMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      beaconGroup.add(stemMesh);

      // Glowing beacon head
      const headGeom = new THREE.SphereGeometry(0.014, 14, 14);
      const headMat = new THREE.MeshBasicMaterial({ color: color });
      const headMesh = new THREE.Mesh(headGeom, headMat);
      headMesh.position.copy(pos.clone().add(normal.clone().multiplyScalar(stemHeight)));
      beaconGroup.add(headMesh);

      beaconGroup.userData = { type, label, data };
      pinsGroup.add(beaconGroup);
    };

    // Start Beacon (Emerald Green #10b981)
    createBeacon(startPoint.lat, startPoint.lon, 0x10b981, '🚩 START (Octavia E. Butler)', 'start_pin', startPoint);

    // Goal Beacon (Amber Gold #f59e0b)
    createBeacon(goalPoint.lat, goalPoint.lon, 0xf59e0b, '🎯 GOAL (Belva Crater)', 'goal_pin', goalPoint);

    // Route Waypoints
    if (plannedRoute && plannedRoute.waypoints) {
      const activeWps = activeAlternativeId === 'primary'
        ? (plannedRoute.waypoints || [])
        : (plannedRoute.alternatives?.find(a => a.id === activeAlternativeId)?.waypoints || []);

      activeWps.forEach((wp, idx) => {
        if (idx === 0 || idx === activeWps.length - 1) return; // Skip endpoints
        const wpPos = latLonToVector3(wp.lat, wp.lon, GLOBE_RADIUS + 0.015);
        const wpColor = wp.slope_deg > 12 ? 0xef4444 : wp.slope_deg > 7 ? 0xf59e0b : 0x06b6d4;
        const wpGeom = new THREE.SphereGeometry(0.007, 10, 10);
        const wpMat = new THREE.MeshBasicMaterial({ color: wpColor });
        const wpMesh = new THREE.Mesh(wpGeom, wpMat);
        wpMesh.position.copy(wpPos);
        wpMesh.userData = { type: 'waypoint', label: `Waypoint ${wp.index}`, data: wp };
        pinsGroup.add(wpMesh);
      });
    }

    // Hazard Zones with Translucent Warning Discs & Boundary Rings
    (hazards || []).forEach(haz => {
      const hazPos = latLonToVector3(haz.lat, haz.lon, GLOBE_RADIUS + 0.009);
      const normal = hazPos.clone().normalize();
      const hazGroup = new THREE.Group();

      const hazRadius = 0.024;
      const hazColor = haz.severity === 'CRITICAL' ? 0xef4444 : haz.severity === 'HIGH' ? 0xf97316 : 0xeab308;

      // Surface danger zone fill
      const hazGeom = new THREE.CircleGeometry(hazRadius, 24);
      const hazMat = new THREE.MeshBasicMaterial({
        color: hazColor,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });
      const hazMesh = new THREE.Mesh(hazGeom, hazMat);
      hazMesh.position.copy(hazPos);
      hazMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      hazGroup.add(hazMesh);

      // Warning perimeter ring
      const hazRingGeom = new THREE.RingGeometry(hazRadius * 0.9, hazRadius * 1.05, 24);
      const hazRingMat = new THREE.MeshBasicMaterial({
        color: hazColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      const hazRingMesh = new THREE.Mesh(hazRingGeom, hazRingMat);
      hazRingMesh.position.copy(hazPos.clone().add(normal.clone().multiplyScalar(0.002)));
      hazRingMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      hazGroup.add(hazRingMesh);

      hazGroup.userData = { type: 'hazard', label: haz.name, data: haz };
      hazardsGroup.add(hazGroup);
    });

    // Science Observations with Floating Hovering Holographic Crystals
    (observations || []).forEach(obs => {
      const obsPos = latLonToVector3(obs.lat, obs.lon, GLOBE_RADIUS);
      const normal = obsPos.clone().normalize();
      const obsColor = obs.scientific_value === 'CRITICAL' ? 0xec4899 : 0x38bdf8;

      const crystalGeom = new THREE.OctahedronGeometry(0.010);
      const crystalMat = new THREE.MeshBasicMaterial({
        color: obsColor,
        wireframe: false,
      });
      const crystalMesh = new THREE.Mesh(crystalGeom, crystalMat);
      const initialOffset = 0.018;
      crystalMesh.position.copy(obsPos.clone().add(normal.clone().multiplyScalar(initialOffset)));
      crystalMesh.userData = {
        type: 'observation',
        label: obs.target_name,
        data: obs,
        basePos: obsPos,
        normal: normal,
        originalOffset: initialOffset
      };

      floatingCrystalsRef.current.push(crystalMesh);
      pinsGroup.add(crystalMesh);
    });

    return () => {
      disposeGroup(pinsGroup);
      disposeGroup(hazardsGroup);
    };
  }, [startPoint, goalPoint, plannedRoute, activeAlternativeId, hazards, observations]);

  // Mouse & Touch Orbit Rotation, Zoom, and Raycasting Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    mouseDownPositionRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!mountRef.current || !cameraRef.current || !sceneRef.current) return;

    // Orbit Rotation when Dragging
    if (isDraggingRef.current && globeGroupRef.current) {
      const deltaX = e.clientX - previousMousePositionRef.current.x;
      const deltaY = e.clientY - previousMousePositionRef.current.y;

      globeGroupRef.current.rotation.y += deltaX * 0.0045;
      globeGroupRef.current.rotation.x += deltaY * 0.0045;

      // Clamp vertical rotation to avoid flipping upside down
      globeGroupRef.current.rotation.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, globeGroupRef.current.rotation.x));
      previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
    }

    // Raycast Cursor over Sphere Surface for Live Telemetry HUD
    const rect = mountRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.02 };
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

    if (marsMeshRef.current && globeGroupRef.current) {
      const intersects = raycaster.intersectObject(marsMeshRef.current, false);
      if (intersects.length > 0) {
        // Point in globe local coordinate space
        const localPoint = globeGroupRef.current.worldToLocal(intersects[0].point.clone());
        const geo = vector3ToLatLon(localPoint);
        setCursorGeo(geo);
      }
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  // Zoom with Mouse Wheel (min 3.4 for close-up inspection, max 14.0 for deep space)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!cameraRef.current) return;
    const camera = cameraRef.current;
    const zoomFactor = e.deltaY > 0 ? 1.07 : 0.93;
    const currentDist = camera.position.length();
    const newDist = Math.max(3.4, Math.min(14.0, currentDist * zoomFactor));
    camera.position.setLength(newDist);
    setCameraDistance(parseFloat(newDist.toFixed(1)));
  };

  // Click on Globe: Handle Setting Start / Goal or Inspecting Features
  const handleClick = (e: React.MouseEvent) => {
    if (!mountRef.current || !cameraRef.current || !globeGroupRef.current) return;

    // Ignore click if mouse moved more than 5px during interaction (orbit drag)
    const dragDistance = Math.hypot(
      e.clientX - mouseDownPositionRef.current.x,
      e.clientY - mouseDownPositionRef.current.y
    );
    if (dragDistance > 5) return;

    const rect = mountRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.02 };
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

    // 1. Check feature pins & routes first
    const interactiveObjects: THREE.Object3D[] = [];
    if (pinsGroupRef.current) interactiveObjects.push(...pinsGroupRef.current.children);
    if (routesGroupRef.current) interactiveObjects.push(...routesGroupRef.current.children);
    if (hazardsGroupRef.current) interactiveObjects.push(...hazardsGroupRef.current.children);

    const hitFeatures = raycaster.intersectObjects(interactiveObjects, true);
    if (hitFeatures.length > 0 && selectionMode === 'inspect') {
      let topObj: THREE.Object3D | null = hitFeatures[0].object;
      while (topObj && !topObj.userData?.type && topObj.parent) {
        topObj = topObj.parent;
      }

      if (topObj && topObj.userData?.type) {
        const uData = topObj.userData;
        if (uData.type === 'route_path' && uData.routeId && onSelectRoute) {
          onSelectRoute(uData.routeId);
        }
        setSelectedFeature({
          type: uData.type,
          name: uData.label || uData.name || 'Mars Feature',
          data: uData.data || uData,
        });
        return;
      }
    }

    // 2. Check surface click for Set Start / Set Goal
    if (marsMeshRef.current) {
      const hitSphere = raycaster.intersectObject(marsMeshRef.current, false);
      if (hitSphere.length > 0) {
        const localPoint = globeGroupRef.current.worldToLocal(hitSphere[0].point.clone());
        const geo = vector3ToLatLon(localPoint);

        if (selectionMode === 'start') {
          onSelectCoordinate?.('start', geo.lat, geo.lon, `Mars Site (${geo.lat}°, ${geo.lon}°)`);
          setSelectionMode('inspect');
          return;
        }

        if (selectionMode === 'goal') {
          onSelectCoordinate?.('goal', geo.lat, geo.lon, `Target Site (${geo.lat}°, ${geo.lon}°)`);
          setSelectionMode('inspect');
          return;
        }

        // Click on open terrain in inspect mode clears selection
        setSelectedFeature(null);
      }
    }
  };

  const handleZoom = (direction: 'in' | 'out') => {
    if (!cameraRef.current) return;
    const camera = cameraRef.current;
    const currentDist = camera.position.length();
    const factor = direction === 'in' ? 0.82 : 1.18;
    const newDist = Math.max(3.4, Math.min(14.0, currentDist * factor));
    camera.position.setLength(newDist);
    setCameraDistance(parseFloat(newDist.toFixed(1)));
  };

  return (
    <div
      ref={mountRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onClick={handleClick}
      className="relative w-full h-full overflow-hidden cursor-grab active:cursor-grabbing select-none"
      style={{
        background: 'radial-gradient(ellipse at 50% 50%, #150906 0%, #080302 55%, #020101 100%)',
      }}
    >
      {/* Dedicated Three.js canvas mount container */}
      <div ref={canvasContainerRef} className="absolute inset-0 pointer-events-none" />

      {/* View Mode Switcher: 3D Globe vs 2D Flat Map (Top Center) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center p-1 rounded-xl bg-space-900/90 backdrop-blur-md border border-space-700/80 shadow-2xl">
        <button
          type="button"
          onClick={() => onToggleViewMode('globe')}
          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
            viewMode === 'globe'
              ? 'bg-gradient-to-r from-mars-600 to-mars-500 text-white shadow-lg shadow-mars-950/60 border border-mars-400/50'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Globe2 className="w-3.5 h-3.5 text-mars-200" />
          <span>3D Mars Globe</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleViewMode('map')}
          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 transition-all cursor-pointer ${
            viewMode === 'map'
              ? 'bg-space-750 text-white shadow-sm border border-space-600'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <MapIcon className="w-3.5 h-3.5 text-telemetry-cyan" />
          <span>2D Surface Map</span>
        </button>
      </div>

      {/* Interactive Mode Pills: Inspect, Set Start, Set Goal (Top Left) */}
      <div className="absolute top-4 left-4 z-20 flex items-center space-x-1.5 p-1 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700/80 shadow-xl font-mono text-xs">
        <button
          onClick={() => setSelectionMode('inspect')}
          className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
            selectionMode === 'inspect'
              ? 'bg-space-750 text-white shadow-sm border border-space-600'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          title="Inspect 3D Mars globe features, terrain, hazards, and waypoints"
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
          title="Click on the 3D Mars globe to set Rover Start Point"
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
          title="Click on the 3D Mars globe to set Scientific Goal Target"
        >
          <Target className="w-3.5 h-3.5 text-amber-400" />
          <span>Set Goal</span>
        </button>
      </div>

      {/* 3D Globe Quick Controls (Top Right Overlay) */}
      <div className="absolute top-4 right-4 z-20 flex items-center space-x-1.5 p-1 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700/80 shadow-xl font-mono text-xs">
        <button
          type="button"
          onClick={focusOnJezero}
          className="px-2 py-1.5 rounded hover:bg-space-800 text-slate-300 hover:text-white flex items-center space-x-1 transition-all cursor-pointer"
          title="Re-focus camera directly on Jezero Crater (18.44°N, 77.45°E)"
        >
          <RotateCcw className="w-3.5 h-3.5 text-mars-400" />
          <span className="hidden sm:inline text-[11px]">Jezero Focus</span>
        </button>

        <button
          type="button"
          onClick={() => setAutoRotate(!autoRotate)}
          className={`p-1.5 rounded transition-all cursor-pointer ${
            autoRotate ? 'bg-space-750 text-telemetry-cyan' : 'text-slate-400 hover:text-white'
          }`}
          title={autoRotate ? 'Pause planetary rotation' : 'Start cinematic rotation'}
        >
          {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1.5 rounded transition-all cursor-pointer ${
            showGrid ? 'bg-space-750 text-telemetry-cyan' : 'text-slate-400 hover:text-white'
          }`}
          title={showGrid ? 'Hide orbital coordinate grid' : 'Show orbital coordinate grid'}
        >
          <Layers className="w-3.5 h-3.5" />
        </button>

        <div className="w-[1px] h-4 bg-space-700 mx-0.5" />

        <button
          type="button"
          onClick={() => handleZoom('in')}
          className="p-1.5 rounded hover:bg-space-800 text-slate-300 hover:text-white transition-all cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5 text-slate-300" />
        </button>

        <button
          type="button"
          onClick={() => handleZoom('out')}
          className="p-1.5 rounded hover:bg-space-800 text-slate-300 hover:text-white transition-all cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5 text-slate-300" />
        </button>
      </div>

      {/* Surface Texture Loading & Telemetry Status Pill (Top Left Under Pills) */}
      <div className="absolute top-16 left-4 z-20 flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700 text-[11px] font-mono text-slate-300 shadow-xl">
        <Sparkles className="w-3.5 h-3.5 text-telemetry-cyan animate-pulse" />
        <span className="text-slate-400">IMAGERY:</span>
        <span className={isNasaTextureLoaded ? 'text-emerald-400 font-semibold' : 'text-amber-300 font-semibold'}>
          {textureStatus}
        </span>
      </div>

      {/* Selection Mode Notice Banner */}
      {selectionMode !== 'inspect' && (
        <div className="absolute top-28 left-4 z-20 px-3 py-1.5 rounded-md bg-space-900/95 border border-telemetry-cyan/60 text-xs text-telemetry-cyan font-mono shadow-lg flex items-center space-x-2 animate-pulse-subtle">
          <MapPin className="w-4 h-4 text-telemetry-cyan" />
          <span>Click anywhere on 3D Mars globe to place {selectionMode.toUpperCase()} position...</span>
          <button 
            onClick={() => setSelectionMode('inspect')}
            className="ml-2 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Live Coordinate HUD & Telemetry Bar (Bottom Left) */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center space-x-3 px-3.5 py-2 rounded-xl bg-space-900/90 backdrop-blur-md border border-space-700/80 text-xs font-mono shadow-2xl text-slate-300 select-none">
        <div className="flex items-center space-x-1">
          <span className="text-slate-500">LAT:</span>
          <span className="text-mars-300 font-bold">
            {cursorGeo ? `${cursorGeo.lat > 0 ? cursorGeo.lat.toFixed(4) + '°N' : Math.abs(cursorGeo.lat).toFixed(4) + '°S'}` : '18.4447°N'}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <span className="text-slate-500">LON:</span>
          <span className="text-mars-300 font-bold">
            {cursorGeo ? `${cursorGeo.lon > 0 ? cursorGeo.lon.toFixed(4) + '°E' : Math.abs(cursorGeo.lon).toFixed(4) + '°W'}` : '77.4508°E'}
          </span>
        </div>

        <div className="hidden sm:flex items-center space-x-1 text-telemetry-cyan">
          <span className="text-slate-500">ORBIT ALT:</span>
          <span>{((cameraDistance - GLOBE_RADIUS) * 1250).toFixed(0)} km</span>
        </div>

        <div className="hidden md:flex items-center space-x-1 text-slate-400">
          <span className="text-slate-500">BODY:</span>
          <span>Mars IAU_2015</span>
        </div>

        <div className="hidden xl:flex items-center space-x-1 text-emerald-400">
          <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span>TELEMETRY ONLINE</span>
        </div>
      </div>

      {/* Mars Mission Legend & Color Palette Indicators (Bottom Center) */}
      <div className="hidden lg:flex absolute bottom-4 left-1/2 -translate-x-1/2 z-20 items-center space-x-3 px-3.5 py-1.5 rounded-full bg-space-900/90 backdrop-blur-md border border-space-700/80 text-[11px] font-mono shadow-2xl text-slate-300 select-none">
        <div className="flex items-center space-x-1.5 text-cyan-300">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
          <span className="font-semibold">Balanced (Cyan)</span>
        </div>

        <div className="flex items-center space-x-1.5 text-amber-300">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
          <span className="font-semibold">Fastest (Orange)</span>
        </div>

        <div className="flex items-center space-x-1.5 text-emerald-300">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <span className="font-semibold">Safest (Green)</span>
        </div>

        <span className="text-slate-600">|</span>

        <span className="text-mars-400">NASA Viking MDIM2.1 + 3D Jezero Reticle</span>
      </div>

      {/* Planetary True North Indicator Rose (Bottom Right) */}
      <div className="hidden sm:flex absolute bottom-4 right-4 z-20 items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-space-900/90 backdrop-blur-md border border-space-700/80 text-xs font-mono shadow-xl text-slate-300">
        <Compass className="w-3.5 h-3.5 text-mars-400" />
        <span className="text-[11px] text-slate-400">PLANETARY NORTH: <span className="text-white font-bold">+90.0°</span></span>
      </div>

      {/* Feature Details Inspector Card with Sci-Fi Glassmorphism & Corner Accents */}
      {selectedFeature && (
        <div className="absolute top-16 right-4 z-20 w-80 max-h-[80vh] overflow-y-auto rounded-xl bg-space-900/95 backdrop-blur-md border border-cyan-500/30 p-4 shadow-2xl text-slate-200 animate-in fade-in zoom-in-95 font-mono hud-bracket">
          <div className="flex items-start justify-between pb-2 border-b border-space-750">
            <div className="flex items-center space-x-2">
              {selectedFeature.type === 'hazard' && <ShieldAlert className="w-4 h-4 text-rose-400" />}
              {selectedFeature.type === 'observation' && <Microscope className="w-4 h-4 text-telemetry-cyan" />}
              {selectedFeature.type === 'waypoint' && <MapPin className="w-4 h-4 text-amber-400" />}
              {selectedFeature.type === 'route_path' && <Navigation className="w-4 h-4 text-cyan-400" />}
              {(selectedFeature.type === 'start_pin' || selectedFeature.type === 'goal_pin') && <Flag className="w-4 h-4 text-emerald-400" />}
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {selectedFeature.type === 'route_path'
                  ? 'ROUTE TRAVERSE'
                  : selectedFeature.type
                    ? selectedFeature.type.replace('_', ' ')
                    : 'FEATURE'}
              </span>
            </div>
            <button
              onClick={() => setSelectedFeature(null)}
              className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-space-750 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {selectedFeature.type === 'route_path' && (
            <div className="mt-3 space-y-2 text-xs">
              <h4 className="font-bold text-sm text-white">{selectedFeature.name}</h4>
              <p className="text-slate-400 text-[11px]">
                {selectedFeature.data?.routeId === activeAlternativeId
                  ? 'Active selected route displayed in solid neon relief on Mars globe.'
                  : 'Alternative route profile. Click to make this route active.'}
              </p>
            </div>
          )}

          {selectedFeature.type === 'hazard' && selectedFeature.data && (
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">{selectedFeature.data.name}</h4>
                <span className="text-rose-400 font-bold">{selectedFeature.data.severity}</span>
              </div>
              <p className="text-slate-300 text-[11px]">{selectedFeature.data.mobility_risk}</p>
              <div className="text-[10px] text-emerald-400 font-semibold">{selectedFeature.data.mitigation_protocol}</div>
            </div>
          )}

          {selectedFeature.type === 'observation' && selectedFeature.data && (
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">{selectedFeature.data.target_name}</h4>
                <span className="text-cyan-400 font-bold">SOL {selectedFeature.data.sol}</span>
              </div>
              <p className="text-slate-300 text-[11px]">{selectedFeature.data.description}</p>
            </div>
          )}

          {selectedFeature.type === 'waypoint' && selectedFeature.data && (
            <div className="mt-3 space-y-1.5 text-xs">
              <h4 className="font-bold text-sm text-white">{selectedFeature.label || `Waypoint ${selectedFeature.data.index}`}</h4>
              <div className="text-slate-400 text-[11px]">
                Coordinates: <span className="text-slate-200">{selectedFeature.data.lat}°N, {selectedFeature.data.lon}°E</span>
              </div>
              <div className="text-slate-400 text-[11px]">
                Slope: <span className="text-amber-400 font-bold">{selectedFeature.data.slope_deg}°</span> &bull; Elev: <span className="text-slate-200">{selectedFeature.data.elevation_m != null ? `${selectedFeature.data.elevation_m}m` : 'Unknown'}</span>
              </div>
            </div>
          )}

          {(selectedFeature.type === 'start_pin' || selectedFeature.type === 'goal_pin') && selectedFeature.data && (
            <div className="mt-3 space-y-1.5 text-xs">
              <h4 className="font-bold text-sm text-white">{selectedFeature.label}</h4>
              <div className="text-slate-400 text-[11px]">
                Coordinates: <span className="text-slate-200">{selectedFeature.data.lat}°N, {selectedFeature.data.lon}°E</span>
              </div>
              <div className="text-slate-400 text-[11px]">
                Site: <span className="text-emerald-400 font-semibold">{selectedFeature.data.name || 'Mission Waypoint'}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default MarsGlobe;
