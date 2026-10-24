"""Authentication, authorisation, rate limiting and request guards."""

from __future__ import annotations

import asyncio
import hmac
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from fastapi import Depends, Header, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from diagnoserl.api.errors import ApiError
from diagnoserl.api.settings import Settings


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


@dataclass(frozen=True)
class Actor:
    name: str
    is_admin: bool


def require_admin(
    request: Request,
    x_api_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings_dep),
) -> Actor:
    """Admin operations require the configured API key (constant-time comparison)."""
    if settings.admin_api_key is None:
        raise ApiError(
            503, "admin_disabled", "admin operations are disabled: no API key configured"
        )
    expected = settings.admin_api_key.get_secret_value().encode()
    provided = (x_api_key or "").encode()
    if not hmac.compare_digest(provided, expected):
        raise ApiError(401, "unauthorized", "missing or invalid API key")
    return Actor(name="admin", is_admin=True)


@dataclass
class SlidingWindowLimiter:
    """In-memory per-client limiter for expensive operations (single-process)."""

    limit: int
    window_seconds: float = 60.0
    clock: Callable[[], float] = time.monotonic
    _hits: dict[str, deque[float]] = field(default_factory=lambda: defaultdict(deque))

    def check(self, key: str) -> None:
        now = self.clock()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()
        if len(hits) >= self.limit:
            retry = max(1, int(self.window_seconds - (now - hits[0])))
            raise ApiError(429, "rate_limited", "too many requests", {"retry_after_seconds": retry})
        hits.append(now)


def _client_key(request: Request) -> str:
    """Resolve the identity used to key rate limits.

    Behind a reverse proxy every request shares the proxy's TCP peer address,
    so ``request.client.host`` alone would collapse all clients into one
    bucket. If the deployment sets ``trusted_proxies`` (its own IP, or the
    upstream LB's), trust the left-most ``X-Forwarded-For`` entry; otherwise
    fall back to the raw peer address, since trusting the header from an
    untrusted peer would let a client spoof its way around the limit.
    """
    settings: Settings = request.app.state.settings
    peer = request.client.host if request.client else "unknown"
    if peer in settings.trusted_proxies:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip() or peer
    return peer


def rate_limit_expensive(request: Request) -> None:
    """Dependency for training / evaluation endpoints."""
    limiter: SlidingWindowLimiter = request.app.state.limiter
    limiter.check(_client_key(request))


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose declared body exceeds ``max_bytes``."""

    def __init__(self, app, max_bytes: int) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        length = request.headers.get("content-length")
        if length is not None and length.isdigit() and int(length) > self.max_bytes:
            return _json_error(413, "payload_too_large", "request body too large")
        return await call_next(request)


class TimeoutMiddleware(BaseHTTPMiddleware):
    """Return 504 if a request takes longer than ``seconds``.

    Route handlers are sync ``def`` functions, so Starlette runs them on a
    worker thread; cancelling the ``await`` on timeout does not stop that
    thread, which keeps running until the handler itself returns. Without a
    cap, a burst of slow requests would each occupy a thread-pool slot well
    past their own timeout, eventually starving unrelated requests even
    though every individual request "timed out" correctly. ``max_concurrent``
    bounds how many requests may be in flight at once; once at capacity,
    new requests fail fast with 503 instead of queueing behind stuck ones.
    """

    def __init__(self, app, seconds: float, max_concurrent: int = 100) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.seconds = seconds
        self.max_concurrent = max_concurrent
        self._inflight = 0

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if self._inflight >= self.max_concurrent:
            return _json_error(503, "server_busy", "too many in-flight requests")
        self._inflight += 1
        try:
            return await asyncio.wait_for(call_next(request), timeout=self.seconds)
        except TimeoutError:
            return _json_error(504, "timeout", "request timed out")
        finally:
            self._inflight -= 1


def _json_error(status: int, code: str, message: str) -> Response:
    import json

    body = json.dumps({"error": {"code": code, "message": message, "details": {}}})
    return Response(body, status_code=status, media_type="application/json")
