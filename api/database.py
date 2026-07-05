from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from api.config import settings

# async_database_url normalizes the scheme to asyncpg and strips libpq-only
# params; db_connect_args carries TLS for managed Postgres (Neon). pool_pre_ping
# transparently reconnects when Neon suspends idle connections.
#
# Note: pgvector's SQLAlchemy `Vector` type binds/reads embeddings with asyncpg
# on its own — do NOT also register the pgvector.asyncpg codec on connect, or the
# two double-encode the value and inserts fail ("could not convert string to
# float").
engine = create_async_engine(
    settings.async_database_url,
    echo=settings.ENVIRONMENT == "development",
    connect_args=settings.db_connect_args,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
