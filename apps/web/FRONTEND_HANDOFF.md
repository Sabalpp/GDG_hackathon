# ADAPT frontend integration handoff

Agent 1 owns `src/App.tsx`, `src/state/AppState.tsx`, `src/contracts.ts`, `src/api/adaptApi.ts`, the sample fixture, and shell styling. The shell is wired to the final components in `src/components/Plan2D.tsx`, `src/components/Plan3D.tsx`, and `src/components/ResultsPanel.tsx`. `src/integrations/ComponentSlots.tsx` remains as a fallback reference for their prop contracts.

## Shared contracts and selectors

Import all canonical types from `src/contracts.ts`. Coordinates and dimensions remain in millimeters, with x right and y down. `Layout` is the only geometry source for either view. `useAppState()` and `useAppDispatch()` are in `src/state/AppState.tsx`. Exported selectors are `selectActiveLayout(state)`, `selectActiveFindings(state)`, and `selectAllGoalsConfirmed(state)`.

## Component interfaces

- Agent 2: `Plan2DProps` in `src/components/Plan2D.tsx`: `layout`, optional `findings`, `selectedElementId`, `onSelectElement`, `mode`, `beforeLayout`, and `beforeFindings`. The shell supplies the active proposal layout and both before and after findings.
- Agent 3: `Plan3DProps` in `src/components/Plan3D.tsx`: `layout`, optional `onUnavailable` and `className`. The shell supplies the same active layout as 2D.
- Agent 4: `ResultsPanelProps` in `src/components/ResultsPanel.tsx`: `goals`, optional `findingsBefore`, `proposal`, `layout`, `selectedFindingId`, and `onSelectFinding`. The shell owns the review stage and proposal action; the report panel owns detailed results and print styling.

If the component API needs a small change, preserve these names and add optional props so integration stays straightforward. The shell maps selected finding IDs to affected element IDs for plan highlighting.

## Adapter behavior

Set `VITE_API_BASE_URL` to use service endpoints. Assumed routes are `GET /sample-layout`, `POST /interpret` with `{ description }`, `POST /validate` with `{ layout, goals }`, and `POST /generate` with `{ layout, goals }`. Responses are respectively `Layout`, `Goal[]`, `ConstraintFinding[]`, and `Proposal`. Errors stay visible in the shell. This API shape is an assumption pending backend agreement.

Without a base URL, the app explicitly enters local sample mode. It loads `src/data/sampleLayout.ts`, measures the one modeled doorway against a confirmed goal, and can make a bounded concept edit to at most 900 mm. Path widths and routes remain `unknown`; AI interpretation is disabled; costs are empty. The shell labels each of these limitations. The optional budget is recorded in local UI state only and is not sent to the API or used to estimate costs.

Run `npm install` and `npm run dev`. No tests were added or run, per the brief.
