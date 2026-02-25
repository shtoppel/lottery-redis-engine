from locust import HttpUser, task, between

class LotteryPlayer(HttpUser):
    host = "http://127.0.0.1:8000"
    wait_time = between(0.1, 0.5)  # Пауза между кликами

    @task
    def check_lottery(self):
        # Эмулируем запрос на мультичек 1000 билетов
        self.client.post("/run-multi-check/10000")