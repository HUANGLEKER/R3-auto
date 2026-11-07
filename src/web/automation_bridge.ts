// ============================================================
// Web Automation Bridge & State Manager
// ============================================================

import { run } from '../runner.ts';
import { readKeywords, readCopyPageUrls, readRoiRatio } from '../core/paths.ts';
import { addLogListener } from '../core/logger.ts';
import { writeStructuredLog } from '../core/structured_log.ts';
import { startRequestSchema, runConfigSchema, parseInput } from '../core/validation.ts';
import type { TaskStatus } from '../core/task_state.ts';
import { ResultProjector } from '../coordinator/result_projector.ts';
import { newRunId, withRunContext, processSessionId } from '../core/run_context.ts';
import { getAuditStore } from '../core/audit_store.ts';
import { getServiceHealth, onServiceFault, faultService } from '../core/service_health.ts';
import type { ConsoleEvent, ConsolePatch, RunPhase, TaskItem } from '../contracts/console.ts';

export type TaskItemState = TaskItem;

export interface AutomationBridgeState {
    health?: ReturnType<typeof getServiceHealth>;
    status: 'idle' | 'running' | 'completed' | 'error' | 'aborted';
    startedAt: number | null;
    finishedAt: number | null;
    progress: {
        current: number;
        total: number;
        percentage: number;
        successCount: number;
        failedCount: number;
    };
    currentItem: {
        index: number;
        keyword: string;
        tabIndex: number;
        subtaskIndex: number;
    } | null;
    items: TaskItemState[];
    logs: Array<{
        time: string;
        tag: string;
        level: 'info' | 'warn' | 'error';
        text: string;
    }>;
    summary: {
        total: number;
        successCount: number;
        failedCount: number;
        failedDramas: Array<{ keyword: string; reason: string }>;
        untouchedTasks: Array<{ tabIndex: number; subtaskIndex: number }>;
        totalDurationMs: number;
        stageTabCount: number;
    } | null;
    lastError: string | null;
}

export type EventSubscriber = (eventType: string, data: any) => void;

export class AutomationBridge {
    private state: AutomationBridgeState = {
        status: 'idle',
        startedAt: null,
        finishedAt: null,
        progress: {
            current: 0,
            total: 0,
            percentage: 0,
            successCount: 0,
            failedCount: 0,
        },
        currentItem: null,
        items: [],
        logs: [],
        summary: null,
        lastError: null,
    };

    private subscribers = new Set<EventSubscriber>();
    private abortController: AbortController | null = null;
    private maxLogs = 500;
    private shuttingDown = false;

    private executeRun: typeof run;
    private runId = processSessionId;
    private seq = 0;
    private eventSubscribers = new Set<(event: ConsoleEvent) => void>();
    private projector = new ResultProjector(this.state.items, this.state.progress);
    private get itemIndex() { return this.projector.items; }
    private pageIndex = new Map<number, Set<TaskItemState>>();
    private pendingLogs: AutomationBridgeState['logs'] = [];
    private logTimer?: ReturnType<typeof setTimeout>;

    constructor(executeRun: typeof run = run) {
        this.executeRun = executeRun;
        getAuditStore();
        onServiceFault(health => {
            this.abortController?.abort(new Error(health.reason || '服务故障'));
            this.patch({ health, lastError: health.reason });
        });
        // Hook system-wide logger
        addLogListener(entry => {
            this.state.logs.push(entry);
            if (this.state.logs.length > this.maxLogs) {
                this.state.logs.shift();
            }
            this.emit('log', entry);
            this.pendingLogs.push(entry);
            if (this.pendingLogs.length >= this.maxLogs) this.flushLogs();
            else if (!this.logTimer) {
                this.logTimer = setTimeout(() => this.flushLogs(), 100);
                this.logTimer.unref();
            }
        });
    }

    public getState(): AutomationBridgeState {
        return {
            ...this.state,
            health: getServiceHealth(),
            logs: [...this.state.logs],
            progress: { ...this.state.progress },
            items: this.state.items.map(item => ({ ...item })),
        };
    }

    public subscribe(cb: EventSubscriber): () => void {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
    }
    public subscribeEvents(callback: (event: ConsoleEvent) => void): () => void {
        this.eventSubscribers.add(callback); return () => this.eventSubscribers.delete(callback);
    }
    public getRunId(): string { return this.runId; }
    public snapshotEvent(): ConsoleEvent {
        this.flushLogs();
        return { protocolVersion: 1, runId: this.runId, seq: this.seq, kind: 'snapshot', data: this.getState() };
    }
    private protocol<K extends ConsoleEvent['kind']>(kind: K, data: Extract<ConsoleEvent, { kind: K }>['data']): void {
        if (kind !== 'logs') this.flushLogs();
        const event = { protocolVersion: 1, runId: this.runId, seq: ++this.seq, kind, data } as ConsoleEvent;
        for (const subscriber of this.eventSubscribers) { try { subscriber(event); } catch (_) {} }
    }
    private patch(data: ConsolePatch): void {
        this.flushLogs();
        if (this.state.status === 'running' || this.state.startedAt) {
            const { items: _items, logs: _logs, ...header } = this.state;
            try { getAuditStore().event(this.runId, this.seq + 1, 'patch', data, data.items, header); }
            catch (error) { faultService(error); if (this.state.status === 'running') throw error; }
        }
        this.protocol('patch', data);
        this.emit('state_patch', data);
    }
    private updateItem(item: TaskItemState, status: TaskStatus): void {
        this.projector.transition(item, status);
    }
    private itemPatch(item?: TaskItemState, moveToEnd?: number): void {
        this.patch({ items: item ? [{ ...item }] : [], moveToEnd, currentItem: this.state.currentItem, progress: { ...this.state.progress } });
    }
    private phase(phase: RunPhase, index?: number): void { this.protocol('phase', { phase, index }); }
    private flushLogs(): void {
        if (this.logTimer) clearTimeout(this.logTimer);
        this.logTimer = undefined;
        if (!this.pendingLogs.length) return;
        const entries = this.pendingLogs; this.pendingLogs = [];
        this.protocol('logs', entries);
    }

    private emit(type: string, payload: any): void {
        for (const subscriber of this.subscribers) {
            try {
                subscriber(type, payload);
            } catch (_) {}
        }
    }

    public async start(options?: {
        keywords?: string[];
        copyPageUrls?: string[];
        roiRatio?: string;
        paidTemplate?: '超超小额' | '超小额' | '小额' | '中额';
        taskNamePrefix?: string;
        dailyBudget?: string;
    }): Promise<{ ok: boolean; message: string }> {
        if (getServiceHealth().status === 'faulted') return { ok: false, message: `后台服务故障，请重启并核对历史结果：${getServiceHealth().reason}` };
        if (this.shuttingDown) return { ok: false, message: '后台服务正在退出，不能启动新任务。' };
        if (this.state.status === 'running') {
            return { ok: false, message: '自动化任务已在运行中，请勿重复启动。' };
        }

        try { options = parseInput(startRequestSchema, options ?? {}); }
        catch (error: any) { return { ok: false, message: error.message }; }

        const savedConfig = getAuditStore().config();
        let effectiveKeywords: string[] = [];
        let effectiveCopyUrls: string[] = [];
        let effectiveRoiRatio = '';
        let effectivePaidTemplate: '超超小额' | '超小额' | '小额' | '中额' | undefined =
            options?.paidTemplate || (savedConfig?.paidTemplate as any) || undefined;
        let effectiveTaskNamePrefix: string =
            options?.taskNamePrefix !== undefined
                ? String(options.taskNamePrefix).trim()
                : (typeof savedConfig?.taskNamePrefix === 'string' ? String(savedConfig.taskNamePrefix).trim() : '');
        let effectiveDailyBudget: string =
            options?.dailyBudget !== undefined
                ? String(options.dailyBudget).trim()
                : (typeof savedConfig?.dailyBudget === 'string' ? String(savedConfig.dailyBudget).trim() : '');

        try {
            if (options?.keywords && options.keywords.length > 0) {
                effectiveKeywords = options.keywords;
            } else {
                effectiveKeywords = readKeywords();
            }
        } catch (err: any) {
            return { ok: false, message: `读取待处理剧名失败: ${err.message}` };
        }

        try {
            if (options?.copyPageUrls && options.copyPageUrls.length > 0) {
                effectiveCopyUrls = options.copyPageUrls;
            } else {
                effectiveCopyUrls = readCopyPageUrls();
            }
        } catch (err: any) {
            return { ok: false, message: `读取搭剧复制链接失败: ${err.message}` };
        }

        try {
            effectiveRoiRatio = (options?.roiRatio && String(options.roiRatio).trim()) || readRoiRatio();
        } catch (err: any) {
            return { ok: false, message: `读取全域ROI系数失败: ${err.message}` };
        }

        if (effectiveKeywords.length === 0) {
            return { ok: false, message: '待处理剧名列表为空，请先输入至少一部剧名。' };
        }

        if (effectiveCopyUrls.length === 0) {
            return { ok: false, message: '搭剧复制链接为空，请先添加至少一条链接。' };
        }

        try {
            const config = parseInput(runConfigSchema, {
                keywords: effectiveKeywords,
                copyPageUrls: effectiveCopyUrls,
                roiRatio: effectiveRoiRatio,
                paidTemplate: effectivePaidTemplate,
                taskNamePrefix: effectiveTaskNamePrefix,
                dailyBudget: effectiveDailyBudget,
            });
            effectiveKeywords = config.keywords;
            effectiveCopyUrls = config.copyPageUrls;
            effectiveRoiRatio = config.roiRatio;
            effectivePaidTemplate = config.paidTemplate;
            effectiveTaskNamePrefix = config.taskNamePrefix ?? '';
            effectiveDailyBudget = config.dailyBudget ?? '';
        } catch (error: any) { return { ok: false, message: error.message }; }

        const controller = new AbortController();
        this.abortController = controller;

        // Initialize state
        this.state.status = 'running';
        this.state.startedAt = Date.now();
        this.state.finishedAt = null;
        this.state.lastError = null;
        this.state.summary = null;
        this.state.progress = {
            current: 0,
            total: effectiveKeywords.length,
            percentage: 0,
            successCount: 0,
            failedCount: 0,
        };
        this.state.currentItem = null;
        this.state.items = effectiveKeywords.map((kw, idx) => ({
            index: idx + 1,
            keyword: kw,
            status: 'pending',
        }));
        this.flushLogs();
        this.runId = newRunId(); this.seq = 0;
        this.projector = new ResultProjector(this.state.items, this.state.progress);
        this.pageIndex.clear();
        try {
            getAuditStore().beginRun(this.runId, this.state, {
                keywords: effectiveKeywords,
                copyPageUrls: effectiveCopyUrls,
                roiRatio: effectiveRoiRatio,
                paidTemplate: effectivePaidTemplate,
                taskNamePrefix: effectiveTaskNamePrefix,
                dailyBudget: effectiveDailyBudget,
            });
        }
        catch (error: any) { this.state.status = 'error'; this.abortController = null; return { ok: false, message: `运行审计写入失败：${error.message}` }; }
        this.protocol('snapshot', this.getState());

        this.emit('state_change', this.getState());

        // Execute runner asynchronously
        withRunContext(this.runId, async () => {
            try {
                await this.executeRun({
                    keywords: effectiveKeywords,
                    copyPageUrls: effectiveCopyUrls,
                    roiRatio: effectiveRoiRatio,
                    paidTemplate: effectivePaidTemplate,
                    taskNamePrefix: effectiveTaskNamePrefix,
                    dailyBudget: effectiveDailyBudget,
                    abortSignal: controller.signal,
                    skipSignalHandlers: true,
                    runId: this.runId,
                    onItemPhase: info => this.phase(info.phase, info.index),
                    onItemStart: info => {
                        this.state.currentItem = {
                            index: info.index,
                            keyword: info.keyword,
                            tabIndex: info.tabIndex,
                            subtaskIndex: info.subtaskIndex,
                        };
                        const target = this.itemIndex.get(info.index);
                        if (target) {
                            this.updateItem(target, 'running');
                            target.tabIndex = info.tabIndex;
                            target.subtaskIndex = info.subtaskIndex;
                            if (!this.pageIndex.has(info.tabIndex)) this.pageIndex.set(info.tabIndex, new Set());
                            this.pageIndex.get(info.tabIndex)!.add(target);
                        }
                        this.emit('item_start', info);
                        this.itemPatch(target);
                    },
                    onItemFilled: info => {
                        const target = this.itemIndex.get(info.index);
                        if (target) {
                            this.updateItem(target, 'filled');
                            target.name = info.name;
                            target.seriesId = info.seriesId;
                            target.douyinId = info.douyinId;
                            target.tabIndex = info.tabIndex;
                            target.subtaskIndex = info.subtaskIndex;
                            target.durationMs = info.durationMs;
                        }
                        this.emit('item_filled', info);
                        this.itemPatch(target);
                    },
                    onItemDeferred: info => {
                        const target = this.itemIndex.get(info.index);
                        if (target) {
                            this.updateItem(target, 'pending');
                            target.tabIndex = undefined;
                            target.subtaskIndex = undefined;
                            this.state.items.splice(this.state.items.indexOf(target), 1);
                            this.state.items.push(target);
                        }
                        this.state.currentItem = null;
                        this.emit('item_deferred', info);
                        this.itemPatch(target, target?.index);
                    },
                    onPageSubmission: info => {
                        const changed: TaskItemState[] = [];
                        for (const item of this.pageIndex.get(info.tabIndex) ?? []) {
                            if (item.tabIndex !== info.tabIndex || !['filled', 'submitting'].includes(item.status)) continue;
                            this.updateItem(item, info.status);
                            item.error = info.reason;
                            changed.push({ ...item });
                        }
                        getAuditStore().operation(this.runId, `page:${info.tabIndex}`, info.status, info);
                        this.patch({ items: changed });
                    },
                    onItemSuccess: info => {
                        const target = this.itemIndex.get(info.index);
                        if (target) this.updateItem(target, 'success');
                        getAuditStore().operation(this.runId, `page:${info.tabIndex}`, 'success', { tabIndex: info.tabIndex });
                        this.emit('item_success', info);
                        this.itemPatch(target);
                    },
                    onItemFailure: info => {
                        const target = this.itemIndex.get(info.index);
                        if (target) {
                            // 已填写记录保留填写时的位置和耗时。冲突删除会使平台槽位前移，
                            // 失败回调中的实时槽位不能覆盖历史记录（与成功回调保持一致）。
                            const wasFilled = target.status === 'filled';
                            this.updateItem(target, 'failed');
                            target.error = info.reason;
                            if (!wasFilled) {
                                target.tabIndex = info.tabIndex;
                                target.subtaskIndex = info.subtaskIndex;
                                target.durationMs = info.durationMs;
                            }
                        }
                        this.emit('item_failure', info);
                        this.itemPatch(target);
                    },
                    onProgress: prog => {
                        Object.assign(this.state.progress, prog);
                        this.emit('progress', prog);
                        this.patch({ progress: { ...prog } });
                    },
                    onSummary: summ => {
                        this.state.summary = summ;
                        this.emit('summary', summ);
                        this.patch({ summary: summ });
                    },
                });

                if (controller.signal.aborted) {
                    this.state.status = 'aborted';
                } else {
                    this.state.status = 'completed';
                }
            } catch (err: any) {
                this.state.status = controller.signal.aborted ? 'aborted' : 'error';
                this.state.lastError = err.message || String(err);
                const fullStack = err?.stack ? `\n${err.stack}` : '';
                console.error(`❌ 自动化执行异常: ${this.state.lastError}${fullStack}`);
                writeStructuredLog('AUTOMATION_RUN_EXCEPTION', {
                    error: this.state.lastError,
                    stack: err?.stack,
                    code: err?.code,
                });
                this.emit('error', { message: this.state.lastError });
                this.protocol('error', { message: this.state.lastError || '运行异常' });
            } finally {
                const changed: TaskItemState[] = [];
                for (const item of this.state.items) {
                    if (item.status === 'running' || item.status === 'submitting') {
                        this.updateItem(item, 'uncertain');
                        item.error = this.state.lastError || '运行已中止，请核对平台结果。';
                        changed.push({ ...item });
                    }
                }
                this.state.progress.successCount = this.state.items.filter(item => item.status === 'success').length;
                this.state.progress.failedCount = this.state.items.filter(item => item.status === 'failed').length;
                this.state.finishedAt = Date.now();
                this.state.currentItem = null;
                this.abortController = null;
                this.patch({ items: changed, status: this.state.status, finishedAt: this.state.finishedAt, currentItem: null,
                    progress: { ...this.state.progress }, lastError: this.state.lastError, health: getServiceHealth() });
                this.phase('idle');
                this.emit('state_change', this.getState());
            }
        }).catch(error => { console.error(error); });

        return { ok: true, message: `已启动 ${effectiveKeywords.length} 条漫剧自动化流程` };
    }

    public stop(): { ok: boolean; message: string } {
        if (this.state.status !== 'running') {
            return { ok: false, message: '当前没有正在运行的任务。' };
        }

        if (this.abortController) {
            this.abortController.abort();
        }

        // Keep the run busy until its current operation and lock cleanup finish.
        this.patch({ status: this.state.status });
        return { ok: true, message: '已发送终止信号，任务将在当前操作完成后安全退出。' };
    }

    public clearLogs(): void {
        if (this.logTimer) clearTimeout(this.logTimer);
        this.logTimer = undefined; this.pendingLogs = [];
        this.state.logs = [];
        this.emit('logs_cleared', {});
        this.protocol('logs_cleared', {});
    }

    public waitForIdle(): Promise<void> {
        if (this.state.status !== 'running') return Promise.resolve();
        return new Promise(resolve => {
            const unsubscribe = this.subscribe(() => {
                if (this.state.status === 'running') return;
                unsubscribe();
                resolve();
            });
        });
    }

    public shutdown(): Promise<void> {
        this.shuttingDown = true;
        this.stop();
        return this.waitForIdle();
    }
}

export const automationBridge = new AutomationBridge();
