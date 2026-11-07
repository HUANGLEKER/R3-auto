// ============================================================
// P2：Series Runtime Memory Cache & Metrics
// ============================================================

import {UNIFIED} from './config.ts';
import {scopedProxy} from './run_context.ts';
import type {ResolvedDramaData} from '../types/index.ts';

export interface RuntimeMetrics {
    cacheMisses: number;
    resolvedCacheHits: number;
}

export interface SeriesCacheEntry {
    seriesId: string;
    resolved: ResolvedDramaData | null;
    updatedAt: number;

    [key: string]: unknown;
}

export interface CacheStatsSummary {
    totalEntries: number;
    resolvedCacheHits: number;
    totalCacheHits: number;
    cacheMisses: number;
    hitRatio: number;
}

export const runtimeMetrics: RuntimeMetrics = scopedProxy('metrics', () => ({
    cacheMisses: 0,
    resolvedCacheHits: 0,
}));

export const seriesRuntimeCache = scopedProxy('seriesCache', () => new Map<string, SeriesCacheEntry>());

const MAX_CACHE_ENTRIES = 2000;

export function getSeriesCacheEntry(seriesId: string): SeriesCacheEntry | null {
    const key = seriesId.trim();
    if (!seriesId.trim()) {
        return null;
    }

    return seriesRuntimeCache.get(key) ?? null;
}

/**
 * 内部专用：获取或创建缓存条目（仅在需要写入时调用）。
 * 与 getSeriesCacheEntry 分离，避免只读查询也触发创建逻辑。
 */
function getOrCreateSeriesCacheEntry(seriesId: string): SeriesCacheEntry | null {
    const key = seriesId.trim();
    if (!seriesId.trim()) {
        return null;
    }

    if (!seriesRuntimeCache.has(key)) {
        if (seriesRuntimeCache.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = seriesRuntimeCache.keys().next().value;
            if (oldestKey) {
                seriesRuntimeCache.delete(oldestKey);
            }
        }

        seriesRuntimeCache.set(key, {
            seriesId: seriesId.trim(),
            resolved: null,
            updatedAt: Date.now(),
        });
    }

    return seriesRuntimeCache.get(key)!;
}

export function setSeriesCacheField<K extends keyof SeriesCacheEntry>(
    seriesId: string,
    field: K,
    value: SeriesCacheEntry[K]
): void {
    if (!UNIFIED.RUNTIME_CACHE_ENABLED) {
        return;
    }

    const entry = getOrCreateSeriesCacheEntry(seriesId);
    if (!entry) {
        return;
    }

    entry[field] = (value && typeof value === 'object')
        ? {...(value as object)} as any
        : value;
    entry.updatedAt = Date.now();
}

export function getResolvedSeriesCache(seriesId: string): ResolvedDramaData | null {
    if (!UNIFIED.RUNTIME_CACHE_ENABLED) {
        return null;
    }

    const entry = getSeriesCacheEntry(seriesId);
    const resolved = entry?.resolved;

    if (
        resolved?.douyinId
    ) {
        return {...resolved};
    }

    return null;
}

export function clearSeriesRuntimeCache(): void {
    seriesRuntimeCache.clear();
    runtimeMetrics.cacheMisses = 0;
    runtimeMetrics.resolvedCacheHits = 0;
}

export function getCacheStats(): CacheStatsSummary {
    const totalHits = runtimeMetrics.resolvedCacheHits;
    const totalRequests = totalHits + runtimeMetrics.cacheMisses;
    const hitRatio = totalRequests > 0 ? Math.round((totalHits / totalRequests) * 10000) / 100 : 0;

    return {
        totalEntries: seriesRuntimeCache.size,
        resolvedCacheHits: runtimeMetrics.resolvedCacheHits,
        totalCacheHits: totalHits,
        cacheMisses: runtimeMetrics.cacheMisses,
        hitRatio,
    };
}
