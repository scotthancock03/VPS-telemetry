import type {
  ContainerSample,
  IncidentRecord,
  OverviewResponse,
  ProbeSample,
  RollupPoint,
} from "./types";

export async function fetchOverview(): Promise<OverviewResponse> {
  const res = await fetch("/api/overview");
  if (!res.ok) throw new Error(`Overview request failed: ${res.status}`);
  return res.json();
}

export async function fetchMetrics(
  target: string,
  rangeHours: number
): Promise<{ mode: "raw" | "rollup"; series: Array<ProbeSample | RollupPoint> }> {
  const params = new URLSearchParams({
    target,
    range_hours: String(rangeHours),
  });
  const res = await fetch(`/api/metrics?${params.toString()}`);
  if (!res.ok) throw new Error(`Metrics request failed: ${res.status}`);
  return res.json();
}

export async function fetchContainers(
  rangeHours: number
): Promise<{ containers: ContainerSample[] }> {
  const params = new URLSearchParams({ range_hours: String(rangeHours) });
  const res = await fetch(`/api/containers?${params.toString()}`);
  if (!res.ok) throw new Error(`Containers request failed: ${res.status}`);
  return res.json();
}

export async function fetchIncidents(limit = 25): Promise<{ incidents: IncidentRecord[] }> {
  const res = await fetch(`/api/incidents?limit=${limit}`);
  if (!res.ok) throw new Error(`Incidents request failed: ${res.status}`);
  return res.json();
}