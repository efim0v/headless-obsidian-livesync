// DOM helpers used heavily by Obsidian settings UI.

declare global {
    interface HTMLElement {
        addClass(cls: string): void;
        removeClass(cls: string): void;
        toggleClass(cls: string, v?: boolean): void;
        createDiv(opts?: { text?: string; cls?: string } | string): HTMLDivElement;
        empty(): void;
        setText(text: string): void;
        setAttr(name: string, value: string): void;
        createEl<K extends keyof HTMLElementTagNameMap>(
            tag: K,
            // Accept Obsidian-like DomElementInfo shape.
            opts?: any,
            callback?: (el: HTMLElementTagNameMap[K]) => void
        ): HTMLElementTagNameMap[K];
        createSpan(opts?: { text?: string; cls?: string }): HTMLSpanElement;
        hasClass(cls: string): boolean;
        addClasses(...classes: string[]): void;
        getAttr(name: string): string | null;
        setCssStyles(styles: Partial<CSSStyleDeclaration> & Record<string, string>): void;
    }
}

if (!(HTMLElement.prototype as any).addClass) {
    (HTMLElement.prototype as any).addClass = function (cls: string) {
        this.classList.add(cls);
    };
}
if (!(HTMLElement.prototype as any).removeClass) {
    (HTMLElement.prototype as any).removeClass = function (cls: string) {
        this.classList.remove(cls);
    };
}
if (!(HTMLElement.prototype as any).toggleClass) {
    (HTMLElement.prototype as any).toggleClass = function (cls: string, v?: boolean) {
        if (v === undefined) this.classList.toggle(cls);
        else v ? this.classList.add(cls) : this.classList.remove(cls);
    };
}
if (!(HTMLElement.prototype as any).createDiv) {
    (HTMLElement.prototype as any).createDiv = function (opts?: { text?: string; cls?: string } | string) {
        const el = document.createElement("div");
        if (typeof opts === "string") {
            el.textContent = opts;
        } else {
            if (opts?.text !== undefined) el.textContent = opts.text;
            if (opts?.cls) el.className = opts.cls;
        }
        this.appendChild(el);
        return el;
    };
}

if (!(HTMLElement.prototype as any).empty) {
    (HTMLElement.prototype as any).empty = function () {
        while (this.firstChild) this.removeChild(this.firstChild);
    };
}

if (!(HTMLElement.prototype as any).setText) {
    (HTMLElement.prototype as any).setText = function (text: string) {
        this.textContent = text;
    };
}

if (!(HTMLElement.prototype as any).setAttr) {
    (HTMLElement.prototype as any).setAttr = function (name: string, value: string) {
        this.setAttribute(name, value);
    };
}

if (!(HTMLElement.prototype as any).createEl) {
    (HTMLElement.prototype as any).createEl = function (
        tag: string,
        opts?: any,
        callback?: (el: any) => void
    ) {
        const el = document.createElement(tag);
        // Obsidian createEl allows passing string as textContent.
        if (typeof opts === "string") {
            el.textContent = opts;
        } else if (opts && typeof opts === "object") {
            // cls can be string or array
            if (opts.cls) {
                if (Array.isArray(opts.cls)) el.classList.add(...opts.cls);
                else el.className = String(opts.cls);
            }
            if (opts.text !== undefined) el.textContent = String(opts.text);
            if (opts.attr && typeof opts.attr === "object") {
                for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
            }
            // Apply remaining props/attrs: type/name/value/title/placeholder/checked/etc.
            for (const [k, v] of Object.entries(opts)) {
                if (k === "cls" || k === "text" || k === "attr") continue;
                if (v === undefined || v === null) continue;
                try {
                    if (k in el) {
                        // @ts-ignore
                        el[k] = v;
                    } else {
                        el.setAttribute(k, String(v));
                    }
                } catch {
                    // ignore
                }
            }
        }
        this.appendChild(el);
        if (callback) callback(el);
        return el;
    };
}

if (!(HTMLElement.prototype as any).createSpan) {
    (HTMLElement.prototype as any).createSpan = function (opts?: { text?: string; cls?: string }) {
        const el = document.createElement("span");
        if (opts?.text) el.textContent = opts.text;
        if (opts?.cls) el.className = opts.cls;
        this.appendChild(el);
        return el;
    };
}

if (!(HTMLElement.prototype as any).hasClass) {
    (HTMLElement.prototype as any).hasClass = function (cls: string) {
        return this.classList.contains(cls);
    };
}

if (!(HTMLElement.prototype as any).addClasses) {
    (HTMLElement.prototype as any).addClasses = function (...classes: string[]) {
        for (const c of classes) this.classList.add(c);
    };
}

if (!(HTMLElement.prototype as any).getAttr) {
    (HTMLElement.prototype as any).getAttr = function (name: string) {
        return this.getAttribute(name);
    };
}

if (!(HTMLElement.prototype as any).setCssStyles) {
    (HTMLElement.prototype as any).setCssStyles = function (styles: any) {
        Object.assign(this.style, styles);
    };
}

// Some libs use Set#contains (Obsidian polyfill). Map it to Set#has.
if (!(Set.prototype as any).contains) {
    // eslint-disable-next-line no-extend-native
    (Set.prototype as any).contains = function (v: any) {
        return this.has(v);
    };
}

// Obsidian uses Array#contains in some places.
if (!(Array.prototype as any).contains) {
    // eslint-disable-next-line no-extend-native
    (Array.prototype as any).contains = function (v: any) {
        return this.includes(v);
    };
}

// Global helpers expected by some panes (Obsidian provides these).
if (typeof (globalThis as any).createDiv !== "function") {
    (globalThis as any).createDiv = (opts?: { text?: string; cls?: string }) => {
        const el = document.createElement("div");
        if (opts?.text !== undefined) el.textContent = opts.text;
        if (opts?.cls) el.className = opts.cls;
        return el;
    };
}


