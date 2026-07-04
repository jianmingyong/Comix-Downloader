import { ComixDownloader } from "./comix-downloader";
import { ComixSecureModule } from "./comix-secure-module";
import { DEFAULT_WAIT_TIMEOUT } from "./constants";
import { createElement, querySelectorWaitUntil } from "./document-extensions";

async function main(): Promise<void> {
    let currentPath: string | null = null;

    function urlChanged() {
        if (location.pathname === currentPath) return;
        currentPath = location.pathname;

        if (location.pathname.startsWith("/title/")) {
            inject().catch((error) => { console.log(error) });
        }
    }

    for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method];

        history[method] = function (...args: Parameters<typeof original>) {
            const result = original.apply(this, args);
            queueMicrotask(urlChanged);
            return result;
        };
    }

    const module = new ComixSecureModule();
    await module.initialize();

    GM_addElement("script", {
        src: "https://kit.fontawesome.com/e5e217aee3.js",
        crossorigin: "anonymous"
    });

    GM_addElement("script", {
        src: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
        crossorigin: "anonymous"
    });

    urlChanged();
    addEventListener("popstate", () => queueMicrotask(urlChanged));

    async function inject(): Promise<void> {
        const rateElement = (await querySelectorWaitUntil<HTMLDivElement>(
            "div.mpage__poster-actions",
            (element) => element ? (element.querySelector("div.mpage__rate-stack") ? true : false) : false,
            AbortSignal.timeout(DEFAULT_WAIT_TIMEOUT)
        ))!;

        rateElement.insertBefore(createElement("button", {
            type: "button",
            class: ["btn", "btn--soft"],
            title: "Download",
            onclick: () => {
                const downloader = new ComixDownloader(module);
                downloader.show();
            },
            children: [
                createElement("i", {
                    class: ["fa-solid", "fa-download"]
                }),
                createElement("span", {
                    textContent: "Download"
                })
            ]
        }), rateElement.querySelector("div.mpage__rate-stack"));
    }
}

main().catch((error) => console.log(error));