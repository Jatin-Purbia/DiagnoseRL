"""Consistent error responses: ``{"error": {"code", "message", "details"}}``."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """Application error mapped to an HTTP status and a stable machine-readable code."""

    def __init__(
        self, status_code: int, code: str, message: str, details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def not_found(what: str, ident: object) -> ApiError:
    return ApiError(404, "not_found", f"{what} {ident!s} not found")


def conflict(code: str, message: str, **details: Any) -> ApiError:
    return ApiError(409, code, message, details)


def bad_request(code: str, message: str, **details: Any) -> ApiError:
    return ApiError(400, code, message, details)


def _body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": [str(p) for p in e["loc"]], "msg": e["msg"], "type": e["type"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            _body("validation_error", "request validation failed", {"errors": errors}),
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(_body("http_error", str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(IntegrityError)
    @app.exception_handler(StaleDataError)
    async def _concurrent(_: Request, exc: Exception) -> JSONResponse:
        # A concurrent request changed the same session first (unique / version conflict).
        return JSONResponse(
            _body("concurrent_modification", "the resource was modified concurrently; retry"),
            status_code=409,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        import logging

        logging.getLogger(__name__).exception(
            "unhandled error", extra={"path": request.url.path, "method": request.method}
        )
        return JSONResponse(_body("internal_error", "internal server error"), status_code=500)
