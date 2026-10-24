import pytest
from conftest import furniture, rebuilt
from shapely.geometry import LineString

from app.geometry import GeometryContext, collision_findings, validate_layout
from app.models import Goal


def goal_findings(result, goal):
    return [finding for finding in result.findings if finding.goalId == goal.id]


@pytest.mark.parametrize(("width", "verdict"), [(850, "fail"), (950, "pass"), (900, "pass")])
def test_measured_door_width(simple_layout, door_goal, width, verdict):
    simple_layout.doors[0].clearWidth = width
    finding = goal_findings(validate_layout(simple_layout, [door_goal]), door_goal)[0]
    assert finding.verdict == verdict
    assert finding.measuredMm == width
    assert finding.requiredMm == 900
    assert finding.affectedElementIds == ["door"]


@pytest.mark.parametrize("missing", [None])
def test_missing_width_is_unknown(simple_layout, door_goal, missing):
    simple_layout.doors[0].clearWidth = missing
    response = validate_layout(simple_layout, [door_goal])
    assert goal_findings(response, door_goal)[0].verdict == "unknown"
    assert not response.summary.allPassed


def test_missing_width_keeps_route_unknown(simple_layout, route_goal):
    simple_layout.doors[0].clearWidth = None
    response = validate_layout(simple_layout, [route_goal])
    assert goal_findings(response, route_goal)[0].verdict == "unknown"
    assert response.routes[0].points == []


@pytest.mark.parametrize(
    ("width", "verdict"), [(850, "fail"), (899, "fail"), (900, "pass"), (950, "pass")]
)
def test_route_uses_door_opening(simple_layout, route_goal, width, verdict):
    simple_layout.doors[0].clearWidth = width
    finding = goal_findings(validate_layout(simple_layout, [route_goal]), route_goal)[0]
    assert finding.verdict == verdict
    if verdict == "pass":
        assert finding.measuredMm >= 900


def test_closed_partition_blocks_route(simple_layout, route_goal):
    simple_layout.doors = []
    response = validate_layout(simple_layout, [route_goal])
    assert goal_findings(response, route_goal)[0].verdict == "fail"
    assert response.routes[0].points == []


def test_object_blocks_wide_door(simple_layout, route_goal):
    simple_layout.doors[0].clearWidth = 1200
    blocked = rebuilt(
        simple_layout,
        lambda data: data["objects"].append(furniture(x=3500, y=0, width=400, height=3000)),
    )
    assert goal_findings(validate_layout(blocked, [route_goal]), route_goal)[0].verdict == "fail"


def test_pass_trace_is_inside_required_clearance_region(simple_layout, route_goal):
    simple_layout.doors[0].clearWidth = 950
    response = validate_layout(simple_layout, [route_goal])
    trace = response.routes[0]
    assert trace.verdict == "pass"
    assert len(trace.points) >= 2
    context = GeometryContext(simple_layout)
    assert context.space(900).covers(LineString([point.xy() for point in trace.points]))


def test_failed_width_trace_is_a_narrow_centerline(simple_layout, route_goal):
    trace = validate_layout(simple_layout, [route_goal]).routes[0]
    assert trace.verdict == "fail"
    assert trace.points
    context = GeometryContext(simple_layout)
    assert context.space(0).covers(LineString([point.xy() for point in trace.points]))
    assert not context.space(900).covers(LineString([point.xy() for point in trace.points]))


def test_reachable_without_target_does_not_claim_device_clearance(simple_layout):
    goal = Goal(
        id="point", type="reachable-route", fromRoomId="left", toRoomId="right", status="confirmed"
    )
    finding = goal_findings(validate_layout(simple_layout, [goal]), goal)[0]
    assert finding.verdict == "pass"
    assert finding.requiredMm is None
    assert "no device width specified" in finding.explanation


def test_no_target_is_unknown_for_width_goal(simple_layout):
    goal = Goal(id="missing", type="minimum-path-width", status="confirmed")
    assert goal_findings(validate_layout(simple_layout, [goal]), goal)[0].verdict == "unknown"


def test_global_route_checks_all_room_anchors(sample_request):
    goal = Goal(id="global", type="minimum-path-width", targetMm=900, status="confirmed")
    response = validate_layout(sample_request.layout, [goal])
    assert len(response.routes) == len(sample_request.layout.rooms) - 1
    assert any(route.verdict == "fail" for route in response.routes)


@pytest.mark.parametrize("element", ["walls", "doors", "objects"])
def test_inference_never_becomes_verified(simple_layout, route_goal, element):
    data = simple_layout.model_dump(mode="json")
    if element == "objects":
        data["objects"].append(furniture())
    data[element][0].update(source="ai-inferred", confidence=1.0)
    layout = type(simple_layout).model_validate(data)
    response = validate_layout(layout, [route_goal])
    assert goal_findings(response, route_goal)[0].verdict == "unknown"
    assert not response.summary.allPassed


def test_diagonal_room_boundary_is_unknown(simple_layout, route_goal):
    layout = rebuilt(
        simple_layout, lambda data: data["rooms"][0]["polygon"].__setitem__(0, {"x": 500, "y": 0})
    )
    finding = goal_findings(validate_layout(layout, [route_goal]), route_goal)[0]
    assert finding.verdict == "unknown"


def test_object_overlap_detected(simple_layout):
    layout = rebuilt(
        simple_layout,
        lambda data: data["objects"].extend([furniture(), furniture("second", x=200, y=200)]),
    )
    assert any(
        set(f.affectedElementIds) == {"chair", "second"} and f.verdict == "fail"
        for f in collision_findings(layout)
    )


def test_touching_objects_do_not_overlap(simple_layout):
    layout = rebuilt(
        simple_layout,
        lambda data: data["objects"].extend([furniture(), furniture("second", x=500, y=100)]),
    )
    assert all(f.verdict == "pass" for f in collision_findings(layout))


def test_wall_collision_detected(simple_layout):
    layout = rebuilt(simple_layout, lambda data: data["objects"].append(furniture(x=2800, y=100)))
    assert any("partition" in f.affectedElementIds for f in collision_findings(layout))


def test_out_of_bounds_object_detected(simple_layout):
    layout = rebuilt(simple_layout, lambda data: data["objects"].append(furniture(x=-100)))
    assert any("outside" in f.explanation for f in collision_findings(layout))


def test_sample_starts_collision_free(sample_request):
    assert all(f.verdict == "pass" for f in collision_findings(sample_request.layout))


def test_anchor_inside_obstacle_cannot_be_relocated(simple_layout, route_goal):
    simple_layout.doors[0].clearWidth = 1200
    layout = rebuilt(
        simple_layout,
        lambda data: data["objects"].append(furniture(x=1300, y=1300, width=400, height=400)),
    )
    assert goal_findings(validate_layout(layout, [route_goal]), route_goal)[0].verdict == "fail"
