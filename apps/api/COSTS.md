# Illustrative renovation costs

`GET /api/v1/catalog/costs` returns `{items, updatedAt, limitations}` from the
shared `data/sample-cost-catalog.json`. Existing fictional ranges were preserved:
move-furniture USD 0–200, resize-demo-door USD 800–3,500, and
move-demo-partition USD 3,000–12,000 per modification. Every item and cost line
has `status: "illustrative"`. These are demo placeholders, not researched
contractor prices, quotes, or claims of construction feasibility.

The loader honors server-side `ADAPT_DATA_DIR` (used by the existing Dockerfile),
otherwise resolves the shared JSON relative to the module. It works from source
or compiled `dist/services` without depending on the shell's working directory.
Invalid or unavailable catalogs cause HTTP 503 COST_CATALOG_UNAVAILABLE; no
fallback prices are invented. Zod validates both the catalog and public response.

## Costing Person C's proposals

Import `estimateModificationCosts` from `src/services/costs.ts`. Pass the canonical
`proposal.modifications` array returned by Python:

```ts
const estimate = await estimateModificationCosts(proposal.modifications);
const enrichedProposal = {
  ...proposal,
  costs: estimate.costs,
  unresolvedQuestions: [
    ...proposal.unresolvedQuestions,
    ...estimate.professionalEstimates.map((item) => `${item.modificationId}: ${item.reason}`),
  ],
};
// Return/store estimate alongside the proposal so completeness and unpriced
// work remain visible. Do not display the known subtotal as a complete total.
```

The service returns `costs` in the existing Python/report UI CostLine shape,
`knownSubtotal`, nullable `total`, `complete`, `professionalEstimates`,
`unpricedWork`, `currency`, `status`, `catalogUpdatedAt`, and `limitations`.
When every modification is cataloged, total equals the summed catalog range.
Unknown future types create no cost line, are explicitly flagged as unpriced
and requiring professional estimates, and make total null and complete false.
No work (an empty list) gives an illustrative zero total for zero modifications.
Completeness means catalog coverage only, never completeness of real renovation
costs. Professional review flags from either Python or the catalog are retained
in professionalEstimates. Partition pricing is available even though Python's
current planner does not generate partition moves.

Each modification ID is counted once. Duplicate IDs and malformed objects are
rejected with Zod errors. Repeated types with distinct IDs each incur a range.
USD addition uses integer cents. Params, AI descriptions, quantities, dimensions,
and caller-supplied prices never determine prices. No AI or geometry request is
made by this service. It does not evaluate budgets, taxes, permits, local labor,
structure, or construction safety. Callers must show limitations and professional
estimate flags together with costs. Proposal orchestration is not added here;
this service is ready for the future Express proposal endpoint to call.

## Verify

From `apps/api`:

```sh
npm run dev
# In another terminal:
curl http://localhost:3001/api/v1/catalog/costs
npm test
npx --workspaces=false --no-install tsc --noEmit
```

No additional dependencies, keys, or Python changes are required.

The explicit npx flags select the installed API compiler. Plain `npx tsc` in
this workspace can resolve the unrelated npm package named `tsc` instead.
