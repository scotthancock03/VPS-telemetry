import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  fetchContainers,
  fetchIncidents,
  fetchMetrics,
  fetchOverview,
} from "./api";
import type {
  ContainerSample,
  IncidentRecord,
  OverviewResponse,
  ProbeSample,
  RollupPoint,
} from "./types";

const RANGE_OPTIONS = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

function formatTransferSize(kb: number): string {
  if (!Number.isFinite(kb)) return "0 KB";
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(2)} MB`;
  }
  return `${kb.toFixed(2)} KB`;
}

export function App() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string>("Portfolio");
  const [rangeHours, setRangeHours] = useState<number>(24);
  const [seriesMode, setSeriesMode] = useState<"raw" | "rollup">("raw");
  const [series, setSeries] = useState<Array<ProbeSample | RollupPoint>>([]);
  const [containers, setContainers] = useState<ContainerSample[]>([]);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll(targetName: string, hours: number) {
    try {
      const [ov, met, cont, inc] = await Promise.all([
        fetchOverview(),
        fetchMetrics(targetName, hours),
        fetchContainers(hours),
        fetchIncidents(25),
      ]);
      setOverview(ov);
      setSeriesMode(met.mode);
      setSeries(met.series);
      setContainers(cont.containers);
      setIncidents(inc.incidents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load telemetry");
    }
  }

  useEffect(() => {
    void loadAll(selectedTarget, rangeHours);
  }, [selectedTarget, rangeHours]);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("connected", () => setSseConnected(true));
    es.addEventListener("tick", () => {
      void loadAll(selectedTarget, rangeHours);
    });
    es.onerror = () => setSseConnected(false);
    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [selectedTarget, rangeHours]);

  const chartPoints = useMemo(() => {
    return series
      .map((pt) => {
        const val =
          "avg_ms" in pt && pt.avg_ms !== null
            ? pt.avg_ms
            : "total_ms" in pt && pt.total_ms !== null
              ? pt.total_ms
              : 0;
        return { ts: pt.ts, ms: Number(val) };
      })
      .filter((p) => Number.isFinite(p.ms));
  }, [series]);

  const chartStats = useMemo(() => {
    if (!chartPoints.length) {
      return { minMs: 0, maxMs: 100, avgMs: 0 };
    }
    const values = chartPoints.map((p) => p.ms);
    const minMs = Math.min(...values);
    const maxMs = Math.max(50, ...values);
    const avgMs = values.reduce((sum, n) => sum + n, 0) / values.length;
    return { minMs, maxMs, avgMs };
  }, [chartPoints]);

  const chartGeometry = useMemo(() => {
    const width = 760;
    const height = 130;
    const padX = 12;
    const padTop = 18;
    const padBottom = 18;
    const span = Math.max(1, chartStats.maxMs - chartStats.minMs);

    const toY = (ms: number) =>
      height -
      padBottom -
      ((ms - chartStats.minMs) / span) * (height - padTop - padBottom);

    const polylinePoints =
      chartPoints.length >= 2
        ? chartPoints
            .map((p, idx) => {
              const x =
                padX + (idx / (chartPoints.length - 1)) * (width - padX * 2);
              const y = toY(p.ms);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ")
        : "";

    const avgY = toY(chartStats.avgMs).toFixed(1);

    return {
      width,
      height,
      padX,
      padTop,
      padBottom,
      polylinePoints,
      avgY,
    };
  }, [chartPoints, chartStats]);

  return (
    <main className="dashboard-shell">
      <header className="top-bar">
        <div>
          <h1 className="top-title">VPS Observability & Container Telemetry</h1>
          <p className="top-subtitle">
            60s interval • SQLite WAL ({overview?.storage?.probe_rows ?? 0} probes •{" "}
            {overview?.storage?.container_rows ?? 0} containers)
          </p>
        </div>
        <div className="stream-pill">
          Stream:{" "}
          <strong
            className={
              sseConnected
                ? "stream-status-live"
                : "stream-status-reconnecting"
            }
          >
            {sseConnected ? "Live" : "Reconnecting"}
          </strong>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="probe-grid">
        {(overview?.probes ?? []).map((p) => {
          const active = p.target_name === selectedTarget;
          const stateClass =
            p.ok === 1
              ? "probe-state probe-state-up"
              : p.ok === 0
                ? "probe-state probe-state-down"
                : "probe-state probe-state-pending";
          return (
            <button
              key={p.target_name}
              type="button"
              onClick={() => setSelectedTarget(p.target_name)}
              className={`probe-card${active ? " active" : ""}`}
            >
              <div className="probe-header">
                <span>{p.target_name}</span>
                <span className={stateClass}>
                  {p.ok === 1
                    ? `UP (${p.status_code})`
                    : p.ok === 0
                      ? "DOWN"
                      : "PENDING"}
                </span>
              </div>
              <div className="probe-url">{p.target_url}</div>
              <div className="probe-summary">
                Total: <strong>{p.total_ms ?? "—"} ms</strong> • TLS:{" "}
                <strong>{p.tls_days_remaining ?? "—"}d</strong>
              </div>
              <div className="probe-breakdown">
                DNS {p.dns_ms ?? "—"}ms · Conn {p.connect_ms ?? "—"}ms · TLS{" "}
                {p.tls_ms ?? "—"}ms · TTFB {p.ttfb_ms ?? "—"}ms
              </div>
            </button>
          );
        })}
      </section>

      <section className="panel-card">
        <div className="chart-toolbar">
          <div className="chart-title-group">
            <strong>{selectedTarget} Latency</strong>{" "}
            <span className="chart-meta">
              ({seriesMode} · {chartPoints.length} pts · max{" "}
              {Math.round(chartStats.maxMs)} ms)
            </span>
          </div>
          <div className="range-group">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setRangeHours(opt.hours)}
                className={`range-btn${rangeHours === opt.hours ? " active" : ""}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-wrap">
          {chartGeometry.polylinePoints ? (
            <svg
              viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
              preserveAspectRatio="none"
              className="chart-svg"
            >
              <line
                x1={chartGeometry.padX}
                y1={chartGeometry.avgY}
                x2={chartGeometry.width - chartGeometry.padX}
                y2={chartGeometry.avgY}
                className="chart-ref-line"
              />
              <text
                x={chartGeometry.padX}
                y={chartGeometry.padTop - 5}
                className="chart-ref-label"
              >
                max {Math.round(chartStats.maxMs)} ms · avg{" "}
                {Math.round(chartStats.avgMs)} ms
              </text>
              <text
                x={chartGeometry.padX}
                y={chartGeometry.height - 4}
                className="chart-ref-label"
              >
                min {Math.round(chartStats.minMs)} ms
              </text>
              <polyline
                className="chart-line"
                points={chartGeometry.polylinePoints}
              />
            </svg>
          ) : (
            <div className="chart-empty">
              Waiting for at least 2 samples to draw trend line...
            </div>
          )}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel-card">
          <h2 className="panel-heading">
            Docker Containers ({overview?.containers?.length ?? 0})
          </h2>
          {(overview?.containers?.length ?? 0) === 0 ? (
            <p className="panel-empty">
              No container samples yet ({containers.length} historical points).
            </p>
          ) : (
            <ul className="scroll-list">
              {overview!.containers.map((c) => (
                <li key={c.container_name} className="container-row">
                  <strong>{c.container_name}</strong>
                  <span className="row-detail">
                    CPU {c.cpu_percent}% · RAM {c.mem_used_mb}MB ({c.mem_percent}
                    %) · RX {formatTransferSize(c.net_rx_kb)} / TX{" "}
                    {formatTransferSize(c.net_tx_kb)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel-card">
          <h2 className="panel-heading">Incidents ({incidents.length})</h2>
          {incidents.length === 0 ? (
            <p className="panel-empty">No incidents recorded.</p>
          ) : (
            <ul className="scroll-list">
              {incidents.map((inc) => (
                <li key={inc.id} className="container-row">
                  <strong>
                    {inc.target_name} [{inc.status}]
                  </strong>
                  <span className="row-detail">
                    {inc.last_error ?? "Failure threshold reached"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;