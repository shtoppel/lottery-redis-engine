import os
import redis.asyncio as redis  # async version

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

pool = redis.ConnectionPool.from_url(
    REDIS_URL,
    decode_responses=True,
    max_connections=2000,
    health_check_interval=30,
    socket_connect_timeout=5,
    socket_timeout=5,
)

def get_redis():
    return redis.Redis(connection_pool=pool)