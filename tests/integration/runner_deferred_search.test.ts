import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/runner.ts';
import { AutomationBridge } from '../../src/web/automation_bridge.ts';
import { clearConflictDramaGuard } from '../../src/core/conflict_guard.ts';

for (const selection of ['drama', 'product']) {
for (const outcome of ['success', 'failure', 'all_failed']) {
    const retrySucceeds = outcome === 'success';
    const allFailed = outcome === 'all_failed';
    test(`${selection}三轮选择失败移至队尾并由下一部递补：${outcome}`, async () => {
        clearConflictDramaGuard();
        const attempts: string[] = [];
        const fills: Array<{ keyword: string; slot: number }> = [];
        const deferred: string[] = [];
        const deferredStates: Array<{ order: string[]; statuses: string[] }> = [];
        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 3,
            preflightStageSubtasks: async () => 3,
            openNextStageCopyTab: async () => { throw new Error('不应打开下一页'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async (_page, slot, _capacity, data) => {
                attempts.push(data.name!);
                if (allFailed || data.name === 'A' && (attempts.filter(name => name === 'A').length === 1 || !retrySucceeds)) {
                    throw Object.assign(new Error('三轮选择失败'), {
                        code: selection === 'drama' ? 'STAGE_DRAMA_SEARCH_EXHAUSTED' : 'STAGE_PRODUCT_SEARCH_EXHAUSTED',
                    });
                }
                fills.push({ keyword: data.name!, slot });
            },
            trimUnusedStageTasks: async (_page, filled, capacity) => {
                assert.equal(filled, 2);
                assert.equal(capacity, 3);
            },
            removeStageTasks: async () => { throw new Error('不应删除任务'); },
            submitStagePage: async () => {
                assert.equal(allFailed, false, '全部选择失败不得提交模板');
                return { kind: 'success' };
            },
            createPipeline: () => ({
                get: async (keyword: string) => ({ ok: true, name: keyword,
                    seriesId: `123456789012345678${keyword.charCodeAt(0) - 65}`,
                    douyinId: `223456789012345678${keyword.charCodeAt(0) - 65}` }),
                prefetch: () => {}, abort: () => {}, drain: async () => {},
            }) as any,
        };
        const bridge = new AutomationBridge(options => run(options, deps));
        bridge.subscribe((event, info) => {
            if (event !== 'item_deferred') return;
            deferred.push(info.keyword);
            const state = bridge.getState();
            deferredStates.push({ order: state.items.map(item => item.keyword),
                statuses: state.items.map(item => item.status) });
        });
        assert.equal((await bridge.start({ keywords: allFailed ? ['A'] : ['A', 'B', 'C'],
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1', paidTemplate: '超超小额' })).ok, true);
        await bridge.waitForIdle();

        const state = bridge.getState();
        assert.equal(state.status, 'completed');
        assert.equal(state.lastError, null);
        if (allFailed) {
            assert.deepEqual(attempts, ['A', 'A']);
            assert.deepEqual(deferred, ['A']);
            assert.deepEqual(fills, []);
            assert.equal(state.progress.current, 1);
            assert.equal(state.progress.failedCount, 1);
            assert.equal(state.progress.successCount, 0);
            assert.equal(state.items[0].status, 'failed');
            assert.equal(state.items[0].error, selection === 'product' ? '商品库选择失败' : '三轮选择失败');
            assert.equal(state.summary?.untouchedTasks.length, 3);
            return;
        }
        assert.deepEqual(attempts, ['A', 'B', 'C', 'A']);
        assert.deepEqual(deferred, ['A']);
        assert.deepEqual(deferredStates, [{ order: ['B', 'C', 'A'], statuses: ['pending', 'pending', 'pending'] }]);
        assert.deepEqual(fills, retrySucceeds
            ? [{ keyword: 'B', slot: 1 }, { keyword: 'C', slot: 2 }, { keyword: 'A', slot: 3 }]
            : [{ keyword: 'B', slot: 1 }, { keyword: 'C', slot: 2 }]);
        assert.deepEqual(state.items.map(item => item.keyword), ['B', 'C', 'A']);
        assert.deepEqual(state.items.map(item => item.status), retrySucceeds
            ? ['success', 'success', 'success'] : ['success', 'success', 'failed']);
        assert.equal(state.progress.current, 3);
        assert.equal(state.progress.failedCount, retrySucceeds ? 0 : 1);
        if (!retrySucceeds && selection === 'product') assert.equal(state.items[2].error, '商品库选择失败');
    });
}
}

test('子任务保存连续失败移至队尾并由下一部剧递补', async () => {
    clearConflictDramaGuard();
    const attempts: string[] = [];
    const fills: Array<{ keyword: string; slot: number }> = [];
    const deferred: string[] = [];
    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
        prepareStageCopyPage: async () => 3,
        preflightStageSubtasks: async () => 3,
        openNextStageCopyTab: async () => { throw new Error('不应打开下一页'); },
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        fillStageTaskWithReopenRetry: async (_page, slot, _capacity, data) => {
            attempts.push(data.name!);
            if (data.name === 'A' && attempts.filter(name => name === 'A').length === 1) {
                throw Object.assign(new Error('子任务保存失败'), {
                    code: 'STAGE_SUBTASK_SAVE_EXHAUSTED',
                });
            }
            fills.push({ keyword: data.name!, slot });
        },
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => { throw new Error('不应删除任务'); },
        submitStagePage: async () => ({ kind: 'success' }),
        createPipeline: () => ({
            get: async (keyword: string) => ({
                ok: true, name: keyword,
                seriesId: `123456789012345678${keyword.charCodeAt(0) - 65}`,
                douyinId: `223456789012345678${keyword.charCodeAt(0) - 65}`,
            }),
            prefetch: () => {}, abort: () => {}, drain: async () => {},
        }) as any,
    };
    const bridge = new AutomationBridge(options => run(options, deps));
    bridge.subscribe((event, info) => {
        if (event === 'item_deferred') deferred.push(info.keyword);
    });
    assert.equal((await bridge.start({
        keywords: ['A', 'B', 'C'],
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
        roiRatio: '1', paidTemplate: '超超小额',
    })).ok, true);
    await bridge.waitForIdle();

    const state = bridge.getState();
    assert.equal(state.status, 'completed');
    assert.equal(state.lastError, null);
    assert.deepEqual(attempts, ['A', 'B', 'C', 'A']);
    assert.deepEqual(deferred, ['A']);
    assert.deepEqual(fills, [
        { keyword: 'B', slot: 1 },
        { keyword: 'C', slot: 2 },
        { keyword: 'A', slot: 3 },
    ]);
    assert.equal(state.progress.current, 3);
    assert.equal(state.progress.successCount, 3);
    assert.equal(state.progress.failedCount, 0);
});
