import math
import os
import sqlite3
import threading
import time
from typing import Any

from .config import settings

_write_lock = threading.Lock()


def get_connection() -> sqlite3.Connection:
    db_dir = os.path.dirname(os.path.abspath(settings.db_path))
    os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db() -> None:
    with _write_lock:
        conn = get_connection()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS probe_samples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts INTEGER NOT NULL,
                    target_name TEXT NOT NULL,
                    target_url TEXT NOT NULL,
                    ok INTEGER NOT NULL,
                    status_code INTEGER,
                    dns_ms REAL,
                    connect_ms REAL,
                    tls_ms REAL,
                    ttfb_ms REAL,
                    total_ms REAL,
                    tls_days_remaining INTEGER,
                    error TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_probe_target_ts
                    ON probe_samples (target_name, ts);
                CREATE INDEX IF NOT EXISTS idx_probe_ts
                    ON probe_samples (ts);

                CREATE TABLE IF NOT EXISTS probe_rollups (
                    bucket_ts INTEGER NOT NULL,
                    bucket_seconds INTEGER NOT NULL,
                    target_name TEXT NOT NULL,
                    sample_count INTEGER NOT NULL,
                    ok_count INTEGER NOT NULL,
                    min_ms REAL,
                    avg_ms REAL,
                    p95_ms REAL,
                    max_ms REAL,
                    PRIMARY KEY (bucket_seconds, target_name, bucket_ts)
                );

                CREATE TABLE IF NOT EXISTS container_samples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts INTEGER NOT NULL,
                    container_id TEXT NOT NULL,
                    container_name TEXT NOT NULL,
                    state TEXT NOT NULL,
                    cpu_percent REAL NOT NULL,
                    mem_used_mb REAL NOT NULL,
                    mem_limit_mb REAL NOT NULL,
                    mem_percent REAL NOT NULL,
                    net_rx_kb REAL NOT NULL,
                    net_tx_kb REAL NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_container_name_ts
                    ON container_samples (container_name, ts);
                CREATE INDEX IF NOT EXISTS idx_container_ts
                    ON container_samples (ts);

                CREATE TABLE IF NOT EXISTS incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    target_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at INTEGER NOT NULL,
                    resolved_at INTEGER,
                    failure_count INTEGER NOT NULL,
                    last_error TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_incidents_status
                    ON incidents (status, started_at DESC);
                """
            )
            conn.commit()
        finally:
            conn.close()


def insert_probe_samples(samples: list[dict[str, Any]]) -> None:
    if not samples:
        return
    with _write_lock:
        conn = get_connection()
        try:
            conn.executemany(
                """
                INSERT INTO probe_samples (
                    ts, target_name, target_url, ok, status_code,
                    dns_ms, connect_ms, tls_ms, ttfb_ms, total_ms,
                    tls_days_remaining, error
                ) VALUES (
                    :ts, :target_name, :target_url, :ok, :status_code,
                    :dns_ms, :connect_ms, :tls_ms, :ttfb_ms, :total_ms,
                    :tls_days_remaining, :error
                )
                """,
                samples,
            )
            conn.commit()
        finally:
            conn.close()


def insert_container_samples(samples: list[dict[str, Any]]) -> None:
    if not samples:
        return
    with _write_lock:
        conn = get_connection()
        try:
            conn.executemany(
                """
                INSERT INTO container_samples (
                    ts, container_id, container_name, state,
                    cpu_percent, mem_used_mb, mem_limit_mb, mem_percent,
                    net_rx_kb, net_tx_kb
                ) VALUES (
                    :ts, :container_id, :container_name, :state,
                    :cpu_percent, :mem_used_mb, :mem_limit_mb, :mem_percent,
                    :net_rx_kb, :net_tx_kb
                )
                """,
                samples,
            )
            conn.commit()
        finally:
            conn.close()


def _percentile(sorted_vals: list[float], pct: float) -> float | None:
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, max(0, math.ceil(pct * len(sorted_vals)) - 1))
    return round(sorted_vals[idx], 2)


def run_rollups(bucket_seconds: int = 300, lookback_hours: int = 6) -> None:
    """Aggregate completed time buckets into probe_rollups without deleting raw rows."""
    now = int(time.time())
    current_bucket = (now // bucket_seconds) * bucket_seconds
    start_ts = current_bucket - (lookback_hours * 3600)

    with _write_lock:
        conn = get_connection()
        try:
            rows = conn.execute(
                """
                SELECT ts, target_name, ok, total_ms
                FROM probe_samples
                WHERE ts >= ? AND ts < ?
                ORDER BY target_name, ts ASC
                """,
                (start_ts, current_bucket),
            ).fetchall()

            grouped: dict[tuple[str, int], list[sqlite3.Row]] = {}
            for r in rows:
                b_ts = (r["ts"] // bucket_seconds) * bucket_seconds
                grouped.setdefault((r["target_name"], b_ts), []).append(r)

            upserts = []
            for (target_name, b_ts), items in grouped.items():
                latencies = sorted(
                    float(i["total_ms"]) for i in items if i["total_ms"] is not None
                )
                ok_count = sum(1 for i in items if i["ok"])
                upserts.append(
                    {
                        "bucket_ts": b_ts,
                        "bucket_seconds": bucket_seconds,
                        "target_name": target_name,
                        "sample_count": len(items),
                        "ok_count": ok_count,
                        "min_ms": round(latencies[0], 2) if latencies else None,
                        "avg_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
                        "p95_ms": _percentile(latencies, 0.95),
                        "max_ms": round(latencies[-1], 2) if latencies else None,
                    }
                )

            if upserts:
                conn.executemany(
                    """
                    INSERT INTO probe_rollups (
                        bucket_ts, bucket_seconds, target_name,
                        sample_count, ok_count, min_ms, avg_ms, p95_ms, max_ms
                    ) VALUES (
                        :bucket_ts, :bucket_seconds, :target_name,
                        :sample_count, :ok_count, :min_ms, :avg_ms, :p95_ms, :max_ms
                    )
                    ON CONFLICT(bucket_seconds, target_name, bucket_ts) DO UPDATE SET
                        sample_count = excluded.sample_count,
                        ok_count = excluded.ok_count,
                        min_ms = excluded.min_ms,
                        avg_ms = excluded.avg_ms,
                        p95_ms = excluded.p95_ms,
                        max_ms = excluded.max_ms
                    """,
                    upserts,
                )
                conn.commit()
        finally:
            conn.close()