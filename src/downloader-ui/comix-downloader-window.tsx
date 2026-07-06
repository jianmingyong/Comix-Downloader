import { useEffect, useMemo, useState } from "react";
import {
    ComixChapter,
    ComixDownloadTask,
    type ComixDownloader,
} from "../comix-downloader";
import { runAllTasks } from "../task-extensions";
import { CHAPTER_DOWNLOAD_CONCURRENCY } from "../constants";
import { sanitizeFilename, saveAs } from "../file-extensions";

interface ChapterRange {
    min: number;
    max: number;
}

interface Progress {
    done: number;
    total: number;
}

export function ComixDownloaderWindow({
    downloader,
}: {
    downloader: ComixDownloader;
}) {
    const [chapterList, setChapterList] = useState<ComixChapter[]>();
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(
        new Set()
    );
    const [selectedChapterRange, setSelectedChapterRange] =
        useState<ChapterRange>({ min: 0, max: 0 });

    const [isDownloading, setIsDownloading] = useState(false);
    const [progress, setProgress] = useState<Record<number, Progress>>({});

    const { groups, minChapterValue, maxChapterValue } = useMemo(() => {
        if (!chapterList) {
            return {
                groups: null,
                minChapterValue: null,
                maxChapterValue: null,
            };
        } else {
            const groups = new Set<string>();

            chapterList.forEach((chapterList) => {
                if (chapterList.group) {
                    groups.add(chapterList.group);
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

    useEffect(() => {
        downloader.fetchChapterList().then(setChapterList).catch(console.log);
    }, []);

    function onclickDownload() {
        setIsDownloading(true);

        const tasks: ComixDownloadTask[] = [];
        const progress: Record<number, Progress> = {};

        chaptersToDownload?.forEach((chapter) => {
            const id = chapter.id;
            progress[id] = { done: 0, total: 0 };

            tasks.push(
                chapter.createDownloadTask(downloader.signal!, (progress) => {
                    setProgress((value) => {
                        return {
                            ...value,
                            [id]: {
                                done: progress.done,
                                total: progress.total,
                            },
                        };
                    });
                })
            );
        });

        setProgress(progress);

        const globalZip = new JSZip();

        runAllTasks(
            tasks.map((t) => () => t.start()),
            CHAPTER_DOWNLOAD_CONCURRENCY
        )
            .then((zip) => {
                const tasks: Array<() => Promise<void>> = [];

                zip.forEach(([filename, zip]) => {
                    tasks.push(() =>
                        zip
                            .generateAsync({
                                type: "blob",
                                compression: "DEFLATE",
                                compressionOptions: { level: 9 },
                            })
                            .then((blob) => {
                                globalZip.file(filename, blob);
                            })
                    );
                });

                return runAllTasks(tasks, 4);
            })
            .then(() => {
                return globalZip.generateAsync({
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 9 },
                });
            })
            .then((blob) => {
                const title =
                    document.querySelector("h1.mpage__title")?.textContent;
                saveAs(sanitizeFilename(`${title}.zip`), blob);
            })
            .catch(console.log)
            .finally(() => {
                setIsDownloading(false);
            });
    }

    return (
        <div id="comix-downloader-window">
            <div>
                <span style={{ fontSize: "1.5rem" }}>Comix Downloader</span>
                <button
                    style={{ position: "absolute", top: "1rem", right: "1rem" }}
                    onClick={downloader.close.bind(downloader)}
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
                                        if (event.target.checked) {
                                            const newSet = new Set(
                                                selectedGroups
                                            );
                                            newSet.add(group);
                                            setSelectedGroups(newSet);
                                        } else {
                                            const newSet = new Set(
                                                selectedGroups
                                            );
                                            newSet.delete(group);
                                            setSelectedGroups(newSet);
                                        }
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
                                    !minChapterValue ||
                                    !maxChapterValue ||
                                    isDownloading
                                }
                                style={{ width: "100px" }}
                                onChange={(event) => {
                                    setSelectedChapterRange({
                                        ...selectedChapterRange,
                                        min: Math.max(
                                            Math.min(
                                                maxChapterValue!,
                                                selectedChapterRange.max,
                                                event.target.valueAsNumber
                                            ),
                                            minChapterValue!
                                        ),
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
                                    !minChapterValue ||
                                    !maxChapterValue ||
                                    isDownloading
                                }
                                style={{ width: "100px" }}
                                onChange={(event) => {
                                    setSelectedChapterRange({
                                        ...selectedChapterRange,
                                        max: Math.max(
                                            Math.min(
                                                maxChapterValue!,
                                                event.target.valueAsNumber
                                            ),
                                            minChapterValue!,
                                            selectedChapterRange.min
                                        ),
                                    });
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
                }}
            >
                <button
                    id={"comix-downloader-download-button"}
                    disabled={
                        isDownloading ||
                        !groups ||
                        !minChapterValue ||
                        !maxChapterValue
                    }
                    onClick={onclickDownload}
                >
                    Download
                </button>
                <span>
                    Warning: Selecting a large range may fail due to JS
                    limitations.
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
                    <table>
                        <tr>
                            <th style={{ width: "10%" }}>ID</th>
                            <th style={{ width: "10%" }}>Volume</th>
                            <th style={{ width: "10%" }}>Chapter</th>
                            <th style={{ width: "30%" }}>Title</th>
                            <th style={{ width: "10%" }}>Group</th>
                            <th style={{ width: "20%" }}>File Name</th>
                            <th style={{ width: "10%" }}>Progress</th>
                        </tr>
                        {chaptersToDownload &&
                            chaptersToDownload.map((chapter) => {
                                return (
                                    <tr>
                                        <td>{chapter.id}</td>
                                        <td>Vol. {chapter.volume}</td>
                                        <td>Chapter {chapter.chapter}</td>
                                        <td>{chapter.title}</td>
                                        <td>{chapter.group}</td>
                                        <td>{chapter.outputFileName}</td>
                                        <td>
                                            {progress[chapter.id] &&
                                                (progress[chapter.id]?.total ==
                                                0 ? (
                                                    <progress />
                                                ) : (
                                                    <progress
                                                        max={
                                                            progress[chapter.id]
                                                                ?.total
                                                        }
                                                        value={
                                                            progress[chapter.id]
                                                                ?.done
                                                        }
                                                    />
                                                ))}
                                        </td>
                                    </tr>
                                );
                            })}
                    </table>
                </fieldset>
            </section>
        </div>
    );
}
