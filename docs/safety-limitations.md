# Safety and limitations

## What ADAPT is not

ADAPT produces **concept proposals**. It is not:

- an architectural drawing or construction instruction
- a structural assessment (it cannot tell whether a wall is load-bearing)
- an ADA, Fair Housing, or local building-code compliance determination
- a cost quote
- medical or clinical advice

Every change that involves construction is tagged **Needs professional review**.

## Safeguards built in

| Risk | Safeguard |
|---|---|
| AI invents measurements or requirements | Gemma returns only *draft* goals in a fixed schema; users confirm them; the validator rejects drafts (HTTP 422). |
| Unknown treated as safe | Verdicts are `pass`, `fail`, or `unknown`. Missing measurements and AI-inferred geometry produce `unknown`. `allPassed` requires zero unknowns. |
| Geometry service down | The UI shows "Validation unavailable" and renders no passes. |
| Fabricated prices | Costs come from a fixed catalog labelled illustrative; totals are summed by code. With no cost lines, budget fit is "not evaluated". |
| Unsafe edits | The planner may only move furniture marked `movable` and widen doors on walls explicitly marked `editable` in the sample. Exterior and unknown walls are locked. |
| Prompt injection via the description | The description is passed to Gemma as data; output is schema-validated and bounded before use. |
| Secrets leak to the browser | The Gemini key lives in Secret Manager and on the server only; CI scans the web bundle for keys. |
| Privacy | No accounts, addresses, or diagnoses are collected. The demo runs on a sample plan; persistence is in memory. |

## Modeling limitations

The geometry model is a simplified, orthogonal 2D plan. It does **not** evaluate door swings,
turning circles, thresholds, slopes, maneuvering clearances, stairs, multiple stories, structural
loads, permits, or jurisdiction-specific rules. Route checks use fixed representative points in
each room. See [geometry-integration.md § Limitations](geometry-integration.md#limitations).

The 900 mm target in the demo is an **illustrative, user-editable value**, not a legal requirement.
