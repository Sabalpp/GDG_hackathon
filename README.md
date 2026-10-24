# ADAPT — AI-assisted home accessibility redesign

Part C is implemented: a deterministic Python geometry and proposal service.
It checks measured door clearances, route width/reachability, object collisions,
and generates a bounded proposal from explicitly permitted demo edits.

Start with [the Part C setup guide](services/geometry/README.md) and
[the integration contract for Devs A/B/D](docs/geometry-integration.md).

```bash
cd services/geometry
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
uvicorn app.main:app --reload --port 8000
```

API docs: <http://127.0.0.1:8000/docs>. Health: <http://127.0.0.1:8000/health>.

In another terminal, from `services/geometry`:

```bash
source .venv/bin/activate
python -m scripts.smoke
```

The sample starts with an 800 mm bedroom door and a cabinet narrowing circulation.
For the illustrative 900 mm target, the planner widens that editable sample door
to 920 mm and moves the cabinet. Every modeled check then passes. A 5,000 mm
request intentionally retains failed findings.

All geometry uses millimeters and the same canonical `Layout` JSON. Frontend,
Gemma interpretation, Express orchestration/cost lookup, and cloud deployment
remain the other teammates' integration work. Python makes no AI calls.

These are concept proposals, not accessibility compliance determinations or
construction approvals. Inferred geometry and missing measurements stay unknown.
Costs are left to Express's illustrative catalog; budget feasibility is not
claimed by this service. See [limitations](docs/geometry-integration.md#limitations).

Licensed under [MIT](LICENSE).
