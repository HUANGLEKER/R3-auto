import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { fillStageProjectName } from '../../src/platform/stage_project_name.ts';
import { clearStageDramaSearch, resetStageDramaSearchFocus, typeStageDramaId } from '../../src/platform/stage.ts';

const executablePath = [
    process.env.R3_TEST_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

test('真实 DOM：弹窗内项目名称定位、连续换剧及其他字段隔离', {
    skip: executablePath ? false : '未安装测试浏览器，可设置 R3_TEST_BROWSER_PATH',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
            <div class="arco-form-item"><label>项目名称 *</label><textarea>外部名称</textarea></div>
            <div class="arco-drawer">
                <div class="arco-form-item"><label>内容名称</label><input value="内容"></div>
                <div class="arco-form-item"><label>项目名称后缀</label><textarea>后缀</textarea></div>
                <div class="arco-form-item"><label>项目名称<span>*</span></label><textarea id="project">{剧集简称}{日期}{{次新}}</textarea></div>
            </div>`);
        const dialog = page.locator('.arco-modal, .arco-drawer, [class*="modal"], [class*="drawer"]')
            .filter({ hasText: '内容名称' }).first();
        await fillStageProjectName(dialog, '第一部');
        assert.equal(await page.locator('#project').inputValue(), '{{第一部}}{日期}{{次新}}');
        await fillStageProjectName(dialog, '第,二:部!！，续篇：归来');
        assert.equal(await page.locator('#project').inputValue(), '{{第二部，续篇：归来}}{日期}{{次新}}');
        await fillStageProjectName(dialog, '“第三部”；结局？');
        assert.equal(await page.locator('#project').inputValue(), '{{第三部结局}}{日期}{{次新}}');
        const longDramaName = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十超长剧名测试';
        await fillStageProjectName(dialog, longDramaName);
        assert.equal((await page.locator('#project').inputValue()).length, 50);
        assert.equal(await page.locator('#project').inputValue(), `{{${longDramaName.slice(0, 36)}}}{日期}{{次新}}`);
        assert.deepEqual(await page.locator('textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value)),
            ['外部名称', '后缀', `{{${longDramaName.slice(0, 36)}}}{日期}{{次新}}`]);
    } finally {
        await browser.close();
    }
});

test('真实 DOM：失败搜索清空后点击右侧空白区域，等待下拉关闭再搜索', {
    skip: executablePath ? false : '未安装测试浏览器，可设置 R3_TEST_BROWSER_PATH',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        const id = '7683000000000000001';
        for (const kind of ['drawer', 'modal']) {
            await page.setContent(`
                <div class="arco-${kind}" style="width:900px;height:300px">
                    <div class="arco-${kind}-title">子任务批量配置</div>
                    <div style="display:flex">
                        <div id="select" style="width:400px;height:80px"><input placeholder="内容ID"></div>
                        <div id="blank" style="flex:1;height:80px"></div>
                    </div>
                    <div class="arco-select-popup" style="width:400px;height:30px">暂无数据</div>
                    <div id="result">暂无数据</div><button id="cancel">取消</button>
                </div>
                <script>
                    (() => {
                    const input = document.querySelector('input');
                    const popup = document.querySelector('.arco-select-popup');
                    let ready = false;
                    document.querySelector('.arco-${kind}-title').onclick = () => {
                        document.body.dataset.titleClicked = 'true';
                    };
                    document.querySelector('#blank').onclick = () => {
                        ready = input.value === '' && document.activeElement !== input;
                        document.body.dataset.blankClicked = 'true';
                        setTimeout(() => { popup.style.display = 'none'; }, 120);
                    };
                    document.querySelector('#select').onclick = event => {
                        if (event.target === input && ready) popup.style.display = 'block';
                    };
                    input.oninput = () => {
                        document.querySelector('#result').textContent = ready && input.value ? input.value : '暂无数据';
                    };
                    document.querySelector('#cancel').onclick = () => { document.body.dataset.cancelled = 'true'; };
                    })();
                </script>`);
            const select = page.locator('#select');
            let input = await clearStageDramaSearch(page, select);
            await typeStageDramaId(input, id);
            assert.equal(await page.locator('#result').textContent(), '暂无数据');
            input = await clearStageDramaSearch(page, select);
            await typeStageDramaId(input, id);
            assert.equal(await page.locator('#result').textContent(), '暂无数据');
            input = await clearStageDramaSearch(page, select);
            input = await resetStageDramaSearchFocus(page, select, input);
            assert.equal(await input.inputValue(), '');
            assert.equal(await page.locator('body').getAttribute('data-blank-clicked'), 'true');
            assert.equal(await page.locator('body').getAttribute('data-title-clicked'), null);
            await typeStageDramaId(input, id);
            assert.equal(await page.locator('#result').textContent(), id);
            assert.equal(await page.locator('body').getAttribute('data-cancelled'), null);
        }
    } finally { await browser.close(); }
});
