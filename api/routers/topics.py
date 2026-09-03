from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import get_current_user
from api.models.link import Link
from api.models.user import User
from api.schemas.topic import TopicResponse
from api.utils.link_query import apply_queue_scope
from api.utils.tags import tag_key_sql

router = APIRouter()


@router.get("", response_model=list[TopicResponse])
async def list_topics(
    queue: str | None = Query(None, max_length=30, description="Same values as GET /api/links"),
    min_count: int = Query(2, ge=1, le=100),
    limit: int = Query(50, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Topics for the current user: ``ai_tags`` grouped by normalised key.

    ``min_count`` defaults to 2 because five tags per link over a few hundred
    links yields a long tail of singletons; a list where most rows hold one item
    is not a discovery surface. Pass ``min_count=1`` for the full set.

    ``queue`` scopes the whole list through the same ``apply_queue_scope`` the
    link list uses, so the topics on the Try Later tab are Try Later's topics and
    the counts are Try Later's counts. Without it the rail would describe the
    library while the list below showed one queue — a chip reading 12 opening a
    list of 3. It also means a topic that exists only outside the current tab
    disappears from the rail rather than offering a click that returns nothing.
    ``queue="archive"`` follows the link list and reads *status*, not queue.

    Not rate limited: this is one scan of the caller's own rows, cheaper than the
    two ``GET /api/links?limit=500`` calls the dashboard already makes on load.
    """
    # One row per (link, tag). The LATERAL is written out rather than left
    # implicit (`FROM links, unnest(...)`) because SQLAlchemy cannot tell the two
    # apart and warns "cartesian product between links and tag" on a query that
    # has none — a warning nobody will correctly triage a year from now. An inner
    # join drops links whose ai_tags is NULL or empty, which is what we want.
    tags = func.unnest(Link.ai_tags).table_valued("tag").render_derived().lateral()
    tag = tags.c.tag
    key = tag_key_sql(tag)
    # DISTINCT: one link can carry two spellings that normalise to one key.
    count = func.count(func.distinct(Link.id))

    stmt = (
        select(
            key.label("key"),
            # The dominant spelling becomes the label, so "PostgreSQL" wins over
            # a single stray "postgresql" instead of whichever row sorted first.
            func.mode().within_group(tag).label("label"),
            count.label("count"),
        )
        .select_from(Link)
        .join(tags, true())
        .where(Link.user_id == current_user.id)
        .group_by(key)
        # Drops tags that were only separators, which normalise to "".
        .having(key != "")
        .having(count >= min_count)
        .order_by(desc("count"), "key")
        .limit(limit)
    )
    stmt = apply_queue_scope(stmt, queue)

    result = await db.execute(stmt)
    return [
        TopicResponse(key=row.key, label=row.label, count=row.count)
        for row in result.all()
    ]
