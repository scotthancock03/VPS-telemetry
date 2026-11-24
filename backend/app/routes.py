import asyncio
import json
import sqlite3
import time
from typing import AsyncGenerator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from .config import settings
from .db import get_connection

router = APIRouter(prefix="/api")

_subscribers: list[asyncio.Queue[str]] = []


async def broadcast_event(event_type: str, payload: dict) -> None:
    message = f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
    stale: list[asyncio.Queue[str]] = []
    for queue in _subscribers:
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            stale.append(queue)
    for q in stale:
        if q in _subscribers:
            _subscribers.remove(q)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "ts": int(time.time())}


@router.get("/overview")
def overview() -> dict:
    conn = get_connection()
    try:
        latest_probes: list[dict] = []
        for t in settings.targets:
            row: sqlite3.Row | None = conn.execute(
                """
                SELECT * FROM probe_samples
                WHERE target_name = ?
                ORDER BY ts DESC, id DESC
                LIMIT 1
                """,
                (t["name"],),
            ).fetchone()
            if row:
                latest_probes.append(dict(row))
            else:
                latest_probes.append(
                    {
                        "target_name": t["name"],
                        "target_url": t["url"],
                        "ok": None,
                        "total_ms": None,
                        "tls_days_remaining": None,
                        "ts": None,
                    }
                )

        latest_containers = [
            dict(r)
            for r in conn.execute(
                """
                SELECT c.*
                FROM container_samples c
                INNER JOIN (
                    SELECT container_name, MAX(ts) AS max_ts
                    FROM container_samples
                    GROUP BY container_name
                ) latest
                ON c.container_name = latest.container_name AND c.ts = latest.max_ts
                ORDER BY c.container_name ASC
                """
            ).fetchall()
        ]

        open_incidents = [
            dict(r)
            for r in conn.execute(
                """
                SELECT * FROM incidents
                WHERE status = 'open'
                ORDER BY started_at DESC
                """
            ).fetchall()
        ]

        counts = conn.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM probe_samples) AS probe_rows,
                (SELECT COUNT(*) FROM container_samples) AS container_rows,
                (SELECT COUNT(*) FROM probe_rollups) AS rollup_rows
            """
        ).fetchone()

        return {
            "ts": int(time.time()),
            "probe_interval_seconds": settings.probe_interval_seconds,
            "probes": latest_probes,
            "containers": latest_containers,
            "open_incidents": open_incidents,
            "storage": dict(counts) if counts else {},
        }
    finally:
        conn.close()


@router.get("/metrics")
def metrics(
    target: str | None = Query(default=None),
    range_hours: int = Query(default=24, ge=1, le=8760),
) -> dict:
    since_ts = int(time.time()) - (range_hours * 3600)
    conn = get_connection()
    try:
        if range_hours <= 48:
            if target:
                rows = conn.execute(
                    """
                    SELECT ts, target_name, ok, status_code, dns_ms, connect_ms, tls_ms, ttfb_ms, total_ms, error
                    FROM probe_samples
                    WHERE ts >= ? AND target_name = ?
                    ORDER BY ts ASC
                    """,
                    (since_ts, target),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT ts, target_name, ok, status_code, dns_ms, connect_ms, tls_ms, ttfb_ms, total_ms, error
                    FROM probe_samples
                    WHERE ts >= ?
                    ORDER BY ts ASC
                    """,
                    (since_ts,),
                ).fetchall()
            return {"mode": "raw", "since_ts": since_ts, "series": [dict(r) for r in rows]}

        if target:
            rows = conn.execute(
                """
                SELECT bucket_ts AS ts, target_name, sample_count, ok_count, min_ms, avg_ms, p95_ms, max_ms
                FROM probe_rollups
                WHERE bucket_ts >= ? AND target_name = ?
                ORDER BY bucket_ts ASC
                """,
                (since_ts, target),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT bucket_ts AS ts, target_name, sample_count, ok_count, min_ms, avg_ms, p95_ms, max_ms
                FROM probe_rollups
                WHERE bucket_ts >= ?
                ORDER BY bucket_ts ASC
                """,
                (since_ts,),
            ).fetchall()
        return {"mode": "rollup", "since_ts": since_ts, "series": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/containers")
def container_history(
    name: str | None = Query(default=None),
    range_hours: int = Query(default=24, ge=1, le=8760),
) -> dict:
    since_ts = int(time.time()) - (range_hours * 3600)
    conn = get_connection()
    try:
        if name:
            rows = conn.execute(
                """
                SELECT ts, container_id, container_name, state, cpu_percent, mem_used_mb, mem_limit_mb, mem_percent, net_rx_kb, net_tx_kb
                FROM container_samples
                WHERE ts >= ? AND container_name = ?
                ORDER BY ts ASC
                """,
                (since_ts, name),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT ts, container_id, container_name, state, cpu_percent, mem_used_mb, mem_limit_mb, mem_percent, net_rx_kb, net_tx_kb
                FROM container_samples
                WHERE ts >= ?
                ORDER BY ts ASC
                """,
                (since_ts,),
            ).fetchall()
        return {"since_ts": since_ts, "containers": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/incidents")
def list_incidents(limit: int = Query(default=50, ge=1, le=500)) -> dict:
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT * FROM incidents
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return {"incidents": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/stream")
async def stream() -> StreamingResponse:
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=32)
    _subscribers.append(queue)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            yield f"event: connected\ndata: {json.dumps({'ts': int(time.time())})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            if queue in _subscribers:
                _subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )