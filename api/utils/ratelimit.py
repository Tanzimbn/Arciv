"""Shared slowapi limiter, backed by Redis so limits hold across API workers."""
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.config import settings

limiter = Limiter(key_func=get_remote_address, storage_uri=settings.REDIS_URL)