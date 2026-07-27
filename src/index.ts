import { ComixApi } from "./comix-api";
import { ComixDownloader } from "./comix-downloader";
import { ComixSecureModule } from "./comix-secure-module";
import { DEFAULT_WAIT_TIMEOUT } from "./constants";
import { createElement, querySelectorWaitUntil } from "./document-extensions";

async function main(): Promise<void> {
    let currentPath: string;

    function urlChanged() {
        if (location.pathname === currentPath) return;
        currentPath = location.pathname;

        if (location.pathname.startsWith("/title/")) {
            inject().catch((error) => {
                console.log(error);
            });
        }
    }

    for (const method of ["pushState", "replaceState"] as const) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
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
        crossorigin: "anonymous",
    });

    urlChanged();
    addEventListener("popstate", () => queueMicrotask(urlChanged));

    async function inject(): Promise<void> {
        const rateElement = (await querySelectorWaitUntil<HTMLDivElement>(
            "div.mpage__poster-actions",
            (element) =>
                element
                    ? element.querySelector("div.mpage__rate-stack")
                        ? true
                        : false
                    : false,
            AbortSignal.timeout(DEFAULT_WAIT_TIMEOUT)
        ))!;

        if (!document.querySelector("#comix-downloader-download-btn")) {
            rateElement.insertBefore(
                createElement("button", {
                    id: "comix-downloader-download-btn",
                    type: "button",
                    class: ["btn", "btn--soft"],
                    title: "Download",
                    onclick: () => {
                        const downloader = new ComixDownloader(
                            new ComixApi(module)
                        );
                        downloader.show();
                    },
                    children: [
                        createElement("i", {
                            class: ["fa-solid", "fa-download"],
                        }),
                        createElement("span", {
                            textContent: "Download",
                        }),
                    ],
                }),
                rateElement.querySelector("div.mpage__rate-stack")
            );
        }
    }
}

main.bind(unsafeWindow)().catch((error) => console.log(error));
