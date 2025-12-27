import "./polyfills";
import fs from "node:fs";
import path from "node:path";
import { HeadlessLiveSync } from "./HeadlessLiveSync";
import { startWebServer } from "./web/server";
import { DEFAULT_SETTINGS } from "../lib/src/common/types";
import { initDaemonLogCapture } from "./observability/logCapture";

function env(name: string, fallback?: string): string | undefined {
    const v = process.env[name];
    return v === undefined || v === "" ? fallback : v;
}

function mustEnv(name: string, fallback?: string): string {
    const v = env(name, fallback);
    if (!v) throw new Error(`Missing env ${name}`);
    return v;
}

function exists(p: string): boolean {
    try {
        fs.accessSync(p, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

const vaultDir = mustEnv("LIVESYNC_VAULT_DIR", "/vault");
const settingsPath =
    env("LIVESYNC_SETTINGS_PATH") ??
    path.join(vaultDir, ".obsidian", "plugins", "obsidian-livesync", "data.json");

// Capture daemon logs into in-memory ring buffer (consumed by Web UI Logs tab).
initDaemonLogCapture();

// Make crashes diagnosable in container logs.
process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("UNHANDLED_REJECTION", reason);
});
process.on("uncaughtException", (err) => {
    // eslint-disable-next-line no-console
    console.error("UNCAUGHT_EXCEPTION", err);
    // Do not hard-exit: keep the Web UI available so the user can inspect logs and fix configuration.
    // Note: the process may be in a degraded state after an uncaught exception.
    try {
        (app as any)?.headlessLastError && ((app as any).headlessLastError.value = (err as any)?.message ?? String(err));
        (app as any)?.headlessMode && ((app as any).headlessMode.value = "error");
    } catch {
        // ignore
    }
});

if (!exists(vaultDir)) {
    console.error(`ERROR: Vault directory not found: ${vaultDir}`);
    process.exit(2);
}
if (!exists(settingsPath)) {
    // Create a default settings file so Web UI can be used to configure the daemon from scratch.
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, isConfigured: false }, null, 2), "utf8");
    console.warn(`WARN: LiveSync settings file not found, created default: ${settingsPath}`);
}

const app = new HeadlessLiveSync({ vaultDir, settingsPath });
process.on("SIGINT", async () => {
    await app.stop();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    await app.stop();
    process.exit(0);
});

// Web UI (port 80)
const uiUser = mustEnv("LIVESYNC_UI_USER");
const uiPass = mustEnv("LIVESYNC_UI_PASS");
const staticDir = path.join(process.cwd(), "dist", "headless-ui");
await startWebServer(app, { port: 80, user: uiUser, pass: uiPass, staticDir });

// Start the daemon after the web server is listening.
// This allows daemon-driven confirmations (sync wizard) to be displayed immediately on startup.
try {
    await app.start();
} catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("ERROR: app.start failed", e);
    try {
        (app as any)?.headlessLastError && ((app as any).headlessLastError.value = e?.message ?? String(e));
        (app as any)?.headlessMode && ((app as any).headlessMode.value = "error");
    } catch {
        // ignore
    }
    // Keep process alive so UI can be used to fix configuration and trigger retry via settings save.
}

// Keep process alive
await new Promise<never>(() => {});



