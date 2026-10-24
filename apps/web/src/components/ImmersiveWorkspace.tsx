import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import type { ConstraintFinding, Layout, Proposal } from '../contracts'
import { roomContents, roomFindings } from './roomInspectorData'
import './ImmersiveWorkspace.css'

export type CameraPreset = 'overview' | 'top' | 'entry' | 'eye-level'

/** Optional renderer controls. All IDs and geometry refer to the supplied Layout. */
export type WorkspaceRendererProps = {
  layout: Layout
  className?: string
  onUnavailable?: () => void
  findings?: ConstraintFinding[]
  selectedFindingId?: string
  selectedRoomId?: string
  cameraPreset?: CameraPreset
  cameraRequestId?: number
  exploded?: boolean
  onExplodedChange?: (exploded: boolean) => void
  focusedRoomId?: string
  selectedElementId?: string
  onSelectElement?: (id: string) => void
  onSelectRoom?: (id: string) => void
}

export type RendererCapabilities = {
  cameraPresets?: boolean
  explodedView?: boolean
  roomFocus?: boolean
  picking?: boolean
}

export type ImmersiveWorkspaceProps = {
  layout?: Layout
  proposal?: Proposal
  findings?: ConstraintFinding[]
  view: '2d' | '3d'
  showAfter: boolean
  selectedElementId?: string
  selectedFindingId?: string
  onViewChange: (view: '2d' | '3d') => void
  onShowAfterChange: (showAfter: boolean) => void
  onSelectElement: (id?: string) => void
  render2D: ReactNode
  renderer: ComponentType<WorkspaceRendererProps>
  rendererCapabilities?: RendererCapabilities
  loading?: boolean
}

function statusLabel(verdict: ConstraintFinding['verdict']) {
  return verdict === 'pass' ? 'Passed in this model' : verdict === 'fail' ? 'Needs attention' : 'Unknown / not measured'
}

export function ImmersiveWorkspace({ layout, proposal, findings, view, showAfter, selectedElementId, selectedFindingId, onViewChange, onShowAfterChange, onSelectElement, render2D, renderer: Renderer, rendererCapabilities = {}, loading = false }: ImmersiveWorkspaceProps) {
  const [expanded, setExpanded] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('overview')
  const [cameraRequestId, setCameraRequestId] = useState(0)
  const [exploded, setExploded] = useState(false)
  const [focusedRoomId, setFocusedRoomId] = useState<string | undefined>()
  const [threeUnavailable, setThreeUnavailable] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const expandButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previousAfter = useRef(showAfter)

  const selectedRoomId = useMemo(() => {
    if (!layout || !selectedElementId) return undefined
    if (layout.rooms.some((room) => room.id === selectedElementId)) return selectedElementId
    return layout.rooms.find((room) => roomContents(layout, room.id).ids.includes(selectedElementId))?.id
  }, [layout, selectedElementId])
  const selectedRoom = layout?.rooms.find((room) => room.id === selectedRoomId)
  const contents = layout && selectedRoom ? roomContents(layout, selectedRoom.id) : undefined
  const relatedFindings = roomFindings(findings, contents?.ids ?? [])
  const modifications = proposal?.modifications ?? []

  useEffect(() => {
    if (!expanded) return
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setExpanded(false)
        expandButton.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  useEffect(() => {
    if (previousAfter.current === showAfter) return
    previousAfter.current = showAfter
    setTransitioning(true)
    const timeout = window.setTimeout(() => setTransitioning(false), 420)
    return () => window.clearTimeout(timeout)
  }, [showAfter])

  function requestCamera(preset: CameraPreset) {
    setCameraPreset(preset)
    setCameraRequestId((id) => id + 1)
  }

  function chooseRoom(id: string) {
    onSelectElement(id)
    setInspectorOpen(true)
  }

  return <section className={`immersive-workspace${expanded ? ' immersive-workspace--expanded' : ''}`} aria-label="Apartment design workspace">
    <div className="immersive-workspace__heading">
      <div><p className="immersive-workspace__kicker">The calibrated space / {layout?.units ?? 'mm'}</p><h2>Sample apartment</h2></div>
      <div className="immersive-workspace__heading-actions">
        <div className="immersive-workspace__segmented" role="group" aria-label="Plan view">
          <button type="button" aria-pressed={view === '2d'} onClick={() => onViewChange('2d')}>2D plan</button>
          <button type="button" aria-pressed={view === '3d'} onClick={() => onViewChange('3d')}>3D model</button>
        </div>
        <button ref={expandButton} type="button" className="immersive-workspace__expand" onClick={() => setExpanded(true)} aria-label="Expand apartment workspace">⤢ <span>Expand</span></button>
        {expanded && <button ref={closeButton} type="button" className="immersive-workspace__close" onClick={() => { setExpanded(false); expandButton.current?.focus() }}>Close <span aria-hidden="true">×</span></button>}
      </div>
    </div>

    <div className="immersive-workspace__stage">
      <div className={`immersive-workspace__viewport${transitioning ? ' immersive-workspace__viewport--transitioning' : ''}`}>
        {layout ? <>
          <div className="immersive-workspace__view immersive-workspace__view--2d" hidden={view !== '2d'}>{render2D}</div>
          <div className="immersive-workspace__view immersive-workspace__view--3d" hidden={view !== '3d'}>
            <Renderer layout={layout} className="immersive-workspace__renderer" onUnavailable={() => setThreeUnavailable(true)} findings={findings} selectedFindingId={selectedFindingId} selectedRoomId={selectedRoomId} cameraPreset={cameraPreset} cameraRequestId={cameraRequestId} exploded={exploded} onExplodedChange={setExploded} focusedRoomId={focusedRoomId} selectedElementId={selectedElementId} onSelectElement={onSelectElement} onSelectRoom={chooseRoom} />
          </div>
        </> : <div className="immersive-workspace__empty" role="status">{loading ? 'Loading the calibrated apartment…' : 'The sample layout is unavailable.'}</div>}
        {transitioning && <div className="immersive-workspace__transition" aria-hidden="true" />}
        <div className="immersive-workspace__viewport-label">{showAfter && proposal ? '02 / Proposed model' : '01 / Current apartment'} <span>Concept study</span></div>
        {view === '3d' && threeUnavailable && <div className="immersive-workspace__fallback" role="status">3D is unavailable here. <button type="button" onClick={() => onViewChange('2d')}>Open the 2D plan</button> to inspect the same layout and findings.</div>}
        {view === '3d' && !threeUnavailable && <div className="immersive-workspace__toolbar" role="toolbar" aria-label="3D controls">
          <span className="immersive-workspace__toolbar-label">Camera</span>
          {(['overview', 'top', 'entry', 'eye-level'] as CameraPreset[]).map((preset) => <button key={preset} type="button" aria-pressed={cameraPreset === preset} disabled={!rendererCapabilities.cameraPresets} onClick={() => requestCamera(preset)} title={!rendererCapabilities.cameraPresets ? 'Camera controls await the enhanced renderer' : undefined}>{preset === 'eye-level' ? 'Eye level' : preset[0].toUpperCase() + preset.slice(1)}</button>)}
          <span className="immersive-workspace__toolbar-divider" />
          <button type="button" disabled={!rendererCapabilities.cameraPresets} onClick={() => requestCamera('overview')}>Reset</button>
          <button type="button" aria-pressed={exploded} disabled={!rendererCapabilities.explodedView} onClick={() => setExploded((value) => !value)}>Exploded</button>
        </div>}
      </div>

      <aside className={`immersive-workspace__inspector${inspectorOpen ? '' : ' immersive-workspace__inspector--collapsed'}`} aria-label="Room inspector">
        <div className="immersive-workspace__inspector-head"><span>Room inspector</span><button type="button" onClick={() => setInspectorOpen((value) => !value)} aria-expanded={inspectorOpen} aria-label={inspectorOpen ? 'Collapse room inspector' : 'Expand room inspector'}>{inspectorOpen ? '−' : '+'}</button></div>
        {inspectorOpen && <div className="immersive-workspace__inspector-body">
          {selectedRoom && contents ? <>
            <p className="immersive-workspace__inspector-kicker">Selected space · {selectedRoom.id}</p>
            <h3>{selectedRoom.label}</h3>
            <div className="immersive-workspace__room-actions">
              <button type="button" onClick={() => { setFocusedRoomId(selectedRoom.id); setCameraRequestId((id) => id + 1) }} disabled={view !== '3d' || !rendererCapabilities.roomFocus}>Focus room</button>
              <button type="button" onClick={() => onViewChange('2d')}>View in 2D</button>
              <button type="button" onClick={() => onSelectElement(undefined)}>Clear</button>
            </div>
            <div className="immersive-workspace__inspector-section"><h4>Doorways <span>{contents.doors.length}</span></h4>{contents.doors.length ? <ul>{contents.doors.map((door) => <li key={door.id}><button type="button" onClick={() => onSelectElement(door.id)}>{door.id}</button><span>{door.clearWidth.toLocaleString()} mm supplied width</span></li>)}</ul> : <p>None in the supplied layout.</p>}</div>
            <div className="immersive-workspace__inspector-section"><h4>Furniture & fixtures <span>{contents.objects.length}</span></h4>{contents.objects.length ? <ul>{contents.objects.map((object) => <li key={object.id}><button type="button" onClick={() => onSelectElement(object.id)}>{object.label}</button><span>{object.kind}</span></li>)}</ul> : <p>None in the supplied layout.</p>}</div>
            <div className="immersive-workspace__inspector-section"><h4>Model findings <span>{relatedFindings.length}</span></h4>{relatedFindings.length ? <ul>{relatedFindings.map((finding) => <li key={finding.id} className={`immersive-workspace__finding immersive-workspace__finding--${finding.verdict}`}><strong>{statusLabel(finding.verdict)}</strong><span>{finding.explanation}</span>{(finding.measuredMm !== undefined || finding.requiredMm !== undefined) && <small>{finding.measuredMm !== undefined ? `Measured ${finding.measuredMm.toLocaleString()} mm` : ''}{finding.measuredMm !== undefined && finding.requiredMm !== undefined ? ' · ' : ''}{finding.requiredMm !== undefined ? `Goal ${finding.requiredMm.toLocaleString()} mm` : ''}</small>}</li>)}</ul> : <p>No findings are associated with this room's modeled elements.</p>}</div>
          </> : <><h3>Select a room</h3><p>Choose a room below or in the plan to inspect its modeled contents and findings.</p></>}
          <div className="immersive-workspace__room-list" role="group" aria-label="Choose a room">{layout?.rooms.map((room) => <button key={room.id} type="button" aria-pressed={selectedRoomId === room.id} onClick={() => chooseRoom(room.id)}>{room.label}<span>↗</span></button>)}</div>
        </div>}
      </aside>
    </div>

    <div className="immersive-workspace__bottom">
      {proposal && <div className="immersive-workspace__compare" role="group" aria-label="Compare apartment layouts"><span>Compare</span><button type="button" aria-pressed={!showAfter} onClick={() => onShowAfterChange(false)}>Before <small>current</small></button><button type="button" aria-pressed={showAfter} onClick={() => onShowAfterChange(true)}>After <small>concept</small></button></div>}
      <div className="immersive-workspace__meta"><span>{layout ? `${layout.rooms.length} rooms · ${layout.doors.length} modeled doorway${layout.doors.length === 1 ? '' : 's'}` : 'Layout unavailable'}</span><span>Simplified visualization · not a construction model</span></div>
    </div>
    {proposal && <details className="immersive-workspace__changes"><summary>Proposed modification highlights <span>{modifications.length}</span></summary>{modifications.length ? <ul>{modifications.map((modification) => <li key={modification.id}><button type="button" aria-pressed={selectedElementId === modification.targetElementId} onClick={() => onSelectElement(modification.targetElementId)}><strong>{modification.type.replaceAll('-', ' ')}</strong><span>{modification.targetElementId}</span></button>{modification.requiresProfessionalReview && <em>Professional review required</em>}</li>)}</ul> : <p>No modifications are supplied with this proposal.</p>}</details>}
  </section>
}

export default ImmersiveWorkspace
