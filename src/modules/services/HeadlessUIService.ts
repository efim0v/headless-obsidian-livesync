import { UIService } from "../../lib/src/services/Services";
import type { SvelteDialogManagerBase } from "../../lib/src/UI/svelteDialog";
import { confirmHub } from "../../headless/confirm/confirmHub";

export class HeadlessUIService extends UIService {
    // Headless daemon cannot render arbitrary Svelte dialogs server-side.
    // We provide a minimal dialogManager to satisfy type contracts and fail with a clear message if used.
    private readonly _dialogManager: SvelteDialogManagerBase = {
        open: async () => {
            throw new Error("HeadlessUIService.dialogManager.open is not supported in daemon mode. Use confirm prompts.");
        },
        openWithExplicitCancel: async () => {
            throw new Error(
                "HeadlessUIService.dialogManager.openWithExplicitCancel is not supported in daemon mode. Use confirm prompts."
            );
        },
    };

    override get dialogManager(): SvelteDialogManagerBase {
        return this._dialogManager;
    }

    async promptCopyToClipboard(_title: string, _value: string): Promise<boolean> {
        // Best-effort: show the value in a markdown-capable dialog so user can copy manually.
        // (Copy-to-clipboard is browser responsibility; daemon can't access it.)
        await this.showMarkdownDialog(_title, `\`\`\`\n${_value}\n\`\`\``, ["OK"]);
        return true;
    }

    async showMarkdownDialog<T extends string[]>(
        title: string,
        contentMD: string,
        buttons: T
    ): Promise<(typeof buttons)[number] | false> {
        const defaultAction = buttons[0];
        const ret = await confirmHub.promptConfirmWithMessage({
            title,
            contentMd: contentMD,
            buttons: [...buttons],
            defaultAction,
            timeout: 0,
        });
        // confirmHub returns string|false, but we want to narrow to one of the provided buttons.
        if (ret === false) return false;
        if ((buttons as readonly string[]).includes(ret)) return ret as any;
        return false;
    }
}


