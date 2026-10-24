import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { DoubleSide, MathUtils, PCFSoftShadowMap, PerspectiveCamera, Shape, ShapeGeometry, Vector3, type Group } from 'three';
import type { ConstraintFinding, Layout, Point2D, Verdict } from '../contracts';
import { boundsCenter, mmToMeters, planToScene, pointOnWall, polygonCenter, wallOpenings, type Bounds } from './Plan3DGeometry';

export type CameraCommand = { kind: 'isometric' | 'top' | 'entry' | 'eye-level' | 'room'; roomId?: string; version: number };

export type Plan3DSceneProps = {
  layout: Layout;
  bounds: Bounds;
  exploded: boolean;
  selectedRoomId?: string;
  selectedElementId?: string;
  selectedFindingId?: string;
  findings: ConstraintFinding[];
  onSelectRoom: (id: string) => void;
  onSelectElement: (id: string) => void;
  cameraCommand: CameraCommand;
};

const WALL_HEIGHT = 2.55; // Presentation height; the layout specifies only 2D walls.
const floorColors = ['#d8caba', '#d8d2c5', '#c7d2c9', '#d6ccc1'];
const verdictColors: Record<Verdict, string> = { pass: '#59c7ab', fail: '#e59076', unknown: '#d6bd8b' };

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function floorGeometry(polygon: Point2D[], center: Point2D): ShapeGeometry | null {
  if (polygon.length < 3 || !polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const shape = new Shape();
  polygon.forEach((point, index) => {
    const [x, z] = planToScene(point, center);
    // Shape y is negated so rotating -90° produces scene z in the y-down direction.
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function RoomSurface({ room, center, index, selected, dimmed, hovered, verdict, onSelect, onHover }: {
  room: Layout['rooms'][number]; center: Point2D; index: number; selected: boolean; dimmed: boolean;
  hovered: boolean; verdict?: Verdict; onSelect: (id: string) => void; onHover: (id?: string) => void;
}) {
  const geometry = useMemo(() => floorGeometry(room.polygon, center), [room.polygon, center.x, center.y]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  const centerPoint = polygonCenter(room.polygon);
  const [labelX, labelZ] = planToScene(centerPoint, center);
  const points = room.polygon.map((point) => {
    const [x, z] = planToScene(point, center);
    return [x, 0.035, z] as [number, number, number];
  });
  const activeColor = verdict ? verdictColors[verdict] : '#81d5bc';
  return <group name={room.id}>
    <mesh geometry={geometry} position={[0, 0.013, 0]} receiveShadow
      onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(room.id); }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover(room.id); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { onHover(undefined); document.body.style.cursor = ''; }}>
      <meshStandardMaterial color={selected ? '#88bda9' : hovered ? '#b7d2c1' : floorColors[index % floorColors.length]}
        roughness={0.88} metalness={0.02} transparent opacity={dimmed ? 0.34 : 1} side={DoubleSide}
        emissive={selected ? '#184f43' : '#000000'} emissiveIntensity={selected ? 0.18 : 0} />
    </mesh>
    {(selected || verdict) && points.length >= 3 && <Line points={[...points, points[0]]} color={activeColor} lineWidth={selected ? 3 : 2} transparent opacity={dimmed ? 0.45 : 0.95} />}
    <Html position={[labelX, 0.07, labelZ]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
      <div className={`adapt-plan3d__room-label${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}>
        <span>{room.label}</span><small>{room.id}</small>
      </div>
    </Html>
  </group>;
}

function WallPiece({ start, end, thickness, center, muted, accent }: {
  start: Point2D; end: Point2D; thickness: number; center: Point2D; muted: boolean; accent: boolean;
}) {
  const [x1, z1] = planToScene(start, center);
  const [x2, z2] = planToScene(end, center);
  const length = Math.hypot(x2 - x1, z2 - z1);
  if (!Number.isFinite(length) || length <= 0 || thickness <= 0) return null;
  const angle = -Math.atan2(z2 - z1, x2 - x1);
  return <group position={[(x1 + x2) / 2, 0, (z1 + z2) / 2]} rotation={[0, angle, 0]}>
    <mesh position={[0, WALL_HEIGHT / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, WALL_HEIGHT, mmToMeters(thickness)]} />
      <meshStandardMaterial color={accent ? '#b8d8ce' : '#eee9df'} roughness={0.86} metalness={0.02} transparent opacity={muted ? 0.46 : 1} />
    </mesh>
    <mesh position={[0, WALL_HEIGHT - 0.025, 0]} castShadow>
      <boxGeometry args={[length, 0.05, mmToMeters(thickness) + 0.012]} />
      <meshStandardMaterial color="#b4b9ad" roughness={0.67} metalness={0.08} transparent opacity={muted ? 0.46 : 1} />
    </mesh>
    <mesh position={[0, 0.075, mmToMeters(thickness) / 2 + 0.012]}>
      <boxGeometry args={[length, 0.15, 0.02]} />
      <meshStandardMaterial color="#d6d1c7" roughness={0.8} transparent opacity={muted ? 0.46 : 1} />
    </mesh>
  </group>;
}

function WallAssembly({ wall, doors, center, selectedElementId, linkedIds, onSelectElement }: {
  wall: Layout['walls'][number]; doors: Layout['doors']; center: Point2D;
  selectedElementId?: string; linkedIds: Set<string>; onSelectElement: (id: string) => void;
}) {
  const { openings, runs } = wallOpenings(wall, doors);
  const accent = selectedElementId === wall.id || linkedIds.has(wall.id);
  const muted = !!selectedElementId && !accent;
  const direction = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  return <group name={wall.id} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelectElement(wall.id); }}>
    {runs.map((run, index) => <WallPiece key={index} start={pointOnWall(wall, run.startMm)} end={pointOnWall(wall, run.endMm)} thickness={wall.thickness} center={center} muted={muted} accent={accent} />)}
    {openings.map((opening) => {
      const midpoint = pointOnWall(wall, (opening.startMm + opening.endMm) / 2);
      const [x, z] = planToScene(midpoint, center);
      const width = mmToMeters(opening.endMm - opening.startMm);
      const doorAccent = selectedElementId === opening.id || linkedIds.has(opening.id);
      return <group key={opening.id} name={opening.id} position={[x, 0, z]} rotation={[0, -direction, 0]}
        onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelectElement(opening.id); }}>
        {/* Threshold and jambs are schematic. The layout has no door height or leaf geometry. */}
        <mesh position={[0, 0.022, 0]} receiveShadow>
          <boxGeometry args={[width, 0.035, mmToMeters(wall.thickness) + 0.08]} />
          <meshStandardMaterial color={doorAccent ? '#59c7ab' : '#ae8060'} roughness={0.58} metalness={0.1} emissive={doorAccent ? '#1b796b' : '#000000'} emissiveIntensity={doorAccent ? 0.35 : 0} />
        </mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[side * width / 2, 1.02, 0]} castShadow>
          <boxGeometry args={[0.035, 2.04, mmToMeters(wall.thickness) + 0.04]} />
          <meshStandardMaterial color="#687973" metalness={0.25} roughness={0.5} />
        </mesh>)}
        <mesh position={[0, 2.05, 0]} castShadow>
          <boxGeometry args={[width + 0.07, 0.035, mmToMeters(wall.thickness) + 0.04]} />
          <meshStandardMaterial color="#687973" metalness={0.25} roughness={0.5} />
        </mesh>
        <mesh position={[0, (2.08 + WALL_HEIGHT) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, WALL_HEIGHT - 2.08, mmToMeters(wall.thickness)]} />
          <meshStandardMaterial color="#eee9df" roughness={0.86} />
        </mesh>
      </group>;
    })}
  </group>;
}

function ObjectAssembly({ object, center, selected, dimmed, linked, onSelect, onHover }: {
  object: Layout['objects'][number]; center: Point2D; selected: boolean; dimmed: boolean;
  linked: boolean; onSelect: (id: string) => void; onHover: (id?: string) => void;
}) {
  const { x, y, width, height } = object.bounds;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const [sceneX, sceneZ] = planToScene({ x: x + width / 2, y: y + height / 2 }, center);
  const w = mmToMeters(width), d = mmToMeters(height);
  const name = `${object.id} ${object.label}`.toLowerCase();
  const isBed = name.includes('bed');
  const isSofa = name.includes('sofa') || name.includes('couch');
  const isCounter = name.includes('counter') || name.includes('cabinet');
  const isBath = name.includes('bath') || name.includes('sink');
  const top = object.kind === 'fixture' ? 0.78 : isBed ? 0.46 : 0.57;
  const baseColor = selected || linked ? '#67baa7' : object.kind === 'fixture' ? '#8d9b96' : '#99735f';
  const detailColor = object.kind === 'fixture' ? '#d5dfdb' : '#e9ddca';
  const opacity = dimmed ? 0.35 : 1;
  const material = <meshStandardMaterial color={baseColor} roughness={0.76} metalness={0.04} transparent opacity={opacity} emissive={selected ? '#1a705e' : '#000000'} emissiveIntensity={selected ? 0.2 : 0} />;
  return <group name={object.id} position={[sceneX, 0, sceneZ]}
    onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(object.id); }}
    onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover(object.id); document.body.style.cursor = 'pointer'; }}
    onPointerOut={() => { onHover(undefined); document.body.style.cursor = ''; }}>
    <mesh position={[0, top / 2 + 0.04, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, top, d]} />{material}
    </mesh>
    {(isBed || isSofa) && <>
      <mesh position={[0, top + 0.075, 0]} castShadow>
        <boxGeometry args={[Math.max(0.05, w - 0.09), 0.13, Math.max(0.05, d - 0.09)]} />
        <meshStandardMaterial color={detailColor} roughness={0.95} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, top + 0.15, -d * 0.32]} castShadow>
        <boxGeometry args={[Math.max(0.05, w - 0.15), 0.17, Math.max(0.05, d * 0.2)]} />
        <meshStandardMaterial color={isBed ? '#f4eae0' : '#c7a993'} roughness={0.98} transparent opacity={opacity} />
      </mesh>
    </>}
    {(isCounter || isBath) && <mesh position={[0, top + 0.055, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, 0.09, d]} />
      <meshStandardMaterial color={isBath ? '#e8e9e4' : '#d7d1c6'} roughness={0.38} metalness={0.08} transparent opacity={opacity} />
    </mesh>}
    {selected && <mesh position={[0, 0.02, 0]}>
      <boxGeometry args={[w + 0.075, 0.025, d + 0.075]} />
      <meshBasicMaterial color="#79e0bf" transparent opacity={0.8} />
    </mesh>}
  </group>;
}

function FindingMarkers({ layout, center, findings, selectedFindingId }: {
  layout: Layout; center: Point2D; findings: ConstraintFinding[]; selectedFindingId?: string;
}) {
  const markers = findings.flatMap((finding) => finding.affectedElementIds.flatMap((id) => {
    const room = layout.rooms.find((item) => item.id === id);
    const door = layout.doors.find((item) => item.id === id);
    const wall = layout.walls.find((item) => item.id === id);
    const object = layout.objects.find((item) => item.id === id);
    const point = room ? polygonCenter(room.polygon) : door?.center ?? (wall ? { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 } : object ? { x: object.bounds.x + object.bounds.width / 2, y: object.bounds.y + object.bounds.height / 2 } : undefined);
    return point ? [{ finding, id, point }] : [];
  }));
  return <>{markers.map(({ finding, id, point }) => {
    const [x, z] = planToScene(point, center);
    return <Html key={`${finding.id}-${id}`} position={[x, 0.18, z]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
      <span className={`adapt-plan3d__finding-pin adapt-plan3d__finding-pin--${finding.verdict}${selectedFindingId === finding.id ? ' is-selected' : ''}`}
        title={`${finding.verdict}: ${finding.explanation}`}>
        {finding.verdict === 'pass' ? '✓' : finding.verdict === 'fail' ? '!' : '?'}
      </span>
    </Html>;
  })}</>;
}

function PresentationCeiling({ layout, center }: { layout: Layout; center: Point2D }) {
  const geometries = useMemo(() => layout.rooms.map((room) => floorGeometry(room.polygon, center)), [layout.rooms, center.x, center.y]);
  useEffect(() => () => geometries.forEach((geometry) => geometry?.dispose()), [geometries]);
  return <group>{geometries.map((geometry, index) => geometry && <mesh key={layout.rooms[index].id} geometry={geometry} receiveShadow>
    <meshStandardMaterial color="#c5d1ca" roughness={0.74} metalness={0.08} side={DoubleSide} transparent opacity={0.56} depthWrite={false} />
  </mesh>)}</group>;
}

function ApartmentLayers({ layout, bounds, exploded, selectedRoomId, selectedElementId, selectedFindingId, findings, onSelectRoom, onSelectElement }: Omit<Plan3DSceneProps, 'cameraCommand'>) {
  const center = useMemo(() => boundsCenter(bounds), [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
  const floors = useRef<Group>(null);
  const objects = useRef<Group>(null);
  const walls = useRef<Group>(null);
  const ceiling = useRef<Group>(null);
  const [hoveredId, setHoveredId] = useState<string>();
  const linkedIds = useMemo(() => new Set(findings.filter((finding) => !selectedFindingId || finding.id === selectedFindingId).flatMap((finding) => finding.affectedElementIds)), [findings, selectedFindingId]);
  const verdictById = useMemo(() => {
    const ranking: Record<Verdict, number> = { pass: 0, unknown: 1, fail: 2 };
    const map = new Map<string, Verdict>();
    findings.forEach((finding) => finding.affectedElementIds.forEach((id) => {
      const current = map.get(id);
      if (!current || ranking[finding.verdict] > ranking[current]) map.set(id, finding.verdict);
    }));
    return map;
  }, [findings]);
  useFrame((_, delta) => {
    if (floors.current) floors.current.position.y = MathUtils.damp(floors.current.position.y, exploded ? 0.18 : 0, 5, delta);
    if (objects.current) objects.current.position.y = MathUtils.damp(objects.current.position.y, exploded ? 0.62 : 0, 5, delta);
    if (walls.current) walls.current.position.y = MathUtils.damp(walls.current.position.y, exploded ? 1.12 : 0, 5, delta);
    if (ceiling.current) {
      ceiling.current.position.y = MathUtils.damp(ceiling.current.position.y, exploded ? 5.25 : WALL_HEIGHT + 0.03, 4, delta);
      ceiling.current.visible = exploded || ceiling.current.position.y > WALL_HEIGHT + 0.08;
    }
  });
  const roomForObject = (object: Layout['objects'][number]) => layout.rooms.find((room) => pointInPolygon({ x: object.bounds.x + object.bounds.width / 2, y: object.bounds.y + object.bounds.height / 2 }, room.polygon))?.id;
  return <>
    <group ref={floors}>
      {layout.rooms.map((room, index) => <RoomSurface key={room.id} room={room} center={center} index={index}
        selected={selectedRoomId === room.id} dimmed={!!selectedRoomId && selectedRoomId !== room.id}
        hovered={hoveredId === room.id} verdict={verdictById.get(room.id)} onSelect={onSelectRoom} onHover={setHoveredId} />)}
      <FindingMarkers layout={layout} center={center} findings={findings} selectedFindingId={selectedFindingId} />
    </group>
    <group ref={objects}>
      {layout.objects.map((object) => <ObjectAssembly key={object.id} object={object} center={center}
        selected={selectedElementId === object.id} linked={linkedIds.has(object.id)}
        dimmed={!!selectedRoomId && roomForObject(object) !== selectedRoomId} onSelect={onSelectElement} onHover={setHoveredId} />)}
    </group>
    <group ref={walls}>
      {layout.walls.map((wall) => <WallAssembly key={wall.id} wall={wall} doors={layout.doors} center={center}
        selectedElementId={selectedElementId} linkedIds={linkedIds} onSelectElement={onSelectElement} />)}
    </group>
    <group ref={ceiling} position={[0, WALL_HEIGHT + 0.03, 0]}>
      <PresentationCeiling layout={layout} center={center} />
    </group>
  </>;
}

function CameraRig({ bounds, layout, command, exploded }: { bounds: Bounds; layout: Layout; command: CameraCommand; exploded: boolean }) {
  const { camera, size } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const goalPosition = useRef(new Vector3());
  const goalTarget = useRef(new Vector3());
  const moving = useRef(false);
  useEffect(() => {
    const width = Math.max(mmToMeters(bounds.maxX - bounds.minX), 1);
    const depth = Math.max(mmToMeters(bounds.maxY - bounds.minY), 1);
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.35);
    const fov = camera instanceof PerspectiveCamera ? camera.fov * Math.PI / 180 : 50 * Math.PI / 180;
    let span = Math.max(depth, width / aspect);
    let targetX = 0, targetZ = 0, targetY = exploded ? 1.55 : 0;
    if (command.kind === 'room') {
      const room = layout.rooms.find((item) => item.id === command.roomId);
      if (room?.polygon.length) {
        const center = boundsCenter(bounds);
        [targetX, targetZ] = planToScene(polygonCenter(room.polygon), center);
        const xs = room.polygon.map((point) => point.x), ys = room.polygon.map((point) => point.y);
        span = Math.max(mmToMeters(Math.max(...xs) - Math.min(...xs)) / aspect, mmToMeters(Math.max(...ys) - Math.min(...ys)), 1.5);
        targetY = exploded ? 1.7 : 0.35;
      }
    }
    const distance = Math.max(3.6, span / (2 * Math.tan(fov / 2)) * (exploded ? 2.05 : 1.7));
    goalTarget.current.set(targetX, targetY, targetZ);
    if (command.kind === 'top') goalPosition.current.set(targetX, distance * 1.3, targetZ + 0.001);
    else if (command.kind === 'entry') goalPosition.current.set(targetX, targetY + distance * 0.48, targetZ + distance * 0.95);
    else if (command.kind === 'eye-level') {
      goalTarget.current.y = 1.1;
      goalPosition.current.set(targetX + distance * 0.68, 1.65, targetZ + distance * 0.72);
    } else goalPosition.current.set(targetX + distance * 0.68, targetY + distance * 0.85, targetZ + distance * 0.72);
    if (camera instanceof PerspectiveCamera) {
      camera.near = 0.05;
      camera.far = Math.max(100, distance * 12);
      camera.updateProjectionMatrix();
    }
    moving.current = true;
  }, [bounds, layout.rooms, command, exploded, camera, size.width, size.height]);
  useFrame((_, delta) => {
    if (!moving.current || !controls.current) return;
    const amount = 1 - Math.exp(-4.5 * delta);
    camera.position.lerp(goalPosition.current, amount);
    controls.current.target.lerp(goalTarget.current, amount);
    controls.current.update();
    if (camera.position.distanceTo(goalPosition.current) < 0.012 && controls.current.target.distanceTo(goalTarget.current) < 0.012) moving.current = false;
  });
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} enablePan enableZoom
    minDistance={1.2} maxDistance={120} maxPolarAngle={Math.PI / 2.02} onStart={() => { moving.current = false; }} />;
}

function StudioScene(props: Plan3DSceneProps) {
  const { bounds, layout } = props;
  const width = mmToMeters(bounds.maxX - bounds.minX);
  const depth = mmToMeters(bounds.maxY - bounds.minY);
  return <>
    <color attach="background" args={['#242d31']} />
    <fog attach="fog" args={['#242d31', 18, 52]} />
    <ambientLight intensity={0.55} color="#e6eee9" />
    <hemisphereLight args={['#d8e8e4', '#29312f', 1.1]} />
    <directionalLight position={[-7, 13, 8]} intensity={2.4} color="#fff1dc" castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14}
      shadow-camera-top={14} shadow-camera-bottom={-14} shadow-normalBias={0.025} shadow-bias={-0.00015} />
    <directionalLight position={[9, 7, -7]} intensity={0.75} color="#8eaea9" />
    <mesh position={[0, -0.16, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#263136" roughness={0.93} metalness={0.07} />
    </mesh>
    <Grid position={[0, -0.151, 0]} args={[80, 80]} cellSize={1} cellThickness={0.45} cellColor="#43535a"
      sectionSize={5} sectionThickness={0.8} sectionColor="#526067" fadeDistance={28} fadeStrength={1.5} infiniteGrid />
    <mesh position={[0, -0.095, 0]} receiveShadow castShadow>
      <boxGeometry args={[width + 0.36, 0.18, depth + 0.36]} />
      <meshStandardMaterial color="#586760" roughness={0.78} metalness={0.12} />
    </mesh>
    <mesh position={[0, -0.19, 0]} receiveShadow>
      <boxGeometry args={[width + 0.58, 0.035, depth + 0.58]} />
      <meshStandardMaterial color="#82938b" metalness={0.3} roughness={0.54} />
    </mesh>
    <ApartmentLayers {...props} />
    <CameraRig bounds={bounds} layout={layout} command={props.cameraCommand} exploded={props.exploded} />
  </>;
}

export function Plan3DCanvas(props: Plan3DSceneProps & { onContextLost?: () => void }) {
  return <Canvas shadows={{ type: PCFSoftShadowMap }} dpr={[1, 1.75]}
    camera={{ fov: 50, position: [8, 12, 8] }} gl={{ antialias: true, powerPreference: 'high-performance' }}
    onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => props.onContextLost?.(), { once: true })}>
    <StudioScene {...props} />
  </Canvas>;
}
