import asyncio
import json
import sys
import sys
from redis.asyncio import Redis

from app.routers.lottery import locust_manager

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.routers import lottery



# --- LIFESPAN MANAGEMENT ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    try:
        await locust_manager.stop_swarm()
    except Exception:
        pass

    app.state.redis = Redis.from_url(
        "redis://localhost:6379/0",
        decode_responses=True,
        max_connections=300,        # можно 200-500
        health_check_interval=30,
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    try:
        yield
    finally:
        # SHUTDOWN
        await app.state.redis.close()


app = FastAPI(lifespan=lifespan)

# --- ROUTERS ---
# Include lottery logic routes
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
            r = websocket.app.state.redis  # гарантированно актуально

            try:
                async with r.pipeline(transaction=False) as pipe:
                    pipe.get("stats:total_bets")
                    pipe.get("lottery:status")
                    pipe.get("stats:scan_progress")
                    total, status, scan_p = await pipe.execute()

                await websocket.send_json({
                    "total": int(total or 0),
                    "status": status or "idle",
                    "scan_progress": int(scan_p or 0),
                })

            except RedisConnectionError as e:
                # Redis отвалился / перезапустился
                await websocket.send_json({
                    "total": 0,
                    "status": "redis_down",
                    "scan_progress": 0,
                    "error": str(e),
                })
                await asyncio.sleep(0.5)

            await asyncio.sleep(0.2)

    except WebSocketDisconnect:
        print("WebSocket Client Disconnected")
    except Exception as e:
        print(f"WS Error: {e}")

# --- STATIC FILES ---
# Mount static directory (CSS, JS, Images)
if os.path.exists("static/"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

for r in app.routes:
    if hasattr(r, "methods"):
        print(f"{list(r.methods)}  {r.path}")
