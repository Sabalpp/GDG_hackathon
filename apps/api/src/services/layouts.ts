import { createGeometryClient, GeometryError, type GeometryClientOptions } from './geometry.js';
import { validateLayoutRequestSchema, validateLayoutResponseSchema, type ValidateLayoutRequest } from '../schemas/layouts.js';

export interface LayoutValidationOptions extends GeometryClientOptions { path?: string }

export async function validateLayout(input: ValidateLayoutRequest, options: LayoutValidationOptions = {}) {
  const request = validateLayoutRequestSchema.parse(input);
  request.goals = request.goals.filter((goal) => goal.status === 'confirmed');
  const path = options.path ?? process.env.GEOMETRY_VALIDATE_PATH ?? '/validate';
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(path)) {
    throw new GeometryError(503, 'GEOMETRY_NOT_CONFIGURED', 'Geometry validation path is invalid.');
  }
  const client = createGeometryClient({ path, request: validateLayoutRequestSchema, response: validateLayoutResponseSchema }, options);
  const result = await client(request);
  const invalid = () => { throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned inconsistent or incomplete findings.'); };
  const goals = new Map(request.goals.map((goal) => [goal.id, goal]));
  const elements = new Set([...request.layout.walls, ...request.layout.doors, ...request.layout.objects, ...request.layout.rooms].map((item) => item.id));
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const finding of result.findings) {
    const goal = goals.get(finding.goalId);
    if (!goal || seen.has(finding.id) || new Set(finding.affectedElementIds).size !== finding.affectedElementIds.length || finding.affectedElementIds.some((id) => !elements.has(id))) invalid();
    seen.add(finding.id);
    covered.add(finding.goalId);
    if (finding.requiredMm !== undefined && finding.requiredMm !== goal!.targetMm) invalid();
    if (goal!.type !== 'reachable-route' && finding.verdict !== 'unknown') {
      if (finding.measuredMm === undefined || finding.requiredMm !== goal!.targetMm) invalid();
      if ((finding.measuredMm! >= goal!.targetMm!) !== (finding.verdict === 'pass')) invalid();
    }
  }
  if (covered.size !== goals.size) invalid();
  const counts = {
    total: result.findings.length,
    passed: result.findings.filter((finding) => finding.verdict === 'pass').length,
    failed: result.findings.filter((finding) => finding.verdict === 'fail').length,
    unknown: result.findings.filter((finding) => finding.verdict === 'unknown').length,
  };
  // Any unknown prevents an overall pass; fail takes precedence over unknown.
  const status = counts.failed ? 'fail' : counts.unknown ? 'unknown' : 'pass';
  if (Object.entries(counts).some(([key, value]) => result.summary[key as keyof typeof counts] !== value) || result.summary.status !== status) invalid();
  return result;
}
