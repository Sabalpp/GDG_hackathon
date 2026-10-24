# Verification Report

## What was checked

- Part C's canonical schemas, geometry, bounded planner, permission enforcement,
  error handling, sample fixture, and service/container entrypoints.
- A real HTTP before/generate/after flow, including intentionally impossible
  goals, unknown measurements, and draft-goal rejection.

## Commands / evidence

Commands below run from `services/geometry` unless stated otherwise.

| Check | Evidence | Result |
|---|---|---|
| Python tests | `.venv/bin/pytest -q`: **93 passed** | PASS |
| Lint | `.venv/bin/ruff check app tests scripts`: all checks passed | PASS |
| Formatting | `.venv/bin/ruff format --check app tests scripts`: 13 files formatted | PASS |
| Live local HTTP | `python -m scripts.smoke --base-url http://127.0.0.1:8017`: all seven scenarios passed | PASS |
| Container build | From repo root: `docker build -f services/geometry/Dockerfile -t adapt-geometry:part-c .` | PASS |
| Configurable container port | Container started as non-root with `PORT=8080`, published to localhost:8018 | PASS |
| Live container HTTP | `python -m scripts.smoke --base-url http://127.0.0.1:8018`: all seven scenarios passed | PASS |
| Contract export | `python -m scripts.export_openapi` generated `docs/geometry-openapi.json` | PASS |
| Repository hygiene | Targeted scan found no TODOs, private-key blocks, API-key patterns, or replace-me values in deliverables | PASS |

Local Python: 3.11.15 on macOS arm64. Container: Linux arm64, Python 3.11.
The test suite emits one upstream HTTPX/Starlette deprecation warning. Runtime
HTTP integration checks pass independently of `TestClient`.

Before the demo edits: **4 pass, 3 fail, 0 unknown**. The planner widens
`door-bedroom` from 800 to 920 mm and moves `cabinet` to `(100,1900)` mm.
Revalidating the exact returned `resultLayout`: **7 pass, 0 fail, 0 unknown**.
The impossible 5,000 mm request retains failed findings.

## Issues found and fixed

- The first sample cabinet footprint overlapped its adjacent wall by 50 mm.
  Reduced its width to 1,250 mm so it obstructs circulation without colliding.
- Maximum-length input IDs could overflow derived finding/modification IDs.
  Added bounded deterministic derived IDs and a regression test.
- A large impossible goal initially suppressed smaller achievable door targets.
  Generate candidates for each attainable target; a regression test proves the
  achievable goal can pass while the impossible goal remains failed.
- Bounded attempted edits as well as evaluated candidates, including invalid edits.
- Reject moving an object when it would remain in an existing collision.
- Local sandbox restrictions prevented sockets/downloads; verification used
  approved commands. Port 8000 was occupied, so local QA used 8017 and 8018.

## Remaining unverified areas

- Frontend, Express, Gemma, cost-catalog attachment, and Cloud Run deployment are
  other teammates' work and are not represented as complete by Part C.
- Geometric passes have the modeling limits documented in
  [geometry-integration.md](geometry-integration.md#limitations).
- GitHub Actions repeats checks on Python 3.11/3.12 after push; see the PR's live
  checks for the current remote result.

## Final status

VERIFIED — Part C service, sample flow, negative cases, and Docker runtime.
