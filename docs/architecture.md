# Architecture

```mermaid
flowchart LR
  U[User browser] --> W[React + Vite + TS]
  W --> E[Express API]
  E --> G[Gemma 4 via Gemini API]
  E --> P[FastAPI geometry + planner]
  W --> V[2D SVG + React Three Fiber 3D]
  W --> R[@adapt/report-ui panels]
```

## Responsibilities

| Layer | Does | Never does |
|---|---|---|
| Frontend (`apps/web`) | Forms, goal confirmation, 2D/3D rendering, before/after | Invents geometry, calls Gemma or Python directly |
| Report UI (`packages/report-ui`) | Findings with text and icon verdicts, before/after table, cost worksheet, print-to-PDF | Computes verdicts; it only displays them |
| API (`apps/api`) | Validation, Gemma prompts, cost catalog lookup, orchestration | Trusts model output without schema validation; authors prices |
| Geometry (`services/geometry`) | Door/route/collision checks, bounded proposals | Calls AI; claims compliance |
| Gemma 4 | Natural language → draft goals; explanations | Measurement, collision, cost, or legal authority |

## Data flow

```mermaid
sequenceDiagram
  actor User
  participant UI as React UI
  participant API as Express
  participant AI as Gemma 4
  participant Geo as Geometry
  User->>UI: Load sample, describe needs
  UI->>API: POST /requirements/interpret
  API->>AI: Structured extraction prompt
  AI-->>API: Candidate JSON
  API-->>UI: Draft goals + warnings
  User->>UI: Confirm / edit goals
  UI->>API: POST /layouts/validate
  API->>Geo: validate
  Geo-->>UI: pass / fail / unknown findings
  UI->>API: POST /proposals/generate
  API->>Geo: generate
  Geo-->>API: Proposal (costs empty)
  API->>API: Attach catalog cost lines
  API-->>UI: Proposal → 2D, 3D, report
```

## Invariants

- One canonical `Layout` JSON in millimeters; `x` right, `y` down, origin top-left. Converted to meters only in 3D render helpers.
- 2D, 3D, findings and costs all read `Proposal.resultLayout` and its IDs.
- `unknown` is not `pass`. If the geometry service is unreachable, the UI shows "validation unavailable", never passes.
- AI goals stay `draft` until a user confirms them; the validator returns 422 for drafts.
- Cost totals are table lookups, labelled illustrative.

Endpoint details: [geometry-integration.md](geometry-integration.md) and [geometry-openapi.json](geometry-openapi.json).
