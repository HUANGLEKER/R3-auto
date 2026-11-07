// ============================================================
// Main Execution Runner & Orchestration Lifecycle
// ============================================================

import { chromium, type Browser } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';
import { CDP_PORT, UNIFIED } from './core/config.ts';
import {
    clearRunSuccessMarker,
    writeRunSuccessMarker,
    readKeywords,
    readCopyPageUrls,
    readRoiRatio,
} from './core/paths.ts';
import { needsFreeDramaList } from './core/drama_input.ts';
import {
    reloadConflictDramaGuard,
    getDramaConflict,
    isDramaConflict,
} from './core/conflict_guard.ts';
import { installReadableConsole } from './core/logger.ts';
import {
    getStructuredLogPath,
    writeStructuredLog,
} from './core/structured_log.ts';
import {
    releaseSingleInstanceLock,
} from './core/lock.ts';
import {
    runtimeMetrics,
    seriesRuntimeCache,
    clearSeriesRuntimeCache,
} from './core/cache.ts';
import {
    elapsed,
    normalizeDouyinId,
    formatTroubleshootingAdvice,
} from './core/utils.ts';
import {
    resolveUnifiedPages,
    prepareStageCopyPage,
    preflightStageSubtasks,
    openNextStageCopyTab,
    triggerBrowserGC,
} from './platform/cdp.ts';
import {
    fillStageTaskWithReopenRetry,
    closeStageDialogIfOpen,
    fillStageBasicTaskName,
    fillStageUnifiedDailyBudget,
} from './platform/stage.ts';
import { DramaResolverPipeline } from './coordinator/resolver_pipeline.ts';
import { isQpsLimitError } from './platform/changdu_openapi.ts';
import { parseInput, runConfigSchema } from './core/validation.ts';
import { profiler } from './infra/profiler.ts';
import { submitStagePage, trimUnusedStageTasks, removeStageTasks, closeSubmittedStageTab, nextStageSlot, type FilledStageTask } from './platform/stage_submit.ts';
import { currentRunId, currentRunContext } from './core/run_context.ts';
import type { RunPhase } from './contracts/console.ts';
import { RunSession } from './core/run_session.ts';
import { QueueScheduler } from './coordinator/queue_scheduler.ts';
import { ItemProcessor } from './coordinator/item_processor.ts';
import { PageCoordinator, type PageState } from './coordinator/page_coordinator.ts';
import type { StagePort } from './contracts/platform.ts';
import { getRuntimeDiagnostics } from './core/observability.ts';

export type RunItemInfo = {
    index: number;
    total: number;
    keyword: string;
    name: string;
    seriesId: string;
    douyinId: string;
    tabIndex: number;
    subtaskIndex: number;
    durationMs: number;
};

export interface RunAutomationOptions {
    runId?: string;
    keywords?: string[];
    copyPageUrls?: string[];
    roiRatio?: string;
    paidTemplate?: string;
    taskNamePrefix?: string;
    dailyBudget?: string;
    abortSignal?: AbortSignal;
    /**
     * 若外部调用方已自行注册了 SIGINT/SIGTERM handler，
     * 设为 true 可阻止 runner 内部重复注册，避免 exit code 不一致。
     */
    skipSignalHandlers?: boolean;
    /**
     * 若设为 true，则跳过投放前基于历史冲突记录（重复剧）的预检拦截。默认为 false（执行预检并跳过重复剧）。
     */
    skipConflictPreCheck?: boolean;
    /**
     * 限流重排队的基础冷却时间（毫秒）：第 n 次重排的剧目至少等待 n × 该值后才会再次处理。
     * 其他剧目处理耗时会计入等待，默认 5000。
     */
    rateLimitCooldownMs?: number;
    /**
     * 整页确认提交遇到渠道限流/无法核实原生内容时，退避重试的基础等待时间（毫秒），默认 3000。
     */
    submitBackoffBaseMs?: number;
    /**
     * 整页确认提交遇到渠道限流退避重试的最大等待时间（毫秒），默认 20000。
     */
    submitBackoffMaxMs?: number;
    onItemStart?: (info: {
        index: number;
        total: number;
        keyword: string;
        tabIndex: number;
        subtaskIndex: number;
        batchCapacity: number;
    }) => void;
    onItemPhase?: (info: {
        index: number;
        keyword: string;
        phase: RunPhase;
        description: string;
    }) => void;
    onItemFilled?: (info: RunItemInfo) => void;
    onItemDeferred?: (info: { index: number; keyword: string; reason: string }) => void;
    onItemSuccess?: (info: RunItemInfo) => void;
    onPageSubmission?: (info: { tabIndex: number; status: 'submitting' | 'filled' | 'uncertain'; reason?: string }) => void;
    onItemFailure?: (info: {
        index: number;
        total: number;
        keyword: string;
        reason: string;
        tabIndex: number;
        subtaskIndex: number;
        durationMs: number;
    }) => void;
    onProgress?: (progress: {
        current: number;
        total: number;
        percentage: number;
        successCount: number;
        failedCount: number;
    }) => void;
    onSummary?: (summary: {
        total: number;
        successCount: number;
        failedCount: number;
        failedDramas: Array<{ keyword: string; reason: string }>;
        untouchedTasks: Array<{ tabIndex: number; subtaskIndex: number }>;
        totalDurationMs: number;
        stageTabCount: number;
    }) => void;
}

const runDependencies = {
    connectOverCDP: (url: string) => chromium.connectOverCDP(url),
    resolveUnifiedPages, prepareStageCopyPage, preflightStageSubtasks, openNextStageCopyTab, triggerBrowserGC,
    fillStageTaskWithReopenRetry, closeStageDialogIfOpen, submitStagePage, trimUnusedStageTasks, removeStageTasks,
    closeSubmittedStageTab,
    fillStageBasicTaskName,
    fillStageUnifiedDailyBudget,
    createPipeline: (options: ConstructorParameters<typeof DramaResolverPipeline>[0]) => new DramaResolverPipeline(options),
};

export type RunDependencies = Omit<typeof runDependencies, 'closeSubmittedStageTab' | 'fillStageBasicTaskName' | 'fillStageUnifiedDailyBudget'> & {
    closeSubmittedStageTab?: typeof closeSubmittedStageTab;
    fillStageBasicTaskName?: typeof fillStageBasicTaskName;
    fillStageUnifiedDailyBudget?: typeof fillStageUnifiedDailyBudget;
};

/** Dependency boundary lets lifecycle tests exercise the real runner without browser or paid operations. */
export async function run(options?: RunAutomationOptions, dependencies: RunDependencies = runDependencies): Promise<void> {
    return RunSession.execute(options?.runId, () => executeRun(options, dependencies));
}

async function executeRun(options?: RunAutomationOptions, dependencies: RunDependencies = runDependencies): Promise<void> {
    const { connectOverCDP, resolveUnifiedPages, prepareStageCopyPage, preflightStageSubtasks,
        openNextStageCopyTab, triggerBrowserGC, fillStageTaskWithReopenRetry, closeStageDialogIfOpen,
        submitStagePage, trimUnusedStageTasks, removeStageTasks, createPipeline,
        closeSubmittedStageTab: closeSubmittedStageTabDep,
        fillStageBasicTaskName: fillStageBasicTaskNameDep,
        fillStageUnifiedDailyBudget: fillStageUnifiedDailyBudgetDep } = dependencies;
    const closeTab = closeSubmittedStageTabDep ?? closeSubmittedStageTab;
    const fillBasicTaskName = fillStageBasicTaskNameDep ?? fillStageBasicTaskName;
    const fillUnifiedDailyBudget = fillStageUnifiedDailyBudgetDep ?? fillStageUnifiedDailyBudget;
    const stagePort: StagePort = { fill: fillStageTaskWithReopenRetry, submit: submitStagePage };
    const runController = new AbortController();
    options = { ...options, abortSignal: AbortSignal.any([runController.signal, ...(options?.abortSignal ? [options.abortSignal] : [])]) };
    let resolverPipeline: DramaResolverPipeline | undefined;
    let browser: Browser | undefined;
    const totalStart = Date.now();

    // 1. 初始化控制台美化
    installReadableConsole();

    // 2. 进程退出与中断时的锁清理兜底
    const session = new RunSession();
    session.acquire();
    profiler.reset();
    const profileId = currentRunId();
    const totalSpan = profiler.startSpan('full_flow_run', 'OTHER', { runId: currentRunId(), profileId });
    const _exitHandler = () => releaseSingleInstanceLock();
    process.once('exit', _exitHandler);

    // 仅当调用方未自行注册信号 handler 时才在此注册（避免外部入口重复）
    const _sigintHandler = () => {
        runController.abort(new Error('SIGINT'));
        process.exitCode = 130;
    };
    const _sigtermHandler = () => {
        runController.abort(new Error('SIGTERM'));
        process.exitCode = 143;
    };
    if (!options?.skipSignalHandlers) {
        process.once('SIGINT', _sigintHandler);
        process.once('SIGTERM', _sigtermHandler);
    }

    try {
        reloadConflictDramaGuard();
        // 3. 必须在任何业务动作之前清除旧成功标记
        clearRunSuccessMarker();

        const { keywords, copyPageUrls, roiRatio, paidTemplate, taskNamePrefix, dailyBudget } = parseInput(runConfigSchema, {
            keywords: options?.keywords ?? readKeywords(),
            copyPageUrls: options?.copyPageUrls ?? readCopyPageUrls(),
            roiRatio: options?.roiRatio ?? readRoiRatio(),
            paidTemplate: options?.paidTemplate,
            taskNamePrefix: options?.taskNamePrefix ?? '',
            dailyBudget: options?.dailyBudget ?? '',
        });
        options = { ...options, taskNamePrefix, dailyBudget };
        clearSeriesRuntimeCache();
        currentRunContext()?.resources.set('configSnapshot', { keywords: [...keywords], copyPageUrls: [...copyPageUrls], roiRatio, taskNamePrefix, dailyBudget });
        const requiresFreeList = needsFreeDramaList(keywords);
        profiler.setRunMetadata('keywordCount', keywords.length);
        profiler.setRunMetadata('copyPageUrlCount', copyPageUrls.length);
        profiler.setRunMetadata('roiRatio', roiRatio);

        console.log(
            '\n=========================================='
        );
        console.log(
            '常读 + 搭剧自动化批量搭建流程'
        );
        console.log(
            `待处理输入: ${keywords.length} 条（${requiresFreeList ? '含剧名，需漫剧列表页' : '均为 ID，直连 OpenAPI'}）`
        );
        console.log(
            `全域ROI系数: ${roiRatio}`
        );
        if (taskNamePrefix) {
            console.log(`任务名称前缀: ${taskNamePrefix} (自动拼接 -1, -2...)`);
        }
        if (dailyBudget) {
            console.log(`项目日预算: ${dailyBudget} 元`);
        }
        console.log(
            `搭剧复制链接: 共 ${copyPageUrls.length} 条（搭满后自动轮询开 Tab）`
        );

        if (!options?.skipConflictPreCheck) {
            const knownConflicts = keywords.filter(kw => isDramaConflict(kw));
            if (knownConflicts.length > 0) {
                console.log(
                    `🔍 投放前剧目冲突预检: 共 ${keywords.length} 条输入，发现 ${knownConflicts.length} 条命中服务器返回的重复剧记录，将在搭剧时自动跳过`
                );
            }
        }
        console.log(
            '=========================================='
        );

        writeStructuredLog('RUN_START', {
            keywordCount: keywords.length,
            copyPageUrls,
            copyPageUrlCount: copyPageUrls.length,
            roiRatio,
            structuredLogPath: getStructuredLogPath(),
            cacheEnabled: UNIFIED.RUNTIME_CACHE_ENABLED,
        });

        console.log(
            `📊 JSONL 结构化日志: ${getStructuredLogPath()}`
        );

        browser = await connectOverCDP(
            `http://127.0.0.1:${CDP_PORT}`
        );

        const context = browser.contexts()[0];
        if (!context) {
            throw new Error(
                '未找到 Chrome Context'
            );
        }

        const {
            freeList,
            stagePage,
        } = await resolveUnifiedPages(
            context,
            { requiresFreeList }
        );

        const stagePages: any[] = [];
        const stageCapacities: number[] = [];
        const stageStates: PageState[] = [];
        let activeStageTabIndex = 0;
        let currentSubtaskInTab = 1;
        let successCount = 0;
        const failedDramas: Array<{ keyword: string; reason: string }> = [];
        const filledTasks: FilledStageTask[] = [];
        let processedCount = 0;

        const firstUrl = copyPageUrls[0];
        const capacity = await prepareStageCopyPage(stagePage, firstUrl);
        await preflightStageSubtasks(stagePage);
        stagePages.push(stagePage);
        stageCapacities.push(capacity);
        stageStates.push({ submitStatus: 'pending', replacementSlots: [], fillUncertain: false });

        // 流程1：复制链接后进入“任务基本配置”填写任务名称（前缀 + 自增序号 1）并点击确定开始搭剧
        const hasEligibleKeyword = Boolean(options?.skipConflictPreCheck || keywords.some(kw => !isDramaConflict(kw)));
        if (taskNamePrefix && hasEligibleKeyword) {
            options?.onItemPhase?.({ index: 0, keyword: '', phase: 'filling', description: `第 1 页填写任务名称 (${taskNamePrefix}-1)` });
            const configuredTaskName = await fillBasicTaskName(stagePage, taskNamePrefix, 1, options?.abortSignal);
            stageStates[0].taskNameConfigured = true;
            writeStructuredLog('STAGE_BASIC_TASK_NAME_CONFIGURED', { tabIndex: 1, taskName: configuredTaskName });
        }

        resolverPipeline = createPipeline({
            abortSignal: options?.abortSignal,
            freeListPage: freeList,
        });
        let runAborted = false;

        let inQueueLoop = true;
        let currentQueueIndex = 0;
        const scheduler = new QueueScheduler(keywords);
        const processor = new ItemProcessor(resolverPipeline);
        const pendingItems = scheduler.items;
        const nextEmptySlot = () => nextStageSlot(filledTasks, activeStageTabIndex + 1);
        const pageCoordinator = new PageCoordinator({
            stageStates, stageCapacities, options, submitStagePage: stagePort.submit,
            fillStageUnifiedDailyBudget: fillUnifiedDailyBudget,
            stagePages, filledTasks, keywords, failedDramas, nextEmptySlot,
            closeSubmittedStageTab: closeTab,
            get activeStageTabIndex() { return activeStageTabIndex; },
            get currentSubtaskInTab() { return currentSubtaskInTab; },
            set currentSubtaskInTab(value) { currentSubtaskInTab = value; },
            get successCount() { return successCount; }, set successCount(value) { successCount = value; },
            get processedCount() { return processedCount; },
            hasSubsequentDramas: () => {
                if (!inQueueLoop) return false;
                for (let i = currentQueueIndex; i < pendingItems.length; i++) {
                    const candidate = pendingItems[i];
                    if (options?.skipConflictPreCheck || !getDramaConflict(candidate.keyword)) {
                        return true;
                    }
                }
                return false;
            },
        });
        const submitFilledPage = () => pageCoordinator.submit();
        /** 统一上报单条失败：记录失败项、结构化日志、回调与进度（事件顺序与原先内联实现一致）。 */
        const reportItemFailure = (info: {
            index: number; keyword: string; tabIndex: number; subtaskIndex: number;
            reason: string; code: string; durationMs: number; logError?: string;
        }, beforeFailureLog?: () => void): void => {
            failedDramas.push({ keyword: info.keyword, reason: info.reason });
            beforeFailureLog?.();
            writeStructuredLog('ITEM_FAILURE', {
                index: info.index, total: keywords.length, keyword: info.keyword,
                failedTab: info.tabIndex, failedSlot: info.subtaskIndex, durationMs: info.durationMs,
                error: info.logError ?? info.reason, code: info.code,
            });
            options?.onItemFailure?.({
                index: info.index, total: keywords.length, keyword: info.keyword, reason: info.reason,
                tabIndex: info.tabIndex, subtaskIndex: info.subtaskIndex, durationMs: info.durationMs,
            });
            options?.onProgress?.({
                current: ++processedCount,
                total: keywords.length,
                percentage: Math.round((processedCount / keywords.length) * 100),
                successCount,
                failedCount: failedDramas.length,
            });
        };
        for (let queueIndex = 0; queueIndex < pendingItems.length; queueIndex++) {
            currentQueueIndex = queueIndex;
            if (options?.abortSignal?.aborted) {
                console.log('\n🛑 收到终止信号，自动化流程已安全停止。');
                runAborted = true;
                resolverPipeline.abort();
                break;
            }

            const item = pendingItems[queueIndex];
            const { keyword, index: inputIndex } = item;
            await submitFilledPage();
            if (options?.abortSignal?.aborted) { runAborted = true; break; }

            // 限流重排的剧目需等到冷却结束，避免队尾立即重试再次撞上限流（已用时间计入冷却）。
            const cooldownRemaining = (item.notBefore ?? 0) - Date.now();
            if (cooldownRemaining > 0) {
                console.log(`⏳ 剧目【${keyword}】限流冷却中，等待 ${(cooldownRemaining / 1000).toFixed(1)}s 后重试`);
                try {
                    await delay(cooldownRemaining, undefined, options?.abortSignal ? { signal: options.abortSignal } : undefined);
                } catch (error) {
                    if (!options?.abortSignal?.aborted) throw error;
                    runAborted = true; resolverPipeline.abort(); break;
                }
            }

            // 投放前剧目冲突预检 (基于输入关键词/ID)
            if (!options?.skipConflictPreCheck) {
                const directConflict = getDramaConflict(keyword);
                if (directConflict) {
                    const currentTabCap = stageCapacities[activeStageTabIndex];
                    const isCurrentTabFull = currentSubtaskInTab > currentTabCap;
                    const skipTabIndex = isCurrentTabFull ? activeStageTabIndex + 2 : activeStageTabIndex + 1;
                    const skipSubtaskIndex = isCurrentTabFull ? 1 : currentSubtaskInTab;
                    const conflictReason = `重复剧预检拦截: 剧目 ${keyword} 在抖音号 ${directConflict.douyinAccount || '未知'} 下已被任务 ${directConflict.taskId || '未知'} 创建过项目，跳过搭剧`;
                    console.log(`⚠️ 剧目【${directConflict.dramaName || keyword}】命中已知重复剧记录，跳过搭剧 (抖音号: ${directConflict.douyinAccount || '未知'}, 任务: ${directConflict.taskId || '未知'})`);
                    reportItemFailure({
                        index: inputIndex + 1, keyword, tabIndex: skipTabIndex, subtaskIndex: skipSubtaskIndex,
                        reason: conflictReason, code: 'STAGE_DUPLICATE_CONFLICT_SKIPPED', durationMs: 0,
                    }, () => writeStructuredLog('ITEM_SKIPPED', {
                        index: inputIndex + 1,
                        total: keywords.length,
                        keyword,
                        reason: conflictReason,
                        dramaId: directConflict.dramaId,
                        douyinAccount: directConflict.douyinAccount,
                        taskId: directConflict.taskId,
                    }));
                    continue;
                }
            }

            const startedAt = Date.now();
            const itemSpan = profiler.startSpan(`item_${inputIndex + 1}:${keyword}`, 'OTHER', {
                index: inputIndex + 1,
                total: keywords.length,
                keyword,
            });

            // 检查当前 Tab 是否已达到其自动识别的子任务上限容量（最多 10 个）
            // 若当前 Tab 所有子任务已搭满，则按照 Excel 表里的链接循环规则 (1->2->3->1->2...) 复制链接在同一 Chrome 窗口中新建 Tab 开启新一轮搭建
            const currentTabCapacity = stageCapacities[activeStageTabIndex];
            if (currentSubtaskInTab > currentTabCapacity) {
                const nextTabNumber = activeStageTabIndex + 2; // 1-based tab number
                const nextUrlIndex = (activeStageTabIndex + 1) % copyPageUrls.length;
                const nextUrl = copyPageUrls[nextUrlIndex];

                console.log(
                    `🔄 当前第 ${activeStageTabIndex + 1} 个链接任务 (${currentTabCapacity}个子任务) 已全满，` +
                    `按 Excel 循环顺序选取第 ${nextUrlIndex + 1} 个链接复制开启新 Tab`
                );

                const newTabInfo = await openNextStageCopyTab(
                    context,
                    stagePages[activeStageTabIndex],
                    nextTabNumber,
                    nextUrl
                );

                // 当前 Tab 所有子任务已搭满且已提交成功，在新 Tab 就绪后及时关闭已成功提交的旧 Tab
                const previousTabNumber = activeStageTabIndex + 1;
                const previousPage = stagePages[activeStageTabIndex];
                if (stageStates[activeStageTabIndex]?.submitStatus === 'submitted') {
                    await closeTab(previousPage, previousTabNumber);
                }

                stagePages.push(newTabInfo.page);
                stageCapacities.push(newTabInfo.capacity);
                stageStates.push({ submitStatus: 'pending', replacementSlots: [], fillUncertain: false });
                activeStageTabIndex++;
                currentSubtaskInTab = 1;

                await preflightStageSubtasks(newTabInfo.page);

                if (taskNamePrefix) {
                    const tabSeq = activeStageTabIndex + 1;
                    options?.onItemPhase?.({ index: 0, keyword: '', phase: 'filling', description: `第 ${tabSeq} 页填写任务名称 (${taskNamePrefix}-${tabSeq})` });
                    const configuredTaskName = await fillBasicTaskName(newTabInfo.page, taskNamePrefix, tabSeq, options?.abortSignal);
                    stageStates[activeStageTabIndex].taskNameConfigured = true;
                    writeStructuredLog('STAGE_BASIC_TASK_NAME_CONFIGURED', { tabIndex: tabSeq, taskName: configuredTaskName });
                }

                writeStructuredLog('PREFLIGHT_OK', {
                    keywordCount: keywords.length,
                    batch: activeStageTabIndex + 1,
                    url: nextUrl,
                    batchSize: newTabInfo.capacity,
                });
            }

            const activeStagePage = stagePages[activeStageTabIndex];
            const activeStageBatchSize = stageCapacities[activeStageTabIndex];
            const subtaskIndex = currentSubtaskInTab;
            const tabIndex = activeStageTabIndex;

            console.log(
                `\n=== [输入 ${inputIndex + 1}/${keywords.length}] ${keyword} -> [搭剧 Tab ${tabIndex + 1} / 子任务 ${subtaskIndex}] (本 Tab 容量 ${activeStageBatchSize} 个) ===`
            );

            writeStructuredLog('ITEM_START', {
                inputIndex: inputIndex + 1,
                total: keywords.length,
                keyword,
                stageWindow: tabIndex + 1,
                stageSubtask: subtaskIndex,
            });

            options?.onItemStart?.({
                index: inputIndex + 1,
                total: keywords.length,
                keyword,
                tabIndex: tabIndex + 1,
                subtaskIndex,
                batchCapacity: activeStageBatchSize,
            });

            try {
                // 消费当前解析结果；搭剧填单期间预取下一条，最多只超前一条。
                options?.onItemPhase?.({ index: inputIndex + 1, keyword, phase: 'resolving', description: '解析并验证剧目资格' });
                const resolved = await processor.resolve(keyword, inputIndex, options?.abortSignal);

                if (!resolved.ok) {
                    throw new Error(
                        resolved.status
                    );
                }

                const douyinId = normalizeDouyinId(
                    resolved.douyinId
                );
                const seriesId = String(
                    resolved.seriesId
                );

                // 投放前剧目冲突预检 (基于解析出的作品ID/漫剧ID/剧名)
                if (!options?.skipConflictPreCheck) {
                    const resolvedConflict = getDramaConflict(douyinId) || getDramaConflict(seriesId) || (resolved.name ? getDramaConflict(resolved.name) : null);
                    if (resolvedConflict) {
                        const conflictReason = `重复剧预检拦截: 剧目【${resolved.name || keyword}】(ID:${douyinId}) 在抖音号 ${resolvedConflict.douyinAccount || '未知'} 下已被任务 ${resolvedConflict.taskId || '未知'} 创建过项目，跳过搭剧`;
                        console.log(`⚠️ 剧目【${resolved.name || keyword}】解析后命中已知重复剧记录，跳过搭剧 (抖音号: ${resolvedConflict.douyinAccount || '未知'}, 任务: ${resolvedConflict.taskId || '未知'})`);
                        itemSpan.end({ ok: false, conflict: true, reason: conflictReason });
                        reportItemFailure({
                            index: inputIndex + 1, keyword, tabIndex: tabIndex + 1, subtaskIndex,
                            reason: conflictReason, code: 'STAGE_DUPLICATE_CONFLICT_SKIPPED', durationMs: elapsed(startedAt),
                        }, () => writeStructuredLog('ITEM_SKIPPED', {
                            index: inputIndex + 1,
                            total: keywords.length,
                            keyword,
                            resolvedName: resolved.name,
                            douyinId,
                            seriesId,
                            reason: conflictReason,
                            douyinAccount: resolvedConflict.douyinAccount,
                            taskId: resolvedConflict.taskId,
                        }));
                        continue;
                    }
                }

                console.log(
                    `✅ 数据确认: 漫剧ID=${seriesId} | 抖音作品ID=${douyinId}`
                );

                console.log(
                    `   搭剧映射: Tab ${tabIndex + 1} / 子任务 ${subtaskIndex}`
                );

                const stageStartedAt = Date.now();

                writeStructuredLog('STAGE_FILL_START', {
                    index: inputIndex + 1,
                    keyword,
                    seriesId,
                    douyinId,
                    stageWindow: tabIndex + 1,
                    stageSubtask: subtaskIndex,
                });

                stageStates[tabIndex].fillUncertain = true;
                options?.onItemPhase?.({ index: inputIndex + 1, keyword, phase: 'filling', description: '填单及保存核验' });
                await stagePort.fill(
                    activeStagePage,
                    subtaskIndex,
                    activeStageBatchSize,
                    {
                        name: resolved.name || keyword,
                        douyinId,
                        roiRatio,
                        paidTemplate: paidTemplate || options?.paidTemplate || UNIFIED.PAID_TEMPLATE,
                        signal: options?.abortSignal,
                    }
                );
                stageStates[tabIndex].fillUncertain = false;

                writeStructuredLog('STAGE_FILL_SUCCESS', {
                    index: inputIndex + 1,
                    keyword,
                    seriesId,
                    stageWindow: tabIndex + 1,
                    stageSubtask: subtaskIndex,
                    durationMs: elapsed(stageStartedAt),
                });

                filledTasks.push({
                    inputIndex: inputIndex + 1,
                    tabIndex: tabIndex + 1,
                    subtaskIndex,
                    keyword,
                    dramaName: resolved.name || keyword,
                    seriesId,
                    douyinId,
                    completedAt: new Date().toISOString(),
                    durationMs: elapsed(startedAt),
                });

                console.log(
                    `✅ 搭剧填写完成: ${resolved.name || keyword} (成功占用第 ${tabIndex + 1} 个链接任务的第 ${subtaskIndex} 个子任务)`
                );
                console.log(
                    `   ⏱ 本条总耗时: ${(elapsed(startedAt) / 1000).toFixed(2)}s`
                );

                writeStructuredLog('ITEM_FILLED', {
                    index: inputIndex + 1,
                    total: keywords.length,
                    keyword,
                    resolvedName: resolved.name || keyword,
                    seriesId,
                    stageWindow: tabIndex + 1,
                    stageSubtask: subtaskIndex,
                    durationMs: elapsed(startedAt),
                    resolvedCacheHit: Boolean(resolved.cacheHit),
                });

                itemSpan.end({ ok: true, seriesId, douyinId });

                options?.onItemFilled?.({
                    index: inputIndex + 1,
                    total: keywords.length,
                    keyword,
                    name: resolved.name || keyword,
                    seriesId,
                    douyinId,
                    tabIndex: tabIndex + 1,
                    subtaskIndex,
                    durationMs: elapsed(startedAt),
                });
                options?.onProgress?.({
                    current: ++processedCount,
                    total: keywords.length,
                    percentage: Math.round((processedCount / keywords.length) * 100),
                    successCount,
                    failedCount: failedDramas.length,
                });

                // 只有当搭剧子任务填写并保存完成后，当前 Tab 内的子任务槽位才向前递推
                currentSubtaskInTab = nextEmptySlot();
                stageStates[activeStageTabIndex].replacementSlots = stageStates[activeStageTabIndex].replacementSlots.filter(slot => slot !== subtaskIndex);
                // 预取下一条，跳过已知重复剧
                let nextItemIndex = queueIndex + 1;
                while (nextItemIndex < pendingItems.length && !options?.skipConflictPreCheck && isDramaConflict(pendingItems[nextItemIndex].keyword)) {
                    nextItemIndex++;
                }
                const nextItem = pendingItems[nextItemIndex];
                if (!options?.abortSignal?.aborted && currentSubtaskInTab <= activeStageBatchSize && nextItem) {
                    resolverPipeline.prefetch(nextItem.keyword, nextItem.index);
                }
            } catch (error: any) {
                itemSpan.endWithError(error);
                if (error?.category === 'uncertain' || error?.category === 'fatal') {
                    resolverPipeline.abort();
                    throw error;
                }
                if (options?.abortSignal?.aborted && !stageStates[tabIndex].fillUncertain) {
                    runAborted = true; resolverPipeline.abort(); break;
                }
                const selectionExhausted = ['STAGE_DRAMA_SEARCH_EXHAUSTED', 'STAGE_PRODUCT_SEARCH_EXHAUSTED', 'STAGE_SUBTASK_SAVE_EXHAUSTED'].includes(error?.code);
                if (selectionExhausted) stageStates[tabIndex].fillUncertain = false;
                if (stageStates[tabIndex].fillUncertain || error?.code === 'STAGE_TASK_BLOCKING_FAILURE') {
                    resolverPipeline.abort();
                    throw Object.assign(new Error(`填单结果不确定，已停止递补与提交：${error.message}`, { cause: error }), {
                        code: 'STAGE_TASK_BLOCKING_FAILURE',
                    });
                }
                if (selectionExhausted && scheduler.deferSelection(item)) {
                    writeStructuredLog('ITEM_DEFERRED', {
                        index: inputIndex + 1, keyword, failedTab: tabIndex + 1,
                        failedSlot: subtaskIndex, reason: error.message,
                    });
                    options?.onItemDeferred?.({ index: inputIndex + 1, keyword, reason: error.message });
                    const selectionReason = error.code === 'STAGE_PRODUCT_SEARCH_EXHAUSTED'
                        ? '商品库选择失败'
                        : (error.code === 'STAGE_SUBTASK_SAVE_EXHAUSTED' ? '子任务保存失败' : '三轮搜索失败');
                    console.log(`🔄 剧目【${keyword}】${selectionReason}，移至待搭剧列表末尾；第 ${subtaskIndex} 个槽位由下一部剧递补`);
                    continue;
                }
                if (error?.code === 'STAGE_PRODUCT_SEARCH_EXHAUSTED') error.message = '商品库选择失败';

                // 针对常读 OpenAPI 限流等临时错误（解析器已按业务码标记 retryable），将该剧重新放入待搭剧列表，冷却后重试
                const isQps = error?.category === 'retryable' || isQpsLimitError(error);
                const qpsRetryCount = item.qpsRetryCount;
                const MAX_QPS_REQUEUES = 2;
                if (isQps && scheduler.deferRateLimit(item, options?.rateLimitCooldownMs ?? 5000)) {
                    const reasonText = `常读接口 QPS 达到上限，移至待搭剧列表末尾后续重试 (第 ${qpsRetryCount + 1}/${MAX_QPS_REQUEUES} 次)`;
                    writeStructuredLog('ITEM_DEFERRED', {
                        index: inputIndex + 1,
                        keyword,
                        failedTab: tabIndex + 1,
                        failedSlot: subtaskIndex,
                        reason: reasonText,
                    });
                    options?.onItemDeferred?.({
                        index: inputIndex + 1,
                        keyword,
                        reason: error.message || reasonText,
                    });
                    console.log(
                        `🔄 剧目【${keyword}】常读 QPS 达到上限，移至待搭剧列表末尾后续重试 (第 ${qpsRetryCount + 1}/${MAX_QPS_REQUEUES} 次)；第 ${subtaskIndex} 个槽位由下一部剧递补`
                    );
                    await closeStageDialogIfOpen(activeStagePage);
                    console.log(
                        `   ⏱ 本条暂缓耗时: ${(elapsed(startedAt) / 1000).toFixed(2)}s`
                    );
                    continue;
                }
                reportItemFailure({
                    index: inputIndex + 1, keyword, tabIndex: tabIndex + 1, subtaskIndex,
                    reason: error.message || '未知错误', logError: error.message, code: error?.code || '', durationMs: elapsed(startedAt),
                });

                const errorCode = error?.code ? ` [错误码: ${error.code}]` : '';
                console.log(
                    `⚠️ 剧目【${keyword}】不能搭建: ${error.message}${errorCode}`
                );
                const advice = formatTroubleshootingAdvice(error);
                if (advice) {
                    console.log(`   💡 排查建议: ${advice}`);
                }

                console.log(
                    `🔄 触发自动递补策略：搭剧第 ${tabIndex + 1} 个链接第 ${subtaskIndex} 个子任务保持待填，将由后一部剧递补搭建`
                );
                // 注意：此处故意不执行 currentSubtaskInTab++。
                // 解析失败或内容搜索耗尽均未保存当前槽位，
                // 下一条剧可递补同一槽位。

                await closeStageDialogIfOpen(
                    activeStagePage
                );
                console.log(
                    `   ⏱ 本条失败耗时: ${(elapsed(startedAt) / 1000).toFixed(2)}s`
                );
            }
        }

        inQueueLoop = false;

        if (!options?.abortSignal?.aborted) {
            // 解析失败、预检跳过或已确认放弃修改的选择失败均可正常结束空页。
            // 填单结果不确定或存在冲突槽位的页面仍需原有收尾校验。
            const activePageState = stageStates[activeStageTabIndex];
            if (!activePageState.fillUncertain && activePageState.submitStatus === 'pending' &&
                activePageState.replacementSlots.length === 0 &&
                !filledTasks.some(task => task.tabIndex === activeStageTabIndex + 1)) {
                activePageState.submitStatus = 'skipped';
                console.log('当前页没有可提交的搭建结果，已保留复制模板，本页处理完成。');
                writeStructuredLog('STAGE_PAGE_SKIPPED', {
                    tabIndex: activeStageTabIndex + 1, reason: '本页无已填写结果，解析失败、预检跳过或选择失败已放弃修改',
                });
            }
            const capacity = stageCapacities[activeStageTabIndex];
            if (currentSubtaskInTab > 1 && currentSubtaskInTab <= capacity &&
                filledTasks.filter(task => task.tabIndex === activeStageTabIndex + 1).length === currentSubtaskInTab - 1 &&
                !stageStates[activeStageTabIndex].replacementSlots.length) {
                console.log('📤 末页未搭满，移除末尾未使用的复制配置后提交已搭剧目');
                await trimUnusedStageTasks(stagePages[activeStageTabIndex], currentSubtaskInTab - 1, capacity, options?.abortSignal, async remaining => {
                    stageCapacities[activeStageTabIndex] = remaining;
                });
                stageCapacities[activeStageTabIndex] = currentSubtaskInTab - 1;
            }
            await submitFilledPage();
            const pageState = stageStates[activeStageTabIndex];
            while (pageState.submitStatus !== 'submitted' && pageState.replacementSlots.length) {
                console.log(`🗑️ 待搭剧已用尽，批量删除剩余 ${pageState.replacementSlots.length} 个冲突子任务后提交`);
                await removeStageTasks(stagePages[activeStageTabIndex], pageState.replacementSlots,
                    stageCapacities[activeStageTabIndex], options?.abortSignal, async (remaining, slot) => {
                        stageCapacities[activeStageTabIndex] = remaining;
                        for (const task of filledTasks.filter(task => task.tabIndex === activeStageTabIndex + 1 && task.subtaskIndex > slot)) task.subtaskIndex--;
                        pageState.replacementSlots = pageState.replacementSlots.filter(value => value !== slot)
                            .map(value => value > slot ? value - 1 : value);
                    });
                currentSubtaskInTab = nextEmptySlot();
                const remaining = filledTasks.filter(task => task.tabIndex === activeStageTabIndex + 1).length;
                if (!remaining) {
                    pageState.submitStatus = 'empty';
                    console.log('当前页剧目均重复，冲突子任务已删除，无需再次提交。');
                    writeStructuredLog('STAGE_PAGE_EMPTY', { tabIndex: activeStageTabIndex + 1, reason: '所有已填写剧目均被平台判定重复' });
                    break;
                }
                if (currentSubtaskInTab <= stageCapacities[activeStageTabIndex] && currentSubtaskInTab === remaining + 1) {
                    await trimUnusedStageTasks(stagePages[activeStageTabIndex], remaining, stageCapacities[activeStageTabIndex], options?.abortSignal,
                        async count => { stageCapacities[activeStageTabIndex] = count; });
                }
                await submitFilledPage();
            }
        }

        // 关闭所有已成功提交的 Tab（包含末页及此前成功提交的页面）
        for (let i = 0; i < stageStates.length; i++) {
            if (stageStates[i]?.submitStatus === 'submitted') {
                const page = stagePages[i];
                await closeTab(page, i + 1, i === activeStageTabIndex ? '末页' : undefined);
            }
        }

        if (options?.abortSignal?.aborted) {
            runAborted = true;
            resolverPipeline.abort();
        }

        // 检查是否有暂缓提交未能成功再次提交的 Tab，记录警告
        for (let i = 0; i < stageStates.length; i++) {
            if (stageStates[i].submitStatus === 'deferred') {
                console.log(`⚠️ 搭剧第 ${i + 1} 页暂缓提交后未能成功再次提交，请人工核对该页面任务状态`);
                writeStructuredLog('STAGE_PAGE_DEFERRED_UNRESOLVED', { tabIndex: i + 1, reason: '暂缓提交后未能成功再次提交' });
            }
        }

        // 递补可能留下不连续的空槽，不能把空槽后已保存的子任务算作未填写。
        const untouchedTasks: Array<{ tabIndex: number; subtaskIndex: number }> = [];
        const lastOpenedTabCapacity = stageCapacities[activeStageTabIndex];
        for (let slot = currentSubtaskInTab; slot <= lastOpenedTabCapacity; slot++) {
            if (filledTasks.some(task => task.tabIndex === activeStageTabIndex + 1 && task.subtaskIndex === slot)) continue;
            untouchedTasks.push({
                tabIndex: activeStageTabIndex + 1,
                subtaskIndex: slot,
            });
        }

        const failedCount = failedDramas.length;
        totalSpan.mergeMetadata({ successCount, failedCount, untouchedCount: untouchedTasks.length });

        options?.onSummary?.({
            total: keywords.length,
            successCount,
            failedCount,
            failedDramas,
            untouchedTasks,
            totalDurationMs: elapsed(totalStart),
            stageTabCount: stagePages.length,
        });

        console.log(
            '\n=========================================='
        );
        console.log(
            `处理完成：输入总数 ${keywords.length} | 实际搭建成功 ${successCount} | 不能搭建 ${failedCount}`
        );
        console.log(
            `总耗时: ${(elapsed(totalStart) / 1000).toFixed(2)}s | 累计使用搭剧 Tab: ${stagePages.length} 个`
        );

        // 格式化输出不能搭建的剧目列表
        if (failedDramas.length > 0) {
            console.log('\n❌ 【不能搭建的剧目列表】:');
            failedDramas.forEach((f, idx) => {
                console.log(`   ${idx + 1}. 《${f.keyword}》: ${f.reason}`);
            });
        } else {
            console.log('\n本次运行无已确认失败项，提交结果以任务状态为准。');
        }

        // 格式化输出未改动的子任务列表
        if (untouchedTasks.length > 0) {
            console.log('\n⏸️ 【未改动的子任务列表 (保持原样不动)】:');
            untouchedTasks.forEach((t, idx) => {
                console.log(`   ${idx + 1}. 第 ${t.tabIndex} 个链接任务 -> 第 ${t.subtaskIndex} 个子任务`);
            });
        } else if (stageStates.some(tab => tab.submitStatus === 'empty')) {
            console.log('\n重复剧目已处理，无剩余待提交子任务。');
        } else if (stageStates.some(tab => tab.submitStatus === 'deferred')) {
            console.log('\n⚠️ 部分页面暂缓提交后未完成再次提交，请核对平台任务。');
        } else {
            console.log('\n🎯 所有规划的子任务均已全部填满！');
        }

        console.log(
            '=========================================='
        );

        writeStructuredLog('RUN_SUMMARY', {
            keywordCount: keywords.length,
            successCount,
            failedCount,
            failedDramas,
            untouchedTasks,
            stageWindowCount: stagePages.length,
            stageTabCount: stagePages.length,
            totalDurationMs: elapsed(totalStart),
            cacheEntries: seriesRuntimeCache.size,
            metrics: { ...runtimeMetrics },
            diagnostics: getRuntimeDiagnostics(),
        });

        const allPagesSubmitted = stageStates.every(tab => tab.submitStatus === 'submitted');
        const allPagesHandled = stageStates.every(tab => ['submitted', 'empty', 'skipped'].includes(tab.submitStatus));
        if (!runAborted && !allPagesHandled) {
            throw new Error('待搭剧已用尽，当前页仍有未填写或待递补槽位，已保留页面供人工核对，未提交模板中的原剧目。');
        }
        if (!runAborted && allPagesSubmitted) {
            writeRunSuccessMarker({
                keywordCount: keywords.length,
                successCount,
                failedCount,
                failedDramas,
                untouchedTasks,
                stageWindowCount: stagePages.length,
                stageTabCount: stagePages.length,
                totalDurationMs: elapsed(totalStart),
            });
        }

        await triggerBrowserGC(context).catch(() => {});
    } catch (error) {
        totalSpan.endWithError(error);
        throw error;
    } finally {
        // A failed tab transition can leave a prefetch running. Keep the lock
        // until that operation settles before accepting another run.
        await resolverPipeline?.drain();
        // Disconnect this client's CDP transport so desktop shutdown can exit.
        await browser?.close().catch(() => {});
        totalSpan.end();
        profiler.saveReport(profileId);
        // 正常结束或异常时移除信号 handler
        if (!options?.skipSignalHandlers) {
            process.off('SIGINT', _sigintHandler);
            process.off('SIGTERM', _sigtermHandler);
        }
        process.off('exit', _exitHandler);

        session.release();
    }
}
