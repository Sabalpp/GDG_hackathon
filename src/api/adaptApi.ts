import type { ConstraintFinding, Goal, Layout, Proposal } from '../contracts'
import { sampleLayout } from '../data/sampleLayout'

export type InterpretationSuggestion = {
  category: string
  priority: 'high' | 'medium' | 'low'
  room: string | null
  description: string
}

export type InterpretationResponse = {
  status: 'draft'
  goals: InterpretationSuggestion[]
  questions: string[]
  warnings: string[]
}

const configuredUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '')
const baseUrl = configuredUrl
  ? `${configuredUrl}${configuredUrl.endsWith('/api/v1') ? '' : '/api/v1'}`
  : undefined

// A configured API never silently falls back after a failed request. The local
// sample workflow is selected only when no API URL has been configured.
export const adapterMode = baseUrl ? 'api' : 'local-demo'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!baseUrl) throw new Error('No API base URL is configured.')
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('The API could not be reached. Check the service connection and try again.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(payload?.error?.message || `Service request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export async function loadSample(): Promise<Layout> {
  // The calibrated fixture is bundled with the frontend; the API has no sample route.
  return structuredClone(sampleLayout)
}

export async function interpretRequest(description: string): Promise<InterpretationResponse> {
  if (!baseUrl) throw new Error('AI interpretation is unavailable in the local demo. Add goals manually below.')
  const response = await request<unknown>('/requirements/interpret', {
    method: 'POST', body: JSON.stringify({ text: description }),
  })
  if (!response || typeof response !== 'object' || !('status' in response) || response.status !== 'draft'
    || !('goals' in response) || !Array.isArray(response.goals)
    || !response.goals.every((goal: unknown) => goal && typeof goal === 'object' && 'description' in goal && typeof goal.description === 'string')
    || !('questions' in response) || !Array.isArray(response.questions)
    || !('warnings' in response) || !Array.isArray(response.warnings)) {
    throw new Error('The interpretation service returned an unexpected response. No goals were changed.')
  }
  return response as InterpretationResponse
}

function localFindings(layout: Layout, goals: Goal[]): ConstraintFinding[] {
  return goals.map((goal) => {
    if (goal.type === 'minimum-door-width') {
      const door = layout.doors.length === 1 ? layout.doors[0] : undefined
      if (door && goal.targetMm !== undefined) {
        const verdict = door.clearWidth >= goal.targetMm ? 'pass' : 'fail'
        return {
          id: `finding-${goal.id}`,
          goalId: goal.id,
          verdict,
          measuredMm: door.clearWidth,
          requiredMm: goal.targetMm,
          affectedElementIds: [door.id],
          explanation: `${door.id} has a modeled clear width of ${door.clearWidth} mm. The user goal is ${goal.targetMm} mm.`,
        }
      }
    }
    return {
      id: `finding-${goal.id}`,
      goalId: goal.id,
      verdict: 'unknown',
      affectedElementIds: [],
      explanation: goal.type === 'minimum-door-width'
        ? 'The local demo can measure doorway width only when one door and a target width are defined.'
        : 'The local demo does not measure paths or route reachability. A visual plan is not enough to verify this goal.',
    }
  })
}

export async function validateLayout(layout: Layout, goals: Goal[]): Promise<ConstraintFinding[]> {
  if (goals.some((goal) => goal.status !== 'confirmed')) throw new Error('Confirm every goal before validation.')
  if (baseUrl) {
    const findings = await request<unknown>('/layouts/validate', { method: 'POST', body: JSON.stringify({ layout, goals }) })
    if (!Array.isArray(findings) || !findings.every((finding: unknown) =>
      finding && typeof finding === 'object' && 'verdict' in finding
      && ['pass', 'fail', 'unknown'].includes(String(finding.verdict)))) {
      throw new Error('The validation service returned an unexpected result.')
    }
    return findings as ConstraintFinding[]
  }
  return localFindings(layout, goals)
}

export async function generateProposal(layout: Layout, goals: Goal[], budgetUsd?: number): Promise<Proposal> {
  if (goals.some((goal) => goal.status !== 'confirmed')) throw new Error('Confirm every goal before generating a proposal.')
  if (baseUrl) {
    const proposal = await request<unknown>('/proposals/generate', {
      method: 'POST', body: JSON.stringify({ layout, goals, ...(budgetUsd !== undefined ? { budgetUsd } : {}) }),
    })
    if (!proposal || typeof proposal !== 'object' || !('resultLayout' in proposal)
      || !proposal.resultLayout || typeof proposal.resultLayout !== 'object'
      || !('units' in proposal.resultLayout) || proposal.resultLayout.units !== 'mm'
      || !('findingsBefore' in proposal) || !Array.isArray(proposal.findingsBefore)
      || !('findingsAfter' in proposal) || !Array.isArray(proposal.findingsAfter)) {
      throw new Error('The proposal service returned an unexpected result.')
    }
    return proposal as Proposal
  }
  if (layout.id !== sampleLayout.id) throw new Error('Local demo proposals are available only for the bundled sample.')

  const resultLayout = structuredClone(layout)
  const door = resultLayout.doors.length === 1 ? resultLayout.doors[0] : undefined
  const widthGoals = goals.filter((goal) => goal.type === 'minimum-door-width' && goal.targetMm !== undefined)
  const desiredWidth = Math.max(0, ...widthGoals.map((goal) => goal.targetMm!))
  const modifications: Proposal['modifications'] = []
  const unresolvedQuestions = [
    'Wall structure, services, and construction feasibility have not been assessed.',
    'Route and path clearances require additional measured geometry.',
  ]

  // This is a bounded concept edit in the calibrated fixture, not a feasibility claim.
  if (door && desiredWidth > door.clearWidth) {
    const proposedWidth = Math.min(desiredWidth, 900)
    door.clearWidth = proposedWidth
    modifications.push({
      id: 'demo-door-width',
      type: 'resize-demo-door',
      targetElementId: door.id,
      params: { clearWidthMm: proposedWidth },
      requiresProfessionalReview: true,
    })
    if (desiredWidth > 900) unresolvedQuestions.push('The requested doorway width exceeds the local demo edit limit of 900 mm and remains unsatisfied.')
  }

  return {
    id: 'local-demo-proposal',
    originalLayoutId: layout.id,
    resultLayout,
    modifications,
    findingsBefore: localFindings(layout, goals),
    findingsAfter: localFindings(resultLayout, goals),
    costs: [],
    unresolvedQuestions,
  }
}
