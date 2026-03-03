import asyncio
import random
import time
from app.core.lua_templates import LUA_GEN_SCRIPT, LUA_MULTI_CHECK, LUA_DRAW_SCRIPT
from fastapi import HTTPException, Request
from app.routers import lottery


class LotteryService:
    @staticmethod
    async def admin_draw(request: Request):
        r = request.app.state.redis

        winner = await r.eval(LUA_DRAW_SCRIPT, 2, "lottery:winning_number", "lottery:tickets")

        if not winner:
            raise HTTPException(status_code=400, detail="Ticket pool is empty. Generate tickets first.")

        # normalize bytes -> str
        if isinstance(winner, (bytes, bytearray)):
            winner = winner.decode()

        return {"status": "ok", "winner": winner}
    @staticmethod
    async def generate_lua_batch(r, total_count: int):
        await r.set("lottery:status", "generating")
        await r.delete("lottery:tickets", "lottery:result", "lottery:winning_number")
        await r.set("stats:total_bets", 0)

        batch_size = 50000
        remaining = total_count
        while remaining > 0:
            current_batch = min(batch_size, remaining)
            await r.eval(LUA_GEN_SCRIPT, 2, "lottery:tickets", "stats:total_bets", current_batch)
            remaining -= current_batch
            await asyncio.sleep(0.001)
        await r.set("lottery:status", "idle")

    @staticmethod
    async def generate_python_batch(r, total_count: int):
        await r.set("lottery:status", "generating")
        await r.delete("lottery:tickets", "lottery:result", "lottery:winning_number")
        await r.set("stats:total_bets", 0)

        pairs_pool = [f"{i:02d}" for i in range(100)]
        batch_size = 10000
        generated = 0
        while generated < total_count:
            current_batch = min(batch_size, total_count - generated)
            tickets = ["".join(random.choices(pairs_pool, k=8)) for _ in range(current_batch)]
            pipe = r.pipeline()
            pipe.sadd("lottery:tickets", *tickets)
            pipe.incrby("stats:total_bets", len(tickets))
            await pipe.execute()
            generated += current_batch
            await asyncio.sleep(0.001)
        await r.set("lottery:status", "idle")

    @staticmethod
    def format_ticket(raw_ticket):
        """Вспомогательный метод для декодирования и разбивки на пары"""
        if not raw_ticket: return None
        ticket_str = raw_ticket.decode() if isinstance(raw_ticket, bytes) else str(raw_ticket)
        return [ticket_str[i:i + 2] for i in range(0, len(ticket_str), 2)], ticket_str


    @staticmethod
    async def execute_multi_check(redis, set_key, count, winning_ticket):
        start_time = time.perf_counter()

        # Вызываем твой LUA_MULTI_CHECK
        # 1 - количество ключей (set_key), далее идут ARGV
        winners_count = await redis.eval(LUA_MULTI_CHECK, 1, set_key, count, winning_ticket)

        end_time = time.perf_counter()
        duration = end_time - start_time

        return {
            "winners": winners_count,
            "execution_time_ms": round(duration * 1000, 2),
            "rps": int(count / duration) if duration > 0 else 0
        }

    @staticmethod
    async def clear_all_data(r):
        """Очистка всех ключей лотереи"""
        keys = ["lottery:tickets", "stats:total_bets", "lottery:result",
                "lottery:winning_number", "stats:scan_progress"]
        await r.delete(*keys)
        await r.set("lottery:status", "idle")