"""FastAPI boundary. Express calls this service; browsers call Express."""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.geometry import validate_layout
from app.models import (
    Layout,
    ProposalRequest,
    ProposalResponse,
    ValidationRequest,
    ValidationResponse,
)
from app.solver import generate_proposals

MAX_BODY_BYTES = 1_048_576
DATA_DIR = Path(os.environ.get("ADAPT_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
logger = logging.getLogger("adapt.geometry")
app = FastAPI(title="ADAPT Geometry & Planning (Part C)", version="0.1.0")


def error_response(
    request: Request, status: int, code: str, message: str, details: list | None = None
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
                "requestId": request_id,
                "details": details or [],
            }
        },
        headers={"X-Request-ID": request_id},
    )


@app.middleware("http")
async def bounded_request(request: Request, call_next):
    incoming_id = request.headers.get("X-Request-ID", "")
    request.state.request_id = (
        incoming_id if re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", incoming_id) else str(uuid4())
    )
    if request.method in {"POST", "PUT", "PATCH"}:
        try:
            advertised_size = int(request.headers.get("content-length", "0"))
        except ValueError:
            return error_response(request, 400, "invalid_length", "Invalid Content-Length")
        if advertised_size < 0:
            return error_response(request, 400, "invalid_length", "Invalid Content-Length")
        if advertised_size > MAX_BODY_BYTES:
            return error_response(request, 413, "body_too_large", "JSON body exceeds 1 MiB")
        size = 0
        chunks = []
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BODY_BYTES:
                return error_response(request, 413, "body_too_large", "JSON body exceeds 1 MiB")
            chunks.append(chunk)
        # Starlette's cached request replays this bounded body to FastAPI.
        request._body = b"".join(chunks)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    # Never echo raw inputs, NaN/Infinity, or exception objects into JSON errors.
    details = [
        {"loc": list(error["loc"]), "message": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]
    return error_response(request, 422, "invalid_request", "Invalid geometry request", details)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return error_response(request, exc.status_code, "http_error", str(exc.detail))


@app.exception_handler(Exception)
async def unavailable(request: Request, exc: Exception):
    logger.error(
        "Geometry unavailable request_id=%s error_type=%s",
        getattr(request.state, "request_id", "unknown"),
        type(exc).__name__,
    )
    return error_response(request, 500, "geometry_unavailable", "Geometry validation unavailable")


@app.get("/health")
@app.get("/api/v1/health")
def health():
    return {"status": "ok"}


@app.get("/api/v1/samples/{sample_id}")
def sample(sample_id: str):
    if sample_id not in {"apartment", "sample-layout"}:
        raise HTTPException(status_code=404, detail="Unknown sample")
    layout = Layout.model_validate(json.loads((DATA_DIR / "sample-layout.json").read_text()))
    return {"layout": layout.model_dump(mode="json", exclude_none=True)}


@app.post(
    "/validate",
    response_model=ValidationResponse,
    response_model_exclude_none=True,
    include_in_schema=False,
)
@app.post(
    "/api/v1/layouts/validate", response_model=ValidationResponse, response_model_exclude_none=True
)
def validate(body: ValidationRequest):
    return validate_layout(body.layout, body.goals)


@app.post(
    "/propose",
    response_model=ProposalResponse,
    response_model_exclude_none=True,
    include_in_schema=False,
)
@app.post(
    "/api/v1/proposals/generate", response_model=ProposalResponse, response_model_exclude_none=True
)
def propose(body: ProposalRequest):
    return generate_proposals(body)
