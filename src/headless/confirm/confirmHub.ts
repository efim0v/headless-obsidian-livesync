import { EventEmitter } from "node:events";

export type ConfirmPromptType = "select" | "yesno" | "string" | "confirmWithMessage";

export type ConfirmPrompt = {
    id: number;
    ts: number;
    type: ConfirmPromptType;
    title?: string;
    message: string;
    // For select/confirmWithMessage
    buttons?: string[];
    defaultAction?: string;
    // For askString
    key?: string;
    placeholder?: string;
    isPassword?: boolean;
};

type Pending = {
    prompt: ConfirmPrompt;
    resolve: (value: any) => void;
    timeoutHandle?: NodeJS.Timeout;
};

class ConfirmHub extends EventEmitter {
    private pending: Pending | null = null;
    private nextId = 1;

    constructor() {
        super();
        this.setMaxListeners(100);
    }

    getPending(): ConfirmPrompt | null {
        return this.pending?.prompt ?? null;
    }

    private setPending(p: Pending) {
        // Replace any existing pending prompt (best effort: resolve with false).
        if (this.pending) {
            try {
                this.pending.timeoutHandle && clearTimeout(this.pending.timeoutHandle);
            } catch {
                // ignore
            }
            try {
                this.pending.resolve(false);
            } catch {
                // ignore
            }
        }
        this.pending = p;
        this.emit("change", this.pending.prompt);
    }

    respond(id: number, value: any): boolean {
        if (!this.pending) return false;
        if (this.pending.prompt.id !== id) return false;
        const p = this.pending;
        this.pending = null;
        try {
            p.timeoutHandle && clearTimeout(p.timeoutHandle);
        } catch {
            // ignore
        }
        p.resolve(value);
        this.emit("change", null);
        return true;
    }

    async promptSelect<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        const id = this.nextId++;
        const prompt: ConfirmPrompt = {
            id,
            ts: Date.now(),
            type: "select",
            title: opt.title,
            message,
            buttons: [...buttons],
            defaultAction: opt.defaultAction,
        };
        return await new Promise<T[number] | false>((resolve) => {
            const pending: Pending = { prompt, resolve };
            if (opt.timeout && opt.timeout > 0) {
                pending.timeoutHandle = setTimeout(() => {
                    // Auto-resolve to default action if present, else false.
                    this.respond(id, opt.defaultAction ?? false);
                }, opt.timeout * 1000);
            }
            this.setPending(pending);
        });
    }

    async promptYesNo(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number },
        labels: { yes: string; no: string }
    ): Promise<"yes" | "no"> {
        const defaultAction = opt.defaultOption === "No" ? labels.no : labels.yes;
        const ret = await this.promptSelect(message, [labels.yes, labels.no] as const, {
            title: opt.title,
            defaultAction,
            timeout: opt.timeout,
        });
        return ret === labels.yes ? "yes" : "no";
    }

    async promptString(args: {
        title: string;
        key: string;
        placeholder: string;
        isPassword?: boolean;
        timeout?: number;
    }): Promise<string | false> {
        const id = this.nextId++;
        const prompt: ConfirmPrompt = {
            id,
            ts: Date.now(),
            type: "string",
            title: args.title,
            message: args.title,
            key: args.key,
            placeholder: args.placeholder,
            isPassword: args.isPassword,
        };
        return await new Promise<string | false>((resolve) => {
            const pending: Pending = { prompt, resolve };
            if (args.timeout && args.timeout > 0) {
                pending.timeoutHandle = setTimeout(() => {
                    this.respond(id, false);
                }, args.timeout * 1000);
            }
            this.setPending(pending);
        });
    }

    async promptConfirmWithMessage(args: {
        title: string;
        contentMd: string;
        buttons: string[];
        defaultAction: string;
        timeout?: number;
    }): Promise<string | false> {
        const id = this.nextId++;
        const prompt: ConfirmPrompt = {
            id,
            ts: Date.now(),
            type: "confirmWithMessage",
            title: args.title,
            message: args.contentMd,
            buttons: args.buttons,
            defaultAction: args.defaultAction,
        };
        return await new Promise<string | false>((resolve) => {
            const pending: Pending = { prompt, resolve };
            if (args.timeout && args.timeout > 0) {
                pending.timeoutHandle = setTimeout(() => {
                    this.respond(id, args.defaultAction ?? false);
                }, args.timeout * 1000);
            }
            this.setPending(pending);
        });
    }
}

export const confirmHub = new ConfirmHub();


