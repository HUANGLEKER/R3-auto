import {parseDramaInput} from '../core/drama_input.ts';
import {getResolvedSeriesCache, setSeriesCacheField, runtimeMetrics} from '../core/cache.ts';
import {profiler} from '../infra/profiler.ts';
import {createCatalogPort} from '../platform/catalog_adapter.ts';
import {
    ChangduEligibilityError,
    isQpsLimitError,
    checkOpenApiBookEligibility,
    isChangduOpenApiConfigured,
    resolveOpenApiBookId
} from '../platform/changdu_openapi.ts';

import {platformId, type ResolverResult as Result, type BookEligibilityPort} from '../contracts/platform.ts';

const defaultOpenApi = {checkOpenApiBookEligibility, isChangduOpenApiConfigured, resolveOpenApiBookId};

/** 注入接口客户端以验证完整业务流程，测试不访问真实平台。 */
export function createDramaResolver(api: BookEligibilityPort = defaultOpenApi) {
    const {checkOpenApiBookEligibility, isChangduOpenApiConfigured, resolveOpenApiBookId} = api;

    async function resolveByBookId(seriesId: string, name: string, signal?: AbortSignal): Promise<Result> {
        seriesId = platformId(seriesId, 'book');
        signal?.throwIfAborted();
        console.log(`   📋 [2/4] 资质核对: 校验双渠道发布状态与授权...`);
        const [freeBook, paidBook] = await Promise.all([checkOpenApiBookEligibility('free', seriesId, signal), checkOpenApiBookEligibility('paid', seriesId, signal)]);
        console.log(`   ⚖️ [4/4] 渠道对齐: 确认免费与付费作品一致性...`);
        if (freeBook.playletId !== paidBook.playletId) throw new Error('免费与付费渠道的端原生作品 ID 不一致');
        platformId(freeBook.playletId, 'playlet');
        console.log(`   🆔 [3/4] 提取作品ID: 抖音作品 ID ${freeBook.playletId}`);
        const cached = getResolvedSeriesCache(seriesId);
        if (cached) {
            if (cached.douyinId !== freeBook.playletId) throw new Error('缓存作品 ID 与端原生作品不一致');
            signal?.throwIfAborted();
            runtimeMetrics.resolvedCacheHits++;
            return {ok: true, status: '成功(cache)', attempts: [], cacheHit: true, ...cached};
        }
        runtimeMetrics.cacheMisses++;
        signal?.throwIfAborted();
        const douyinId = freeBook.playletId;
        const resolvedName = name || (freeBook as any).bookName || (paidBook as any).bookName || '';
        const resolved = {name: resolvedName, seriesId, douyinId};
        setSeriesCacheField(seriesId, 'resolved', resolved);
        return {ok: true, status: '成功(OpenAPI)', attempts: [], ...resolved};
    }

    async function resolveFirstUsableDrama({freeListPage, keyword, signal}: {
        freeListPage: any;
        keyword: string;
        signal?: AbortSignal
    }): Promise<Result> {
        const span = profiler.startSpan('resolver.resolve', 'RESOLVER', {keyword});
        try {
            signal?.throwIfAborted();
            if (!isChangduOpenApiConfigured()) return {ok: false, status: '未配置常读 OpenAPI', attempts: []};
            const input = parseDramaInput(keyword);
            if (input.kind !== 'title') {
                console.log(`   🔍 [1/4] 只读查询常读漫剧 ID 信息...`);
                const book = await resolveOpenApiBookId(input.id, input.kind, signal);
                const result = await resolveByBookId(book.bookId, book.bookName || keyword, signal);
                span.end({ok: result.ok});
                return result;
            }
            if (!freeListPage) return {ok: false, status: '剧名输入需要常读漫剧列表页面', attempts: []};
            console.log(`   🔍 [1/4] 只读检索常读漫剧候选列表: ${keyword}...`);
            const search = await createCatalogPort(freeListPage).search(keyword, signal);
            const attempts: string[] = [];
            for (const candidate of search.candidates) {
                signal?.throwIfAborted();
                try {
                    const result = await resolveByBookId(candidate.seriesId, candidate.name, signal);
                    if (result.ok) {
                        span.end({ok: true});
                        return result;
                    }
                    attempts.push(...result.attempts);
                } catch (error) {
                    if (!(error instanceof ChangduEligibilityError)) throw error;
                    attempts.push(`${candidate.seriesId}: ${error.message}`);
                }
            }
            return {ok: false, status: search.reason || '没有可用候选', attempts};
        } catch (error: any) {
            span.endWithError(error);
            if (signal?.aborted) throw signal.reason;
            return {
                ok: false, status: error.message || '解析失败', attempts: [error.message || '解析失败'],
                errorCode: error.code, category: error.category === 'uncertain' ? 'uncertain'
                    : isQpsLimitError(error) ? 'retryable' : 'unavailable'
            };
        }
    }

    return resolveFirstUsableDrama;
}

export const resolveFirstUsableDrama = createDramaResolver();
