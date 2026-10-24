# Geometry integration contract — Dev C

The browser calls Express. Express calls the Python service using
`GEOMETRY_BASE_URL=http://127.0.0.1:8000`. No API keys are needed by Python.
All coordinates, clear widths, object bounds, and route points are millimeters;
`x` grows right and `y` grows down. Use `Proposal.resultLayout` for both renderers.

## Endpoints

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/health` or `/api/v1/health` | none | `{"status":"ok"}` |
| GET | `/api/v1/samples/apartment` | none | `{layout}` |
| POST | `/api/v1/layouts/validate` | `{layout,goals}` | `{findings,summary,routes,limitations}` |
| POST | `/api/v1/proposals/generate` | `{layout,goals,budget?}` | `{proposals}` |

`/validate` and `/propose` are aliases for internal adapters. Use the canonical
paths in new code. The generated [OpenAPI document](geometry-openapi.json) defines
the complete runtime schemas. `/docs` and `/openapi.json` are also served live.

Use the complete fixtures in `data/` to avoid frontend/backend schema drift:

- `sample-layout.json`: the single canonical two-bedroom apartment.
- `sample-goals.json`: confirmed, illustrative 900 mm targets.
- `sample-validation-request.json`: exact validation request body.
- `sample-proposal-request.json`: generation request with an optional USD budget.
- `impossible-request.json`: the same layout with intentionally unattainable 5,000 mm targets.

The sample partitions are **explicitly editable, fictional demo elements**. That
flag is not evidence of real structural status. All exterior walls are locked.

## Request validation

Models match the supplied TypeScript contracts and keep camelCase names. IDs are
nonempty strings (not UUID-only, consistent with the specification's sample
IDs). Unknown fields and coercion from numeric strings/booleans are rejected.

- Only `mm` is accepted; numbers must be finite and dimensions positive.
- IDs must be unique across walls, doors, objects and rooms.
- Door wall references must exist; centers must lie on the referenced segment.
- Openings must fit on the wall, and openings on one wall cannot overlap.
- Room polygons must be valid, nonzero-area polygons with nonoverlapping interiors.
- Inferred elements require `source: "ai-inferred"` and `confidence` in `[0,1]`.
- Wall/door `editable` and object `movable` default to `false`.
- Goals must have `status: "confirmed"`; drafts return HTTP 422.
- Room references must exist; route endpoints are supplied together and differ.
- `layout-integrity` is a reserved synthetic goal ID for mandatory collision checks.

The one intentional uncertainty extension is `Door.clearWidth`: missing or `null`
is accepted and produces `unknown`, never a fabricated measurement. Optional
`targetMm` values that are missing for width goals likewise produce `unknown`.

Requests are bounded to 1 MiB, including streamed bodies. Layouts are limited to
128 walls, 64 doors, 64 objects, 16 rooms, 64 vertices per room, and 16 goals.
This is a small-layout demo service, not a general CAD processor.

## Goal semantics

`minimum-door-width` checks every door. Each door gets its own finding. A scoped
door-width goal currently returns `unknown`; use `minimum-path-width` for a
room-to-room clearance request. A door-only pass does not establish a clear route.

`minimum-path-width` requires `targetMm` and checks connectivity between fixed
representative points inside the named rooms. If no room pair is specified, the
first room must connect to every other room at that width. This spanning set
establishes common connected-component membership for all room anchors.

`reachable-route` behaves the same way when `targetMm` is supplied. Without a
target it checks point connectivity only and explicitly states that no mobility
device width was specified.

Any inferred wall, door or object, missing door width, diagonal wall, or diagonal
room boundary causes route results to be `unknown`. This is intentionally
conservative even when the uncertain element might be far from the requested route.

## Validation and route overlays

The response adds two useful fields beyond the minimum `{findings,summary}`:

```json
{
  "summary": {
    "passCount": 4,
    "failCount": 3,
    "unknownCount": 0,
    "allPassed": false
  },
  "routes": [{
    "goalId": "goal-kitchen-route",
    "fromRoomId": "bedroom",
    "toRoomId": "kitchen",
    "verdict": "fail",
    "requiredMm": 900,
    "measuredMm": 649,
    "points": []
  }]
}
```

This excerpt illustrates the shape; the actual response also includes findings,
limitations, and calculated polyline coordinates when a trace can be drawn.
Counts include the mandatory `layout-integrity` check. The measured route width
is a conservative lower bound from binary search, rounded down; a true 650 mm
gap can be reported as 649 mm. Door measurements are supplied dimensions directly.

Each `routes[].points` is a polyline for an SVG overlay. For a passed route,
every segment lies in the clearance region for the requested footprint. For a
failed width check, points may show the original narrower centerline: draw it
using the failed verdict and never portray it as a width-valid path. Unknown or
fully disconnected routes have no trace. Very complex display traces exceeding
256 vertices may be omitted even when connectivity was established.

To show before/after routes, validate the original layout, generate a proposal,
then validate **the returned `resultLayout`** using the same confirmed goals.
Both 2D and 3D must read that layout; do not reimplement modifications in a second
frontend state model.

## Planner and modifications

The planner returns one deterministic best-effort `Proposal`, including complete
before/after findings even when it cannot satisfy the request. Original input
objects are never mutated.

Allowed generated operators:

- `move-furniture`: parameters `{x,y}` are absolute millimeter coordinates;
  the target must be verified furniture with `movable: true`. Fixtures never move.
- `resize-demo-door`: `{clearWidth}` sets the opening width. Both door and wall
  must be `source: "sample"` with `editable: true`; professional review is required.
  A known width is widened toward a goal plus a 20 mm demo margin, capped at 1,800 mm.

`move-demo-partition` remains in the canonical enum but is intentionally rejected
by the operator. No wall is moved. This avoids inventing construction feasibility
or changing room boundaries without an explicit partition-edit contract.

Furniture positions come from room bounding-box corners with a wall margin.
Every edit is schema-checked and cannot introduce object collisions or leave the
layout footprint. Every candidate is revalidated. Existing passed checks cannot
be traded away. Search ranks complete goals passing, fewer failed findings,
fewer unknown findings, fewer edits, and fewer professional-review edits.

The search is capped at three edits, four branches, 96 evaluated candidates, and
256 attempts. Final findings are recomputed from the exact returned layout.
Failed search means no solution was found by these operators within those
bounds; it does not prove that no other design is possible.

`costs` is always an empty list. Dev B attaches catalog-based illustrative lines
using the returned modification IDs. The geometry planner does not generate or
rank dollar prices, and `budget` acceptance does not mean a budget was met.
`unresolvedQuestions` makes this explicit, including the supplied budget.

## Express adapter

Forward JSON as-is and validate the response using the frozen/shared schemas.
Allow the additive `routes` and `limitations` fields in the validation response.
Keep API validation errors distinct from geometry-service unavailability.

```ts
const base = process.env.GEOMETRY_BASE_URL ?? 'http://127.0.0.1:8000';

async function callGeometry(path: string, body: unknown, requestId: string) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) {
    // Your route maps this error to a controlled 422/502/503 response.
    throw Object.assign(new Error('Geometry request failed'), {
      upstreamStatus: response.status,
      details: result.error,
    });
  }
  return result; // Apply your shared runtime response schema here.
}
```

Use `/api/v1/layouts/validate` or `/api/v1/proposals/generate` for `path`.
On a timeout or non-JSON response, report validation unavailable. Never replace
an unavailable validator with passing findings. Forward a bounded safe request
ID; Python echoes valid IDs or generates one. Errors contain:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Invalid geometry request",
    "requestId": "team-request-123",
    "details": [{"loc": ["body", "goals"], "message": "...", "type": "..."}]
  }
}
```

All responses include `X-Request-ID`. Common statuses are 200 (including genuine
failed/unknown findings), 404 (unknown sample), 413 (oversized body), 422 (schema
or draft-goal errors), and 500 (`geometry_unavailable`). Raw layout/description
inputs and internal exceptions are not echoed in server error responses.

## Limitations

This is a simplified, orthogonal 2D model for concept exploration. Physical free
space is the room union minus solid wall footprints and object rectangles.
Measured door rectangles are cut only out of their referenced walls. The engine
erodes free space by half the requested width using mitred joins, modeling an
axis-aligned square footprint. Connectivity is continuous geometry; a visibility
graph supplies optional display polylines.

Fixed room representative points make results repeatable. The service does not
assert every part of each room is reachable. A blocked anchor fails rather than
being silently moved to a more favorable part of the room. Width comparisons use
only a one-millionth-millimeter floating-point tolerance.

Door swings, turning spaces, thresholds, slopes, maneuvering clearances, stairs,
multiple stories, structural loads, permits, local rules, and construction costs
are not evaluated. Room outlines are supplied by the user/sample; arbitrary
image inference or calibration is not implemented here. Confidence scores cannot
turn inferred measurements into verified dimensions. A geometric pass is not a
code-compliance, safety, or construction finding.

## Primary implementation references

- [Shapely's geometry, buffering and set operations](https://shapely.readthedocs.io/en/stable/manual.html)
- [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [Pydantic strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/)
- [Pydantic model validators](https://docs.pydantic.dev/latest/concepts/validators/)
