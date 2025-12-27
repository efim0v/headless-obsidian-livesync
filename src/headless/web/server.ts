import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import type { HeadlessLiveSync } from "../HeadlessLiveSync";
import { getLastLogId, getLogsSinceId, subscribeLogs } from "../observability/logCapture";
import { confirmHub } from "../confirm/confirmHub";
import { DEFAULT_SETTINGS } from "../../lib/src/common/types";

type ServerOptions = {
    port: number;
    user: string;
    pass: string;
    staticDir: string;
};

function unauthorized(res: http.ServerResponse) {
    res.statusCode = 401;
    res.setHeader("WWW-Authenticate", 'Basic realm="LiveSync Headless", charset="UTF-8"');
    res.end("Unauthorized");
}

function parseBasicAuth(req: http.IncomingMessage): { user: string; pass: string } | null {
    const h = req.headers.authorization;
    if (!h) return null;
    const [scheme, payload] = h.split(" ");
    if (!scheme || scheme.toLowerCase() !== "basic" || !payload) return null;
    try {
        const decoded = Buffer.from(payload, "base64").toString("utf8");
        const idx = decoded.indexOf(":");
        if (idx === -1) return null;
        return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
    } catch {
        return null;
    }
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
    const h = req.headers.cookie;
    if (!h) return {};
    const out: Record<string, string> = {};
    for (const part of h.split(";")) {
        const idx = part.indexOf("=");
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (!k) continue;
        try {
            out[k] = decodeURIComponent(v);
        } catch {
            out[k] = v;
        }
    }
    return out;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
    return await new Promise((resolve, reject) => {
        let buf = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => (buf += chunk));
        req.on("end", () => resolve(buf));
        req.on("error", reject);
    });
}

function json(res: http.ServerResponse, statusCode: number, body: any) {
    const payload = JSON.stringify(body);
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(payload);
}

function toBase64(buf: Uint8Array): string {
    return Buffer.from(buf).toString("base64");
}

function sseHeaders(res: http.ServerResponse) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Some proxies buffer by default; this header helps (nginx).
    res.setHeader("X-Accel-Buffering", "no");
}

function sseSend(res: http.ServerResponse, event: string, data: any, id?: number) {
    if (id !== undefined) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function serveStatic(res: http.ServerResponse, staticDir: string, urlPath: string) {
    const p = urlPath === "/" ? "/index.html" : urlPath;
    const safePath = p.replace(/\\+/g, "/").replace(/\.\./g, ".");
    const abs = path.join(staticDir, safePath);
    try {
        const data = await fs.readFile(abs);
        const ext = path.extname(abs).toLowerCase();
        const ct =
            ext === ".html"
                ? "text/html; charset=utf-8"
                : ext === ".js"
                  ? "text/javascript; charset=utf-8"
                  : ext === ".css"
                    ? "text/css; charset=utf-8"
                    : "application/octet-stream";
        res.statusCode = 200;
        res.setHeader("Content-Type", ct);
        res.end(data);
    } catch {
        res.statusCode = 404;
        res.end("Not Found");
    }
}

export async function startWebServer(runtime: HeadlessLiveSync, opts: ServerOptions) {
    // BasicAuth is the primary gate, but some clients (EventSource / embedded webviews)
    // can be flaky about consistently attaching the Authorization header.
    // We therefore mint an HttpOnly cookie after a successful BasicAuth challenge and
    // accept that cookie on subsequent requests.
    const sessionCookieName = "sls_session";
    const sessionCookieValue = crypto.randomBytes(32).toString("hex");

    const server = http.createServer(async (req, res) => {
        try {
            const cookies = parseCookies(req);
            const hasSession = cookies[sessionCookieName] === sessionCookieValue;
            if (!hasSession) {
                const auth = parseBasicAuth(req);
                if (!auth || auth.user !== opts.user || auth.pass !== opts.pass) {
                    return unauthorized(res);
                }
                res.setHeader(
                    "Set-Cookie",
                    `${sessionCookieName}=${encodeURIComponent(sessionCookieValue)}; Path=/; HttpOnly; SameSite=Strict`
                );
            }

            const u = new URL(req.url || "/", "http://localhost");
            const pathname = u.pathname;

            // API
            // Proxy for browser-side requestUrlCompat (avoids CORS by doing fetch server-side).
            if (pathname === "/api/request-url" && req.method === "POST") {
                const bodyText = await readBody(req);
                const parsed = JSON.parse(bodyText || "{}");
                const url = String(parsed?.url ?? "");
                if (!url) return json(res, 400, { ok: false, error: "missing url" });

                const method = parsed?.method ? String(parsed.method) : "GET";
                const headers = (parsed?.headers && typeof parsed.headers === "object" ? parsed.headers : {}) as Record<
                    string,
                    string
                >;
                const rawBody = parsed?.body;
                const body =
                    rawBody === undefined || rawBody === null
                        ? undefined
                        : typeof rawBody === "string"
                          ? rawBody
                          : JSON.stringify(rawBody);

                const r = await fetch(url, {
                    method,
                    headers,
                    body,
                });
                const ab = new Uint8Array(await r.arrayBuffer());
                const outHeaders: Record<string, string> = {};
                r.headers.forEach((v, k) => (outHeaders[k] = v));
                return json(res, 200, {
                    ok: true,
                    status: r.status,
                    headers: outHeaders,
                    arrayBufferBase64: toBase64(ab),
                });
            }

            if (pathname === "/api/logs" && req.method === "GET") {
                const since = Number(u.searchParams.get("since") || "0");
                const items = getLogsSinceId(since);
                return json(res, 200, { ok: true, since, lastId: getLastLogId(), items });
            }
            if (pathname === "/api/logs/stream" && req.method === "GET") {
                const since = Number(u.searchParams.get("since") || "0");
                sseHeaders(res);
                // Immediately send missed logs (if any).
                for (const item of getLogsSinceId(since)) {
                    sseSend(res, "log", item, item.id);
                }
                // Keepalive ping to prevent timeouts.
                const pingTimer = setInterval(() => {
                    try {
                        res.write(`event: ping\ndata: {}\n\n`);
                    } catch {
                        // ignore
                    }
                }, 15000);

                const unsub = subscribeLogs((item) => {
                    try {
                        sseSend(res, "log", item, item.id);
                    } catch {
                        // ignore
                    }
                });

                req.on("close", () => {
                    clearInterval(pingTimer);
                    unsub();
                    try {
                        res.end();
                    } catch {
                        // ignore
                    }
                });
                return;
            }

            if (pathname === "/api/settings" && req.method === "GET") {
                // Return effective (decrypted) settings if available.
                // This matches the Obsidian UI behavior where encrypted items are shown as plain fields after passphrase.
                const core: any = runtime as any;
                const effective = typeof core.getSettings === "function" ? core.getSettings() : undefined;
                    if (effective) return json(res, 200, { ...DEFAULT_SETTINGS, ...effective });
                    const raw = await runtime.loadData();
                    // IMPORTANT: UI code expects many keys to always exist (string fields are `.split()` etc).
                    // Always merge with DEFAULT_SETTINGS so the UI never white-screens on missing keys.
                    return json(res, 200, { ...DEFAULT_SETTINGS, ...raw });
            }
            if (pathname === "/api/settings" && req.method === "POST") {
                const body = await readBody(req);
                const parsed = JSON.parse(body);
                // Persist via SettingService so sensitive items are encrypted/scrubbed exactly like the plugin.
                // Also keeps the daemon's in-memory settings consistent.
                try {
                    (runtime as any).settings = parsed;
                } catch {
                    // ignore
                }
                if ((runtime as any).services?.setting?.saveSettingData) {
                    await (runtime as any).services.setting.saveSettingData();
                } else {
                    await runtime.saveData(parsed);
                }
                // Apply to running daemon asynchronously (may block waiting for UI choice).
                if ((runtime as any).applyNewSettings) void (runtime as any).applyNewSettings(parsed);
                return json(res, 200, { ok: true });
            }
            if (pathname === "/api/session/config-passphrase" && req.method === "POST") {
                const body = await readBody(req);
                const parsed = JSON.parse(body);
                const passphrase = typeof parsed?.passphrase === "string" ? parsed.passphrase : "";
                if ((runtime as any).setConfigPassphrase) {
                    (runtime as any).setConfigPassphrase(passphrase);
                }
                    // Immediately reload settings so subsequent /api/settings returns effective decrypted values.
                    // This is critical for page reloads: UI pushes passphrase first, then loads settings.
                    try {
                        await (runtime as any).services?.setting?.loadSettings?.();
                        await (runtime as any).services?.appLifecycle?.onSettingLoaded?.();
                    } catch {
                        // ignore (daemon may not be fully initialised yet)
                    }
                return json(res, 200, { ok: true });
            }
            if (pathname === "/api/metrics" && req.method === "GET") {
                const core: any = runtime as any;
                const read = (v: any) => (v && typeof v === "object" && "value" in v ? v.value : v);
                const snapshot = {
                    ts: Date.now(),
                    headlessMode: read(core.headlessMode) ?? "unknown",
                    headlessLastError: read(core.headlessLastError) ?? "",
                    requestCount: read(core.requestCount),
                    responseCount: read(core.responseCount),
                    totalQueued: read(core.totalQueued),
                    batched: read(core.batched),
                    processing: read(core.processing),
                    databaseQueueCount: read(core.databaseQueueCount),
                    storageApplyingCount: read(core.storageApplyingCount),
                    replicationResultCount: read(core.replicationResultCount),
                    conflictProcessQueueCount: read(core.conflictProcessQueueCount),
                    pendingFileEventCount: read(core.pendingFileEventCount),
                    processingFileEventCount: read(core.processingFileEventCount),
                    replicationStat: read(core.replicationStat),
                };
                return json(res, 200, {
                    ok: true,
                    snapshot,
                    derived: {
                        outstandingRequests: snapshot.requestCount - snapshot.responseCount,
                    },
                });
            }

            // Confirm RPC (daemon -> UI)
            if (pathname === "/api/confirm/pending" && req.method === "GET") {
                return json(res, 200, { ok: true, prompt: confirmHub.getPending() });
            }
            if (pathname === "/api/confirm/respond" && req.method === "POST") {
                const body = await readBody(req);
                const parsed = JSON.parse(body);
                const id = Number(parsed?.id);
                const value = parsed?.value;
                if (!Number.isFinite(id) || id <= 0) return json(res, 400, { ok: false, error: "bad id" });
                const ok = confirmHub.respond(id, value);
                return json(res, 200, { ok });
            }

            // Static UI
            return await serveStatic(res, opts.staticDir, pathname);
        } catch (e: any) {
            return json(res, 500, { error: e?.message ?? String(e) });
        }
    });

    await new Promise<void>((resolve) => server.listen(opts.port, resolve));
    return server;
}


