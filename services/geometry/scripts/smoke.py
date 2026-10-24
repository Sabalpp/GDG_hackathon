"""Exercise a running service over real HTTP, including the intentional failure."""

import argparse
import json
from copy import deepcopy
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DATA = Path(__file__).resolve().parents[3] / "data"


def call(base, path, payload=None):
    request = Request(
        base.rstrip("/") + path,
        data=json.dumps(payload, allow_nan=False).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", "X-Request-ID": "adapt-part-c-smoke"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as exc:
        return exc.code, json.load(exc)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    payload = json.loads((DATA / "sample-proposal-request.json").read_text())
    validate_payload = {"layout": payload["layout"], "goals": payload["goals"]}
    status, health = call(args.base_url, "/health")
    assert status == 200 and health == {"status": "ok"}
    status, before = call(args.base_url, "/api/v1/layouts/validate", validate_payload)
    assert status == 200 and before["summary"]["failCount"] > 0
    assert before["summary"]["allPassed"] is False
    status, response = call(args.base_url, "/api/v1/proposals/generate", payload)
    assert status == 200
    proposal = response["proposals"][0]
    assert len(proposal["modifications"]) == 2
    status, after = call(
        args.base_url,
        "/api/v1/layouts/validate",
        {
            "layout": proposal["resultLayout"],
            "goals": payload["goals"],
        },
    )
    assert status == 200 and after["summary"]["allPassed"] is True
    assert after["findings"] == proposal["findingsAfter"]
    impossible = json.loads((DATA / "impossible-request.json").read_text())
    status, failed = call(args.base_url, "/api/v1/proposals/generate", impossible)
    assert status == 200
    assert any(f["verdict"] == "fail" for f in failed["proposals"][0]["findingsAfter"])
    unmeasured = deepcopy(validate_payload)
    unmeasured["layout"]["doors"][0].pop("clearWidth")
    status, unknown = call(args.base_url, "/api/v1/layouts/validate", unmeasured)
    assert status == 200 and unknown["summary"]["unknownCount"] > 0
    draft = deepcopy(validate_payload)
    draft["goals"][0]["status"] = "draft"
    status, rejected = call(args.base_url, "/api/v1/layouts/validate", draft)
    assert status == 422 and rejected["error"]["requestId"]
    print("PASS: health, before, proposal, after, impossible, unknown, draft rejection")
    print("Before:", before["summary"])
    print("After: ", after["summary"])
    for modification in proposal["modifications"]:
        print(modification["type"], modification["targetElementId"], modification["params"])


if __name__ == "__main__":
    main()
