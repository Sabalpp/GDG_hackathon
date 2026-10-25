"""Canonical camelCase JSON contracts; all geometry is in millimeters.

IDs are nonempty strings, matching the specification's UUID alias and sample IDs.
A missing/null door width is deliberately representable and evaluates as unknown.
"""

from __future__ import annotations

from hashlib import sha256
from math import hypot
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import LineString, Point, Polygon

Id = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")]
Number = Annotated[float, Field(allow_inf_nan=False, ge=-1_000_000, le=1_000_000)]
Dimension = Annotated[float, Field(allow_inf_nan=False, gt=0, le=100_000)]
Verdict = Literal["pass", "fail", "unknown"]


def derived_id(prefix: str, *parts: str) -> str:
    """Keep deterministic output IDs valid even for maximum-length input IDs."""
    readable = ":".join((prefix, *parts))
    if len(readable) <= 128:
        return readable
    digest = sha256(readable.encode()).hexdigest()[:24]
    return f"{prefix[:80]}:{digest}"


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Point2D(Model):
    x: Number
    y: Number

    def xy(self) -> tuple[float, float]:
        return self.x, self.y


class Rect2D(Point2D):
    width: Dimension
    height: Dimension


class ConfidenceRecord(Model):
    source: Literal["sample", "user", "ai-inferred", "image-inferred"]
    confidence: Annotated[float, Field(ge=0, le=1)] | None = None

    @model_validator(mode="after")
    def inference_has_confidence(self) -> Self:
        if self.source in {"ai-inferred", "image-inferred"} and self.confidence is None:
            raise ValueError(
                "inferred elements require confidence; measurements remain unverified"
            )
        return self


class Wall(ConfidenceRecord):
    id: Id
    start: Point2D
    end: Point2D
    thickness: Dimension
    editable: bool = False

    @model_validator(mode="after")
    def nonzero_segment(self) -> Self:
        if hypot(self.end.x - self.start.x, self.end.y - self.start.y) < 0.01:
            raise ValueError("wall endpoints must differ by at least 0.01 mm")
        return self


class Door(ConfidenceRecord):
    id: Id
    wallId: Id
    center: Point2D
    clearWidth: Dimension | None = None
    swing: Literal["left", "right", "sliding"] | None = None
    editable: bool = False


class FloorObject(ConfidenceRecord):
    id: Id
    kind: Literal["furniture", "fixture"]
    label: Annotated[str, Field(min_length=1, max_length=200)]
    bounds: Rect2D
    movable: bool = False


class Room(Model):
    id: Id
    label: Annotated[str, Field(min_length=1, max_length=200)]
    polygon: Annotated[list[Point2D], Field(min_length=3, max_length=64)]

    @model_validator(mode="after")
    def valid_polygon(self) -> Self:
        polygon = Polygon([point.xy() for point in self.polygon])
        if not polygon.is_valid or polygon.area < 1:
            raise ValueError("room polygon must be simple, valid, and have positive area >= 1 mm²")
        return self


class Layout(Model):
    id: Id
    units: Literal["mm"]
    walls: Annotated[list[Wall], Field(max_length=128)]
    doors: Annotated[list[Door], Field(max_length=64)]
    objects: Annotated[list[FloorObject], Field(max_length=64)]
    rooms: Annotated[list[Room], Field(min_length=1, max_length=16)]

    @model_validator(mode="after")
    def references_and_geometry(self) -> Self:
        elements = [*self.walls, *self.doors, *self.objects, *self.rooms]
        ids = [element.id for element in elements]
        if len(ids) != len(set(ids)):
            raise ValueError("layout element IDs must be globally unique")
        walls = {wall.id: wall for wall in self.walls}
        intervals: dict[str, list[tuple[float, float]]] = {}
        for door in self.doors:
            if door.wallId not in walls:
                raise ValueError(f"door {door.id} references a missing wall")
            wall = walls[door.wallId]
            line = LineString([wall.start.xy(), wall.end.xy()])
            center = Point(door.center.xy())
            if line.distance(center) > 0.01:
                raise ValueError(f"door {door.id} center must be on its wall centerline")
            if door.clearWidth is not None:
                position = line.project(center)
                interval = (position - door.clearWidth / 2, position + door.clearWidth / 2)
                if interval[0] < -0.001 or interval[1] > line.length + 0.001:
                    raise ValueError(f"door {door.id} opening exceeds its wall segment")
                for other in intervals.setdefault(wall.id, []):
                    if min(interval[1], other[1]) - max(interval[0], other[0]) > 0.001:
                        raise ValueError("door openings on the same wall must not overlap")
                intervals[wall.id].append(interval)
        polygons = [Polygon([point.xy() for point in room.polygon]) for room in self.rooms]
        for index, polygon in enumerate(polygons):
            for other in polygons[index + 1 :]:
                if polygon.intersection(other).area > 0.01:
                    raise ValueError(
                        "room interiors must not overlap; shared boundaries are allowed"
                    )
        return self


class Goal(Model):
    id: Id
    type: Literal["minimum-door-width", "minimum-path-width", "reachable-route"]
    targetMm: Dimension | None = None
    fromRoomId: Id | None = None
    toRoomId: Id | None = None
    status: Literal["draft", "confirmed"]

    @model_validator(mode="after")
    def paired_rooms(self) -> Self:
        if (self.fromRoomId is None) != (self.toRoomId is None):
            raise ValueError("fromRoomId and toRoomId must be supplied together")
        return self


class Budget(Model):
    currency: Literal["USD"]
    max: Annotated[float, Field(ge=0, le=1_000_000_000, allow_inf_nan=False)]


class ValidationRequest(Model):
    layout: Layout
    goals: Annotated[list[Goal], Field(min_length=1, max_length=16)]

    @model_validator(mode="after")
    def confirmed_references(self) -> Self:
        ids = [goal.id for goal in self.goals]
        if len(ids) != len(set(ids)) or "layout-integrity" in ids:
            raise ValueError("goal IDs must be unique; layout-integrity is reserved")
        room_ids = {room.id for room in self.layout.rooms}
        for goal in self.goals:
            if goal.status != "confirmed":
                raise ValueError("confirm or edit draft goals before validation or generation")
            if goal.fromRoomId is not None:
                if goal.fromRoomId not in room_ids or goal.toRoomId not in room_ids:
                    raise ValueError("goal references a missing room")
                if goal.fromRoomId == goal.toRoomId:
                    raise ValueError("a route requires two different rooms")
        return self


class ProposalRequest(ValidationRequest):
    budget: Budget | None = None


class ConstraintFinding(Model):
    id: Id
    goalId: Id
    verdict: Verdict
    measuredMm: float | None = None
    requiredMm: float | None = None
    affectedElementIds: list[Id]
    explanation: str


class RouteTrace(Model):
    goalId: Id
    fromRoomId: Id
    toRoomId: Id
    verdict: Verdict
    requiredMm: float | None = None
    measuredMm: float | None = None
    points: list[Point2D]


class Summary(Model):
    passCount: int
    failCount: int
    unknownCount: int
    allPassed: bool


class ValidationResponse(Model):
    findings: list[ConstraintFinding]
    summary: Summary
    routes: list[RouteTrace]
    limitations: list[str]


class Modification(Model):
    id: Id
    type: Literal["move-furniture", "resize-demo-door", "move-demo-partition"]
    targetElementId: Id
    params: dict[str, str | float]
    requiresProfessionalReview: bool


class CostLine(Model):
    modificationId: Id
    title: str
    lowUsd: Annotated[float, Field(ge=0)]
    highUsd: Annotated[float, Field(ge=0)]
    basis: str
    status: Literal["illustrative"]


class Proposal(Model):
    id: Id
    originalLayoutId: Id
    resultLayout: Layout
    modifications: list[Modification]
    findingsBefore: list[ConstraintFinding]
    findingsAfter: list[ConstraintFinding]
    costs: list[CostLine]
    unresolvedQuestions: list[str]


class ProposalResponse(Model):
    proposals: list[Proposal]
