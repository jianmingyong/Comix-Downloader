export function saveAs(name: string, data: Blob): void {
    const downloadElement = document.createElement("a");
    downloadElement.href = URL.createObjectURL(data);
    downloadElement.download = name;
    downloadElement.click();
    URL.revokeObjectURL(downloadElement.href);
}

export function sanitizeFilename(name: string) {
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

    if (reserved.test(name)) {
        name = "_" + name;
    }

    return (
        name
            // eslint-disable-next-line no-control-regex
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
            .replace(/[. ]+$/g, "")
            .trim()
    );
}
