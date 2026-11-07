import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createChangduOpenApiClient } from '../../src/platform/changdu_openapi.ts';
import { createDramaResolver } from '../../src/coordinator/drama_resolver.ts';
import { clearSeriesRuntimeCache, setSeriesCacheField } from '../../src/core/cache.ts';

const bookId = '1234567890123456789';
const playletId = '9876543210123456789';
const native = { book_id: bookId, playlet_id: playletId, book_name: '测试剧', publish_status: 2, permission_status: 4, delivery_status: true };
const list = (data: unknown[], total = data.length) => ({ code: 200, total, data });

function setup(options: {
    invalidPaid?: boolean;
    invalidPublishStatus?: boolean;
    noPermission?: boolean;
    mismatchedPlayletId?: boolean;
} = {}) {
    const requests: { path: string; paid: boolean; post: boolean }[] = [];
    let time = Date.parse('2026-09-05T00:00:00Z');
    const api = createChangduOpenApiClient({
        freeDistributorId: '111', paidDistributorId: '222', secretKey: 'mock-secret',
        now: () => time, sleep: async ms => { time += ms; },
        fetch: async (input, init = {}) => {
            const url = new URL(String(input));
            const post = init.method === 'POST';
            const body = post ? JSON.parse(String(init.body)) : null;
            const paid = String(post ? body.distributor_id : url.searchParams.get('distributor_id')) === '222';
            const path = url.pathname;
            requests.push({ path, paid, post });
            let value: unknown;
            if (path.includes('/content/aweme_series/')) {
                let delivery_status = true;
                let publish_status = 2;
                let permission_status = 4;
                let currentPlayletId = playletId;

                if (paid && options.invalidPaid) delivery_status = false;
                if (!paid && options.invalidPublishStatus) publish_status = 1;
                if (!paid && options.noPermission) permission_status = 2;
                if (paid && options.mismatchedPlayletId) currentPlayletId = '9876543210123456799';

                value = list([{ ...native, playlet_id: currentPlayletId, delivery_status, publish_status, permission_status }]);
            } else {
                throw new Error(`作品解析只能访问内容接口: ${path}`);
            }
            return new Response(JSON.stringify(value));
        },
    });
    const resolve = createDramaResolver(api);
    return { requests, run: () => resolve({ freeListPage: null, keyword: `漫剧ID：${bookId}` }) };
}

describe('Changdu resolver 作品解析与两渠道资格核验', () => {
    beforeEach(() => {
        assert.ok(process.env.R3_DATA_DIR, '必须由隔离数据的测试运行器执行');
        clearSeriesRuntimeCache();
    });

    test('解析作品时只查询内容接口并返回作品ID与剧名', async () => {
        const { run, requests } = setup();
        const result = await run();
        assert.equal(result.ok, true);
        assert.equal(result.name, '测试剧');
        assert.equal(result.douyinId, playletId);
        assert.equal(result.seriesId, bookId);

        // 仅调用了 /content/ 接口核验两渠道
        assert.ok(requests.some(r => r.path.includes('/content/') && !r.paid));
        assert.ok(requests.some(r => r.path.includes('/content/') && r.paid));
        assert.ok(requests.every(r => r.path === '/novelsale/openapi/content/aweme_series/list/v1/' && !r.post));
    });

    test('已有缓存也不能绕过付费渠道不可投状态', async () => {
        setSeriesCacheField(bookId, 'resolved', { name: '旧缓存', seriesId: bookId, douyinId: playletId });
        const { run, requests } = setup({ invalidPaid: true });
        const result = await run();
        assert.equal(result.ok, false);
        assert.match(result.status, /不可投放/);
        assert.ok(!requests.some(request => request.post));
    });

    test('免费渠道未发布时阻断解析', async () => {
        const { run } = setup({ invalidPublishStatus: true });
        const result = await run();
        assert.equal(result.ok, false);
        assert.match(result.status, /未发布|下架/);
    });

    test('免费渠道无授权时阻断解析', async () => {
        const { run } = setup({ noPermission: true });
        const result = await run();
        assert.equal(result.ok, false);
        assert.match(result.status, /无授权/);
    });

    test('两渠道抖音作品ID不一致时阻断解析', async () => {
        const { run } = setup({ mismatchedPlayletId: true });
        const result = await run();
        assert.equal(result.ok, false);
        assert.match(result.status, /作品 ID 不一致/);
    });

    test('有效解析后再次请求命中内存缓存', async () => {
        const { run, requests } = setup();
        const first = await run();
        assert.equal(first.ok, true);
        assert.equal(first.cacheHit, undefined);

        const initialRequestCount = requests.length;
        const second = await run();
        assert.equal(second.ok, true);
        assert.equal(second.cacheHit, true);
        assert.equal(second.status, '成功(cache)');
        // 缓存命中时依然校验实时两渠道可投状态，
        assert.ok(requests.length > initialRequestCount);
        assert.ok(!requests.some(r => r.post));
    });

    test('缓存作品ID与端原生作品不一致时抛出异常', async () => {
        setSeriesCacheField(bookId, 'resolved', { name: '旧缓存', seriesId: bookId, douyinId: '9999999999999999999' });
        const { run } = setup();
        const result = await run();
        assert.equal(result.ok, false);
        assert.match(result.status, /缓存作品 ID 与端原生作品不一致/);
    });
});
