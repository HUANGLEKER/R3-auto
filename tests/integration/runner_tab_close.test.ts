// ============================================================
// Integration Test: 已成功提交的 Tab 自动关闭功能
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/runner.ts';
import { clearConflictDramaGuard } from '../../src/core/conflict_guard.ts';
import type { StageSubmitResult } from '../../src/platform/stage_submit.ts';

test('多 Tab 搭建：已成功提交的旧 Tab 在新 Tab 就绪后自动关闭，末页在提交成功后自动关闭', async () => {
    clearConflictDramaGuard();
    const keywords = ['剧A', '剧B', '剧C', '剧D'];
    const closedTabs: string[] = [];

    let page1Closed = false;
    let page2Closed = false;

    const page1 = {
        name: 'page1',
        bringToFront: async () => {},
        isClosed: () => page1Closed,
        close: async () => {
            page1Closed = true;
            closedTabs.push('page1');
        },
    };

    const page2 = {
        name: 'page2',
        bringToFront: async () => {},
        isClosed: () => page2Closed,
        close: async () => {
            page2Closed = true;
            closedTabs.push('page2');
        },
    };

    let openedTabs = 0;

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
        fillStageTaskWithReopenRetry: async () => {},
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => {},
        submitStagePage: async (): Promise<StageSubmitResult> => ({ kind: 'success' }),
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

    await run({
        keywords,
        copyPageUrls: [
            'https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test1',
            'https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test2',
        ],
        roiRatio: '1',
        paidTemplate: '超超小额',
        skipSignalHandlers: true,
        skipConflictPreCheck: true,
    }, deps);

    assert.equal(openedTabs, 1, '应当打开第 2 个 Tab');
    assert.equal(page1Closed, true, '已成功提交的第 1 页应已被自动关闭');
    assert.equal(page2Closed, true, '已成功提交的第 2 页（末页）应已被自动关闭');
    assert.deepEqual(closedTabs, ['page1', 'page2'], '关闭顺序应为 page1 -> page2');
});

test('单 Tab 搭建：末页成功提交后自动关闭对应 Tab', async () => {
    clearConflictDramaGuard();
    const keywords = ['单页剧A', '单页剧B'];
    let pageClosed = false;

    const page1 = {
        name: 'page1',
        bringToFront: async () => {},
        isClosed: () => pageClosed,
        close: async () => {
            pageClosed = true;
        },
    };

    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: page1 }) as any,
        prepareStageCopyPage: async () => 2,
        preflightStageSubtasks: async () => 2,
        openNextStageCopyTab: async () => {
            throw new Error('单页不应打开新 Tab');
        },
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        fillStageTaskWithReopenRetry: async () => {},
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => {},
        submitStagePage: async (): Promise<StageSubmitResult> => ({ kind: 'success' }),
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

    await run({
        keywords,
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test1'],
        roiRatio: '1',
        paidTemplate: '超超小额',
        skipSignalHandlers: true,
        skipConflictPreCheck: true,
    }, deps);

    assert.equal(pageClosed, true, '单 Tab 末页成功提交后应当自动关闭');
});

test('未提交或提交失败的 Tab 不会被关闭，保留供人工核对', async () => {
    clearConflictDramaGuard();
    const keywords = ['失败剧A'];
    let pageClosed = false;

    const page1 = {
        name: 'page1',
        bringToFront: async () => {},
        isClosed: () => pageClosed,
        close: async () => {
            pageClosed = true;
        },
    };

    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: page1 }) as any,
        prepareStageCopyPage: async () => 2,
        preflightStageSubtasks: async () => 2,
        openNextStageCopyTab: async () => {
            throw new Error('不应打开新 Tab');
        },
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        fillStageTaskWithReopenRetry: async () => {},
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => {},
        submitStagePage: async (): Promise<StageSubmitResult> => {
            throw new Error('整页提交阻塞错误');
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

    await assert.rejects(run({
        keywords,
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test1'],
        roiRatio: '1',
        paidTemplate: '超超小额',
        skipSignalHandlers: true,
        skipConflictPreCheck: true,
    }, deps));

    assert.equal(pageClosed, false, '提交失败的页面必须保留供人工核对，不应被关闭');
});
