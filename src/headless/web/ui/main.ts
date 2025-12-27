import "./runtimeDomShims";
import ObsidianLiveSyncPlugin from "./pluginStub";
import { App, PluginSettingTab } from "obsidian";
import { ObsidianLiveSyncSettingTab } from "../../../modules/features/SettingDialogue/ObsidianLiveSyncSettingTab";
import { eventHub, EVENT_REQUEST_COPY_SETUP_URI, EVENT_REQUEST_OPEN_SETUP_URI, EVENT_REQUEST_SHOW_SETUP_QR } from "../../../common/events";
import { decodeSettingsFromSetupURI, encodeSettingsToSetupURI } from "../../../lib/src/API/processSetting";
import { mount } from "svelte";
import LogsTab from "./panes/LogsTab.svelte";
import DashboardTab from "./panes/DashboardTab.svelte";
import ConfirmHost from "./ConfirmHost.svelte";

function apiOrigin(): string {
    const { protocol, hostname, port } = window.location;
    const host = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${host}`;
}

async function pushConfigPassphraseToDaemon(passphrase: string) {
    await fetch(`${apiOrigin()}/api/session/config-passphrase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
    });
}

async function main() {
    // Mark this runtime as "headless web UI" so shared code can route some network calls via the daemon.
    (globalThis as any).__LIVESYNC_HEADLESS__ = true;

    const root = document.getElementById("app");
    if (!root) throw new Error("Missing #app");

    // Bridge config passphrase (stored in browser localStorage by the UI) to the daemon (in-memory only).
    // LiveSync uses this key name in Obsidian as well.
    const key = "ls-setting-passphrase";
    const existing = localStorage.getItem(key) || "";
    if (existing) {
        await pushConfigPassphraseToDaemon(existing);
    }
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
        origSetItem(k, v);
        if (k === key) {
            // Only push non-empty passphrases to the daemon.
            const s = String(v ?? "");
            if (s) void pushConfigPassphraseToDaemon(s);
        }
    };

    // Create fake app/plugin for the SettingTab.
    const app = new App() as any;
    const plugin = new ObsidianLiveSyncPlugin(app);

    // Load settings from the headless daemon.
    await plugin.services.setting.loadSettings();

    // Render settings tab
    const tab = new ObsidianLiveSyncSettingTab(app as any, plugin as any) as unknown as PluginSettingTab;
    (tab as any).containerEl = root;
    // Global confirm host (daemon-driven prompts)
    mount(ConfirmHost, { target: document.body });

    // Implement Setup URI flows (normally handled by ModuleSetupObsidian inside Obsidian).
    eventHub.onEvent(EVENT_REQUEST_OPEN_SETUP_URI, async () => {
        const setupURI = window.prompt("Paste Setup URI (obsidian://setuplivesync?settings=...):", "");
        if (!setupURI) return;
        const passphrase = window.prompt("Passphrase for Setup URI:", "") || "";
        if (!passphrase) {
            window.alert("Passphrase is required.");
            return;
        }
        const conf = await decodeSettingsFromSetupURI(setupURI.trim(), passphrase);
        if (!conf) {
            window.alert("Failed to parse Setup URI.");
            return;
        }
        // Apply imported settings and save.
        plugin.settings = conf as any;
        await plugin.saveSettings();
        (tab as any).reloadAllSettings?.(true);
        (tab as any).display?.();
    });

    eventHub.onEvent(EVENT_REQUEST_COPY_SETUP_URI, async () => {
        const passphrase = window.prompt("Passphrase to encrypt Setup URI:", "") || "";
        if (!passphrase) {
            window.alert("Passphrase is required.");
            return;
        }
        const uri = await encodeSettingsToSetupURI(plugin.settings as any, passphrase);
        try {
            await navigator.clipboard.writeText(uri);
            window.alert("Setup URI copied to clipboard.");
        } catch {
            window.prompt("Copy Setup URI:", uri);
        }
    });

    eventHub.onEvent(EVENT_REQUEST_SHOW_SETUP_QR, async () => {
        // Minimal: show URI in a prompt; QR rendering can be added later.
        const passphrase = window.prompt("Passphrase to encrypt Setup URI:", "") || "";
        if (!passphrase) return;
        const uri = await encodeSettingsToSetupURI(plugin.settings as any, passphrase);
        window.prompt("Setup URI:", uri);
    });

    if (typeof (tab as any).display === "function") {
        (tab as any).display();
        injectHeadlessTabs(tab as any, root);
    } else {
        root.textContent = "Settings UI failed to initialise (display() not found).";
    }
}

function injectHeadlessTabs(tab: any, root: HTMLElement) {
    // Add two extra panes to existing tabbar without touching the upstream UI code.
    const menuEl: HTMLElement | undefined = tab.menuEl;
    if (!menuEl) return;

    const addPane = (order: string, title: string, icon: string, mountPane: (el: HTMLElement) => void) => {
        const paneEl = document.createElement("div");
        paneEl.className = "sls-setting-pane headless-extra-pane";
        const h3 = document.createElement("h3");
        h3.className = "sls-setting-pane-title";
        h3.textContent = title;
        paneEl.appendChild(h3);

        root.appendChild(paneEl);
        tab.addScreenElement(order, paneEl);

        const label = document.createElement("label");
        label.className = `sls-setting-label c-${order}`;
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "disp";
        input.value = order;
        input.className = "sls-setting-tab";
        input.addEventListener("change", (evt) => tab.selectPane(evt));
        input.addEventListener("click", (evt) => tab.selectPane(evt));
        label.appendChild(input);

        const btn = document.createElement("div");
        btn.className = "sls-setting-menu-btn";
        btn.textContent = icon;
        btn.title = title;
        label.appendChild(btn);

        menuEl.appendChild(label);

        mountPane(paneEl);
    };

    addPane("120", "Dashboard", "📊", (paneEl) => {
        const host = document.createElement("div");
        paneEl.appendChild(host);
        mount(DashboardTab, { target: host });
    });
    addPane("121", "Logs", "🧾", (paneEl) => {
        const host = document.createElement("div");
        paneEl.appendChild(host);
        mount(LogsTab, { target: host });
    });

    // Re-apply current selection so new panes get collapsed/expanded correctly.
    const selected = tab.selectedScreen || "110";
    tab.changeDisplay(selected);
}

void main();


