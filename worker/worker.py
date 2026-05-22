from arq import cron
from arq.connections import RedisSettings

from api.config import settings
from worker.ai_classify import classify_link, sweep_failed_links
from worker.feed_poll import poll_all_feeds, poll_single_feed

_parts = settings.FEED_POLL_CRON.split()
_poll_minute = int(_parts[0]) if _parts[0] != "*" else 0
_poll_hour = int(_parts[1]) if _parts[1] != "*" else 8

_functions = [classify_link, sweep_failed_links, poll_single_feed, poll_all_feeds]
_cron_jobs = [
    cron(sweep_failed_links, hour=set(range(24)), minute=0),
    cron(poll_all_feeds, hour={_poll_hour}, minute=_poll_minute),
]

if settings.TELEGRAM_ENABLED:
    from worker.daily_digest import send_daily_digest
    _functions.append(send_daily_digest)
    _cron_jobs.append(cron(send_daily_digest, hour={9}, minute=0))  # Daily at 9:00 UTC


class WorkerSettings:
    functions = _functions
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    cron_jobs = _cron_jobs
    max_jobs = 10
    job_timeout = 120
