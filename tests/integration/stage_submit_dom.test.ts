import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { clickStageSubmit, submitStagePage, trimUnusedStageTasks, removeStageTasks } from '../../src/platform/stage_submit.ts';
import { getStageSubtaskContainers } from '../../src/platform/stage.ts';

const executablePath = [process.env.R3_TEST_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

test('真实 DOM：Arco 嵌套 span 提交按钮只点击一次，排除隐藏按钮与相似文案', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
            <button style="display:none"><span>确认提交</span></button>
            <button>确认提交并继续</button>
            <button id="submit" class="arco-btn arco-btn-primary" type="button"><span>确认提交</span></button>
            <output id="count">0</output>
            <script>document.querySelector('#submit').onclick = () => {
                const counter = document.querySelector('#count');
                counter.textContent = String(Number(counter.textContent) + 1);
            };</script>`);
        assert.equal(await page.locator('button:text-is("确认提交")').count(), 0);
        await clickStageSubmit(page);
        assert.equal(await page.locator('#count').textContent(), '1');
        await page.locator('body').evaluate(el => {
            const button = document.createElement('button');
            button.innerHTML = '<span>确认提交</span>';
            el.append(button);
        });
        await assert.rejects(submitStagePage(page), (err: any) => err.code === 'STAGE_SUBMIT_NOT_STARTED');
        assert.equal(await page.locator('#count').textContent(), '1');
    } finally {
        await browser.close();
    }
});

test('真实 DOM：末页删除须确认，清理遗留弹层并逐项更新数量；取消后不再删除', {
    skip: executablePath ? false : '未安装测试浏览器',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
            <div id="sub-micro-container"><div class="content-test"><div><form><div><div><div>
                <div>heading</div><div><div class="box-card-content-test"><div id="rows">
                    ${[1, 2, 3, 4].map(i => `<div class="task" data-id="${i}">剧${i}<button type="button"><i class="arco-icon-edit"></i></button><button type="button" class="delete"><i class="arco-icon-delete"></i></button></div>`).join('')}
                    <div>添加配置</div>
                </div></div></div>
            </div></div></div></form></div></div></div>
            <button id="unrelated">确定</button>
            <div class="arco-popconfirm-wrapper" hidden>确认删除当前配置吗?<button id="cancel">取消</button><button id="confirm">确定</button></div>
            <script>
                const popup = document.querySelector('.arco-popconfirm-wrapper');
                let pending = document.querySelector('.task');
                popup.hidden = false;
                document.querySelector('#rows').onclick = event => {
                    if (!event.target.closest('.delete')) return;
                    pending = event.target.closest('.task'); popup.hidden = false;
                };
                document.querySelector('#cancel').onclick = () => { pending = null; popup.hidden = true; };
                document.querySelector('#confirm').onclick = () => { pending.remove(); pending = null; popup.hidden = true; };
                document.querySelector('#unrelated').onclick = () => { document.body.dataset.wrongClick = 'true'; };
            </script>`);
        assert.equal(await getStageSubtaskContainers(page).count(), 4);
        const counts: number[] = [];
        const controller = new AbortController();
        await assert.rejects(trimUnusedStageTasks(page, 2, 4, controller.signal, async count => {
            counts.push(count);
            controller.abort();
        }), /abort/i);
        assert.deepEqual(counts, [3]);
        assert.deepEqual(await page.locator('.task').allTextContents(), ['剧1', '剧2', '剧3']);
        await removeStageTasks(page, [2], 3);
        assert.deepEqual(await page.locator('.task').allTextContents(), ['剧1', '剧3']);
        assert.equal(await page.locator('body').getAttribute('data-wrong-click'), null);
    } finally { await browser.close(); }
});
