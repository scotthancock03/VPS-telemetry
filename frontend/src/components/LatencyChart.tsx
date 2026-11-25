import { useMemo } from "react";
import type { ProbeSample, RollupPoint } from "../types";
import {
  buildTimeAxisTicks,
  getSmoothingWindow,
  smoothPoints,
  toPlottedPoints,
} from "../utils/format";

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
  const chartPoints = useMemo(() => toPlottedPoints(series), [series]);

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
    const height = 156;
    const padX = 12;
    const padTop = 18;
    const padBottom = 34;
    const plotBottom = height - padBottom;
    const span = Math.max(1, chartStats.maxMs - chartStats.minMs);

    const windowDurationMs = Math.max(1, rangeHours) * 60 * 60 * 1000;
    const latestPointMs =
      chartPoints.length > 0
        ? Math.max(...chartPoints.map((p) => p.tsMs))
        : Date.now();
    const endMs = Math.max(Date.now(), latestPointMs);
    const startMs = endMs - windowDurationMs;

    const toX = (tsMs: number) => {
      const ratio = (tsMs - startMs) / windowDurationMs;
      const clamped = Math.max(0, Math.min(1, ratio));
      return padX + clamped * (width - padX * 2);
    };

    const toY = (ms: number) =>
      plotBottom - ((ms - chartStats.minMs) / span) * (plotBottom - padTop);

    const visiblePoints = chartPoints.filter(
      (p) => p.tsMs >= startMs && p.tsMs <= endMs
    );
    const renderedPoints = smoothPoints(
      visiblePoints,
      getSmoothingWindow(rangeHours)
    );

    const polylinePoints =
      renderedPoints.length >= 2
        ? renderedPoints
            .map((p) => `${toX(p.tsMs).toFixed(1)},${toY(p.ms).toFixed(1)}`)
            .join(" ")
        : "";

    const avgY = toY(chartStats.avgMs).toFixed(1);
    const ticks = buildTimeAxisTicks(startMs, endMs, rangeHours, toX);

    return {
      width,
      height,
      padX,
      padTop,
      padBottom,
      plotBottom,
      polylinePoints,
      avgY,
      ticks,
    };
  }, [chartPoints, chartStats, rangeHours]);

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
              y={chartGeometry.plotBottom - 5}
              className="chart-ref-label"
            >
              min {Math.round(chartStats.minMs)} ms
            </text>
            <polyline
              className="chart-line"
              points={chartGeometry.polylinePoints}
            />

            <line
              x1={chartGeometry.padX}
              y1={chartGeometry.plotBottom}
              x2={chartGeometry.width - chartGeometry.padX}
              y2={chartGeometry.plotBottom}
              stroke="#334155"
              strokeWidth={1}
            />

            {chartGeometry.ticks.map((tick) => {
              const tickLen = tick.isMajor ? 8 : 4;
              const anchor =
                tick.x < chartGeometry.padX + 28
                  ? "start"
                  : tick.x > chartGeometry.width - chartGeometry.padX - 28
                    ? "end"
                    : "middle";
              return (
                <g key={tick.ms}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={chartGeometry.plotBottom}
                    y2={chartGeometry.plotBottom + tickLen}
                    stroke={tick.isMajor ? "#64748b" : "#334155"}
                    strokeWidth={tick.isMajor ? 1.25 : 1}
                  />
                  {tick.label && (
                    <text
                      x={tick.x}
                      y={chartGeometry.plotBottom + 20}
                      textAnchor={anchor}
                      className="chart-ref-label"
                    >
                      {tick.label}
                    </text>
                  )}
                </g>
              );
            })}
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