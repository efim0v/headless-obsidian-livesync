import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../headless/HeadlessTypes";
import type { Confirm } from "../../lib/src/interfaces/Confirm";
import { setConfirmInstance } from "../../lib/src/PlatformAPIs/Confirm";
import { confirmHub } from "../../headless/confirm/confirmHub";
import { $msg } from "../../lib/src/common/i18n";

export class ModuleHeadlessConfirm extends AbstractModule implements Confirm {
    private _everyOnload(): Promise<boolean> {
        this.core.confirm = this;
        setConfirmInstance(this);
        return Promise.resolve(true);
    }

    askYesNo(message: string): Promise<"yes" | "no"> {
        return this.askYesNoDialog(message, { title: $msg("moduleInputUIObsidian.defaultTitleConfirmation") });
    }

    askString(title: string, key: string, placeholder: string, isPassword: boolean = false): Promise<string | false> {
        return confirmHub.promptString({ title, key, placeholder, isPassword });
    }

    askYesNoDialog(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number } = { title: "Confirmation" }
    ): Promise<"yes" | "no"> {
        const yesLabel = $msg("moduleInputUIObsidian.optionYes");
        const noLabel = $msg("moduleInputUIObsidian.optionNo");
        return confirmHub.promptYesNo(message, opt, { yes: yesLabel, no: noLabel });
    }

    askSelectString(message: string, items: string[]): Promise<string> {
        return confirmHub.promptSelect(message, items as unknown as readonly string[], {
            defaultAction: items[0],
            timeout: 0,
        }) as Promise<string>;
    }

    askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        return confirmHub.promptSelect(message, buttons, opt);
    }

    askInPopup(_key: string, _dialogText: string, _anchorCallback: (anchor: HTMLAnchorElement) => void): void {
        // Not supported in headless UI (no anchor popups). Ignore.
        return;
    }

    confirmWithMessage(
        title: string,
        contentMd: string,
        buttons: string[],
        defaultAction: (typeof buttons)[number],
        timeout?: number
    ): Promise<(typeof buttons)[number] | false> {
        return confirmHub.promptConfirmWithMessage({
            title,
            contentMd,
            buttons,
            defaultAction,
            timeout,
        }) as Promise<(typeof buttons)[number] | false>;
    }

    onBindFunction(core: LiveSyncCore, services: any): void {
        services.appLifecycle.handleOnLoaded(this._everyOnload.bind(this));
    }
}


