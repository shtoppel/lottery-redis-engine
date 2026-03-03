import asyncio
import time
import psutil
import httpx

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from redis.exceptions import ConnectionError as RedisConnectionError, TimeoutError as RedisTimeoutError

from app.core.lua_templates import LUA_MULTI_CHECK
from app.services.lottery_service import LotteryService
from app.services.locust_service import LocustService

router = APIRouter()
locust_manager = LocustService()


class LocustStartRequest(BaseModel):
    user_count: int
    spawn_rate: int
    scenario: str | None = None


# ------------------------
# Tickets helpers
# ------------------------

@router.get("/tickets/preload/{count}", response_class=ORJSONResponse)
async def tickets_preload(count: int, request: Request):
    if count <= 0:
        raise HTTPException(status_code=400, detail="count must be > 0")

    r = request.app.state.redis
    total = await r.scard("lottery:tickets")
    if total <= 0:
        return {"status": "empty", "tickets": []}

    if count > total:
        count = total

    tickets = await r.srandmember("lottery:tickets", number=count)
    if not tickets:
        return {"status": "empty", "tickets": []}

    if isinstance(tickets, str):
        tickets = [tickets]

    return {"status": "ok", "tickets": tickets, "count": len(tickets)}


@router.get("/ticket/random", response_class=ORJSONResponse)
async def get_random_ticket_id(request: Request):
    r = request.app.state.redis
    t = await r.srandmember("lottery:tickets")
    if not t:
        raise HTTPException(status_code=400, detail="Pool empty")
    if isinstance(t, (bytes, bytearray)):
        t = t.decode()
    return {"ticket_id": t}


@router.get("/tickets/sample/{count}", response_class=ORJSONResponse)
async def tickets_sample(count: int, request: Request):
    if count <= 0:
        raise HTTPException(status_code=400, detail="count must be > 0")

    r = request.app.state.redis
    tickets = await r.srandmember("lottery:tickets", count)

    if not tickets:
        return {"status": "empty", "count": 0, "tickets": []}

    if isinstance(tickets, str):
        tickets = [tickets]

    return {"status": "ok", "count": len(tickets), "tickets": tickets}


# ------------------------
# Admin
# ------------------------

@router.post("/admin/draw", response_class=ORJSONResponse)
async def admin_draw(request: Request):
    return await LotteryService.admin_draw(request)


# ------------------------
# Generation
# ------------------------

@router.post("/generate-participants/{count}", response_class=ORJSONResponse)
async def generate_participants(count: int, request: Request):
    r = request.app.state.redis
    asyncio.create_task(LotteryService.generate_python_batch(r, count))
    return {"status": "started", "mode": "python", "count": count}


@router.post("/generate-lua/{count}", response_class=ORJSONResponse)
async def generate_lua(count: int, request: Request):
    r = request.app.state.redis
    asyncio.create_task(LotteryService.generate_lua_batch(r, count))
    return {"status": "started", "mode": "lua", "count": count}


# ------------------------
# Public: ticket flow
# ------------------------

@router.get("/get-random-complex-ticket", response_class=ORJSONResponse)
async def get_random_complex_ticket(request: Request):
    r = request.app.state.redis
    ticket = await r.srandmember("lottery:tickets")
    if not ticket:
        return {"status": "empty", "ticket_pairs": []}

    pairs = [ticket[i:i + 2] for i in range(0, len(ticket), 2)]
    return {"status": "ok", "ticket_pairs": pairs, "raw": ticket}


@router.get("/check/{ticket_id}", response_class=ORJSONResponse)
async def check_ticket(ticket_id: str, request: Request):
    """
    FIX:
      - pipeline -> 1 roundtrip to Redis (GET + SISMEMBER)
      - graceful handling of Redis disconnects -> return 503 instead of 500
    """
    r = request.app.state.redis

    try:
        pipe = r.pipeline(transaction=False)
        pipe.get("lottery:winning_number")
        pipe.sismember("lottery:tickets", ticket_id)
        winning, exists = await pipe.execute()

    except (RedisConnectionError, RedisTimeoutError) as e:
        # Redis under pressure / connection dropped
        raise HTTPException(status_code=503, detail=f"Redis unavailable: {type(e).__name__}")

    except Exception as e:
        # Unexpected
        raise HTTPException(status_code=500, detail=f"Unexpected error: {type(e).__name__}")

    if not winning:
        return {"status": "draw_not_ready"}

    return {
        "status": "ok",
        "exists": bool(exists),
        "is_winner": bool(exists) and (ticket_id == winning),
    }


# ------------------------
# Benchmark: engine mode (multi-check)
# ------------------------

@router.post("/run-multi-check/{count}", response_class=ORJSONResponse)
async def run_multi_check(count: int, request: Request):
    r = request.app.state.redis

    winning = await r.get("lottery:winning_number")
    if not winning:
        raise HTTPException(status_code=400, detail="Draw not ready. Call POST /admin/draw first.")

    if count <= 0:
        raise HTTPException(status_code=400, detail="count must be positive")

    start = time.perf_counter()
    res = await r.eval(LUA_MULTI_CHECK, 1, "lottery:tickets", count, winning)
    elapsed = time.perf_counter() - start

    if isinstance(res, (list, tuple)) and len(res) >= 2:
        winners = int(res[0])
        checked = int(res[1])
    else:
        winners = int(res)
        checked = int(count)

    rps = int(checked / elapsed) if elapsed > 0 else 0

    return {
        "checked_count": checked,
        "winners": winners,
        "execution_time_ms": round(elapsed * 1000, 2),
        "rps": rps,
    }


# ------------------------
# System stats
# ------------------------

@router.get("/system-stats", response_class=ORJSONResponse)
async def get_system_stats(request: Request):
    try:
        redis_info = await request.app.state.redis.info("memory")
        vm = psutil.virtual_memory()
        return {
            "redis_mem": redis_info.get("used_memory_human", "0B"),
            "sys_mem_bytes": vm.used,
            "sys_total_bytes": vm.total,
        }
    except Exception:
        return {"redis_mem": "Err", "sys_mem_bytes": 0, "sys_total_bytes": 0}


# ------------------------
# Locust stats (already normalized for frontend)
# ------------------------

def _pick(d: dict, keys: list[str], default=0):
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return default


def _pick_percentile(container: dict, p: str, default=0):
    rp = container.get("response_time_percentiles") or {}
    if isinstance(rp, dict):
        v = rp.get(p)
        if v is not None:
            return v
        try:
            v2 = rp.get(float(p))
            if v2 is not None:
                return v2
        except Exception:
            pass
    return default


@router.get("/locust-stats", response_class=ORJSONResponse)
async def get_locust_stats():
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://127.0.0.1:8089/stats/requests")
            data = resp.json()

        raw_stats = data.get("stats", []) or []

        # Берём Aggregated как главный источник
        agg = next((s for s in raw_stats if s.get("name") == "Aggregated"), None)

        def get_val(d, key):
            return float(d.get(key) or 0) if isinstance(d, dict) else 0.0

        # ---- TOP METRICS ----
        rps = float(data.get("total_rps") or data.get("current_rps") or 0)
        p95 = get_val(agg, "response_time_percentile_0.95")
        p99 = get_val(agg, "response_time_percentile_0.99")
        fail_ratio = float(data.get("fail_ratio") or 0)

        # ---- TABLE METRICS ----
        normalized = []

        for s in raw_stats:
            if s.get("name") == "Total":
                continue

            normalized.append({
                "name": s.get("name", ""),
                "method": s.get("method", ""),

                "num_requests": int(s.get("num_requests") or 0),
                "num_failures": int(s.get("num_failures") or 0),

                "median_response_time": get_val(s, "median_response_time"),
                "avg_response_time": get_val(s, "avg_response_time"),
                "min_response_time": get_val(s, "min_response_time"),
                "max_response_time": get_val(s, "max_response_time"),

                # 👇 вот ключевой фикс
                "ninetieth_response_time": get_val(s, "response_time_percentile_0.95"),
                "ninety_ninth_response_time": get_val(s, "response_time_percentile_0.99"),

                "current_rps": get_val(s, "current_rps"),
            })

        return {
            "rps": rps,
            "p95": p95,
            "p99": p99,
            "fail_ratio": fail_ratio,
            "full_stats": normalized,
        }

    except Exception as e:
        print(f"Locust fetch error: {e}")
        return {"rps": 0, "p95": 0, "p99": 0, "fail_ratio": 0, "full_stats": []}


# ------------------------
# Locust control
# ------------------------

@router.post("/locust/start", response_class=ORJSONResponse)
async def start_locust(payload: LocustStartRequest):
    success = await locust_manager.start_swarm(
        payload.user_count,
        payload.spawn_rate,
        payload.scenario or "realistic",
    )

    if not success:
        raise HTTPException(status_code=503, detail="Could not start Locust swarm")

    return {"status": f"started ({payload.scenario or 'realistic'})"}


@router.post("/locust/stop", response_class=ORJSONResponse)
async def stop_locust():
    await locust_manager.stop_swarm()
    return {"status": "swarming stopped"}


# ------------------------
# Cleanup
# ------------------------

@router.post("/clear-database", response_class=ORJSONResponse)
async def clear_db(request: Request):
    r = request.app.state.redis
    await LotteryService.clear_all_data(r)
    return {"status": "ok"}