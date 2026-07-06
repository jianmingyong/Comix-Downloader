type Task<T> = () => Promise<T>;

export function runAllTasks<T>(
    tasks: Task<T>[],
    concurrency: number
): Promise<Awaited<T>[]> {
    return new Promise((resolve, reject) => {
        let counter = 0;
        const runningTasks: Promise<T>[] = [];

        for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
            runPromise();
        }

        function runPromise() {
            const index = counter++;
            const taskToRun = tasks[index]!;

            if (index < tasks.length) {
                runningTasks[index] = taskToRun();
                runningTasks[index].then(runPromise).catch(reject);
            } else if (index === tasks.length) {
                Promise.all(runningTasks).then(resolve).catch(reject);
            }
        }
    });
}

export function createTask<T>(task: Task<T>, signal?: AbortSignal): Task<T> {
    return () => {
        return new Promise((resolve, reject) => {
            signal?.throwIfAborted();
            task().then(resolve).catch(reject);
        });
    };
}
