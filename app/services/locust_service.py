from __future__ import annotations

import os
import httpx


class LocustService:

    def __init__(self, base_url: str | None = None):
        # Docker:   http://locust:8089
        # Local:   http://127.0.0.1:8089
        base_url = base_url or os.getenv("LOCUST_WEB_URL", "http://127.0.0.1:8089")
        self.base_url = base_url.rstrip("/")

    async def start_swarm(self, user_count: int, spawn_rate: int, scenario: str | None = None) -> bool:
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
        Robust stop:
        1) Try POST /stop
        2) Try GET /stop (some versions)
        3) Fallback: POST /swarm with user_count=0 (works on most setups)
        """
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                # 1) Try POST /stop
                resp = await client.post(f"{self.base_url}/stop")
                if resp.status_code in (200, 204):
                    return True

                # 2) Try GET /stop
                resp2 = await client.get(f"{self.base_url}/stop")
                if resp2.status_code in (200, 204) or (300 <= resp2.status_code < 400):
                    return True

                # 3) Fallback: swarm to 0 users
                resp3 = await client.post(
                    f"{self.base_url}/swarm",
                    data={"user_count": "0", "spawn_rate": "1"},
                )
                if resp3.status_code in (200, 204):
                    return True

                print("[LocustService] stop_swarm failed:",
                      resp.status_code, resp.text[:200],
                      "|", resp2.status_code, resp2.text[:200],
                      "|", resp3.status_code, resp3.text[:200])
                return False

        except Exception as e:
            print("[LocustService] stop_swarm exception:", repr(e))
            return False