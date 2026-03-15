import asyncio
import random
from typing import Any


class RaceService:
    CLAIMED_KEY = "race:claimed_by"
    SUCCESS_COUNT_KEY = "race:success_count"

    @staticmethod
    async def reset(redis) -> dict[str, Any]:
        await redis.delete(RaceService.CLAIMED_KEY, RaceService.SUCCESS_COUNT_KEY)
        return {"status": "ok"}

    @staticmethod
    async def ensure_ready(redis) -> tuple[bool, str | None]:
        tickets_count = await redis.scard("lottery:tickets")
        winner = await redis.get("lottery:winning_number")

        if not tickets_count or tickets_count <= 0:
            return False, "Generate ticket pool first."

        if not winner:
            return False, "Run official draw first."

        return True, None

    @staticmethod
    async def validate_claim_ticket(redis, ticket_id: str) -> tuple[bool, dict[str, Any] | None]:
        if not ticket_id:
            return False, {
                "status": "invalid_ticket",
                "claimed": False,
                "detail": "ticket_id is required",
            }

        exists = await redis.sismember("lottery:tickets", ticket_id)
        if not exists:
            return False, {
                "status": "invalid_ticket",
                "claimed": False,
                "ticket_id": ticket_id,
            }

        winning = await redis.get("lottery:winning_number")
        if ticket_id != winning:
            return False, {
                "status": "no_match",
                "claimed": False,
                "ticket_id": ticket_id,
            }

        return True, None

    @staticmethod
    async def claim_unsafe(redis, user_id: str, ticket_id: str, delay_ms: int = 10) -> dict[str, Any]:
        """
        Intentionally unsafe check-then-set flow.
        Designed to demonstrate race conditions in a more realistic way:
        not every concurrent request should necessarily win.
        """
        ready, detail = await RaceService.ensure_ready(redis)
        if not ready:
            return {"status": "error", "detail": detail, "claimed": False}

        valid, fail_payload = await RaceService.validate_claim_ticket(redis, ticket_id)
        if not valid:
            fail_payload["user_id"] = user_id
            return fail_payload

        claimed_by = await redis.get(RaceService.CLAIMED_KEY)
        if claimed_by:
            return {
                "status": "already_claimed",
                "claimed": False,
                "claimed_by": claimed_by,
                "user_id": user_id,
                "ticket_id": ticket_id,
            }

        # Widen race window on purpose, but add jitter so results look realistic.
        jitter_ms = random.randint(0, max(delay_ms, 1))
        await asyncio.sleep((delay_ms + jitter_ms) / 1000)

        # Second check reduces "everyone wins" effect while still remaining unsafe.
        claimed_by = await redis.get(RaceService.CLAIMED_KEY)
        if claimed_by:
            return {
                "status": "already_claimed",
                "claimed": False,
                "claimed_by": claimed_by,
                "user_id": user_id,
                "ticket_id": ticket_id,
            }

        await redis.set(RaceService.CLAIMED_KEY, user_id)
        await redis.incr(RaceService.SUCCESS_COUNT_KEY)

        return {
            "status": "claim_success",
            "claimed": True,
            "claimed_by": user_id,
            "user_id": user_id,
            "ticket_id": ticket_id,
        }

    @staticmethod
    async def claim_safe(redis, user_id: str, ticket_id: str) -> dict[str, Any]:
        """
        Safe atomic claim via Redis SET with NX flag.
        """
        ready, detail = await RaceService.ensure_ready(redis)
        if not ready:
            return {"status": "error", "detail": detail, "claimed": False}

        valid, fail_payload = await RaceService.validate_claim_ticket(redis, ticket_id)
        if not valid:
            fail_payload["user_id"] = user_id
            return fail_payload

        # Atomic: set only if key does not exist
        ok = await redis.set(RaceService.CLAIMED_KEY, user_id, nx=True)

        if ok:
            await redis.incr(RaceService.SUCCESS_COUNT_KEY)
            return {
                "status": "claim_success",
                "claimed": True,
                "claimed_by": user_id,
                "user_id": user_id,
                "ticket_id": ticket_id,
            }

        claimed_by = await redis.get(RaceService.CLAIMED_KEY)

        return {
            "status": "already_claimed",
            "claimed": False,
            "claimed_by": claimed_by,
            "user_id": user_id,
            "ticket_id": ticket_id,
        }