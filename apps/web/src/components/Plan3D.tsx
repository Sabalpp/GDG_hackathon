import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ConstraintFinding, Layout } from '../contracts';
import { layoutBounds } from './Plan3DGeometry';
import { Plan3DCanvas, type CameraCommand } from './Plan3DScene';
import './Plan3D.css';

export type Plan3DProps = {
  layout: Layout;
  findings?: ConstraintFinding[];
  selectedFindingId?: string;
  selectedRoomId?: string;
  onSelectRoom?: (roomId: string) => void;
  selectedElementId?: string;
  onSelectElement?: (elementId: string) => void;
  cameraPreset?: 'overview' | 'top' | 'entry' | 'eye-level';
  cameraRequestId?: number;
  focusedRoomId?: string;
  exploded?: boolean;
  onExplodedChange?: (exploded: boolean) => void;
  onUnavailable?: () => void;
  className?: string;
  zoomRequest?: { direction: 'in' | 'out'; version: number };
};

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

class SceneErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(): void { this.props.onError(); }
  render(): ReactNode { return this.state.failed ? null : this.props.children; }
}

export function Plan3D({ layout, findings = [], selectedFindingId, selectedRoomId, onSelectRoom,
  selectedElementId, onSelectElement, cameraPreset, cameraRequestId, focusedRoomId,
  exploded, onExplodedChange, onUnavailable, className = '', zoomRequest }: Plan3DProps) {
  const [availability, setAvailability] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [localRoomId, setLocalRoomId] = useState<string>();
  const [localElementId, setLocalElementId] = useState<string>();
  const [localExploded, setLocalExploded] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<CameraCommand>({ kind: 'isometric', version: 0 });
  const reportedUnavailable = useRef(false);
  const previousExternalCamera = useRef<{ preset?: string; focus?: string }>({});
  const bounds = useMemo(() => layoutBounds(layout), [layout]);
  const roomId = selectedRoomId ?? (layout.rooms.some((room) => room.id === selectedElementId) ? selectedElementId : localRoomId);
  const elementId = selectedElementId ?? localElementId;
  const isExploded = exploded ?? localExploded;
  const selectedRoom = layout.rooms.find((room) => room.id === roomId);
  const selectedObject = layout.objects.find((object) => object.id === elementId);
  const selectedDoor = layout.doors.find((door) => door.id === elementId);
  const selectedWall = layout.walls.find((wall) => wall.id === elementId);
  const relatedFindings = findings.filter((finding) => finding.affectedElementIds.includes(roomId ?? '') || finding.affectedElementIds.includes(elementId ?? ''));

  useEffect(() => { setAvailability(hasWebGL() ? 'ready' : 'unavailable'); }, []);
  useEffect(() => {
    if (availability === 'unavailable' && !reportedUnavailable.current) {
      reportedUnavailable.current = true;
      onUnavailable?.();
    }
  }, [availability, onUnavailable]);
  useEffect(() => { setLocalRoomId(undefined); setLocalElementId(undefined); }, [layout.id]);
  useEffect(() => {
    if (cameraPreset === undefined && focusedRoomId === undefined) return;
    const previous = previousExternalCamera.current;
    const kind: CameraCommand['kind'] = focusedRoomId && focusedRoomId !== previous.focus && cameraPreset === previous.preset
      ? 'room' : cameraPreset === 'top' ? 'top' : cameraPreset === 'entry' ? 'entry' : cameraPreset === 'eye-level' ? 'eye-level' : 'isometric';
    previousExternalCamera.current = { preset: cameraPreset, focus: focusedRoomId };
    setCameraCommand((current) => ({ kind, roomId: kind === 'room' ? focusedRoomId : undefined, version: current.version + 1 }));
  }, [cameraPreset, cameraRequestId, focusedRoomId]);

  const selectRoom = (id: string) => {
    const next = id === roomId ? undefined : id;
    setLocalRoomId(next);
    if (next) onSelectRoom?.(next);
    if (next) onSelectElement?.(next);
  };
  const selectElement = (id: string) => {
    const next = id === elementId ? undefined : id;
    setLocalElementId(next);
    if (next) onSelectElement?.(next);
  };
  const setView = (kind: CameraCommand['kind'], focusRoomId?: string) =>
    setCameraCommand((current) => ({ kind, roomId: focusRoomId, version: current.version + 1 }));
  const toggleExploded = () => {
    const next = !isExploded;
    setLocalExploded(next);
    onExplodedChange?.(next);
  };
  const unavailable = availability === 'unavailable' || !bounds || layout.units !== 'mm';

  return <section className={`adapt-plan3d ${className}`.trim()} aria-label="Three-dimensional plan preview">
    <div className="adapt-plan3d__header">
      <div><span className="adapt-plan3d__eyebrow">Architectural study / 3D</span><h2>Explore the apartment</h2></div>
      <span className="adapt-plan3d__unit">Calibrated layout · mm</span>
    </div>
    {!unavailable && <div className="adapt-plan3d__toolbar" role="toolbar" aria-label="3D view controls">
      <button type="button" onClick={() => setView('isometric')}>Isometric</button>
      <button type="button" onClick={() => setView('top')}>Top view</button>
      <button type="button" onClick={() => setView('isometric')}>Reset camera</button>
      <span className="adapt-plan3d__toolbar-divider" aria-hidden="true" />
      <button type="button" className={isExploded ? 'is-active' : ''} aria-pressed={isExploded} onClick={toggleExploded}>{isExploded ? 'Assemble layers' : 'Explode layers'}</button>
      {selectedRoom && <button type="button" className="adapt-plan3d__focus" onClick={() => setView('room', selectedRoom.id)}>Focus {selectedRoom.label}</button>}
    </div>}
    <div className="adapt-plan3d__viewport">
      {unavailable ? <div className="adapt-plan3d__fallback" role="status"><strong>3D preview unavailable</strong><p>{!bounds || layout.units !== 'mm' ? 'This layout has no usable calibrated geometry.' : 'This device or browser could not start the 3D view.'} Use the 2D plan and findings to inspect the proposal.</p></div>
        : availability === 'checking' ? <div className="adapt-plan3d__fallback" role="status">Preparing 3D preview…</div>
          : <SceneErrorBoundary key={layout.id} onError={() => setAvailability('unavailable')}>
            <Plan3DCanvas layout={layout} bounds={bounds} exploded={isExploded} selectedRoomId={roomId}
              selectedElementId={elementId} selectedFindingId={selectedFindingId} findings={findings}
              onSelectRoom={selectRoom} onSelectElement={selectElement} cameraCommand={cameraCommand}
              zoomRequest={zoomRequest}
              onContextLost={() => setAvailability('unavailable')} />
          </SceneErrorBoundary>}
      <div className="adapt-plan3d__viewport-note" aria-hidden="true">DRAG TO ORBIT <span>·</span> SHIFT + DRAG TO PAN <span>·</span> SCROLL TO ZOOM</div>
    </div>
    <div className="adapt-plan3d__inspector" aria-live="polite">
      <div className="adapt-plan3d__inspector-main">
        <span className="adapt-plan3d__eyebrow">Selection</span>
        <strong>{selectedRoom ? selectedRoom.label : selectedObject ? selectedObject.label : selectedDoor ? 'Door' : selectedWall ? 'Wall' : 'Choose a space'}</strong>
        <span>{roomId ?? elementId ?? 'Select a room or object in the view or list below.'}</span>
      </div>
      {relatedFindings.length > 0 && <ul className="adapt-plan3d__related-findings">
        {relatedFindings.map((finding) => <li key={finding.id}><span className={`adapt-plan3d__status adapt-plan3d__status--${finding.verdict}`}>{finding.verdict}</span>{finding.explanation}</li>)}
      </ul>}
    </div>
    <div className="adapt-plan3d__room-list" aria-label="Select and focus a room">
      {layout.rooms.map((room) => <div className="adapt-plan3d__room-action" key={room.id}>
        <button type="button" aria-pressed={roomId === room.id} onClick={() => selectRoom(room.id)}>{room.label}<small>{room.id}</small></button>
        <button type="button" aria-label={`Focus camera on ${room.label}`} onClick={() => { setLocalRoomId(room.id); onSelectRoom?.(room.id); onSelectElement?.(room.id); setView('room', room.id); }}>Focus</button>
      </div>)}
    </div>
    <p className="adapt-plan3d__caption">Simplified visualization, not a construction model. Wall and object heights, door frames, materials, and the exploded ceiling are presentation details. The layout supplies the plan dimensions. Finding markers identify supplied affected elements; no route geometry or clearance is inferred here.</p>
  </section>;
}

export default Plan3D;
