from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import time
from collections import deque
from functools import lru_cache
from threading import Lock
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from governed_rag.graph import GovernedRAG
from governed_rag.llm import HybridDocumentRAG, LLMUnavailableError
from governed_rag.models import GeneralQueryRequest, QueryRequest, QueryResponse

SERVICE_VERSION = "0.6.0"
DEFAULT_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "https://youseihuayu-wonderful.github.io"
)
logging.basicConfig(level=os.getenv("GOVERNED_RAG_LOG_LEVEL", "INFO"))
logger = logging.getLogger("groundline.api")


def csv_setting(name: str, default: str) -> list[str]:
    return [value.strip() for value in os.getenv(name, default).split(",") if value.strip()]


def integer_setting(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


class SlidingWindowRateLimiter:
    """Small in-memory guardrail for a single-instance public demonstration API."""

    def __init__(self, limit: int, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.requests: dict[str, deque[float]] = {}
        self.lock = Lock()

    def check(self, key: str) -> tuple[bool, int, int]:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self.lock:
            hits = self.requests.setdefault(key, deque())
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self.limit:
                retry_after = max(1, math.ceil(self.window_seconds - (now - hits[0])))
                return False, 0, retry_after
            hits.append(now)
            return True, max(0, self.limit - len(hits)), self.window_seconds


rate_limit = integer_setting("GOVERNED_RAG_RATE_LIMIT_PER_MINUTE", 20, 1, 300)
rate_limiter = SlidingWindowRateLimiter(rate_limit)
configured_api_keys = csv_setting("GOVERNED_RAG_API_KEYS", "")

app = FastAPI(
    title="Groundline Live API",
    description=(
        "A public demonstration of governed multi-agent RAG for request-scoped user documents "
        "and a bundled synthetic financial domain pack. Every response includes citations, "
        "runtime policy checks, and an inspectable node trace."
    ),
    version=SERVICE_VERSION,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=csv_setting("GOVERNED_RAG_ALLOWED_ORIGINS", DEFAULT_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-Request-ID"],
)


@lru_cache(maxsize=1)
def runtime() -> GovernedRAG:
    return GovernedRAG(
        embedding_backend=os.getenv("GOVERNED_RAG_EMBEDDING_BACKEND", "tfidf")
    )


@lru_cache(maxsize=1)
def general_runtime() -> HybridDocumentRAG:
    return HybridDocumentRAG()


@app.middleware("http")
async def public_api_guardrails(request: Request, call_next):
    request_id = uuid4().hex
    request.state.request_id = request_id
    governed_query_paths = {"/query", "/general/query"}
    if request.method == "POST" and request.url.path in governed_query_paths:
        authorization = request.headers.get("authorization", "")
        token = authorization.removeprefix("Bearer ").strip()
        if configured_api_keys and not any(
            hmac.compare_digest(token, expected) for expected in configured_api_keys
        ):
            return JSONResponse(
                status_code=401,
                content={"detail": "A valid bearer API key is required."},
                headers={"X-Request-ID": request_id},
            )
        if request.url.path == "/general/query":
            try:
                content_length = int(request.headers.get("content-length", "0") or 0)
            except ValueError:
                content_length = 0
            if content_length > 512_000:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "Document workspace request exceeds 512 KB."},
                    headers={"X-Request-ID": request_id},
                )
        client_key = (
            f"api-key:{hashlib.sha256(token.encode()).hexdigest()[:16]}"
            if configured_api_keys
            else request.client.host if request.client else "unknown"
        )
        allowed, remaining, retry_after = rate_limiter.check(client_key)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Public demo rate limit reached. Please retry shortly.",
                    "retry_after_seconds": retry_after,
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(rate_limit),
                    "X-RateLimit-Remaining": "0",
                    "X-Request-ID": request_id,
                },
            )
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-RateLimit-Limit"] = str(rate_limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-Request-ID"] = request_id
        return response
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def structured_request_log(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            json.dumps(
                {
                    "event": "http_request_failed",
                    "method": request.method,
                    "path": request.url.path,
                }
            )
        )
        raise
    logger.info(
        json.dumps(
            {
                "event": "http_request",
                "request_id": getattr(request.state, "request_id", None),
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            }
        )
    )
    return response


@app.get("/", include_in_schema=False)
def service_info() -> dict[str, str]:
    return {
        "service": "groundline-live-api",
        "status": "online",
        "version": SERVICE_VERSION,
        "objective": "Make every document-grounded agent decision inspectable before release.",
        "data": "synthetic-financial-corpus",
        "docs": "/docs",
        "health": "/health",
        "scope": "/scope",
    }


@app.get("/scope")
def corpus_scope() -> dict[str, object]:
    engine = runtime()
    return {
        "data": "synthetic-financial-corpus",
        "synthetic": True,
        "documents": len(engine.corpus.documents),
        "supported_organizations": (
            engine.retriever.knowledge_graph.supported_organizations
        ),
        "domains": ["equity", "macro", "esg"],
        "external_web_search": False,
        "authentication": "bearer" if configured_api_keys else "public-demo",
        "general_document_workspace": {
            "enabled": True,
            "persistence": "none",
            "execution_modes": ["deterministic", "hybrid", "llm"],
            "llm_available": general_runtime().available,
            "llm_provider": general_runtime().provider_name,
            "llm_model": general_runtime().model_name,
            "accepted_formats": ["text", "markdown", "csv", "json"],
            "maximum_documents": 20,
            "minimum_document_characters": 1,
            "maximum_document_characters": None,
            "maximum_total_characters": 120_000,
        },
        "policy": (
            "Company-specific equity and ESG requests without an indexed organization "
            "fail closed before retrieval."
        ),
    }


@app.get("/health")
def health() -> dict[str, object]:
    engine = runtime()
    general = general_runtime()
    return {
        "status": "ok",
        "service": "groundline-live-api",
        "version": SERVICE_VERSION,
        "retrieval_backend": engine.retriever.embedding_backend,
        "corpus_documents": len(engine.corpus.documents),
        "llm_available": general.available,
        "llm_provider": general.provider_name,
        "llm_model": general.model_name,
    }


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest) -> QueryResponse:
    # Fault injection is deliberately unavailable through the public API.
    return runtime().invoke(request.query, top_k=request.top_k)


@app.post("/general/query", response_model=QueryResponse)
def general_query(request: GeneralQueryRequest) -> QueryResponse:
    # Documents are indexed inside this request and are never persisted by the service.
    try:
        return general_runtime().invoke(
            request.query,
            documents=request.documents,
            top_k=request.top_k,
            mode=request.mode,
        )
    except LLMUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
