from arq import cron
from arq.connections import RedisSettings

from agent.embedding import warm_model
from api.config import settings
from worker.ai_classify import JOB_TIMEOUT_SECONDS, classify_link, sweep_failed_links
from worker.email import send_email_job
from worker.embed import backfill_embeddings, embed_link
from worker.feed_poll import poll_all_feeds, poll_single_feed
from worker.fetch_retry import retry_unreachable_fetch

_parts = settings.FEED_POLL_CRON.split()
_poll_minute = int(_parts[0]) if _parts[0] != "*" else 0
_poll_hour = int(_parts[1]) if _parts[1] != "*" else 8

_functions = [classify_link, sweep_failed_links, poll_single_feed, poll_all_feeds, retry_unreachable_fetch, send_email_job, embed_link, backfill_embeddings]
_cron_jobs = [
    cron(sweep_failed_links, hour=set(range(24)), minute=0),
    cron(poll_all_feeds, hour={_poll_hour}, minute=_poll_minute),
    # Backfill any links still missing an embedding (hourly, offset from sweep).
    cron(backfill_embeddings, hour=set(range(24)), minute=30),
]

if settings.TELEGRAM_ENABLED:
    from worker.daily_digest import send_daily_digest
    _functions.append(send_daily_digest)
    _cron_jobs.append(cron(send_daily_digest, hour={9}, minute=0))  # Daily at 9:00 UTC


async def _on_startup(ctx) -> None:
    # Warm the embedding model before jobs run so the first embed_link doesn't
    # eat model load time inside a job's timeout. No-op if embeddings disabled.
    warm_model()


class WorkerSettings:
    functions = _functions
    on_startup = _on_startup
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    cron_jobs = _cron_jobs
    max_jobs = 10
    # Defined in worker/ai_classify.py: the Redis slot TTLs and the
    # "processing" watchdog stamp both have to agree with this number.
    job_timeout = JOB_TIMEOUT_SECONDS
    # Slow idle Redis polling 10x to stay inside Upstash's 500K commands/month
    # free tier. Trade-off: a freshly-enqueued job may sit in the queue up to
    # `poll_delay` seconds before the worker picks it up. Acceptable for AI
    # classification (LLM call itself takes seconds) and feed polling (daily).
    poll_delay = 10.0
