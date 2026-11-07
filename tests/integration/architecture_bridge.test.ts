import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutomationBridge } from '../../src/web/automation_bridge.ts';
import { consoleEventSchema, type ConsoleEvent } from '../../src/contracts/console.ts';
import { faultService, getServiceHealth } from '../../src/core/service_health.ts';

for (const count of [1000, 2000, 10000]) {
    test(`${count} 条任务：增量包有界、序号连续、最终计数准确`, { timeout: 120000 }, async () => {
        const bridge = new AutomationBridge(async options => {
            for (let index = 1; index <= count; index++) {
                const keyword = options!.keywords![index - 1];
                options!.onItemStart?.({ index, total: count, keyword, tabIndex: 1, subtaskIndex: 1, batchCapacity: 1 });
                options!.onItemFailure?.({ index, total: count, keyword, tabIndex: 1, subtaskIndex: 1, durationMs: 0, reason: '没有可用候选' });
            }
        });
        let cursor = 0, bytes = 0, packets = 0, maximum = 0;
        const failures: unknown[] = [];
        const unsubscribe = bridge.subscribeEvents((event: ConsoleEvent) => {
            try {
            assert.equal(consoleEventSchema.safeParse(event).success, true);
            assert.equal(event.seq, ++cursor);
            if (event.kind !== 'snapshot') {
                const size = Buffer.byteLength(JSON.stringify(event)); bytes += size; packets++; maximum = Math.max(maximum, size);
                if (event.kind === 'patch') assert.ok((event.data.items?.length ?? 0) <= 1);
            }
            } catch (error) { failures.push(error); }
        });
        try {
            const started = await bridge.start({ keywords: Array.from({ length: count }, (_, index) => `测试剧${index}`),
                copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '1', paidTemplate: '中额' });
            assert.equal(started.ok, true); await bridge.waitForIdle();
            assert.equal(bridge.getState().progress.failedCount, count); assert.equal(bridge.getState().status, 'completed');
            assert.ok(maximum < 1600, `最大增量包 ${maximum}`); assert.ok(bytes < count * 3000);
            assert.ok(packets <= count * 3 + 5);
            assert.deepEqual(failures, []); assert.ok(packets >= count * 2);
            console.log(`增量基线 count=${count} packets=${packets} bytes=${bytes} maximum=${maximum}`);
        } finally { unsubscribe(); }
    });
}

test('服务致命故障停止当前运行并拒绝新任务', async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const bridge = new AutomationBridge(async options => {
        started();
        await new Promise((_, reject) => options!.abortSignal!.addEventListener('abort', () => reject(options!.abortSignal!.reason), { once: true }));
    });
    const input = { keywords: ['甲'], copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '1', paidTemplate: '中额' };
    assert.equal((await bridge.start(input)).ok, true); await entered;
    faultService(new Error('模拟后台致命故障')); await bridge.waitForIdle();
    assert.equal(getServiceHealth().status, 'faulted'); assert.equal((await bridge.start(input)).ok, false);
    assert.equal(bridge.getState().lastError, '模拟后台致命故障');
});
