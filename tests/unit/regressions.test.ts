import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutomationBridge } from '../../src/web/automation_bridge.ts';
import { clearSeriesRuntimeCache, setSeriesCacheField, getResolvedSeriesCache } from '../../src/core/cache.ts';
import type { RunAutomationOptions } from '../../src/runner.ts';
import { DramaResolverPipeline } from '../../src/coordinator/resolver_pipeline.ts';

const options = { keywords: ['A', 'B', 'C', 'D'], copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '1', paidTemplate: '超超小额' };
test('作品缓存按当前运行清理', () => {
    clearSeriesRuntimeCache();
    const data = { name: 'A', seriesId: '123', douyinId: '2234567890123456789' };
    setSeriesCacheField('123', 'resolved', data);
    assert.deepEqual(getResolvedSeriesCache('123'), data);
    clearSeriesRuntimeCache();
    assert.equal(getResolvedSeriesCache('123'), null);
});

test('停止后当前任务收尾前拒绝重启，旧控制器不影响下一次运行', async () => {
    let finish!: () => void;
    let active!: RunAutomationOptions;
    let calls = 0;
    const bridge = new AutomationBridge(async opts => {
        calls++;
        active = opts!;
        await new Promise<void>(resolve => { finish = resolve; });
    });
    assert.equal((await bridge.start(options)).ok, true);
    const oldSignal = active.abortSignal;
    assert.equal(bridge.stop().ok, true);
    assert.equal(oldSignal?.aborted, true);
    assert.equal(bridge.getState().status, 'running');
    assert.equal((await bridge.start({ ...options, keywords: ['new'] })).ok, false);
    assert.equal(calls, 1);
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bridge.getState().status, 'aborted');
    assert.equal((await bridge.start({ ...options, keywords: ['new'] })).ok, true);
    assert.notEqual(active.abortSignal, oldSignal);
    assert.equal(active.abortSignal?.aborted, false);
    assert.equal(bridge.getState().items[0].keyword, 'new');
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bridge.getState().status, 'completed');
});

test('流水线终止后仍等待后台请求结束，才能完成收尾', async () => {
    const pipeline = new DramaResolverPipeline({ freeListPage: null });
    let rejectPending!: (error: Error) => void;
    const pending = new Promise((_, reject) => { rejectPending = reject; });
    // Substitute an in-flight network operation without making a paid request.
    (pipeline as any).currentPrefetch = { index: 1, keyword: 'B', startTime: 0, promise: pending };
    pipeline.abort();
    let settled = false;
    const draining = pipeline.drain().then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    rejectPending(new Error('模拟请求失败'));
    await draining;
    assert.equal(settled, true);
    await assert.rejects(pipeline.get('B', 1), /aborted/);
});
