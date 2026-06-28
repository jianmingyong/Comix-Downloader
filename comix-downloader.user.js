// ==UserScript==
// @name         Comix Downloader
// @namespace    https://github.com/jianmingyong/Comix-Downloader
// @source       https://github.com/jianmingyong/Comix-Downloader
// @updateURL    https://github.com/jianmingyong/Comix-Downloader/raw/refs/heads/master/comix-downloader.user.js
// @downloadURL  https://github.com/jianmingyong/Comix-Downloader/raw/refs/heads/master/comix-downloader.user.js
// @version      1.0.0
// @description  Try to annoy comix as much as possible by downloading everything.
// @author       Yong Jian Ming
// @match        *://comix.to/title/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=comix.to
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_addElement
// ==/UserScript==

(function () {
    "use strict";

    const CHAPTER_DOWNLOAD_CONCURRENCY = 4;
    const PAGE_DOWNLOAD_CONCURRENCY = 12;

    const DEFAULT_FETCH_TIMEOUT = 30 * 1000;
    const RETRY_WAIT_TIME = 5 * 1000;

    function querySelectorWaitUntil(selectors, conditions, signal) {
        return new Promise((resolve, reject) => {
            function findElement(selectors, conditions, signal) {
                if (signal && signal.aborted) {
                    reject(signal.reason);
                    return;
                }

                if (conditions == null || typeof conditions !== 'function') {
                    conditions = (element) => element;
                }

                const element = document.querySelector(selectors);

                if (conditions(element)) {
                    resolve(element);
                } else {
                    setTimeout(findElement, 1, selectors, conditions, signal);
                }
            }

            findElement(selectors, conditions, signal);
        });
    }

    function querySelectorAllWaitUntil(selectors, conditions, signal) {
        return new Promise((resolve, reject) => {
            function findElement(selectors, conditions, signal) {
                if (signal && signal.aborted) {
                    reject(signal.reason);
                    return;
                }

                if (conditions == null || typeof conditions !== 'function') {
                    conditions = (element) => element.length > 0;
                }

                const element = document.querySelectorAll(selectors);

                if (conditions(element)) {
                    resolve(element);
                } else {
                    setTimeout(findElement, 1, selectors, conditions, signal);
                }
            }

            findElement(selectors, conditions, signal);
        });
    }

    function runAll(tasks, concurrency) {
        return new Promise((resolve, reject) => {
            let counter = 0;
            const runningTasks = [];

            for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
                runPromise();
            }

            function runPromise() {
                const index = counter++;
                const taskToRun = tasks[index];

                if (index < tasks.length) {
                    runningTasks[index] = taskToRun();
                    runningTasks[index].then(runPromise).catch(reject);
                } else if (index === tasks.length) {
                    Promise.all(runningTasks).then(resolve).catch(reject);
                }
            }
        });
    }

    function createRetryableTask(retryableTask, maxRetry) {
        return new Promise((resolve, reject) => {
            function runTask(retryableTask, retry, maxRetry) {
                retryableTask(retry)
                    .then(resolve)
                    .catch((error) => {
                        if (retry >= maxRetry) {
                            reject(error);
                        } else {
                            setTimeout(runTask, RETRY_WAIT_TIME, retryableTask, retry + 1, maxRetry);
                        }
                    });
            }

            runTask(retryableTask, 0, maxRetry);
        });
    }

    function isPromise(obj) {
        return (
            obj &&
            typeof obj === 'object' &&
            typeof obj.then === 'function' &&
            typeof obj.catch === 'function' &&
            typeof obj.finally === 'function'
        );
    }

    function saveAs(name, data) {
        const downloadElement = document.createElement("a");
        downloadElement.href = URL.createObjectURL(data);
        downloadElement.setAttribute("download", name);
        downloadElement.click();
        URL.revokeObjectURL(downloadElement.href);
    }

    function sanitizeFilename(name) {
        const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

        if (reserved.test(name)) {
            name = '_' + name;
        }

        return name
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/[. ]+$/g, '')
            .trim();
    }

    // MAIN INJECTION POINT STARTS HERE

    unsafeWindow.__CANVAS_TO_DATA_URL__ = HTMLCanvasElement.prototype.toDataURL;

    querySelectorWaitUntil('head > script[type="module"][src*="main"]', null, AbortSignal.timeout(30000))
        .then(async (mainModuleElement) => {
            const mainModuleResponse = await fetch(mainModuleElement.src, { cache: 'no-cache', signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT) });
            if (!mainModuleResponse.ok) {
                throw new Error(`${mainModuleResponse.status}: ${mainModuleResponse.statusText}`);
            }

            const mainModuleContents = await mainModuleResponse.text();
            const secureModuleFileSearch = /(secure-[A-Za-z0-9-_]+?\.js)/.exec(mainModuleContents);
            if (!secureModuleFileSearch) {
                throw new Error('Secure module not found');
            }

            const secureModuleUrl = mainModuleElement.src.substring(0, mainModuleElement.src.lastIndexOf('/') + 1) + secureModuleFileSearch[1];
            return await import(secureModuleUrl);
        })
        .then((moduleFunctions) => {
            if (!moduleFunctions) {
                throw new Error('Secure module is empty or not a valid ESM module');
            }

            console.log('Found Secure Module:', moduleFunctions);

            Object.keys(moduleFunctions).forEach((key) => {
                const fn = moduleFunctions[key];

                if (typeof fn !== 'function') return;

                try {
                    let got = false;

                    if (fn.length === 1) {
                        fn({
                            interceptors: {
                                request: {
                                    use: () => {
                                        got = true;
                                    },
                                },
                                response: {
                                    use: () => {
                                        got = true;
                                    },
                                },
                            },
                        });
                    }

                    if (got) {
                        fn({
                            interceptors: {
                                request: {
                                    use: function (fn) {
                                        unsafeWindow.__INTERCEPTORS_REQUEST__ = fn;
                                    },
                                },
                                response: {
                                    use: function (fn) {
                                        unsafeWindow.__INTERCEPTORS_RESPONSE__ = fn;
                                    },
                                },
                            },
                        });
                        return;
                    }
                } catch (error) { }

                try {
                    if (fn.length === 2) {
                        const res = fn('about:blank', null);

                        if (isPromise(res)) {
                            res.catch(() => { });
                            unsafeWindow.__DESCRAMABLER__ = fn;
                        }
                    }
                } catch (error) { }
            });

            if (!unsafeWindow.__INTERCEPTORS_REQUEST__ || !unsafeWindow.__INTERCEPTORS_RESPONSE__) {
                throw new Error("Unable to find interceptor function");
            } else if (!unsafeWindow.__DESCRAMABLER__) {
                throw new Error("Unable to find descrambler function");
            }

            console.log('Injected custom function completed. Now you can use them to do whatever you want.');
        })
        .then(() => {
            // From here on, those functions above will be available.
            async function fetchJsonWithAxiosInterceptors(input, init) {
                const url = new URL(input);
                const requestParams = {};

                for (const [key, rawValue] of url.searchParams) {
                    const value = /^\d+$/.test(rawValue) ? Number(rawValue) : rawValue;
                    const parts = key.replace(/\]/g, '').split('[');

                    let current = requestParams;

                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i];
                        const last = i === parts.length - 1;

                        if (last) {
                            if (part === '') {
                                current.push(value);
                            } else if (current[part] === undefined) {
                                current[part] = value;
                            } else if (Array.isArray(current[part])) {
                                current[part].push(value);
                            } else {
                                current[part] = [current[part], value];
                            }
                        } else {
                            const nextPart = parts[i + 1];

                            current[part] ??= nextPart === '' ? [] : {};
                            current = current[part];
                        }
                    }
                }

                let requestMethod = 'GET';

                if (init && init.method) {
                    requestMethod = init.method;
                }

                const request = unsafeWindow.__INTERCEPTORS_REQUEST__({
                    url: `${url.origin}${url.pathname}`,
                    method: requestMethod,
                    params: requestParams,
                });

                class ParameterBuilder {
                    constructor() {
                        this.params = [];
                    }

                    push(key, value) {
                        if (value) {
                            this.params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
                        } else {
                            this.params.push(`${encodeURIComponent(key)}`);
                        }
                    }

                    toString() {
                        return this.params.join('&');
                    }
                }

                function buildParams(params) {
                    let paramsBuilder = new ParameterBuilder();

                    function pushValue(builder, key, value) {
                        if (value == null) {
                            builder.push(key);
                        } else if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
                            if (typeof value === 'string') {
                                builder.push(key, value);
                            } else {
                                builder.push(key, value.toString());
                            }
                        } else if (Array.isArray(value)) {
                            let arrayKey = `${key}[]`;

                            value.forEach((v) => {
                                if (typeof v === 'string') {
                                    builder.push(arrayKey, v);
                                } else {
                                    builder.push(arrayKey, v.toString());
                                }
                            });
                        } else if (typeof value === 'object') {
                            Object.keys(value).forEach((k) => {
                                pushValue(builder, `${key}[${k}]`, value[k]);
                            });
                        }
                    }

                    Object.keys(params).forEach((key) => {
                        pushValue(paramsBuilder, key, params[key]);
                    });

                    return paramsBuilder.toString();
                }

                const response = await fetch(`${request.url}?${buildParams(request.params)}`, init);

                if (!response.ok) {
                    throw new Error(`${response.status}: ${response.statusText}`);
                }

                const json = await response.json();
                const headers = {};

                for (const pair of response.headers.entries()) {
                    headers[pair[0]] = pair[1];
                }

                const finalResponse = unsafeWindow.__INTERCEPTORS_RESPONSE__({
                    data: json,
                    status: response.status,
                    headers: headers,
                });

                return finalResponse.data;
            }

            async function onclickDownloadEvent() {
                class ToastHandler {
                    constructor() {
                        this.toast = document.getElementById('toast');
                        this.text = document.getElementById('toast-text');
                        this.progress = document.getElementById('toast-progress');
                        this.state = 0;
                    }

                    showToast() {
                        this.toast.classList.remove('downloader_hidden');
                    }

                    hideToast() {
                        this.toast.classList.add('downloader_hidden');
                    }

                    updateText(text) {
                        this.state = 0;
                        this.text.textContent = text;
                    }

                    updateProgress(value) {
                        this.progress.value = value;
                    }

                    animateProcessingStage(value) {
                        function updateState (innerThis, state, value, innerState) {
                            if (innerThis.state !== state) {
                                return;
                            }

                            if (innerState === 1) {
                                innerThis.text.textContent = `${value}`;
                                setTimeout(updateState, 1000, innerThis, state, value, 2);
                            } else if (innerState === 2) {
                                innerThis.text.textContent = `${value}.`;
                                setTimeout(updateState, 1000, innerThis, state, value, 3);
                            } else if (innerState === 3) {
                                innerThis.text.textContent = `${value}..`;
                                setTimeout(updateState, 1000, innerThis, state, value, 4);
                            } else if (innerState === 4) {
                                innerThis.text.textContent = `${value}...`;
                                setTimeout(updateState, 1000, innerThis, state, value, 1);
                            }
                        }

                        updateState(this, ++this.state, value, 1);
                    }
                }

                const toast = new ToastHandler();

                try {
                    toast.showToast();
                    toast.updateProgress(0);
                    toast.animateProcessingStage('Processing');

                    const currentPageUrl = document.URL;
                    const mangaId = document.URL.replace('https://comix.to/title/', '').split('-')[0];
                    const mangaChapters = [];

                    let hasMoreChapters = true;
                    let page = 1;

                    do {
                        const manga = await fetchJsonWithAxiosInterceptors(
                            `https://comix.to/api/v1/manga/${mangaId}/chapters?page=${page}&limit=100&order[number]=desc`,
                        );
                        // console.log(manga);

                        if (manga.items) {
                            manga.items.forEach((item) => {
                                let outputFileName = "";

                                if (item.volume > 0) {
                                    outputFileName += `Vol. ${item.volume} `;
                                }

                                if (item.number != null) {
                                    outputFileName += `Chapter ${item.number} `;
                                }

                                if (item.name != "") {
                                    outputFileName += `- ${item.name} `;
                                }

                                if (item.group) {
                                    outputFileName += `[${item.group.name}] `;
                                }

                                if (item.creator) {
                                    outputFileName += `[${item.creator.name}] `;
                                }

                                if (item.isOfficial) {
                                    outputFileName += "[Official] ";
                                }

                                outputFileName = sanitizeFilename(`${outputFileName.trim()}.cbz`);

                                mangaChapters.push({
                                    id: item.id,
                                    volume: item.volume,
                                    chapter: item.number,
                                    title: item.name,
                                    isOfficial: item.isOfficial,
                                    group: item.group,
                                    name: item.creator,
                                    outputName: outputFileName,
                                });
                            });
                        }

                        page += 1;
                        hasMoreChapters = manga.meta.hasNext;
                    } while (hasMoreChapters);

                    let globalZipFile = new JSZip();
                    let downloadChapterTasks = [];

                    const progressIncAmount = (1 / mangaChapters.length) * 100;

                    function createPageTask(page, index, zip) {
                        return createRetryableTask((retry) => {
                            return new Promise((resolve, reject) => {
                                if (page.s) {
                                    const canvas = document.createElement('canvas');
                                    canvas.width = page.width;
                                    canvas.height = page.height;

                                    let isDrawn = false;

                                    unsafeWindow
                                        .__DESCRAMABLER__(page.url, AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT))
                                        .then((data) => {
                                            if (data && data.mode) {
                                                if (data.mode === 'blob') {
                                                    return new Promise((resolve, reject) => {
                                                        const url = URL.createObjectURL(data.blob);
                                                        const image = new Image();
                                                        image.src = url;
                                                        image.onload = () => resolve(image);
                                                        image.onerror = reject;
                                                    });
                                                } else if (data.mode === 'canvas') {
                                                    data.apply(canvas);
                                                    return Promise.resolve();
                                                } else {
                                                    throw new Error(`Unknown data mode`);
                                                }
                                            } else if (data && data.apply) {
                                                data.apply(canvas);
                                                return Promise.resolve();
                                            } else if (data && data.blob) {
                                                return new Promise((resolve, reject) => {
                                                    const url = URL.createObjectURL(data.blob);
                                                    const image = new Image();
                                                    image.src = url;
                                                    image.onload = () => resolve(image);
                                                    image.onerror = reject;
                                                });
                                            } else {
                                                return new Promise((resolve, reject) => {
                                                    const url = URL.createObjectURL(data);
                                                    const image = new Image();
                                                    image.src = url;
                                                    image.onload = () => resolve(image);
                                                    image.onerror = reject;
                                                });
                                            }
                                        })
                                        .then((blob) => {
                                            if (blob) {
                                                URL.revokeObjectURL(blob.src);
                                                const ctx = canvas.getContext('2d');
                                                ctx.drawImage(blob, 0, 0);
                                            }

                                            isDrawn = true;
                                        })
                                        .then(() => {
                                            if (isDrawn) {
                                                const data =
                                                    unsafeWindow.__CANVAS_TO_DATA_URL__.call(canvas);

                                                zip.file(
                                                    `${String(index).padStart(3, '0')}.png`,
                                                    data.split(",")[1],
                                                    { base64: true },
                                                );
                                            } else {
                                                throw new Error(`Unable to get image data`);
                                            }
                                        })
                                        .then(resolve)
                                        .catch(reject);
                                } else {
                                    // Unscrambled Pages
                                    fetch(page.url, { signal: AbortSignal.timeout(30000) })
                                        .then((response) => {
                                            if (!response.ok) {
                                                throw new Error(`${response.status}: ${response.message}`);
                                            }
                                            return response.blob();
                                        })
                                        .then((blob) => {
                                            zip.file(`${String(index).padStart(3, '0')}.webp`, blob);
                                        })
                                        .then(resolve)
                                        .catch(reject);
                                }
                            });
                        }, 5);
                    }

                    mangaChapters.forEach((mangaChapter) => {
                        downloadChapterTasks.push(() => {
                            return new Promise((resolve, reject) => {
                                const zip = new JSZip();

                                fetchJsonWithAxiosInterceptors(
                                    `https://comix.to/api/v1/chapters/${mangaChapter.id}`,
                                    { signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT) }
                                )
                                    .then((chapter) => {
                                        let downloadPageTasks = [];

                                        chapter.pages.items.forEach((page, index) => {
                                            downloadPageTasks.push(() => {
                                                return createPageTask(page, index, zip);
                                            });
                                        });

                                        return runAll(downloadPageTasks, PAGE_DOWNLOAD_CONCURRENCY);
                                    })
                                    .then(() => {
                                        return zip.generateAsync({
                                            type: 'blob',
                                            compression: 'DEFLATE',
                                            compressionOptions: {
                                                level: 9,
                                            },
                                        });
                                    })
                                    .then((zipFile) => {
                                        globalZipFile.file(mangaChapter.outputName, zipFile);
                                    })
                                    .then(resolve)
                                    .catch(reject)
                                    .finally(() => {
                                        toast.updateProgress(progressIncAmount);
                                    });
                            });
                        });
                    });

                    await runAll(downloadChapterTasks, CHAPTER_DOWNLOAD_CONCURRENCY);

                    toast.animateProcessingStage('Creating Zip File');
                    toast.updateProgress(100);

                    var outFile = await globalZipFile.generateAsync({
                        type: 'blob',
                        compression: 'DEFLATE',
                        compressionOptions: {
                            level: 9,
                        },
                    });

                    toast.updateText('Zip File Created.')

                    const nameElement = await querySelectorWaitUntil('h1.mpage__title');
                    saveAs(sanitizeFilename(`${nameElement.textContent}.zip`), outFile);
                } catch (error) {
                    toast.updateText(`Error: ${error.message}`);
                } finally {
                    setTimeout(() => {
                        toast.hideToast();
                    }, 10000);
                }
            }

            GM_addElement('script', {
                src: 'https://kit.fontawesome.com/e5e217aee3.js',
                crossorigin: 'anonymous'
            });

            GM_addElement('script', {
                src: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
            });

            GM_addStyle('.downloader_toast { position: fixed; bottom: 20px; right: 20px; background: #333; color: white; padding: 16px; border-radius: 8px; min-width: 250px; }');
            GM_addStyle('.downloader_hidden { display: none; }');
            GM_addStyle('progress { width: 100%; margin-top: 8px; }');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn--soft';
            button.title = 'Download';
            button.onclick = onclickDownloadEvent;

            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-download';

            const span = document.createElement('span');
            span.textContent = 'Download';

            button.appendChild(icon);
            button.appendChild(span);

            querySelectorWaitUntil('div.mpage__poster-actions', (element) => element ? element.querySelector('div.mpage__rate-stack') : false, AbortSignal.timeout(30000))
                .then((element) => {
                    element.insertBefore(button, element.querySelector('div.mpage__rate-stack'));
                })
                .catch((error) => {
                    console.log(error)
                });


            const toast = document.createElement('div');
            toast.id = 'toast';
            toast.classList.add('downloader_toast', 'downloader_hidden');

            const text = document.createElement('div');
            text.id = 'toast-text';

            const progress = document.createElement('progress');
            progress.id = 'toast-progress';
            progress.max = 100;
            progress.value = 0;

            toast.appendChild(text);
            toast.appendChild(progress);

            document.body.appendChild(toast);
        })
        .catch((error) => {
            console.log(error);
        });
})();
