"""Export the actual running app contract for Dev B's schema/type generation."""

import json
from pathlib import Path

from app.main import app


def main():
    destination = Path(__file__).resolve().parents[3] / "docs" / "geometry-openapi.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(app.openapi(), indent=2, allow_nan=False) + "\n")
    print(destination)


if __name__ == "__main__":
    main()
