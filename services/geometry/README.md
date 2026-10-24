# Part C — Geometry & planning

FastAPI + Pydantic + Shapely, with deterministic JSON input/output. No Gemini key
or other external service is required. Python 3.11 or newer is required; pinned
runtime and development dependency files are committed.

## Run locally

From the repository root:

```bash
cd services/geometry
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

On Windows, use `py -3.11 -m venv .venv` and
`.venv\Scripts\Activate.ps1` in PowerShell. For runtime-only installation,
install `requirements.txt` instead. All examples assume the service is on port
8000. `.env.example` documents optional environment variables; the service does
not require an `.env` file or load one automatically.

- Interactive API documentation: <http://127.0.0.1:8000/docs>
- Health: <http://127.0.0.1:8000/health>
- Sample: <http://127.0.0.1:8000/api/v1/samples/apartment>
- Contract for teammates: [geometry-integration.md](../../docs/geometry-integration.md)

## Test

With the virtual environment activated, from `services/geometry`:

```bash
python -m pytest -q
ruff check app tests scripts
ruff format --check app tests scripts
```

With the server running in another terminal:

```bash
python -m scripts.smoke
```

The smoke test performs actual HTTP requests for health, before validation,
proposal generation, revalidation of the returned layout, an impossible request,
unknown measurements, and rejection of draft goals. To use a different port:

```bash
python -m scripts.smoke --base-url http://127.0.0.1:8001
```

No test depends on an AI model or live cloud credentials.

## Manual requests

From the repository root (POSIX shell):

```bash
curl -sS http://127.0.0.1:8000/health
curl -sS http://127.0.0.1:8000/api/v1/layouts/validate \
  -H 'Content-Type: application/json' \
  --data-binary @data/sample-validation-request.json
curl -sS http://127.0.0.1:8000/api/v1/proposals/generate \
  -H 'Content-Type: application/json' \
  --data-binary @data/sample-proposal-request.json
curl -sS http://127.0.0.1:8000/api/v1/proposals/generate \
  -H 'Content-Type: application/json' \
  --data-binary @data/impossible-request.json
```

On Windows, use `curl.exe` and adapt line continuations for PowerShell, or use the
cross-platform Python smoke test.

## Files

| File | Responsibility |
|---|---|
| `app/models.py` | Strict canonical models, geometry/reference checks, confirmed-goal boundary |
| `app/geometry.py` | Wall openings, physical free space, square-footprint clearance, collision findings, route traces |
| `app/solver.py` | Permission-checked demo operators and bounded candidate search |
| `app/main.py` | FastAPI endpoints, bounded JSON bodies, request IDs, controlled errors |
| `tests/` | Unit, schema, permission, proposal, and HTTP contract tests |
| `scripts/smoke.py` | Live HTTP integration verification |
| `scripts/export_openapi.py` | Export the app's real OpenAPI contract |
| `requirements*.txt` | Exact dependency pins, including transitive packages |
| `Dockerfile` | Non-root runtime image, configurable Cloud Run `PORT` |
| `../../data/` | One canonical sample layout plus confirmed goals and complete request fixtures |

Regenerate the OpenAPI file after changing any public model or route:

```bash
python -m scripts.export_openapi
```

To intentionally update dependencies using `uv`:

```bash
uv pip compile requirements.in -o requirements.txt
uv pip compile requirements-dev.in -c requirements.txt -o requirements-dev.txt
```

Run the complete checks after dependency changes. The tested FastAPI/Starlette
versions emit an upstream deprecation warning for HTTPX-based `TestClient`;
it does not affect the real HTTP smoke test.

## Container

Build with the **repository root as the build context**, so the shared `data/`
directory is included:

```bash
docker build -f services/geometry/Dockerfile -t adapt-geometry .
docker run --rm -p 8000:8000 -e PORT=8000 adapt-geometry
```

The image uses a non-root user and listens on `0.0.0.0:${PORT:-8000}`. Dev D can
deploy it to Cloud Run; deployment is separate from this Part C implementation.
The intended caller is Express over a private backend connection. Keep public
authentication, quotas/rate limits, and browser CORS in the Express/infrastructure
layer. No browser CORS policy is enabled here.

## Deliberate limits

One best-effort proposal is returned. Furniture can move only when explicitly
movable and verified. Door changes require both the door and supporting wall to
be editable sample elements. Width is capped at 1,800 mm. Partition movement is
disabled. There are at most three edits, four search branches, 96 validated
candidates, and 256 attempted edits.

Costs are always `[]`; Express attaches catalog lines using modification IDs.
Budgets are accepted but remain unevaluated. Unknown geometry remains unknown.
Read [the detailed limitations](../../docs/geometry-integration.md#limitations)
before presenting any result.
