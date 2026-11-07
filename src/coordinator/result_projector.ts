import {transitionTask} from '../core/task_state.ts';
import type {TaskItem, ItemStatus, ProgressInfo} from '../contracts/console.ts';

/** Updates the query projection and counters without rescanning the input list. */
export class ResultProjector {
    readonly items: Map<number, TaskItem>;
    private progress: ProgressInfo;

    constructor(items: TaskItem[], progress: ProgressInfo) {
        this.items = new Map(items.map(item => [item.index, item]));
        this.progress = progress;
    }

    transition(item: TaskItem, status: ItemStatus): void {
        const previous = item.status;
        transitionTask(item, status);
        if (previous === status) return;
        if (previous === 'success') this.progress.successCount--;
        if (previous === 'failed') this.progress.failedCount--;
        if (status === 'success') this.progress.successCount++;
        if (status === 'failed') this.progress.failedCount++;
    }
}
