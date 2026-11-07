import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../../src/runner.ts';
import { AutomationBridge } from '../../src/web/automation_bridge.ts';
import { RUN_LOCK_PATH, RUN_SUCCESS_MARKER_PATH } from '../../src/core/paths.ts';
import { clearConflictDramaGuard } from '../../src/core/conflict_guard.ts';

for (const scenario of ['all_unavailable', 'partial', 'next_page_unavailable', 'fill_failure', 'fill_failure_next', 'cleanup_failure_next']) {
    test(`没有候选时正常收尾并保留填单保护：${scenario}`, async () => {
        assert.ok(process.env.R3_DATA_DIR);
        clearConflictDramaGuard();
        const capacity = scenario === 'next_page_unavailable' ? 2 : 10;
        const keywords = scenario === 'all_unavailable' ? ['不恋澜，只惜欢', '重生六七：赶山狩猎养全家第一季', '南塘县令有亿点强']
            : scenario === 'next_page_unavailable' ? ['A', 'B', '没有候选']
                : scenario.endsWith('_next') ? ['A', 'B'] : ['A', '没有候选'];
        const pages = [Array<string>(capacity).fill('template')];
        const submissions: string[][] = [];
        const fillAttempts: string[] = [];
        let drained = false;
        let closed = false;
        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => { closed = true; } }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: { index: 0 } }) as any,
            prepareStageCopyPage: async () => capacity,
            preflightStageSubtasks: async () => capacity,
            openNextStageCopyTab: async () => {
                assert.equal(scenario, 'next_page_unavailable');
                pages.push(Array<string>(capacity).fill('template'));
                return { page: { index: 1 }, capacity };
            },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            createPipeline: () => ({
                get: async (keyword: string) => ['A', 'B'].includes(keyword)
                    ? { ok: true, name: keyword, seriesId: '1234567890123456789',
                        douyinId: keyword === 'A' ? '2234567890123456789' : '3234567890123456789' }
                    : { ok: false, status: '没有可用候选', attempts: [] },
                prefetch: () => {}, abort: () => {},
                drain: async () => {
                    assert.equal(fs.existsSync(RUN_LOCK_PATH), true);
                    drained = true;
                },
            }) as any,
            fillStageTaskWithReopenRetry: async (page, slot, _capacity, info) => {
                fillAttempts.push(info.name!);
                if (scenario.startsWith('fill_failure')) throw Object.assign(new Error('未知填单失败'), { code: 'STAGE_DRAMA_FILL_FAILED' });
                if (scenario === 'cleanup_failure_next') throw new Error('无法确认放弃修改');
                pages[page.index][slot - 1] = info.name!;
            },
            trimUnusedStageTasks: async (page, keep) => {
                assert.equal(scenario, 'partial');
                pages[page.index].splice(keep);
            },
            removeStageTasks: async () => { throw new Error('没有候选不应删除模板'); },
            submitStagePage: async page => {
                assert.ok(pages[page.index].every(name => name !== 'template'), '不得提交模板原剧目');
                submissions.push([...pages[page.index]]);
                return { kind: 'success' };
            },
        };
        const bridge = new AutomationBridge(options => run(options, deps));
        assert.equal((await bridge.start({ keywords,
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '0.95', paidTemplate: '超超小额' })).ok, true);
        await bridge.waitForIdle();
        const state = bridge.getState();
        if (scenario.startsWith('fill_failure') || scenario === 'cleanup_failure_next') {
            assert.equal(state.status, 'error');
            assert.match(state.lastError!, /填单结果不确定，已停止递补与提交/);
            assert.deepEqual(state.items.map(item => item.status), ['uncertain', 'pending']);
            assert.deepEqual(fillAttempts, ['A']);
            assert.deepEqual(submissions, []);
            assert.equal(state.progress.failedCount, 0, '不确定剧目不得进入普通失败重跑');
            assert.equal(drained, true);
            assert.equal(closed, true);
            assert.equal(fs.existsSync(RUN_LOCK_PATH), false);
            assert.equal(fs.existsSync(RUN_SUCCESS_MARKER_PATH), false);
            return;
        }
        const expectedSuccesses = scenario === 'partial' ? 1 : scenario === 'next_page_unavailable' ? 2 : 0;
        assert.equal(state.status, 'completed');
        assert.equal(state.lastError, null);
        assert.equal(state.progress.current, keywords.length);
        assert.equal(state.progress.successCount, expectedSuccesses);
        assert.equal(state.progress.failedCount, keywords.length - expectedSuccesses);
        assert.equal(state.summary?.successCount, expectedSuccesses);
        assert.equal(state.summary?.failedCount, keywords.length - expectedSuccesses);
        assert.ok(state.items.filter(item => item.keyword !== 'A' && item.keyword !== 'B')
            .every(item => item.status === 'failed' && item.error === '没有可用候选'));
        assert.deepEqual(submissions, scenario === 'partial' ? [['A']] : scenario === 'next_page_unavailable' ? [['A', 'B']] : []);
        assert.deepEqual(fillAttempts, scenario === 'all_unavailable' ? [] : scenario === 'next_page_unavailable' ? ['A', 'B'] : ['A']);
        if (scenario === 'all_unavailable' || scenario === 'next_page_unavailable') {
            assert.deepEqual(pages.at(-1), Array<string>(capacity).fill('template'));
            assert.equal(state.summary?.untouchedTasks.length, capacity);
        }
        assert.equal(fs.existsSync(RUN_SUCCESS_MARKER_PATH), scenario === 'partial', '保留空页不能写入全部提交成功标记');
        assert.equal(drained, true);
        assert.equal(closed, true);
        assert.equal(fs.existsSync(RUN_LOCK_PATH), false);
    });
}
