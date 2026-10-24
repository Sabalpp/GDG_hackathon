# Evaluation

How each success criterion from the spec is checked. ✅ = automated check in the repo.

| Criterion | Check | Where |
|---|---|---|
| Sample loads with valid dimensions | ✅ `GET /samples/apartment` returns a schema-valid `mm` layout | `scripts/smoke-e2e.mjs`, geometry `test_api.py` |
| Original plan has measured failures | ✅ 800 mm door and 649 mm route fail a 900 mm target | smoke test |
| Proposal makes a failing check pass | ✅ Revalidating `resultLayout` gives `allPassed: true`, matching `findingsAfter` | smoke test |
| Impossible request is not labelled feasible | ✅ 5,000 mm targets keep `fail` findings | smoke test, `report.test.tsx` |
| Unknown is never pass | ✅ Removing a door width yields `unknown`; `summarize()` never sets `allPassed` with unknowns | smoke test, `report.test.tsx` |
| Draft AI goals can't reach validation | ✅ Draft goal → 422 | smoke test |
| Malformed input handled | ✅ Negative width → 4xx, no crash | smoke test, geometry `test_models.py` |
| Gemma returns schema-valid drafts | ✅ with `--express`: real `/requirements/interpret` call | smoke test |
| Costs are traceable | ✅ with `--express`: every cost line is `illustrative` and maps to a modification | smoke test, `report.test.tsx` |
| Verdicts not conveyed by color alone | ✅ Badges have text and icon shape | `report.test.tsx` |
| Keyboard access to findings | ✅ Affected-element buttons work via keyboard | `report.test.tsx` |
| API key not in the browser | ✅ Bundle scan in CI and deploy | `scripts/check-bundle-secrets.mjs` |
| 2D and 3D show the same layout | Manual: move furniture, confirm both views update | demo rehearsal |
| Usable without WebGL | Manual: disable WebGL; findings and report still work | demo rehearsal |

## Running everything

```bash
npm run smoke:geometry
npm run smoke -- --express
npm test --workspace @adapt/report-ui -- --run
```
