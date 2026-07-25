import { createRoot } from "react-dom/client";
import { ComixDownloaderWindow } from "./downloader-ui/comix-downloader-window";
import type {
    ComixChapterItem,
    ComixChapterPageItem,
} from "./comix-api-model";
import {
    DEFAULT_FETCH_TIMEOUT,
    DEFAULT_MAX_RETRY,
    PAGE_DOWNLOAD_CONCURRENCY,
} from "./constants";
import { createElement } from "./document-extensions";
import { sanitizeFilename } from "./file-extensions";
import { runAllTasks } from "./task-extensions";
import type { ComixApi } from "./comix-api";
import { BlobReader, ZipWriter } from "@zip.js/zip.js";

export class ComixChapter {
    private _group: string | null;
    private _outputFileName: string;

    private readonly api: ComixApi;
    private readonly item: ComixChapterItem;

    public constructor(api: ComixApi, item: ComixChapterItem) {
        this.api = api;
        this.item = item;

        let outputFileName = "";

        if (item.volume > 0) {
            outputFileName += `Vol. ${String(item.volume).padStart(3, "0")} `;
        }

        if (item.number != null) {
            outputFileName += `Chapter ${String(item.number).padStart(3, "0")} `;
        }

        if (item.name) {
            outputFileName += `- ${item.name} `;
        }

        if (item.group?.name) {
            outputFileName += `[${item.group.name}] `;
        } else if (item.isOfficial) {
            outputFileName += "[Official] ";
        } else if (item.creator?.name) {
            outputFileName += `[${item.creator.name}] `;
        }

        this._group =
            item.group?.name ??
            (item.isOfficial ? "Official" : null) ??
            item.creator?.name ??
            null;
        this._outputFileName = sanitizeFilename(`${outputFileName.trim()}.cbz`);
    }

    public get id(): number {
        return this.item.id;
    }

    public get volume(): number {
        return this.item.volume;
    }

    public get chapter(): number {
        return this.item.number;
    }

    public get title(): string {
        return this.item.name;
    }

    public get isOfficial(): boolean {
        return this.item.isOfficial;
    }

    public get group(): string | null {
        return this._group;
    }

    public get outputFileName(): string {
        return this._outputFileName;
    }

    public createDownloadTask(
        signal: AbortSignal,
        progressCallback: ComixDownloadProgressCallback
    ): ComixDownloadTask {
        return new ComixDownloadTask(
            this.api,
            this,
            signal,
            progressCallback
        );
    }
}

interface ComixDownloadProgress {
    done: number;
    total: number;
    isZipped: boolean;
}

type ComixDownloadProgressCallback = (progress: ComixDownloadProgress) => void;

export class ComixDownloadTask {
    private readonly api: ComixApi;
    private chapter: ComixChapter;
    private signal: AbortSignal;

    private task: ComixPageDownloadTask[] = [];
    private done: number = 0;

    private progressCallback: ComixDownloadProgressCallback;

    public constructor(
        api: ComixApi,
        chapter: ComixChapter,
        signal: AbortSignal,
        progressCallback: ComixDownloadProgressCallback
    ) {
        this.api = api;
        this.chapter = chapter;
        this.signal = signal;
        this.progressCallback = progressCallback;
    }

    public async start(): Promise<FileSystemFileHandle> {
        this.signal.throwIfAborted();

        const json = await this.api.getChapterPages(this.chapter.id, AbortSignal.any([
            AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
            this.signal,
        ]));

        const opfsDirectory = await navigator.storage.getDirectory();
        const fileHandle = await opfsDirectory.getFileHandle(this.chapter.outputFileName, {
            create: true
        });
        const writableFileStream = await fileHandle.createWritable({ keepExistingData: false });
        const zipWriter = new ZipWriter<FileSystemWritableFileStream>(writableFileStream, {
            compressionMethod: 8,
            level: 9,
        });

        json.pages.items.forEach((item, index, array) => {
            this.task.push(
                new ComixPageDownloadTask(
                    this.api,
                    item,
                    index,
                    index + 1 == array.length,
                    zipWriter,
                    this.signal,
                    () => {
                        this.progressCallback({
                            done: ++this.done,
                            total: this.task.length,
                            isZipped: false,
                        });
                    }
                )
            );
        });

        this.progressCallback({ done: 0, total: this.task.length, isZipped: false });

        await runAllTasks(
            this.task.map((t) => () => t.start()),
            PAGE_DOWNLOAD_CONCURRENCY
        );

        await zipWriter.close();

        this.progressCallback({ done: this.done, total: this.task.length, isZipped: true });

        return fileHandle;
    }
}

class ComixPageDownloadTask {
    private readonly api: ComixApi;
    private readonly item: ComixChapterPageItem;
    private readonly index: number;
    private readonly isLast: boolean;
    private readonly zipWriter: ZipWriter<FileSystemWritableFileStream>;
    private readonly signal: AbortSignal;
    private readonly doneCallback: Function;

    private retry: number = 0;

    public constructor(
        api: ComixApi,
        item: ComixChapterPageItem,
        index: number,
        isLast: boolean,
        zipWriter: ZipWriter<FileSystemWritableFileStream>,
        signal: AbortSignal,
        doneCallback: Function
    ) {
        this.api = api;
        this.item = item;
        this.index = index;
        this.isLast = isLast;
        this.zipWriter = zipWriter;
        this.signal = signal;
        this.doneCallback = doneCallback;
    }

    public async start(): Promise<void> {
        do {
            this.signal.throwIfAborted();

            try {
                if (this.item.s) {
                    // Scrambled Pages
                    const canvas = document.createElement("canvas");
                    canvas.width = this.item.width;
                    canvas.height = this.item.height;

                    const data = await this.api.descrambleImage(
                        this.item.url,
                        canvas,
                        AbortSignal.any([
                            AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
                            this.signal,
                        ])
                    );

                    const outputFileName = `${String(this.index).padStart(3, "0")}.png`;
                    await this.zipWriter.add(outputFileName, new BlobReader(data));
                } else {
                    // Unscrambled Pages
                    const response = await fetch(this.item.url, {
                        signal: AbortSignal.any([
                            AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
                            this.signal,
                        ]),
                    });

                    if (!response.ok) {
                        throw new Error(
                            `Response returned ${response.status}: ${response.statusText}`
                        );
                    }

                    let blob = await response.blob();

                    if (this.isLast) {
                        blob = await this.api.removeBanner(blob, this.item.width, this.item.height);
                    }

                    const outputFileName = `${String(this.index).padStart(3, "0")}.png`;
                    await this.zipWriter.add(outputFileName, new BlobReader(blob));
                }

                this.doneCallback();
                return;
            } catch {
                this.retry++;
            }
        } while (this.retry < DEFAULT_MAX_RETRY);

        throw new Error(`Max retry reached when downloading an image`);
    }
}

export class ComixDownloader {
    static {
        GM_addStyle(
            "#comix-downloader-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; justify-content: center; align-items: center; z-index: 9999; }"
        );
        GM_addStyle(
            "#comix-downloader-window { width: 75%; max-height: 75vh; overflow: auto; color: white; background: #333; border-radius: 10px; box-shadow: 0 15px 40px rgba(0, 0, 0, 0.35); padding: 1rem; position: relative; }"
        );
    }

    private readonly api: ComixApi;
    private abortController: AbortController | null = null;
    private overlay: HTMLElement | null = null;

    public get signal(): AbortSignal {
        if (!this.abortController) throw new Error("Abort Controller does not exist...");
        return this.abortController.signal;
    }

    public constructor(api: ComixApi) {
        this.api = api;
    }

    public show() {
        if (this.overlay) return;

        this.abortController = new AbortController();

        document.body.append(
            createElement("div", {
                id: "comix-downloader-overlay",
            })
        );

        this.overlay = document.getElementById("comix-downloader-overlay")!;

        const root = createRoot(this.overlay);
        root.render(<ComixDownloaderWindow downloader={this} />);
    }

    public close() {
        if (!this.overlay) return;

        this.abortController?.abort();

        document.body.removeChild(this.overlay);

        this.overlay = null;
    }

    public async fetchChapterList(): Promise<ComixChapter[]> {
        const mangaId = document.URL.replace(
            "https://comix.to/title/",
            ""
        ).split("-")[0]!;
        const chapterList: ComixChapter[] = [];

        let hasMoreChapters = true;
        let page = 1;

        do {
            const json = await this.api.getChapterList(mangaId, page);

            console.log(json);

            json.items.forEach((item) => {
                chapterList.push(new ComixChapter(this.api, item));
            });

            page += 1;
            hasMoreChapters = json.meta.hasNext ?? false;
        } while (hasMoreChapters);

        return chapterList;
    }
}
