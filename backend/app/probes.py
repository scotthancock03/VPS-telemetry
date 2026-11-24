import asyncio
import socket
import ssl
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse


def _get_tls_days_remaining(host: str, port: int = 443, timeout: float = 6.0) -> tuple[float | None, int | None]:
    start = time.perf_counter()
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                tls_ms = round((time.perf_counter() - start) * 1000, 2)
                cert = ssock.getpeercert()
                not_after = cert.get("notAfter") if cert else None
                if not not_after:
                    return tls_ms, None
                expires_dt = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(
                    tzinfo=timezone.utc
                )
                days_left = int((expires_dt - datetime.now(timezone.utc)).total_seconds() // 86400)
                return tls_ms, days_left
    except Exception:
        return None, None


def _probe_single_sync(name: str, url: str, ts: int) -> dict[str, Any]:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    dns_ms: float | None = None
    connect_ms: float | None = None
    tls_ms: float | None = None
    tls_days: int | None = None
    ttfb_ms: float | None = None
    total_ms: float | None = None
    status_code: int | None = None
    ok = 0
    error: str | None = None

    t0 = time.perf_counter()
    try:
        t_dns = time.perf_counter()
        addr_info = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        dns_ms = round((time.perf_counter() - t_dns) * 1000, 2)
        if not addr_info:
            raise RuntimeError("DNS returned no addresses")

        ip_addr = addr_info[0][4][0]
        t_conn = time.perf_counter()
        with socket.create_connection((ip_addr, port), timeout=8.0) as sock:
            connect_ms = round((time.perf_counter() - t_conn) * 1000, 2)
            if parsed.scheme == "https":
                ctx = ssl.create_default_context()
                t_tls = time.perf_counter()
                with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                    tls_ms = round((time.perf_counter() - t_tls) * 1000, 2)
                    cert = ssock.getpeercert()
                    if cert and cert.get("notAfter"):
                        expires_dt = datetime.strptime(
                            cert["notAfter"], "%b %d %H:%M:%S %Y %Z"
                        ).replace(tzinfo=timezone.utc)
                        tls_days = int(
                            (expires_dt - datetime.now(timezone.utc)).total_seconds() // 86400
                        )
                    path = parsed.path or "/"
                    if parsed.query:
                        path = f"{path}?{parsed.query}"
                    req = (
                        f"GET {path} HTTP/1.1\r\n"
                        f"Host: {host}\r\n"
                        "User-Agent: HancockTelemetry/1.0\r\n"
                        "Connection: close\r\n\r\n"
                    ).encode("utf-8")
                    t_req = time.perf_counter()
                    ssock.sendall(req)
                    first_chunk = ssock.recv(4096)
                    ttfb_ms = round((time.perf_counter() - t_req) * 1000, 2)
                    while ssock.recv(65536):
                        pass
                    total_ms = round((time.perf_counter() - t0) * 1000, 2)
                    status_code = _parse_http_status(first_chunk)
            else:
                path = parsed.path or "/"
                if parsed.query:
                    path = f"{path}?{parsed.query}"
                req = (
                    f"GET {path} HTTP/1.1\r\n"
                    f"Host: {host}\r\n"
                    "User-Agent: HancockTelemetry/1.0\r\n"
                    "Connection: close\r\n\r\n"
                ).encode("utf-8")
                t_req = time.perf_counter()
                sock.sendall(req)
                first_chunk = sock.recv(4096)
                ttfb_ms = round((time.perf_counter() - t_req) * 1000, 2)
                while sock.recv(65536):
                    pass
                total_ms = round((time.perf_counter() - t0) * 1000, 2)
                status_code = _parse_http_status(first_chunk)

        if status_code is not None and 200 <= status_code < 400:
            ok = 1
        else:
            error = f"HTTP {status_code}" if status_code is not None else "Empty HTTP response"
    except Exception as exc:
        total_ms = round((time.perf_counter() - t0) * 1000, 2)
        error = str(exc)[:240]
        if parsed.scheme == "https" and tls_days is None and host:
            _, tls_days = _get_tls_days_remaining(host, port)

    return {
        "ts": ts,
        "target_name": name,
        "target_url": url,
        "ok": ok,
        "status_code": status_code,
        "dns_ms": dns_ms,
        "connect_ms": connect_ms,
        "tls_ms": tls_ms,
        "ttfb_ms": ttfb_ms,
        "total_ms": total_ms,
        "tls_days_remaining": tls_days,
        "error": error,
    }


def _parse_http_status(raw: bytes) -> int | None:
    if not raw:
        return None
    first_line = raw.split(b"\r\n", 1)[0].decode("latin-1", errors="ignore")
    parts = first_line.split(" ")
    if len(parts) >= 2 and parts[1].isdigit():
        return int(parts[1])
    return None


async def run_probes(targets: list[dict[str, str]], ts: int) -> list[dict[str, Any]]:
    tasks = [
        asyncio.to_thread(_probe_single_sync, t["name"], t["url"], ts)
        for t in targets
    ]
    return list(await asyncio.gather(*tasks))