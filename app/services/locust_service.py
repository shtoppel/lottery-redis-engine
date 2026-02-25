import httpx
import logging

class LocustService:
    def __init__(self, base_url: str = "http://localhost:8089"):
        self.base_url = base_url

    async def get_stats(self):
        """Получает текущую статистику запросов из Locust"""
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                response = await client.get(f"{self.base_url}/stats/requests")
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "rps": data.get("total_rps", 0),
                        "avg_latency": data.get("avg_response_time", 0),
                        "p95": data.get("ninetieth_percentile_response_time", 0),
                        "fail_ratio": data.get("fail_ratio", 0),
                        "state": data.get("state", "stopped")
                    }
                return {"status": "Locust error", "code": response.status_code}
        except Exception as e:
            return {"status": "Locust not reachable", "error": str(e)}

    async def start_swarm(self, user_count: int, spawn_rate: int):
        """Запускает нагрузочное тестирование"""
        async with httpx.AsyncClient() as client:
            payload = {'user_count': user_count, 'spawn_rate': spawn_rate}
            response = await client.post(f"{self.base_url}/swarm", data=payload)
            return response.status_code == 200

    async def stop_swarm(self):
        """Останавливает тестирование"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/stop")
            return response.status_code == 200