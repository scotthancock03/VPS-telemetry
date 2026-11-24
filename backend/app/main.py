import asyncio
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db, insert_container_samples, insert_probe_samples, run_rollups
from .docker_stats import run_docker_stats
from .incidents import evaluate_incidents
from .probes import run_probes
from .routes import broadcast_event, router


async def _collector_loop(stop_event: asyncio.Event) -> None:
    last_rollup = 0
    while not stop_event.is_set():
        now = int(time.time())
        try:
            probe_samples = await run_probes(settings.targets, now)
            insert_probe_samples(probe_samples)
            incident_events = evaluate_incidents(probe_samples)

            container_samples = await run_docker_stats(now)
            insert_container_samples(container_samples)

            if now - last_rollup >= settings.rollup_interval_seconds:
                await asyncio.to_thread(run_rollups, 300, 6)
                last_rollup = now

            await broadcast_event(
                "tick",
                {
                    "ts": now,
                    "probes": probe_samples,
                    "containers": container_samples,
                    "incidents": incident_events,
                },
            )
        except Exception as exc:
            await broadcast_event("collector_error", {"ts": now, "error": str(exc)})

        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=float(settings.probe_interval_seconds)
            )
        except asyncio.TimeoutError:
            pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    stop_event = asyncio.Event()
    task = asyncio.create_task(_collector_loop(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await task


app = FastAPI(title="Hancock Telemetry Engine", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

dist_dir = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
)
if os.path.isdir(dist_dir):
    assets_dir = os.path.join(dist_dir, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = os.path.join(dist_dir, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(dist_dir, "index.html"))