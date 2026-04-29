from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from arq.connections import RedisSettings, create_pool
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from api.config import settings
from api.database import AsyncSessionLocal
from api.routers import auth, links
from api.routers import settings as settings_router
from api.routers import feeds, notifications


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.arq_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    yield
    await app.state.arq_pool.aclose()


app = FastAPI(title="Arciv API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(links.router, prefix="/api/links", tags=["links"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(feeds.router, prefix="/api/feeds", tags=["feeds"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])


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

    overall = "ok" if status_map["db"] == "ok" and status_map["redis"] == "ok" else "degraded"
    return {"status": overall, **status_map}
