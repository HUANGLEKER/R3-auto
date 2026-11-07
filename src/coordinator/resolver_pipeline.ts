// ============================================================
// Drama Resolver Pipeline (流水线重叠与预解析引擎)
// Overlapping Producer (Changdu Resolver) & Consumer (Stage Subtask)
// ============================================================

import {profiler} from '../infra/profiler.ts';
import {writeStructuredLog} from '../core/structured_log.ts';
import {resolveFirstUsableDrama} from './drama_resolver.ts';
import type {ResolverResult, ResolverPort} from '../contracts/platform.ts';

export interface PrefetchedItem {
    index: number;
    keyword: string;
    startTime: number;
    promise: Promise<ResolverResult>;
}

export interface PipelineStats {
    totalPrefetched: number;
    totalConsumed: number;
    totalWaitTimeMs: number;
    totalOverlapSavedMs: number;
}

export class DramaResolverPipeline implements ResolverPort {
    private freeListPage: any;

    private currentPrefetch: PrefetchedItem | null = null;
    private isAborted = false;
    private abortController = new AbortController();
    private signal: AbortSignal;
    private inFlight = new Set<Promise<ResolverResult>>();
    private resolveDrama: typeof resolveFirstUsableDrama;

    private stats: PipelineStats = {
        totalPrefetched: 0,
        totalConsumed: 0,
        totalWaitTimeMs: 0,
        totalOverlapSavedMs: 0,
    };

    constructor(options: {
        freeListPage: any;
        abortSignal?: AbortSignal;
        resolveDrama?: typeof resolveFirstUsableDrama;
    }) {
        this.freeListPage = options.freeListPage;
        this.signal = AbortSignal.any([this.abortController.signal, ...(options.abortSignal ? [options.abortSignal] : [])]);
        this.resolveDrama = options.resolveDrama ?? resolveFirstUsableDrama;
    }

    public getStats(): PipelineStats {
        return {...this.stats};
    }

    /**
     * 在后台启动下一条漫剧的常读解析（Producer），与搭剧平台的填单提交并发重叠执行
     */
    public prefetch(keyword: string, index: number): void {
        if (this.isAborted || this.signal.aborted) {
            return;
        }

        if (this.currentPrefetch && this.currentPrefetch.index === index) {
            return;
        }

        const startTime = performance.now();
        const prefetchSpan = profiler.startSpan(
            `pipeline.prefetch_item_${index + 1}:${keyword}`,
            'RESOLVER',
            {index: index + 1, keyword}
        );

        const promise = this.resolveDrama({
            freeListPage: this.freeListPage,
            keyword,
            signal: this.signal,
        })
            .then(result => {
                prefetchSpan.end({ok: result.ok, status: result.status});
                return result;
            })
            .catch(error => {
                prefetchSpan.endWithError(error);
                throw error;
            });

        // The consumer may not call get() until the current stage submission
        // completes. Mark the rejection as handled now, while preserving the
        // original rejected promise for get() to propagate to the caller.
        void promise.catch(() => {
        });
        this.track(promise);

        this.currentPrefetch = {
            index,
            keyword,
            startTime,
            promise,
        };

        this.stats.totalPrefetched++;

        writeStructuredLog('PIPELINE_PREFETCH_TRIGGERED', {
            index: index + 1,
            keyword,
        });
    }

    /**
     * 获取当前漫剧的解析结果（Consumer）
     * 若已在后台预取完成，则立即返回（0 等待）；若尚未完成，则等待其就绪
     */
    public async get(keyword: string, index: number): Promise<ResolverResult> {
        if (this.isAborted || this.signal.aborted) {
            throw new Error('Pipeline has been aborted');
        }

        const waitSpan = profiler.startSpan(
            `pipeline.wait_item_${index + 1}:${keyword}`,
            'RESOLVER',
            {index: index + 1, keyword}
        );

        let targetPromise: Promise<ResolverResult>;
        let wasPrefetched = false;
        let prefetchStartTime = 0;

        if (
            this.currentPrefetch &&
            this.currentPrefetch.index === index &&
            this.currentPrefetch.keyword === keyword
        ) {
            targetPromise = this.currentPrefetch.promise;
            prefetchStartTime = this.currentPrefetch.startTime;
            wasPrefetched = true;
            this.currentPrefetch = null;
        } else {
            // 未被预取或索引不匹配时，即时执行解析
            prefetchStartTime = performance.now();
            targetPromise = this.resolveDrama({
                freeListPage: this.freeListPage,
                keyword,
                signal: this.signal,
            });
            this.track(targetPromise);
        }

        const waitStart = performance.now();
        try {
            const result = await targetPromise;
            const waitDurationMs = Math.round((performance.now() - waitStart) * 100) / 100;
            const totalResolveDurationMs = Math.round((performance.now() - prefetchStartTime) * 100) / 100;
            const overlapSavedMs = wasPrefetched ? Math.max(0, totalResolveDurationMs - waitDurationMs) : 0;

            this.stats.totalConsumed++;
            this.stats.totalWaitTimeMs += waitDurationMs;
            this.stats.totalOverlapSavedMs += overlapSavedMs;

            waitSpan.end({
                ok: result.ok,
                wasPrefetched,
                waitDurationMs,
                totalResolveDurationMs,
                overlapSavedMs,
            });

            writeStructuredLog('PIPELINE_ITEM_CONSUMED', {
                index: index + 1,
                keyword,
                wasPrefetched,
                waitDurationMs,
                totalResolveDurationMs,
                overlapSavedMs,
            });

            if (wasPrefetched && overlapSavedMs > 100) {
                console.log(
                    `   ⚡ 流水线重叠加速: 预解析节省 ≈${(overlapSavedMs / 1000).toFixed(2)}s (等待 ${(waitDurationMs / 1000).toFixed(2)}s)`
                );
            }

            return result;
        } catch (error) {
            waitSpan.endWithError(error);
            throw error;
        }
    }

    /**
     * 终止流水线并清理挂起的预解析任务。
     * abort 向内容查询传递取消信号；drain 等待在途查询收尾。
     * 调用方必须在释放运行锁前 await drain()，避免后台请求跨运行写入。
     */
    public async drain(): Promise<void> {
        const pending = this.currentPrefetch?.promise;
        this.abort();
        await Promise.allSettled([...this.inFlight, ...(pending ? [pending] : [])]);
        this.currentPrefetch = null;
    }

    public abort(): void {
        this.isAborted = true;
        this.abortController.abort(new Error('任务已停止'));
        if (this.currentPrefetch) {
            // 吞掉挂起 Promise 的 rejection，避免 unhandledRejection 告警
            this.currentPrefetch.promise.catch(() => {
            });
        }
        writeStructuredLog('PIPELINE_ABORTED', {
            stats: {...this.stats},
        });
    }

    private track(promise: Promise<ResolverResult>): void {
        this.inFlight.add(promise);
        void promise.then(() => this.inFlight.delete(promise), () => this.inFlight.delete(promise));
    }
}
