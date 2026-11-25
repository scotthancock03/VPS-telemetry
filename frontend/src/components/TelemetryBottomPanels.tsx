import type { ContainerSample, IncidentRecord } from "../types";
import { formatTransferSize } from "../utils/format";

interface TelemetryBottomPanelsProps {
  liveContainers: ContainerSample[] | undefined;
  historicalContainers: ContainerSample[];
  incidents: IncidentRecord[];
}

export function TelemetryBottomPanels({
  liveContainers,
  historicalContainers,
  incidents,
}: TelemetryBottomPanelsProps) {
  const activeContainers = liveContainers ?? [];

  return (
    <section className="bottom-grid">
      <div className="panel-card">
        <h2 className="panel-heading">
          Docker Containers ({activeContainers.length})
        </h2>
        {activeContainers.length === 0 ? (
          <p className="panel-empty">
            No container samples yet ({historicalContainers.length} historical
            points).
          </p>
        ) : (
          <ul className="scroll-list">
            {activeContainers.map((c) => (
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
  );
}