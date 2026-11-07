// ============================================================
// Unit Tests: Runtime Cache & Metrics
// ============================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    seriesRuntimeCache,
    runtimeMetrics,
    getResolvedSeriesCache,
    setSeriesCacheField,
    getSeriesCacheEntry,
    clearSeriesRuntimeCache,
    getCacheStats,
} from '../../src/core/cache.ts';

describe('Runtime Cache: 内存缓存与性能指标', () => {
    beforeEach(() => {
        clearSeriesRuntimeCache();
    });

    test('setSeriesCacheField 与 getSeriesCacheEntry 能够正确读写', () => {
        const testId = '7384920182746192837';
        setSeriesCacheField(testId, 'resolved', {
            name: '测试剧', seriesId: testId, douyinId: '1234567890123456789',
        });

        const entry = getSeriesCacheEntry(testId);
        assert.ok(entry);
        assert.ok(entry.resolved);
        assert.equal(entry.resolved.seriesId, testId);
        assert.equal(entry.resolved.douyinId, '1234567890123456789');
    });

    test('getResolvedSeriesCache 仅在完整 resolved 存在时返回数据', () => {
        const testId = '7384920182746192838';
        assert.equal(getResolvedSeriesCache(testId), null);

        setSeriesCacheField(testId, 'resolved', {
            name: '测试剧',
            seriesId: testId,
            douyinId: '1234567890123456789',
        });

        const resolved = getResolvedSeriesCache(testId);
        assert.ok(resolved);
        assert.equal(resolved.name, '测试剧');
        assert.equal(resolved.seriesId, testId);
    });

    test('clearSeriesRuntimeCache 清空所有缓存项与指标', () => {
        setSeriesCacheField('id1', 'resolved', { name: 'A', seriesId: 'id1', douyinId: '1' });
        setSeriesCacheField('id2', 'resolved', { name: 'B', seriesId: 'id2', douyinId: '2' });
        assert.equal(seriesRuntimeCache.size, 2);

        clearSeriesRuntimeCache();
        assert.equal(seriesRuntimeCache.size, 0);

        const stats = getCacheStats();
        assert.equal(stats.totalEntries, 0);
        assert.equal(stats.cacheMisses, 0);
        assert.equal(stats.resolvedCacheHits, 0);
    });

    test('getCacheStats 命中与未命中指标统计准确', () => {
        runtimeMetrics.resolvedCacheHits = 3;
        runtimeMetrics.cacheMisses = 1;
        const stats = getCacheStats();
        assert.equal(stats.resolvedCacheHits, 3);
        assert.equal(stats.cacheMisses, 1);
        assert.equal(stats.hitRatio, 75);
    });
});
