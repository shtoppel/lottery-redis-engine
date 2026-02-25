import httpx
from fastapi import APIRouter, Request, HTTPException
import asyncio
import psutil
from fastapi import Request

# Импортируем наши сервисы
from app.services.lottery_service import LotteryService
from app.services.metrics import MetricsService
from app.services.locust_service import LocustService

router = APIRouter()
locust_manager = LocustService()  # Сервис для Locust


# --- ГЕНЕРАЦИЯ ---

@router.post("/generate-participants/{count}")
async def generate_participants(count: int, request: Request):
    r = request.app.state.redis
    # Вызываем метод из сервиса, который мы создали ранее
    asyncio.create_task(LotteryService.generate_python_batch(r, count))
    return {"message": "Python generation started"}

@router.post("/generate-lua/{count}")
async def generate_lua(count: int, request: Request):
    # Запускаем фоновую задачу через сервис
    asyncio.create_task(LotteryService.generate_lua_batch(request.app.state.redis, count))
    return {"status": "Lua generation started"}


# --- ЛОГИКА РОЗЫГРЫША ---

@router.get("/get-random-complex-ticket")
async def get_random_complex_ticket(request: Request):
    r = request.app.state.redis
    # Просто берем случайный билет из пула
    raw_ticket = await r.srandmember("lottery:tickets")
    if not raw_ticket:
        return {"ticket_pairs": [], "status": "empty"}

    ticket_str = raw_ticket.decode() if isinstance(raw_ticket, bytes) else raw_ticket
    pairs = [ticket_str[i:i + 2] for i in range(0, len(ticket_str), 2)]

    # Возвращаем сам билет. МЫ НЕ МЕНЯЕМ winning_number здесь.
    return {"ticket_pairs": pairs, "status": "ok"}


# В эндпоинте генерации (lua или python) добавь установку джекпота
# чтобы при создании пула всегда назначался один победитель
async def finalize_generation(r):
    lucky_guy = await r.srandmember("lottery:tickets")
    if lucky_guy:
        await r.set("lottery:winning_number", lucky_guy)

@router.post("/run-full-lottery")
async def run_full_lottery(data: dict, request: Request):
    r = request.app.state.redis
    user_ticket = "".join(data.get('user_ticket', []))

    # Запускаем фоновую задачу полного цикла
    asyncio.create_task(LotteryService.run_full_lottery_task(r, user_ticket))
    return {"status": "started"}


@router.get("/check-result")
async def check_result(ticket: str, request: Request):
    r = request.app.state.redis
    # Получаем выигрышный номер из базы
    winning_ticket = await r.get("lottery:winning_number")

    if not winning_ticket:
        # Если джекпота нет, берем ЛЮБОЙ из базы и делаем его джекпотом
        raw_winning = await r.srandmember("lottery:tickets")
        if not raw_winning:
            return {"winner": False, "winning_ticket": []}
        winning_ticket = raw_winning.decode() if isinstance(raw_winning, bytes) else raw_winning
        await r.set("lottery:winning_number", winning_ticket)
    else:
        winning_ticket = winning_ticket.decode() if isinstance(winning_ticket, bytes) else winning_ticket

    # Сравниваем переданный с фронта билет с тем, что в базе
    is_winner = (ticket == winning_ticket)

    return {
        "winner": is_winner,
        "winning_ticket": [winning_ticket[i:i + 2] for i in range(0, len(winning_ticket), 2)]
    }

@router.post("/run-multi-check/{count}")
async def run_multi_check(count: int, request: Request):
    r = request.app.state.redis

    # Валидация на стороне сервера (минимум 10,000)
    if count < 10000:
        raise HTTPException(status_code=400, detail="Minimum multi-check is 10,000")

    winning_ticket = await r.get("lottery:winning_number")
    # Если джекпота нет в базе, назначаем его из существующих билетов (один раз)
    if not winning_ticket:
        raw_winning = await r.srandmember("lottery:tickets")
        if not raw_winning:
            raise HTTPException(status_code=400, detail="Pool is empty")
        winning_ticket = raw_winning.decode() if isinstance(raw_winning, bytes) else raw_winning
        await r.set("lottery:winning_number", winning_ticket)

    result = await LotteryService.execute_multi_check(r, "lottery:tickets", count, winning_ticket)
    stats = await MetricsService.get_system_stats(r)

    return {
        "rps": result["rps"],
        "execution_time_ms": result["execution_time_ms"],
        "checked_count": count,
        "winners": result["winners"],
        "used_memory": stats["used_memory"]
    }


@router.get("/system-stats")
async def get_system_stats(request: Request):
    try:
        # Память Redis
        redis_info = await request.app.state.redis.info("memory")

        # Память системы (psutil)
        vm = psutil.virtual_memory()

        return {
            "redis_mem": redis_info.get('used_memory_human', "0B"),
            "sys_mem_bytes": vm.used,  # Сколько занято (в байтах)
            "sys_total_bytes": vm.total  # Всего в системе (в байтах)
        }
    except Exception as e:
        print(f"Stats Error: {e}")
        return {"redis_mem": "Err", "sys_mem_bytes": 0, "sys_total_bytes": 0}


# --- LOCUST CONTROL (твой код) ---

@router.get("/locust-stats")
async def get_locust_stats():
    try:
        import httpx
        async with httpx.AsyncClient(timeout=1.0) as client:
            # Делаем запрос к Locust API
            r = await client.get("http://localhost:8089/stats/requests")
            data = r.json()

            # 1. Извлекаем общие метрики (для плашек)
            # В разных версиях Locust ключи могут называться total_rps или current_rps
            rps = data.get("total_rps") or data.get("current_rps") or 0
            p95 = data.get("current_response_time_percentile_95") or data.get("ninetieth_response_time") or 0

            # 2. Извлекаем список всех эндпоинтов (для таблицы)
            # Мы берем список 'stats', но убираем из него строку "Total",
            # так как она дублирует общие показатели
            raw_stats = data.get("stats", [])
            full_stats = [s for s in raw_stats if s.get("name") != "Total"]

            return {
                "rps": rps,
                "p95": p95,
                "fail_ratio": data.get("fail_ratio", 0),
                "full_stats": full_stats  # ТЕПЕРЬ ДАННЫЕ ДЛЯ ТАБЛИЦЫ ЕСТЬ ТУТ
            }
    except Exception as e:
        print(f"Locust fetch error: {e}")
        return {"rps": 0, "p95": 0, "fail_ratio": 0, "full_stats": []}


@router.post("/locust/start")
async def start_locust(user_count: int = 100, spawn_rate: int = 10):
    success = await locust_manager.start_swarm(user_count, spawn_rate)
    if not success:
        raise HTTPException(status_code=503, detail="Could not start Locust swarm")
    return {"status": "swarming started"}


@router.post("/locust/stop")
async def stop_locust():
    await locust_manager.stop_swarm()
    return {"status": "swarming stopped"}


# --- ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ---

@router.post("/clear-database")
async def clear_db(request: Request):
    r = request.app.state.redis
    await LotteryService.clear_all_data(r)
    return {"status": "Database cleared"}