# Proposal generation for Person A

`POST /api/v1/proposals/generate` accepts the canonical `{layout, goals, budget?}`.
Layout units are millimeters. Every goal must already be confirmed; draft goals
are rejected with HTTP 400 rather than silently discarded. Optional budget is
`{currency: "USD", max: number}` (0–1,000,000,000), or null/omitted. Confirming a
goal does not verify measurements or establish real-world accessibility.

The API calls Python's actual `/api/v1/proposals/generate` endpoint using the
existing bounded geometry client. GEOMETRY_BASE_URL defaults to
`http://127.0.0.1:8000`; GEOMETRY_PROPOSE_PATH can override the internal path.
No AI calls or Python changes are involved. Existing limits apply: 32 KiB input,
1 MiB Python response, 10-second upstream timeout. Python checks full geometric
input validity; Express applies Zod schemas, reference checks, finding coverage,
and measurement/verdict consistency to the original and returned layouts.

## Response and frontend integration

Response is `{proposals: [...]}`. Each proposal includes the Python fields:
`id`, `originalLayoutId`, `resultLayout`, `modifications`, `findingsBefore`,
`findingsAfter`, `costs`, and `unresolvedQuestions`.

- Use **resultLayout** for both redesigned 2D and 3D views. Do not apply the edits
  again in the frontend. Compare to the original submitted layout.
- Display before/after findings using their pass/fail/unknown values. A successful
  HTTP response means a proposal was generated, not that every goal passed.
  Best-effort no-edit, failed, and unknown proposals are valid HTTP 200 results.
- `costs` are replaced with server-owned illustrative catalog CostLines, keyed
  by modificationId, compatible with the existing report UI. Python does not
  author or adjust prices. The geometry fields are not modified by enrichment.
- Each proposal also includes additive **costEstimate** metadata: currency,
  status, catalogUpdatedAt, knownSubtotal, nullable total, complete,
  professionalEstimates, unpricedWork, limitations, and the same cost lines.
  Display this metadata with costs; complete only describes catalog coverage,
  not construction feasibility or completeness of real renovation work.
- Python's unresolvedQuestions remain in their original order. Express appends
  the concept-only/not-construction-ready warning, professional estimate needs,
  catalog limitations, and a budget caution when a budget was supplied.
  Show these alongside results. No budget feasibility claim is made.
- The actual Python proposal contract currently has no routes or limitations
  fields; warnings are in unresolvedQuestions. To get route overlays, call the
  existing layouts/validate endpoint for the original and result layouts.

Schemas and exported request/response types are in `src/schemas/proposals.ts`.
The existing report UI Proposal shape accepts the canonical fields; costEstimate
is additive for consumers that need completeness/estimate warnings explicitly.
No frontend modifications were made by this change.

Errors use `{error:{code,message}}`. 400 invalid proposal input, 413 oversized
input, 415 wrong media type, 422 Python input rejection, 502 Python connection,
HTTP or invalid-response failure, 503 invalid configuration or unavailable cost
catalog, 504 timeout. Do not display error responses as successful proposals or
clear prior warnings. Engine errors are sanitized; missing catalog data does
not produce fake free work. Invalid or duplicate proposal/modification IDs,
dangling references, and inconsistent findings cause rejection.

## Run and verify

With FastAPI running on port 8000 and Express on port 3001, from the repository
root:

```sh
curl -i http://127.0.0.1:3001/api/v1/proposals/generate \
  -H 'Content-Type: application/json' \
  --data-binary @data/sample-proposal-request.json
```

From `apps/api`:

```sh
npm test
npx --workspaces=false --no-install tsc --noEmit
node scripts/smoke-proposals.mjs
```

The smoke script makes real Python and Express requests for the shared sample
and impossible fixtures. It compares the geometry fields and original questions
exactly, verifies catalog enrichment, and asserts impossible work still has
unresolved findings. EXPRESS_BASE_URL can select a different Express server.
The explicit npx flags select the installed API compiler in this workspace.
