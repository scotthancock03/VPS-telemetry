import asyncio
import json
import os
import socket
from typing import Any

from .config import settings


def _unix_get_json(socket_path: str, path: str, timeout: float = 4.0) -> Any:
    raw_lines: list[bytes] = []
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        sock.connect(socket_path)
        req = (
            f"GET {path} HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Connection: close\r\n\r\n"
        ).encode("utf-8")
        sock.sendall(req)
        chunks: list[bytes] = []
        while True:
            data = sock.recv(65536)
            if not data:
                break
            chunks.append(data)

    raw = b"".join(chunks)
    if b"\r\n\r\n" not in raw:
        return None
    _, body = raw.split(b"\r\n\r\n", 1)

    if b"Transfer-Encoding: chunked" in raw or b"transfer-encoding: chunked" in raw:
        decoded = bytearray()
        pos = 0
        while pos < len(body):
            line_end = body.find(b"\r\n", pos)
            if line_end == -1:
                break
            size_hex = body[pos:line_end].split(b";", 1)[0].strip()
            if not size_hex:
                pos = line_end + 2
                continue
            chunk_size = int(size_hex, 16)
            if chunk_size == 0:
                break
            start = line_end + 2
            decoded.extend(body[start : start + chunk_size])
            pos = start + chunk_size + 2
        payload = bytes(decoded).decode("utf-8", errors="ignore").strip()
    else:
        payload = body.decode("utf-8", errors="ignore").strip()

    if not payload:
        return None
    return json.loads(payload)


def _calc_cpu_percent(stats: dict[str, Any]) -> float:
    cpu_stats = stats.get("cpu_stats") or {}
    precpu_stats = stats.get("precpu_stats") or {}
    cpu_usage = cpu_stats.get("cpu_usage") or {}
    pre_usage = precpu_stats.get("cpu_usage") or {}

    total_delta = float(cpu_usage.get("total_usage", 0)) - float(pre_usage.get("total_usage", 0))
    system_delta = float(cpu_stats.get("system_cpu_usage", 0)) - float(
        precpu_stats.get("system_cpu_usage", 0)
    )
    online_cpus = (
        cpu_stats.get("online_cpus")
        or len(cpu_usage.get("percpu_usage") or [])
        or 1
    )

    if total_delta > 0.0 and system_delta > 0.0:
        pct = (total_delta / system_delta) * float(online_cpus) * 100.0
        return round(max(0.0, pct), 2)
    return 0.0


def _calc_memory_mb(stats: dict[str, Any]) -> tuple[float, float, float]:
    mem = stats.get("memory_stats") or {}
    usage = float(mem.get("usage", 0))
    limit = float(mem.get("limit", 0))
    cache = float((mem.get("stats") or {}).get("cache", 0))
    active_bytes = max(0.0, usage - cache) if usage >= cache else usage

    used_mb = round(active_bytes / (1024 * 1024), 2)
    limit_mb = round(limit / (1024 * 1024), 2) if limit > 0 else 0.0
    pct = round((active_bytes / limit) * 100.0, 2) if limit > 0 else 0.0
    return used_mb, limit_mb, pct


def _calc_network_kb(stats: dict[str, Any]) -> tuple[float, float]:
    networks = stats.get("networks") or {}
    rx_bytes = 0.0
    tx_bytes = 0.0
    for iface in networks.values():
        if isinstance(iface, dict):
            rx_bytes += float(iface.get("rx_bytes", 0))
            tx_bytes += float(iface.get("tx_bytes", 0))
    return round(rx_bytes / 1024.0, 2), round(tx_bytes / 1024.0, 2)


def _collect_docker_sync(ts: int) -> list[dict[str, Any]]:
    sock_path = settings.docker_socket_path
    if not os.path.exists(sock_path):
        return []

    containers = _unix_get_json(sock_path, "/containers/json?all=0")
    if not isinstance(containers, list):
        return []

    samples: list[dict[str, Any]] = []
    for c in containers:
        cid = str(c.get("Id", ""))[:12]
        names = c.get("Names") or []
        cname = names[0].lstrip("/") if names else cid
        state = str(c.get("State", "running"))
        try:
            stats = _unix_get_json(sock_path, f"/containers/{cid}/stats?stream=0")
            if not isinstance(stats, dict):
                continue
            cpu_pct = _calc_cpu_percent(stats)
            mem_used_mb, mem_limit_mb, mem_pct = _calc_memory_mb(stats)
            rx_kb, tx_kb = _calc_network_kb(stats)
            samples.append(
                {
                    "ts": ts,
                    "container_id": cid,
                    "container_name": cname,
                    "state": state,
                    "cpu_percent": cpu_pct,
                    "mem_used_mb": mem_used_mb,
                    "mem_limit_mb": mem_limit_mb,
                    "mem_percent": mem_pct,
                    "net_rx_kb": rx_kb,
                    "net_tx_kb": tx_kb,
                }
            )
        except Exception:
            continue

    return samples


async def run_docker_stats(ts: int) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_collect_docker_sync, ts)