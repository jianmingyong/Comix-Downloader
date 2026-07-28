import { createRoot } from "react-dom/client";
import { ComixDownloaderWindow } from "./comix-downloader-window";
import { createElement } from "./document-extensions";
import type { ComixApi } from "./comix-api";

export class ComixDownloader {
    static {
        GM_addStyle(
            "#comix-downloader-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; justify-content: center; align-items: center; z-index: 9999; }"
        );
        GM_addStyle(
            "#comix-downloader-window { width: 75%; height: 80vh; max-height: 80vh; overflow: auto; color: white; background: #333; border-radius: 10px; box-shadow: 0 15px 40px rgba(0, 0, 0, 0.35); padding: 1rem; position: relative; }"
        );
        GM_addStyle(
            "progress.comix-downloader-progress-error { accent-color: red; }"
        );
    }

    private readonly api: ComixApi;

    public constructor(api: ComixApi) {
        this.api = api;
    }

    public show() {
        if (document.getElementById("comix-downloader-overlay")) return;

        document.body.append(
            createElement("div", {
                id: "comix-downloader-overlay",
            })
        );

        const overlay = document.getElementById("comix-downloader-overlay");
        if (!overlay) throw new Error(`Overlay does not exists`);

        const abortController = new AbortController();

        const root = createRoot(overlay);
        root.render(
            <ComixDownloaderWindow
                api={this.api}
                signal={abortController.signal}
                onClose={onClose}
            />
        );

        function onClose() {
            if (!overlay) throw new Error(`Overlay does not exists`);
            abortController.abort();
            root.unmount();
            document.body.removeChild(overlay);
        }
    }
}
