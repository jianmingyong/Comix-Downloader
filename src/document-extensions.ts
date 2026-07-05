type ElementCondition = (element: Element | null) => boolean;

export function querySelectorWaitUntil<E extends Element = Element>(
    selectors: string,
    conditions?: ElementCondition | null,
    signal?: AbortSignal | number | null
): Promise<E | null> {
    conditions ??= (element) => (element ? true : false);

    if (signal && typeof signal === "number") {
        signal = AbortSignal.timeout(signal);
    } else if (signal && !(signal instanceof AbortSignal)) {
        throw new TypeError("signal must either be a number or AbortSignal");
    }

    return new Promise((resolve, reject) => {
        function findElement(
            selectors: string,
            conditions: ElementCondition,
            signal: AbortSignal | null
        ) {
            if (signal?.aborted) {
                if (signal.reason instanceof Error) {
                    reject(signal.reason);
                } else {
                    reject(new Error(String(signal.reason)));
                }
                return;
            }

            const element = document.querySelector<E>(selectors);

            if (conditions(element)) {
                resolve(element);
            } else {
                setTimeout(findElement, 1, selectors, conditions, signal);
            }
        }

        findElement(selectors, conditions, signal as AbortSignal);
    });
}

type Child = string | Node | boolean;
type Attributes<T extends HTMLElement> = Omit<
    Partial<T>,
    "children" | "className"
> & {
    class?: string | string[];
    children?: Child | Child[];
} & Record<`on${string}`, ((this: T, ev: Event) => unknown) | null> &
    Record<string, unknown>;

export function createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    attributes?: Attributes<HTMLElementTagNameMap[K]>
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);

    if (attributes) {
        for (const key in attributes) {
            if (!Object.hasOwn(attributes, key)) continue;

            const value = attributes[key];

            if (key === "class") {
                if (typeof value === "string") {
                    element.className = value;
                } else if (
                    Array.isArray(value) &&
                    value.every((v) => typeof v === "string")
                ) {
                    element.classList.add(...value);
                } else {
                    throw new TypeError("class must be a string or string[]");
                }
            } else if (key === "children") {
                if (typeof value === "string" || value instanceof Node) {
                    element.append(value);
                } else if (Array.isArray(value)) {
                    const displayableValue = value.filter(
                        (v) => typeof v === "string" || v instanceof Node
                    );
                    element.append(...displayableValue);
                } else if (typeof value === "boolean") {
                    // if they are boolean, we can safely ignore that particular entry.
                } else {
                    throw new TypeError(
                        "children must be a string, a Node, or an array of them"
                    );
                }
            } else if (key !== "constructor" && key in element) {
                try {
                    Reflect.set(element, key, value);
                } catch {
                    element.setAttribute(key, String(value));
                }
            } else {
                if (typeof value !== "string") {
                    throw new TypeError(`${key} must be a string`);
                }
                element.setAttribute(key, value);
            }
        }
    }

    return element;
}
