import os
import random
import time

from locust import HttpUser, task, between

class LotteryPlayer(HttpUser):
    host = os.getenv("TARGET_HOST", "http://127.0.0.1:8000")
    wait_time = between(0.2, 1.0)

    def on_start(self):
        time.sleep(random.uniform(0, 1.0))
        self.known_ticket = None
        r = self.client.get("/get-random-complex-ticket", name="/get-random-complex-ticket")
        if r.status_code == 200:
            data = r.json()
            if data.get("status") == "ok":
                self.known_ticket = "".join(data.get("ticket_pairs", []))

    @task
    def check_lottery(self):
        if not self.known_ticket:
            return
        self.client.get(f"/check/{self.known_ticket}", name="/check/:ticket_id")