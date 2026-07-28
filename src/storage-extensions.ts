import { sanitizeFilename } from "./file-extensions";

export async function cleanUpOPFS() {
    const opfsDirectory = await navigator.storage.getDirectory();

    for await (const [key, value] of opfsDirectory.entries()) {
        if (!key.endsWith(".cbz") && !key.endsWith(".zip")) continue;

        if (value instanceof FileSystemFileHandle) {
            await opfsDirectory.removeEntry(key);
        }
    }
}

export async function getOPFSFileHandle(
    name: string
): Promise<FileSystemFileHandle> {
    const opfsDirectory = await navigator.storage.getDirectory();
    const fileHandle = await opfsDirectory.getFileHandle(
        sanitizeFilename(name),
        {
            create: true,
        }
    );
    return fileHandle;
}
