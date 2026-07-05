import { createRoot } from "react-dom/client";
import { createElement } from "./document-extensions";
import { ComixDownloaderWindow } from "./downloader-ui/comix-downloader-window";
import type { ComixSecureModule } from "./comix-secure-module";
import {
    DEFAULT_FETCH_TIMEOUT,
    DEFAULT_MAX_RETRY,
    PAGE_DOWNLOAD_CONCURRENCY,
} from "./constants";
import { sanitizeFilename } from "./file-extensions";
import JSZip from "jszip";
import { runAllTasks } from "./task-extensions";

interface ComixChapterJson {
    items?: ComixChapterItem[];
    meta?: {
        from: number;
        hasNext: boolean;
        hasPrev: boolean;
        lastPage: number;
        page: number;
        perPage: number;
        to: number;
        total: number;
    };
}

interface ComixChapterItem {
    createdAtFormatted: string;
    creator?: {
        hashId: string;
        id: number;
        name: string;
        url: string;
        username: string;
    } | null;
    group?: { id: number; name: string } | null;
    groupId?: number | null;
    id: number;
    isOfficial: boolean;
    language: string;
    mangaId: number;
    name: string;
    number: number;
    url: string;
    volume: number;
    votes: number;
}

export class ComixChapter {
    private _id: number;
    private _volume: number;
    private _chapter: number;
    private _title: string;
    private _isOfficial: boolean;
    private _group: string | null;
    private _user: string | null;
    private _outputFileName: string;

    private module: ComixSecureModule;

    public constructor(module: ComixSecureModule, item: ComixChapterItem) {
        this.module = module;

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
        }

        if (item.creator?.name) {
            outputFileName += `[${item.creator.name}] `;
        }

        this._id = item.id;
        this._volume = item.volume;
        this._chapter = item.number;
        this._title = item.name;
        this._isOfficial = item.isOfficial;
        this._group = item.group?.name ?? (item.isOfficial ? "Official" : null);
        this._user = item.creator?.name ?? null;
        this._outputFileName = sanitizeFilename(`${outputFileName.trim()}.cbz`);
    }

    public get id(): number {
        return this._id;
    }

    public get volume(): number {
        return this._volume;
    }

    public get chapter(): number {
        return this._chapter;
    }

    public get title(): string {
        return this._title;
    }

    public get isOfficial(): boolean {
        return this._isOfficial;
    }

    public get group(): string | null {
        return this._group;
    }

    public get user(): string | null {
        return this._user;
    }

    public get outputFileName(): string {
        return this._outputFileName;
    }

    public createDownloadTask(
        progressCallback: ComixDownloadProgressCallback
    ): ComixDownloadTask {
        return new ComixDownloadTask(this.module, this, progressCallback);
    }
}

interface ComixChapterPageJson {
    pages: {
        items: ComixChapterPageItem[];
    };
}

interface ComixChapterPageItem {
    width: number;
    height: number;
    url: string;
    s?: number;
}

interface ComixDownloadProgress {
    done: number;
    total: number;
}

type ComixDownloadProgressCallback = (progress: ComixDownloadProgress) => void;

class ComixDownloadTask {
    private module: ComixSecureModule;
    private chapter: ComixChapter;
    private abortController: AbortController;

    private task: ComixPageDownloadTask[] = [];
    private done: number = 0;

    private progressCallback: ComixDownloadProgressCallback;

    public constructor(
        module: ComixSecureModule,
        chapter: ComixChapter,
        progressCallback: ComixDownloadProgressCallback
    ) {
        this.module = module;
        this.chapter = chapter;
        this.abortController = new AbortController();
        this.progressCallback = progressCallback;
    }

    public async start(): Promise<JSZip> {
        const json = (await this.module.fetchJsonWithAxiosInterceptors(
            `https://comix.to/api/v1/chapters/${this.chapter.id}`,
            {
                signal: AbortSignal.any([
                    AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
                    this.abortController.signal,
                ]),
            }
        )) as ComixChapterPageJson;

        const zip = new JSZip();

        json.pages.items.forEach((item, index) => {
            this.task.push(
                new ComixPageDownloadTask(
                    this.module,
                    item,
                    index,
                    zip,
                    this.abortController.signal,
                    () => {
                        this.done++;
                        this.progressCallback({
                            done: this.done,
                            total: this.task.length,
                        });
                    }
                )
            );
        });

        await runAllTasks(
            this.task.map((t) => () => t.start()),
            PAGE_DOWNLOAD_CONCURRENCY
        );

        return zip;
    }

    public stop() {
        this.abortController.abort();
    }
}

class ComixPageDownloadTask {
    private module: ComixSecureModule;
    private item: ComixChapterPageItem;
    private index: number;
    private targetZipFile: JSZip;
    private signal: AbortSignal;
    private doneCallback: Function;

    private retry: number = 0;

    public constructor(
        module: ComixSecureModule,
        item: ComixChapterPageItem,
        index: number,
        targetZipFile: JSZip,
        signal: AbortSignal,
        doneCallback: Function
    ) {
        this.module = module;
        this.item = item;
        this.index = index;
        this.targetZipFile = targetZipFile;
        this.signal = signal;
        this.doneCallback = doneCallback;
    }

    public async start(): Promise<void> {
        do {
            try {
                if (this.item.s) {
                    const canvas = document.createElement("canvas");
                    canvas.width = this.item.width;
                    canvas.height = this.item.height;

                    const data = await this.module.descrambleImage(
                        this.item.url,
                        canvas,
                        AbortSignal.any([
                            AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
                            this.signal,
                        ])
                    );

                    const outputFileName = `${String(this.index).padStart(3, "0")}.png`;
                    this.targetZipFile.file(
                        outputFileName,
                        data.split(",")[1],
                        { base64: true }
                    );
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

                    const blob = await response.blob();
                    const outputFileName = `${String(this.index).padStart(3, "0")}.webp`;
                    this.targetZipFile.file(outputFileName, blob);
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

    private module: ComixSecureModule;
    private overlay: HTMLElement | null = null;

    public constructor(module: ComixSecureModule) {
        this.module = module;
    }

    public show() {
        this.createUI();
    }

    public close() {
        if (!this.overlay) return;

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
            const comixChapterList: ComixChapterJson | null =
                (await this.module.fetchJsonWithAxiosInterceptors(
                    `https://comix.to/api/v1/manga/${mangaId}/chapters?page=${page}&limit=100&order[number]=desc`
                )) as ComixChapterJson;

            console.log(comixChapterList);

            comixChapterList?.items?.forEach((item) => {
                chapterList.push(new ComixChapter(this.module, item));
            });

            page += 1;
            hasMoreChapters = comixChapterList?.meta?.hasNext ?? false;
        } while (hasMoreChapters);

        return chapterList;
    }

    private createUI() {
        if (this.overlay) return;

        document.body.append(
            createElement("div", {
                id: "comix-downloader-overlay",
            })
        );

        this.overlay = document.getElementById("comix-downloader-overlay");

        const root = createRoot(this.overlay!);
        root.render(<ComixDownloaderWindow downloader={this} />);
    }
}
