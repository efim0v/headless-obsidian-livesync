<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import LogPane from "../../../../modules/features/Log/LogPane.svelte";
  import { logMessages } from "../../../../lib/src/mock_and_interop/stores";

  type LogItem = { id: number; line: string; level?: number; message: string; ts: number; key?: string };

  function apiOrigin(): string {
    const { protocol, hostname, port } = window.location;
    const host = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${host}`;
  }

  let lastId = 0;
  let status = $state("polling");
  let pollTimer: any = null;

  function appendLines(items: LogItem[]) {
    const lines = items.map((x) => x.line);
    if (lines.length === 0) return;
    logMessages.value = [...logMessages.value, ...lines].slice(-10000);
    lastId = Math.max(lastId, ...items.map((x) => x.id));
  }

  async function initialLoad() {
    const r = await fetch(`${apiOrigin()}/api/logs?since=0`);
    const data = await r.json();
    const items: LogItem[] = Array.isArray(data?.items) ? data.items : [];
    logMessages.value = items.map((x) => x.line);
    lastId = typeof data?.lastId === "number" ? data.lastId : items.length ? items[items.length - 1].id : 0;
  }

  async function pollOnce() {
    try {
      const r = await fetch(`${apiOrigin()}/api/logs?since=${lastId}`);
      if (!r.ok) throw new Error(`GET /api/logs failed: ${r.status}`);
      const data = await r.json();
      const items: LogItem[] = Array.isArray(data?.items) ? data.items : [];
      appendLines(items);
      status = "polling";
    } catch (e: any) {
      status = "error";
      // keep polling; transient auth/cookie issues can resolve after the next request
      console.warn("Logs polling failed:", e?.message ?? e);
    }
  }

  function startPolling() {
    status = "polling";
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => void pollOnce(), 1000);
    void pollOnce();
  }

  onMount(() => {
    void (async () => {
      await initialLoad();
      // Polling-first: EventSource + BasicAuth is unreliable in browsers.
      startPolling();
    })();
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  });

  function clear() {
    logMessages.value = [];
    lastId = 0;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    startPolling();
  }
</script>

<div class="headless-logs-tab">
  <div class="headless-logs-toolbar">
    <div class="headless-logs-status">Status: {status}</div>
    <div class="spacer"></div>
    <button onclick={clear}>Clear</button>
  </div>
  <div class="headless-logs-body">
    <LogPane close={() => {}} />
  </div>
</div>

<style>
  .headless-logs-tab {
    margin-top: 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: var(--background-secondary);
    overflow: hidden;
  }
  .headless-logs-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    background: rgba(255, 255, 255, 0.02);
  }
  .headless-logs-status {
    color: var(--text-muted);
    font-size: 13px;
  }
  .spacer {
    flex: 1;
  }
  .headless-logs-body {
    height: min(70vh, 760px);
    padding: 10px 12px;
  }
</style>


