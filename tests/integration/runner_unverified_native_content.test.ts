// ============================================================
// Integration Test: 原生内容未核实暂缓提交并在新Tab搭完后再次提交
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/runner.ts';
import { clearConflictDramaGuard } from '../../src/core/conflict_guard.ts';
import type { StageSubmitResult } from '../../src/platform/stage_submit.ts';

test('遇到原生内容未核实错误时，暂缓当前页提交，开启新Tab搭后续剧，新Tab搭完后再次提交先前Tab', async () => {
    clearConflictDramaGuard();
    const keywords = ['剧A', '剧B', '剧C', '剧D'];
    const filledTasks: Array<{ name: string; slot: number; pageName: string }> = [];
    const submittedPages: string[] = [];
    let openedTabs = 0;
    const page1 = { name: 'page1', bringToFront: async () => {} };
    const page2 = { name: 'page2', bringToFront: async () => {} };

    let page1SubmitCount = 0;
    let page2SubmitCount = 0;

    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: page1 }) as any,
        prepareStageCopyPage: async () => 2,
        preflightStageSubtasks: async () => 2,
        openNextStageCopyTab: async () => {
            openedTabs++;
            return { page: page2, capacity: 2 };
        },
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        fillStageTaskWithReopenRetry: async (page, slot, _capacity, info) => {
            filledTasks.push({ name: info.name!, slot, pageName: (page as any).name });
        },
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => {},
        submitStagePage: async (page: any): Promise<StageSubmitResult> => {
            submittedPages.push(page.name);
            if (page.name === 'page1') {
                page1SubmitCount++;
                if (page1SubmitCount === 1) {
                    // 第 1 次提交返回渠道无法核实当前原生内容
                    return {
                        kind: 'retryable',
                        message: 'UpsertAutoCreateTask失败，子任务 1：所选渠道无法核实当前原生内容，请稍后重试',
                    };
                }
                // 第 2 次（新Tab搭完后再次提交）返回成功
                return { kind: 'success' };
            } else if (page.name === 'page2') {
                page2SubmitCount++;
                return { kind: 'success' };
            }
            return { kind: 'success' };
        },
        createPipeline: () => ({
            get: async (keyword: string) => ({
                ok: true,
                name: keyword,
                seriesId: '1234567890123456789',
                douyinId: '2234567890123456789',
            }),
            prefetch: () => {},
            abort: () => {},
            drain: async () => {},
        }) as any,
    };

    const successfulItems: string[] = [];
    const summaries: any[] = [];

    await run({
        keywords,
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test1', 'https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test2'],
        roiRatio: '1',
        paidTemplate: '超超小额',
        skipSignalHandlers: true,
        skipConflictPreCheck: true,
        onItemSuccess: info => {
            successfulItems.push(info.keyword);
        },
        onSummary: summary => {
            summaries.push(summary);
        },
    }, deps);

    // 验证：
    // 1. 打开了新 Tab
    assert.equal(openedTabs, 1, '应开启第 2 个 Tab 搭后续剧');

    // 2. 剧A、剧B在 page1，剧C、剧D在 page2
    assert.deepEqual(filledTasks, [
        { name: '剧A', slot: 1, pageName: 'page1' },
        { name: '剧B', slot: 2, pageName: 'page1' },
        { name: '剧C', slot: 1, pageName: 'page2' },
        { name: '剧D', slot: 2, pageName: 'page2' },
    ]);

    // 3. 提交顺序：
    // - page1 首次提交遇到原生内容未核实
    // - 不在 page1 退避循环，而是切换 page2 搭建 剧C、剧D
    // - page2 搭完后，再次提交先前暂缓的 page1
    // - page1 提交成功后，再提交 page2
    assert.deepEqual(submittedPages, ['page1', 'page1', 'page2']);
    assert.equal(page1SubmitCount, 2, 'page1 应该被提交 2 次');
    assert.equal(page2SubmitCount, 1, 'page2 应该被提交 1 次');

    // 4. 所有 4 部剧最终成功
    assert.deepEqual(successfulItems, ['剧A', '剧B', '剧C', '剧D']);
    assert.equal(summaries[0].successCount, 4);
    assert.equal(summaries[0].failedCount, 0);
});

test('末页遇到原生内容未核实且无后续剧时，执行退避重试直至成功提交', async () => {
    clearConflictDramaGuard();
    const keywords = ['末页剧A', '末页剧B'];
    const page1 = { name: 'page1', bringToFront: async () => {} };
    let openedTabs = 0;
    let page1SubmitCount = 0;

    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: page1 }) as any,
        prepareStageCopyPage: async () => 2,
        preflightStageSubtasks: async () => 2,
        openNextStageCopyTab: async () => {
            openedTabs++;
            throw new Error('无后续剧时不应打开新Tab');
        },
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        fillStageTaskWithReopenRetry: async () => {},
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => {},
        submitStagePage: async (): Promise<StageSubmitResult> => {
            page1SubmitCount++;
            if (page1SubmitCount === 1) {
                return {
                    kind: 'retryable',
                    message: '子任务 2：所选渠道无法核实当前原生内容，请稍后重试',
                };
            }
            if (page1SubmitCount === 2) {
                return {
                    kind: 'retryable',
                    message: '子任务 4: 查询分销渠道失败，请稍后重试',
                };
            }
            return { kind: 'success' };
        },
        createPipeline: () => ({
            get: async (keyword: string) => ({
                ok: true,
                name: keyword,
                seriesId: '1234567890123456789',
                douyinId: '2234567890123456789',
            }),
            prefetch: () => {},
            abort: () => {},
            drain: async () => {},
        }) as any,
    };

    const successfulItems: string[] = [];

    await run({
        keywords,
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test1'],
        roiRatio: '1',
        paidTemplate: '超超小额',
        skipSignalHandlers: true,
        skipConflictPreCheck: true,
        submitBackoffBaseMs: 10,
        submitBackoffMaxMs: 50,
        onItemSuccess: info => {
            successfulItems.push(info.keyword);
        },
    }, deps);

    assert.equal(openedTabs, 0, '无后续剧时不应打开新Tab');
    assert.equal(page1SubmitCount, 3, '在没有后续剧时应使用退避重试直至提交成功');
    assert.deepEqual(successfulItems, ['末页剧A', '末页剧B']);
});

test('整页提交遇到查询客户所属供应商失败时，按渠道QPS限流在当前页退避重试直至成功（不切新Tab）', async () => {
    clearConflictDramaGuard();
    const keywords = ['剧A', '剧B', '剧C', '剧D'];
    const page1 = { name: 'page1', bringToFront: async () => {} };
    let openedTabs = 0;
    let page1SubmitCount = 0;
    const retryPhases: string[] = [];

    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: page1 }) as any,
        prepareStageCopyPage: async () => 2,
        preflightStageSubtasks: async () => 2,
        openNextStageCopyTab: async () => {
            openedTabs++;
            throw new Error('供应商查询失败按渠道QPS处理，不应打开新Tab');
        },
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        fillStageTaskWithReopenRetry: async () => {},
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => {},
        submitStagePage: async (): Promise<StageSubmitResult> => {
            page1SubmitCount++;
            if (page1SubmitCount === 1) {
                return {
                    kind: 'retryable',
                    message: '子任务 1: 查询客户所属供应商失败，请稍后重试',
                };
            }
            return { kind: 'success' };
        },
        createPipeline: () => ({
            get: async (keyword: string) => ({
                ok: true,
                name: keyword,
                seriesId: '1234567890123456789',
                douyinId: '2234567890123456789',
            }),
            prefetch: () => {},
            abort: () => {},
            drain: async () => {},
        }) as any,
    };

    const successfulItems: string[] = [];

    await run({
        keywords: ['剧A', '剧B'],
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test1', 'https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test2'],
        roiRatio: '1',
        paidTemplate: '超超小额',
        skipSignalHandlers: true,
        skipConflictPreCheck: true,
        submitBackoffBaseMs: 10,
        submitBackoffMaxMs: 50,
        onItemPhase: phase => {
            if (phase.description.includes('渠道限流退避重试')) {
                retryPhases.push(phase.description);
            }
        },
        onItemSuccess: info => {
            successfulItems.push(info.keyword);
        },
    }, deps);

    assert.equal(openedTabs, 0, '供应商失败按渠道QPS处理，即便有后续URL也不应打开新Tab');
    assert.equal(page1SubmitCount, 2, '遇到查询供应商失败应在当前页退避重试第2次成功');
    assert.ok(retryPhases.length >= 1, '应触发渠道限流退避重试通知');
    assert.deepEqual(successfulItems, ['剧A', '剧B']);
});
