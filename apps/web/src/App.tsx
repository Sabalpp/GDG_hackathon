import { useEffect, useState } from 'react'
import { adapterMode, generateProposal, interpretRequest, loadSample, validateLayout } from './api/adaptApi'
import type { Goal } from './contracts'
import { Plan2D } from './components/Plan2D'
import { Plan3D } from './components/Plan3D'
import { ImmersiveWorkspace } from './components/ImmersiveWorkspace'
import { ResultsPanel } from './components/ResultsPanel'
import { AppStateProvider, selectActiveFindings, selectActiveLayout, selectAllGoalsConfirmed, useAppDispatch, useAppState, type Stage } from './state/AppState'

const stageLabels: Record<Stage, string> = { plan: 'Plan', goals: 'Your goals', review: 'Review proposal' }
const goalLabels: Record<Goal['type'], string> = {
  'minimum-door-width': 'Minimum doorway width',
  'minimum-path-width': 'Minimum path width',
  'reachable-route': 'Reachable route',
}
const newGoal = (): Goal => ({ id: `goal-${crypto.randomUUID()}`, type: 'minimum-door-width', targetMm: 850, status: 'draft' })

function GoalEditor({ goal }: { goal: Goal }) {
  const dispatch = useAppDispatch()
  const state = useAppState()
  const set = (patch: Partial<Goal>) => dispatch({ type: 'edit-goal', value: { ...goal, ...patch } })
  return <div className="goal-card">
    <div className="goal-card__top"><span className="goal-index">GOAL {state.goals.findIndex((item) => item.id === goal.id) + 1}</span><span className={`goal-status ${goal.status}`}>{goal.status}</span></div>
    <label>Goal type
      <select value={goal.type} onChange={(event) => set({ type: event.target.value as Goal['type'], targetMm: event.target.value === 'reachable-route' ? undefined : goal.targetMm ?? 850 })}>
        {Object.entries(goalLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
    </label>
    {goal.type !== 'reachable-route' && <label>Target width <span className="unit">mm</span>
      <input type="number" min="1" step="10" value={goal.targetMm ?? ''} onChange={(event) => set({ targetMm: event.target.value ? Number(event.target.value) : undefined })} />
    </label>}
    {goal.type === 'reachable-route' && <div className="goal-route">
      <label>From room<select value={goal.fromRoomId ?? ''} onChange={(event) => set({ fromRoomId: event.target.value || undefined })}><option value="">Select room</option>{state.layout?.rooms.map((room) => <option value={room.id} key={room.id}>{room.label}</option>)}</select></label>
      <label>To room<select value={goal.toRoomId ?? ''} onChange={(event) => set({ toRoomId: event.target.value || undefined })}><option value="">Select room</option>{state.layout?.rooms.map((room) => <option value={room.id} key={room.id}>{room.label}</option>)}</select></label>
    </div>}
    <button className="text-button" type="button" onClick={() => dispatch({ type: 'remove-goal', id: goal.id })}>Remove goal</button>
  </div>
}

function Experience() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [busy, setBusy] = useState<'sample' | 'interpret' | 'validate' | 'generate' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const activeLayout = selectActiveLayout(state)
  const activeFindings = selectActiveFindings(state)
  const confirmed = selectAllGoalsConfirmed(state)
  const validGoals = state.goals.every((goal) => goal.type === 'reachable-route'
    ? Boolean(goal.fromRoomId && goal.toRoomId && goal.fromRoomId !== goal.toRoomId)
    : Boolean(goal.targetMm && Number.isFinite(goal.targetMm) && goal.targetMm > 0))

  useEffect(() => {
    let cancelled = false
    setBusy('sample')
    loadSample().then((layout) => {
      if (!cancelled) dispatch({ type: 'layout', value: layout })
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'The sample could not be loaded.')
    }).finally(() => { if (!cancelled) setBusy(null) })
    return () => { cancelled = true }
  }, [dispatch])

  async function run(kind: 'interpret' | 'validate' | 'generate') {
    setBusy(kind); setError(null); setNotice(null)
    try {
      if (kind === 'interpret') {
        if (!state.description.trim()) throw new Error('Describe what you would like to change first.')
        const goals = await interpretRequest(state.description.trim())
        dispatch({ type: 'replace-draft-goals', value: goals })
        setNotice('Review and confirm these draft goals before checking the plan.')
      } else {
        if (!state.layout) throw new Error('The sample layout is not loaded.')
        if (!confirmed) throw new Error('Confirm your goals before running the model.')
        if (kind === 'validate') {
          dispatch({ type: 'findings', value: await validateLayout(state.layout, state.goals) })
        } else {
          dispatch({ type: 'proposal', value: await generateProposal(state.layout, state.goals) })
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This request could not be completed.')
    } finally { setBusy(null) }
  }

  return <div className="app-shell">
    <header className="masthead">
      <div className="brand" aria-label="ADAPT home"><span className="brand-icon">A</span><span>ADAPT<small>SPACE FOR EVERY BODY</small></span></div>
      <div className="masthead__right"><span className="edition">Concept planning studio <span>Ãƒâ€šÃ‚Â·</span> 001</span><span className="sample-badge">SAMPLE PROJECT</span></div>
    </header>
    <main>
      <div className="intro">
        <div><p className="eyebrow">01 / Explore your space</p><h1>A home that<br /><em>works for you.</em></h1></div>
        <p className="intro__copy">Explore accessibility ideas in a calibrated sample apartment. Set your own goals, inspect model findings, and compare a concept proposal.</p>
      </div>
      <nav className="stages" aria-label="Planning stages">
        {(['plan', 'goals', 'review'] as Stage[]).map((stage, index) => <button key={stage} type="button" className={state.stage === stage ? 'active' : ''} onClick={() => dispatch({ type: 'stage', value: stage })} aria-current={state.stage === stage ? 'step' : undefined}><span>0{index + 1}</span>{stageLabels[stage]}</button>)}
      </nav>
      {adapterMode === 'local-demo' && <div className="demo-banner" role="note"><strong>Local sample mode.</strong> Doorway width checks and a bounded doorway concept edit use calibrated demo data. AI interpretation, path measurement, and cost estimates are unavailable.</div>}
      {error && <div className="message message--error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>ÃƒÆ’Ã¢â‚¬â€</button></div>}
      {notice && <div className="message" role="status">{notice}</div>}

      <div className="workspace">
        <div className="workspace__visual">
          <ImmersiveWorkspace
            layout={activeLayout}
            proposal={state.proposal}
            findings={activeFindings}
            view={state.view}
            showAfter={state.showAfter}
            selectedElementId={state.selectedElementId}
            selectedFindingId={state.selectedFindingId}
            onViewChange={(view) => dispatch({ type: 'view', value: view })}
            onShowAfterChange={(value) => dispatch({ type: 'show-after', value })}
            onSelectElement={(id) => dispatch({ type: 'selected-element', id })}
            renderer={Plan3D}
            rendererCapabilities={{ cameraPresets: true, explodedView: true, roomFocus: true, picking: true }}
            loading={busy === 'sample'}
            render2D={activeLayout
              ? <Plan2D layout={activeLayout} findings={activeFindings} selectedElementId={state.selectedElementId} onSelectElement={(id) => dispatch({ type: 'selected-element', id })} mode={state.proposal ? 'before-after' : 'single'} beforeLayout={state.proposal ? state.layout : undefined} beforeFindings={state.proposal ? state.proposal.findingsBefore : undefined} />
              : <div className="plan-slot" role="status">{busy === 'sample' ? 'Loading sample apartment…' : 'The sample layout is unavailable.'}</div>}
          />
        </div>
        <button className="workspace__sidebar-toggle" type="button" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>{sidebarOpen ? 'Hide planning panel' : 'Show planning panel'}</button>
        <aside className={`side-panel ${sidebarOpen ? '' : 'side-panel--collapsed'}`} aria-label="Planning controls">
          {state.stage === 'plan' && <div className="panel-content"><p className="eyebrow">Getting started</p><h2>Start with a real question.</h2><p>This sample apartment is ready to explore. Its coordinates and doorway width are specified in millimeters.</p><div className="stat-pair"><div><strong>{state.layout?.rooms.length ?? 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'}</strong><span>rooms</span></div><div><strong>{state.layout?.doors.length ?? 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'}</strong><span>modeled doorway</span></div></div><button className="primary-button" type="button" onClick={() => dispatch({ type: 'stage', value: 'goals' })}>Set your goals <span>ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â€</span></button><p className="fine-print">This is a sample only. Real-home measurements and site conditions are not verified.</p></div>}
          {state.stage === 'goals' && <div className="panel-content"><p className="eyebrow">Your priorities</p><h2>What would make this space easier?</h2><label className="field-label" htmlFor="description">Describe your needs in your own words</label><textarea id="description" rows={3} placeholder="For example, I need a wider bathroom doorwayÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" value={state.description} onChange={(event) => dispatch({ type: 'description', value: event.target.value })} /><button className="secondary-button" type="button" onClick={() => void run('interpret')} disabled={busy !== null || adapterMode === 'local-demo'}>Interpret request</button>{adapterMode === 'local-demo' && <p className="field-help">AI interpretation is unavailable in local sample mode. Add and edit structured goals manually.</p>}<label className="field-label" htmlFor="budget">Optional planning budget <span>USD</span></label><input id="budget" type="number" min="0" placeholder="e.g. 5000" value={state.budgetUsd} onChange={(event) => dispatch({ type: 'budget', value: event.target.value })} /><p className="field-help">For your reference only; no cost estimate is generated from this entry.</p><div className="goal-heading"><h3>Structured goals</h3><button type="button" className="add-button" onClick={() => dispatch({ type: 'add-goal', value: newGoal() })}>+ Add goal</button></div>{state.goals.length === 0 && <p className="empty-note">No goals yet. Add a structured goal to check the model.</p>}{state.goals.map((goal) => <GoalEditor key={goal.id} goal={goal} />)}{state.goals.length > 0 && <><button className="primary-button" type="button" disabled={!validGoals || confirmed} onClick={() => dispatch({ type: 'confirm-goals' })}>{confirmed ? 'Goals confirmed' : 'Confirm goals'} <span>ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</span></button><p className="field-help">Editing a goal returns it to draft and clears prior findings.</p></>}{confirmed && <button className="secondary-button full-width" type="button" disabled={busy !== null} onClick={() => void run('validate')}>{busy === 'validate' ? 'CheckingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'Check the sample plan'}</button>}</div>}
          {state.stage === 'review' && <div className="panel-content"><p className="eyebrow">The model check</p><h2>What the plan shows.</h2><ResultsPanel goals={state.goals} findingsBefore={state.findingsBefore} proposal={state.proposal} layout={state.layout} selectedFindingId={state.selectedFindingId} onSelectFinding={(id) => { dispatch({ type: 'selected-finding', id }); const finding = activeFindings?.find((item) => item.id === id); dispatch({ type: 'selected-element', id: finding?.affectedElementIds[0] }) }} />{confirmed && <button className="primary-button" type="button" disabled={busy !== null || !state.layout} onClick={() => void run('generate')}>{busy === 'generate' ? 'PreparingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : state.proposal ? 'Regenerate concept' : 'Explore a concept'} <span>ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â€</span></button>}{state.proposal && <p className="field-help">The after view reflects the proposal data. Construction-related edits require qualified professional review.</p>}{!confirmed && <button className="secondary-button full-width" type="button" onClick={() => dispatch({ type: 'stage', value: 'goals' })}>Add and confirm goals</button>}</div>}
        </aside>
      </div>
      <footer className="page-footer"><span>ADAPT / SAMPLE STUDY</span><p>Concept planning only. ADAPT does not determine code compliance, structural safety, medical suitability, construction feasibility, or contractor pricing. Qualified professionals must review construction-related work.</p></footer>
    </main>
  </div>
}

export function App() { return <AppStateProvider><Experience /></AppStateProvider> }

