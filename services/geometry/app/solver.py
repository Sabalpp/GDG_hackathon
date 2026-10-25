"""Bounded, deterministic planner over explicit demo operators.

No LLM, arbitrary structural changes, price invention, or edits to fixtures.
Candidates are schema-checked, collision-checked and fully revalidated.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from itertools import product

from pydantic import ValidationError

from app.geometry import collision_findings, room_polygon, validate_layout
from app.models import (
    Goal,
    Layout,
    Modification,
    Proposal,
    ProposalRequest,
    ProposalResponse,
    ValidationResponse,
    derived_id,
)

MAX_STEPS = 3
BEAM_WIDTH = 4
MAX_EVALUATIONS = 96
MAX_ATTEMPTS = 256
MAX_DEMO_DOOR_WIDTH_MM = 1800.0


class ModificationError(ValueError):
    """A proposed edit is not permitted or geometrically valid."""


def _key(layout: Layout) -> str:
    data = layout.model_dump(mode="json", exclude_none=True)
    data.pop("id")
    return sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:16]


def apply_modification(layout: Layout, modification: Modification) -> Layout:
    """Apply a permitted edit to a deep copy; reject new collision findings."""
    data = layout.model_dump(mode="json")
    if modification.type == "move-furniture":
        obj = next((obj for obj in layout.objects if obj.id == modification.targetElementId), None)
        if obj is None or obj.kind != "furniture" or not obj.movable or obj.source in {"ai-inferred", "image-inferred"}:
            raise ModificationError("Only verified, explicitly movable furniture may be moved")
        if set(modification.params) != {"x", "y"}:
            raise ModificationError(
                "Furniture movement requires exactly numeric x and y parameters"
            )
        for axis in ("x", "y"):
            if isinstance(modification.params[axis], str):
                raise ModificationError("Movement coordinates must be numbers")
        target = next(item for item in data["objects"] if item["id"] == obj.id)
        target["bounds"].update(modification.params)
    elif modification.type == "resize-demo-door":
        door = next(
            (door for door in layout.doors if door.id == modification.targetElementId), None
        )
        walls = {wall.id: wall for wall in layout.walls}
        if (
            door is None
            or not door.editable
            or door.source != "sample"
            or not walls[door.wallId].editable
            or walls[door.wallId].source != "sample"
        ):
            raise ModificationError(
                "Door resizing requires an editable sample door AND sample wall"
            )
        if not modification.requiresProfessionalReview:
            raise ModificationError("Door changes must require professional review")
        if set(modification.params) != {"clearWidth"}:
            raise ModificationError("Door resizing requires exactly clearWidth")
        width = modification.params["clearWidth"]
        if (
            isinstance(width, str)
            or width > MAX_DEMO_DOOR_WIDTH_MM
            or door.clearWidth is None
            or width <= door.clearWidth
        ):
            raise ModificationError("Demo doors may only widen from a known width, up to 1800 mm")
        target = next(item for item in data["doors"] if item["id"] == door.id)
        target["clearWidth"] = width
    else:
        raise ModificationError("Partition movement is intentionally disabled; walls stay fixed")
    try:
        changed = Layout.model_validate(data)
    except ValidationError as exc:
        raise ModificationError("Edit would produce invalid layout geometry") from exc
    previous_collisions = {
        finding.id for finding in collision_findings(layout) if finding.verdict != "pass"
    }
    if any(
        finding.verdict != "pass"
        and (
            finding.id not in previous_collisions
            or modification.targetElementId in finding.affectedElementIds
        )
        for finding in collision_findings(changed)
    ):
        raise ModificationError("Edit would introduce a collision or out-of-bounds object")
    return changed


def _candidates(layout: Layout, goals: list[Goal], changed_ids: set[str]):
    targets = [goal.targetMm for goal in goals if goal.targetMm is not None]
    # Keep achievable targets available even when a different goal is impossible.
    widths = sorted({target + 20 for target in targets if target + 20 <= MAX_DEMO_DOOR_WIDTH_MM})
    for desired_width in widths:
        for door in sorted(layout.doors, key=lambda door: door.id):
            if door.id not in changed_ids and door.clearWidth is not None:
                if door.clearWidth < desired_width:
                    yield Modification(
                        id=derived_id("resize", door.id),
                        type="resize-demo-door",
                        targetElementId=door.id,
                        params={"clearWidth": desired_width},
                        requiresProfessionalReview=True,
                    )
    for obj in sorted(layout.objects, key=lambda obj: obj.id):
        if (
            obj.id in changed_ids
            or obj.kind != "furniture"
            or not obj.movable
            or obj.source in {"ai-inferred", "image-inferred"}
        ):
            continue
        positions = set()
        # Room corners are predefined candidate positions, not arbitrary optimization.
        for room in layout.rooms:
            minx, miny, maxx, maxy = room_polygon(room).bounds
            margin = max((wall.thickness / 2 for wall in layout.walls), default=0) + 50
            left, right = minx + margin, maxx - obj.bounds.width - margin
            top, bottom = miny + margin, maxy - obj.bounds.height - margin
            if right < left or bottom < top:
                continue
            for x, y in product((left, right), (top, bottom)):
                if (x, y) in positions or (x == obj.bounds.x and y == obj.bounds.y):
                    continue
                positions.add((x, y))
                yield Modification(
                    id=derived_id("move", obj.id),
                    type="move-furniture",
                    targetElementId=obj.id,
                    params={"x": x, "y": y},
                    requiresProfessionalReview=False,
                )


@dataclass
class Candidate:
    layout: Layout
    modifications: list[Modification]
    evaluation: ValidationResponse


def _score(candidate: Candidate, goals: list[Goal]) -> tuple:
    findings = candidate.evaluation.findings
    passed_goals = sum(
        all(finding.verdict == "pass" for finding in findings if finding.goalId == goal.id)
        and any(finding.goalId == goal.id for finding in findings)
        for goal in goals
    )
    return (
        passed_goals,
        -sum(finding.verdict == "fail" for finding in findings),
        -sum(finding.verdict == "unknown" for finding in findings),
        -len(candidate.modifications),
        -sum(mod.requiresProfessionalReview for mod in candidate.modifications),
    )


def generate_proposals(request: ProposalRequest) -> ProposalResponse:
    """Return one best-effort proposal, including honest unresolved findings."""
    before = validate_layout(request.layout, request.goals, include_routes=False)
    initial = Candidate(request.layout, [], before)
    best = initial
    beam = [initial]
    seen = {_key(request.layout)}
    evaluations = 0
    attempts = 0
    for _ in range(MAX_STEPS):
        if best.evaluation.summary.allPassed:
            break
        expanded = []
        for candidate in beam:
            changed_ids = {mod.targetElementId for mod in candidate.modifications}
            for modification in _candidates(candidate.layout, request.goals, changed_ids):
                if evaluations >= MAX_EVALUATIONS or attempts >= MAX_ATTEMPTS:
                    break
                attempts += 1
                try:
                    changed = apply_modification(candidate.layout, modification)
                except ModificationError:
                    continue
                key = _key(changed)
                if key in seen:
                    continue
                seen.add(key)
                evaluations += 1
                evaluated = validate_layout(
                    changed, request.goals, include_routes=False, measure_clearance=False
                )
                # Never trade away a previously passing check to improve a score.
                previously_passing = {
                    finding.id
                    for finding in candidate.evaluation.findings
                    if finding.verdict == "pass"
                }
                if any(
                    finding.id in previously_passing and finding.verdict != "pass"
                    for finding in evaluated.findings
                ):
                    continue
                next_candidate = Candidate(
                    changed, [*candidate.modifications, modification], evaluated
                )
                expanded.append(next_candidate)
                if _score(next_candidate, request.goals) > _score(best, request.goals):
                    best = next_candidate
            if evaluations >= MAX_EVALUATIONS or attempts >= MAX_ATTEMPTS:
                break
        if not expanded:
            break
        beam = sorted(
            expanded, key=lambda candidate: _score(candidate, request.goals), reverse=True
        )[:BEAM_WIDTH]
        if evaluations >= MAX_EVALUATIONS or attempts >= MAX_ATTEMPTS:
            break
    result = best.layout.model_copy(deep=True)
    result.id = f"{request.layout.id[:90]}:proposal:{_key(result)}"
    # Revalidate the exact serialized result; never reuse speculative measurements.
    after = validate_layout(result, request.goals, include_routes=False)
    questions = [
        "Have a qualified professional verify dimensions, construction, and local requirements.",
        "Door swings, turning space, thresholds and slopes need separate assessment.",
        "Cost lines must be attached by the Express API from its illustrative catalog; "
        "this geometry service does not assess budget feasibility.",
    ]
    if request.budget is not None:
        questions.append(
            f"The {request.budget.max:g} {request.budget.currency} budget is "
            "recorded but has not been evaluated against costs."
        )
    if not after.summary.allPassed:
        questions.append(
            "The bounded planner did not satisfy every check. Remaining failures "
            "and unknowns are preserved; this is not proof no other layout exists."
        )
    if not best.modifications:
        questions.append(
            "No improving permitted edit was found, or the initial model already passed."
        )
    if evaluations >= MAX_EVALUATIONS:
        questions.append("The planner reached its 96-candidate search limit.")
    if attempts >= MAX_ATTEMPTS:
        questions.append("The planner reached its 256-edit attempt limit.")
    return ProposalResponse(
        proposals=[
            Proposal(
                id=f"proposal:{_key(result)}",
                originalLayoutId=request.layout.id,
                resultLayout=result,
                modifications=best.modifications,
                findingsBefore=before.findings,
                findingsAfter=after.findings,
                costs=[],
                unresolvedQuestions=questions,
            )
        ]
    )
