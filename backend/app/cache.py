"""Redis 快取：設計為「有就用、沒有也不會壞」。

統計數字用快取，避免每次都重算。任何 Redis 連線問題都會被安全略過，
不影響主要功能。
"""
import json
import logging

import redis

from .config import settings

log = logging.getLogger("cache")

_client: redis.Redis | None = None
_disabled = False

STATS_KEY = "wedding:stats"
STATS_TTL = 300  # 秒


def _get_client() -> redis.Redis | None:
    global _client, _disabled
    if _disabled:
        return None
    if _client is None:
        try:
            _client = redis.Redis.from_url(
                settings.redis_url, socket_connect_timeout=1, socket_timeout=1
            )
            _client.ping()
            log.info("Redis 已連線，啟用統計快取")
        except Exception as e:  # 沒裝或連不上 → 停用快取，不影響功能
            log.warning("Redis 無法連線，改為不使用快取（不影響功能）：%s", e)
            _client = None
            _disabled = True
    return _client


def get_cached_stats() -> dict | None:
    client = _get_client()
    if not client:
        return None
    try:
        raw = client.get(STATS_KEY)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def set_cached_stats(data: dict) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.setex(STATS_KEY, STATS_TTL, json.dumps(data, default=str))
    except Exception:
        pass


def invalidate_stats() -> None:
    """有新回覆或資料變更時，清掉快取讓下次重新計算。"""
    client = _get_client()
    if not client:
        return
    try:
        client.delete(STATS_KEY)
    except Exception:
        pass
