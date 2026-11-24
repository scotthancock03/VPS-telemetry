import os
from dataclasses import dataclass, field


def _parse_targets(raw: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if "=" in entry:
            name, url = entry.split("=", 1)
            items.append({"name": name.strip(), "url": url.strip()})
        else:
            items.append({"name": entry, "url": entry})
    return items


DEFAULT_TARGETS = (
    "Portfolio=https://hancockdev.com,"
    "Inventory=https://inventory.hancockdev.com,"
    "Cyber Titans=https://cybertitans.hancockdev.com"
)


@dataclass(frozen=True)
class Settings:
    db_path: str = os.getenv("TELEMETRY_DB_PATH", "./data/telemetry.db")
    probe_interval_seconds: int = int(os.getenv("PROBE_INTERVAL_SECONDS", "60"))
    docker_interval_seconds: int = int(os.getenv("DOCKER_INTERVAL_SECONDS", "60"))
    rollup_interval_seconds: int = int(os.getenv("ROLLUP_INTERVAL_SECONDS", "300"))
    incident_failure_threshold: int = int(os.getenv("INCIDENT_FAILURE_THRESHOLD", "2"))
    docker_socket_path: str = os.getenv("DOCKER_SOCKET_PATH", "/var/run/docker.sock")
    targets: list[dict[str, str]] = field(
        default_factory=lambda: _parse_targets(os.getenv("PROBE_TARGETS", DEFAULT_TARGETS))
    )


settings = Settings()