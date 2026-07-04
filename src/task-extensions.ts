type Task = () => Promise<void>;

export function runAllTasks(tasks: Task[], concurrency: number) {
    return new Promise((resolve, reject) => {
        let counter = 0;
        const runningTasks: Promise<void>[] = [];

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