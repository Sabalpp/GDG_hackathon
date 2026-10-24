# Express → actual Python geometry service

Express `POST /api/v1/layouts/validate` calls Python's canonical endpoint with the
same path. This was verified against `services/geometry/app/main.py` and
`app/models.py`; `/validate` remains a Python alias, not the configured default.

Server-only settings in `apps/api/.env` (also shown in `.env.example`):

```dotenv
GEOMETRY_BASE_URL=http://127.0.0.1:8000
GEOMETRY_VALIDATE_PATH=/api/v1/layouts/validate
```

Both settings remain configurable. No AI key is needed for geometry. All units
remain millimeters, x right and y down. Express filters drafts before forwarding
and requires at least one confirmed goal. Python rejects drafts itself.

## Actual contract

Request: `{layout, goals}`. Response:

```json
{
  "findings": [{
    "id": "goal-doors:door-bedroom", "goalId": "goal-doors", "verdict": "fail",
    "measuredMm": 800, "requiredMm": 900,
    "affectedElementIds": ["door-bedroom"],
    "explanation": "Measured door clear width is below the project target."
  }],
  "summary": {"passCount": 0, "failCount": 1, "unknownCount": 0, "allPassed": false},
  "routes": [],
  "limitations": ["Simplified concept geometry; not building-code compliance."]
}
```

This excerpt illustrates the shape. Real responses also include mandatory
`layout-integrity` findings, which contribute to summary counts. Express allows
that reserved synthetic goal ID only in responses; users cannot submit it.
Every submitted confirmed goal and the integrity check must have a finding.
Counts and allPassed must match the findings, and unknown never contributes to
allPassed. Invalid goal/element references, duplicate findings, contradictory
width verdicts, and inconsistent route traces are rejected.

Python additions now supported: missing/null door width and optional/null goal
targets, paired optional room endpoints, inferred confidence requirements,
editable/movable defaults, actual ID and collection bounds, routes and limitations.
Missing width/target is not fabricated. Width check results may be unknown.
Unscoped route goals follow Python's all-room anchor semantics. Reachable-route
without target checks point connectivity only, not device clearance.

Python handles geometric input checks beyond the Zod boundary: simple polygons,
room overlap, door centerlines, openings fitting walls, and overlapping openings.
A Python HTTP 422 becomes a sanitized Express 422 INVALID_GEOMETRY_REQUEST rather
than an availability error. No changes to Python are required for this adapter.

## Run locally

From the repository root, in one terminal (Python >=3.11):

```sh
cd services/geometry
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
cd apps/api
npm run dev
```

Set the two geometry values above in `.env` or the process environment first.
Restart Express after changing environment values. If port 3001 is occupied by
an existing dev server, use that server's watcher or stop it before starting a
second one. Do not print environment files containing API keys.

## Real verification and checks

From `apps/api`, with both services running:

```sh
node scripts/smoke-geometry.mjs
npm test
npx tsc --noEmit
```

The real smoke script reads `data/sample-validation-request.json`, sends it
through Express to Python, asserts door-bedroom fails at 800 vs 900 mm, then
widens that door to 920 mm in memory and validates door goals only. It also checks
a null-width door returns unknown. It does not alter shared sample data. The
passing case establishes door clearance plus layout integrity, not route success
or code compliance. EXPRESS_BASE_URL can select a different Express server.

Manual baseline request from the repository root:

```sh
curl -i http://127.0.0.1:3001/api/v1/layouts/validate \
  -H 'Content-Type: application/json' \
  --data-binary @data/sample-validation-request.json
```

Python checks, from `services/geometry`:

```sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check app tests scripts
.venv/bin/ruff format --check app tests scripts
.venv/bin/python -m scripts.smoke
```

Express retains a 32 KiB incoming body limit, stricter than Python's 1 MiB.
The client has a 10-second timeout covering headers/body, a 1 MiB response limit,
and no automatic retries or redirects. Errors contain no passing result or raw
upstream debug content. Statuses: 400 invalid Express request, 413 body limit,
415 wrong media type, 422 Python input rejection, 503 invalid configuration,
502 connection/upstream/malformed or inconsistent response, 504 timeout.

Geometry passes are assertions from the Python engine; Express verifies contract
integrity, not the engine's computations. Python limitations must remain visible
to API consumers, especially square-footprint assumptions, unmodeled door swings,
turning clearances, slopes, structure, and local building rules.
