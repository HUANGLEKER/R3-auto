import type {RunAutomationOptions} from '../runner.ts';
import {
    findStageConflicts,
    isStageNativeContentUnverified,
    removeStageTasks,
    closeSubmittedStageTab,
    type FilledStageTask,
    type StageSubmitResult
} from '../platform/stage_submit.ts';
import type {StagePort} from '../contracts/platform.ts';
import {writeStructuredLog} from '../core/structured_log.ts';
import {recordConflictDramas} from '../core/conflict_guard.ts';
import {dismissStagePageToasts} from '../platform/stage_save.ts';
import {lockPageActive} from '../platform/cdp.ts';
import {setTimeout as delay} from 'node:timers/promises';

export interface PageState {
    submitStatus: 'pending' | 'submitting' | 'submitted' | 'empty' | 'skipped' | 'uncertain' | 'deferred';
    replacementSlots: number[];
    fillUncertain: boolean;
    taskNameConfigured?: boolean;
    budgetConfigured?: boolean;
}

export interface PageContext {
    stageStates: PageState[];
    activeStageTabIndex: number;
    currentSubtaskInTab: number;
    stageCapacities: number[];
    options?: RunAutomationOptions;
    submitStagePage: StagePort['submit'];
    fillStageUnifiedDailyBudget?: (page: any, dailyBudget: string, signal?: AbortSignal) => Promise<void>;
    stagePages: unknown[];
    filledTasks: FilledStageTask[];
    successCount: number;
    keywords: string[];
    processedCount: number;
    failedDramas: Array<{ keyword: string; reason: string }>;

    nextEmptySlot(): number;

    delay?: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
    hasSubsequentDramas?: () => boolean;
    closeSubmittedStageTab?: typeof closeSubmittedStageTab;
}

/** Serializes page confirmation and conflict batches; sent requests are never retried on uncertainty. */
export class PageCoordinator {
    private context: PageContext;

    constructor(context: PageContext) {
        this.context = context;
    }

    async submit(): Promise<void> {
        const activeState = this.context.stageStates[this.context.activeStageTabIndex];
        const activeCapacity = this.context.stageCapacities[this.context.activeStageTabIndex] ?? 0;
        const activeFull = Boolean(activeState && this.context.currentSubtaskInTab > activeCapacity);
        const hasSubsequent = this.context.hasSubsequentDramas ? this.context.hasSubsequentDramas() : false;
        const noMoreDramas = !hasSubsequent;

        // 等新 Tab 所有子任务搭完后（activeFull），或者待搭剧目已用尽（noMoreDramas）时，再次提交先前暂缓的 Tab
        if (activeFull || noMoreDramas) {
            let submittedDeferred = false;
            for (let i = 0; i < this.context.stageStates.length; i++) {
                if ((noMoreDramas || i !== this.context.activeStageTabIndex) && this.context.stageStates[i]?.submitStatus === 'deferred') {
                    console.log(`🔄 ${noMoreDramas ? '待搭剧目已用尽' : '新 Tab 所有子任务已搭完'}，再次提交先前暂缓的第 ${i + 1} 页...`);
                    await this.submitTab(i, false);
                    submittedDeferred = true;
                }
            }
            if (submittedDeferred) {
                const activePage = this.context.stagePages[this.context.activeStageTabIndex] as any;
                await lockPageActive(activePage).catch(() => {});
            }
        }

        if (!activeState) return;
        // 如果当前页面状态不需要提交或尚未填满，则返回
        if (['submitted', 'empty', 'skipped', 'submitting', 'uncertain'].includes(activeState.submitStatus) ||
            activeState.replacementSlots.length ||
            this.context.currentSubtaskInTab <= activeCapacity) {
            return;
        }

        await this.submitTab(this.context.activeStageTabIndex, !noMoreDramas);
    }

    private async submitTab(tabIndex: number, allowDefer: boolean): Promise<void> {
        const pageState = this.context.stageStates[tabIndex];
        if (!pageState) return;
        if (['submitted', 'empty', 'skipped', 'submitting', 'uncertain'].includes(pageState.submitStatus)) return;
        if (pageState.replacementSlots.length) return;
        if (tabIndex === this.context.activeStageTabIndex &&
            this.context.currentSubtaskInTab <= this.context.stageCapacities[tabIndex]) return;
        if (pageState.fillUncertain) {
            throw Object.assign(new Error('存在未核验的槽位，禁止提交'), {code: 'STAGE_TASK_BLOCKING_FAILURE'});
        }
        const page = this.context.stagePages[tabIndex] as any;
        await lockPageActive(page).catch(() => {});

        // 流程2：所有子任务剧搭完后，在确认提交前进入“项目统一配置”填写项目日预算并确定
        const dailyBudget = this.context.options?.dailyBudget?.trim();
        if (dailyBudget && this.context.fillStageUnifiedDailyBudget && !pageState.budgetConfigured) {
            this.context.options?.abortSignal?.throwIfAborted();
            this.context.options?.onItemPhase?.({
                index: 0,
                keyword: '',
                phase: 'submitting',
                description: `第 ${tabIndex + 1} 页填写项目日预算 (${dailyBudget}元)`
            });
            await this.context.fillStageUnifiedDailyBudget(page, dailyBudget, this.context.options?.abortSignal);
            pageState.budgetConfigured = true;
            writeStructuredLog('STAGE_UNIFIED_BUDGET_CONFIGURED', { tabIndex: tabIndex + 1, dailyBudget });
        }

        this.context.options?.abortSignal?.throwIfAborted();
        this.context.options?.onItemPhase?.({
            index: 0,
            keyword: '',
            phase: 'submitting',
            description: `第 ${tabIndex + 1} 页整页提交`
        });

        pageState.submitStatus = 'submitting';
        this.context.options?.onPageSubmission?.({tabIndex: tabIndex + 1, status: 'submitting'});
        console.log(`📤 搭剧第 ${tabIndex + 1} 页已搭满，自动确认提交`);

        const delayFn = this.context.delay ?? delay;
        let result: StageSubmitResult;
        let retryAttempt = 0;
        while (true) {
            this.context.options?.abortSignal?.throwIfAborted();
            try {
                result = await this.context.submitStagePage(page, this.context.options?.abortSignal);
            } catch (error: any) {
                if (error?.code === 'STAGE_SUBMIT_NOT_STARTED') {
                    pageState.submitStatus = 'pending';
                    this.context.options?.onPageSubmission?.({tabIndex: tabIndex + 1, status: 'filled'});
                } else {
                    pageState.submitStatus = 'uncertain';
                    this.context.options?.onPageSubmission?.({
                        tabIndex: tabIndex + 1,
                        status: 'uncertain',
                        reason: error.message
                    });
                }
                throw error;
            }
            writeStructuredLog('STAGE_PAGE_SUBMIT_RESULT', {tabIndex: tabIndex + 1, ...result});

            if (result.kind === 'retryable') {
                const isNativeContentUnverified = isStageNativeContentUnverified(result.message);
                const hasMore = this.context.hasSubsequentDramas ? this.context.hasSubsequentDramas() : false;

                if (allowDefer && isNativeContentUnverified && hasMore) {
                    console.log(`⏳ 搭剧第 ${tabIndex + 1} 页提交遇到原生内容未核实（${result.message}），暂缓本页提交，将复制搭剧任务链接到新 Tab 搭建后续剧，待新 Tab 所有子任务搭完后再次提交`);
                    this.context.options?.onItemPhase?.({
                        index: 0,
                        keyword: '',
                        phase: 'submitting',
                        description: '原生内容未核实，暂缓提交并切换新Tab',
                    });
                    await dismissStagePageToasts(page);
                    pageState.submitStatus = 'deferred';
                    this.context.options?.onPageSubmission?.({tabIndex: tabIndex + 1, status: 'filled'});
                    writeStructuredLog('STAGE_PAGE_SUBMIT_DEFERRED', {tabIndex: tabIndex + 1, reason: result.message});
                    return;
                }

                retryAttempt++;
                const baseMs = this.context.options?.submitBackoffBaseMs ?? 3000;
                const maxMs = this.context.options?.submitBackoffMaxMs ?? 20000;
                const expCap = Math.min(maxMs, baseMs * Math.pow(2, Math.min(retryAttempt - 1, 4)));
                const delayMs = Math.round(baseMs / 2 + Math.random() * expCap);

                console.log(`⏳ 整页提交遇到渠道 QPS 限流（${result.message}），使用退避算法等待 ${(delayMs / 1000).toFixed(2)}s 后重新提交 (第 ${retryAttempt} 次)...`);
                this.context.options?.onItemPhase?.({
                    index: 0,
                    keyword: '',
                    phase: 'submitting',
                    description: `渠道限流退避重试(第${retryAttempt}次，等待${(delayMs / 1000).toFixed(1)}s)`,
                });

                await dismissStagePageToasts(page);
                try {
                    await delayFn(delayMs, undefined, this.context.options?.abortSignal ? {signal: this.context.options.abortSignal} : undefined);
                } catch (error) {
                    if (this.context.options?.abortSignal?.aborted) {
                        pageState.submitStatus = 'pending';
                        this.context.options?.onPageSubmission?.({tabIndex: tabIndex + 1, status: 'filled'});
                    }
                    throw error;
                }
                await dismissStagePageToasts(page);
                continue;
            }
            break;
        }

        writeStructuredLog('STAGE_PAGE_SUBMIT_RESULT', {tabIndex: tabIndex + 1, ...result});
        if (result.kind === 'blocked') {
            pageState.submitStatus = 'uncertain';
            this.context.options?.onPageSubmission?.({
                tabIndex: tabIndex + 1,
                status: 'uncertain',
                reason: result.message
            });
            throw new Error(result.message);
        }
        if (result.kind === 'success') {
            pageState.submitStatus = 'submitted';
            for (const task of this.context.filledTasks.filter(task => task.tabIndex === tabIndex + 1)) {
                this.context.successCount++;
                this.context.options?.onItemSuccess?.({
                    index: task.inputIndex!, total: this.context.keywords.length, keyword: task.keyword,
                    name: task.dramaName, seriesId: task.seriesId, douyinId: task.douyinId,
                    tabIndex: task.tabIndex, subtaskIndex: task.subtaskIndex, durationMs: task.durationMs || 0
                });
                writeStructuredLog('ITEM_SUCCESS', {
                    index: task.inputIndex,
                    keyword: task.keyword,
                    tabIndex: task.tabIndex
                });
            }
            this.context.options?.onProgress?.({
                current: this.context.processedCount, total: this.context.keywords.length,
                percentage: Math.round(this.context.processedCount / this.context.keywords.length * 100),
                successCount: this.context.successCount, failedCount: this.context.failedDramas.length
            });
            console.log(`✅ 搭剧第 ${tabIndex + 1} 页提交成功`);
            if (tabIndex !== this.context.activeStageTabIndex) {
                const closeFn = this.context.closeSubmittedStageTab ?? closeSubmittedStageTab;
                await closeFn(page, tabIndex + 1, '先前暂缓');
            }
            return;
        }

        let conflicts: FilledStageTask[];
        try {
            conflicts = findStageConflicts(this.context.filledTasks, tabIndex + 1, result.displayedDramaIds);
        } catch (error) {
            pageState.submitStatus = 'uncertain';
            this.context.options?.onPageSubmission?.({
                tabIndex: tabIndex + 1,
                status: 'uncertain',
                reason: '冲突剧目无法匹配，请核对平台任务。'
            });
            throw error;
        }

        // 记录服务器返回的重复剧冲突条目（剧目 + 抖音号）
        const dramaNameMap: Record<string, string> = {};
        for (const task of this.context.filledTasks) {
            if (task.douyinId) dramaNameMap[task.douyinId] = task.dramaName;
            if (task.seriesId) dramaNameMap[task.seriesId] = task.dramaName;
            if (task.keyword) dramaNameMap[task.keyword] = task.dramaName;
        }
        const newlyRecorded = recordConflictDramas(result.displayedDramaIds, result.message, {dramaNameMap});
        if (newlyRecorded > 0) {
            console.log(`📝 已记录 ${newlyRecorded} 条服务器返回的重复剧冲突（剧目+抖音号）到冲突预检库`);
        }
        await dismissStagePageToasts(page);
        this.context.options?.onPageSubmission?.({tabIndex: tabIndex + 1, status: 'filled'});
        pageState.submitStatus = 'pending';
        pageState.replacementSlots = conflicts.map(task => task.subtaskIndex).sort((a, b) => a - b);
        console.log(`🔄 本次响应展示 ${result.displayedDramaIds.length} 部重复剧，对应 ${conflicts.length} 个子任务；仅处理这些子任务后再提交，其余保持不动`);
        writeStructuredLog('STAGE_CONFLICT_BATCH', {
            scope: 'displayed_response_only',
            tabIndex: tabIndex + 1,
            displayedDramaIds: result.displayedDramaIds,
            slots: [...pageState.replacementSlots],
            remainingInputs: Math.max(0, this.context.keywords.length - this.context.processedCount),
        });
        for (const task of conflicts) {
            this.context.filledTasks.splice(this.context.filledTasks.indexOf(task), 1);
            this.context.failedDramas.push({keyword: task.keyword, reason: result.message});
            this.context.options?.onItemFailure?.({
                index: task.inputIndex!, total: this.context.keywords.length, keyword: task.keyword,
                reason: result.message, tabIndex: task.tabIndex, subtaskIndex: task.subtaskIndex, durationMs: 0
            });
            console.log(`🔄 剧目【${task.dramaName}】重复，第 ${task.subtaskIndex} 个槽位优先由后续待搭剧递补，待搭剧用尽后删除`);
        }
        if (tabIndex === this.context.activeStageTabIndex) {
            this.context.currentSubtaskInTab = this.context.nextEmptySlot();
        } else {
            // 如果是先前暂缓的 Tab 发生冲突，且后续剧已在更新的 Tab 搭建，直接删除冲突槽位并重提
            if (pageState.replacementSlots.length) {
                console.log(`🗑️ 第 ${tabIndex + 1} 页待搭剧已用尽，批量删除剩余 ${pageState.replacementSlots.length} 个冲突子任务后再次提交`);
                await removeStageTasks(page, pageState.replacementSlots, this.context.stageCapacities[tabIndex], this.context.options?.abortSignal,
                    async (remaining, slot) => {
                        this.context.stageCapacities[tabIndex] = remaining;
                        for (const task of this.context.filledTasks.filter(t => t.tabIndex === tabIndex + 1 && t.subtaskIndex > slot)) {
                            task.subtaskIndex--;
                        }
                        pageState.replacementSlots = pageState.replacementSlots.filter(v => v !== slot).map(v => v > slot ? v - 1 : v);
                    });
                const remaining = this.context.filledTasks.filter(t => t.tabIndex === tabIndex + 1).length;
                if (!remaining) {
                    pageState.submitStatus = 'empty';
                    writeStructuredLog('STAGE_PAGE_EMPTY', {
                        tabIndex: tabIndex + 1,
                        reason: '所有已填写剧目均被平台判定重复'
                    });
                    return;
                }
                await this.submitTab(tabIndex, false);
                return;
            }
        }
        this.context.options?.onProgress?.({
            current: this.context.processedCount, total: this.context.keywords.length,
            percentage: Math.round(this.context.processedCount / this.context.keywords.length * 100),
            successCount: this.context.successCount, failedCount: this.context.failedDramas.length
        });
    }
}
