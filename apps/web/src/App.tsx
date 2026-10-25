import { useEffect, useState } from 'react'
import { adapterMode, analyzeFloorPlan, generateProposal, interpretRequest, loadSample, validateLayout, type FloorPlanAnalysisResponse, type InterpretationResponse } from './api/adaptApi'
import type { Goal } from './contracts'
import { Plan2D } from './components/Plan2D'
import { Plan3D } from './components/Plan3D'
import { ResultsPanel } from './components/ResultsPanel'
import { AppStateProvider, selectActiveFindings, selectActiveLayout, selectAllGoalsConfirmed, useAppDispatch, useAppState } from './state/AppState'
import './reference.css'

const goalLabels: Record<Goal['type'], string> = {
  'minimum-door-width': 'Minimum doorway width',
  'minimum-path-width': 'Minimum clear path',
  'reachable-route': 'Reachable route',
}
const ideas: { icon: string; title: string; description: string; type: Goal['type']; targetMm?: number }[] = [
  { icon: 'door_front', title: 'Wider doorway', description: 'Set a doorway width goal', type: 'minimum-door-width', targetMm: 850 },
  { icon: 'straighten', title: 'Clear circulation', description: 'Explore a path width goal', type: 'minimum-path-width', targetMm: 900 },
  { icon: 'route', title: 'Connected rooms', description: 'Check a route in the model', type: 'reachable-route' },
]
const makeGoal = (type: Goal['type'] = 'minimum-door-width', targetMm?: number): Goal => ({ id: `goal-${crypto.randomUUID()}`, type, targetMm, status: 'draft' })

function Symbol({ name }: { name: string }) { return <span className="material-symbols-outlined" aria-hidden="true">{name}</span> }

function GoalEditor({ goal }: { goal: Goal }) {
  const dispatch = useAppDispatch()
  const state = useAppState()
  const edit = (patch: Partial<Goal>) => dispatch({ type: 'edit-goal', value: { ...goal, ...patch } })
  return <div className="adapt-goal-card">
    <div className="adapt-goal-card__head"><strong>{goalLabels[goal.type]}</strong><span>{goal.status}</span></div>
    <label>Goal type<select value={goal.type} onChange={(event) => edit({ type: event.target.value as Goal['type'], targetMm: event.target.value === 'reachable-route' ? undefined : goal.targetMm ?? 850 })}>{Object.entries(goalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {goal.type === 'reachable-route' ? <div className="adapt-goal-card__route">
      <label>From room<select value={goal.fromRoomId ?? ''} onChange={(event) => edit({ fromRoomId: event.target.value || undefined })}><option value="">Select a room</option>{state.layout?.rooms.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}</select></label>
      <label>To room<select value={goal.toRoomId ?? ''} onChange={(event) => edit({ toRoomId: event.target.value || undefined })}><option value="">Select a room</option>{state.layout?.rooms.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}</select></label>
    </div> : <label>Target width (mm)<input type="number" min="1" step="10" value={goal.targetMm ?? ''} onChange={(event) => edit({ targetMm: event.target.value ? Number(event.target.value) : undefined })} /></label>}
    <button type="button" className="adapt-text-button" onClick={() => dispatch({ type: 'remove-goal', id: goal.id })}>Remove goal</button>
  </div>
}

function Experience() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [busy, setBusy] = useState<'sample' | 'interpret' | 'validate' | 'generate' | 'analyze' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [interpretation, setInterpretation] = useState<InterpretationResponse | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>()
  const [cameraRequestId, setCameraRequestId] = useState(0)
  const [zoomRequest, setZoomRequest] = useState<{ direction: 'in' | 'out'; version: number }>()
  const [fullScreen, setFullScreen] = useState(false)
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [planPreviewUrl, setPlanPreviewUrl] = useState<string>()
  const [planWidthMm, setPlanWidthMm] = useState('')
  const [planHeightMm, setPlanHeightMm] = useState('')
  const [planAnalysis, setPlanAnalysis] = useState<FloorPlanAnalysisResponse | null>(null)
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const activeLayout = selectActiveLayout(state)
  const workspaceTitle = state.layoutVerification !== 'sample' && planFile
    ? planFile.name.replace(/\.[^.]+$/, '')
    : 'Sample apartment'
  const activeFindings = selectActiveFindings(state)
  const confirmed = selectAllGoalsConfirmed(state)
  const validGoals = state.goals.length > 0 && state.goals.every((goal) => goal.type === 'reachable-route'
    ? Boolean(goal.fromRoomId && goal.toRoomId && goal.fromRoomId !== goal.toRoomId)
    : Boolean(goal.targetMm && Number.isFinite(goal.targetMm) && goal.targetMm > 0))

  useEffect(() => {
    let cancelled = false
    setBusy('sample')
    loadSample().then((layout) => { if (!cancelled) { dispatch({ type: 'layout', value: layout }); dispatch({ type: 'view', value: '3d' }) } })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'The sample could not be loaded.') })
      .finally(() => { if (!cancelled) setBusy(null) })
    return () => { cancelled = true }
  }, [dispatch])
  useEffect(() => {
    if (!planFile) { setPlanPreviewUrl(undefined); return }
    const url = URL.createObjectURL(planFile)
    setPlanPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [planFile])
  useEffect(() => {
    if (!fullScreen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullScreen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullScreen])

  function addIdea(type: Goal['type'], targetMm?: number) {
    dispatch({ type: 'add-goal', value: makeGoal(type, targetMm) })
    dispatch({ type: 'stage', value: 'goals' })
    setNotice('Idea added as a draft goal. Review and confirm its target before checking the layout.')
  }
  async function interpret() {
    if (!state.description.trim()) { setError('Describe the change you have in mind first.'); return }
    setBusy('interpret'); setError(null); setNotice(null)
    try {
      const response = await interpretRequest(state.description.trim())
      setInterpretation(response)
      dispatch({ type: 'stage', value: 'goals' })
      setNotice('Interpretation is a draft. Add measurable goals below, then review and confirm them.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The interpretation service is unavailable.')
      dispatch({ type: 'stage', value: 'goals' })
    } finally { setBusy(null) }
  }
  function selectPlan(file: File | null) {
    setPlanFile(file)
    setPlanAnalysis(null)
    setReviewAcknowledged(false)
  }
  async function loadPlanSample(fileName: string, width: number, height: number) {
    setError(null)
    try {
      const response = await fetch(`/sample-floor-plans/${fileName}`)
      if (!response.ok) throw new Error('The sample floor plan could not be loaded.')
      const file = new File([await response.blob()], fileName, { type: 'image/svg+xml' })
      selectPlan(file)
      setPlanWidthMm(String(width))
      setPlanHeightMm(String(height))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sample floor plan could not be loaded.')
    }
  }
  async function analyzePlan() {
    if (!planFile) { setError('Choose a floor-plan image or load one of the provided samples.'); return }
    const width = Number(planWidthMm)
    const height = Number(planHeightMm)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 500 || height < 500) {
      setError('Enter the overall width and height printed on the floor plan, in millimeters.')
      return
    }
    setBusy('analyze'); setError(null); setNotice(null)
    try {
      const result = await analyzeFloorPlan(planFile, width, height)
      setPlanAnalysis(result)
      setReviewAcknowledged(false)
      dispatch({ type: 'layout', value: result.layout, verification: 'review-required' })
      dispatch({ type: 'view', value: '2d' })
      dispatch({ type: 'stage', value: 'plan' })
      setNotice('The detected layout is shown in the plan view. Review its geometry before confirming the drawing measurements.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The floor plan could not be analyzed.')
    } finally { setBusy(null) }
  }
  function confirmAnalyzedPlan() {
    dispatch({ type: 'confirm-layout' })
    setReviewAcknowledged(false)
    setNotice('Plan geometry confirmed. Any measurements describe the supplied drawing, not verified conditions in the home.')
  }
  async function generate() {
    if (!state.layout) { setError('The sample layout is not available.'); return }
    if (state.layoutVerification === 'review-required') {
      setError('Review the extracted room outlines, walls, door locations, and overall dimensions before checking this plan.')
      dispatch({ type: 'stage', value: 'plan' })
      return
    }
    if (!confirmed) {
      if (adapterMode === 'api' && state.description.trim() && !interpretation && state.goals.length === 0) { await interpret(); return }
      dispatch({ type: 'stage', value: 'goals' })
      setNotice('Add a measurable goal and confirm it before generating a concept.')
      return
    }
    setBusy('generate'); setError(null); setNotice(null)
    try {
      const findings = await validateLayout(state.layout, state.goals)
      dispatch({ type: 'findings', value: findings })
      const budget = state.budgetUsd ? Number(state.budgetUsd) : undefined
      const proposal = await generateProposal(state.layout, state.goals, budget)
      dispatch({ type: 'proposal', value: proposal })
      setNotice('Concept generated from confirmed goals. Compare Standard and Adapted, then review the findings.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The concept could not be generated.')
      dispatch({ type: 'stage', value: 'review' })
    } finally { setBusy(null) }
  }
  async function checkGoals() {
    if (!state.layout) return
    if (state.layoutVerification === 'review-required') {
      setError('Review and confirm the extracted plan geometry before checking it.')
      dispatch({ type: 'stage', value: 'plan' })
      return
    }
    setBusy('validate'); setError(null)
    try { dispatch({ type: 'findings', value: await validateLayout(state.layout, state.goals) }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The model check failed.') }
    finally { setBusy(null) }
  }

  const currentStage = state.stage
  return <div className="adapt-app">
    <header className="adapt-header"><div className="adapt-header__inner"><div className="adapt-brand"><strong>ADAPT</strong><i aria-hidden="true" /><span>ACCESSIBLE SPACES</span></div><span className="adapt-level">Level 01</span></div></header>
    <main className="adapt-main"><div className="adapt-grid">
      <section className="adapt-workspace" aria-label="Apartment workspace">
        <div className="adapt-title-row"><div><h1>{workspaceTitle}</h1><p>{state.showAfter && state.proposal ? 'Adapted concept proposal' : 'Standard floor plan'} <span>· {state.layoutVerification === 'sample' ? 'Calibrated sample in mm' : 'Plan-derived geometry in mm'}</span></p></div>
          <div className="adapt-segment" role="group" aria-label="Floor plan mode"><button type="button" aria-pressed={!state.showAfter} onClick={() => dispatch({ type: 'show-after', value: false })}>Standard</button><button type="button" aria-pressed={state.showAfter && !!state.proposal} disabled={!state.proposal} onClick={() => dispatch({ type: 'show-after', value: true })} title={!state.proposal ? 'Generate a concept first' : undefined}>Adapted</button></div></div>
        <div className={`adapt-model-card${fullScreen ? ' adapt-model-card--fullscreen' : ''}`}>
          <div className="adapt-model-card__view">{activeLayout ? state.view === '3d' ? <Plan3D layout={activeLayout} findings={activeFindings} selectedRoomId={selectedRoomId} selectedElementId={state.selectedElementId} selectedFindingId={state.selectedFindingId} onSelectRoom={setSelectedRoomId} onSelectElement={(id) => dispatch({ type: 'selected-element', id })} cameraPreset="overview" cameraRequestId={cameraRequestId} focusedRoomId={selectedRoomId} zoomRequest={zoomRequest} onUnavailable={() => dispatch({ type: 'view', value: '2d' })} className="adapt-reference-viewer" /> : <Plan2D layout={activeLayout} findings={activeFindings} selectedElementId={state.selectedElementId} onSelectElement={(id) => dispatch({ type: 'selected-element', id })} mode={state.proposal && state.showAfter ? 'before-after' : 'single'} beforeLayout={state.proposal && state.showAfter ? state.layout : undefined} beforeFindings={state.proposal && state.showAfter ? state.proposal.findingsBefore : undefined} className="adapt-reference-plan2d" /> : <div className="adapt-model-empty" role="status">{busy === 'sample' ? 'Loading sample apartment…' : 'Sample geometry is unavailable.'}</div>}</div>
          <div className="adapt-camera-controls" role="toolbar" aria-label="Viewer controls">{state.view === '3d' && <><button type="button" aria-label="Zoom in" onClick={() => setZoomRequest((previous) => ({ direction: 'in', version: (previous?.version ?? 0) + 1 }))}><Symbol name="add" /></button><button type="button" aria-label="Zoom out" onClick={() => setZoomRequest((previous) => ({ direction: 'out', version: (previous?.version ?? 0) + 1 }))}><Symbol name="remove" /></button><button type="button" aria-label="Reset camera" onClick={() => setCameraRequestId((id) => id + 1)}><Symbol name="refresh" /></button></>}<button type="button" aria-label={fullScreen ? 'Exit expanded view' : 'Expand viewer'} onClick={() => setFullScreen((value) => !value)}><Symbol name={fullScreen ? 'close_fullscreen' : 'open_in_full'} /></button></div>
          <div className="adapt-view-tabs" role="group" aria-label="View type"><button type="button" aria-pressed={state.view === '3d'} onClick={() => dispatch({ type: 'view', value: '3d' })}>3D view</button><button type="button" aria-pressed={state.view === '2d'} onClick={() => dispatch({ type: 'view', value: '2d' })}>2D plan</button></div>
          {state.view === '3d' && <span className="adapt-orbit-hint">Drag to rotate · Pinch or scroll to zoom</span>}
        </div>
        <p className="adapt-model-disclosure">Simplified visualization of the supplied layout, not a construction model. Wall heights and finishes are illustrative.</p>
        <div className="adapt-section-heading"><strong>Select Space</strong><span>{selectedRoomId ? activeLayout?.rooms.find((room) => room.id === selectedRoomId)?.label : 'Suite View'}</span></div>
        <div className="adapt-room-chips" role="group" aria-label="Select a room"><button type="button" aria-pressed={!selectedRoomId} onClick={() => { setSelectedRoomId(undefined); dispatch({ type: 'selected-element', id: undefined }); setCameraRequestId((id) => id + 1) }}>All Rooms</button>{activeLayout?.rooms.map((room) => <button type="button" key={room.id} aria-pressed={selectedRoomId === room.id} onClick={() => { setSelectedRoomId(room.id); dispatch({ type: 'selected-element', id: room.id }); setCameraRequestId((id) => id + 1) }}>{room.label}</button>)}</div>
      </section>
      <aside className="adapt-sidebar" aria-label="Planning controls">
        <div className="adapt-sidebar__top"><span className="adapt-sidebar__eyebrow">YOUR PLANNING STUDIO</span><h2>{currentStage === 'plan' ? 'A space that fits your life.' : currentStage === 'goals' ? 'Shape your goals.' : 'Review the concept.'}</h2><p>{currentStage === 'plan' ? 'Choose an idea or describe what you need. The calibrated sample is ready to explore.' : currentStage === 'goals' ? 'Set measurable targets and confirm them before the model checks the layout.' : 'See measured outcomes and what remains unknown.'}</p></div>
        <section className="adapt-floorplan-upload" aria-labelledby="adapt-upload-heading">
          <div className="adapt-floorplan-upload__heading"><div><span className="adapt-sidebar__eyebrow">START WITH A DRAWING</span><h3 id="adapt-upload-heading">Analyze a floor plan</h3></div><Symbol name="upload_file" /></div>
          <p className="adapt-floorplan-upload__intro">Upload a clear, straight-on PNG, JPEG, or SVG with dark wall lines. Enter its printed outside dimensions to scale the detected layout. Room names and furniture are not read.</p>
          <label className="adapt-floorplan-upload__file">Choose floor-plan image<input type="file" accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg" onChange={(event) => selectPlan(event.target.files?.[0] ?? null)} /></label>
          {planFile && <div className="adapt-floorplan-upload__selected"><span>{planFile.name}</span>{planPreviewUrl && <img src={planPreviewUrl} alt="Preview of selected floor plan" />}</div>}
          <div className="adapt-floorplan-upload__dimensions"><label>Overall width (mm)<input type="number" min="500" max="100000" step="100" value={planWidthMm} onChange={(event) => setPlanWidthMm(event.target.value)} placeholder="e.g. 12000" /></label><label>Overall height (mm)<input type="number" min="500" max="100000" step="100" value={planHeightMm} onChange={(event) => setPlanHeightMm(event.target.value)} placeholder="e.g. 8000" /></label></div>
          <button type="button" className="adapt-floorplan-upload__analyze" disabled={busy !== null} onClick={() => void analyzePlan()}>{busy === 'analyze' ? 'Analyzing drawing…' : 'Analyze floor plan'}<Symbol name="auto_awesome" /></button>
          <div className="adapt-floorplan-upload__samples" aria-label="Sample floor plans"><span>Try a sample:</span><button type="button" disabled={busy !== null} onClick={() => void loadPlanSample('two-bedroom-apartment.svg', 12000, 8000)}>Two-bedroom apartment</button><button type="button" disabled={busy !== null} onClick={() => void loadPlanSample('compact-one-bedroom.svg', 9000, 6000)}>Compact one-bedroom</button></div>
          {planAnalysis && <div className="adapt-floorplan-upload__review" role="status">
            <strong>{state.layoutVerification === 'confirmed' ? 'Plan geometry confirmed' : 'Image analysis draft · review required'}</strong>
            <span>{planAnalysis.layout.rooms.length} rooms · {planAnalysis.layout.walls.length} walls · {planAnalysis.layout.doors.length} doors · {planAnalysis.layout.objects.length} objects</span>
            {planAnalysis.notes.map((note, index) => <small key={index}>{note}</small>)}
            {state.layoutVerification === 'review-required' && <><label className="adapt-floorplan-upload__confirm"><input type="checkbox" checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.target.checked)} /><span>I reviewed the 2D plan and checked its room outlines, door locations, and overall dimensions against the drawing.</span></label><button type="button" disabled={!reviewAcknowledged} onClick={confirmAnalyzedPlan}>Confirm reviewed drawing</button></>}
            {state.layoutVerification === 'confirmed' && <small>Checks describe measurements from this drawing; they do not verify the physical home.</small>}
          </div>}
          <small className="adapt-floorplan-upload__privacy">Detected geometry is an estimate until you review it against the original drawing.</small>
        </section>
        {adapterMode === 'local-demo' && <div className="adapt-local-banner" role="note"><strong>Sample mode</strong><span>AI interpretation and geometry checks need the API services. Enter goals manually; findings remain unknown until geometry is connected.</span></div>}
        {error && <div className="adapt-message adapt-message--error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="adapt-message" role="status">{notice}</div>}
        {currentStage === 'plan' && <div className="adapt-panel-section"><div className="adapt-section-heading"><strong>Key Adaptations</strong><span>Ideas to explore</span></div><div className="adapt-idea-list">{ideas.map((idea) => <button key={idea.title} type="button" className="adapt-idea" onClick={() => addIdea(idea.type, idea.targetMm)}><span className="adapt-idea__icon"><Symbol name={idea.icon} /></span><span className="adapt-idea__copy"><strong>{idea.title}</strong><small>{idea.description}</small></span><span className="adapt-idea__add" aria-hidden="true">+</span></button>)}</div></div>}
        {currentStage === 'goals' && <div className="adapt-panel-section adapt-goals">{interpretation && <div className="adapt-interpretation"><strong>Draft interpretation</strong><p>These themes are suggestions, not measured layout goals.</p><ul>{interpretation.goals.map((item, index) => <li key={`${item.category}-${index}`}>{item.description} <small>{item.priority} priority{item.room ? ` · ${item.room.replaceAll('_', ' ')}` : ''}</small></li>)}</ul>{interpretation.questions.length > 0 && <p><b>Questions:</b> {interpretation.questions.join(' ')}</p>}{interpretation.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}<div className="adapt-section-heading"><strong>Structured goals</strong><button type="button" onClick={() => dispatch({ type: 'add-goal', value: makeGoal('minimum-door-width', 850) })}>+ Add goal</button></div>{state.goals.length === 0 && <p className="adapt-empty">No measurable goals yet. Add one to check the sample.</p>}{state.goals.map((goal) => <GoalEditor key={goal.id} goal={goal} />)}{state.goals.length > 0 && <button type="button" className="adapt-secondary-action" disabled={!validGoals || confirmed} onClick={() => { dispatch({ type: 'confirm-goals' }); setNotice('Goals confirmed. Run the model check or generate a concept.') }}>{confirmed ? 'Goals confirmed' : 'Confirm goals'}</button>}{confirmed && <button type="button" className="adapt-secondary-action" disabled={busy !== null} onClick={() => void checkGoals()}>{busy === 'validate' ? 'Checking…' : 'Check model findings'}</button>}<p className="adapt-helper">Targets are your planning goals, not legal requirements. Editing a goal returns it to draft.</p></div>}
        {currentStage === 'review' && <div className="adapt-panel-section adapt-review"><ResultsPanel goals={state.goals} findingsBefore={state.findingsBefore} proposal={state.proposal} layout={state.layout} selectedFindingId={state.selectedFindingId} onSelectFinding={(id) => { dispatch({ type: 'selected-finding', id }); const finding = activeFindings?.find((item) => item.id === id); dispatch({ type: 'selected-element', id: finding?.affectedElementIds[0] }) }} /><button className="adapt-secondary-action" type="button" onClick={() => dispatch({ type: 'stage', value: 'goals' })}>Edit goals</button></div>}
        <div className="adapt-composer"><label htmlFor="adapt-request">Describe changes to explore</label><textarea id="adapt-request" rows={2} value={state.description} onChange={(event) => dispatch({ type: 'description', value: event.target.value })} placeholder="Describe any specific changes…" /><label className="adapt-budget-label" htmlFor="adapt-budget">Optional budget (USD)</label><input id="adapt-budget" type="number" min="0" value={state.budgetUsd} onChange={(event) => dispatch({ type: 'budget', value: event.target.value })} placeholder="e.g. 12000" /><button type="button" className="adapt-generate" disabled={busy !== null || !state.layout} onClick={() => void generate()}>{busy === 'generate' ? 'Generating concept…' : busy === 'interpret' ? 'Interpreting request…' : 'Generate Redesign'}<Symbol name="arrow_forward" /></button></div>
      </aside>
    </div><p className="adapt-limitations">ADAPT creates concept proposals. It does not determine code compliance, structural safety, medical suitability, construction feasibility, or contractor pricing. Qualified professionals must review construction-related work.</p></main>
    <nav className="adapt-bottom-nav" aria-label="Application sections"><button type="button" aria-current={currentStage === 'plan' ? 'page' : undefined} onClick={() => dispatch({ type: 'stage', value: 'plan' })}><Symbol name="home_work" /><span>Spaces</span></button><button type="button" aria-current={currentStage === 'goals' ? 'page' : undefined} onClick={() => dispatch({ type: 'stage', value: 'goals' })}><Symbol name="tune" /><span>Goals</span></button><button type="button" aria-current={currentStage === 'review' ? 'page' : undefined} onClick={() => dispatch({ type: 'stage', value: 'review' })}><Symbol name="fact_check" /><span>Review</span></button></nav>
  </div>
}

export function App() { return <AppStateProvider><Experience /></AppStateProvider> }
