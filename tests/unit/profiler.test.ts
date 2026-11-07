// ============================================================
// Unit Tests: Performance Profiler & Diagnostics
// ============================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { profiler } from '../../src/infra/profiler.ts';

describe('Performance Profiler: 性能分析与微秒高精度耗时统计', () => {
    beforeEach(() => {
        profiler.reset();
    });

    test('startSpan 与 end 能正确记录耗时与元数据', async () => {
        const span = profiler.startSpan('test_dom_click', 'DOM', { target: '#btn' });
        await new Promise(r => setTimeout(r, 20));
        span.checkpoint('pre_click');
        await new Promise(r => setTimeout(r, 10));
        span.end({ ok: true });

        const report = profiler.getReport();
        assert.ok(report.totalWallClockMs >= 25);
        assert.equal(report.spanCount, 1);
        const domCat = report.categoryBreakdown.find(c => c.category === 'DOM');
        assert.ok(domCat);
        assert.ok(domCat.count >= 1);
        assert.ok(domCat.totalMs >= 25);
    });

    test('recordLockEvent 聚合互斥锁等待与持有耗时', () => {
        profiler.recordLockEvent(15.5, 30.2);
        profiler.recordLockEvent(5.0, 10.0);

        const report = profiler.getReport();
        assert.equal(report.lockContention.totalLockRequests, 2);
        assert.ok(report.lockContention.totalQueueWaitMs >= 20);
        assert.ok(report.lockContention.totalHoldMs >= 40);
    });

    test('endWithError 正确标记 Span 错误状态', () => {
        const span = profiler.startSpan('failing_op', 'XHR', { endpoint: '/api/v1/save' });
        const result = span.endWithError(new Error('Network Timeout'));

        assert.equal(result.status, 'ERROR');
        assert.equal(result.error, 'Network Timeout');
        assert.equal(typeof result.durationMs, 'number');
        assert.equal(typeof result.endTime, 'number');
        assert.equal(profiler.getReport().spanCount, 1);
        assert.equal(span.end().status, 'ERROR');
        assert.equal(span.endWithError(new Error('later')).error, 'Network Timeout');
    });
});
