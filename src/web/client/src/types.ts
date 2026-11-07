export type TaskStatus = 'idle' | 'running' | 'completed' | 'error' | 'aborted';

export type { ItemStatus, TaskItem, LogEntry, ProgressInfo } from '../../../contracts/console.ts';
import type { ItemStatus, TaskItem, LogEntry, ProgressInfo } from '../../../contracts/console.ts';

export interface ConsoleState {
    status: TaskStatus;
    progress: ProgressInfo;
    currentItem: (Pick<TaskItem, 'index' | 'keyword'> & Partial<TaskItem>) | null;
    items: TaskItem[];
    logs: LogEntry[];
    copyUrls: string[];
    roiRatio: string;
    paidTemplate?: '超超小额' | '超小额' | '小额' | '中额';
    taskNamePrefix?: string;
    dailyBudget?: string;
    startedAt: number | null;
    finishedAt: number | null;
    lastError: string | null;
    health?: { status: 'ready' | 'faulted'; reason: string | null; faultedAt: number | null };
}

export interface EnvTopology {
    freeList: boolean;
    stagePage: boolean;
}

export interface EnvTab {
    id: string;
    title: string;
    url: string;
}

export interface EnvInfo {
    cdpConnected: boolean;
    browserName: string;
    topology: EnvTopology;
    requiresFreeList: boolean;
    tabs: EnvTab[];
}

export const TASK_STATUS_LABELS: Record<ItemStatus, string> = {
    pending: '等待中',
    running: '运行中',
    filled: '已填写，待提交',
    submitting: '提交中',
    success: '已提交',
    failed: '失败',
    uncertain: '结果不确定，需核对',
};
