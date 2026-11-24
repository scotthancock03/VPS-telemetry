import sqlite3
from typing import Any

from .config import settings
from .db import _write_lock, get_connection


def evaluate_incidents(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Update open/resolved incidents based on consecutive failure counts."""
    threshold = max(1, settings.incident_failure_threshold)
    events: list[dict[str, Any]] = []

    with _write_lock:
        conn = get_connection()
        try:
            for s in samples:
                target = s["target_name"]
                ok = bool(s["ok"])
                ts = int(s["ts"])
                err = s.get("error")

                open_row: sqlite3.Row | None = conn.execute(
                    """
                    SELECT id, started_at, failure_count, last_error
                    FROM incidents
                    WHERE target_name = ? AND status = 'open'
                    ORDER BY id DESC LIMIT 1
                    """,
                    (target,),
                ).fetchone()

                if ok:
                    if open_row is not None:
                        conn.execute(
                            """
                            UPDATE incidents
                            SET status = 'resolved', resolved_at = ?
                            WHERE id = ?
                            """,
                            (ts, open_row["id"]),
                        )
                        events.append(
                            {
                                "type": "resolved",
                                "target_name": target,
                                "incident_id": open_row["id"],
                                "resolved_at": ts,
                            }
                        )
                else:
                    recent = conn.execute(
                        """
                        SELECT ok FROM probe_samples
                        WHERE target_name = ?
                        ORDER BY ts DESC, id DESC
                        LIMIT ?
                        """,
                        (target, threshold),
                    ).fetchall()
                    consecutive_fails = 0
                    for r in recent:
                        if r["ok"] == 0:
                            consecutive_fails += 1
                        else:
                            break

                    if open_row is None and consecutive_fails >= threshold:
                        cur = conn.execute(
                            """
                            INSERT INTO incidents (
                                target_name, status, started_at, resolved_at, failure_count, last_error
                            ) VALUES (?, 'open', ?, NULL, ?, ?)
                            """,
                            (target, ts, consecutive_fails, err),
                        )
                        events.append(
                            {
                                "type": "opened",
                                "target_name": target,
                                "incident_id": cur.lastrowid,
                                "started_at": ts,
                                "failure_count": consecutive_fails,
                                "error": err,
                            }
                        )
                    elif open_row is not None:
                        new_count = int(open_row["failure_count"]) + 1
                        conn.execute(
                            """
                            UPDATE incidents
                            SET failure_count = ?, last_error = COALESCE(?, last_error)
                            WHERE id = ?
                            """,
                            (new_count, err, open_row["id"]),
                        )

            conn.commit()
        finally:
            conn.close()

    return events