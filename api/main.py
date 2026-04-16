from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from sqlalchemy import text

from api.config import settings
from api.database import AsyncSessionLocal
from api.routers import auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Arciv API", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])


@app.get("/health")
async def health():
    status = {"api": "ok", "db": "error", "redis": "error", "last_feed_poll": None}

    # Check DB
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        status["db"] = "ok"
    except Exception as e:
        status["db"] = f"error: {e}"

    # Check Redis
    try:
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.aclose()
        status["redis"] = "ok"
    except Exception as e:
        status["redis"] = f"error: {e}"

    overall = "ok" if status["db"] == "ok" and status["redis"] == "ok" else "degraded"
    return {"status": overall, **status}
