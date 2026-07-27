export interface ITask<T> {
    start(signal?: AbortSignal): Promise<T>;
}

export function runAllTasks<T>(
    tasks: ITask<T>[],
    concurrency: number,
    signal?: AbortSignal
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
                runningTasks[index] = taskToRun.start(signal);
                runningTasks[index].then(runPromise, reject);
            } else if (index === tasks.length) {
                Promise.all(runningTasks).then(resolve, reject);
            }
        }
    });
}
