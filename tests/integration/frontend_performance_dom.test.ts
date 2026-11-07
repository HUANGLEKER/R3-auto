import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, closeServer } from '../../src/web/server.ts';

const executablePath = [process.env.R3_TEST_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

test('发布前端：10000 条结果仅渲染视口，滚动、筛选和详情正确；日志批次不重复或回填', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const port = await startServer(0);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.addInitScript(() => {
            const win = window as any;
            win.EventSource = class {
                handlers: Record<string, Array<(event: any) => void>> = {};
                constructor() { win.performanceEvents = this; }
                addEventListener(type: string, handler: (event: any) => void) { (this.handlers[type] ||= []).push(handler); }
                close() {}
                emit(type: string, data: unknown) { for (const handler of this.handlers[type] || []) handler({ data: JSON.stringify(data) }); }
            };
        });
        await page.route('**/api/config', route => route.fulfill({ json: { ok: true, keywords: [], copyUrls: [], roiRatio: '1', paidTemplate: '中额' } }));
        await page.route('**/api/env', route => route.fulfill({ json: { ok: true, env: {
            cdpConnected: false, tabs: [], topology: { freeList: false, stagePage: false }, requiresFreeList: true,
        } } }));
        await page.goto(`http://127.0.0.1:${port}`);
        await page.waitForFunction(() => (window as any).performanceEvents);
        await page.evaluate(() => {
            const items = Array.from({ length: 10000 }, (_, index) => ({ index: index + 1,
                keyword: `剧目${String(index + 1).padStart(5, '0')}`, status: index % 100 === 0 ? 'failed' : 'success',
                douyinId: `2234567890123${String(index).padStart(6, '0')}` }));
            (window as any).performanceEvents.emit('init', { status: 'running', items, logs: [],
                progress: { total: 10000, current: 10000, percentage: 100, successCount: 9900, failedCount: 100 } });
        });
        await page.locator('#row-item-1').waitFor();
        const rows = page.locator('#results-table-body tr[id^="row-item-"]');
        assert.ok(await rows.count() <= 30, 'DOM 行数必须与视口相关而非结果总量');
        await page.locator('#results-table-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.locator('#row-item-10000').waitFor();
        assert.ok(await rows.count() <= 30);
        const heights = await rows.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
        assert.ok(heights.every(height => Math.abs(height - 44) < 1), `实际行高应匹配虚拟计算：${heights}`);
        await page.locator('#input-table-search').fill('剧目10000');
        await page.waitForFunction(() => document.querySelectorAll('#results-table-body tr[id^="row-item-"]').length === 1);
        assert.equal(await rows.first().getAttribute('id'), 'row-item-10000');
        assert.equal(await page.locator('#results-table-scroll').evaluate(element => element.scrollTop), 0);
        await page.locator('#row-item-10000').getByTitle('查看详情').click();
        await page.getByRole('heading', { name: '漫剧详情: 剧目10000', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.locator('#input-table-search').fill('');
        await page.locator('#select-status-filter').selectOption('failed');
        await page.locator('#row-item-1').waitFor();
        assert.ok(await rows.count() <= 30);
        await page.locator('#results-table-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.locator('#row-item-9901').waitFor();
        assert.ok((await rows.allTextContents()).every(text => text.includes('失败')));
        await page.locator('#select-status-filter').selectOption('all');
        await page.locator('#row-item-1').waitFor();
        await page.evaluate(() => {
            const win = window as any;
            win.logMutations = 0;
            const observer = new MutationObserver(records => {
                if (records.some(record => Array.from(record.addedNodes).some(node => node.textContent?.includes('突发日志')))) win.logMutations++;
            });
            observer.observe(document.body, { childList: true, subtree: true });
            for (let index = 0; index < 200; index++) win.performanceEvents.emit('log', { time: '12:00:00', tag: 'INFO', text: `突发日志${index}` });
        });
        await page.getByText('突发日志199', { exact: true }).waitFor();
        assert.equal(await page.getByText(/^突发日志\d+$/).count(), 200);
        assert.equal(await page.evaluate(() => (window as any).logMutations), 1, '一次突发仅批量更新一次日志 DOM');
        await page.evaluate(() => {
            const events = (window as any).performanceEvents;
            events.emit('log', { time: '12:00:01', tag: 'INFO', text: '快照中的日志' });
            events.emit('state_change', { status: 'running', logs: [{ time: '12:00:01', tag: 'INFO', text: '快照中的日志' }] });
        });
        await page.waitForTimeout(150);
        assert.equal(await page.getByText('快照中的日志', { exact: true }).count(), 1);
        await page.evaluate(() => {
            const events = (window as any).performanceEvents;
            events.emit('log', { time: '12:00:02', tag: 'INFO', text: '清空前缓冲日志' });
            events.emit('logs_cleared', {});
        });
        await page.waitForTimeout(150);
        assert.equal(await page.getByText('清空前缓冲日志', { exact: true }).count(), 0);
        assert.equal(await page.getByText('快照中的日志', { exact: true }).count(), 0);
        await page.evaluate(() => {
            const events = (window as any).performanceEvents;
            for (let index = 0; index < 1000; index++) events.emit('log', { time: '12:00:03', tag: 'INFO', text: `上限日志${index}` });
        });
        await page.getByText('上限日志999', { exact: true }).waitFor();
        assert.equal(await page.getByText(/^上限日志\d+$/).count(), 800);
        assert.equal(await page.getByText('上限日志199', { exact: true }).count(), 0);
        assert.equal(await page.getByText('上限日志200', { exact: true }).count(), 1);
        assert.deepEqual(pageErrors, []);
    } finally { await browser.close(); await closeServer(); }
});
