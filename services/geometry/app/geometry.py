"""Continuous 2D clearance checks, collision checks, and drawable route witnesses.

For orthogonal layouts, shrinking physical free space with mitred joins models
an axis-aligned square footprint. Room representative points are fixed anchors;
the algorithm never relocates an anchor to make a disconnected route pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from heapq import heappop, heappush
from itertools import combinations
from math import floor, hypot, inf

from shapely.geometry import LineString, Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.models import (
    ConstraintFinding,
    Goal,
    Layout,
    Point2D,
    RouteTrace,
    Summary,
    ValidationResponse,
    Wall,
    derived_id,
)

EPS = 1e-6  # Floating-point tolerance only, in mm; never a user clearance allowance.
LIMITATIONS = [
    "Concept geometry only; results are not accessibility compliance or construction approval.",
    "Routes use fixed room representative points and an axis-aligned square footprint in 2D.",
    "Door swings, turning circles, thresholds, slopes and vertical clearances are not modeled.",
    "AI-inferred geometry and missing door widths remain unverified; unknown is not pass.",
    "Clearance is a conservative lower bound, rounded down to whole millimeters.",
]


def room_polygon(room) -> Polygon:
    return Polygon([point.xy() for point in room.polygon])


def object_polygon(obj) -> Polygon:
    bounds = obj.bounds
    return box(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height)


def door_opening(wall: Wall, door) -> Polygon:
    """Cut the measured opening out of its referenced wall only."""
    dx, dy = wall.end.x - wall.start.x, wall.end.y - wall.start.y
    length = hypot(dx, dy)
    ux, uy = dx / length, dy / length
    half_width = (door.clearWidth or 0) / 2
    half_depth = wall.thickness / 2 + 0.01
    cx, cy = door.center.xy()
    return Polygon(
        [
            (
                cx + sx * ux * half_width - sy * uy * half_depth,
                cy + sx * uy * half_width + sy * ux * half_depth,
            )
            for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        ]
    )


def wall_solids(layout: Layout) -> dict[str, BaseGeometry]:
    result = {}
    for wall in layout.walls:
        solid = LineString([wall.start.xy(), wall.end.xy()]).buffer(
            wall.thickness / 2, cap_style="flat", join_style="mitre"
        )
        openings = [
            door_opening(wall, door)
            for door in layout.doors
            if door.wallId == wall.id and door.clearWidth is not None
        ]
        result[wall.id] = solid.difference(unary_union(openings)) if openings else solid
    return result


def collision_findings(layout: Layout) -> list[ConstraintFinding]:
    """Mandatory layout-integrity findings, including walls and footprint bounds."""
    findings = []
    domain = unary_union([room_polygon(room) for room in layout.rooms])
    solids = wall_solids(layout)
    by_id = {element.id: element for element in [*layout.walls, *layout.objects]}

    def add(ids: list[str], message: str) -> None:
        uncertain = any(by_id[item].source == "ai-inferred" for item in ids)
        findings.append(
            ConstraintFinding(
                id=derived_id("integrity", *ids),
                goalId="layout-integrity",
                verdict="unknown" if uncertain else "fail",
                affectedElementIds=ids,
                explanation=message + (" Geometry is unverified." if uncertain else ""),
            )
        )

    for first, second in combinations(layout.objects, 2):
        if object_polygon(first).intersection(object_polygon(second)).area > EPS:
            add([first.id, second.id], "Object footprints overlap in the supplied 2D model.")
    for obj in layout.objects:
        polygon = object_polygon(obj)
        if polygon.difference(domain).area > EPS:
            add([obj.id], "Object footprint extends outside the room footprint union.")
        for wall_id, solid in solids.items():
            if polygon.intersection(solid).area > EPS:
                add([obj.id, wall_id], "Object footprint overlaps a solid wall segment.")
    if not findings:
        uncertain = any(
            item.source == "ai-inferred" for item in [*layout.walls, *layout.doors, *layout.objects]
        )
        findings.append(
            ConstraintFinding(
                id="integrity:clear",
                goalId="layout-integrity",
                verdict="unknown" if uncertain else "pass",
                affectedElementIds=[],
                explanation=(
                    "No modeled object overlap; inferred geometry still requires verification."
                    if uncertain
                    else "No object overlaps, wall collisions, or out-of-bounds objects."
                ),
            )
        )
    return findings


def _is_orthogonal(points: list[tuple[float, float]], closed: bool = False) -> bool:
    pairs = list(zip(points, points[1:], strict=False))
    if closed:
        pairs.append((points[-1], points[0]))
    return all(abs(a[0] - b[0]) <= EPS or abs(a[1] - b[1]) <= EPS for a, b in pairs)


@dataclass
class GeometryContext:
    layout: Layout
    spaces: dict[float, BaseGeometry] = field(default_factory=dict)
    clearance_cache: dict[tuple[str, str], float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.rooms = {room.id: room_polygon(room) for room in self.layout.rooms}
        self.anchors = {
            room_id: polygon.representative_point() for room_id, polygon in self.rooms.items()
        }
        self.domain = unary_union(list(self.rooms.values()))
        obstacles = [
            *wall_solids(self.layout).values(),
            *(object_polygon(obj) for obj in self.layout.objects),
        ]
        self.free = self.domain.difference(unary_union(obstacles))
        self.uncertainties = []
        if any(
            item.source == "ai-inferred"
            for item in [*self.layout.walls, *self.layout.doors, *self.layout.objects]
        ):
            self.uncertainties.append("AI-inferred geometry must be measured and confirmed")
        if any(door.clearWidth is None for door in self.layout.doors):
            self.uncertainties.append("one or more door clear widths are missing")
        if any(not _is_orthogonal([wall.start.xy(), wall.end.xy()]) for wall in self.layout.walls):
            self.uncertainties.append("diagonal walls are outside the orthogonal route model")
        if any(
            not _is_orthogonal([point.xy() for point in room.polygon], closed=True)
            for room in self.layout.rooms
        ):
            self.uncertainties.append("diagonal room boundaries are outside the route model")

    def space(self, width: float) -> BaseGeometry:
        if width not in self.spaces:
            radius = max(width / 2 - EPS, EPS)
            self.spaces[width] = self.free.buffer(-radius, join_style="mitre")
        return self.spaces[width]

    def component(self, first: str, second: str, width: float) -> Polygon | None:
        space = self.space(width)
        polygons = [space] if isinstance(space, Polygon) else getattr(space, "geoms", [])
        for polygon in polygons:
            if (
                isinstance(polygon, Polygon)
                and not polygon.is_empty
                and polygon.covers(self.anchors[first])
                and polygon.covers(self.anchors[second])
            ):
                return polygon
        return None

    def clearance(self, first: str, second: str) -> float:
        key = tuple(sorted([first, second]))
        if key not in self.clearance_cache:
            if self.component(first, second, 0) is None:
                self.clearance_cache[key] = 0
            else:
                minx, miny, maxx, maxy = self.domain.bounds
                low, high = 0.0, max(maxx - minx, maxy - miny) * 2
                # <= 0.1 mm search precision for normal house-scale fixtures.
                for _ in range(20):
                    middle = (low + high) / 2
                    if self.component(first, second, middle) is not None:
                        low = middle
                    else:
                        high = middle
                self.clearance_cache[key] = float(floor(low))
        return self.clearance_cache[key]


def _path(polygon: Polygon, start: Point, end: Point) -> list[Point2D]:
    """Visibility graph in the eroded polygon; every segment is covered by it."""
    if polygon.covers(LineString([start, end])):
        return [Point2D(x=start.x, y=start.y), Point2D(x=end.x, y=end.y)]
    vertices = [*list(polygon.exterior.coords)[:-1]]
    for ring in polygon.interiors:
        vertices.extend(list(ring.coords)[:-1])
    vertices = list(dict.fromkeys(vertices))
    if len(vertices) > 256:
        return []  # Connectivity stays valid; omit an expensive display-only trace.
    nodes = [(start.x, start.y), (end.x, end.y), *vertices]
    distances = [inf] * len(nodes)
    distances[0] = 0
    previous: dict[int, int] = {}
    queue = [(0.0, 0)]
    visited = set()
    while queue:
        distance, index = heappop(queue)
        if index in visited:
            continue
        visited.add(index)
        if index == 1:
            path = [1]
            while path[-1] != 0:
                path.append(previous[path[-1]])
            return [Point2D(x=nodes[i][0], y=nodes[i][1]) for i in reversed(path)]
        for neighbor, point in enumerate(nodes):
            if neighbor in visited or neighbor == index:
                continue
            new_distance = distance + hypot(point[0] - nodes[index][0], point[1] - nodes[index][1])
            if new_distance < distances[neighbor] and polygon.covers(
                LineString([nodes[index], point])
            ):
                distances[neighbor] = new_distance
                previous[neighbor] = index
                heappush(queue, (new_distance, neighbor))
    return []


def _door_findings(layout: Layout, goal: Goal) -> list[ConstraintFinding]:
    walls = {wall.id: wall for wall in layout.walls}
    if not layout.doors or goal.targetMm is None or goal.fromRoomId is not None:
        return [
            ConstraintFinding(
                id=derived_id(goal.id, "unknown"),
                goalId=goal.id,
                verdict="unknown",
                requiredMm=goal.targetMm,
                affectedElementIds=[],
                explanation=(
                    "Door-width goals apply to all doors and require a target and measured doors. "
                    "For a room-scoped width check, use minimum-path-width."
                ),
            )
        ]
    findings = []
    for door in layout.doors:
        uncertain = (
            door.clearWidth is None
            or door.source == "ai-inferred"
            or walls[door.wallId].source == "ai-inferred"
        )
        verdict = "unknown" if uncertain else "pass" if door.clearWidth >= goal.targetMm else "fail"
        findings.append(
            ConstraintFinding(
                id=derived_id(goal.id, door.id),
                goalId=goal.id,
                verdict=verdict,
                measuredMm=None if uncertain else door.clearWidth,
                requiredMm=goal.targetMm,
                affectedElementIds=[door.id],
                explanation=(
                    "Door width or supporting wall is unverified; confirm measurements."
                    if uncertain
                    else f"Measured door clear width {door.clearWidth:g} mm; "
                    f"project target {goal.targetMm:g} mm. This is a geometric check only."
                ),
            )
        )
    return findings


def validate_layout(
    layout: Layout,
    goals: list[Goal],
    *,
    include_routes: bool = True,
    measure_clearance: bool = True,
) -> ValidationResponse:
    """Pure deterministic evaluation; public callers must supply confirmed goals."""
    # Enforce the same boundary for direct Python callers and the HTTP API.
    from app.models import ValidationRequest

    ValidationRequest(layout=layout, goals=goals)
    context = GeometryContext(layout)
    findings = collision_findings(layout)
    routes = []
    for goal in goals:
        if goal.type == "minimum-door-width":
            findings.extend(_door_findings(layout, goal))
            continue
        room_ids = list(context.rooms)
        pairs = (
            [(goal.fromRoomId, goal.toRoomId)]
            if goal.fromRoomId is not None
            else [(room_ids[0], room_id) for room_id in room_ids[1:]]
        )
        if not pairs or (goal.type == "minimum-path-width" and goal.targetMm is None):
            findings.append(
                ConstraintFinding(
                    id=derived_id(goal.id, "unknown"),
                    goalId=goal.id,
                    verdict="unknown",
                    requiredMm=goal.targetMm,
                    affectedElementIds=[],
                    explanation="A path-width check needs a target and at least two rooms.",
                )
            )
            continue
        for first, second in pairs:
            required = goal.targetMm or 0.0
            component = None
            measured = None
            points = []
            if context.uncertainties:
                verdict = "unknown"
                explanation = "; ".join(context.uncertainties) + ". No verified route is asserted."
            else:
                component = context.component(first, second, required)
                verdict = "pass" if component is not None else "fail"
                if measure_clearance:
                    measured = context.clearance(first, second)
                    if component is not None and required:
                        measured = max(measured, required)
                explanation = (
                    f"{first} → {second}: "
                    + (
                        "a connected clearance region exists"
                        if verdict == "pass"
                        else "the fixed room anchors are disconnected at the requested width"
                    )
                    + (
                        f" for the {required:g} mm project target."
                        if required
                        else " in the point-reachability model (no device width specified)."
                    )
                    + (f" Clearance lower bound: {measured:g} mm." if measured is not None else "")
                )
                if include_routes:
                    # A failed width check can still show the original narrow centerline.
                    display_component = (
                        component if component is not None else context.component(first, second, 0)
                    )
                    if display_component is not None:
                        points = _path(
                            display_component, context.anchors[first], context.anchors[second]
                        )
            affected = [first, second]
            if verdict != "pass":
                affected.extend(
                    door.id
                    for door in layout.doors
                    if door.clearWidth is None or door.clearWidth < required
                )
                affected.extend(obj.id for obj in layout.objects)
            findings.append(
                ConstraintFinding(
                    id=derived_id(goal.id, first, second),
                    goalId=goal.id,
                    verdict=verdict,
                    measuredMm=measured,
                    requiredMm=goal.targetMm,
                    affectedElementIds=affected,
                    explanation=explanation,
                )
            )
            if include_routes:
                routes.append(
                    RouteTrace(
                        goalId=goal.id,
                        fromRoomId=first,
                        toRoomId=second,
                        verdict=verdict,
                        requiredMm=goal.targetMm,
                        measuredMm=measured,
                        points=points,
                    )
                )
    return ValidationResponse(
        findings=findings,
        summary=Summary(
            passCount=sum(f.verdict == "pass" for f in findings),
            failCount=sum(f.verdict == "fail" for f in findings),
            unknownCount=sum(f.verdict == "unknown" for f in findings),
            allPassed=bool(findings) and all(f.verdict == "pass" for f in findings),
        ),
        routes=routes,
        limitations=LIMITATIONS,
    )
