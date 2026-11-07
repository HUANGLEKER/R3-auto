export type { ItemStatus as TaskStatus } from '../contracts/console.ts';
import type { ItemStatus as TaskStatus } from '../contracts/console.ts';

export const taskStatusLabels: Record<TaskStatus, string> = {
    pending: '等待中', running: '运行中', filled: '已填写，待提交', submitting: '提交中',
    success: '已提交', failed: '失败', uncertain: '结果不确定，需核对',
};

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
    // 重复剧预检可能在 onItemStart 之前直接拦截任务。
    pending: ['running', 'failed'],
    running: ['pending', 'filled', 'failed', 'uncertain'],
    filled: ['submitting', 'failed'],
    submitting: ['success', 'filled', 'uncertain'],
    success: [], failed: [], uncertain: [],
};

/** Terminal states cannot be silently rewritten or counted twice. */
export function transitionTask(item: { status: TaskStatus }, next: TaskStatus): void {
    if (item.status === next) return;
    if (!transitions[item.status].includes(next)) {
        throw new Error(`无效任务状态转换：${item.status} -> ${next}`);
    }
    item.status = next;
}
