import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, closeServer } from '../../src/web/server.ts';
import { waitStageSubmitResult } from '../../src/platform/stage_save.ts';

const executablePath = [process.env.R3_TEST_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

test('发布前端：增量重复事件、缺口恢复中到达的事件、结构化阶段及故障提示', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const port = await startServer(0);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            const win = window as any;
            win.EventSource = class {
                handlers: Record<string, Array<(event: any) => void>> = {};
                constructor() { win.protocolEvents = this; }
                addEventListener(type: string, handler: (event: any) => void) { (this.handlers[type] ||= []).push(handler); }
                close() {}
                emit(data: unknown) { for (const handler of this.handlers.console_event || []) handler({ data: JSON.stringify(data) }); }
            };
        });
        await page.route('**/api/config', route => route.fulfill({ json: { ok: true, keywords: ['协议测试剧'], copyUrls: [], roiRatio: '1', paidTemplate: '中额' } }));
        await page.route('**/api/env', route => route.fulfill({ json: { ok: true, env: { cdpConnected: false, tabs: [], topology: { freeList: false, stagePage: false }, requiresFreeList: true } } }));
        const snapshot = { protocolVersion: 1, runId: 'protocol-test', seq: 1, kind: 'snapshot', data: {
            status: 'running', items: [{ index: 1, keyword: '协议测试剧', status: 'running' }], logs: [], currentItem: null,
            progress: { total: 1, current: 0, percentage: 0, successCount: 0, failedCount: 0 }, startedAt: Date.now(), finishedAt: null, lastError: null,
        } };
        let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
        let requests = 0;
        await page.route('**/api/status', async route => { requests++; await hold; await route.fulfill({ json: { ok: true, event: { ...snapshot, seq: 3 } } }); });
        await page.goto(`http://127.0.0.1:${port}`);
        await page.waitForFunction(() => (window as any).protocolEvents);
        await page.evaluate(event => (window as any).protocolEvents.emit(event), snapshot);
        await page.locator('#row-item-1').waitFor();
        const synchronization = page.waitForRequest('**/api/status');
        await page.evaluate(() => (window as any).protocolEvents.emit({ protocolVersion: 1, runId: 'protocol-test', seq: 3, kind: 'phase', data: { phase: 'filling' } }));
        await synchronization;
        const changed = { protocolVersion: 1, runId: 'protocol-test', seq: 4, kind: 'patch', data: { items: [{ index: 1, keyword: '协议测试剧', status: 'failed', error: '协议增量失败原因' }],
            progress: { total: 1, current: 1, percentage: 100, successCount: 0, failedCount: 1 } } };
        await page.evaluate(event => (window as any).protocolEvents.emit(event), changed);
        release();
        await page.waitForFunction(() => document.querySelector('#row-item-1')?.textContent?.includes('失败'));
        await page.evaluate(event => (window as any).protocolEvents.emit({ ...event, data: { items: [{ index: 1, keyword: '重复事件不得覆盖', status: 'success' }] } }), changed);
        assert.match((await page.locator('#row-item-1').textContent())!, /协议测试剧/);
        await page.evaluate(() => (window as any).protocolEvents.emit({ protocolVersion: 1, runId: 'protocol-test', seq: 5, kind: 'phase', data: { phase: 'verifying' } }));
        await page.waitForFunction(() => Array.from(document.querySelectorAll('div')).some(element => element.textContent === '5' && element.className.includes('animate-pulse')));
        await page.evaluate(() => (window as any).protocolEvents.emit({ protocolVersion: 1, runId: 'protocol-test', seq: 6, kind: 'patch', data: {
            status: 'error', health: { status: 'faulted', reason: '后台审计存储异常', faultedAt: Date.now() }, lastError: '后台审计存储异常',
        } }));
        await page.getByRole('alert').filter({ hasText: '后台审计存储异常' }).waitFor();
        assert.equal(await page.locator('#btn-start').isDisabled(), true);
        assert.equal(requests, 1); assert.deepEqual(errors, []);
        await page.screenshot({ path: 'docs/architecture_console_20261001.png', fullPage: true });
    } finally { await browser.close(); await closeServer(); }
});

test('发布前端：配置不被初始化、重连、运行状态覆盖；环境检查使用请求体并清除过期状态', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const port = await startServer(0);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.addInitScript(() => {
            const win = window as any;
            win.auditEvents = [];
            win.EventSource = class {
                handlers: Record<string, Array<(event: any) => void>> = {};
                constructor() { win.auditEvents.push(this); }
                addEventListener(type: string, handler: (event: any) => void) { (this.handlers[type] ||= []).push(handler); }
                close() {}
                emit(type: string, data: unknown) { for (const handler of this.handlers[type] || []) handler({ data: JSON.stringify(data) }); }
            };
        });
        await page.route('**/api/config', route => route.fulfill({ json: {
            ok: true, keywords: ['测试剧'], copyUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '0.95', paidTemplate: '中额',
        } }));
        let envFailure = false;
        const envRequests: Array<{ method: string; keywords: string[]; url: string }> = [];
        await page.route('**/api/env', route => {
            envRequests.push({ method: route.request().method(), keywords: route.request().postDataJSON().keywords, url: route.request().url() });
            return envFailure ? route.fulfill({ status: 500, json: { ok: false } }) : route.fulfill({ json: {
                ok: true, env: { cdpConnected: true, browserName: 'Edge', tabs: [], requiresFreeList: true,
                    topology: { freeList: true, stagePage: true } },
            } });
        });
        await page.goto(`http://127.0.0.1:${port}`);
        await page.waitForFunction(() => (window as any).auditEvents.length > 0);
        await page.waitForFunction(() => (document.querySelector('#input-roi-ratio') as HTMLInputElement)?.value === '0.95');
        for (const event of ['init', 'state_change', 'init']) {
            await page.evaluate(type => (window as any).auditEvents.at(-1).emit(type, {
                status: 'idle', paidTemplate: '超超小额', roiRatio: '9', copyUrls: [],
            }), event);
            assert.equal(await page.locator('#input-roi-ratio').inputValue(), '0.95');
        }
        await page.evaluate(() => (window as any).auditEvents.at(-1).emit('state_change', {
            status: 'running', paidTemplate: '超超小额', roiRatio: '9',
        }));
        await page.locator('#input-roi-ratio').fill('1.15');
        await page.evaluate(() => (window as any).auditEvents.at(-1).emit('state_change', {
            status: 'running', paidTemplate: '超超小额', roiRatio: '9',
        }));
        assert.equal(await page.locator('#input-roi-ratio').inputValue(), '1.15');
        await page.evaluate(() => (window as any).auditEvents.at(-1).emit('state_change', { status: 'completed' }));
        let startBody: any;
        await page.route('**/api/start', route => {
            startBody = route.request().postDataJSON();
            return route.fulfill({ json: { ok: true } });
        });
        const started = page.waitForResponse('**/api/start');
        await page.locator('#btn-start').click();
        await started;
        assert.equal(startBody.roiRatio, '1.15');
        assert.equal(startBody.copyPageUrls.length, 1);
        const keywords = Array.from({ length: 200 }, (_, index) => `环境检查长列表测试剧名${index}`);
        const checked = page.waitForResponse(response => response.url().endsWith('/api/env') && response.request().postDataJSON().keywords.length === 200);
        await page.locator('textarea').fill(keywords.join('\n'));
        await page.waitForFunction(() => document.body.textContent?.includes('通信正常'));
        await checked;
        const last = envRequests.at(-1)!;
        assert.equal(last.method, 'POST');
        assert.equal(last.keywords.length, 200);
        assert.equal(new URL(last.url).search, '');
        envFailure = true;
        await page.getByTitle('刷新检测').click();
        await page.waitForFunction(() => document.body.textContent?.includes('环境检测失败'));
        assert.equal(await page.getByText('通信正常', { exact: false }).count(), 0);
        assert.ok(await page.getByText('未连接 (需启动 9224)', { exact: true }).isVisible());
    } finally { await browser.close(); await closeServer(); }
});

test('真实 DOM：保存失败后关闭弹窗仍拒绝；正常关闭无需二次字段比对', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<div id="dialog">编辑</div><div class="arco-message-error">保存失败</div>');
        await assert.rejects(waitStageSubmitResult(page, page.locator('#dialog'), {
            submit: async () => { await page.locator('#dialog').evaluate(el => { (el as HTMLElement).style.display = 'none'; }); },
            timeoutMs: 500,
        }), /保存失败/);
        await page.setContent('<div id="dialog">编辑</div>');
        await waitStageSubmitResult(page, page.locator('#dialog'), {
            submit: async () => { await page.locator('#dialog').evaluate(el => { (el as HTMLElement).style.display = 'none'; }); },
            timeoutMs: 500,
        });
    } finally { await browser.close(); }
});

test('保存诊断记录可见字段错误和保存前旧提示，不记录字段值', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<div class="arco-message-error">投手参数校验失败：旧冲突</div>
            <div class="arco-message-error" style="display:none">隐藏错误</div>
            <div id="dialog" role="dialog"><div class="arco-form-item">
                <label>项目名称</label><input id="project-name" name="projectName" value="secret-form-value">
                <div class="arco-form-message" hidden>项目名称不能为空</div>
            </div></div>`);
        await assert.rejects(waitStageSubmitResult(page, page.locator('#dialog'), {
            context: { subtaskIndex: 5, douyinId: '7693181399079061544' },
            timeoutMs: 1000,
            submit: async () => {
                await page.locator('.arco-form-message').evaluate(el => { (el as HTMLElement).hidden = false; });
            },
        }), (error: any) => {
            assert.match(error.message, /项目名称: 项目名称不能为空/);
            assert.match(error.message, /未观察到匹配的保存请求/);
            assert.equal(error.diagnostics.subtaskIndex, 5);
            const field = error.diagnostics.pageErrors.find((entry: any) => entry.field === '项目名称');
            assert.equal(field.scope, 'dialog');
            assert.deepEqual(field.controls, [{ id: 'project-name', name: 'projectName' }]);
            assert.equal(field.existedBeforeSubmit, false);
            assert.equal(error.diagnostics.pageErrors.find((entry: any) => entry.scope === 'page').existedBeforeSubmit, true);
            assert.doesNotMatch(JSON.stringify(error.diagnostics), /secret-form-value|隐藏错误/);
            return true;
        });
        // 验证非传统关键字的校验提示（如“词包格式不合规：包含不支持的字符”）同样能被立即捕获并中断
        await page.setContent(`<div id="dialog" role="dialog"><div class="arco-form-item">
            <label>项目名称</label><input id="project-name" name="projectName" value="test">
            <div class="arco-form-message">词包格式不合规：包含不支持的字符</div>
        </div></div>`);
        await assert.rejects(waitStageSubmitResult(page, page.locator('#dialog'), {
            context: { subtaskIndex: 6, douyinId: '7693181399079061545' },
            timeoutMs: 1000,
        }), (error: any) => {
            assert.match(error.message, /词包格式不合规：包含不支持的字符/);
            assert.equal(error.diagnostics.subtaskIndex, 6);
            return true;
        });
    } finally { await browser.close(); }
});

test('整页提交残留的冲突 Toast 不会误杀后续子任务的正常保存', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<div class="arco-message-error">UpsertAutoCreateTask错误UpsertAutoCreateTask失败，投手参数校验失败:以下"剧目+抖音号"已被其它任务创建过项目，请勿重复配置: 剧目 7692326285556582446+抖音号 36180162413（任务 68435345）</div>
            <div id="dialog" role="dialog"><div class="arco-form-item">
                <label>项目名称</label><input id="project-name" name="projectName" value="test">
            </div></div>`);
        await waitStageSubmitResult(page, page.locator('#dialog'), {
            context: { subtaskIndex: 5, douyinId: '7686864489412560906' },
            timeoutMs: 1000,
            submit: async () => {
                await page.locator('#dialog').evaluate(el => { (el as HTMLElement).style.display = 'none'; });
            },
        });
    } finally { await browser.close(); }
});

test('商品接口临时负载高 Toast（ListProduct/服务端负载高）不会误杀子任务保存', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<div class="arco-message-error">ListProduct错误ListProduct失败，服务端负载高, 请稍后重试logid: 20261012151419CF65869E14205025DFAF</div>
            <div id="dialog" role="dialog"><div class="arco-form-item">
                <label>项目名称</label><input id="project-name" name="projectName" value="test">
            </div></div>`);
        await waitStageSubmitResult(page, page.locator('#dialog'), {
            context: { subtaskIndex: 6, douyinId: '7689901359776139264' },
            timeoutMs: 1000,
            submit: async () => {
                await page.locator('#dialog').evaluate(el => { (el as HTMLElement).style.display = 'none'; });
            },
        });
    } finally { await browser.close(); }
});

