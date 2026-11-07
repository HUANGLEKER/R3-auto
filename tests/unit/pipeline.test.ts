// ============================================================
// Unit Tests: Drama Resolver Pipeline (Producer-Consumer Overlap)
// ============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DramaResolverPipeline } from '../../src/coordinator/resolver_pipeline.ts';

describe('Drama Resolver Pipeline: 流水线重叠预解析引擎', () => {
    test('pipeline stats 初始指标正确', () => {
        const pipeline = new DramaResolverPipeline({
            freeListPage: {},
        });

        const stats = pipeline.getStats();
        assert.equal(stats.totalPrefetched, 0);
        assert.equal(stats.totalConsumed, 0);
        assert.equal(stats.totalOverlapSavedMs, 0);
    });

    test('pipeline abort 能安全终止且不抛出异常', () => {
        const pipeline = new DramaResolverPipeline({
            freeListPage: {},
        });

        pipeline.abort();
        assert.rejects(async () => {
            await pipeline.get('测试剧', 0);
        }, /aborted/i);
    });
});
