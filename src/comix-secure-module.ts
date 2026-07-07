/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import {
    AsyncFunction,
    DEFAULT_FETCH_TIMEOUT,
    DEFAULT_WAIT_TIMEOUT,
} from "./constants";
import { createElement, querySelectorWaitUntil } from "./document-extensions";
import { urlParamsToObject } from "./url-extensions";

export class ComixSecureModule {
    public static canvasToBlob = HTMLCanvasElement.prototype.toBlob;
    public static canvasContext2DGetImageData =
        CanvasRenderingContext2D.prototype.getImageData;

    private axios: AxiosInstance = axios.create();
    private descrambler: Function[] = [];

    public async initialize(): Promise<void> {
        const mainModuleElement =
            (await querySelectorWaitUntil<HTMLScriptElement>(
                'head > script[type="module"][src*="main"]',
                (element) => (element ? true : false),
                AbortSignal.timeout(DEFAULT_WAIT_TIMEOUT)
            ))!;

        const mainModuleURL = mainModuleElement.src;

        const mainModuleResponse = await fetch(mainModuleURL, {
            cache: "no-cache",
            signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
        });

        if (!mainModuleResponse.ok) {
            throw new Error(
                `Main module returned ${mainModuleResponse.status.toString()}: ${mainModuleResponse.statusText}`
            );
        }

        const mainModuleContents = await mainModuleResponse.text();
        const secureModuleFileSearch = /(secure-[A-Za-z0-9-_]+?\.js)/.exec(
            mainModuleContents
        );

        if (!secureModuleFileSearch) {
            throw new Error("Secure module not found");
        }

        const secureModuleUrl =
            mainModuleURL.substring(0, mainModuleURL.lastIndexOf("/") + 1) +
            secureModuleFileSearch[0];
        const moduleFunctions = (await import(secureModuleUrl)) as Record<
            string,
            unknown
        >;

        console.log("Found Secure Module:", moduleFunctions);

        let foundInterceptors = false;

        Object.values(moduleFunctions).forEach((fn) => {
            if (typeof fn !== "function") return;

            try {
                if (!foundInterceptors) {
                    if (fn.length >= 1 && !(fn instanceof AsyncFunction)) {
                        let foundRequest = false,
                            foundResponse = false;

                        fn({
                            interceptors: {
                                request: {
                                    use: () => {
                                        foundRequest = true;
                                    },
                                },
                                response: {
                                    use: () => {
                                        foundResponse = true;
                                    },
                                },
                            },
                        });

                        if (foundRequest && foundResponse) {
                            fn(this.axios);
                            foundInterceptors = true;
                        }
                    }
                }
            } catch {
                /* empty */
            }

            try {
                if (fn.length >= 1 && fn instanceof AsyncFunction) {
                    this.descrambler.push(fn);
                } else if (fn.length >= 1) {
                    const test = fn("about:blank") as unknown;

                    if (test instanceof Promise) {
                        test.catch(() => {
                            /* empty */
                        });
                        this.descrambler.push(fn);
                    }
                }
            } catch {
                /* empty */
            }
        });

        if (!foundInterceptors) {
            throw new Error("Unable to find interceptor function");
        } else if (this.descrambler.length === 0) {
            throw new Error("Unable to find descrambler function");
        }

        console.log(
            "Injected custom function completed. Now you can use them to do whatever you want."
        );
    }

    public async fetchJsonWithAxiosInterceptors(
        url: string,
        config?: AxiosRequestConfig
    ): Promise<unknown> {
        const inputUrl = new URL(url);

        return (
            await this.axios(`${inputUrl.origin}${inputUrl.pathname}`, {
                ...config,
                method: config?.method ?? "GET",
                params: urlParamsToObject(url),
            })
        ).data;
    }

    public async descrambleImage(
        url: string,
        canvas: HTMLCanvasElement,
        signal?: AbortSignal
    ): Promise<Blob> {
        for (const descramblerFunction of this.descrambler) {
            // This assume the api fetch and draw into the canvas directly.
            try {
                const output = await descramblerFunction(url, canvas, signal);

                if (output) {
                    throw new Error("Unknown scrambled mode");
                }
            } catch {
                /* empty */
            }

            // This assume the api fetch the image and return an object that you must handle.
            try {
                const output = await descramblerFunction(url, signal);

                async function handleBlob(
                    blob: Blob,
                    canvas: HTMLCanvasElement
                ): Promise<void> {
                    const image: HTMLImageElement = await new Promise(
                        (resolve, reject) => {
                            const image = new Image();
                            image.src = URL.createObjectURL(blob);
                            image.onload = () => {
                                resolve(image);
                            };
                            image.onerror = (_e, _s, _l, _c, error) => {
                                reject(error ?? new Error("Image load error"));
                            };
                        }
                    );

                    URL.revokeObjectURL(image.src);
                    const ctx = canvas.getContext("2d");
                    ctx?.drawImage(image, 0, 0);
                }

                if (output?.mode) {
                    if (output.mode === "blob") {
                        await handleBlob(output.blob, canvas);
                    } else if (output.mode === "canvas") {
                        output.apply(canvas);
                    } else {
                        throw new Error("Unknown scrambled mode");
                    }
                } else if (output?.apply) {
                    output.apply(canvas);
                } else if (output?.blob) {
                    await handleBlob(output.blob, canvas);
                } else if (typeof output === "function") {
                    output(canvas);
                } else if (output instanceof Blob) {
                    await handleBlob(output, canvas);
                } else {
                    throw new Error("Unknown scrambled mode");
                }
            } catch {
                /* empty */
            }
        }

        return await new Promise((resolve, reject) => {
            ComixSecureModule.canvasToBlob.call(canvas, (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(
                        new Error(
                            "Unable to create blob from the selected canvas"
                        )
                    );
                }
            });
        });
    }

    public async removeBanner(
        blob: Blob,
        width: number,
        height: number
    ): Promise<Blob> {
        const image: HTMLImageElement = await new Promise((resolve, reject) => {
            const image = new Image();
            image.src = URL.createObjectURL(blob);
            image.onload = () => {
                resolve(image);
            };
            image.onerror = (_e, _s, _l, _c, error) => {
                reject(error ?? new Error("Image load error"));
            };
        });

        URL.revokeObjectURL(image.src);
        const canvas = createElement("canvas", {
            width: width,
            height: height,
        });
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(image, 0, 0);

        const bannerHeight = Math.floor(width / 6);
        const colors = ComixSecureModule.canvasContext2DGetImageData.call(
            ctx,
            0,
            height - bannerHeight,
            width,
            bannerHeight
        );
        const pixels = [];
        const pattern = [24, 24, 24];

        for (let i = 0; i < colors.data.length; i += 4) {
            // We only care about RGB. Alpha can skip as it isn't really helpful.
            pixels.push([
                colors.data[i],
                colors.data[i + 1],
                colors.data[i + 2],
            ]);
        }

        let countMatch = 0;

        pixels.forEach((pixel) => {
            if (
                pixel[0] === pattern[0] &&
                pixel[1] === pattern[1] &&
                pixel[2] === pattern[2]
            ) {
                countMatch++;
            }
        });

        // console.log("Comix Pixel Check:", countMatch / pixels.length);

        if (countMatch / pixels.length >= 0.75) {
            // Most likely this is indeed comix banner
            canvas.height = canvas.height - Math.floor(canvas.width / 6);
            ctx?.drawImage(image, 0, 0);
        }

        return await new Promise((resolve, reject) => {
            ComixSecureModule.canvasToBlob.call(canvas, (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(
                        new Error(
                            "Unable to create blob from the selected canvas"
                        )
                    );
                }
            });
        });
    }
}
