import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../../src/runner.ts';
import { AutomationBridge } from '../../src/web/automation_bridge.ts';
import { RUN_LOCK_PATH, RUN_SUCCESS_MARKER_PATH } from '../../src/core/paths.ts';
import type { StageSubmitResult } from '../../src/platform/stage_submit.ts';
import { profiler } from '../../src/infra/profiler.ts';
import { STRUCTURED_LOG_DIR } from '../../src/core/structured_log.ts';
import { clearConflictDramaGuard } from '../../src/core/conflict_guard.ts';

const config = { keywords: ['A', 'B'], copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
    roiRatio: '1', paidTemplate: '超超小额' };

for (const scenario of ['exhausted', 'success', 'unknown', 'duplicate', 'stop', 'not_started', 'blocking']) {
    test('真实 runner 生命周期（全部外部操作模拟）：' + scenario, async () => {
        assert.ok(process.env.R3_DATA_DIR);
        clearConflictDramaGuard();
        let bridge: AutomationBridge;
        let submits = 0;
        let drained = false;
        let closed = false;
        const resolved: string[] = [];
        const filled: Array<{ name: string; slot: number }> = [];
        const states: string[][] = [];
        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => { closed = true; } }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 2,
            preflightStageSubtasks: async () => 2,
            openNextStageCopyTab: async () => { throw new Error('unexpected new tab'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async (_page, slot, _capacity, info) => {
                if (scenario === 'blocking') throw Object.assign(new Error('填单阻塞'), { code: 'STAGE_TASK_BLOCKING_FAILURE' });
                filled.push({ name: info.name, slot });
                if (scenario === 'stop') bridge.stop();
            },
            removeStageTasks: async (_page, slots, count, _signal, onRemoved) => {
                assert.deepEqual(slots, [1]);
                await onRemoved?.(count - 1, 1);
            },
            trimUnusedStageTasks: async () => {},
            createPipeline: () => ({
                get: async (keyword: string) => {
                    resolved.push(keyword);
                    return { ok: true, name: keyword, seriesId: '1234567890123456789',
                        douyinId: keyword === 'A' ? '2234567890123456789' : '3234567890123456789' };
                }, prefetch: () => {}, abort: () => {},
                drain: async () => {
                    assert.equal(fs.existsSync(RUN_LOCK_PATH), true, 'drain 期间仍持有锁');
                    drained = true;
                },
            }) as any,
            submitStagePage: async (): Promise<StageSubmitResult> => {
                submits++;
                assert.equal(bridge.getState().progress.successCount, 0);
                assert.equal(bridge.getState().items.filter(item => item.status === 'submitting').length, scenario === 'exhausted' && submits > 1 ? 1 : 2);
                if (scenario === 'unknown') return { kind: 'blocked', message: '提交超时，结果不确定' };
                if (scenario === 'not_started') throw Object.assign(new Error('按钮未就绪'), { code: 'STAGE_SUBMIT_NOT_STARTED' });
                if (['duplicate', 'exhausted'].includes(scenario) && submits === 1) return { kind: 'duplicate', displayedDramaIds: ['2234567890123456789'], message: '冲突' };
                return { kind: 'success' };
            },
        };
        bridge = new AutomationBridge(options => run(options, deps));
        bridge.subscribe((event, state) => { if (event === 'state_change') states.push(state.items.map((item: any) => item.status)); });
        const keywords = scenario === 'duplicate' ? ['A', 'B', 'C'] : config.keywords;
        assert.equal((await bridge.start({ ...config, keywords })).ok, true);
        await bridge.waitForIdle();
        const state = bridge.getState();
        const report = profiler.getReport();
        assert.equal(report.topSlowestSpans.find(span => span.name === 'full_flow_run')?.count, 1,
            '连续运行的性能统计必须隔离，失败运行也必须记录总耗时');
        assert.equal(fs.readdirSync(STRUCTURED_LOG_DIR).filter(name => name.endsWith('_profile.json')).length,
            ['exhausted', 'success', 'unknown', 'duplicate', 'stop', 'not_started', 'blocking'].indexOf(scenario) + 1,
            '每次运行保存独立报告，包括提前失败');
        assert.equal(drained, true);
        assert.equal(closed, true);
        assert.equal(fs.existsSync(RUN_LOCK_PATH), false);
        if (['success', 'duplicate', 'exhausted'].includes(scenario)) {
            assert.equal(state.status, 'completed');
            assert.equal(state.progress.successCount, scenario === 'exhausted' ? 1 : 2);
            assert.equal(state.summary?.successCount, scenario === 'exhausted' ? 1 : 2);
            assert.equal(fs.existsSync(RUN_SUCCESS_MARKER_PATH), true);
            assert.equal(state.progress.failedCount, ['duplicate', 'exhausted'].includes(scenario) ? 1 : 0);
        } else {
            assert.equal(state.progress.successCount, 0);
            assert.equal(fs.existsSync(RUN_SUCCESS_MARKER_PATH), false);
        }
        if (scenario === 'unknown') assert.deepEqual(state.items.map(item => item.status), ['uncertain', 'uncertain']);
        if (scenario === 'not_started') assert.deepEqual(state.items.map(item => item.status), ['filled', 'filled']);
        if (scenario === 'stop') {
            assert.equal(state.status, 'aborted');
            assert.deepEqual(state.items.map(item => item.status), ['filled', 'pending']);
            assert.deepEqual(resolved, ['A']);
        }
        if (scenario === 'blocking') assert.deepEqual(resolved, ['A']);
        if (scenario === 'duplicate') {
            assert.deepEqual(filled, [{ name: 'A', slot: 1 }, { name: 'B', slot: 2 }, { name: 'C', slot: 1 }]);
            assert.deepEqual(state.items.map(item => item.status), ['failed', 'success', 'success']);
            assert.equal(submits, 2);
        } else if (scenario === 'exhausted') {
            assert.equal(submits, 2);
            assert.deepEqual(state.items.map(item => item.status), ['failed', 'success']);
        } else assert.equal(submits, ['stop', 'blocking'].includes(scenario) ? 0 : 1);
        assert.ok(states.every(items => !items.includes('success')) || ['success', 'duplicate', 'exhausted'].includes(scenario));
    });
}
