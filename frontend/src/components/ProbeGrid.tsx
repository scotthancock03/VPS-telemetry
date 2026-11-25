import type { OverviewResponse } from "../types";

interface ProbeGridProps {
  probes: OverviewResponse["probes"] | undefined;
  selectedTarget: string;
  onSelectTarget: (targetName: string) => void;
}

export function ProbeGrid({
  probes,
  selectedTarget,
  onSelectTarget,
}: ProbeGridProps) {
  return (
    <section className="probe-grid">
      {(probes ?? []).map((p) => {
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
            onClick={() => onSelectTarget(p.target_name)}
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
  );
}