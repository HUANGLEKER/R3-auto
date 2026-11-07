import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-audit-'));
process.env.R3_DATA_DIR = temp;
const { run } = await import('../src/runner.ts');
const { AutomationBridge } = await import('../src/web/automation_bridge.ts');
const { server, startServer, closeServer } = await import('../src/web/server.ts');
const { paidPanelPath, roiRatioPath } = await import('../src/core/paths.ts');
const { waitStageSubmitResult } = await import('../src/platform/stage.ts');
const result = {};
let browser;
try {
    const fills = [], submissions = [];
    const deps = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }),
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }),
        prepareStageCopyPage: async () => 1, preflightStageSubtasks: async () => 1,
        triggerBrowserGC: async () => {}, closeStageDialogIfOpen: async () => {},
        createPipeline: () => ({
            get: async keyword => ({ ok: true, name: keyword, seriesId: '1234567890123456789',
                douyinId: keyword === 'A' ? '2234567890123456789' : '3234567890123456789' }),
            prefetch: () => {}, abort: () => {}, drain: async () => {},
        }),
        fillStageTaskWithReopenRetry: async (_page, slot, _capacity, info) => {
            fills.push({ name: info.name, slot });
            if (info.name === 'A') throw Object.assign(new Error('保存结果不确定'), { code: 'STAGE_DRAMA_FILL_FAILED' });
        },
        trimUnusedStageTasks: async () => {}, removeStageTasks: async () => {},
        submitStagePage: async () => { submissions.push('submitted'); return { kind: 'success' }; },
    };
    const bridge = new AutomationBridge(options => run(options, deps));
    bridge.start({ keywords: ['A', 'B'], copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
        roiRatio: '0.95', paidTemplate: '超超小额' });
    await bridge.waitForIdle();
    result.uncertainFill = { fills, submissions, status: bridge.getState().status, lastError: bridge.getState().lastError };
    assert.deepEqual(fills, [{ name: 'A', slot: 1 }]);
    assert.equal(submissions.length, 0);
    assert.equal(bridge.getState().status, 'error');
    assert.equal(bridge.getState().items[0].status, 'uncertain');

    const port = await startServer(0);
    const base = `http://127.0.0.1:${port}`;
    const longInput = Array.from({ length: 200 }, (_, i) => `这是用于验证批量环境检查长度的测试剧名第${i}部`).join('\n');
    const response = await fetch(`${base}/api/env`, { method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: longInput.split('\n') }) });
    result.longEnv = { keywords: 200, status: response.status };
    assert.equal(response.status, 200);

    fs.writeFileSync(roiRatioPath, '0.95');
    fs.mkdirSync(paidPanelPath);
    const partial = await fetch(`${base}/api/config`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roiRatio: '1.25', paidTemplate: '中额' }) });
    result.partialConfig = { status: partial.status, roiAfter: fs.readFileSync(roiRatioPath, 'utf8') };
    assert.equal(partial.status, 500);
    assert.equal(result.partialConfig.roiAfter, '0.95');
    fs.rmdirSync(paidPanelPath);

    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
        window.auditEvents = [];
        window.EventSource = class {
            handlers = {}; constructor() { window.auditEvents.push(this); }
            addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
            close() {}
            emit(type, data) { for (const fn of this.handlers[type] || []) fn({ data: JSON.stringify(data) }); }
        };
    });
    await page.route('**/api/config', route => route.fulfill({ json: { ok: true, keywords: ['测试剧'], copyUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'], roiRatio: '0.95', paidTemplate: '中额' } }));
    await page.route('**/api/env', route => route.fulfill({ json: { ok: false } }));
    await page.goto(base);
    const selected = () => page.getByRole('button').filter({ hasText: /^中额/ }).getAttribute('class', { timeout: 3000 });
    await page.waitForFunction(() => window.auditEvents.length > 0 && document.querySelectorAll('button').length > 10);
    await page.waitForTimeout(300);
    const before = await selected();
    await page.evaluate(() => window.auditEvents.at(-1).emit('init', { status: 'idle', paidTemplate: '超超小额' }));
    await page.waitForTimeout(100);
    const after = await selected();
    result.templateRace = { loadedTemplateSelected: before.includes('border-cyan-500'),
        loadedTemplateSelectedAfterInit: after.includes('border-cyan-500'), changed: before !== after };
    let startBody;
    await page.route('**/api/start', route => {
        startBody = route.request().postDataJSON();
        return route.fulfill({ json: { ok: true } });
    });
    await page.locator('#btn-start').click();
    await page.waitForTimeout(100);
    result.templateRace.startTemplate = startBody.paidTemplate;
    assert.equal(result.templateRace.changed, false);
    assert.equal(startBody.paidTemplate, '中额');
    await page.setContent('<div id="dialog">编辑表单</div><div class="arco-message-error">保存失败</div>');
    const waiting = assert.rejects(waitStageSubmitResult(page, page.locator('#dialog')), /保存失败/);
    const request = { resourceType: () => 'xhr', method: () => 'POST' };
    page.emit('response', { request: () => request, url: () => 'https://usergrowth.com.cn/advertising/api/v1/save', status: () => 400,
        json: async () => ({ code: 400, msg: '保存失败' }) });
    await page.locator('#dialog').evaluate(el => { el.style.display = 'none'; });
    await waiting;
    result.failedSaveAccepted = false;
    fs.writeFileSync(path.join(os.tmpdir(), 'r3-audit-result.json'), JSON.stringify(result, null, 2));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await browser?.close();
    if (server.listening) await closeServer();
    fs.rmSync(temp, { recursive: true, force: true });
}
