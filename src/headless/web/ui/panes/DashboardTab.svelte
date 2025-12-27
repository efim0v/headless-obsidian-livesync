<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import uPlot from "uplot";

  function apiOrigin(): string {
    const { protocol, hostname, port } = window.location;
    const host = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${host}`;
  }

  type MetricsSnapshot = {
    ts: number;
    headlessMode?: string;
    headlessLastError?: string;
    requestCount: number;
    responseCount: number;
    totalQueued: number;
    batched: number;
    processing: number;
    databaseQueueCount: number;
    storageApplyingCount: number;
    replicationResultCount: number;
    conflictProcessQueueCount: number;
    pendingFileEventCount: number;
    processingFileEventCount: number;
    replicationStat: {
      sent: number;
      arrived: number;
      maxPullSeq: number;
      maxPushSeq: number;
      lastSyncPullSeq: number;
      lastSyncPushSeq: number;
      syncStatus: string;
    };
  };

  let snapshot = $state<MetricsSnapshot | null>(null);
  let outstanding = $state(0);
  let timer: any = null;

  const pollIntervalMs = 2000;
  const historyMs = 60 * 60 * 1000;
  const maxPoints = Math.ceil(historyMs / pollIntervalMs);

  // time series
  const t: number[] = [];
  const sentD: number[] = [];
  const arrivedD: number[] = [];
  const totalQueued: number[] = [];
  const processing: number[] = [];
  const batched: number[] = [];
  const dbQ: number[] = [];
  const storageQ: number[] = [];
  const conflictQ: number[] = [];
  const fileEventsQ: number[] = [];

  let prevSent = 0;
  let prevArrived = 0;

  let plotThroughput: uPlot | null = null;
  let plotQueue: uPlot | null = null;
  let plotPipeline: uPlot | null = null;
  let plotConflicts: uPlot | null = null;

  let elThroughput: HTMLDivElement;
  let elQueue: HTMLDivElement;
  let elPipeline: HTMLDivElement;
  let elConflicts: HTMLDivElement;

  function clampSeries() {
    const extra = t.length - maxPoints;
    if (extra <= 0) return;
    t.splice(0, extra);
    sentD.splice(0, extra);
    arrivedD.splice(0, extra);
    totalQueued.splice(0, extra);
    processing.splice(0, extra);
    batched.splice(0, extra);
    dbQ.splice(0, extra);
    storageQ.splice(0, extra);
    conflictQ.splice(0, extra);
    fileEventsQ.splice(0, extra);
  }

  function setPlots() {
    const x = t;
    plotThroughput?.setData([x, sentD, arrivedD] as any);
    plotQueue?.setData([x, totalQueued, processing, batched] as any);
    plotPipeline?.setData([x, dbQ, storageQ] as any);
    plotConflicts?.setData([x, conflictQ, fileEventsQ] as any);
  }

  function createPlot(
    el: HTMLDivElement,
    title: string,
    series: { label: string }[]
  ): uPlot {
    const opts: uPlot.Options = {
      title,
      width: el.clientWidth || 900,
      height: 240,
      legend: { show: true },
      scales: { x: { time: true } },
      axes: [
        {
          space: 50,
          values: (u, vals) => vals.map((v) => new Date(v * 1000).toLocaleTimeString()),
        },
        { space: 50 },
      ],
      series: [
        { label: "time" },
        ...series.map((s) => ({ label: s.label })),
      ],
    };
    return new uPlot(opts, [[], ...series.map(() => [])] as any, el);
  }

  async function poll() {
    const r = await fetch(`${apiOrigin()}/api/metrics`);
    const data = await r.json();
    snapshot = (data?.snapshot ?? null) as MetricsSnapshot | null;
    outstanding = data?.derived?.outstandingRequests ?? 0;
    if (!snapshot) return;

    const nowS = snapshot.ts / 1000;
    const s = snapshot.replicationStat?.sent ?? 0;
    const a = snapshot.replicationStat?.arrived ?? 0;

    t.push(nowS);
    sentD.push(Math.max(0, s - prevSent));
    arrivedD.push(Math.max(0, a - prevArrived));
    totalQueued.push(snapshot.totalQueued ?? 0);
    processing.push(snapshot.processing ?? 0);
    batched.push(snapshot.batched ?? 0);
    dbQ.push(snapshot.databaseQueueCount ?? 0);
    storageQ.push(snapshot.storageApplyingCount ?? 0);
    conflictQ.push(snapshot.conflictProcessQueueCount ?? 0);
    fileEventsQ.push(snapshot.pendingFileEventCount ?? 0);

    prevSent = s;
    prevArrived = a;

    clampSeries();
    setPlots();
  }

  onMount(() => {
    // Create plots after DOM is ready.
    plotThroughput = createPlot(elThroughput, "Replication throughput (per tick)", [
      { label: "sentΔ" },
      { label: "arrivedΔ" },
    ]);
    plotQueue = createPlot(elQueue, "Queue pressure", [
      { label: "totalQueued" },
      { label: "processing" },
      { label: "batched" },
    ]);
    plotPipeline = createPlot(elPipeline, "DB/Storage pipeline", [
      { label: "databaseQueueCount" },
      { label: "storageApplyingCount" },
    ]);
    plotConflicts = createPlot(elConflicts, "Conflicts & file events", [
      { label: "conflictProcessQueueCount" },
      { label: "pendingFileEventCount" },
    ]);

    const onResize = () => {
      // Resize plots to container width
      const resize = (p: uPlot | null, el: HTMLDivElement) => {
        if (!p) return;
        const w = el.clientWidth || 900;
        p.setSize({ width: w, height: p.height });
      };
      resize(plotThroughput, elThroughput);
      resize(plotQueue, elQueue);
      resize(plotPipeline, elPipeline);
      resize(plotConflicts, elConflicts);
    };
    window.addEventListener("resize", onResize);

    void poll();
    timer = setInterval(() => void poll(), pollIntervalMs);
    return () => window.removeEventListener("resize", onResize);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    plotThroughput?.destroy();
    plotQueue?.destroy();
    plotPipeline?.destroy();
    plotConflicts?.destroy();
  });
</script>

<div class="headless-dashboard">
  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Daemon mode</div>
      <div class="kpi-value">{snapshot?.headlessMode ?? "-"}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Sync status</div>
      <div class="kpi-value">{snapshot?.replicationStat?.syncStatus ?? "-"}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Outstanding requests</div>
      <div class="kpi-value">{outstanding}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Queued</div>
      <div class="kpi-value">{snapshot?.totalQueued ?? 0}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Processing</div>
      <div class="kpi-value">{snapshot?.processing ?? 0}</div>
    </div>
    <div class="kpi kpi-wide">
      <div class="kpi-label">Last error</div>
      <div class="kpi-value kpi-value-small">{snapshot?.headlessLastError || "-"}</div>
    </div>
  </div>

  <div class="charts">
    <div class="chart-card"><div bind:this={elThroughput} class="chart"></div></div>
    <div class="chart-card"><div bind:this={elQueue} class="chart"></div></div>
    <div class="chart-card"><div bind:this={elPipeline} class="chart"></div></div>
    <div class="chart-card"><div bind:this={elConflicts} class="chart"></div></div>
  </div>
</div>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
    margin-top: 10px;
  }
  .kpi {
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: var(--background-secondary);
    padding: 12px;
  }
  .kpi-wide {
    grid-column: span 2;
  }
  .kpi-label {
    color: var(--text-muted);
    font-size: 12px;
    margin-bottom: 6px;
  }
  .kpi-value {
    font-size: 18px;
    font-weight: 650;
  }
  .kpi-value-small {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
    word-break: break-word;
  }

  .charts {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .chart-card {
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: var(--background-secondary);
    padding: 10px;
    overflow: hidden;
  }
  .chart {
    width: 100%;
  }

  @media (max-width: 900px) {
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .kpi-wide {
      grid-column: span 2;
    }
    .charts {
      grid-template-columns: 1fr;
    }
  }
</style>


