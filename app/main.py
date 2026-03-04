import asyncio
import os
import redis.exceptions
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from redis.asyncio import Redis

from app.routers import lottery
from app.routers.lottery import locust_manager

# Windows event loop policy (safe to keep; on Linux it won't run)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


# --- LIFESPAN MANAGEMENT ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup/shutdown lifecycle for the app.
    - Creates Redis client from REDIS_URL (works locally + in Docker)
    - Optionally tries to stop locust swarm on startup (safe-fail)
    """

    # STARTUP
    # Tip: if you don't want any Locust calls on startup, just comment this block out.
    try:
        await locust_manager.stop_swarm()
    except Exception:
        # In Docker, Locust might not be ready yet — ignore on startup.
        pass

    # Redis URL from env (Docker) with local fallback
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    app.state.redis = Redis.from_url(
        REDIS_URL,
        decode_responses=True,
        max_connections=5000,        # for load testing, 200–500 is fine
        health_check_interval=30,
        socket_connect_timeout=5,
        socket_timeout=5,
    )
    print(f"[startup] REDIS_URL={REDIS_URL}")

    try:
        yield
    finally:
        # SHUTDOWN
        try:
            await app.state.redis.close()
        except Exception:
            pass


app = FastAPI(lifespan=lifespan)

# --- ROUTERS ---
app.include_router(lottery.router)


# --- FRONTEND DELIVERY ---
@app.get("/")
async def get_index():
    return FileResponse(os.path.join("static", "index.html"))


# --- REAL-TIME MONITORING (WEBSOCKET) ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            r = websocket.app.state.redis  # always current (set in lifespan)

            try:
                async with r.pipeline(transaction=False) as pipe:
                    pipe.get("stats:total_bets")
                    pipe.get("lottery:status")
                    pipe.get("stats:scan_progress")
                    total, status, scan_p = await pipe.execute()

                await websocket.send_json(
                    {
                        "total": int(total or 0),
                        "status": status or "idle",
                        "scan_progress": int(scan_p or 0),
                    }
                )

            except (redis.exceptions.ConnectionError, redis.exceptions.TimeoutError) as e:
                print("WS redis error:", e)
                await asyncio.sleep(0.5)

            await asyncio.sleep(0.2)

    except WebSocketDisconnect:
        print("WebSocket Client Disconnected")
    except Exception as e:
        print(f"WS Error: {e}")


# --- STATIC FILES ---
if os.path.exists("static/"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

# --- DEBUG ROUTE LIST (optional) ---
for r in app.routes:
    if hasattr(r, "methods"):
        print(f"{list(r.methods)}  {r.path}")