// ============================================================
// Integration Tests: Web Server REST API & Data Export
// ============================================================

import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, closeServer } from '../../src/web/server.ts';
import { automationBridge } from '../../src/web/automation_bridge.ts';
import fs from 'node:fs';
import { roiRatioPath, txtPath } from '../../src/core/paths.ts';
import { getAuditStore } from '../../src/core/audit_store.ts';
import type { RunAutomationOptions } from '../../src/runner.ts';
import { chromium } from 'playwright-core';

describe('Web Console Server: REST API & 集成接口测试', () => {
    let port = 0;

    before(async () => {
        port = await startServer(3888, 5);
    });

    after(async () => {
        await closeServer();
    });

    function request(path: string, options: http.RequestOptions = {}, postData?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path,
                ...options,
            }, (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk.toString(); });
                res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
            });
            req.on('error', reject);
            if (postData) {
                req.write(postData);
            }
            req.end();
        });
    }

    test('GET /api/status 返回当前自动化状态', async () => {
        const res = await request('/api/status', { method: 'GET' });
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
        assert.ok(data.state);
        assert.equal(typeof data.state.status, 'string');
        assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    test('GET /api/config 返回当前配置信息', async () => {
        const res = await request('/api/config', { method: 'GET' });
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
        assert.ok(Array.isArray(data.keywords));
        assert.ok(Array.isArray(data.copyUrls));
    });

    test('GET /api/env 输入纯 ID 时识别为不需要常读免费列表页', async () => {
        const pureIdRes = await request(`/api/env?input=${encodeURIComponent('7676052763846921240\n漫剧ID: 7676052763846921240')}`);
        assert.equal(pureIdRes.status, 200);
        const pureIdData = JSON.parse(pureIdRes.body);
        assert.equal(pureIdData.ok, true);
        assert.equal(pureIdData.env.requiresFreeList, false);
        assert.ok(!pureIdData.env.missingPages.includes('常读 - 免费漫剧列表'));

        const titleRes = await request(`/api/env?input=${encodeURIComponent('九品县令\n7676052763846921240')}`);
        assert.equal(titleRes.status, 200);
        const titleData = JSON.parse(titleRes.body);
        assert.equal(titleData.ok, true);
        assert.equal(titleData.env.requiresFreeList, true);
    });

    test('页面 CSS 包含全局选中文本的高对比度可读性样式 (::selection)', async () => {
        const indexRes = await request('/', { method: 'GET' });
        assert.equal(indexRes.status, 200);
        const cssMatch = indexRes.body.match(/href="\.\/assets\/(index-[^"]+\.css)"/);
        assert.ok(cssMatch, 'index.html 应当包含打包生成的 CSS 资源');
        const cssPath = `/assets/${cssMatch[1]}`;
        const cssRes = await request(cssPath, { method: 'GET' });
        assert.equal(cssRes.status, 200);
        assert.match(cssRes.body, /::selection/);
        assert.match(cssRes.body, /#2563eb/);
        assert.match(cssRes.body, /#3b82f6/);
    });

    test('断点查询和清除接口已删除，停止接口仍可用', async () => {
        assert.equal((await request('/api/checkpoint')).status, 404);
        const headers = { Origin: `http://127.0.0.1:${port}` };
        assert.equal((await request('/api/checkpoint/clear', { method: 'POST', headers })).status, 404);
        const stopped = await request('/api/stop', { method: 'POST', headers });
        assert.equal(stopped.status, 400);
        assert.match(JSON.parse(stopped.body).message, /当前没有正在运行的任务/);
    });

    test('GET /api/export 导出标准 UTF-8 BOM CSV 结果报表', async () => {
        const res = await request('/api/export', { method: 'GET' });
        assert.equal(res.status, 200);
        assert.ok(res.headers['content-type']?.includes('text/csv'));
        assert.ok(res.body.includes('序号,漫剧关键词,匹配漫剧名,漫剧ID,抖音作品ID'));
    });

    test('GET / 返回静态 index.html', async () => {
        const res = await request('/', { method: 'GET' });
        assert.equal(res.status, 200);
        assert.ok(res.headers['content-type']?.includes('text/html'));
        assert.ok(res.body.includes('R3'));
    });

    test('拒绝非本地控制台来源的状态变更请求', async () => {
        const res = await request('/api/stop', {
            method: 'POST',
            headers: { Origin: 'https://attacker.example' },
        });
        assert.equal(res.status, 403);
        assert.equal(JSON.parse(res.body).ok, false);
    });

    test('POST /api/config 支持更新投放与ROI配置', async () => {
        const res = await request('/api/config', {
            method: 'POST',
            headers: {
                Origin: `http://127.0.0.1:${port}`,
                'Content-Type': 'application/json',
            },
        }, JSON.stringify({
            roiRatio: '1.20',
            paidTemplate: '超超小额',
        }));
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
    });

    test('POST /api/env 支持长剧名列表并严格校验输入', async () => {
        const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
        const keywords = Array.from({ length: 200 }, (_, index) => `这是用于验证批量环境检查长度的测试剧名第${index}部`);
        const response = await request('/api/env', { method: 'POST', headers }, JSON.stringify({ keywords }));
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(response.body).env.requiresFreeList, true);
        const invalid = await request('/api/env', { method: 'POST', headers }, JSON.stringify({ keywords: [123] }));
        assert.equal(invalid.status, 400);
    });

    test('配置多字段写入失败不改变先前字段', async () => {
        const store = getAuditStore();
        store.saveConfig({ roiRatio: '0.95', keywords: ['原剧目'] });
        const beforeConfig = store.config();

        const originalSave = store.saveConfig;
        (store as any).saveConfig = () => {
            throw new Error('模拟 SQLite 数据库磁盘写入故障');
        };

        try {
            const response = await request('/api/config', { method: 'POST',
                headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
            }, JSON.stringify({ roiRatio: '1.25', keywords: ['新剧目'] }));
            assert.equal(response.status, 500);
        } finally {
            store.saveConfig = originalSave;
        }

        assert.deepEqual(store.config(), beforeConfig);
    });


    test('超出上限的 JSON 请求返回 413 且不继续累积请求体', async () => {
        const res = await request('/api/config', {
            method: 'POST',
            headers: {
                Origin: `http://127.0.0.1:${port}`,
                'Content-Type': 'application/json',
            },
        }, JSON.stringify({ keywords: ['x'.repeat(5 * 1024 * 1024)] }));
        assert.equal(res.status, 413);
        assert.equal(JSON.parse(res.body).ok, false);
    });

    test('非法配置、畸形 JSON 及启动参数返回 400，且不写入配置或启动任务', async () => {
        const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
        const beforeFile = fs.existsSync(roiRatioPath) ? fs.readFileSync(roiRatioPath, 'utf8') : '';
        const beforeConfig = getAuditStore().config();
        for (const body of ['null', '[]', '{', JSON.stringify({ roiRatio: '-1' }),
            JSON.stringify({ roiRatio: '2', keywords: [123] })]) {
            const response = await request('/api/config', { method: 'POST', headers }, body);
            assert.equal(response.status, 400);
            assert.match(JSON.parse(response.body).message, /校验|JSON/);
            if (fs.existsSync(roiRatioPath)) {
                assert.equal(fs.readFileSync(roiRatioPath, 'utf8'), beforeFile);
            }
            assert.deepEqual(getAuditStore().config(), beforeConfig);
        }
        for (const body of [{ keywords: 'A' }, { resumeFromCheckpoint: true }, { copyPageUrls: ['https://evil.test'] }]) {
            assert.equal((await request('/api/start', { method: 'POST', headers }, JSON.stringify(body))).status, 400);
            assert.equal(automationBridge.getState().status, 'idle');
        }
    });

    test('CSV 与状态接口区分待提交、不确定及已提交；成功只在提交确认后计数', async () => {
        let options!: RunAutomationOptions;
        let finish!: () => void;
        const runner = mock.method(automationBridge as any, 'executeRun', async (opts: RunAutomationOptions) => {
            options = opts;
            await new Promise<void>(resolve => { finish = resolve; });
        });
        const headers = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
        try {
            await request('/api/start', { method: 'POST', headers }, JSON.stringify({ keywords: ['A', 'B'],
                copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '1', paidTemplate: '小额' }));
            for (const index of [1, 2]) {
                const info = { index, total: 2, keyword: index === 1 ? 'A' : 'B', name: '剧', seriesId: '1234567890123456789',
                    douyinId: '2234567890123456789', tabIndex: index, subtaskIndex: 1, durationMs: 1 };
                options.onItemStart?.({ ...info, batchCapacity: 1 });
                options.onItemFilled?.(info);
            }
            assert.equal(automationBridge.getState().progress.successCount, 0);
            assert.match((await request('/api/export')).body, /已填写，待提交/);
            options.onPageSubmission?.({ tabIndex: 1, status: 'submitting' });
            options.onPageSubmission?.({ tabIndex: 1, status: 'uncertain', reason: '超时' });
            options.onPageSubmission?.({ tabIndex: 2, status: 'submitting' });
            options.onItemSuccess?.({ index: 2 } as any);
            const status = JSON.parse((await request('/api/status')).body).state;
            assert.deepEqual(status.items.map((item: any) => item.status), ['uncertain', 'success']);
            assert.equal(status.progress.successCount, 1);
            const csv = (await request('/api/export')).body;
            assert.match(csv, /结果不确定，需核对/);
            assert.match(csv, /已提交/);
        } finally {
            finish?.();
            await automationBridge.waitForIdle();
            runner.mock.restore();
        }
    });

    test('多轮冲突删除后，状态和 CSV 保留填写位置及耗时', async () => {
        let options!: RunAutomationOptions;
        let finish!: () => void;
        const runner = mock.method(automationBridge as any, 'executeRun', async (opts: RunAutomationOptions) => {
            options = opts;
            await new Promise<void>(resolve => { finish = resolve; });
        });
        try {
            await automationBridge.start({ keywords: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
                copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '1', paidTemplate: '小额' });
            const infos = Array.from({ length: 7 }, (_, i) => ({ index: i + 1, total: 7,
                keyword: String.fromCharCode(65 + i), name: String.fromCharCode(65 + i),
                seriesId: '1234567890123456789', douyinId: '2234567890123456789',
                tabIndex: 1, subtaskIndex: i + 1, durationMs: 6000 + i }));
            for (const info of infos) {
                options.onItemStart?.({ ...info, batchCapacity: 7 });
                if (info.index < 7) options.onItemFilled?.(info);
                else options.onItemFailure?.({ ...info, reason: '解析失败' });
            }
            for (const batch of [[2, 3], [4, 5], [1]]) {
                options.onPageSubmission?.({ tabIndex: 1, status: 'submitting' });
                options.onPageSubmission?.({ tabIndex: 1, status: 'filled' });
                for (const index of batch) options.onItemFailure?.({ ...infos[index - 1],
                    subtaskIndex: index >= 4 ? index - 2 : index, durationMs: 0, reason: '重复剧' });
            }
            options.onPageSubmission?.({ tabIndex: 1, status: 'submitting' });
            options.onItemSuccess?.({ ...infos[5], subtaskIndex: 1 });
            const state = JSON.parse((await request('/api/status')).body).state;
            assert.deepEqual(state.items.map((item: any) => item.subtaskIndex), [1, 2, 3, 4, 5, 6, 7]);
            assert.deepEqual(state.items.map((item: any) => item.durationMs), infos.map(info => info.durationMs));
            assert.deepEqual(state.items.map((item: any) => item.status),
                ['failed', 'failed', 'failed', 'failed', 'failed', 'success', 'failed']);
            const csv = (await request('/api/export')).body;
            for (const index of [4, 5, 6, 7]) assert.match(csv, new RegExp(`Tab1-任务${index}`));
        } finally {
            finish?.();
            await automationBridge.waitForIdle();
            runner.mock.restore();
        }
    });

    for (const allConflicts of [false, true]) {
        test(`启动前重复预检失败不中断后续处理：全部重复=${allConflicts}`, async () => {
            const runner = mock.method(automationBridge as any, 'executeRun', async (options: RunAutomationOptions) => {
                options.onItemFailure?.({ index: 1, total: 2, keyword: '重复剧', reason: '重复剧预检拦截',
                    tabIndex: 1, subtaskIndex: 1, durationMs: 0 });
                if (allConflicts) {
                    options.onItemFailure?.({ index: 2, total: 2, keyword: '后续剧', reason: '重复剧预检拦截',
                        tabIndex: 1, subtaskIndex: 1, durationMs: 0 });
                } else {
                    const info = { index: 2, total: 2, keyword: '后续剧', name: '后续剧',
                        seriesId: '1234567890123456789', douyinId: '2234567890123456789',
                        tabIndex: 1, subtaskIndex: 1, durationMs: 1000 };
                    options.onItemStart?.({ ...info, batchCapacity: 1 });
                    options.onItemFilled?.(info);
                    options.onPageSubmission?.({ tabIndex: 1, status: 'submitting' });
                    options.onItemSuccess?.(info);
                }
            });
            try {
                await automationBridge.start({ keywords: ['重复剧', '后续剧'],
                    copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '1', paidTemplate: '小额' });
                await automationBridge.waitForIdle();
                const state = JSON.parse((await request('/api/status')).body).state;
                assert.deepEqual(state.items.map((item: any) => item.status), ['failed', allConflicts ? 'failed' : 'success']);
                assert.equal(state.progress.failedCount, allConflicts ? 2 : 1);
                assert.equal(state.progress.successCount, allConflicts ? 0 : 1);
                assert.match(state.items[0].error, /重复剧预检拦截/);
                assert.match((await request('/api/export')).body, /重复剧预检拦截/);
            } finally {
                await automationBridge.waitForIdle();
                runner.mock.restore();
            }
        });
    }

    const executablePath = [process.env.R3_TEST_BROWSER_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));
    test('真实控制台 DOM：SSE 更新待提交及不确定状态，筛选与成功计数一致', {
        skip: executablePath ? false : '未安装测试浏览器',
    }, async () => {
        let options!: RunAutomationOptions;
        let finish!: () => void;
        const runner = mock.method(automationBridge as any, 'executeRun', async (opts: RunAutomationOptions) => {
            options = opts;
            await new Promise<void>(resolve => { finish = resolve; });
        });
        const browser = await chromium.launch({ executablePath, headless: true });
        try {
            await automationBridge.start({ keywords: ['提交确认示例', '提交超时示例', '等待提交示例'],
                copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '1', paidTemplate: '小额' });
            const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/api/env**', route => route.fulfill({ contentType: 'application/json', body: '{"ok":false}' }));
            await page.goto(`http://127.0.0.1:${port}`);
            await page.locator('#row-item-1').waitFor();
            for (const index of [1, 2, 3]) {
                const info = { index, total: 3, keyword: '示例' + index, name: '示例剧目' + index,
                    seriesId: '1234567890123456789', douyinId: '2234567890123456789',
                    tabIndex: index, subtaskIndex: 1, durationMs: 1234 };
                options.onItemStart?.({ ...info, batchCapacity: 1 });
                options.onItemFilled?.(info);
                if (index === 1) {
                    options.onPageSubmission?.({ tabIndex: index, status: 'submitting' });
                    options.onItemSuccess?.(info);
                } else if (index === 2) {
                    options.onPageSubmission?.({ tabIndex: index, status: 'submitting' });
                    options.onPageSubmission?.({ tabIndex: index, status: 'uncertain', reason: '模拟超时，请人工核对' });
                }
            }
            await page.locator('#row-item-2').filter({ hasText: '结果不确定' }).waitFor();
            assert.match(await page.locator('#row-item-3').innerText(), /已填写，待提交/);
            assert.equal(await page.locator('#kpi-success-val').innerText(), '1');
            await page.locator('#select-status-filter').selectOption('uncertain');
            assert.equal(await page.locator('#results-table-body tr').count(), 1);
            assert.equal(await page.locator('#row-item-2').count(), 1);
            await page.locator('#select-status-filter').selectOption('all');
            fs.mkdirSync('docs/screenshots', { recursive: true });
            await page.locator('.table-card').screenshot({ path: 'docs/screenshots/first_batch_task_states.png' });
            assert.deepEqual(errors, []);
        } finally {
            await browser.close();
            finish?.();
            await automationBridge.waitForIdle();
            runner.mock.restore();
        }
    });

    test('GET /api/logs/latest 返回当前日志摘要与错误统计', async () => {
        const res = await request('/api/logs/latest', { method: 'GET' });
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
        assert.ok('runId' in data);
        assert.ok('totalCount' in data);
        assert.ok('errorCount' in data);
        assert.ok(Array.isArray(data.recentLogs));
    });

    test('GET /api/logs/list 返回日志文件列表', async () => {
        const res = await request('/api/logs/list', { method: 'GET' });
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
        assert.ok(Array.isArray(data.files));
    });

    test('GET /api/logs/download 下载执行日志且响应头包含 attachment', async () => {
        const res = await request('/api/logs/download', { method: 'GET' });
        assert.equal(res.status, 200);
        assert.ok(res.headers['content-disposition']?.includes('attachment'));
        assert.ok(res.headers['content-type']?.includes('text/plain'));
    });

    test('GET /api/logs/download-errors 下载错误排查日志', async () => {
        const res = await request('/api/logs/download-errors', { method: 'GET' });
        assert.equal(res.status, 200);
        assert.ok(res.headers['content-disposition']?.includes('R3_Errors.log'));
    });
});

