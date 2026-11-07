// ============================================================
// Performance Profiler Infrastructure
// High-Resolution Hierarchical Spans, Metric Aggregation & Diagnostics
// ============================================================

import fs from 'node:fs';
import { scopedProxy } from '../core/run_context.ts';
import path from 'node:path';
import { DATA_DIR } from '../core/paths.ts';
import { writeStructuredLog } from '../core/structured_log.ts';
import { setLockProfilerHook } from '../core/lock.ts';

export type ProfileCategory =
    | 'DOM'
    | 'XHR'
    | 'NETWORK'
    | 'LOCK'
    | 'RESOLVER'
    | 'STAGE'
    | 'FSM'
    | 'CDP'
    | 'PAGE'
    | 'CACHE'
    | 'GUARD'
    | 'OTHER';


export interface ProfileCheckpoint {
    name: string;
    timestamp: number;
    elapsedMs: number;
}

export interface ProfileSpan {
    id: string;
    name: string;
    category: ProfileCategory;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    parentId?: string;
    metadata: Record<string, unknown>;
    checkpoints: ProfileCheckpoint[];
    status: 'RUNNING' | 'COMPLETED' | 'ERROR';
    error?: string;
}

export interface CategoryStats {
    category: ProfileCategory;
    count: number;
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    p90Ms: number;
    p99Ms: number;
    percentOfTotal: number;
}

export interface SpanAggregateStats {
    name: string;
    category: ProfileCategory;
    count: number;
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    p90Ms: number;
    p99Ms: number;
}

export interface BottleneckItem {
    name: string;
    category: ProfileCategory;
    durationMs: number;
    timestamp: number;
    metadata: Record<string, unknown>;
    impactScore: number;
}

export interface LockContentionStats {
    totalLockRequests: number;
    totalQueueWaitMs: number;
    totalHoldMs: number;
    maxQueueWaitMs: number;
    avgQueueWaitMs: number;
}

export interface ProfilerReport {
    runId: string;
    generatedAt: string;
    totalWallClockMs: number;
    totalProfiledSpanMs: number;
    spanCount: number;
    categoryBreakdown: CategoryStats[];
    topSlowestSpans: SpanAggregateStats[];
    bottlenecks: BottleneckItem[];
    lockContention: LockContentionStats;
    metadata: Record<string, unknown>;
}

export class SpanHandle {
    private span: ProfileSpan;
    private profiler: PerformanceProfiler;

    constructor(span: ProfileSpan, profiler: PerformanceProfiler) {
        this.span = span;
        this.profiler = profiler;
    }

    public get id(): string {
        return this.span.id;
    }

    public checkpoint(name: string): this {
        const now = performance.now();
        const elapsedMs = now - this.span.startTime;
        this.span.checkpoints.push({
            name,
            timestamp: now,
            elapsedMs: Math.round(elapsedMs * 100) / 100,
        });
        return this;
    }

    public setMetadata(key: string, value: unknown): this {
        this.span.metadata[key] = value;
        return this;
    }

    public mergeMetadata(metadata: Record<string, unknown>): this {
        Object.assign(this.span.metadata, metadata);
        return this;
    }

    public end(extraMetadata?: Record<string, unknown>): ProfileSpan {
        if (extraMetadata) {
            this.mergeMetadata(extraMetadata);
        }
        return this.profiler.endSpan(this.span.id);
    }

    public endWithError(error: unknown, extraMetadata?: Record<string, unknown>): ProfileSpan {
        if (extraMetadata) {
            this.mergeMetadata(extraMetadata);
        }
        const errorMsg = error instanceof Error ? error.message : String(error || 'Unknown error');
        return this.profiler.endSpan(this.span.id, errorMsg);
    }
}

export class PerformanceProfiler {
    private spans: Map<string, ProfileSpan> = new Map();
    private spanList: ProfileSpan[] = [];
    private spanCounter = 0;
    private runStartTime = performance.now();
    private lockWaitEvents: Array<{ waitMs: number; holdMs: number }> = [];
    private metadata: Record<string, unknown> = {};

    public setRunMetadata(key: string, value: unknown): void {
        this.metadata[key] = value;
    }

    public startSpan(
        name: string,
        category: ProfileCategory = 'OTHER',
        metadata: Record<string, unknown> = {},
        parentId?: string
    ): SpanHandle {
        this.spanCounter++;
        const id = `span_${Date.now()}_${this.spanCounter}`;
        const span: ProfileSpan = {
            id,
            name,
            category,
            startTime: performance.now(),
            parentId,
            metadata: { ...metadata },
            checkpoints: [],
            status: 'RUNNING',
        };

        this.spans.set(id, span);
        this.spanList.push(span);
        return new SpanHandle(span, this);
    }

    public endSpan(id: string, error?: string): ProfileSpan {
        const span = this.spans.get(id);
        if (!span) {
            return {
                id,
                name: 'unknown',
                category: 'OTHER',
                startTime: 0,
                endTime: 0,
                durationMs: 0,
                metadata: {},
                checkpoints: [],
                status: 'ERROR',
                error: 'Span not found',
            };
        }

        if (span.status === 'RUNNING') {
            span.endTime = performance.now();
            span.durationMs = Math.round((span.endTime - span.startTime) * 100) / 100;
            if (error) {
                span.status = 'ERROR';
                span.error = error;
            } else {
                span.status = 'COMPLETED';
            }
        }

        return span;
    }

    public async measure<T>(
        name: string,
        category: ProfileCategory,
        fn: (handle: SpanHandle) => Promise<T> | T,
        metadata: Record<string, unknown> = {}
    ): Promise<T> {
        const handle = this.startSpan(name, category, metadata);
        try {
            const result = await fn(handle);
            handle.end();
            return result;
        } catch (error) {
            handle.endWithError(error);
            throw error;
        }
    }

    public recordLockEvent(waitMs: number, holdMs: number): void {
        this.lockWaitEvents.push({
            waitMs: Math.max(0, waitMs),
            holdMs: Math.max(0, holdMs),
        });
    }

    private calculatePercentile(sortedValues: number[], percentile: number): number {
        if (sortedValues.length === 0) return 0;
        const index = Math.min(
            sortedValues.length - 1,
            Math.max(0, Math.floor((percentile / 100) * sortedValues.length))
        );
        return Math.round((sortedValues[index] || 0) * 100) / 100;
    }

    public getReport(runId: string = 'default'): ProfilerReport {
        const totalWallClockMs = Math.round((performance.now() - this.runStartTime) * 100) / 100;
        const completedSpans = this.spanList.filter(s => s.durationMs !== undefined);
        const totalProfiledSpanMs = completedSpans.reduce((sum, s) => sum + (s.durationMs || 0), 0);

        // Group by category
        const categoryMap = new Map<ProfileCategory, number[]>();
        for (const span of completedSpans) {
            const list = categoryMap.get(span.category) || [];
            list.push(span.durationMs || 0);
            categoryMap.set(span.category, list);
        }

        const categoryBreakdown: CategoryStats[] = [];
        for (const [category, durations] of categoryMap.entries()) {
            durations.sort((a, b) => a - b);
            const totalMs = durations.reduce((sum, d) => sum + d, 0);
            const count = durations.length;
            categoryBreakdown.push({
                category,
                count,
                totalMs: Math.round(totalMs * 100) / 100,
                avgMs: Math.round((totalMs / count) * 100) / 100,
                minMs: Math.round(durations[0] * 100) / 100,
                maxMs: Math.round(durations[durations.length - 1] * 100) / 100,
                p50Ms: this.calculatePercentile(durations, 50),
                p90Ms: this.calculatePercentile(durations, 90),
                p99Ms: this.calculatePercentile(durations, 99),
                percentOfTotal: totalWallClockMs > 0 ? Math.round((totalMs / totalWallClockMs) * 10000) / 100 : 0,
            });
        }
        categoryBreakdown.sort((a, b) => b.totalMs - a.totalMs);

        // Group by span name
        const nameMap = new Map<string, { category: ProfileCategory; durations: number[] }>();
        for (const span of completedSpans) {
            const entry = nameMap.get(span.name) || { category: span.category, durations: [] };
            entry.durations.push(span.durationMs || 0);
            nameMap.set(span.name, entry);
        }

        const topSlowestSpans: SpanAggregateStats[] = [];
        for (const [name, entry] of nameMap.entries()) {
            const sorted = [...entry.durations].sort((a, b) => a - b);
            const totalMs = sorted.reduce((sum, d) => sum + d, 0);
            const count = sorted.length;
            topSlowestSpans.push({
                name,
                category: entry.category,
                count,
                totalMs: Math.round(totalMs * 100) / 100,
                avgMs: Math.round((totalMs / count) * 100) / 100,
                minMs: Math.round(sorted[0] * 100) / 100,
                maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
                p50Ms: this.calculatePercentile(sorted, 50),
                p90Ms: this.calculatePercentile(sorted, 90),
                p99Ms: this.calculatePercentile(sorted, 99),
            });
        }
        topSlowestSpans.sort((a, b) => b.totalMs - a.totalMs);

        // Identify Top Bottlenecks
        const bottlenecks: BottleneckItem[] = completedSpans
            .filter(s => (s.durationMs || 0) > 300)
            .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
            .slice(0, 10)
            .map(s => ({
                name: s.name,
                category: s.category,
                durationMs: s.durationMs || 0,
                timestamp: s.startTime,
                metadata: s.metadata,
                impactScore: Math.round(((s.durationMs || 0) / (totalWallClockMs || 1)) * 10000) / 100,
            }));

        // Lock Contention Stats
        const lockWaits = this.lockWaitEvents.map(e => e.waitMs);
        const lockHolds = this.lockWaitEvents.map(e => e.holdMs);
        const totalQueueWaitMs = lockWaits.reduce((sum, w) => sum + w, 0);
        const totalHoldMs = lockHolds.reduce((sum, h) => sum + h, 0);
        const maxQueueWaitMs = lockWaits.length > 0 ? Math.max(...lockWaits) : 0;
        const avgQueueWaitMs = lockWaits.length > 0 ? Math.round((totalQueueWaitMs / lockWaits.length) * 100) / 100 : 0;

        const lockContention: LockContentionStats = {
            totalLockRequests: this.lockWaitEvents.length,
            totalQueueWaitMs: Math.round(totalQueueWaitMs * 100) / 100,
            totalHoldMs: Math.round(totalHoldMs * 100) / 100,
            maxQueueWaitMs: Math.round(maxQueueWaitMs * 100) / 100,
            avgQueueWaitMs,
        };

        return {
            runId,
            generatedAt: new Date().toISOString(),
            totalWallClockMs,
            totalProfiledSpanMs: Math.round(totalProfiledSpanMs * 100) / 100,
            spanCount: completedSpans.length,
            categoryBreakdown,
            topSlowestSpans: topSlowestSpans.slice(0, 15),
            bottlenecks,
            lockContention,
            metadata: { ...this.metadata },
        };
    }

    public printConsoleSummary(runId: string = 'default'): void {
        const report = this.getReport(runId);

        console.log('\n============================================================');
        console.log('⚡ PERFORMANCE PROFILER 真实性能数据深度分析');
        console.log('============================================================');
        console.log(`总运行耗时: ${(report.totalWallClockMs / 1000).toFixed(2)}s | 采样 Span 数量: ${report.spanCount}`);

        console.log('\n📊 分类耗时构成 (Category Breakdown):');
        console.log('------------------------------------------------------------');
        console.log(
            '分类'.padEnd(12) +
            '总耗时(ms)'.padEnd(14) +
            '占比'.padEnd(10) +
            '调用次数'.padEnd(10) +
            '平均(ms)'.padEnd(12) +
            'P90(ms)'
        );
        console.log('------------------------------------------------------------');

        for (const cat of report.categoryBreakdown) {
            console.log(
                cat.category.padEnd(12) +
                `${cat.totalMs}`.padEnd(14) +
                `${cat.percentOfTotal}%`.padEnd(10) +
                `${cat.count}`.padEnd(10) +
                `${cat.avgMs}`.padEnd(12) +
                `${cat.p90Ms}`
            );
        }

        console.log('\n⏱️ Top 耗时操作汇总 (Top Operations by Total Latency):');
        console.log('------------------------------------------------------------');
        console.log(
            '操作名称'.padEnd(32) +
            '分类'.padEnd(10) +
            '次数'.padEnd(8) +
            '总耗时(ms)'.padEnd(14) +
            'P50(ms)'.padEnd(10) +
            'P90(ms)'
        );
        console.log('------------------------------------------------------------');

        for (const span of report.topSlowestSpans.slice(0, 8)) {
            const shortName = span.name.length > 30 ? `${span.name.slice(0, 28)}..` : span.name;
            console.log(
                shortName.padEnd(32) +
                span.category.padEnd(10) +
                `${span.count}`.padEnd(8) +
                `${span.totalMs}`.padEnd(14) +
                `${span.p50Ms}`.padEnd(10) +
                `${span.p90Ms}`
            );
        }

        if (report.lockContention.totalLockRequests > 0) {
            console.log('\n🔒 互斥锁竞争分析 (PromoView Mutex Contention):');
            console.log('------------------------------------------------------------');
            console.log(
                `请求总数: ${report.lockContention.totalLockRequests} | ` +
                `排队等待总耗时: ${report.lockContention.totalQueueWaitMs}ms | ` +
                `最大单次等待: ${report.lockContention.maxQueueWaitMs}ms | ` +
                `平均等待: ${report.lockContention.avgQueueWaitMs}ms | ` +
                `锁持有总耗时: ${report.lockContention.totalHoldMs}ms`
            );
        }

        if (report.metadata?.pipelineStats) {
            const ps = report.metadata.pipelineStats as {
                totalPrefetched: number;
                totalConsumed: number;
                totalWaitTimeMs: number;
                totalOverlapSavedMs: number;
            };
            console.log('\n🚀 Resolver Pipeline 流水线重叠效率 (Pipeline Overlap Performance):');
            console.log('------------------------------------------------------------');
            console.log(
                `预解析总数: ${ps.totalPrefetched} | ` +
                `流水线消费: ${ps.totalConsumed} | ` +
                `累计重叠节省耗时: ≈${(ps.totalOverlapSavedMs / 1000).toFixed(2)}s (${Math.round(ps.totalOverlapSavedMs)}ms) | ` +
                `等待就绪总耗时: ${(ps.totalWaitTimeMs / 1000).toFixed(2)}s`
            );
        }

        if (report.bottlenecks.length > 0) {
            console.log('\n🔍 系统瓶颈与优化决策依据 (Resolver Pipeline Decision Insights):');
            console.log('------------------------------------------------------------');
            for (let i = 0; i < Math.min(3, report.bottlenecks.length); i++) {
                const b = report.bottlenecks[i];
                console.log(
                    `   [瓶颈 ${i + 1}] ${b.name} (${b.category}): ${b.durationMs}ms (影响度: ${b.impactScore}%)`
                );
            }
        }

        console.log('============================================================\n');
    }

    public saveReport(runId: string): string {
        const report = this.getReport(runId);
        const logDir = path.join(DATA_DIR, 'logs');
        const reportPath = path.join(logDir, `${runId}_profile.json`);
        try {
            fs.mkdirSync(logDir, { recursive: true });
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
            writeStructuredLog('PROFILER_REPORT_SAVED', {
                runId,
                reportPath,
                totalWallClockMs: report.totalWallClockMs,
                spanCount: report.spanCount,
            });
        } catch (_) {
            // Silently handle report write failures
        }

        return reportPath;
    }

    public reset(): void {
        this.spans.clear();
        this.spanList = [];
        this.spanCounter = 0;
        this.runStartTime = performance.now();
        this.lockWaitEvents = [];
        this.metadata = {};
    }
}

export const profiler = scopedProxy('profiler', () => new PerformanceProfiler());

// Wire lock profiling hook to decoupe core/lock.ts from infra/profiler.ts
setLockProfilerHook({
    onLockAcquired: (waitMs) => profiler.startSpan('withPromoViewLock', 'LOCK', { waitMs }),
    onLockReleased: (spanHandle, waitMs, holdMs) => {
        if (spanHandle && typeof spanHandle.end === 'function') {
            spanHandle.end({ waitMs, holdMs });
        }
    },
    recordLockEvent: (waitMs, holdMs) => profiler.recordLockEvent(waitMs, holdMs),
});
