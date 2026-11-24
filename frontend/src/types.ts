export interface ProbeSample {
  id?: number;
  ts: number;
  target_name: string;
  target_url: string;
  ok: number;
  status_code: number | null;
  dns_ms: number | null;
  connect_ms: number | null;
  tls_ms: number | null;
  ttfb_ms: number | null;
  total_ms: number | null;
  tls_days_remaining: number | null;
  error: string | null;
}

export interface RollupPoint {
  ts: number;
  target_name: string;
  sample_count: number;
  ok_count: number;
  min_ms: number | null;
  avg_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

export interface ContainerSample {
  id?: number;
  ts: number;
  container_id: string;
  container_name: string;
  state: string;
  cpu_percent: number;
  mem_used_mb: number;
  mem_limit_mb: number;
  mem_percent: number;
  net_rx_kb: number;
  net_tx_kb: number;
}

export interface IncidentRecord {
  id: number;
  target_name: string;
  status: "open" | "resolved";
  started_at: number;
  resolved_at: number | null;
  failure_count: number;
  last_error: string | null;
}

export interface OverviewResponse {
  ts: number;
  probe_interval_seconds: number;
  probes: ProbeSample[];
  containers: ContainerSample[];
  open_incidents: IncidentRecord[];
  storage: {
    probe_rows?: number;
    container_rows?: number;
    rollup_rows?: number;
  };
}