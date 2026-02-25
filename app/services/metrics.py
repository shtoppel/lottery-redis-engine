import time

class MetricsService:
    @staticmethod
    async def get_system_stats(r):
        # r — это объект redis
        info = await r.info(section="memory")
        return {
            "used_memory": info.get("used_memory_human", "0B"),
            "peak_memory": info.get("used_memory_peak_human", "0B"),
            "total_tickets": await r.scard("lottery:tickets")
        }

    @staticmethod
    def calculate_rps(count: int, duration_ms: float) -> int:
        if duration_ms <= 0:
            return 0
        return int(count / (duration_ms / 1000))