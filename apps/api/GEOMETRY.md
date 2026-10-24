# Geometry validation

`POST /api/v1/layouts/validate` accepts `{layout: Layout, goals: Goal[]}` in
millimeters, x increasing right and y increasing down. Zod schemas and exported
request/response types are in `src/schemas/layouts.ts`. Only confirmed goals are
forwarded; at least one confirmed goal is required.

Server configuration (restart after changes):

```dotenv
GEOMETRY_BASE_URL=http://localhost:8000
GEOMETRY_VALIDATE_PATH=/validate
```

The Python route is configurable and provisional until Person C confirms it.
Python receives the same request wrapper, with draft goals filtered out.

## Provisional response contract for Person C

Return HTTP 200, `Content-Type: application/json`, with canonical findings and
this exact provisional summary shape:

```json
{
  "findings": [{
    "id": "finding-1", "goalId": "goal-1", "verdict": "pass",
    "measuredMm": 900, "requiredMm": 850,
    "affectedElementIds": ["door-1"],
    "explanation": "Measured clear width meets the requested target."
  }],
  "summary": {"total": 1, "passed": 1, "failed": 0, "unknown": 0, "status": "pass"}
}
```

Counts describe findings, not goals. Every confirmed goal requires at least one
finding; missing or unsupported checks must explicitly return `unknown` rather
than disappear. Finding IDs must be unique and goal/element references valid.
Any fail makes summary status `fail`; otherwise any unknown makes it `unknown`.
Only all-pass findings permit overall `pass`. Summary counts/status must agree
with findings exactly. Extra response fields are rejected.

Width pass/fail findings require measuredMm and requiredMm; requiredMm must equal
the confirmed target and the verdict must agree with measuredMm >= requiredMm.
Unknown findings may omit measurements. Python remains responsible for computing
geometry, routes, collisions, door placement, and polygon topology. Express
checks response integrity; it does not independently verify Python computations
or establish building-code compliance.

## Remaining assumptions to confirm

- Confirmed width goals require targetMm. Confirmed reachable-route goals require
  distinct existing fromRoomId and toRoomId. All supplied room references must
  exist, even on drafts. Draft width targets may be omitted.
- IDs are nonblank, at most 200 characters, and unique across layout elements.
  Goal IDs are unique separately. Extra input fields are rejected.
- Dimensions are positive finite numbers up to 10,000,000 mm. Coordinates may
  be negative, with absolute value at most 10,000,000 mm. Confidence is in [0,1].
  Measured distances may be zero.
- Walls must have nonzero length; room polygons require three points and nonzero
  signed area. Full geometric validity belongs to Python.
- Arrays/strings are bounded in the schemas. Incoming bodies retain the existing
  Express 32 KiB limit. These are backend safety limits, not design rules.

Person C must confirm the internal route, exact summary object, goal semantics,
and limits above, then provide a reachable service implementing that contract.
No Python code is needed to run the mock tests. Browser CORS is unnecessary for
this server-to-server request.

## Failure handling and testing

The client defaults to a 10-second timeout covering headers and body, limits
responses to 1 MiB, and rejects redirects. It does not retry or fabricate passing
results. Errors use `{error:{code,message}}` with no findings: 400 invalid request,
413 oversized body, 415 wrong content type, 503 invalid service configuration,
502 connection/upstream/response errors, 504 timeout. Upstream debug messages are
not exposed. Valid failed or unknown geometry checks return HTTP 200.

From `apps/api`, run `npm test` and `npx tsc --noEmit`. Tests start mock Python
HTTP servers, exercise the public Express route, and require no real Python
service. To manually test against Person C's service, save a canonical request
as `layout-request.json` and run:

```sh
curl -i http://localhost:3001/api/v1/layouts/validate \
  -H 'Content-Type: application/json' --data-binary @layout-request.json
```
