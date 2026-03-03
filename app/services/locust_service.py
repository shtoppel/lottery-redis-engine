# app/services/locust_service.py
from __future__ import annotations

import httpx


class LocustService:
    """
    Управление Locust Web UI (обычно :8089).
    В разных версиях/режимах методы у /stop могут отличаться, поэтому делаем fallback.
    """

    def __init__(self, base_url: str = "http://127.0.0.1:8089"):
        self.base_url = base_url.rstrip("/")

    async def start_swarm(self, user_count: int, spawn_rate: int, scenario: str | None = None) -> bool:
        # scenario сейчас не влияет на locust ui — оставляем для UI/логов.
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{self.base_url}/swarm",
                    data={
                        "user_count": str(int(user_count)),
                        "spawn_rate": str(int(spawn_rate)),
                    },
                )

            if resp.status_code != 200:
                print("[LocustService] /swarm failed:", resp.status_code, resp.text[:300])
                return False

            return True
        except Exception as e:
            print("[LocustService] start_swarm exception:", repr(e))
            return False

    async def stop_swarm(self) -> bool:
        """
        В зависимости от версии Locust:
        - иногда /stop = POST
        - иногда /stop = GET
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                # 1) Try POST
                resp = await client.post(f"{self.base_url}/stop")
                if resp.status_code == 200:
                    return True

                # 2) If method not allowed – try GET
                if resp.status_code in (405, 404):
                    resp2 = await client.get(f"{self.base_url}/stop")
                    if resp2.status_code == 200:
                        return True
                    # иногда Locust может вернуть 302/303 редирект — считаем ок
                    if 300 <= resp2.status_code < 400:
                        return True

                # Логируем, что именно ответил locust
                print("[LocustService] stop_swarm failed:",
                      resp.status_code, resp.text[:300])
                return False

        except Exception as e:
            print("[LocustService] stop_swarm exception:", repr(e))
            return False