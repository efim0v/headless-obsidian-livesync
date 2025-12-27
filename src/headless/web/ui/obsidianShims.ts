// Browser-side shim for the `obsidian` module, sufficient to run the LiveSync settings UI.
// It implements the minimal subset of classes used by the SettingDialogue code.

export class App {
    vault = {
        configDir: ".obsidian",
    };
    setting = {
        close: () => {
            // no-op in headless web UI
        },
    };
}

export class Plugin {
    app: App;
    constructor(app: App) {
        this.app = app;
    }
}

export class PluginSettingTab {
    app: App;
    plugin: any;
    containerEl!: HTMLElement;
    constructor(app: App, plugin: any) {
        this.app = app;
        this.plugin = plugin;
    }
    display() {}
}

export class Notice {
    constructor(public message: any) {
        // eslint-disable-next-line no-console
        console.log("Notice:", message);
    }
}

export function getLanguage(): string {
    return (navigator.language || "en").split("-")[0] || "en";
}

export class Menu {
    items: any[] = [];
    addItem(cb: (item: any) => void) {
        const item: any = {
            setTitle: (_t: string) => item,
            setIcon: (_i: string) => item,
            onClick: (_cb: () => void) => item,
        };
        cb(item);
        this.items.push(item);
        return this;
    }
    showAtMouseEvent(_evt: MouseEvent) {
        // no-op
    }
}

export const Platform: any = {
    isDesktop: true,
    isMacOS: false,
    isWin: false,
    isLinux: true,
    isAndroidApp: false,
    isIosApp: false,
};

export function debounce<T extends (...args: any[]) => any>(fn: T, timeout: number): T {
    let t: any;
    return ((...args: any[]) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), timeout);
    }) as any as T;
}

export function addIcon(_name: string, _svg: string) {
    // no-op
}

export function sanitizeHTMLToDom(html: string) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
}

export function stringifyYaml(v: any) {
    return JSON.stringify(v, null, 2);
}
export function parseYaml(v: string) {
    return JSON.parse(v);
}

export type RequestUrlParam = {
    url: string;
    method?: string;
    body?: any;
    headers?: any;
    contentType?: string;
    throw?: boolean;
};
export type RequestUrlResponse = {
    status: number;
    headers: Record<string, string>;
    text: string;
    json: any;
    arrayBuffer: ArrayBuffer;
};

export async function requestUrl(req: RequestUrlParam): Promise<RequestUrlResponse> {
    const r = await fetch(req.url, { method: req.method, body: req.body, headers: req.headers });
    const ab = await r.arrayBuffer();
    const text = new TextDecoder().decode(ab);
    let json: any = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    return { status: r.status, headers, text, json, arrayBuffer: ab };
}

// Some modules import `request` from obsidian; provide a compatible alias.
export async function request(url: string, opts?: any): Promise<any> {
    const r = await fetch(url, opts);
    return await r.text();
}

// --- UI component primitives used by Setting/LiveSyncSetting ---

export class ValueComponent<T> {
    value!: T;
    onChange(_cb: (value: T) => void) {
        return this;
    }
}

export class TextComponent extends ValueComponent<string> {
    inputEl: HTMLInputElement;
    constructor(parentEl: HTMLElement) {
        super();
        this.inputEl = document.createElement("input");
        this.inputEl.type = "text";
        parentEl.appendChild(this.inputEl);
    }
    setValue(v: string) {
        this.value = v;
        this.inputEl.value = v;
        return this;
    }
    getValue() {
        return this.inputEl.value;
    }
    setPlaceholder(v: string) {
        this.inputEl.placeholder = v;
        return this;
    }
    onChange(cb: (value: string) => void) {
        this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
        return this;
    }
}

export class TextAreaComponent extends ValueComponent<string> {
    inputEl: HTMLTextAreaElement;
    constructor(parentEl: HTMLElement) {
        super();
        this.inputEl = document.createElement("textarea");
        parentEl.appendChild(this.inputEl);
    }
    setValue(v: string) {
        this.value = v;
        this.inputEl.value = v;
        return this;
    }
    onChange(cb: (value: string) => void) {
        this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
        return this;
    }
}

export class ToggleComponent extends ValueComponent<boolean> {
    inputEl: HTMLInputElement;
    constructor(parentEl: HTMLElement) {
        super();
        this.inputEl = document.createElement("input");
        this.inputEl.type = "checkbox";
        parentEl.appendChild(this.inputEl);
    }
    setValue(v: boolean) {
        this.value = v;
        this.inputEl.checked = v;
        return this;
    }
    onChange(cb: (value: boolean) => void) {
        this.inputEl.addEventListener("change", () => cb(this.inputEl.checked));
        return this;
    }
}

export class DropdownComponent extends ValueComponent<string> {
    selectEl: HTMLSelectElement;
    constructor(parentEl: HTMLElement) {
        super();
        this.selectEl = document.createElement("select");
        parentEl.appendChild(this.selectEl);
    }
    addOptions(opts: Record<string, string>) {
        this.selectEl.innerHTML = "";
        for (const [value, label] of Object.entries(opts)) {
            const o = document.createElement("option");
            o.value = value;
            o.textContent = label;
            this.selectEl.appendChild(o);
        }
        return this;
    }
    setValue(v: string) {
        this.value = v;
        this.selectEl.value = v;
        return this;
    }
    onChange(cb: (value: string) => void) {
        this.selectEl.addEventListener("change", () => cb(this.selectEl.value));
        return this;
    }
}

export class ButtonComponent extends ValueComponent<never> {
    buttonEl: HTMLButtonElement;
    constructor(parentEl: HTMLElement) {
        super();
        this.buttonEl = document.createElement("button");
        parentEl.appendChild(this.buttonEl);
    }
    setButtonText(t: string) {
        this.buttonEl.textContent = t;
        return this;
    }
    setDisabled(v: boolean) {
        this.buttonEl.disabled = v;
        return this;
    }
    setCta() {
        this.buttonEl.classList.add("mod-cta");
        return this;
    }
    removeCta() {
        this.buttonEl.classList.remove("mod-cta");
        return this;
    }
    setWarning() {
        this.buttonEl.classList.add("mod-warning");
        return this;
    }
    removeWarning() {
        this.buttonEl.classList.remove("mod-warning");
        return this;
    }
    onClick(cb: () => void) {
        this.buttonEl.addEventListener("click", cb);
        return this;
    }
}

export class Setting {
    settingEl: HTMLDivElement;
    controlEl: HTMLDivElement;
    nameEl: HTMLDivElement;
    descEl: HTMLDivElement;
    constructor(containerEl: HTMLElement) {
        this.settingEl = document.createElement("div");
        this.settingEl.className = "setting-item";
        containerEl.appendChild(this.settingEl);

        const info = document.createElement("div");
        info.className = "setting-item-info";
        this.settingEl.appendChild(info);
        this.nameEl = document.createElement("div");
        this.nameEl.className = "setting-item-name";
        info.appendChild(this.nameEl);
        this.descEl = document.createElement("div");
        this.descEl.className = "setting-item-description";
        info.appendChild(this.descEl);

        this.controlEl = document.createElement("div");
        this.controlEl.className = "setting-item-control";
        this.settingEl.appendChild(this.controlEl);
    }
    setName(name: any) {
        this.nameEl.textContent = typeof name === "string" ? name : name?.textContent ?? "";
        return this;
    }
    setDesc(desc: any) {
        this.descEl.textContent = typeof desc === "string" ? desc : desc?.textContent ?? "";
        return this;
    }
    setClass(cls: string) {
        this.settingEl.classList.add(cls);
        return this;
    }
    addText(cb: (c: TextComponent) => void) {
        const c = new TextComponent(this.controlEl);
        cb(c);
        return this;
    }
    addTextArea(cb: (c: TextAreaComponent) => void) {
        const c = new TextAreaComponent(this.controlEl);
        cb(c);
        return this;
    }
    addToggle(cb: (c: ToggleComponent) => void) {
        const c = new ToggleComponent(this.controlEl);
        cb(c);
        return this;
    }
    addDropdown(cb: (c: DropdownComponent) => void) {
        const c = new DropdownComponent(this.controlEl);
        cb(c);
        return this;
    }
    addButton(cb: (c: ButtonComponent) => void) {
        const c = new ButtonComponent(this.controlEl);
        cb(c);
        return this;
    }
    setTooltip(t: string) {
        this.settingEl.title = t;
        return this;
    }
    setDisabled(v: boolean) {
        this.settingEl.classList.toggle("is-disabled", v);
        // Best-effort: disable all inputs/buttons inside.
        this.settingEl.querySelectorAll("input,textarea,select,button").forEach((el) => {
            (el as HTMLInputElement).disabled = v;
        });
        return this;
    }
}

// Types used by deps.ts only
export type DataWriteOptions = any;
export type PluginManifest = any;
export type MarkdownFileInfo = any;
export type ListedFiles = any;

// File types (placeholders)
export class TAbstractFile {}
export class TFile extends TAbstractFile {}
export class TFolder extends TAbstractFile {}
export class ItemView {}
export class WorkspaceLeaf {}
export class Editor {}
export class Modal {
    app: any;
    opened = false;

    overlayEl: HTMLDivElement;
    modalEl: HTMLDivElement;
    headerEl: HTMLDivElement;
    titleEl: HTMLDivElement;
    contentEl: HTMLDivElement;

    private _onKeyDown?: (e: KeyboardEvent) => void;

    constructor(app: any) {
        this.app = app;

        this.overlayEl = document.createElement("div");
        this.overlayEl.className = "sls-modal-overlay";

        this.modalEl = document.createElement("div");
        this.modalEl.className = "sls-modal";
        this.overlayEl.appendChild(this.modalEl);

        this.headerEl = document.createElement("div");
        this.headerEl.className = "sls-modal-header";
        this.modalEl.appendChild(this.headerEl);

        this.titleEl = document.createElement("div");
        this.titleEl.className = "sls-modal-title";
        this.titleEl.textContent = "LiveSync";
        this.headerEl.appendChild(this.titleEl);

        const closeBtn = document.createElement("button");
        closeBtn.className = "sls-modal-close";
        closeBtn.type = "button";
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", () => this.close());
        this.headerEl.appendChild(closeBtn);

        this.contentEl = document.createElement("div");
        this.contentEl.className = "sls-modal-content";
        this.modalEl.appendChild(this.contentEl);

        // Prevent clicks inside from closing anything implicitly.
        this.modalEl.addEventListener("click", (e) => e.stopPropagation());
        // Clicking backdrop closes (same as many modals). Setup wizard supports explicit Cancel;
        // backdrop close is still useful, but will be treated as undefined result.
        this.overlayEl.addEventListener("click", () => this.close());
    }

    setTitle(title: string) {
        this.titleEl.textContent = title;
    }

    open() {
        if (this.opened) return;
        this.opened = true;
        document.body.appendChild(this.overlayEl);

        this._onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") this.close();
        };
        window.addEventListener("keydown", this._onKeyDown);

        // @ts-ignore
        if (typeof this.onOpen === "function") this.onOpen();
    }

    close() {
        if (!this.opened) return;
        this.opened = false;
        // @ts-ignore
        if (typeof this.onClose === "function") this.onClose();
        this.overlayEl.remove();
        if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
        this._onKeyDown = undefined;
    }

    // For subclass overrides
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onOpen() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onClose() {}
}
export class MarkdownRenderer {
    static async render(_app: any, markdown: string, el: HTMLElement, _sourcePath?: string, _plugin?: any) {
        // Render markdown to HTML for web UI.
        const { default: MarkdownIt } = await import("markdown-it");
        const md = new MarkdownIt({
            html: false, // do not allow raw HTML
            linkify: true,
            breaks: true,
        });
        const html = md.render(markdown);
        el.innerHTML = html;
    }
}
export class MarkdownView {}
export class FuzzySuggestModal {}
export class TextAreaComponentShim {}

export function normalizePath<T extends string>(from: T): T {
    return (String(from).replace(/\\/g, "/").replace(/\/+/g, "/") as unknown) as T;
}


