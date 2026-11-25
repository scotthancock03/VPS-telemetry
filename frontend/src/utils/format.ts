import type { ProbeSample, RollupPoint } from "../types";

export interface AxisTick {
  ms: number;
  x: number;
  isMajor: boolean;
  label?: string;
}

export interface PlottedPoint {
  ts: number;
  tsMs: number;
  ms: number;
}

export function formatTransferSize(kb: number): string {
  if (!Number.isFinite(kb)) return "0 KB";
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(2)} MB`;
  }
  return `${kb.toFixed(2)} KB`;
}

export function normalizeTsMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

export function toPlottedPoints(
  series: Array<ProbeSample | RollupPoint>
): PlottedPoint[] {
  return series
    .map((pt) => {
      const val =
        "avg_ms" in pt && pt.avg_ms !== null
          ? pt.avg_ms
          : "total_ms" in pt && pt.total_ms !== null
            ? pt.total_ms
            : 0;
      return {
        ts: pt.ts,
        tsMs: normalizeTsMs(pt.ts),
        ms: Number(val),
      };
    })
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.tsMs));
}

export function getSmoothingWindow(rangeHours: number): number {
  if (rangeHours <= 1) return 1;
  if (rangeHours <= 24) return 5;
  if (rangeHours <= 168) return 12;
  return 24;
}

export function smoothPoints(
  points: PlottedPoint[],
  windowSize: number
): PlottedPoint[] {
  if (windowSize <= 1 || points.length <= 2) return points;
  const half = Math.floor(windowSize / 2);

  return points.map((pt, idx) => {
    const start = Math.max(0, idx - half);
    const end = Math.min(points.length, idx + half + 1);
    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += points[i].ms;
    }
    return {
      ...pt,
      ms: sum / (end - start),
    };
  });
}

function getScaleConfig(rangeHours: number) {
  if (rangeHours <= 1) {
    return {
      minorStepMs: 60 * 1000,
      majorStepMs: 5 * 60 * 1000,
      labelEveryMajor: 2,
      formatLabel: (d: Date) =>
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    };
  }
  if (rangeHours <= 24) {
    return {
      minorStepMs: 60 * 60 * 1000,
      majorStepMs: 4 * 60 * 60 * 1000,
      labelEveryMajor: 1,
      formatLabel: (d: Date) =>
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    };
  }
  if (rangeHours <= 168) {
    return {
      minorStepMs: 6 * 60 * 60 * 1000,
      majorStepMs: 24 * 60 * 60 * 1000,
      labelEveryMajor: 1,
      formatLabel: (d: Date) =>
        d.toLocaleDateString([], { month: "short", day: "numeric" }),
    };
  }
  return {
    minorStepMs: 24 * 60 * 60 * 1000,
    majorStepMs: 5 * 24 * 60 * 60 * 1000,
    labelEveryMajor: 1,
    formatLabel: (d: Date) =>
      d.toLocaleDateString([], { month: "short", day: "numeric" }),
  };
}

export function buildTimeAxisTicks(
  startMs: number,
  endMs: number,
  rangeHours: number,
  toX: (tsMs: number) => number
): AxisTick[] {
  const scale = getScaleConfig(rangeHours);
  const dayAnchor = new Date(startMs);
  dayAnchor.setHours(0, 0, 0, 0);
  const anchorMs = dayAnchor.getTime();

  const firstTickMs =
    anchorMs +
    Math.ceil((startMs - anchorMs) / scale.minorStepMs) * scale.minorStepMs;

  const ticks: AxisTick[] = [];
  let majorIndex = 0;

  for (let t = firstTickMs; t <= endMs; t += scale.minorStepMs) {
    const isMajor = (t - anchorMs) % scale.majorStepMs === 0;
    let label: string | undefined;
    if (isMajor) {
      if (majorIndex % scale.labelEveryMajor === 0) {
        label = scale.formatLabel(new Date(t));
      }
      majorIndex++;
    }
    ticks.push({
      ms: t,
      x: toX(t),
      isMajor,
      label,
    });
  }

  return ticks;
}