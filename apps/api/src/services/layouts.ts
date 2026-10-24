import { createGeometryClient, GeometryError, type GeometryClientOptions } from './geometry.js';
import { validateLayoutRequestSchema, validateLayoutResponseSchema, type ValidateLayoutRequest, type ValidateLayoutResponse } from '../schemas/layouts.js';

export interface LayoutValidationOptions extends GeometryClientOptions { path?: string }

export async function validateLayout(input: ValidateLayoutRequest, options: LayoutValidationOptions = {}) {
  const request = validateLayoutRequestSchema.parse(input);
  request.goals = request.goals.filter((goal) => goal.status === 'confirmed');
  const path = options.path ?? process.env.GEOMETRY_VALIDATE_PATH ?? '/api/v1/layouts/validate';
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(path)) {
    throw new GeometryError(503, 'GEOMETRY_NOT_CONFIGURED', 'Geometry validation path is invalid.');
  }
  const client = createGeometryClient({ path, request: validateLayoutRequestSchema, response: validateLayoutResponseSchema }, options);
  const result = await client(request);
  return assertLayoutValidationResult(request, result);
}

// Shared integrity checks for validator responses and proposal before/after findings.
export function assertLayoutValidationResult(request: ValidateLayoutRequest, result: ValidateLayoutResponse) {
  const invalid = () => { throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned inconsistent or incomplete findings.'); };
  const goals = new Map(request.goals.map((goal) => [goal.id, goal]));
  const elements = new Set([...request.layout.walls, ...request.layout.doors, ...request.layout.objects, ...request.layout.rooms].map((item) => item.id));
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const finding of result.findings) {
    const goal = goals.get(finding.goalId);
    const integrity = finding.goalId === 'layout-integrity';
    if ((!goal && !integrity) || seen.has(finding.id) || new Set(finding.affectedElementIds).size !== finding.affectedElementIds.length || finding.affectedElementIds.some((id) => !elements.has(id))) invalid();
    seen.add(finding.id);
    covered.add(finding.goalId);
    if (integrity) {
      if (finding.requiredMm !== undefined || finding.measuredMm !== undefined) invalid();
      continue;
    }
    if (finding.requiredMm !== undefined && finding.requiredMm !== goal!.targetMm) invalid();
    if (goal!.type === 'minimum-door-width' && finding.verdict !== 'unknown') {
      const door = request.layout.doors.find((door) => finding.affectedElementIds.length === 1 && door.id === finding.affectedElementIds[0]);
      const wall = request.layout.walls.find((wall) => wall.id === door?.wallId);
      if (goal!.targetMm == null || goal!.fromRoomId || !door || door.clearWidth == null || door.source === 'ai-inferred' || wall?.source === 'ai-inferred' || finding.measuredMm !== door.clearWidth) invalid();
    }
    if (finding.verdict !== 'unknown' && goal!.targetMm != null) {
      if (finding.measuredMm === undefined || finding.requiredMm !== goal!.targetMm) invalid();
      // Route clearance is a rounded-down conservative lower bound.
      if (finding.verdict === 'pass' && finding.measuredMm! + 0.000001 < goal!.targetMm!) invalid();
      if (finding.verdict === 'fail' && finding.measuredMm! > goal!.targetMm! + 0.000001) invalid();
    }
  }
  if (!covered.has('layout-integrity') || [...goals.keys()].some((id) => !covered.has(id))) invalid();
  for (const goal of goals.values()) {
    if (goal.type === 'minimum-door-width' && goal.targetMm != null && !goal.fromRoomId) {
      for (const door of request.layout.doors) {
        if (!result.findings.some((finding) => finding.goalId === goal.id && finding.affectedElementIds.includes(door.id))) invalid();
      }
    }
  }
  for (const route of result.routes) {
    const goal = goals.get(route.goalId);
    const rooms = new Set(request.layout.rooms.map((room) => room.id));
    if (!goal || goal.type === 'minimum-door-width' || !rooms.has(route.fromRoomId) || !rooms.has(route.toRoomId) || route.fromRoomId === route.toRoomId) invalid();
    if (goal!.fromRoomId && (goal!.fromRoomId !== route.fromRoomId || goal!.toRoomId !== route.toRoomId)) invalid();
    if (route.requiredMm !== (goal!.targetMm ?? undefined)) invalid();
    if (!result.findings.some((finding) => finding.goalId === route.goalId && finding.verdict === route.verdict && finding.measuredMm === route.measuredMm && finding.requiredMm === route.requiredMm && finding.affectedElementIds.includes(route.fromRoomId) && finding.affectedElementIds.includes(route.toRoomId))) invalid();
    if (route.verdict === 'unknown' && route.points.length) invalid();
  }
  const counts = {
    passCount: result.findings.filter((finding) => finding.verdict === 'pass').length,
    failCount: result.findings.filter((finding) => finding.verdict === 'fail').length,
    unknownCount: result.findings.filter((finding) => finding.verdict === 'unknown').length,
  };
  if (Object.entries(counts).some(([key, value]) => result.summary[key as keyof typeof counts] !== value) ||
      result.summary.allPassed !== (counts.failCount === 0 && counts.unknownCount === 0)) invalid();
  return result;
}
