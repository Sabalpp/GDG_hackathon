import math

import pytest
from pydantic import ValidationError

from app.models import Layout, Modification, ValidationRequest


@pytest.mark.parametrize("bad", [-1, 0, math.nan, math.inf, -math.inf, "900", True])
def test_bad_dimensions_rejected(simple_layout, bad):
    data = simple_layout.model_dump(mode="json")
    data["doors"][0]["clearWidth"] = bad
    with pytest.raises(ValidationError):
        Layout.model_validate(data)


def test_broken_wall_reference_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["doors"][0]["wallId"] = "missing"
    with pytest.raises(ValidationError, match="missing wall"):
        Layout.model_validate(data)


def test_duplicate_element_ids_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["doors"][0]["id"] = "partition"
    with pytest.raises(ValidationError, match="globally unique"):
        Layout.model_validate(data)


@pytest.mark.parametrize(
    "polygon",
    [
        [{"x": 0, "y": 0}, {"x": 1, "y": 1}, {"x": 2, "y": 2}],
        [{"x": 0, "y": 0}, {"x": 100, "y": 100}, {"x": 0, "y": 100}, {"x": 100, "y": 0}],
    ],
)
def test_invalid_polygon_rejected(simple_layout, polygon):
    data = simple_layout.model_dump(mode="json")
    data["rooms"][0]["polygon"] = polygon
    with pytest.raises(ValidationError):
        Layout.model_validate(data)


def test_overlapping_rooms_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["rooms"][1]["polygon"][0]["x"] = 2500
    with pytest.raises(ValidationError, match="interiors must not overlap"):
        Layout.model_validate(data)


def test_door_off_wall_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["doors"][0]["center"]["x"] = 2900
    with pytest.raises(ValidationError, match="centerline"):
        Layout.model_validate(data)


def test_door_exceeding_wall_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["doors"][0]["clearWidth"] = 4000
    with pytest.raises(ValidationError, match="exceeds"):
        Layout.model_validate(data)


def test_overlapping_door_openings_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["doors"].append({**data["doors"][0], "id": "door-2"})
    with pytest.raises(ValidationError, match="openings.*overlap"):
        Layout.model_validate(data)


def test_zero_length_wall_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["walls"][0]["end"] = data["walls"][0]["start"]
    with pytest.raises(ValidationError, match="endpoints"):
        Layout.model_validate(data)


def test_missing_inference_confidence_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["doors"][0]["source"] = "ai-inferred"
    with pytest.raises(ValidationError, match="confidence"):
        Layout.model_validate(data)


def test_unknown_fields_rejected(simple_layout):
    data = simple_layout.model_dump(mode="json")
    data["compliant"] = True
    with pytest.raises(ValidationError, match="Extra inputs"):
        Layout.model_validate(data)


def test_draft_goal_rejected(simple_layout, door_goal):
    door_goal.status = "draft"
    with pytest.raises(ValidationError, match="confirm or edit"):
        ValidationRequest(layout=simple_layout, goals=[door_goal])


def test_missing_room_reference_rejected(simple_layout, route_goal):
    route_goal.toRoomId = "missing"
    with pytest.raises(ValidationError, match="missing room"):
        ValidationRequest(layout=simple_layout, goals=[route_goal])


def test_duplicate_goal_ids_rejected(simple_layout, door_goal):
    with pytest.raises(ValidationError, match="goal IDs"):
        ValidationRequest(layout=simple_layout, goals=[door_goal, door_goal])


def test_unknown_operator_rejected():
    with pytest.raises(ValidationError):
        Modification(
            id="bad",
            type="demolish-wall",
            targetElementId="wall",
            params={},
            requiresProfessionalReview=True,
        )


def test_maximum_length_input_ids_produce_valid_findings(simple_layout, door_goal):
    from app.geometry import validate_layout

    data = simple_layout.model_dump(mode="json")
    data["doors"][0]["id"] = "d" * 128
    layout = Layout.model_validate(data)
    door_goal.id = "g" * 128
    result = validate_layout(layout, [door_goal])
    assert all(len(finding.id) <= 128 for finding in result.findings)
    assert any(finding.goalId == door_goal.id for finding in result.findings)
