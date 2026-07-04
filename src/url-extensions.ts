type QueryValue =
    | string
    | boolean
    | QueryObject
    | QueryValue[];

interface QueryObject {
    [key: string]: QueryValue;
}

export function urlParamsToObject(url: string): QueryObject {
    const parsed = new URL(url);
    const result: QueryObject = {};

    // Keep the raw query so we can distinguish ?flag from ?flag=
    const standaloneParams = new Set<string>();

    const query = parsed.search.startsWith("?")
        ? parsed.search.slice(1)
        : parsed.search;

    if (query) {
        for (const part of query.split("&")) {
            if (!part) continue;

            if (!part.includes("=")) {
                standaloneParams.add(decodeURIComponent(part));
            }
        }
    }

    for (const [rawKey, value] of parsed.searchParams) {
        const path = rawKey.match(/([^[\]]+)|(?<=\[)[^[\]]*(?=\])/g);

        if (!path) {
            continue;
        }

        insert(
            result,
            path,
            standaloneParams.has(rawKey) ? true : value,
        );
    }

    return result;
}

function insert(
    root: QueryObject,
    path: string[],
    value: string | boolean,
): void {
    let current: QueryObject | QueryValue[] = root;

    for (let i = 0; i < path.length; i++) {
        const key = path[i]!;
        const last = i === path.length - 1;
        const next = path[i + 1];

        if (key === "") {
            if (!Array.isArray(current)) {
                throw new TypeError("Unexpected array notation.");
            }

            if (last) {
                current.push(value);
                return;
            }

            const child: QueryObject | QueryValue[] =
                next === "" ? [] : {};

            current.push(child);
            current = child;
            continue;
        }

        const object = current as QueryObject;

        if (last) {
            if (!(key in object)) {
                object[key] = value;
            } else if (Array.isArray(object[key])) {
                object[key].push(value);
            } else {
                object[key] = [object[key]!, value];
            }

            return;
        }

        if (!(key in object)) {
            object[key] = next === "" ? [] : {};
        }

        current = object[key] as QueryObject | QueryValue[];
    }
}