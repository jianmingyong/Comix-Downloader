import type { ComixChapterJson, ComixChapterPageJson } from "./comix-api-model";
import type { ComixSecureModule } from "./comix-secure-module";
import { DEFAULT_FETCH_TIMEOUT } from "./constants";

export class ComixApi {
    private readonly module: ComixSecureModule;

    public constructor(module: ComixSecureModule) {
        this.module = module;
    }

    public getChapterList(
        id: string,
        page: number,
        signal?: AbortSignal
    ): Promise<ComixChapterJson> {
        return this.module.fetchJsonWithAxiosInterceptors(
            `https://comix.to/api/v1/manga/${id}/chapters?page=${page}&limit=100&order[number]=desc`,
            { signal: signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT) }
        );
    }

    public getChapterPages(
        id: number,
        signal?: AbortSignal
    ): Promise<ComixChapterPageJson> {
        return this.module.fetchJsonWithAxiosInterceptors(
            `https://comix.to/api/v1/chapters/${id}`,
            { signal: signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT) }
        );
    }

    public descrambleImage(
        url: string,
        canvas: HTMLCanvasElement,
        signal?: AbortSignal
    ): Promise<Blob> {
        return this.module.descrambleImage(url, canvas, signal);
    }

    public removeBanner(
        blob: Blob,
        width: number,
        height: number
    ): Promise<Blob> {
        return this.module.removeBanner(blob, width, height);
    }
}
