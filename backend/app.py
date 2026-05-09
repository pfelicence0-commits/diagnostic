"""Application entrypoint used by uvicorn.

Expose the main FastAPI app (with CORS and full routes) so
`uvicorn backend.app:app` and `uvicorn backend.main:app` behave the same.
"""

from .main import app

__all__ = ["app"]
