"""Vercel serverless entrypoint for the public FastAPI service."""

from app.main import app

__all__ = ["app"]
