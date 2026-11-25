import { useCallback, useEffect, useState } from "react";
import {
  fetchContainers,
  fetchIncidents,
  fetchMetrics,
  fetchOverview,
} from "../api";
import type {
  ContainerSample,
  IncidentRecord,
  OverviewResponse,
  ProbeSample,
  RollupPoint,
} from "../types";

export function useTelemetryStream(selectedTarget: string, rangeHours: number) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [seriesMode, setSeriesMode] = useState<"raw" | "rollup">("raw");
  const [series, setSeries] = useState<Array<ProbeSample | RollupPoint>>([]);
  const [containers, setContainers] = useState<ContainerSample[]>([]);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async (targetName: string, hours: number) => {
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
  }, []);

  useEffect(() => {
    void loadAll(selectedTarget, rangeHours);
  }, [loadAll, selectedTarget, rangeHours]);

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
  }, [loadAll, selectedTarget, rangeHours]);

  return {
    overview,
    seriesMode,
    series,
    containers,
    incidents,
    sseConnected,
    error,
  };
}