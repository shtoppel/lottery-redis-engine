import asyncio
import json
import sys

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import os
from contextlib import asynccontextmanager
import redis.asyncio as redis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.routers import lottery



# --- LIFESPAN MANAGEMENT ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Redis connection
    # decode_responses=True is vital for direct string manipulation (status, results)
    app.state.redis = redis.from_url("redis://localhost", decode_responses=True)
    yield
    # Shutdown: Close Redis connection
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
    r = app.state.redis
    try:
        while True:
            # Use pipeline to batch status requests and minimize network latency
            async with r.pipeline(transaction=False) as pipe:
                pipe.get("stats:total_bets")
                pipe.get("lottery:status")
                pipe.get("stats:scan_progress")
                results = await pipe.execute()

            total = results[0] or 0
            status = results[1] or "idle"
            scan_p = results[2] or 0

            await websocket.send_json({
                "total": int(total),
                "status": status,
                "scan_progress": int(scan_p)
            })

            # Throttle to prevent CPU spikes and allow backend processing
            await asyncio.sleep(0.2)

    except WebSocketDisconnect:
        print("WebSocket Client Disconnected")
    except Exception as e:
        print(f"WS Error: {e}")


# --- STATIC FILES ---
# Mount static directory (CSS, JS, Images)
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")