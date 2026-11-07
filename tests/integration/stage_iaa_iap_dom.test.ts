import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { fillStageIaaAndIapConfig, fillStageIaaConfig, fillStageIapConfig } from '../../src/platform/stage_iaa_iap.ts';

const executablePath = [
    process.env.R3_TEST_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

test('真实 DOM：搭剧 IAA 配置与 IAP 配置自动选择与表单填写', {
    skip: executablePath ? false : '未安装测试浏览器，可设置 R3_TEST_BROWSER_PATH',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    .arco-drawer { width: 800px; height: 1000px; padding: 20px; }
                    .section-header { font-size: 18px; font-weight: bold; margin: 15px 0 10px 0; border-bottom: 1px solid #eee; padding-bottom: 5px; }
                    .arco-form-item { margin-bottom: 12px; }
                    .arco-form-item-label { display: block; margin-bottom: 4px; }
                    .arco-select-view { border: 1px solid #ccc; padding: 6px 10px; cursor: pointer; min-height: 24px; }
                    .arco-select-popup { position: absolute; background: #fff; border: 1px solid #ddd; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
                    .arco-select-option { padding: 6px 12px; cursor: pointer; }
                    .arco-select-option:hover { background: #f2f3f5; }
                </style>
            </head>
            <body>
                <div class="arco-drawer">
                    <div class="arco-drawer-title">子任务编辑</div>
                    <form class="arco-form">
                        <div class="arco-form-item"><label class="arco-form-item-label">项目名称 *</label><textarea id="project-name">测试项目</textarea></div>
                        
                        <div class="section-header">IAA 配置</div>
                        <div class="arco-form-item" id="iaa-app">
                            <label class="arco-form-item-label">小程序 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iaa-app">请选择小程序</div>
                        </div>
                        <div class="arco-form-item" id="iaa-channel">
                            <label class="arco-form-item-label">渠道账号 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iaa-channel">请选择渠道账号</div>
                        </div>
                        <div class="arco-form-item" id="iaa-name">
                            <label class="arco-form-item-label">推广链名称 *</label>
                            <textarea id="iaa-link-name-input"></textarea>
                        </div>
                        <div class="arco-form-item" id="iaa-episodes">
                            <label class="arco-form-item-label">起始解锁集数 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iaa-episodes">请选择起始解锁集数</div>
                        </div>

                        <div class="section-header">IAP 配置</div>
                        <div class="arco-form-item" id="iap-app">
                            <label class="arco-form-item-label">小程序 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iap-app">请选择小程序</div>
                        </div>
                        <div class="arco-form-item" id="iap-channel">
                            <label class="arco-form-item-label">渠道账号 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iap-channel">请选择渠道账号</div>
                        </div>
                        <div class="arco-form-item" id="iap-name">
                            <label class="arco-form-item-label">推广链名称 *</label>
                            <textarea id="iap-link-name-input"></textarea>
                        </div>
                        <div class="arco-form-item" id="iap-template">
                            <label class="arco-form-item-label">充值模板 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iap-template">请选择充值模板</div>
                        </div>
                    </form>
                </div>

                <div id="popup-container"></div>

                <script>
                    const optionsMap = {
                        'iaa-app': ['应用A (70010001)', '默认应用 (70022245)', '测试应用 (70030002)'],
                        'iaa-channel': ['运营账号 (1869479656743000)', '主管账号 (1869479656743028)'],
                        'iaa-episodes': ['第1集', '第2集', '第3集', '第4集'],
                        'iap-app': ['应用B (70010002)', '默认应用 (70022244)'],
                        'iap-channel': ['运营账号 (1869479656743000)', '主管账号 (1869479656743012)'],
                        'iap-template': ['中额', '小额', '超小额', '超超小额（60集以上）']
                    };

                    document.querySelectorAll('.arco-select-view').forEach(view => {
                        view.onclick = (e) => {
                            e.stopPropagation();
                            const container = document.getElementById('popup-container');
                            container.innerHTML = '';
                            const field = view.dataset.field;
                            const options = optionsMap[field] || [];
                            
                            const popup = document.createElement('div');
                            popup.className = 'arco-select-popup';
                            popup.style.display = 'block';
                            popup.style.left = view.getBoundingClientRect().left + 'px';
                            popup.style.top = (view.getBoundingClientRect().bottom + 2) + 'px';
                            popup.style.width = view.getBoundingClientRect().width + 'px';

                            options.forEach(optText => {
                                const opt = document.createElement('div');
                                opt.className = 'arco-select-option';
                                opt.setAttribute('role', 'option');
                                opt.textContent = optText;
                                opt.onclick = (evt) => {
                                    evt.stopPropagation();
                                    view.textContent = optText;
                                    popup.remove();
                                };
                                popup.appendChild(opt);
                            });

                            container.appendChild(popup);
                        };
                    });

                    document.body.onclick = () => {
                        document.getElementById('popup-container').innerHTML = '';
                    };
                </script>
            </body>
            </html>
        `);

        const dialog = page.locator('.arco-drawer').first();

        // 执行双配置自动填写
        await fillStageIaaAndIapConfig(page, dialog, { paidTemplate: '超超小额' });

        // 验证 IAA 各字段
        const iaaAppText = (await page.locator('#iaa-app .arco-select-view').innerText()).trim();
        assert.ok(iaaAppText.includes('默认应用 (70022245)'), `IAA 小程序期望包含默认应用，实际: ${iaaAppText}`);

        const iaaChannelText = (await page.locator('#iaa-channel .arco-select-view').innerText()).trim();
        assert.ok(iaaChannelText.includes('主管账号 (1869479656743028)'), `IAA 渠道账号期望包含主管账号，实际: ${iaaChannelText}`);

        const iaaNameVal = await page.locator('#iaa-link-name-input').inputValue();
        assert.equal(iaaNameVal, '{剧集简称}{随机数}', `IAA 推广链名称期望为 {剧集简称}{随机数}，实际: ${iaaNameVal}`);

        const iaaEpisodeText = (await page.locator('#iaa-episodes .arco-select-view').innerText()).trim();
        assert.equal(iaaEpisodeText, '第2集', `IAA 起始解锁集数期望为第2个选项（第2集），实际: ${iaaEpisodeText}`);

        // 验证 IAP 各字段
        const iapAppText = (await page.locator('#iap-app .arco-select-view').innerText()).trim();
        assert.ok(iapAppText.includes('默认应用 (70022244)'), `IAP 小程序期望包含默认应用，实际: ${iapAppText}`);

        const iapChannelText = (await page.locator('#iap-channel .arco-select-view').innerText()).trim();
        assert.ok(iapChannelText.includes('主管账号 (1869479656743012)'), `IAP 渠道账号期望包含主管账号，实际: ${iapChannelText}`);

        const iapNameVal = await page.locator('#iap-link-name-input').inputValue();
        assert.equal(iapNameVal, '{剧集简称}{随机数}', `IAP 推广链名称期望为 {剧集简称}{随机数}，实际: ${iapNameVal}`);

        const iapTemplateText = (await page.locator('#iap-template .arco-select-view').innerText()).trim();
        assert.ok(iapTemplateText.includes('超超小额'), `IAP 充值模板期望包含超超小额，实际: ${iapTemplateText}`);

        // 幂等性测试：值已经就绪时再次执行不应抛错且保持值不变
        await fillStageIaaAndIapConfig(page, dialog, { paidTemplate: '超超小额' });
        assert.equal(await page.locator('#iaa-link-name-input').inputValue(), '{剧集简称}{随机数}');
        assert.equal(await page.locator('#iap-link-name-input').inputValue(), '{剧集简称}{随机数}');
    } finally {
        await browser.close();
    }
});

test('真实 DOM：搭剧平台出现“配置加载失败 重试”时自动点击重试按钮并成功恢复配置选择', {
    skip: executablePath ? false : '未安装测试浏览器，可设置 R3_TEST_BROWSER_PATH',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    .arco-drawer { width: 800px; height: 1000px; padding: 20px; }
                    .section-header { font-size: 18px; font-weight: bold; margin: 15px 0 10px 0; border-bottom: 1px solid #eee; padding-bottom: 5px; }
                    .arco-form-item { margin-bottom: 12px; }
                    .arco-form-item-label { display: block; margin-bottom: 4px; }
                    .arco-select-view { border: 1px solid #ccc; padding: 6px 10px; cursor: pointer; min-height: 24px; }
                    .arco-select-popup { position: absolute; background: #fff; border: 1px solid #ddd; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
                    .arco-select-option { padding: 6px 12px; cursor: pointer; }
                    .arco-select-option:hover { background: #f2f3f5; }
                    .error-wrapper { margin-top: 4px; color: #666; font-size: 12px; }
                    .retry-btn { color: #165dff; cursor: pointer; margin-left: 6px; }
                </style>
            </head>
            <body>
                <div class="arco-drawer">
                    <div class="arco-drawer-title">子任务编辑</div>
                    <form class="arco-form">
                        <div class="section-header">IAP 配置</div>
                        <div class="arco-form-item" id="iap-app">
                            <label class="arco-form-item-label">小程序 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iap-app">请选择小程序</div>
                            <div class="error-wrapper" id="iap-app-error">配置加载失败 <span class="retry-btn" id="iap-app-retry">重试</span></div>
                        </div>
                        <div class="arco-form-item" id="iap-channel">
                            <label class="arco-form-item-label">渠道账号 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iap-channel">请选择渠道账号</div>
                        </div>
                        <div class="arco-form-item" id="iap-name">
                            <label class="arco-form-item-label">推广链名称 *</label>
                            <textarea id="iap-link-name-input"></textarea>
                        </div>
                        <div class="arco-form-item" id="iap-template">
                            <label class="arco-form-item-label">充值模板 *</label>
                            <div class="arco-select-view" data-type="select" data-field="iap-template">请选择充值模板</div>
                        </div>
                    </form>
                </div>

                <div id="popup-container"></div>

                <script>
                    window.optionsLoaded = false;
                    window.retryClickedCount = 0;

                    const retryBtn = document.getElementById('iap-app-retry');
                    retryBtn.onclick = () => {
                        window.retryClickedCount++;
                        // 模拟异步请求加载成功
                        setTimeout(() => {
                            window.optionsLoaded = true;
                            const err = document.getElementById('iap-app-error');
                            if (err) err.remove();
                        }, 100);
                    };

                    const optionsMap = {
                        'iap-channel': ['运营账号 (1869479656743000)', '主管账号 (1869479656743012)'],
                        'iap-template': ['超超小额（60集以上）']
                    };

                    document.querySelectorAll('.arco-select-view').forEach(view => {
                        view.onclick = (e) => {
                            e.stopPropagation();
                            const container = document.getElementById('popup-container');
                            container.innerHTML = '';
                            const field = view.dataset.field;
                            let options = optionsMap[field] || [];
                            if (field === 'iap-app') {
                                options = window.optionsLoaded ? ['默认应用 (70022244)'] : [];
                            }
                            
                            const popup = document.createElement('div');
                            popup.className = 'arco-select-popup';
                            popup.style.display = 'block';
                            popup.style.left = view.getBoundingClientRect().left + 'px';
                            popup.style.top = (view.getBoundingClientRect().bottom + 2) + 'px';
                            popup.style.width = view.getBoundingClientRect().width + 'px';

                            options.forEach(optText => {
                                const opt = document.createElement('div');
                                opt.className = 'arco-select-option';
                                opt.setAttribute('role', 'option');
                                opt.textContent = optText;
                                opt.onclick = (evt) => {
                                    evt.stopPropagation();
                                    view.textContent = optText;
                                    popup.remove();
                                };
                                popup.appendChild(opt);
                            });

                            container.appendChild(popup);
                        };
                    });

                    document.body.onclick = () => {
                        document.getElementById('popup-container').innerHTML = '';
                    };
                </script>
            </body>
            </html>
        `);

        const dialog = page.locator('.arco-drawer').first();

        // 执行 IAP 配置填写（初始处于“配置加载失败 重试”状态）
        await fillStageIapConfig(page, dialog, '超超小额');

        // 验证重试按钮被成功点击并恢复
        const retryCount = await page.evaluate(() => (window as any).retryClickedCount || 0);
        assert.ok(retryCount >= 1, `重试按钮应至少被点击1次，实际: ${retryCount}`);

        const errorExists = await page.locator('#iap-app-error').count();
        assert.equal(errorExists, 0, '错误提示节点应当已在重试后被移除');

        const iapAppText = (await page.locator('#iap-app .arco-select-view').innerText()).trim();
        assert.ok(iapAppText.includes('默认应用 (70022244)'), `IAP 小程序期望在重试后成功选择默认应用，实际: ${iapAppText}`);
    } finally {
        await browser.close();
    }
});
