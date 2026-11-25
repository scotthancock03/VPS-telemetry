import { useState } from "react";
import "./App.css";
import { LatencyChart } from "./components/LatencyChart";
import { ProbeGrid } from "./components/ProbeGrid";
import { TelemetryBottomPanels } from "./components/TelemetryBottomPanels";
import { useTelemetryStream } from "./hooks/useTelemetryStream";

export function App() {
  const [selectedTarget, setSelectedTarget] = useState<string>("Portfolio");
  const [rangeHours, setRangeHours] = useState<number>(24);

  const {
    overview,
    seriesMode,
    series,
    containers,
    incidents,
    sseConnected,
    error,
  } = useTelemetryStream(selectedTarget, rangeHours);

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

      <ProbeGrid
        probes={overview?.probes}
        selectedTarget={selectedTarget}
        onSelectTarget={setSelectedTarget}
      />

      <LatencyChart
        selectedTarget={selectedTarget}
        rangeHours={rangeHours}
        onSelectRange={setRangeHours}
        seriesMode={seriesMode}
        series={series}
      />

      <TelemetryBottomPanels
        liveContainers={overview?.containers}
        historicalContainers={containers}
        incidents={incidents}
      />
    </main>
  );
}

export default App;