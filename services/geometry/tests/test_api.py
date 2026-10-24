import json

import pytest
from fastapi.testclient import TestClient

from app.main import MAX_BODY_BYTES, app
from app.models import ProposalResponse, ValidationResponse


@pytest.mark.parametrize("path", ["/health", "/api/v1/health"])
def test_health(client, path):
    response = client.get(path, headers={"X-Request-ID": "team-smoke-1"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"] == "team-smoke-1"


def test_sample_endpoint(client, sample_request):
    response = client.get("/api/v1/samples/apartment")
    assert response.status_code == 200
    assert response.json()["layout"]["id"] == sample_request.layout.id


def test_unknown_sample(client):
    response = client.get("/api/v1/samples/missing")
    assert response.status_code == 404
    assert response.json()["error"]["requestId"] == response.headers["X-Request-ID"]


@pytest.mark.parametrize("path", ["/validate", "/api/v1/layouts/validate"])
def test_validation_contract(client, sample_request, path):
    payload = {
        "layout": sample_request.layout.model_dump(mode="json"),
        "goals": [goal.model_dump(mode="json") for goal in sample_request.goals],
    }
    response = client.post(path, json=payload)
    assert response.status_code == 200
    parsed = ValidationResponse.model_validate(response.json())
    assert parsed.summary.failCount > 0
    assert parsed.routes


def test_proposal_end_to_end(client, sample_request):
    response = client.post(
        "/api/v1/proposals/generate", json=sample_request.model_dump(mode="json")
    )
    assert response.status_code == 200
    proposal = ProposalResponse.model_validate(response.json()).proposals[0]
    result = client.post(
        "/api/v1/layouts/validate",
        json={
            "layout": proposal.resultLayout.model_dump(mode="json"),
            "goals": [goal.model_dump(mode="json") for goal in sample_request.goals],
        },
    )
    assert result.json()["summary"]["allPassed"] is True
    assert len(proposal.modifications) == 2
    assert "costs" in response.json()["proposals"][0]


def test_impossible_api_case(client, sample_request):
    payload = sample_request.model_dump(mode="json")
    for goal in payload["goals"]:
        goal["targetMm"] = 5000
    response = client.post("/propose", json=payload)
    assert response.status_code == 200
    assert any(f["verdict"] == "fail" for f in response.json()["proposals"][0]["findingsAfter"])


def test_draft_goals_rejected(client, sample_request):
    payload = sample_request.model_dump(mode="json")
    payload["goals"][0]["status"] = "draft"
    response = client.post("/propose", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_malformed_json_is_controlled(client):
    response = client.post("/validate", content="{", headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert response.json()["error"]["requestId"]


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_nonfinite_json_has_serializable_error(client, sample_request, value):
    payload = sample_request.model_dump(mode="json")
    payload["layout"]["doors"][0]["clearWidth"] = "REPLACE_NONFINITE"
    raw = json.dumps(payload).replace('"REPLACE_NONFINITE"', value)
    response = client.post("/propose", content=raw, headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert "input" not in response.json()["error"]["details"][0]


def test_payload_limit(client):
    response = client.post("/validate", content="x" * (MAX_BODY_BYTES + 1))
    assert response.status_code == 413
    assert response.headers["X-Request-ID"]


def test_streamed_payload_limit_without_content_length(client):
    response = client.post("/validate", content=iter([b"x" * MAX_BODY_BYTES, b"x"]))
    assert response.status_code == 413


def test_unknown_layout_field_rejected(client, sample_request):
    payload = sample_request.model_dump(mode="json")
    payload["layout"]["compliant"] = True
    response = client.post("/propose", json=payload)
    assert response.status_code == 422


def test_invalid_budget_currency_rejected(client, sample_request):
    payload = sample_request.model_dump(mode="json")
    payload["budget"]["currency"] = "EUR"
    assert client.post("/propose", json=payload).status_code == 422


def test_internal_geometry_error_does_not_become_pass(monkeypatch, sample_request):
    def broken(*args, **kwargs):
        raise RuntimeError("sensitive raw input must never be echoed")

    monkeypatch.setattr("app.main.validate_layout", broken)
    with TestClient(app, raise_server_exceptions=False) as connection:
        response = connection.post(
            "/validate",
            json={
                "layout": sample_request.layout.model_dump(mode="json"),
                "goals": [goal.model_dump(mode="json") for goal in sample_request.goals],
            },
        )
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "geometry_unavailable"
    assert "sensitive" not in response.text
    assert response.headers["X-Request-ID"]


def test_openapi_exposes_team_contract(client):
    schema = client.get("/openapi.json").json()
    assert "/api/v1/layouts/validate" in schema["paths"]
    assert "/api/v1/proposals/generate" in schema["paths"]
    assert "Layout" in schema["components"]["schemas"]
