import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChangduOpenApiClient, ChangduOpenApiError, isQpsLimitError } from '../../src/platform/changdu_openapi.ts';

const bookId = '1234567890123456789';
const playletId = '9876543210123456789';
const native = { book_id: bookId, playlet_id: playletId, book_name: '测试剧', publish_status: 2, permission_status: 4, delivery_status: true };
const list = (data: unknown[], total = data.length) => ({ code: 200, total, data });
function client(handler: (url: URL, init: RequestInit, index: number) => unknown, time = Date.parse('2026-09-05T17:00:00Z')) {
    const calls: { url: URL; init: RequestInit; time: number }[] = [];
    const sleeps: number[] = [];
    const api = createChangduOpenApiClient({
        freeDistributorId: '1111111111111111111', paidDistributorId: '2222222222222222222', secretKey: 'test-secret',
        now: () => time,
        sleep: async ms => { sleeps.push(ms); time += ms; },
        fetch: async (input, init = {}) => {
            const url = new URL(String(input));
            calls.push({ url, init, time });
            const value = handler(url, init, calls.length - 1);
            return value instanceof Response ? value : new Response(JSON.stringify(value));
        },
    });
    return { api, calls, sleeps };
}

describe('Changdu OpenAPI 官方响应契约', () => {
    test('授权按渠道判定：免费2明确无授权，付费4普通授权，未知值不放行', async () => {
        // 隔离授权校验：发布和可投使用合格值，避免被其他资格条件提前拦截。
        const { api } = client(url => list([{ ...native, permission_status: url.searchParams.get('distributor_id') === '1111111111111111111' ? 2 : 4 }]));
        await assert.rejects(api.checkOpenApiBookEligibility('free', bookId), /作品无授权/);
        assert.equal((await api.checkOpenApiBookEligibility('paid', bookId)).playletId, playletId);
        const unknown = client(() => list([{ ...native, permission_status: 3 }]));
        await assert.rejects(unknown.api.checkOpenApiBookEligibility('paid', bookId), /授权状态未知/);
    });

    test('当前端原生query兼容每页20条，普通授权值4，不套用书本详情枚举', async () => {
        const { api, calls } = client(() => list([native]));
        await api.resolveOpenApiBookId(bookId, 'book_id');
        assert.equal(calls[0].url.searchParams.get('page_size'), '20');
        const unknown = client(() => list([{ ...native, permission_status: 1 }]));
        await assert.rejects(unknown.api.resolveOpenApiBookId(bookId, 'book_id'), /授权/);
    });

    test('分页重复、提前空页、总数变化和无列表响应均阻断', async () => {
        for (const mode of ['repeated', 'empty', 'changed', 'missing']) {
            const { api } = client((_url, _init, i) => {
                if (mode === 'missing') return { code: 200 };
                if (i === 0 || mode === 'repeated') return list([native], 2);
                return mode === 'empty' ? list([], 2) : list([{ ...native, book_id: '1234567890123456790' }], 3);
            });
            await assert.rejects(api.checkOpenApiBookEligibility('paid', bookId), /分页|总数变化|列表响应缺失/);
        }
    });

    test('分页提前结束时不按 QPS 限流重试且不往后翻页探测，直接阻断跳过；无结果时立即返回不冗余重试', async () => {
        // 场景 1：第 0 页提前返回空记录（total: 1 但 data: []），不重试也不往后翻页探测，立即抛出分页提前结束错误
        const { api: prematureApi, calls: prematureCalls, sleeps: prematureSleeps } = client(() => list([], 1));
        await assert.rejects(
            prematureApi.resolveOpenApiBookId(bookId, 'book_id'),
            error => error instanceof Error && error.message.includes('常读 OpenAPI 分页提前结束')
        );
        assert.equal(prematureCalls.length, 1);
        assert.equal(prematureSleeps.length, 0);

        // 场景 2：正常无匹配记录（total: 0 且 data: []），直接判定未查询到，不冗余重试
        const { api: notFoundApi, calls: notFoundCalls, sleeps: notFoundSleeps } = client(() => list([], 0));
        await assert.rejects(notFoundApi.resolveOpenApiBookId(bookId, 'book_id'), /未查询到对应端原生作品/);
        assert.equal(notFoundCalls.length, 1);
        assert.equal(notFoundSleeps.length, 0);
    });

    test('兼容 result 和 has_more 分页', async () => {
        const { api, calls } = client((_url, _init, i) => ({ code: 200, result: [{ ...native, book_id: i ? '1234567890123456790' : bookId }], has_more: i === 0 }));
        assert.equal((await api.checkOpenApiBookEligibility('paid', bookId)).playletId, playletId);
        assert.equal(calls.length, 2);
    });

    test('唯一端原生 ID 解析保留长整数精度', async () => {
        const { api } = client(() => new Response(`{"code":200,"total":1,"data":[{"book_id":${bookId},"playlet_id":${playletId},"book_name":"测试剧","publish_status":2,"permission_status":4,"delivery_status":true}]}`));
        assert.equal((await api.resolveOpenApiBookId(playletId, 'douyin_id')).bookId, bookId);
        assert.equal((await api.resolveOpenApiBookId(bookId, 'book_id')).bookId, bookId);
    });

    test('所有数字输入路径都拒绝下架、不可投、无授权和缺失状态', async () => {
        for (const kind of ['book_id', 'douyin_id', 'ambiguous_id'] as const) {
            for (const override of [{ publish_status: 3 }, { publish_status: 1 }, { delivery_status: false }, { permission_status: 2 }, { permission_status: 0 }, { delivery_status: undefined }]) {
                const { api, calls } = client(() => list([{ ...native, ...override }]));
                await assert.rejects(api.resolveOpenApiBookId(kind === 'douyin_id' ? playletId : bookId, kind), /状态|授权|投放/);
                assert.equal(calls.length, 1);
            }
        }
    });

    test('多版本、空结果和不匹配的抖音ID不能降级到书本详情放行', async () => {
        for (const rows of [[], [native, { ...native, book_id: '1234567890123456790' }], [{ ...native, playlet_id: '9876543210123456790' }]]) {
            const { api, calls } = client(() => list(rows));
            await assert.rejects(api.resolveOpenApiBookId(playletId, 'douyin_id'), /多个版本|未查询到/);
            assert.equal(calls.length, 1);
        }
    });

    test('多版本必须读取完所有页再判断唯一性', async () => {
        const { api, calls } = client((_url, _init, i) => list([{ ...native, book_id: i ? '1234567890123456790' : bookId }], 2));
        await assert.rejects(api.resolveOpenApiBookId(playletId, 'douyin_id'), /多个版本/);
        assert.equal(calls.length, 2);
    });

    test('主管账号两个渠道的同接口请求共享限流', async () => {
        const { api, calls } = client(() => list([native]));
        await Promise.all(Array.from({ length: 5 }, (_, i) => api.checkOpenApiBookEligibility(i % 2 ? 'paid' : 'free', bookId)));
        for (let i = 1; i < calls.length; i++) assert.ok(calls[i].time - calls[i - 1].time >= 1000);
    });

    test('GET 重试退避期间取消，不会继续请求', async () => {
        const controller = new AbortController();
        let requests = 0;
        let sleeping!: () => void;
        const startedSleep = new Promise<void>(resolve => { sleeping = resolve; });
        const api = createChangduOpenApiClient({
            freeDistributorId: '111', paidDistributorId: '222', secretKey: 'test-only',
            fetch: async () => { requests++; throw new TypeError('temporary failure'); },
            sleep: () => { sleeping(); return new Promise<void>(() => {}); },
        });
        const pending = api.checkOpenApiBookEligibility('paid', bookId, controller.signal);
        await startedSleep;
        controller.abort(new Error('用户停止'));
        await assert.rejects(pending, /用户停止/);
        assert.equal(requests, 1);
    });

    test('限流GET有限重试，尊重Retry-After并重新签名', async () => {
        const { api, calls, sleeps } = client((_url, _init, i) => i === 0
            ? new Response(JSON.stringify({ code: 500, message: '访问速度过快' }), { status: 429, headers: { 'retry-after': '2' } })
            : list([native]));
        await api.checkOpenApiBookEligibility('free', bookId);
        assert.equal(calls.length, 2);
        assert.ok(sleeps.includes(2000));
        assert.notEqual(new Headers(calls[0].init.headers).get('header-ts'), new Headers(calls[1].init.headers).get('header-ts'));
    });

    test('网络故障和内部错误可恢复，鉴权错误不重试且保留上下文', async () => {
        const recover = client((_url, _init, i) => {
            if (i === 0) throw new TypeError('fetch failed');
            return i === 1 ? { code: 501, message: '内部错误' } : list([native]);
        });
        await recover.api.checkOpenApiBookEligibility('free', bookId);
        assert.equal(recover.calls.length, 3);
        for (const code of [410, 411, 412, 413]) {
            const { api, calls } = client(() => ({ code, message: '鉴权错误' }));
            await assert.rejects(api.checkOpenApiBookEligibility('free', bookId), error => error instanceof ChangduOpenApiError && error.code === code && error.endpoint.includes('/content/aweme_series/'));
            assert.equal(calls.length, 1);
        }
    });

    test('持续临时故障最多请求三次', async () => {
        const { api, calls } = client(() => new Response('unavailable', { status: 503 }));
        await assert.rejects(api.checkOpenApiBookEligibility('free', bookId), /HTTP 503/);
        assert.equal(calls.length, 3);
    });


    test('内容查询 GET 签名使用排序参数并与发送值一致', async () => {
        const { api, calls } = client(() => list([native]));
        await api.checkOpenApiBookEligibility('free', bookId);
        const { url, init } = calls[0];
        const headers = new Headers(init.headers);
        const params = Object.fromEntries(url.searchParams);
        const values = Object.keys(params).sort().map(key => `${params[key]}|`).join('');
        const expected = createHash('md5').update(`${params.distributor_id}test-secret${headers.get('header-ts')}${values}`).digest('hex');
        assert.equal(headers.get('header-sign'), expected);
        assert.equal(url.pathname, '/novelsale/openapi/content/aweme_series/list/v1/');
        assert.equal(init.method ?? 'GET', 'GET');
        assert.ok(!url.href.includes('test-secret'));
    });

    test('内容响应截断时阻断解析', async () => {
        const { api } = client(() => ({ ...list([native]), is_truncated: true }));
        await assert.rejects(api.checkOpenApiBookEligibility('free', bookId), /截断/);
    });

    test('isQpsLimitError 正确区分 QPS 限流与用户主动取消 (AbortError)', () => {
        const userAbortErr = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
        assert.equal(isQpsLimitError(userAbortErr), false);

        const qpsErr1 = new Error('访问速度过快，请稍后重试');
        assert.equal(isQpsLimitError(qpsErr1), true);

        const qpsErr2 = new ChangduOpenApiError('QPS limit reached', 500);
        assert.equal(isQpsLimitError(qpsErr2), true);

        const timeoutAbortErr = Object.assign(new Error('aborted due to timeout'), { name: 'AbortError' });
        assert.equal(isQpsLimitError(timeoutAbortErr), true);
    });
});
