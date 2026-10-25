import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { ConstraintFinding, Goal, Layout, Proposal } from '../contracts'

export type Stage = 'plan' | 'goals' | 'review'
export type PlanView = '2d' | '3d'
export type LayoutVerification = 'sample' | 'review-required' | 'confirmed'

export type AppState = {
  stage: Stage
  view: PlanView
  layout?: Layout
  layoutVerification: LayoutVerification
  goals: Goal[]
  description: string
  budgetUsd: string
  selectedFindingId?: string
  selectedElementId?: string
  findingsBefore?: ConstraintFinding[]
  proposal?: Proposal
  showAfter: boolean
}

type Action =
  | { type: 'stage'; value: Stage }
  | { type: 'view'; value: PlanView }
  | { type: 'layout'; value: Layout; verification?: LayoutVerification }
  | { type: 'confirm-layout' }
  | { type: 'description'; value: string }
  | { type: 'budget'; value: string }
  | { type: 'add-goal'; value: Goal }
  | { type: 'edit-goal'; value: Goal }
  | { type: 'remove-goal'; id: string }
  | { type: 'replace-draft-goals'; value: Goal[] }
  | { type: 'confirm-goals' }
  | { type: 'findings'; value: ConstraintFinding[] }
  | { type: 'proposal'; value: Proposal }
  | { type: 'selected-finding'; id?: string }
  | { type: 'selected-element'; id?: string }
  | { type: 'show-after'; value: boolean }

const initialState: AppState = {
  stage: 'plan', view: '2d', goals: [], description: '', budgetUsd: '', showAfter: false, layoutVerification: 'sample',
}

function invalidate(state: AppState): AppState {
  return { ...state, findingsBefore: undefined, proposal: undefined, selectedFindingId: undefined, showAfter: false }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'stage': return { ...state, stage: action.value }
    case 'view': return { ...state, view: action.value }
    case 'layout': return { ...state, layout: action.value, layoutVerification: action.verification ?? 'sample', findingsBefore: undefined, proposal: undefined }
    case 'confirm-layout': {
      if (!state.layout) return state
      const confirm = <T extends { source?: string; confidence?: number }>(element: T): T => element.source === 'ai-inferred' || element.source === 'image-inferred'
        ? { ...element, source: 'user', confidence: undefined }
        : element
      const layout = {
        ...state.layout,
        walls: state.layout.walls.map(confirm),
        doors: state.layout.doors.map(confirm),
        objects: state.layout.objects.map(confirm),
      }
      return { ...invalidate(state), layout, layoutVerification: 'confirmed' }
    }
    case 'description': return { ...state, description: action.value }
    case 'budget': return { ...state, budgetUsd: action.value }
    case 'add-goal': return invalidate({ ...state, goals: [...state.goals, action.value] })
    case 'edit-goal': return invalidate({ ...state, goals: state.goals.map((goal) => goal.id === action.value.id ? { ...action.value, status: 'draft' } : goal) })
    case 'remove-goal': return invalidate({ ...state, goals: state.goals.filter((goal) => goal.id !== action.id) })
    case 'replace-draft-goals': return invalidate({ ...state, goals: [...state.goals.filter((goal) => goal.status === 'confirmed'), ...action.value.map((goal) => ({ ...goal, status: 'draft' as const }))] })
    case 'confirm-goals': return invalidate({ ...state, goals: state.goals.map((goal) => ({ ...goal, status: 'confirmed' })) })
    case 'findings': return { ...state, findingsBefore: action.value, stage: 'review' }
    case 'proposal': return { ...state, proposal: action.value, findingsBefore: action.value.findingsBefore, stage: 'review', showAfter: true }
    case 'selected-finding': return { ...state, selectedFindingId: action.id }
    case 'selected-element': return { ...state, selectedElementId: action.id }
    case 'show-after': return { ...state, showAfter: action.value }
  }
}

const StateContext = createContext<AppState | null>(null)
const DispatchContext = createContext<Dispatch<Action> | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return <StateContext.Provider value={state}><DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider></StateContext.Provider>
}

export function useAppState() {
  const state = useContext(StateContext)
  if (!state) throw new Error('useAppState requires AppStateProvider')
  return state
}

export function useAppDispatch() {
  const dispatch = useContext(DispatchContext)
  if (!dispatch) throw new Error('useAppDispatch requires AppStateProvider')
  return dispatch
}

export const selectActiveLayout = (state: AppState) => state.showAfter && state.proposal ? state.proposal.resultLayout : state.layout
export const selectActiveFindings = (state: AppState) => state.showAfter && state.proposal ? state.proposal.findingsAfter : state.findingsBefore
export const selectAllGoalsConfirmed = (state: AppState) => state.goals.length > 0 && state.goals.every((goal) => goal.status === 'confirmed')
