import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as aioredis
from arq.connections import RedisSettings, create_pool
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from api.config import settings
from api.database import AsyncSessionLocal
from agent.embedding import warm_model
from api.middleware.analytics import traffic_middleware
from api.routers import account, admin, auth, config, feeds, links, notifications, topics
from api.routers import settings as settings_router
from api.utils.ratelimit import limiter

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.arq_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    app.state.analytics_redis = aioredis.from_url(settings.REDIS_URL)
    # Load the embedding model now (off the loop) so the first search doesn't pay
    # model download+load latency mid-request. No-op when embeddings are disabled.
    await asyncio.to_thread(warm_model)
    yield
    await app.state.arq_pool.aclose()
    await app.state.analytics_redis.aclose()


# Expose interactive docs (/docs, /redoc, /openapi.json) only outside
# production. In production they leak the full API surface (routes, schemas,
# admin endpoints) as free recon, so disable them.
_docs_enabled = settings.ENVIRONMENT.lower() != "production"

app = FastAPI(
    title="Arciv API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Traffic counters (requests / errors / unique visitors) into Redis.
app.middleware("http")(traffic_middleware)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(links.router, prefix="/api/links", tags=["links"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(feeds.router, prefix="/api/feeds", tags=["feeds"])
app.include_router(
    notifications.router, prefix="/api/notifications", tags=["notifications"]
)
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(account.router, prefix="/api/account", tags=["account"])
app.include_router(config.router, prefix="/api/config", tags=["config"])
app.include_router(topics.router, prefix="/api/topics", tags=["topics"])



@app.get("/health")
async def health():
    status_map = {"api": "ok", "db": "error", "redis": "error", "last_feed_poll": None}

    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        status_map["db"] = "ok"
    except Exception as e:
        status_map["db"] = f"error: {e}"

    try:
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        last_poll = await r.get("arciv:last_feed_poll")
        if last_poll:
            status_map["last_feed_poll"] = last_poll.decode()
        await r.aclose()
        status_map["redis"] = "ok"
    except Exception as e:
        status_map["redis"] = f"error: {e}"

    overall = (
        "ok" if status_map["db"] == "ok" and status_map["redis"] == "ok" else "degraded"
    )
    return {"status": overall, **status_map}


if FRONTEND_DIST.is_dir():
    # SPA fallback: client-side routes (e.g. /verify-email, /reset-password) are
    # opened directly from email links, so any non-API, non-asset GET must serve
    # index.html and let the React app route. Real asset requests still resolve
    # because StaticFiles is tried first for existing files.
    from starlette.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = (FRONTEND_DIST / full_path).resolve()
        # Serve a real built asset if the path maps to one (guard against
        # path traversal by confirming it stays inside FRONTEND_DIST).
        if (
            full_path
            and FRONTEND_DIST.resolve() in candidate.parents
            and candidate.is_file()
        ):
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
