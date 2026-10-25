import type { Goal, Layout } from '../schemas/layout.js';

export type ConstraintFinding = {
  id: string;
  goalId: string;
  verdict: 'pass' | 'fail' | 'unknown';
  measuredMm?: number;
  requiredMm?: number;
  affectedElementIds: string[];
  explanation: string;
};

export type Proposal = {
  id: string;
  originalLayoutId: string;
  resultLayout: Layout;
  modifications: Array<{
    id: string;
    type: 'resize-demo-door';
    targetElementId: string;
    params: { clearWidthMm: number };
    requiresProfessionalReview: true;
  }>;
  findingsBefore: ConstraintFinding[];
  findingsAfter: ConstraintFinding[];
  costs: [];
  unresolvedQuestions: string[];
};

export function validateLayout(layout: Layout, goals: Goal[]): ConstraintFinding[] {
  return goals.flatMap<ConstraintFinding>((goal) => {
    if (goal.type === 'minimum-door-width') {
      if (layout.doors.length === 0) return [{
        id: `finding-${goal.id}-unmeasured`, goalId: goal.id, verdict: 'unknown' as const,
        requiredMm: goal.targetMm, affectedElementIds: [],
        explanation: 'No modeled door is available for this doorway width goal.',
      }];
      return layout.doors.map((door) => ({
        id: `finding-${goal.id}-${door.id}`, goalId: goal.id,
        verdict: door.clearWidth >= goal.targetMm! ? 'pass' as const : 'fail' as const,
        measuredMm: door.clearWidth, requiredMm: goal.targetMm,
        affectedElementIds: [door.id],
        explanation: `${door.id} has a supplied clear width of ${door.clearWidth} mm; the user goal is ${goal.targetMm} mm.`,
      }));
    }
    return [{
      id: `finding-${goal.id}-unmeasured`, goalId: goal.id, verdict: 'unknown' as const,
      requiredMm: goal.targetMm, affectedElementIds: [],
      explanation: goal.type === 'minimum-path-width'
        ? 'This model has no measured circulation-path geometry, so path width cannot be checked.'
        : 'This model has no measured traversable route graph, so reachability cannot be checked.',
    }];
  });
}

function canFitDoor(layout: Layout, door: Layout['doors'][number], width: number): boolean {
  const wall = layout.walls.find((candidate) => candidate.id === door.wallId);
  if (!wall) return false;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return false;
  const distance = ((door.center.x - wall.start.x) * dx + (door.center.y - wall.start.y) * dy) / length;
  return distance - width / 2 >= 0 && distance + width / 2 <= length;
}

export function generateProposal(layout: Layout, goals: Goal[], _budgetUsd?: number): Proposal {
  const resultLayout: Layout = structuredClone(layout);
  const modifications: Proposal['modifications'] = [];
  const widthTargets = goals.filter((goal) => goal.type === 'minimum-door-width').map((goal) => goal.targetMm!);
  const requestedWidth = widthTargets.length ? Math.max(...widthTargets) : 0;
  const conceptLimitMm = 900;
  const proposedWidth = Math.min(requestedWidth, conceptLimitMm);

  for (const door of resultLayout.doors) {
    if (door.clearWidth >= requestedWidth || !door.editable || proposedWidth <= door.clearWidth) continue;
    if (!canFitDoor(resultLayout, door, proposedWidth)) continue;
    door.clearWidth = proposedWidth;
    modifications.push({
      id: `demo-door-width-${door.id}`, type: 'resize-demo-door', targetElementId: door.id,
      params: { clearWidthMm: proposedWidth }, requiresProfessionalReview: true,
    });
  }

  const unresolvedQuestions = [
    'Wall structure, services, permissions, and construction feasibility have not been assessed.',
    'Route and path clearances require additional measured geometry.',
    'No catalog-backed cost data is available; the budget has not been assessed.',
  ];
  if (requestedWidth > conceptLimitMm) unresolvedQuestions.push(`The requested doorway target exceeds this illustrative model's ${conceptLimitMm} mm edit limit and may remain unsatisfied.`);
  if (requestedWidth > 0 && modifications.length === 0 && resultLayout.doors.some((door) => door.clearWidth < requestedWidth)) {
    unresolvedQuestions.push('Some doorway width goals remain unsatisfied because the supplied doors are not editable or the proposed opening does not fit the modeled wall.');
  }

  return {
    id: `concept-${layout.id}`, originalLayoutId: layout.id, resultLayout,
    modifications, findingsBefore: validateLayout(layout, goals), findingsAfter: validateLayout(resultLayout, goals),
    costs: [], unresolvedQuestions,
  };
}
