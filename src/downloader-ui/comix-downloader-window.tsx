import { useEffect, useState } from "react";
import { ComixChapter, type ComixDownloader } from "../comix-downloader";

interface ChapterRange {
    min: number,
    max: number,
}

export function ComixDownloaderWindow({ downloader }: { downloader: ComixDownloader }) {
    const [chapterList, setChapterList] = useState<ComixChapter[]>();

    const [availableGroups, setAvailableGroups] = useState<string[]>();
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

    const [chapterRange, setChapterRange] = useState<ChapterRange>();
    const [selectedChapterRange, setSelectedChapterRange] = useState<ChapterRange>({ min: 0, max: 0 });

    const [isDownloading, setIsDownloading] = useState(false);

    useEffect(() => {
        downloader.fetchChapterList().then((list) => {
            setChapterList(list);

            const groups = new Set<string>();

            list.forEach((chapterList) => {
                if (chapterList.group) {
                    groups.add(chapterList.group);
                }
            });

            setAvailableGroups(Array.from(groups).sort());

            const min = Math.min(...list.map(v => v.chapter));
            const max = Math.max(...list.map(v => v.chapter));

            setChapterRange({ min: min, max: max });
            setSelectedChapterRange({ min: min, max: max });
        }).catch((error) => console.log(error));
    }, []);

    function onclickDownload() {
        setIsDownloading(true);
    }

    return (
        <div id="comix-downloader-window">
            <div>
                <span style={{ fontSize: "1.5rem" }}>Comix Downloader</span>
                <button
                    style={{ position: "absolute", top: "1rem", right: "1rem" }}
                    onClick={downloader.close.bind(downloader)}>✕</button>
            </div>
            <section style={{ marginTop: "1rem" }}>
                <fieldset>
                    <legend>Group(s) Selection:</legend>
                    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "1rem" }}>
                        {availableGroups ? availableGroups.map((group, index) =>
                            <div
                                key={`comix-downloader-group-${group}`}
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    flexWrap: "nowrap",
                                    justifyContent: "center",
                                    alignItems: "center"
                                }}>
                                <input
                                    id={`comix-downloader-group-${index}`}
                                    type={"checkbox"}
                                    value={group}
                                    disabled={isDownloading}
                                    onChange={(event) => {
                                        if (event.target.checked) {
                                            const newSet = new Set(selectedGroups);
                                            newSet.add(group);
                                            setSelectedGroups(newSet);
                                        } else {
                                            const newSet = new Set(selectedGroups);
                                            newSet.delete(group);
                                            setSelectedGroups(newSet);
                                        }
                                    }} />
                                <label
                                    htmlFor={`comix-downloader-group-${index}`}
                                    style={{ userSelect: "none" }}>{group}</label>
                            </div>
                        ) : <span>Loading...</span>}
                    </div>
                </fieldset>
            </section>
            <section style={{ marginTop: "1rem" }}>
                <fieldset>
                    <legend>Chapter Range Selection:</legend>
                    <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "1rem" }}>
                        <div style={{ display: "flex", flexDirection: "row", flexWrap: "nowrap", gap: "1rem" }}>
                            <label htmlFor={"comix-downloader-chapter-from"}>From:</label>
                            <input
                                id={"comix-downloader-chapter-from"}
                                type={"number"}
                                min={chapterRange?.min ?? 0}
                                max={chapterRange?.max ?? 0}
                                value={selectedChapterRange.min}
                                disabled={!chapterRange || isDownloading}
                                style={{ width: "100px" }}
                                onChange={(event) => {
                                    setSelectedChapterRange({
                                        ...selectedChapterRange,
                                        min: Math.max(Math.min(chapterRange!.max, selectedChapterRange.max, event.target.valueAsNumber), chapterRange!.min),
                                    });
                                }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "row", flexWrap: "nowrap", gap: "1rem" }}>
                            <label htmlFor={"comix-downloader-chapter-to"}>To:</label>
                            <input
                                id={"comix-downloader-chapter-to"}
                                type={"number"}
                                min={chapterRange?.min ?? 0}
                                max={chapterRange?.max ?? 0}
                                value={selectedChapterRange.max}
                                disabled={!chapterRange || isDownloading}
                                style={{ width: "100px" }}
                                onChange={(event) => {
                                    setSelectedChapterRange({
                                        ...selectedChapterRange,
                                        max: Math.max(Math.min(chapterRange!.max, event.target.valueAsNumber), chapterRange!.min, selectedChapterRange.min),
                                    });
                                }} />
                        </div>
                    </div>
                </fieldset>
            </section>
            <section style={{ marginTop: "1rem", display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "1rem" }}>
                <button
                    id={"comix-downloader-download-button"}
                    disabled={isDownloading || !availableGroups || !chapterRange}
                    onClick={onclickDownload}>Download</button>
                <span>Warning: Selecting a large range may fail due to JS limitations.</span>
            </section>
            <section style={{ marginTop: "1rem" }}>
                <fieldset>
                    <legend>Download Preview:</legend>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

                    </div>
                </fieldset>
            </section>
        </div>
    );
}