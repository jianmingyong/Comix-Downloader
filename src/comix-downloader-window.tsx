import { useEffect, useMemo, useState } from "react";
import { runAllTasks, type ITask } from "./task-extensions";
import { DEFAULT_FETCH_TIMEOUT, DEFAULT_MAX_RETRY } from "./constants";
import {
    resolveFileExtensions,
    sanitizeFilename,
    saveAs,
} from "./file-extensions";
import { BlobReader, ZipWriter } from "@zip.js/zip.js";
import type { ComixApi } from "./comix-api";
import type { ComixChapterItem, ComixChapterPageItem } from "./comix-api-model";
import { cleanUpOPFS, getOPFSFileHandle } from "./storage-extensions";

interface ChapterRange {
    min: number;
    max: number;
}

interface Progress {
    done: number;
    total: number;
    isError: boolean;
}

type ComixDownloadProgressCallback = (progress: Progress) => void;

class ComixChapter {
    private readonly item: ComixChapterItem;

    private readonly _group: string | null;
    private readonly _outputFileName: string;

    public constructor(item: ComixChapterItem) {
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

    public get group(): string | null {
        return this._group;
    }

    public get outputFileName(): string {
        return this._outputFileName;
    }
}

class ComixDownloadTask implements ITask<FileSystemFileHandle> {
    private readonly api: ComixApi;
    private readonly chapter: ComixChapter;
    private readonly pageDownloadConcurrency: number;

    private tasks: ComixPageDownloadTask[] = [];
    private done: number = 0;

    private progressCallback: ComixDownloadProgressCallback;

    public constructor(
        api: ComixApi,
        chapter: ComixChapter,
        pageDownloadConcurrency: number,
        progressCallback: ComixDownloadProgressCallback
    ) {
        this.api = api;
        this.chapter = chapter;
        this.pageDownloadConcurrency = pageDownloadConcurrency;
        this.progressCallback = progressCallback;
    }

    public async start(signal?: AbortSignal): Promise<FileSystemFileHandle> {
        signal?.throwIfAborted();

        const abortSignal = signal
            ? AbortSignal.any([
                  AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
                  signal,
              ])
            : AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT);

        const json = await this.api.getChapterPages(
            this.chapter.id,
            abortSignal
        );

        const fileHandle = await getOPFSFileHandle(this.chapter.outputFileName);
        const writableFileStream = await fileHandle.createWritable({
            keepExistingData: false,
        });
        const zipWriter = new ZipWriter<FileSystemWritableFileStream>(
            writableFileStream,
            {
                compressionMethod: 8,
                level: 9,
            }
        );

        json.pages.items.forEach((item, index, array) => {
            this.tasks.push(
                new ComixPageDownloadTask(
                    this.api,
                    item,
                    index,
                    index + 1 == array.length,
                    zipWriter,
                    () => {
                        this.progressCallback({
                            done: ++this.done,
                            total: this.tasks.length,
                            isError: false,
                        });
                    }
                )
            );
        });

        this.progressCallback({
            done: 0,
            total: this.tasks.length,
            isError: false,
        });

        try {
            await runAllTasks(this.tasks, this.pageDownloadConcurrency, signal);
            await zipWriter.close();
        } catch (error) {
            this.progressCallback({
                done: this.tasks.length,
                total: this.tasks.length,
                isError: true,
            });

            throw error;
        }

        return fileHandle;
    }
}

class ComixPageDownloadTask implements ITask<void> {
    private readonly api: ComixApi;
    private readonly item: ComixChapterPageItem;
    private readonly index: number;
    private readonly isLast: boolean;
    private readonly zipWriter: ZipWriter<FileSystemWritableFileStream>;
    private readonly doneCallback: Function;

    private retry: number = 0;

    public constructor(
        api: ComixApi,
        item: ComixChapterPageItem,
        index: number,
        isLast: boolean,
        zipWriter: ZipWriter<FileSystemWritableFileStream>,
        doneCallback: Function
    ) {
        this.api = api;
        this.item = item;
        this.index = index;
        this.isLast = isLast;
        this.zipWriter = zipWriter;
        this.doneCallback = doneCallback;
    }

    public async start(signal?: AbortSignal): Promise<void> {
        do {
            signal?.throwIfAborted();

            try {
                const abortSignal = signal
                    ? AbortSignal.any([
                          AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT),
                          signal,
                      ])
                    : AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT);

                if (this.item.s) {
                    // Scrambled Pages
                    const canvas = document.createElement("canvas");
                    canvas.width = this.item.width;
                    canvas.height = this.item.height;

                    let data = await this.api.descrambleImage(
                        this.item.url,
                        canvas,
                        abortSignal
                    );

                    if (this.isLast) {
                        data = await this.api.removeBanner(
                            data,
                            this.item.width,
                            this.item.height
                        );
                    }

                    const outputFileName = `${String(this.index).padStart(3, "0")}.png`;
                    await this.zipWriter.add(
                        outputFileName,
                        new BlobReader(data)
                    );
                } else {
                    // Unscrambled Pages
                    const response = await fetch(this.item.url, {
                        signal: abortSignal,
                    });

                    if (!response.ok) {
                        throw new Error(
                            `Response returned ${response.status}: ${response.statusText}`
                        );
                    }

                    let blob = await response.blob();
                    let fileExtensions = resolveFileExtensions(
                        response.headers.get("content-type") ?? ""
                    );

                    if (this.isLast) {
                        blob = await this.api.removeBanner(
                            blob,
                            this.item.width,
                            this.item.height
                        );
                        fileExtensions = "png";
                    }

                    const outputFileName = `${String(this.index).padStart(3, "0")}.${fileExtensions}`;
                    await this.zipWriter.add(
                        outputFileName,
                        new BlobReader(blob)
                    );
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

function useComixChapterList(api: ComixApi) {
    const [chapterList, setChapterList] = useState<ComixChapter[]>();

    useEffect(() => {
        async function getChapterList(): Promise<ComixChapter[]> {
            const mangaId = document.URL.replace(
                "https://comix.to/title/",
                ""
            ).split("-")[0]!;

            const chapterList: ComixChapter[] = [];

            let hasMoreChapters = true;
            let page = 1;

            do {
                const json = await api.getChapterList(mangaId, page);
                console.log(json);

                json.items.forEach((item) => {
                    chapterList.push(new ComixChapter(item));
                });

                page += 1;
                hasMoreChapters = json.meta.hasNext ?? false;
            } while (hasMoreChapters);

            return chapterList;
        }

        getChapterList().then(
            (list) => setChapterList(list),
            (error) => console.log(error)
        );
    }, [api]);

    return chapterList;
}

function createComixDownloadTask(
    api: ComixApi,
    chapter: ComixChapter,
    pageDownloadConcurrency: number,
    progressCallback: ComixDownloadProgressCallback
) {
    return new ComixDownloadTask(
        api,
        chapter,
        pageDownloadConcurrency,
        progressCallback
    );
}

export function ComixDownloaderWindow({
    api,
    signal,
    onClose,
}: {
    api: ComixApi;
    signal: AbortSignal;
    onClose: () => void;
}) {
    const chapterList = useComixChapterList(api);

    const [selectedGroups, setSelectedGroups] = useState(new Set<string>());
    const [selectedChapterRange, setSelectedChapterRange] =
        useState<ChapterRange>({ min: 0, max: 0 });

    const { groups, minChapterValue, maxChapterValue } = useMemo(() => {
        if (!chapterList) {
            return {
                groups: null,
                minChapterValue: null,
                maxChapterValue: null,
            };
        } else {
            const groups = new Set<string>();

            chapterList.forEach((chapter) => {
                if (chapter.group) {
                    groups.add(chapter.group);
                }
            });

            const min = Math.min(...chapterList.map((v) => v.chapter));
            const max = Math.max(...chapterList.map((v) => v.chapter));

            setSelectedChapterRange({ min: min, max: max });

            return {
                groups: Array.from(groups).sort(),
                minChapterValue: min,
                maxChapterValue: max,
            };
        }
    }, [chapterList]);

    const [pageDownloadConcurrecy, setPageDownloadConcurrency] = useState(
        GM_getValue(
            "ComixDownloaderPageDownloadConcurrency",
            navigator.hardwareConcurrency
        )
    );

    useEffect(() => {
        GM_setValue(
            "ComixDownloaderPageDownloadConcurrency",
            pageDownloadConcurrecy
        );
    }, [pageDownloadConcurrecy]);

    const [isDownloading, setIsDownloading] = useState(false);

    const chaptersToDownload = useMemo(() => {
        if (!chapterList) {
            return null;
        } else {
            return chapterList.filter(
                (chapter) =>
                    (chapter.group
                        ? selectedGroups.has(chapter.group)
                        : false) &&
                    chapter.chapter >= selectedChapterRange.min &&
                    chapter.chapter <= selectedChapterRange.max
            );
        }
    }, [chapterList, selectedGroups, selectedChapterRange]);

    const [progress, setProgress] = useState<Record<number, Progress>>({});

    const globalProgress = useMemo(() => {
        return Object.values(progress).reduce(
            (prev, curr) => {
                return {
                    done:
                        prev.done +
                        (curr.total > 0 && curr.done === curr.total ? 1 : 0),
                    total: prev.total + 1,
                };
            },
            { done: 0, total: 0 }
        );
    }, [progress]);

    function onclickDownload() {
        async function onClickDownloadAsync() {
            setIsDownloading(true);

            const tasks: ComixDownloadTask[] = [];
            const progress: Record<number, Progress> = {};

            chaptersToDownload?.forEach((chapter) => {
                const id = chapter.id;
                progress[id] = { done: 0, total: 0, isError: false };

                tasks.push(
                    createComixDownloadTask(
                        api,
                        chapter,
                        pageDownloadConcurrecy,
                        (progress) => {
                            setProgress((prev) => {
                                return {
                                    ...prev,
                                    [id]: {
                                        done: progress.done,
                                        total: progress.total,
                                        isError: progress.isError,
                                    },
                                };
                            });
                        }
                    )
                );
            });

            setProgress(progress);

            let estimateFileSize = 0;
            let maxFileSize = Math.min(2 * 1024 * 1024 * 1024);
            let fileHandles: FileSystemFileHandle[] = [];
            let part = 1;

            for (const task of tasks) {
                try {
                    const fileHandle = await task.start(signal);
                    const file = await fileHandle.getFile();
                    estimateFileSize += file.size;
                    fileHandles.push(fileHandle);

                    if (estimateFileSize >= maxFileSize) {
                        await createDownloadFile(fileHandles, part++);
                        fileHandles = [];
                        estimateFileSize = 0;
                    }
                } catch (error) {
                    // Error downloading that file for some reason...
                    // We skip that.
                }
            }

            if (fileHandles.length > 0) {
                if (part === 1) {
                    await createDownloadFile(fileHandles);
                } else {
                    await createDownloadFile(fileHandles, part);
                }
            }

            async function createDownloadFile(
                fileHandles: FileSystemFileHandle[],
                part?: number
            ) {
                const title =
                    document.querySelector("h1.mpage__title")?.textContent;
                let fileHandle = await getOPFSFileHandle(
                    part ? `${title} Part ${part}.zip` : `${title}.zip`
                );
                let writableFileStream = await fileHandle.createWritable({
                    keepExistingData: false,
                });
                let zipWriter = new ZipWriter<FileSystemWritableFileStream>(
                    writableFileStream,
                    {
                        compressionMethod: 8,
                        level: 9,
                    }
                );

                for (const fileHandle of fileHandles) {
                    const file = await fileHandle.getFile();
                    await zipWriter.add(fileHandle.name, file.stream());
                }

                await zipWriter.close();

                const file = await fileHandle.getFile();
                saveAs(fileHandle.name, file);

                const opfsDirectory = await navigator.storage.getDirectory();

                for (const fileHandle of fileHandles) {
                    await opfsDirectory.removeEntry(fileHandle.name);
                }

                await opfsDirectory.removeEntry(fileHandle.name);
            }
        }

        onClickDownloadAsync()
            .catch(console.log)
            .finally(() => {
                cleanUpOPFS().catch(console.log);
                setIsDownloading(false);
            });
    }

    return (
        <div id="comix-downloader-window">
            <div>
                <span style={{ fontSize: "1.5rem" }}>Comix Downloader</span>
                <button
                    style={{ position: "absolute", top: "1rem", right: "1rem" }}
                    onClick={onClose}
                >
                    ✕
                </button>
            </div>
            <section style={{ marginTop: "1rem" }}>
                <fieldset>
                    <legend>Group(s) Selection:</legend>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: "1rem",
                        }}
                    >
                        {groups?.map((group, index) => (
                            <div
                                key={`comix-downloader-group-${group}`}
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    flexWrap: "nowrap",
                                    justifyContent: "center",
                                    alignItems: "center",
                                }}
                            >
                                <input
                                    id={`comix-downloader-group-${index}`}
                                    type={"checkbox"}
                                    value={group}
                                    disabled={isDownloading}
                                    onChange={(event) => {
                                        setSelectedGroups((prev) => {
                                            const newSet = new Set(prev);
                                            if (event.target.checked) {
                                                newSet.add(group);
                                            } else {
                                                newSet.delete(group);
                                            }
                                            return newSet;
                                        });
                                    }}
                                />
                                <label
                                    htmlFor={`comix-downloader-group-${index}`}
                                    style={{ userSelect: "none" }}
                                >
                                    {group}
                                </label>
                            </div>
                        )) ?? <span>Loading...</span>}
                    </div>
                </fieldset>
            </section>
            <section style={{ marginTop: "1rem" }}>
                <fieldset>
                    <legend>Chapter Range Selection:</legend>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: "1rem",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                flexWrap: "nowrap",
                                gap: "1rem",
                            }}
                        >
                            <label htmlFor={"comix-downloader-chapter-from"}>
                                From:
                            </label>
                            <input
                                id={"comix-downloader-chapter-from"}
                                type={"number"}
                                min={minChapterValue ?? 0}
                                max={maxChapterValue ?? 0}
                                value={selectedChapterRange.min}
                                disabled={
                                    minChapterValue == null ||
                                    maxChapterValue == null ||
                                    isDownloading
                                }
                                style={{ width: "100px" }}
                                onChange={(event) => {
                                    setSelectedChapterRange((prev) => {
                                        return {
                                            ...prev,
                                            min: Math.max(
                                                Math.min(
                                                    prev.max,
                                                    event.target.valueAsNumber
                                                ),
                                                minChapterValue!
                                            ),
                                        };
                                    });
                                }}
                            />
                        </div>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                flexWrap: "nowrap",
                                gap: "1rem",
                            }}
                        >
                            <label htmlFor={"comix-downloader-chapter-to"}>
                                To:
                            </label>
                            <input
                                id={"comix-downloader-chapter-to"}
                                type={"number"}
                                min={minChapterValue ?? 0}
                                max={maxChapterValue ?? 0}
                                value={selectedChapterRange.max}
                                disabled={
                                    minChapterValue == null ||
                                    maxChapterValue == null ||
                                    isDownloading
                                }
                                style={{ width: "100px" }}
                                onChange={(event) => {
                                    setSelectedChapterRange((prev) => {
                                        return {
                                            ...prev,
                                            max: Math.min(
                                                Math.max(
                                                    prev.min,
                                                    event.target.valueAsNumber
                                                ),
                                                maxChapterValue!
                                            ),
                                        };
                                    });
                                }}
                            />
                        </div>
                    </div>
                </fieldset>
            </section>
            <section style={{ marginTop: "1rem" }}>
                <fieldset>
                    <legend>Download Setting(s):</legend>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: "1rem",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                flexWrap: "nowrap",
                                gap: "1rem",
                            }}
                        >
                            <label
                                htmlFor={
                                    "comix-downloader-page-download-concurrency"
                                }
                            >
                                Page Download Concurrency:
                            </label>
                            <input
                                id={
                                    "comix-downloader-page-download-concurrency"
                                }
                                type={"number"}
                                min={1}
                                max={256}
                                value={pageDownloadConcurrecy}
                                disabled={isDownloading}
                                style={{ width: "100px" }}
                                onChange={(event) => {
                                    setPageDownloadConcurrency(
                                        event.target.valueAsNumber
                                    );
                                }}
                            />
                        </div>
                    </div>
                </fieldset>
            </section>
            <section
                style={{
                    marginTop: "1rem",
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: "1rem",
                    alignItems: "center",
                }}
            >
                <button
                    id={"comix-downloader-download-button"}
                    disabled={
                        isDownloading ||
                        !groups ||
                        minChapterValue == null ||
                        maxChapterValue == null
                    }
                    onClick={onclickDownload}
                >
                    Download
                </button>
                <span>
                    Warning: You may receive multiple download prompts if file
                    size exceed 2GB in total.
                </span>
            </section>
            <section style={{ marginTop: "1rem" }}>
                <fieldset>
                    <legend>
                        Download Preview: (
                        {chaptersToDownload && chaptersToDownload.length})
                    </legend>
                    {isDownloading && (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                flexWrap: "nowrap",
                                gap: "1rem",
                                alignItems: "center",
                            }}
                        >
                            <div>Progress:</div>
                            {globalProgress.total == 0 ||
                            globalProgress.done === globalProgress.total ? (
                                <progress style={{ flexGrow: "1" }} />
                            ) : (
                                <progress
                                    style={{ flexGrow: "1" }}
                                    max={globalProgress.total}
                                    value={globalProgress.done}
                                />
                            )}
                            <div>
                                {globalProgress.done} / {globalProgress.total}
                            </div>
                        </div>
                    )}
                    <table style={{ width: "100%" }}>
                        <thead>
                            <tr>
                                <th style={{ width: "10%" }}>ID</th>
                                <th style={{ width: "10%" }}>Volume</th>
                                <th style={{ width: "10%" }}>Chapter</th>
                                <th style={{ width: "20%" }}>Title</th>
                                <th style={{ width: "10%" }}>Group</th>
                                <th style={{ width: "20%" }}>File Name</th>
                                <th style={{ width: "20%" }}>Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {chaptersToDownload &&
                                chaptersToDownload.map((chapter) => {
                                    return (
                                        <tr key={chapter.id}>
                                            <td>{chapter.id}</td>
                                            <td>Vol. {chapter.volume}</td>
                                            <td>Chapter {chapter.chapter}</td>
                                            <td>{chapter.title}</td>
                                            <td>{chapter.group}</td>
                                            <td>{chapter.outputFileName}</td>
                                            <td>
                                                {progress[chapter.id] &&
                                                    (progress[chapter.id]
                                                        ?.total == 0 ? (
                                                        <progress
                                                            style={{
                                                                width: "100%",
                                                            }}
                                                        />
                                                    ) : (
                                                        <progress
                                                            className={
                                                                progress[
                                                                    chapter.id
                                                                ]?.isError
                                                                    ? "comix-downloader-progress-error"
                                                                    : ""
                                                            }
                                                            style={{
                                                                width: "100%",
                                                            }}
                                                            max={
                                                                progress[
                                                                    chapter.id
                                                                ]?.total
                                                            }
                                                            value={
                                                                progress[
                                                                    chapter.id
                                                                ]?.done
                                                            }
                                                        />
                                                    ))}
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </fieldset>
            </section>
        </div>
    );
}
