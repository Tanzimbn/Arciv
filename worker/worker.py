from arq import cron
from arq.connections import RedisSettings

from api.config import settings
from worker.ai_classify import classify_link, sweep_failed_links


class WorkerSettings:
    functions = [classify_link, sweep_failed_links]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    cron_jobs = [
        cron(sweep_failed_links, hour=set(range(24)), minute=0),
    ]
    max_jobs = 10
    job_timeout = 120
