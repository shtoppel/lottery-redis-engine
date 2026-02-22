import redis.asyncio as redis #asynchron version

pool = redis.ConnectionPool(host='localhost', port=6379, db=0, decode_responses=True)

def get_redis():
    return redis.Redis(connection_pool=pool)