// Polyfills for running browser-centric utilities (octagonal-wheels) in Node.

// EventTarget-backed global event channel used by octagonal-wheels expects these on globalThis.
if (typeof (globalThis as any).addEventListener !== "function") {
    const target = new EventTarget();
    (globalThis as any).addEventListener = target.addEventListener.bind(target);
    (globalThis as any).removeEventListener = target.removeEventListener.bind(target);
    (globalThis as any).dispatchEvent = target.dispatchEvent.bind(target);
}

// CustomEvent is used by some event hubs.
if (typeof (globalThis as any).CustomEvent !== "function") {
    class CustomEvent<T = any> extends Event {
        detail: T;
        constructor(type: string, init?: CustomEventInit<T>) {
            super(type, init);
            this.detail = init?.detail as T;
        }
    }
    (globalThis as any).CustomEvent = CustomEvent;
}

// navigator polyfill for libraries that use `navigator.onLine` / `navigator.hardwareConcurrency`.
if (typeof (globalThis as any).navigator === "undefined") {
    (globalThis as any).navigator = {};
}
if (typeof (globalThis as any).navigator.onLine !== "boolean") {
    (globalThis as any).navigator.onLine = true;
}
if (typeof (globalThis as any).navigator.hardwareConcurrency !== "number") {
    (globalThis as any).navigator.hardwareConcurrency = 8;
}

// localStorage polyfill (persistent file-backed) for modules that expect browser storage.
if (typeof (globalThis as any).localStorage === "undefined") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const baseDir = "/data";
    const filePath = path.join(baseDir, "localStorage.json");
    let cache: Record<string, string> = {};
    try {
        cache = JSON.parse(fs.readFileSync(filePath, "utf8")) ?? {};
    } catch {
        cache = {};
    }
    const flush = () => {
        try {
            fs.mkdirSync(baseDir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf8");
        } catch {
            // ignore
        }
    };
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in cache ? cache[k] : null),
        setItem: (k: string, v: string) => {
            cache[k] = String(v);
            flush();
        },
        removeItem: (k: string) => {
            delete cache[k];
            flush();
        },
        clear: () => {
            cache = {};
            flush();
        },
    };
}


