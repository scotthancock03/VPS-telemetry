import { useMemo } from "react";
import type { ProbeSample, RollupPoint } from "../types";

const RANGE_OPTIONS = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

interface LatencyChartProps {
  selectedTarget: string;
  rangeHours: number;
  onSelectRange: (hours: number) => void;
  seriesMode: "raw" | "rollup";
  series: Array<ProbeSample | RollupPoint>;
}

export function LatencyChart({
  selectedTarget,
  rangeHours,
  onSelectRange,
  seriesMode,
  series,
}: LatencyChartProps) {
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
              onClick={() => onSelectRange(opt.hours)}
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
  );
}