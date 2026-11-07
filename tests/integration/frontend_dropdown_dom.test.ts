import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, closeServer } from '../../src/web/server.ts';

const executablePath = [
    process.env.R3_TEST_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

test('发布前端：下拉框设计风格统一（ExecutionTable 与 PlacementConfigPanel 现代自定义风格与原生兼容性）', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const port = await startServer(0);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        const pageErrors: string[] = [];
        page.on('pageerror', error => pageErrors.push(error.message));

        await page.route('**/api/config', route => route.fulfill({
            json: {
                ok: true,
                keywords: ['测试剧目1', '测试剧目2'],
                copyUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=123'],
                roiRatio: '1.2',
                paidTemplate: '超超小额',
            },
        }));

        await page.route('**/api/env', route => route.fulfill({
            json: {
                ok: true,
                env: {
                    cdpConnected: false,
                    tabs: [],
                    topology: { freeList: false, stagePage: false },
                    requiresFreeList: true,
                },
            },
        }));

        await page.goto(`http://127.0.0.1:${port}`);

        // 1. Verify native selects exist for compatibility
        const statusNativeSelect = page.locator('#select-status-filter');
        const templateNativeSelect = page.locator('#select-paid-template');
        await statusNativeSelect.waitFor({ state: 'attached' });
        await templateNativeSelect.waitFor({ state: 'attached' });

        // Both native selects should be hidden from pointer events / tabIndex
        assert.equal(await statusNativeSelect.getAttribute('aria-hidden'), 'true');
        assert.equal(await templateNativeSelect.getAttribute('aria-hidden'), 'true');

        // 2. Test PlacementConfigPanel Paid Template Dropdown
        const templateTrigger = page.locator('#select-paid-template ~ button');
        await templateTrigger.waitFor({ state: 'visible' });
        assert.equal(await templateTrigger.getAttribute('aria-expanded'), 'false');
        assert.ok((await templateTrigger.innerText()).includes('超超小额'));

        // Click trigger to open menu
        await templateTrigger.click();
        assert.equal(await templateTrigger.getAttribute('aria-expanded'), 'true');

        // Verify popover panel is visible with options without clipping
        const popoverOption = page.locator('button[role="option"]').filter({ hasText: /^超小额/ });
        await popoverOption.waitFor({ state: 'visible' });
        const lastOption = page.locator('button[role="option"]').filter({ hasText: /^中额/ });
        await lastOption.waitFor({ state: 'visible' });
        const lastBox = await lastOption.boundingBox();
        assert.ok(lastBox && lastBox.height > 15, '下拉框全部选项应完整呈现，未被父容器 overflow 遮挡截断');

        // Select '超小额' from custom popover
        await popoverOption.click();
        await page.waitForFunction(() => (document.querySelector('#select-paid-template') as HTMLSelectElement)?.value === '超小额');
        assert.equal(await templateNativeSelect.inputValue(), '超小额');
        assert.ok((await templateTrigger.innerText()).includes('超小额'));

        // 3. Test Escape key closes dropdown
        await templateTrigger.click();
        assert.equal(await templateTrigger.getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('button[aria-haspopup="listbox"][aria-expanded="true"]') === null);

        // 4. Test native select compatibility (e.g. automated test selectOption)
        await templateNativeSelect.selectOption('中额');
        await page.waitForFunction(() => (document.querySelector('#select-paid-template') as HTMLSelectElement)?.value === '中额');
        assert.equal(await templateNativeSelect.inputValue(), '中额');
        assert.ok((await templateTrigger.innerText()).includes('中额'));

        // 5. Test ExecutionTable Status Filter Dropdown
        const statusTrigger = page.locator('#select-status-filter ~ button');
        await statusTrigger.waitFor({ state: 'visible' });
        assert.ok((await statusTrigger.innerText()).includes('全部状态'));

        // Open status filter dropdown
        await statusTrigger.click();
        assert.equal(await statusTrigger.getAttribute('aria-expanded'), 'true');

        // Select '失败' option
        const failedOption = page.locator('button[role="option"]').filter({ hasText: '失败' });
        await failedOption.waitFor({ state: 'visible' });
        await failedOption.click();

        await page.waitForFunction(() => (document.querySelector('#select-status-filter') as HTMLSelectElement)?.value === 'failed');
        assert.equal(await statusNativeSelect.inputValue(), 'failed');

        // Automated test selectOption back to 'all'
        await statusNativeSelect.selectOption('all');
        await page.waitForFunction(() => (document.querySelector('#select-status-filter') as HTMLSelectElement)?.value === 'all');

        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
        await closeServer();
    }
});
