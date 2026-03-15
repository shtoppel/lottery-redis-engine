import asyncio
import os
import time
from datetime import datetime
import json
import psutil
import httpx
from starlette.responses import JSONResponse

from app.services.race_service import RaceService
from fastapi import Query

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from redis.exceptions import ConnectionError as RedisConnectionError, TimeoutError as RedisTimeoutError

from app.core.lua_templates import LUA_MULTI_CHECK, LUA_DRAW_SCRIPT
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
# Admin Draw
# ------------------------

@router.post("/admin/draw")
async def admin_draw(request: Request):
    r = request.app.state.redis

    tickets_count = await r.scard("lottery:tickets")
    if not tickets_count or tickets_count <= 0:
        return JSONResponse(
            status_code=400,
            content={"detail": "Ticket pool is empty. Generate participants first."}
        )

    winner = await r.eval(
        LUA_DRAW_SCRIPT,
        2,
        "lottery:winning_number",
        "lottery:tickets"
    )

    if not winner:
        return JSONResponse(
            status_code=400,
            content={"detail": "Unable to perform draw."}
        )

    return {"winner": winner}

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


async def get_locust_stats_internal():
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://locust:8089/stats/requests")
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


@router.get("/locust-stats", response_class=ORJSONResponse)
async def get_locust_stats():
    return await get_locust_stats_internal()


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

@router.post("/demo/run", response_class=ORJSONResponse)
async def run_demo(request: Request):
    r = request.app.state.redis

    total_tickets = 1_000_000

    # Ramp profile for demo
    steps = [
        {"users": 500, "spawn_rate": 200, "hold_s": 10},
        {"users": 1000, "spawn_rate": 300, "hold_s": 10},
        {"users": 1500, "spawn_rate": 400, "hold_s": 10},
        {"users": 2000, "spawn_rate": 500, "hold_s": 10},
    ]

    report = {
        "started_at": datetime.utcnow().isoformat() + "Z",
        "tickets": total_tickets,
        "steps": [],
    }

    try:
        # 1) clear
        await LotteryService.clear_all_data(r)

        # 2) generate lua
        t0 = time.perf_counter()
        await LotteryService.generate_lua_batch(r, total_tickets)
        report["generate_lua_sec"] = round(time.perf_counter() - t0, 3)

        # 3) draw
        winner = await r.eval(LUA_DRAW_SCRIPT, 2, "lottery:winning_number", "lottery:tickets")
        if not winner:
            return {
                "status": "error",
                "detail": "Draw failed after generation."
            }

        if isinstance(winner, (bytes, bytearray)):
            winner = winner.decode()

        report["winner"] = winner

        # 4) stop current locust swarm just in case
        await locust_manager.stop_swarm()
        await asyncio.sleep(1.0)

        # 5) ramp steps
        for step in steps:
            await locust_manager.start_swarm(step["users"], step["spawn_rate"])
            await asyncio.sleep(step["hold_s"])

            stats_snapshot = await get_locust_stats_internal()

            report["steps"].append({
                "users": step["users"],
                "spawn_rate": step["spawn_rate"],
                "hold_s": step["hold_s"],
                "stats": stats_snapshot,
            })

        # 6) stop at end
        await locust_manager.stop_swarm()

        report["finished_at"] = datetime.utcnow().isoformat() + "Z"

        # 7) save report
        os.makedirs("reports", exist_ok=True)
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        report_path = os.path.join("reports", f"demo_report_{ts}.json")

        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        return {
            "status": "ok",
            "report_path": report_path,
            "report": report,
        }

    except Exception as e:
        print(f"Demo run error: {e}")
        return {
            "status": "error",
            "detail": str(e),
            "report": report,
        }

@router.get("/demo/latest-report")
async def latest_demo_report():
    files = sorted(os.listdir("reports"), reverse=True)

    if not files:
        return {"status": "no reports"}

    path = os.path.join("reports", files[0])

    with open(path, "r") as f:
        report = json.load(f)

    summary = build_demo_summary(report)

    return {
        "report": report,
        "summary": summary
    }

# ------------------------
# Race Condition Test (Safe/Unsafe)
# ------------------------

@router.post("/race/reset", response_class=ORJSONResponse)
async def race_reset(request: Request):
    r = request.app.state.redis
    return await RaceService.reset(r)


@router.post("/race/claim-unsafe", response_class=ORJSONResponse)
async def race_claim_unsafe(
    request: Request,
    user_id: str = Query(...),
    delay_ms: int = Query(10),
):
    r = request.app.state.redis
    return await RaceService.claim_unsafe(r, user_id=user_id, delay_ms=delay_ms)


@router.post("/race/claim-safe", response_class=ORJSONResponse)
async def race_claim_safe(
    request: Request,
    user_id: str = Query(...),
):
    r = request.app.state.redis
    return await RaceService.claim_safe(r, user_id=user_id)


@router.post("/race/run", response_class=ORJSONResponse)
async def race_run(
    request: Request,
    mode: str = Query("unsafe"),
    concurrency: int = Query(200),
    delay_ms: int = Query(10),
):
    """
    Run real concurrent HTTP requests against race claim endpoints.
    Requires:
    - generated ticket pool
    - winner selected via draw
    """
    r = request.app.state.redis

    ready, detail = await RaceService.ensure_ready(r)
    if not ready:
        return ORJSONResponse(
            status_code=400,
            content={"status": "error", "detail": detail},
        )

    await RaceService.reset(r)

    if mode not in {"unsafe", "safe"}:
        return ORJSONResponse(
            status_code=400,
            content={"status": "error", "detail": "mode must be 'unsafe' or 'safe'"},
        )

    # keep race realistic but bounded
    concurrency = max(1, min(concurrency, 1000))
    delay_ms = max(0, min(delay_ms, 100))

    endpoint = "/race/claim-unsafe" if mode == "unsafe" else "/race/claim-safe"

    # Use current server base URL by default (works locally).
    # Can be overridden in Docker/CI with BACKEND_INTERNAL_URL.
    base_url = os.getenv("BACKEND_INTERNAL_URL", str(request.base_url).rstrip("/"))

    started = time.perf_counter()

    parsed_results = []
    race_events = []
    network_errors = 0
    batch_size = 100

    async with httpx.AsyncClient(timeout=10.0) as client:
        for start_idx in range(1, concurrency + 1, batch_size):
            end_idx = min(start_idx + batch_size, concurrency + 1)
            tasks = []

            for i in range(start_idx, end_idx):
                user_id = f"user_{i}"
                params = {"user_id": user_id}

                if mode == "unsafe":
                    params["delay_ms"] = delay_ms

                request_start = time.perf_counter()

                async def fire_request(uid=user_id, request_params=params, req_started=request_start):
                    try:
                        resp = await client.post(f"{base_url}{endpoint}", params=request_params)
                        payload = resp.json()
                        latency_ms = round((time.perf_counter() - req_started) * 1000, 2)

                        status = payload.get("status", "unknown")
                        if payload.get("claimed") is True:
                            status = "SUCCESS"

                        event = {
                            "user": uid,
                            "latency_ms": latency_ms,
                            "status": status,
                            "claimed": bool(payload.get("claimed") is True),
                        }
                        return payload, event
                    except Exception:
                        latency_ms = round((time.perf_counter() - req_started) * 1000, 2)
                        event = {
                            "user": uid,
                            "latency_ms": latency_ms,
                            "status": "network_error",
                            "claimed": False,
                        }
                        return None, event

                tasks.append(fire_request())

            responses = await asyncio.gather(*tasks)

            for payload, event in responses:
                race_events.append(event)
                if payload is None:
                    network_errors += 1
                    continue
                parsed_results.append(payload)

    duration_ms = round((time.perf_counter() - started) * 1000, 2)

    success_count = sum(1 for item in parsed_results if item.get("claimed") is True)
    winners = [item["user_id"] for item in parsed_results if item.get("claimed") is True]

    stored_success_count = int(await r.get(RaceService.SUCCESS_COUNT_KEY) or 0)
    final_claimed_by = await r.get(RaceService.CLAIMED_KEY)

    duplicate_bug = stored_success_count > 1

    race_events.sort(key=lambda x: x.get("latency_ms", 0))

    success_events = [e for e in race_events if e.get("claimed") is True]
    expected_winners = 1
    actual_winners = stored_success_count
    consistency = "OK" if actual_winners == expected_winners else "BROKEN"

    first_success_request = None
    race_window_ms = 0.0
    if success_events:
        first_success = min(success_events, key=lambda x: x.get("latency_ms", 0))
        first_success_request = first_success.get("user")
        min_success = min(e.get("latency_ms", 0) for e in success_events)
        max_success = max(e.get("latency_ms", 0) for e in success_events)
        race_window_ms = round(max_success - min_success, 2)

    race_events.sort(key=lambda x: x.get("latency_ms", 0))

    success_events = [e for e in race_events if e.get("claimed") is True]
    expected_winners = 1
    actual_winners = stored_success_count
    consistency = "OK" if actual_winners == expected_winners else "BROKEN"

    first_success_request = None
    race_window_ms = 0.0
    if success_events:
        first_success = min(success_events, key=lambda x: x.get("latency_ms", 0))
        first_success_request = first_success.get("user")
        min_success = min(e.get("latency_ms", 0) for e in success_events)
        max_success = max(e.get("latency_ms", 0) for e in success_events)
        race_window_ms = round(max_success - min_success, 2)

    return {
        "status": "ok",
        "mode": mode,
        "concurrency": concurrency,
        "delay_ms": delay_ms if mode == "unsafe" else 0,
        "duration_ms": duration_ms,
        "success_count": success_count,
        "stored_success_count": stored_success_count,
        "duplicate_bug": duplicate_bug,
        "expected_winners": expected_winners,
        "actual_winners": actual_winners,
        "consistency": consistency,
        "first_successful_request": first_success_request,
        "race_window_ms": race_window_ms,
        "final_claimed_by": final_claimed_by,
        "winners": winners,
        "network_errors": network_errors,
        "race_timeline": race_events,
    }

# ------------------------
# Build Demo Summary
# ------------------------

def build_demo_summary(report: dict) -> dict:
    steps = report.get("steps", [])

    if not steps:
        return {
            "steps_executed": 0,
            "peak_rps": 0,
            "worst_p95": 0,
            "stable_users": 0,
            "last_fail_rate": 0,
            "bottleneck": "unknown",
            "verdict": "no data",
        }

    peak_rps = 0.0
    worst_p95 = 0.0
    stable_users = 0
    collapse_point = None

    pull_p95_worst = 0.0
    check_p95_worst = 0.0

    for step in steps:
        users = step.get("users", 0)
        stats = step.get("stats", {}) or {}

        rps = stats.get("rps", 0) or 0
        p95 = stats.get("p95", 0) or 0
        fail_rate = stats.get("fail_ratio", 0) or 0

        peak_rps = max(peak_rps, rps)
        worst_p95 = max(worst_p95, p95)

        # Считаем шаг стабильным, если нет ошибок и p95 ещё в разумных пределах
        if fail_rate == 0 and p95 < 1000:
            stable_users = users

        # Если система начала реально сыпаться — фиксируем первую точку
        if collapse_point is None and (fail_rate > 0 or p95 >= 1000):
            collapse_point = users

        # Анализируем endpoint bottleneck
        for item in stats.get("full_stats", []):
            name = item.get("name", "")

            if name == "/get-random-complex-ticket":
                pull_p95_worst = max(
                    pull_p95_worst,
                    item.get("ninety_ninth_response_time", 0) or 0
                )

            elif name == "/check/:ticket_id":
                check_p95_worst = max(
                    check_p95_worst,
                    item.get("ninety_ninth_response_time", 0) or 0
                )

    last_stats = (steps[-1].get("stats", {}) or {})
    last_fail_rate = last_stats.get("fail_ratio", 0) or 0

    # Определяем bottleneck
    if pull_p95_worst > check_p95_worst:
        bottleneck = "ticket pull endpoint"
    elif check_p95_worst > pull_p95_worst:
        bottleneck = "ticket verification"
    else:
        bottleneck = "balanced load"

    # Verdict
    if last_fail_rate == 0 and worst_p95 < 300:
        verdict = "system stable under configured ramp"
    elif last_fail_rate == 0 and worst_p95 < 1000:
        verdict = "system stable, but latency degrades at upper ramp"
    elif last_fail_rate < 5:
        verdict = "degraded under high load"
    else:
        verdict = "system unstable at upper ramp levels"

    return {
        "steps_executed": len(steps),
        "peak_rps": round(peak_rps, 2),
        "worst_p95": round(worst_p95, 2),
        "stable_users": stable_users,
        "last_fail_rate": round(last_fail_rate, 2),
        "bottleneck": bottleneck,
        "collapse_point": collapse_point,
        "verdict": verdict,
    }
