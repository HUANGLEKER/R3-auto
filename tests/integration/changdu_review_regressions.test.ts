import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createChangduOpenApiClient } from '../../src/platform/changdu_openapi.ts';
import { createDramaResolver } from '../../src/coordinator/drama_resolver.ts';
import { DramaResolverPipeline } from '../../src/coordinator/resolver_pipeline.ts';
import { clearSeriesRuntimeCache } from '../../src/core/cache.ts';

const bookId = '1234567890123456789';
const secondId = '1234567890123456790';
const playletId = '7876543210123456789';
const list = (data: unknown[], total = data.length) => ({ code: 200, data, total });
const native = (id = bookId) => ({ book_id: id, playlet_id: playletId, book_name: '同名剧', publish_status: 2, permission_status: 4, delivery_status: true });

function setup(handler?: (url: URL, init: RequestInit) => unknown | Promise<unknown>) {
    const calls: { url: URL; init: RequestInit }[] = [];
    let time = Date.parse('2026-09-05T00:00:00Z');
    const api = createChangduOpenApiClient({
        freeDistributorId: '111', paidDistributorId: '222', secretKey: 'test-only',
        now: () => time, sleep: async ms => { time += ms; },
        fetch: async (input, init = {}) => {
            const url = new URL(String(input));
            calls.push({ url, init });
            assert.equal(url.pathname, '/novelsale/openapi/content/aweme_series/list/v1/');
            assert.equal(init.method ?? 'GET', 'GET');
            const body = await handler?.(url, init) ?? list([native(url.searchParams.get('query')!)]);
            return new Response(JSON.stringify(body));
        },
    });
    const resolve = createDramaResolver(api);
    return { calls, resolve, run: (signal?: AbortSignal) => resolve({ freeListPage: null, keyword: `漫剧ID：${bookId}`, signal }) };
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

describe('端原生作品解析回归（全部请求模拟）', () => {
    beforeEach(() => {
        assert.ok(process.env.R3_DATA_DIR, '必须使用隔离数据的测试运行器');
        clearSeriesRuntimeCache();
    });

    test('两渠道返回不同 playlet_id 时阻断', async () => {
        const { run } = setup(url => url.searchParams.get('distributor_id') === '222'
            ? list([{ ...native(), playlet_id: '7876543210123456790' }]) : undefined);
        assert.match((await run()).status, /渠道.*作品 ID 不一致/);
    });

    for (const external of [false, true]) {
        test(`${external ? 'Web 停止信号' : '流水线 abort'}在 GET 期间取消，排空后没有新请求`, async () => {
            const started = deferred();
            const release = deferred();
            const controller = new AbortController();
            const { resolve, calls } = setup(async () => { started.resolve(); await release.promise; });
            const pipeline = new DramaResolverPipeline({ freeListPage: null, resolveDrama: resolve, abortSignal: controller.signal });
            pipeline.prefetch(`漫剧ID：${bookId}`, 0);
            await started.promise;
            if (external) controller.abort(new Error('用户停止')); else pipeline.abort();
            release.resolve();
            await pipeline.drain();
            assert.equal(calls.length, 1);
            assert.equal(calls[0].init.signal?.aborted, true);
        });
    }

    for (const failure of ['eligibility', 'auth', 'pagination']) {
        test(`候选失败 ${failure}：只有确定作品资格失败可尝试下一候选`, async () => {
            const rows = [bookId, secondId].map((seriesId, index) => ({ index, seriesId, name: '同名剧', status: '已发布', deliveryStatus: '可投放', authStatus: '普通授权', rowText: '' }));
            const page = { bringToFront: async () => {}, waitForFunction: async () => {}, locator: () => ({ fill: async () => {}, click: async () => {}, evaluateAll: async () => rows }) };
            const { resolve, calls } = setup((url) => {
                if (url.searchParams.get('query') === bookId && url.searchParams.get('distributor_id') === '222') {
                    if (failure === 'eligibility') return list([{ ...native(), delivery_status: false }]);
                    if (failure === 'auth') return { code: 411, message: '鉴权失败' };
                    if (failure === 'pagination') return list([], 1);
                }
            });
            const result = await resolve({ freeListPage: page, keyword: '同名剧' });
            assert.equal(result.ok, failure === 'eligibility');
            assert.equal(calls.some(call => call.url.searchParams.get('query') === secondId), failure === 'eligibility');
            if (result.ok) assert.equal(result.seriesId, secondId);
        });
    }
});
