// Isolated verification of native content lookup; all HTTP operations are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-changdu-review-'));
process.env.R3_DATA_DIR = testDataDir;

try {
    const { createChangduOpenApiClient } = await import('../src/platform/changdu_openapi.ts');
    const { createDramaResolver } = await import('../src/coordinator/drama_resolver.ts');
    const bookId = '7682004023548841022';
    const playletId = '7876543210123456789';
    const calls: string[] = [];
    const api = createChangduOpenApiClient({
        freeDistributorId: '111', paidDistributorId: '222', secretKey: 'mock-only',
        minIntervalMs: 0,
        fetch: async (input, init = {}) => {
            const url = new URL(String(input));
            assert.equal(url.pathname, '/novelsale/openapi/content/aweme_series/list/v1/');
            assert.equal(init.method ?? 'GET', 'GET');
            calls.push(url.searchParams.get('distributor_id')!);
            return new Response(`{"code":200,"total":1,"data":[{"book_id":${bookId},"playlet_id":${playletId},"book_name":"模拟剧目","publish_status":2,"permission_status":4,"delivery_status":true}]}`);
        },
    });
    const resolve = createDramaResolver(api);
    const result = await resolve({ freeListPage: null, keyword: `漫剧ID：${bookId}` });
    assert.equal(result.ok, true);
    assert.equal(result.seriesId, bookId);
    assert.equal(result.douyinId, playletId);
    assert.ok(calls.includes('111'));
    assert.ok(calls.includes('222'));
    console.log('常读内容查询验证通过：两渠道资格核验、长 ID 无损解析，全部 HTTP 模拟。');
} finally {
    fs.rmSync(testDataDir, { recursive: true, force: true });
}
