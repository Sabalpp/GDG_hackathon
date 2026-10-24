import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Goal, Layout, ProposalRequest

DATA = Path(__file__).resolve().parents[3] / "data"


@pytest.fixture
def sample_request():
    return ProposalRequest.model_validate(
        json.loads((DATA / "sample-proposal-request.json").read_text())
    )


@pytest.fixture
def simple_layout():
    def point(x, y):
        return {"x": x, "y": y}

    return Layout.model_validate(
        {
            "id": "two-rooms",
            "units": "mm",
            "walls": [
                {
                    "id": "partition",
                    "start": point(3000, 0),
                    "end": point(3000, 3000),
                    "thickness": 100,
                    "source": "sample",
                    "editable": True,
                }
            ],
            "doors": [
                {
                    "id": "door",
                    "wallId": "partition",
                    "center": point(3000, 1500),
                    "clearWidth": 850,
                    "source": "sample",
                    "editable": True,
                }
            ],
            "objects": [],
            "rooms": [
                {
                    "id": "left",
                    "label": "Left",
                    "polygon": [point(0, 0), point(3000, 0), point(3000, 3000), point(0, 3000)],
                },
                {
                    "id": "right",
                    "label": "Right",
                    "polygon": [
                        point(3000, 0),
                        point(6000, 0),
                        point(6000, 3000),
                        point(3000, 3000),
                    ],
                },
            ],
        }
    )


@pytest.fixture
def door_goal():
    return Goal(id="door-goal", type="minimum-door-width", targetMm=900, status="confirmed")


@pytest.fixture
def route_goal():
    return Goal(
        id="route-goal",
        type="minimum-path-width",
        targetMm=900,
        fromRoomId="left",
        toRoomId="right",
        status="confirmed",
    )


@pytest.fixture
def client():
    with TestClient(app) as connection:
        yield connection


def furniture(name="chair", x=100, y=100, width=400, height=400, **changes):
    return {
        "id": name,
        "kind": "furniture",
        "label": "Chair",
        "source": "sample",
        "movable": True,
        "bounds": {"x": x, "y": y, "width": width, "height": height},
        **changes,
    }


def rebuilt(layout, mutate):
    data = layout.model_dump(mode="json")
    mutate(data)
    return Layout.model_validate(data)
