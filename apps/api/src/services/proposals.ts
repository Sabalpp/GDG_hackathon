import { createGeometryClient, GeometryError, type GeometryClientOptions } from './geometry.js';
import { estimateModificationCosts } from './costs.js';
import { assertLayoutValidationResult } from './layouts.js';
import { validateLayoutRequestSchema, type ValidateLayoutRequest, type ValidateLayoutResponse } from '../schemas/layouts.js';
import {
  generateProposalRequestSchema, pythonProposalResponseSchema, generateProposalResponseSchema,
  type GenerateProposalRequest,
} from '../schemas/proposals.js';

export interface ProposalGenerationOptions extends GeometryClientOptions { path?: string }

function checkFindings(request: ValidateLayoutRequest, findings: ValidateLayoutResponse['findings']) {
  const passCount = findings.filter((finding) => finding.verdict === 'pass').length;
  const failCount = findings.filter((finding) => finding.verdict === 'fail').length;
  const unknownCount = findings.filter((finding) => finding.verdict === 'unknown').length;
  assertLayoutValidationResult(request, {
    findings, summary: { passCount, failCount, unknownCount, allPassed: failCount === 0 && unknownCount === 0 },
    routes: [], limitations: [],
  });
}

export async function generateProposals(input: GenerateProposalRequest, options: ProposalGenerationOptions = {}) {
  const request = generateProposalRequestSchema.parse(input);
  const path = options.path ?? process.env.GEOMETRY_PROPOSE_PATH ?? '/api/v1/proposals/generate';
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(path)) {
    throw new GeometryError(503, 'GEOMETRY_NOT_CONFIGURED', 'Geometry proposal path is invalid.');
  }
  const client = createGeometryClient({ path, request: generateProposalRequestSchema, response: pythonProposalResponseSchema }, options);
  const result = await client(request);
  const seen = new Set<string>();
  const invalid = () => { throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned an inconsistent proposal.'); };
  const proposals = [];
  for (const proposal of result.proposals) {
    if (seen.has(proposal.id) || proposal.originalLayoutId !== request.layout.id) invalid();
    seen.add(proposal.id);
    const after = validateLayoutRequestSchema.safeParse({ layout: proposal.resultLayout, goals: request.goals });
    if (!after.success) invalid();
    checkFindings(request, proposal.findingsBefore);
    checkFindings(after.data!, proposal.findingsAfter);
    const originalIds = new Set([...request.layout.walls, ...request.layout.doors, ...request.layout.objects].map((item) => item.id));
    const resultIds = new Set([...proposal.resultLayout.walls, ...proposal.resultLayout.doors, ...proposal.resultLayout.objects].map((item) => item.id));
    const modifications = new Set<string>();
    for (const modification of proposal.modifications) {
      if (modifications.has(modification.id) || !originalIds.has(modification.targetElementId) || !resultIds.has(modification.targetElementId)) invalid();
      modifications.add(modification.id);
    }
    const costEstimate = await estimateModificationCosts(proposal.modifications);
    proposals.push({
      ...proposal,
      costs: costEstimate.costs,
      costEstimate,
      unresolvedQuestions: [...proposal.unresolvedQuestions,
        'Concept proposal only, not construction-ready. Have qualified professionals verify measurements, feasibility, safety, and local building requirements.',
        ...costEstimate.professionalEstimates.map((item) => `${item.modificationId}: ${item.reason}`),
        ...costEstimate.limitations,
        ...(request.budget ? ['The supplied budget has not been verified against actual contractor pricing or a complete scope of work.'] : []),
      ],
    });
  }
  return generateProposalResponseSchema.parse({ proposals });
}
