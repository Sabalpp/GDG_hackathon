import type { ConstraintFinding, Goal, Layout, Proposal } from '../contracts'

// Agent 1 fallback slots. Agents 2–4 can replace these imports in App.tsx with
// their dedicated components without changing shared state or data contracts.
export type Plan2DProps = {
  layout: Layout
  findings?: ConstraintFinding[]
  selectedElementId?: string
  onSelectElement?: (id: string) => void
  mode?: 'single' | 'before-after'
  beforeLayout?: Layout
}
export type Plan3DProps = { layout: Layout; onUnavailable?: () => void; className?: string }
export type ResultsPanelProps = { goals: Goal[]; findingsBefore?: ConstraintFinding[]; proposal?: Proposal; layout?: Layout; selectedFindingId?: string; onSelectFinding?: (id: string) => void }

export function Plan2DSlot({ layout, findings = [], selectedElementId, onSelectElement }: Plan2DProps) {
  const points = layout.rooms.flatMap((room) => room.polygon)
  const width = points.length ? Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) : undefined
  const height = points.length ? Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) : undefined
  return <div className="plan-slot" aria-label="Plan data summary">
    <div className="plan-slot__mark">ADAPT <span>/ 01</span></div>
    <div className="plan-slot__center">
      <p className="eyebrow">Calibrated sample · millimeters</p>
      <h3>Apartment plan</h3>
      <p>The canonical layout is loaded. The detailed 2D drawing will appear here when the plan viewer is connected.</p>
      <div className="element-list" aria-label="Layout elements">
        {layout.rooms.map((room) => <span key={room.id}>{room.label}</span>)}
      </div>
      <div className="element-list" aria-label="Select modeled elements">
        {layout.doors.map((door) => <button className={selectedElementId === door.id ? 'is-selected' : ''} key={door.id} onClick={() => onSelectElement?.(door.id)}>{door.id} · {door.clearWidth} mm</button>)}
        {layout.objects.map((object) => <button className={selectedElementId === object.id ? 'is-selected' : ''} key={object.id} onClick={() => onSelectElement?.(object.id)}>{object.label}</button>)}
      </div>
      {findings.length > 0 && <p className="slot-note">{findings.length} model finding{findings.length === 1 ? '' : 's'} available in the review column.</p>}
    </div>
    <div className="plan-slot__foot">{width !== undefined && height !== undefined ? `${width} × ${height} mm` : 'Dimensions unavailable'} <span>Sample geometry</span></div>
  </div>
}

export function Plan3DSlot({ layout }: Plan3DProps) {
  return <div className="plan-slot plan-slot--3d" role="status">
    <div className="plan-slot__mark">ADAPT <span>/ 3D</span></div>
    <div className="plan-slot__center">
      <p className="eyebrow">Simplified visualization</p>
      <h3>3D preview pending</h3>
      <p>The 3D viewer has not been connected. Use the 2D plan and text findings to inspect this {layout.units} layout.</p>
    </div>
  </div>
}

export function ResultsPanelSlot({ findingsBefore, proposal, selectedFindingId, onSelectFinding }: ResultsPanelProps) {
  const findings = proposal?.findingsAfter ?? findingsBefore
  return <div className="results-slot">
    {!findings ? <p>Confirm goals and run the model check to see findings.</p> : findings.length === 0 ? <p>No findings are available.</p> : (
      <ul className="finding-list">{findings.map((finding) => <li key={finding.id} className={`finding finding--${finding.verdict}`}>
        <button className="finding-select" type="button" aria-pressed={selectedFindingId === finding.id} onClick={() => onSelectFinding?.(finding.id)}>
          <strong>{finding.verdict === 'pass' ? 'Passed in this model' : finding.verdict === 'fail' ? 'Needs attention' : 'Unknown / not measured'}</strong>
          <span>{finding.explanation}</span>
        </button>
      </li>)}</ul>
    )}
    {proposal && <p className="slot-note">{proposal.modifications.length} concept edit{proposal.modifications.length === 1 ? '' : 's'} · No cost estimate available</p>}
  </div>
}
