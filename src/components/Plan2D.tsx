import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { ConstraintFinding, Layout, Point2D, Verdict } from '../contracts';
import './Plan2D.css';

type Point = Point2D;
export type Plan2DLayout = Layout;
export type Plan2DFinding = ConstraintFinding;

export type Plan2DProps = {
  layout: Plan2DLayout;
  findings?: Plan2DFinding[];
  selectedElementId?: string;
  onSelectElement?: (id: string) => void;
  mode?: 'single' | 'before-after';
  beforeLayout?: Plan2DLayout;
  beforeFindings?: Plan2DFinding[];
  className?: string;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type ElementRef = { id: string; label: string; kind: string; anchor: Point };

const verdictLabel: Record<Verdict, string> = {
  pass: 'Passed in this model',
  fail: 'Needs attention',
  unknown: 'Unknown / not measured',
};
const verdictGlyph: Record<Verdict, string> = { pass: '✓', fail: '!', unknown: '?' };
const verdictRank: Record<Verdict, number> = { pass: 0, unknown: 1, fail: 2 };

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function validPoint(point: Point): boolean {
  return finite(point.x) && finite(point.y);
}

function getBounds(layouts: Plan2DLayout[]): Bounds | null {
  const points: Point[] = [];
  for (const layout of layouts) {
    for (const room of layout.rooms ?? []) points.push(...room.polygon);
    for (const wall of layout.walls ?? []) points.push(wall.start, wall.end);
    for (const door of layout.doors ?? []) points.push(door.center);
    for (const object of layout.objects ?? []) {
      const { x, y, width, height } = object.bounds;
      points.push({ x, y }, { x: x + width, y: y + height });
    }
  }
  const good = points.filter(validPoint);
  if (!good.length) return null;
  const minX = Math.min(...good.map((point) => point.x));
  const maxX = Math.max(...good.map((point) => point.x));
  const minY = Math.min(...good.map((point) => point.y));
  const maxY = Math.max(...good.map((point) => point.y));
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

function polygonCenter(polygon: Point[]): Point {
  if (!polygon.length) return { x: 0, y: 0 };
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) > 0.001) return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
  return {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  };
}

function elements(layout: Plan2DLayout): ElementRef[] {
  return [
    ...(layout.rooms ?? []).filter((room) => room.polygon.length >= 3).map((room) => ({ id: room.id, label: room.label, kind: 'Room', anchor: polygonCenter(room.polygon) })),
    ...(layout.walls ?? []).map((wall) => ({ id: wall.id, label: wall.id, kind: 'Wall', anchor: { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 } })),
    ...(layout.doors ?? []).map((door) => ({ id: door.id, label: door.id, kind: 'Door', anchor: door.center })),
    ...(layout.objects ?? []).map((object) => ({ id: object.id, label: object.label, kind: object.kind === 'fixture' ? 'Fixture' : 'Furniture', anchor: { x: object.bounds.x + object.bounds.width / 2, y: object.bounds.y + object.bounds.height / 2 } })),
  ];
}

function verdictFor(id: string, findings: Plan2DFinding[]): Verdict | undefined {
  return findings.filter((finding) => finding.affectedElementIds.includes(id))
    .map((finding) => finding.verdict)
    .sort((a, b) => verdictRank[b] - verdictRank[a])[0];
}

function pointOnWall(wall: Plan2DLayout['walls'][number], t: number): Point {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  };
}

function wallSegments(wall: Plan2DLayout['walls'][number], doors: Plan2DLayout['doors']): [Point, Point][] {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return [];
  const intervals = doors.filter((door) => door.wallId === wall.id && door.clearWidth > 0 && validPoint(door.center))
    .map((door) => {
      const projected = ((door.center.x - wall.start.x) * dx + (door.center.y - wall.start.y) * dy) / length;
      return [Math.max(0, (projected - door.clearWidth / 2) / length), Math.min(1, (projected + door.clearWidth / 2) / length)] as [number, number];
    })
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0]);
  const result: [Point, Point][] = [];
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (start > cursor) result.push([pointOnWall(wall, cursor), pointOnWall(wall, start)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1) result.push([pointOnWall(wall, cursor), wall.end]);
  return result;
}

function findingText(finding: Plan2DFinding): string {
  const measurements = [
    finding.measuredMm === undefined ? null : `Measured ${finding.measuredMm.toLocaleString()} mm`,
    finding.requiredMm === undefined ? null : `Goal ${finding.requiredMm.toLocaleString()} mm`,
  ].filter(Boolean).join(' · ');
  return measurements ? `${finding.explanation} ${measurements}.` : finding.explanation;
}

type PaneProps = {
  layout: Plan2DLayout;
  findings: Plan2DFinding[];
  bounds: Bounds;
  heading: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  patternId: string;
};

function PlanPane({ layout, findings, bounds, heading, selectedId, onSelect, patternId }: PaneProps) {
  const refs = elements(layout);
  const refById = new Map(refs.map((item) => [item.id, item]));
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const margin = Math.max(300, extent * 0.075);
  const viewWidth = bounds.maxX - bounds.minX + 2 * margin;
  const viewHeight = bounds.maxY - bounds.minY + 2 * margin;
  const badgeRadius = Math.max(95, extent * 0.018);
  const fontSize = Math.max(135, extent * 0.026);
  const roomFontSize = Math.max(170, extent * 0.032);
  const select = (id: string) => onSelect(id);
  const keySelect = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(id);
    }
  };
  return (
    <section className="adapt-plan2d__pane" aria-label={`${heading} floor plan`}>
      <div className="adapt-plan2d__pane-heading">
        <h3>{heading}</h3>
        <span>{layout.id}</span>
      </div>
      <svg className="adapt-plan2d__svg" viewBox={`${bounds.minX - margin} ${bounds.minY - margin} ${viewWidth} ${viewHeight}`} role="img" aria-label={`${heading} floor plan in millimeters. Select an item in the list below for details.`}>
        <defs>
          <pattern id={patternId} width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="120" stroke="currentColor" strokeWidth="25" />
          </pattern>
        </defs>
        <rect x={bounds.minX - margin} y={bounds.minY - margin} width={viewWidth} height={viewHeight} className="adapt-plan2d__paper" />
        {(layout.rooms ?? []).filter((room) => room.polygon.length >= 3 && room.polygon.every(validPoint)).map((room) => {
          const center = polygonCenter(room.polygon);
          const status = verdictFor(room.id, findings);
          return <g key={room.id} role="button" tabIndex={0} aria-label={`Room ${room.label}${status ? `, ${verdictLabel[status]}` : ''}`} onClick={() => select(room.id)} onKeyDown={(event) => keySelect(event, room.id)} className={`adapt-plan2d__selectable${selectedId === room.id ? ' is-selected' : ''}`}>
            <polygon points={room.polygon.map((point) => `${point.x},${point.y}`).join(' ')} className="adapt-plan2d__room" />
            <text x={center.x} y={center.y} fontSize={roomFontSize} className="adapt-plan2d__room-label">{room.label}</text>
          </g>;
        })}
        {(layout.walls ?? []).filter((wall) => validPoint(wall.start) && validPoint(wall.end) && wall.thickness > 0).map((wall) => {
          const status = verdictFor(wall.id, findings);
          return <g key={wall.id} role="button" tabIndex={0} aria-label={`Wall ${wall.id}${status ? `, ${verdictLabel[status]}` : ''}`} onClick={() => select(wall.id)} onKeyDown={(event) => keySelect(event, wall.id)} className={`adapt-plan2d__selectable${selectedId === wall.id ? ' is-selected' : ''}`}>
            {wallSegments(wall, layout.doors ?? []).map(([a, b], index) => <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={wall.thickness} className="adapt-plan2d__wall" />)}
          </g>;
        })}
        {(layout.doors ?? []).filter((door) => validPoint(door.center) && door.clearWidth > 0).map((door) => {
          const wall = layout.walls.find((candidate) => candidate.id === door.wallId);
          if (!wall) return null;
          const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
          const half = door.clearWidth / 2;
          const x1 = door.center.x - Math.cos(angle) * half;
          const y1 = door.center.y - Math.sin(angle) * half;
          const x2 = door.center.x + Math.cos(angle) * half;
          const y2 = door.center.y + Math.sin(angle) * half;
          const status = verdictFor(door.id, findings);
          return <g key={door.id} role="button" tabIndex={0} aria-label={`Door ${door.id}, clear width ${door.clearWidth} millimeters${status ? `, ${verdictLabel[status]}` : ''}`} onClick={() => select(door.id)} onKeyDown={(event) => keySelect(event, door.id)} className={`adapt-plan2d__selectable${selectedId === door.id ? ' is-selected' : ''}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={Math.max(55, wall.thickness * 0.28)} className="adapt-plan2d__door" />
            <circle cx={door.center.x} cy={door.center.y} r={Math.max(half * 0.16, 65)} className="adapt-plan2d__door-center" />
          </g>;
        })}
        {(layout.objects ?? []).filter((object) => finite(object.bounds.x) && finite(object.bounds.y) && object.bounds.width > 0 && object.bounds.height > 0).map((object) => {
          const status = verdictFor(object.id, findings);
          const { x, y, width, height } = object.bounds;
          return <g key={object.id} role="button" tabIndex={0} aria-label={`${object.kind} ${object.label}${status ? `, ${verdictLabel[status]}` : ''}`} onClick={() => select(object.id)} onKeyDown={(event) => keySelect(event, object.id)} className={`adapt-plan2d__selectable${selectedId === object.id ? ' is-selected' : ''}`}>
            <rect x={x} y={y} width={width} height={height} rx={Math.min(90, width * 0.08, height * 0.08)} className={`adapt-plan2d__object adapt-plan2d__object--${object.kind}`} />
            <text x={x + width / 2} y={y + height / 2} fontSize={fontSize} className="adapt-plan2d__object-label">{object.label}</text>
          </g>;
        })}
        {refs.filter((item) => verdictFor(item.id, findings)).map((item) => {
          const verdict = verdictFor(item.id, findings)!;
          return <g key={`badge-${item.id}`} className={`adapt-plan2d__badge adapt-plan2d__badge--${verdict}`} aria-hidden="true" onClick={() => select(item.id)}>
            <circle cx={item.anchor.x} cy={item.anchor.y - badgeRadius * 1.4} r={badgeRadius} />
            {verdict === 'unknown' && <circle cx={item.anchor.x} cy={item.anchor.y - badgeRadius * 1.4} r={badgeRadius} fill={`url(#${patternId})`} className="adapt-plan2d__unknown-pattern" />}
            <text x={item.anchor.x} y={item.anchor.y - badgeRadius * 1.4} fontSize={badgeRadius * 1.3}>{verdictGlyph[verdict]}</text>
          </g>;
        })}
        <g className="adapt-plan2d__scale" aria-hidden="true">
          <line x1={bounds.minX} y1={bounds.maxY + margin * 0.57} x2={bounds.minX + 1000} y2={bounds.maxY + margin * 0.57} strokeWidth={Math.max(20, extent * 0.004)} />
          <line x1={bounds.minX} y1={bounds.maxY + margin * 0.48} x2={bounds.minX} y2={bounds.maxY + margin * 0.66} strokeWidth={Math.max(20, extent * 0.004)} />
          <line x1={bounds.minX + 1000} y1={bounds.maxY + margin * 0.48} x2={bounds.minX + 1000} y2={bounds.maxY + margin * 0.66} strokeWidth={Math.max(20, extent * 0.004)} />
          <text x={bounds.minX + 500} y={bounds.maxY + margin * 0.43} fontSize={fontSize}>1,000 mm</text>
        </g>
      </svg>
      <div className="adapt-plan2d__dimensions">Plan extent: {(bounds.maxX - bounds.minX).toLocaleString()} × {(bounds.maxY - bounds.minY).toLocaleString()} mm · SVG geometry uses the supplied millimeter coordinates.</div>
      <div className="adapt-plan2d__details">
        <h4>Findings in this view</h4>
        {findings.length ? <ul className="adapt-plan2d__finding-list">{findings.map((finding) => <li key={finding.id}>
          <button type="button" className={`adapt-plan2d__finding adapt-plan2d__finding--${finding.verdict}`} onClick={() => { const first = finding.affectedElementIds.find((id) => refById.has(id)); if (first) select(first); }}>
            <span className="adapt-plan2d__finding-mark" aria-hidden="true">{verdictGlyph[finding.verdict]}</span>
            <span><strong>{verdictLabel[finding.verdict]}</strong><small>{findingText(finding)}{finding.affectedElementIds.length ? ` Affects: ${finding.affectedElementIds.join(', ')}.` : ''}</small></span>
          </button>
        </li>)}</ul> : <p>No validation findings supplied for this layout.</p>}
        <h4>Plan elements</h4>
        <ul className="adapt-plan2d__element-list">{refs.map((item) => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} onClick={() => select(item.id)}><span>{item.kind}: {item.label}</span><code>{item.id}</code>{verdictFor(item.id, findings) && <em>{verdictLabel[verdictFor(item.id, findings)!]}</em>}</button></li>)}</ul>
      </div>
    </section>
  );
}

export function Plan2D({ layout, findings = [], selectedElementId, onSelectElement, mode = 'single', beforeLayout, beforeFindings = [], className = '' }: Plan2DProps) {
  const [localSelectedId, setLocalSelectedId] = useState<string>();
  const selectedId = selectedElementId ?? localSelectedId;
  const prefix = useId().replace(/:/g, '');
  const comparison = mode === 'before-after' && !!beforeLayout;
  const bounds = useMemo(() => getBounds(comparison ? [beforeLayout!, layout] : [layout]), [comparison, beforeLayout, layout]);
  const allElements = useMemo(() => [...(comparison ? elements(beforeLayout!) : []), ...elements(layout)], [comparison, beforeLayout, layout]);
  const selected = allElements.find((item) => item.id === selectedId);
  const selectedFindings = [
    ...(comparison ? beforeFindings.map((finding) => ({ finding, stage: 'Before' })) : []),
    ...findings.map((finding) => ({ finding, stage: comparison ? 'After' : 'Current layout' })),
  ].filter(({ finding }) => finding.affectedElementIds.includes(selectedId ?? ''));
  const select = (id: string) => { setLocalSelectedId(id); onSelectElement?.(id); };

  if (layout?.units !== 'mm' || !bounds) {
    return <section className={`adapt-plan2d adapt-plan2d--empty ${className}`} role="status"><h2>Plan unavailable</h2><p>This layout has no usable calibrated geometry in millimeters. Add a calibrated layout to inspect rooms and measurements. An image alone cannot establish scale or clearances.</p></section>;
  }

  return <section className={`adapt-plan2d ${className}`} aria-label="Two-dimensional floor plan">
    <div className="adapt-plan2d__intro"><div><p className="adapt-plan2d__eyebrow">Calibrated plan · mm</p><h2>{comparison ? 'Before & after' : 'Floor plan'}</h2></div><p>Illustrative model view. Select a marked item or use the lists beneath each plan to read its findings.</p></div>
    {mode === 'before-after' && !beforeLayout && <p className="adapt-plan2d__notice" role="status">The original layout is unavailable, so only the current layout is shown.</p>}
    <div className={`adapt-plan2d__grid${comparison ? ' adapt-plan2d__grid--comparison' : ''}`}>
      {comparison && <PlanPane layout={beforeLayout!} findings={beforeFindings} bounds={bounds} heading="Before" selectedId={selectedId} onSelect={select} patternId={`${prefix}-before-unknown`} />}
      <PlanPane layout={layout} findings={findings} bounds={bounds} heading={comparison ? 'After' : 'Current layout'} selectedId={selectedId} onSelect={select} patternId={`${prefix}-after-unknown`} />
    </div>
    <aside className="adapt-plan2d__selection" aria-live="polite">
      {selected ? <><h3>{selected.kind}: {selected.label}</h3><p className="adapt-plan2d__selection-id">Element ID: {selected.id}</p>{selectedFindings.length ? selectedFindings.map(({ finding, stage }) => <p key={`${stage}-${finding.id}`}><strong>{stage} · {verdictLabel[finding.verdict]}.</strong> {findingText(finding)}</p>) : <p>No finding is linked to this element.</p>}</> : <p>Select a plan element to inspect its linked findings and measurements.</p>}
    </aside>
    <p className="adapt-plan2d__footnote">Status and measurements come from supplied findings. The drawing does not validate a route, establish construction feasibility, or determine compliance.</p>
  </section>;
}

export default Plan2D;
