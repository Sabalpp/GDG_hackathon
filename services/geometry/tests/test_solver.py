import pytest
from conftest import furniture, rebuilt

from app.geometry import validate_layout
from app.models import Modification, ProposalRequest
from app.solver import ModificationError, apply_modification, generate_proposals


def move(target="chair", **params):
    return Modification(
        id="move",
        type="move-furniture",
        targetElementId=target,
        params=params or {"x": 600, "y": 100},
        requiresProfessionalReview=False,
    )


def resize(width=920, **changes):
    return Modification(
        id="resize",
        type="resize-demo-door",
        targetElementId="door",
        params={"clearWidth": width},
        requiresProfessionalReview=True,
        **changes,
    )


def test_sample_failing_route_becomes_passing(sample_request):
    original = sample_request.layout.model_dump_json()
    before = validate_layout(sample_request.layout, sample_request.goals)
    assert not before.summary.allPassed
    proposal = generate_proposals(sample_request).proposals[0]
    after = validate_layout(proposal.resultLayout, sample_request.goals)
    assert after.summary.allPassed
    assert {mod.type for mod in proposal.modifications} == {"move-furniture", "resize-demo-door"}
    assert {mod.targetElementId for mod in proposal.modifications} == {"cabinet", "door-bedroom"}
    assert proposal.resultLayout.id != sample_request.layout.id
    assert proposal.originalLayoutId == sample_request.layout.id
    assert after.findings == proposal.findingsAfter
    assert before.findings == proposal.findingsBefore
    assert sample_request.layout.model_dump_json() == original
    assert proposal.costs == []
    assert any("budget" in question for question in proposal.unresolvedQuestions)


def test_door_only_is_insufficient_for_sample(sample_request):
    changed = sample_request.layout.model_copy(deep=True)
    changed.doors[0].clearWidth = 920
    response = validate_layout(changed, sample_request.goals)
    assert any(
        finding.goalId == "goal-kitchen-route" and finding.verdict == "fail"
        for finding in response.findings
    )


def test_furniture_only_is_insufficient_for_sample(sample_request):
    changed = apply_modification(sample_request.layout, move("cabinet", x=100, y=1900))
    response = validate_layout(changed, sample_request.goals)
    assert any(
        finding.goalId == "goal-kitchen-route" and finding.verdict == "fail"
        for finding in response.findings
    )


def test_impossible_request_preserves_failures(sample_request):
    for goal in sample_request.goals:
        goal.targetMm = 5000
    proposal = generate_proposals(sample_request).proposals[0]
    assert any(finding.verdict == "fail" for finding in proposal.findingsAfter)
    assert not validate_layout(proposal.resultLayout, sample_request.goals).summary.allPassed
    assert any("did not satisfy" in question for question in proposal.unresolvedQuestions)


def test_planner_is_deterministic(sample_request):
    first = generate_proposals(sample_request)
    second = generate_proposals(sample_request)
    assert first.model_dump_json() == second.model_dump_json()


def test_locked_door_not_modified(simple_layout, door_goal):
    simple_layout.doors[0].editable = False
    response = generate_proposals(ProposalRequest(layout=simple_layout, goals=[door_goal]))
    assert response.proposals[0].modifications == []
    assert any(finding.verdict == "fail" for finding in response.proposals[0].findingsAfter)


def test_locked_wall_cannot_be_widened(simple_layout):
    simple_layout.walls[0].editable = False
    with pytest.raises(ModificationError, match="editable sample"):
        apply_modification(simple_layout, resize())


def test_non_demo_wall_cannot_be_widened(simple_layout):
    simple_layout.walls[0].source = "user"
    with pytest.raises(ModificationError):
        apply_modification(simple_layout, resize())


def test_fixture_cannot_move_even_if_flagged_movable(simple_layout):
    layout = rebuilt(
        simple_layout, lambda data: data["objects"].append(furniture(kind="fixture", movable=True))
    )
    with pytest.raises(ModificationError, match="furniture"):
        apply_modification(layout, move())


def test_immovable_furniture_cannot_move(simple_layout):
    layout = rebuilt(simple_layout, lambda data: data["objects"].append(furniture(movable=False)))
    with pytest.raises(ModificationError):
        apply_modification(layout, move())


def test_new_collision_rejected(simple_layout):
    layout = rebuilt(
        simple_layout,
        lambda data: data["objects"].extend([furniture(), furniture("other", x=1000)]),
    )
    with pytest.raises(ModificationError, match="collision"):
        apply_modification(layout, move(x=1000, y=100))


def test_out_of_bounds_move_rejected(simple_layout):
    layout = rebuilt(simple_layout, lambda data: data["objects"].append(furniture()))
    with pytest.raises(ModificationError, match="out-of-bounds"):
        apply_modification(layout, move(x=-1000, y=100))


def test_unknown_furniture_rejected(simple_layout):
    with pytest.raises(ModificationError):
        apply_modification(simple_layout, move("missing"))


@pytest.mark.parametrize("width", [2000, -1, 800, "920"])
def test_invalid_door_resize_rejected(simple_layout, width):
    with pytest.raises(ModificationError):
        apply_modification(simple_layout, resize(width))


def test_resize_cannot_skip_professional_review(simple_layout):
    mod = resize()
    mod.requiresProfessionalReview = False
    with pytest.raises(ModificationError, match="professional review"):
        apply_modification(simple_layout, mod)


def test_partition_operator_cannot_move_locked_wall(simple_layout):
    mod = Modification(
        id="wall-move",
        type="move-demo-partition",
        targetElementId="partition",
        params={"x": 5000},
        requiresProfessionalReview=True,
    )
    with pytest.raises(ModificationError, match="disabled"):
        apply_modification(simple_layout, mod)


def test_already_passed_layout_needs_no_edits(simple_layout, door_goal):
    simple_layout.doors[0].clearWidth = 950
    proposal = generate_proposals(
        ProposalRequest(layout=simple_layout, goals=[door_goal])
    ).proposals[0]
    assert proposal.modifications == []
    assert all(finding.verdict == "pass" for finding in proposal.findingsAfter)


def test_inferred_geometry_stays_unknown(sample_request):
    sample_request.layout.doors[0].source = "ai-inferred"
    sample_request.layout.doors[0].confidence = 1.0
    proposal = generate_proposals(sample_request).proposals[0]
    assert any(finding.verdict == "unknown" for finding in proposal.findingsAfter)
    assert proposal.resultLayout.doors[0].clearWidth == 800


def test_generated_proposal_preserves_walls_and_fixtures(sample_request):
    proposal = generate_proposals(sample_request).proposals[0]
    assert proposal.resultLayout.walls == sample_request.layout.walls
    before = [obj for obj in sample_request.layout.objects if obj.kind == "fixture"]
    after = [obj for obj in proposal.resultLayout.objects if obj.kind == "fixture"]
    assert before == after


def test_impossible_goal_does_not_disable_achievable_door_goal(
    simple_layout, door_goal, route_goal
):
    route_goal.targetMm = 5000
    proposal = generate_proposals(
        ProposalRequest(layout=simple_layout, goals=[door_goal, route_goal])
    ).proposals[0]
    assert any(f.goalId == door_goal.id and f.verdict == "pass" for f in proposal.findingsAfter)
    assert any(f.goalId == route_goal.id and f.verdict == "fail" for f in proposal.findingsAfter)


def test_attempt_limit_is_reported(monkeypatch, sample_request):
    monkeypatch.setattr("app.solver.MAX_ATTEMPTS", 1)
    response = generate_proposals(sample_request)
    assert any(
        "attempt limit" in question for question in response.proposals[0].unresolvedQuestions
    )


def test_still_colliding_movement_is_rejected(simple_layout):
    layout = rebuilt(
        simple_layout, lambda data: data["objects"].extend([furniture(), furniture("other", x=200)])
    )
    with pytest.raises(ModificationError, match="collision"):
        apply_modification(layout, move(x=150, y=100))
