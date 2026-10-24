import { costLinesFromCatalog, type CostCatalogItem } from '@adapt/report-ui'
import costCatalog from '../../../../data/sample-cost-catalog.json'
import type { ConstraintFinding, Goal, Layout, Proposal } from '../contracts'
import { sampleLayout } from '../data/sampleLayout'

// `npm run dev:full` (mode "full") and production builds talk to /api/v1 on the same origin;
// plain `npm run dev` with no VITE_API_BASE_URL stays in the offline local demo.
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?? (import.meta.env.MODE === 'full' ? '/api/v1' : undefined)
const baseUrl = configured?.replace(/\/$/, '')
export const adapterMode = baseUrl ? 'api' : 'local-demo'

/** Illustrative, user-editable default. Not a code requirement. */
export const DEFAULT_TARGET_MM = 900

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!baseUrl) throw new Error('No API base URL is configured.')
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new Error('The ADAPT service could not be reached. No checks were run, so nothing is marked as passing.')
  }
  const body = await response.json().catch(() => undefined) as { error?: { message?: string; code?: string } } | undefined
  if (!response.ok) {
    if (response.status >= 500) {
      const what = path.startsWith('/requirements') ? 'AI interpretation is' : 'Validation is'
      throw new Error(`${what} unavailable right now (${body?.error?.code ?? response.status}). Nothing is marked as passing. You can still add goals manually.`)
    }
    throw new Error(body?.error?.message ?? `The request was rejected (${response.status}).`)
  }
  return body as T
}

export async function loadSample(): Promise<Layout> {
  if (baseUrl) return (await request<{ layout: Layout }>('/samples/apartment')).layout
  return structuredClone(sampleLayout)
}

// ---------------------------------------------------------------------------
// Requirement interpretation
// ---------------------------------------------------------------------------

export type Interpretation = { goals: Goal[]; questions: string[]; warnings: string[]; model?: string }

type CategoryGoal = { category: string; priority?: string; room?: string | null; description?: string }
type InterpretResponse = { goals: (Goal | CategoryGoal)[]; questions?: string[]; warnings?: string[]; model?: string }

const isSpecGoal = (goal: Goal | CategoryGoal): goal is Goal => 'type' in goal

/** Finds a layout room for a coarse room word such as "bathroom" or "living_room". */
function findRoom(layout: Layout, word?: string | null) {
  if (!word) return undefined
  const key = word.replace(/_room$/, '').replace(/_/g, ' ')
  return layout.rooms.find((room) => room.id === word)
    ?? layout.rooms.find((room) => room.id.replace(/-/g, ' ') === key)
    ?? layout.rooms.find((room) => room.label.toLowerCase().includes(key))
}

/**
 * Maps the API's category-level drafts onto the geometry contract. Only the goal *type* and
 * *rooms* come from the model; the width is an editable default, so no AI-invented numbers.
 * Remove once /requirements/interpret returns spec-shaped goals (those pass straight through).
 */
export function toGeometryGoals(drafts: CategoryGoal[], layout: Layout): { goals: Goal[]; unmodeled: string[] } {
  const origin = findRoom(layout, 'bedroom') ?? layout.rooms[0]
  const goals: Goal[] = []
  const unmodeled: string[] = []
  const seen = new Set<string>()
  const add = (goal: Omit<Goal, 'id' | 'status'>) => {
    const key = `${goal.type}:${goal.fromRoomId ?? ''}:${goal.toRoomId ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    goals.push({ ...goal, id: `goal-${goals.length + 1}-${goal.type}`, status: 'draft' })
  }
  const routeTo = (roomWord: string | null | undefined) => {
    const target = findRoom(layout, roomWord)
    if (origin && target && target.id !== origin.id) {
      add({ type: 'minimum-path-width', targetMm: DEFAULT_TARGET_MM, fromRoomId: origin.id, toRoomId: target.id })
      return true
    }
    return false
  }

  for (const draft of drafts) {
    switch (draft.category) {
      case 'bathroom_access': if (!routeTo('bathroom')) unmodeled.push(draft.category); break
      case 'kitchen_access': if (!routeTo('kitchen')) unmodeled.push(draft.category); break
      case 'easier_circulation':
        if (!routeTo(draft.room)) add({ type: 'minimum-path-width', targetMm: DEFAULT_TARGET_MM })
        break
      case 'step_free_access':
      case 'transfer_support':
        add({ type: 'minimum-door-width', targetMm: DEFAULT_TARGET_MM })
        break
      default:
        unmodeled.push(draft.category)
    }
  }
  return { goals, unmodeled: [...new Set(unmodeled)] }
}

export async function interpretRequest(description: string, layout: Layout): Promise<Interpretation> {
  if (!baseUrl) throw new Error('AI interpretation is unavailable in the local demo. Add goals manually below.')
  const response = await request<InterpretResponse>('/requirements/interpret', {
    method: 'POST',
    body: JSON.stringify({ text: description }),
  })
  const questions = response.questions ?? []
  const warnings = response.warnings ?? []
  if (response.goals.every(isSpecGoal)) {
    return { goals: response.goals.map((goal) => ({ ...goal, status: 'draft' })), questions, warnings, model: response.model }
  }
  const { goals, unmodeled } = toGeometryGoals(response.goals.filter((goal) => !isSpecGoal(goal)) as CategoryGoal[], layout)
  if (goals.length > 0) warnings.unshift(`Widths default to ${DEFAULT_TARGET_MM} mm as an illustrative starting point. Edit them to match your needs.`)
  if (unmodeled.length > 0) warnings.push(`Not checked by the geometry model: ${unmodeled.map((c) => c.replace(/_/g, ' ')).join(', ')}.`)
  return { goals, questions, warnings, model: response.model }
}

// ---------------------------------------------------------------------------
// Validation and proposals
// ---------------------------------------------------------------------------

function localFindings(layout: Layout, goals: Goal[]): ConstraintFinding[] {
  return goals.flatMap((goal): ConstraintFinding[] => {
    if (goal.type === 'minimum-door-width' && goal.targetMm !== undefined) {
      return layout.doors.map((door) => ({
        id: `finding-${goal.id}-${door.id}`,
        goalId: goal.id,
        verdict: door.clearWidth == null ? 'unknown' : door.clearWidth >= goal.targetMm! ? 'pass' : 'fail',
        measuredMm: door.clearWidth ?? undefined,
        requiredMm: goal.targetMm,
        affectedElementIds: [door.id],
        explanation: `${door.id} has a modeled clear width of ${door.clearWidth} mm. The user goal is ${goal.targetMm} mm.`,
      }))
    }
    return [{
      id: `finding-${goal.id}`,
      goalId: goal.id,
      verdict: 'unknown',
      affectedElementIds: [],
      explanation: goal.type === 'minimum-door-width'
        ? 'The local demo can measure doorway width only when a target width is defined.'
        : 'The local demo does not measure paths or route reachability. A visual plan is not enough to verify this goal.',
    }]
  })
}

function withCatalogCosts(proposal: Proposal): Proposal {
  if (proposal.costs.length > 0) return proposal
  // Same deterministic table Express uses; never model-generated.
  return { ...proposal, costs: costLinesFromCatalog(proposal.modifications, costCatalog.items as CostCatalogItem[]) }
}

export async function validateLayout(layout: Layout, goals: Goal[]): Promise<ConstraintFinding[]> {
  if (goals.some((goal) => goal.status !== 'confirmed')) throw new Error('Confirm every goal before validation.')
  if (baseUrl) {
    return (await request<{ findings: ConstraintFinding[] }>('/layouts/validate', { method: 'POST', body: JSON.stringify({ layout, goals }) })).findings
  }
  return localFindings(layout, goals)
}

export async function generateProposal(layout: Layout, goals: Goal[], budgetUsd?: number): Promise<Proposal> {
  if (goals.some((goal) => goal.status !== 'confirmed')) throw new Error('Confirm every goal before generating a proposal.')
  if (baseUrl) {
    const budget = budgetUsd !== undefined && Number.isFinite(budgetUsd) && budgetUsd >= 0 ? { currency: 'USD', max: budgetUsd } : undefined
    const { proposals } = await request<{ proposals: Proposal[] }>('/proposals/generate', {
      method: 'POST',
      body: JSON.stringify(budget ? { layout, goals, budget } : { layout, goals }),
    })
    if (!proposals[0]) throw new Error('The planner returned no proposal.')
    return withCatalogCosts(proposals[0])
  }
  if (layout.id !== sampleLayout.id) throw new Error('Local demo proposals are available only for the bundled sample.')

  const resultLayout = structuredClone(layout)
  const widthGoals = goals.filter((goal) => goal.type === 'minimum-door-width' && goal.targetMm !== undefined)
  const desiredWidth = Math.max(0, ...widthGoals.map((goal) => goal.targetMm!))
  const modifications: Proposal['modifications'] = []
  const unresolvedQuestions = [
    'Wall structure, services, and construction feasibility have not been assessed.',
    'Route and path clearances require additional measured geometry.',
  ]

  // Bounded concept edit on editable sample doors only, not a feasibility claim.
  for (const door of resultLayout.doors) {
    if (!door.editable || door.clearWidth == null || desiredWidth <= door.clearWidth) continue
    const proposedWidth = Math.min(desiredWidth, 900)
    door.clearWidth = proposedWidth
    modifications.push({
      id: `demo-door-width-${door.id}`,
      type: 'resize-demo-door',
      targetElementId: door.id,
      params: { clearWidth: proposedWidth },
      requiresProfessionalReview: true,
    })
  }
  if (desiredWidth > 900) unresolvedQuestions.push('The requested doorway width exceeds the local demo edit limit of 900 mm and remains unsatisfied.')

  return withCatalogCosts({
    id: 'local-demo-proposal',
    originalLayoutId: layout.id,
    resultLayout,
    modifications,
    findingsBefore: localFindings(layout, goals),
    findingsAfter: localFindings(resultLayout, goals),
    costs: [],
    unresolvedQuestions,
  })
}
