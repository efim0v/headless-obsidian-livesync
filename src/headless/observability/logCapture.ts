import { setGlobalLogFunction } from "octagonal-wheels/common/logger";

export type CapturedLogLevel = number | undefined;

export type CapturedLogItem = {
    id: number;
    ts: number;
    level?: CapturedLogLevel;
    key?: string;
    message: string;
    line: string;
};

const MAX_LINES = 10000;
let nextId = 1;
let buffer: CapturedLogItem[] = [];

type Subscriber = (item: CapturedLogItem) => void;
const subscribers = new Set<Subscriber>();

function stringifyMsg(msg: any): string {
    if (msg instanceof Error) {
        return msg.stack || msg.message || String(msg);
    }
    if (typeof msg === "string") return msg;
    try {
        return JSON.stringify(msg);
    } catch {
        return String(msg);
    }
}

function append(item: Omit<CapturedLogItem, "id">): CapturedLogItem {
    const full: CapturedLogItem = { id: nextId++, ...item };
    buffer.push(full);
    if (buffer.length > MAX_LINES) {
        buffer = buffer.slice(buffer.length - MAX_LINES);
    }
    for (const fn of subscribers) {
        try {
            fn(full);
        } catch {
            // ignore subscriber errors
        }
    }
    return full;
}

let initialised = false;

/**
 * Capture octagonal-wheels Logger(...) calls into an in-memory ring buffer.
 * This also keeps printing to stdout (console.log / console.error) so container logs remain useful.
 */
export function initDaemonLogCapture() {
    if (initialised) return;
    initialised = true;
    setGlobalLogFunction((msg: any, level?: number, key?: string) => {
        const message = stringifyMsg(msg);
        const ts = Date.now();
        const line = `${new Date(ts).toISOString()}\u2001${message}`;
        // Preserve console output.
        if (typeof level === "number" && level <= 0) console.error(message);
        else console.log(message);
        append({ ts, level, key, message, line });
    });
}

export function getLogsSinceId(sinceId: number) {
    if (!Number.isFinite(sinceId) || sinceId < 0) sinceId = 0;
    return buffer.filter((x) => x.id > sinceId);
}

export function getLastLogId() {
    return buffer.length ? buffer[buffer.length - 1].id : 0;
}

export function subscribeLogs(fn: Subscriber) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}


