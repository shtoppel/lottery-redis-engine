import asyncio
import random
import time
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import List
import re

router = APIRouter()

# --- LUA SCRIPTS ---
# Ticket Generator (Turbo Mode)
LUA_GEN_SCRIPT = """
local count = tonumber(ARGV[1])
for i = 1, count do
    local t = ""
    for j = 1, 8 do
        local n = math.random(0, 99)
        if n < 10 then t = t .. "0" .. n else t = t .. n end
    end
    redis.call("SADD", KEYS[1], t)
end
redis.call("INCRBY", KEYS[2], count)
return count
"""

# Search ticket in Set (O(1) complexity)
LUA_SEARCH_SCRIPT = """
local set_key = KEYS[1]
local target_ticket = ARGV[1]
if redis.call("SISMEMBER", set_key, target_ticket) == 1 then
    return {1, target_ticket}
else
    return {0, ""}
end
"""


class LotteryConfig(BaseModel):
    participants: int
    user_ticket: List[str]


# --- GENERATION #1: LUA (TURBO) ---
@router.post("/generate-lua/{count}")
async def generate_lua(count: int, request: Request):
    r = request.app.state.redis

    async def task():
        await r.set("lottery:status", "generating")
        await r.delete("lottery:tickets")
        await r.delete("lottery:result")
        await r.delete("lottery:winning_number")
        await r.set("stats:total_bets", 0)

        batch_size = 50000
        remaining = count
        while remaining > 0:
            current_batch = min(batch_size, remaining)
            await r.eval(LUA_GEN_SCRIPT, 2, "lottery:tickets", "stats:total_bets", current_batch)
            remaining -= current_batch
            await asyncio.sleep(0.001)
        await r.set("lottery:status", "idle")

    asyncio.create_task(task())
    return {"status": "Lua generation started"}


# --- GENERATION #2: PYTHON (OPTIMIZED) ---
@router.post("/generate-participants/{count}")
async def generate_participants(count: int, request: Request):
    r = request.app.state.redis

    async def task():
        await r.set("lottery:status", "generating")
        await r.delete("lottery:tickets")
        await r.delete("lottery:result")
        await r.delete("lottery:winning_number")
        await r.set("stats:total_bets", 0)

        pairs_pool = [f"{i:02d}" for i in range(100)]
        batch_size = 10000
        generated = 0
        while generated < count:
            current_batch = min(batch_size, count - generated)
            tickets = ["".join(random.choices(pairs_pool, k=8)) for _ in range(current_batch)]
            pipe = r.pipeline()
            pipe.sadd("lottery:tickets", *tickets)
            pipe.incrby("stats:total_bets", len(tickets))
            await pipe.execute()
            generated += current_batch
            await asyncio.sleep(0.001)
        await r.set("lottery:status", "idle")

    asyncio.create_task(task())
    return {"message": "Python pair-generation started"}


# --- RETRIEVE TICKET FROM POOL ---
@router.get("/get-random-complex-ticket")
async def get_ticket(request: Request):
    r = request.app.state.redis
    # Get a random element from the Set
    raw_ticket = await r.srandmember("lottery:tickets")

    if not raw_ticket:
        raise HTTPException(status_code=400, detail="DATABASE EMPTY! Generate tickets first.")

    # Cast to string
    ticket_str = raw_ticket.decode() if isinstance(raw_ticket, bytes) else str(raw_ticket)

    # Debug log for server console
    print(f"--- POOL CHECK ---")
    print(f"Pulled from Redis: |{ticket_str}|")

    pairs = [ticket_str[i:i + 2] for i in range(0, len(ticket_str), 2)]
    return {"ticket_pairs": pairs, "raw": ticket_str}


# --- TICKET VALIDATION (HIGH-LOAD SCAN) ---
@router.post("/run-full-lottery")
async def run_full_lottery(data: dict, request: Request):
    r = request.app.state.redis
    # Ticket currently held by the client
    user_ticket = "".join(data.get('user_ticket', []))

    async def lottery_task():
        await r.set("lottery:status", "scanning")
        start_time = time.perf_counter()

        # --- STEP 1: SELECT WINNER FROM POOL ---
        # Crucial: we pick a ticket from the existing participants Set.
        # If the Set contains 1 ticket, SRANDMEMBER will return exactly that one.
        raw_winning_ticket = await r.srandmember("lottery:tickets")

        if raw_winning_ticket:
            winning_ticket = raw_winning_ticket.decode() if isinstance(raw_winning_ticket, bytes) else str(
                raw_winning_ticket)
        else:
            winning_ticket = "0000000000000000"

        await r.set("lottery:winning_number", winning_ticket)

        # --- STEP 2: COMPARISON ---
        is_winner = (user_ticket == winning_ticket)

        end_time = time.perf_counter()
        search_ms = (end_time - start_time) * 1000

        # Debug logs for PyCharm console
        print(f"\n[DEBUG LOTTERY]")
        print(f"USER  TICKET: {user_ticket}")
        print(f"WIN   TICKET: {winning_ticket}")
        print(f"MATCH: {is_winner}")

        await r.set("stats:last_search_time", f"{search_ms:.4f}")
        await r.set("lottery:result", "winner" if is_winner else "loser")

        # Visual progress feedback
        await r.set("stats:scan_progress", 100)
        await r.set("lottery:status", "finished")

    asyncio.create_task(lottery_task())
    return {"status": "started"}


@router.get("/check-result")
async def check_result(request: Request):
    r = request.app.state.redis
    res = await r.get("lottery:result")
    raw_winning_no = await r.get("lottery:winning_number")

    winning_no = raw_winning_no.decode() if isinstance(raw_winning_no, bytes) else (
                raw_winning_no or "0000000000000000")
    status = res.decode() if isinstance(res, bytes) else str(res)

    # Split jackpot into pairs for UI rendering
    w_pairs = [winning_no[i:i + 2] for i in range(0, len(winning_no), 2)]

    return {
        "winner": status == "winner",
        "winning_ticket": w_pairs,
        "search_time": await r.get("stats:last_search_time") or "0"
    }


# --- CLEANUP ---
@router.post("/clear-database")
async def clear_db(request: Request):
    r = request.app.state.redis
    keys_to_delete = ["lottery:tickets", "stats:total_bets", "lottery:result", "lottery:winning_number",
                      "stats:scan_progress"]
    await r.delete(*keys_to_delete)
    await r.set("lottery:status", "idle")
    return {"status": "Database cleared"}