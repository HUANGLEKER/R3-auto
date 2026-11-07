import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
    buildStageTaskName,
    fillStageBasicTaskName,
    fillStageUnifiedDailyBudget,
} from '../../src/platform/stage_page_config.ts';
import { lockPageActive, createBackgroundPage } from '../../src/platform/cdp.ts';
import {
    dailyBudgetSchema,
    sanitizeDailyBudgetInput,
    normalizeDailyBudget,
} from '../../src/core/validation.ts';
import { run } from '../../src/runner.ts';
import { clearConflictDramaGuard } from '../../src/core/conflict_guard.ts';
import { startServer, closeServer } from '../../src/web/server.ts';

if (!process.env.R3_DATA_DIR) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-stage-cfg-'));
    process.env.R3_DATA_DIR = tmpDir;
    process.on('exit', () => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    });
}

const executablePath = [
    process.env.R3_TEST_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

test('buildStageTaskName 按前端指定内容自动拼接 -自增序号（从 1 开始）', () => {
    assert.equal(buildStageTaskName('R3-漫剧-次新', 1), 'R3-漫剧-次新-1');
    assert.equal(buildStageTaskName('R3-漫剧-次新', 2), 'R3-漫剧-次新-2');
    assert.equal(buildStageTaskName('  R3-漫剧-次新-  ', 3), 'R3-漫剧-次新-3');
    assert.equal(buildStageTaskName('', 1), '');
    assert.equal(buildStageTaskName('   ', 1), '');
});

test('项目日预算合法校验：仅允许 0~9 和 .，低于 300 自动变为 300，高于 9999999.99 自动变为 9999999.99', () => {
    // 1. 过滤非 0-9 和 . 的字符
    assert.equal(sanitizeDailyBudgetInput('abc-+$¥!@#500.25xyz'), '500.25');
    assert.equal(sanitizeDailyBudgetInput('300..56.78'), '300.56');
    assert.equal(sanitizeDailyBudgetInput('abc!@#'), '');

    // 2. 高于 9999999.99 自动变为 9999999.99
    assert.equal(sanitizeDailyBudgetInput('10000000'), '9999999.99');
    assert.equal(sanitizeDailyBudgetInput('99999999.99'), '9999999.99');
    assert.equal(normalizeDailyBudget('10000000'), '9999999.99');
    assert.equal(normalizeDailyBudget('9999999.99'), '9999999.99');

    // 3. 低于 300 自动变为 300
    assert.equal(normalizeDailyBudget('0'), '300');
    assert.equal(normalizeDailyBudget('150'), '300');
    assert.equal(normalizeDailyBudget('299.99'), '300');
    assert.equal(normalizeDailyBudget(''), '300');
    assert.equal(normalizeDailyBudget('abc'), '300');

    // 4. 合法范围内保持原值
    assert.equal(normalizeDailyBudget('300'), '300');
    assert.equal(normalizeDailyBudget('300.00'), '300.00');
    assert.equal(normalizeDailyBudget('1288.50'), '1288.50');

    // 5. 后端 schema 校验
    assert.equal(dailyBudgetSchema.safeParse('300').success, true);
    assert.equal(dailyBudgetSchema.safeParse('9999999.99').success, true);
    assert.equal(dailyBudgetSchema.safeParse('299.99').success, false);
    assert.equal(dailyBudgetSchema.safeParse('10000000').success, false);
    assert.equal(dailyBudgetSchema.safeParse('300a').success, false);
    assert.equal(dailyBudgetSchema.safeParse('-300').success, false);
});

test('真实 DOM：流程1（任务基本配置填写任务名称）与流程2（项目统一配置填写项目日预算）', {
    skip: executablePath ? false : '未安装测试浏览器，可设置 R3_TEST_BROWSER_PATH',
}, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`
            <div style="display:flex;gap:16px">
                <div id="col-basic" style="width:300px">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span>1 任务基本配置</span>
                        <div>
                            <button id="btn-edit-basic" type="button"><span class="arco-icon-edit">编辑</span></button>
                            <button id="btn-del-basic" type="button"><span class="arco-icon-delete">删除</span></button>
                        </div>
                    </div>
                    <div>任务名称：<span id="display-task-name">R3-漫剧-次新-6-副本</span></div>
                </div>
                <div id="col-subtasks" style="width:300px">
                    <div><span>2 子任务批量配置</span></div>
                </div>
                <div id="col-unified" style="width:300px">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span>3 项目统一配置</span>
                        <div>
                            <button id="btn-edit-unified" type="button"><span class="arco-icon-edit">编辑</span></button>
                            <button id="btn-del-unified" type="button"><span class="arco-icon-delete">删除</span></button>
                        </div>
                    </div>
                    <div>项目日预算：<span id="display-budget">¥300.00</span></div>
                </div>
            </div>

            <!-- 任务基本配置抽屉 -->
            <div id="drawer-basic" class="arco-drawer" style="display:none;width:600px;height:500px">
                <div class="arco-drawer-header"><div class="arco-drawer-title">任务基本配置</div></div>
                <div class="arco-drawer-body">
                    <div class="arco-form-item">
                        <label>是否全域投放 *</label>
                        <div><span>是</span><span>否</span></div>
                    </div>
                    <div class="arco-form-item">
                        <label>客户ID *</label>
                        <input value="2026-端原生漫剧-ROI3有预算-万盟(4356057)" readonly />
                    </div>
                    <div class="arco-form-item">
                        <label>任务名称 <span>*</span></label>
                        <input id="input-basic-task-name" type="text" value="R3-漫剧-次新-6-副本" />
                    </div>
                    <div class="arco-form-item">
                        <label>任务标签</label>
                        <input type="text" placeholder="按回车完成输入" value="" />
                    </div>
                </div>
                <div class="arco-drawer-footer">
                    <button id="basic-cancel" type="button">取消</button>
                    <button id="basic-confirm" type="button">确定</button>
                </div>
            </div>

            <!-- 项目统一配置抽屉 -->
            <div id="drawer-unified" class="arco-drawer" style="display:none;width:600px;height:500px">
                <div class="arco-drawer-header"><div class="arco-drawer-title">项目统一配置</div></div>
                <div class="arco-drawer-body">
                    <div class="arco-form-item">
                        <label>投放时段 *</label>
                        <div>全选 清空</div>
                    </div>
                    <div class="arco-form-item">
                        <label>项目日预算 <span>*</span></label>
                        <div>
                            <input id="input-unified-budget" type="text" value="300.00" />
                            <span>元</span>
                        </div>
                    </div>
                </div>
                <div class="arco-drawer-footer">
                    <button id="unified-cancel" type="button">取消</button>
                    <button id="unified-confirm" type="button">确定</button>
                </div>
            </div>

            <script>
                const drawerBasic = document.getElementById('drawer-basic');
                const drawerUnified = document.getElementById('drawer-unified');
                const taskNameInput = document.getElementById('input-basic-task-name');
                const budgetInput = document.getElementById('input-unified-budget');

                document.getElementById('btn-edit-basic').onclick = () => {
                    drawerBasic.style.display = 'block';
                };
                document.getElementById('basic-cancel').onclick = () => {
                    drawerBasic.style.display = 'none';
                };
                document.getElementById('basic-confirm').onclick = () => {
                    document.getElementById('display-task-name').textContent = taskNameInput.value;
                    drawerBasic.style.display = 'none';
                };

                document.getElementById('btn-edit-unified').onclick = () => {
                    drawerUnified.style.display = 'block';
                };
                budgetInput.onblur = () => {
                    const num = Number(budgetInput.value);
                    if (Number.isFinite(num) && num > 0) {
                        budgetInput.value = num.toFixed(2);
                    }
                };
                document.getElementById('unified-cancel').onclick = () => {
                    drawerUnified.style.display = 'none';
                };
                document.getElementById('unified-confirm').onclick = () => {
                    document.getElementById('display-budget').textContent = '¥' + budgetInput.value;
                    drawerUnified.style.display = 'none';
                };
            </script>
        `);

        // 验证流程 1：任务基本配置填写任务名称并点击确定
        const configuredName = await fillStageBasicTaskName(page, 'R3-漫剧-次新', 1);
        assert.equal(configuredName, 'R3-漫剧-次新-1');
        assert.equal(await page.locator('#display-task-name').textContent(), 'R3-漫剧-次新-1');
        assert.equal(await page.locator('#drawer-basic').isVisible(), false);

        // 验证流程 2：项目统一配置填写项目日预算并点击确定（兼容失焦自动格式化为 500.00）
        await fillStageUnifiedDailyBudget(page, '500');
        assert.equal(await page.locator('#display-budget').textContent(), '¥500.00');
        assert.equal(await page.locator('#drawer-unified').isVisible(), false);
    } finally {
        await browser.close();
    }
});

test('前端控制台真实 DOM：项目日预算输入框屏蔽非法字符、低于 300 自动变为 300、高于 9999999.99 自动变为 9999999.99', {
    skip: executablePath ? false : '未安装测试浏览器，可设置 R3_TEST_BROWSER_PATH',
}, async () => {
    const port = await startServer(0);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
        const budgetInput = page.locator('#input-daily-budget');
        await budgetInput.waitFor({ state: 'visible', timeout: 5000 });

        // 1. 输入包含非 0-9 和 . 的字符，且数值低于 300 -> 过滤非法字符，失焦后自动变为 300
        await budgetInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('abc-+$!@#150xyz');
        assert.equal(await budgetInput.inputValue(), '150');
        await budgetInput.blur();
        assert.equal(await budgetInput.inputValue(), '300');

        // 2. 输入高于 9999999.99 -> 自动变为 9999999.99
        await budgetInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('99999999');
        assert.equal(await budgetInput.inputValue(), '9999999.99');
    } finally {
        await browser.close();
        await closeServer();
    }
});

test('Runner 完整编排顺序验证：复制链接 -> 流程1(任务基本配置名称-自增序号) -> 搭剧所有子任务 -> 流程2(项目统一配置日预算) -> 确认提交', async () => {
    clearConflictDramaGuard();
    const events: string[] = [];
    const page1 = { id: 'tab-1' };
    const page2 = { id: 'tab-2' };

    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: page1 }) as any,
        prepareStageCopyPage: async () => {
            events.push('tab1:copy');
            return 2; // Tab 1 容量为 2
        },
        preflightStageSubtasks: async (p: any) => {
            events.push(`${p.id}:preflight`);
            return 2;
        },
        openNextStageCopyTab: async (_ctx, _prevPage, tabNum) => {
            events.push(`tab${tabNum}:copy`);
            return { page: page2 as any, capacity: 2 };
        },
        fillStageBasicTaskName: async (p: any, prefix: string, seq: number) => {
            const full = buildStageTaskName(prefix, seq);
            events.push(`${p.id}:basicTaskName:${full}`);
            return full;
        },
        fillStageTaskWithReopenRetry: async (p: any, slot: number, _cap: number, data: any) => {
            events.push(`${p.id}:fillSubtask:${slot}:${data.name}`);
        },
        trimUnusedStageTasks: async (p: any, keep: number) => {
            events.push(`${p.id}:trimUnused:keep=${keep}`);
        },
        fillStageUnifiedDailyBudget: async (p: any, budget: string) => {
            events.push(`${p.id}:unifiedBudget:${budget}`);
        },
        submitStagePage: async (p: any) => {
            events.push(`${p.id}:submit`);
            return { kind: 'success' };
        },
        removeStageTasks: async () => {},
        closeSubmittedStageTab: async () => {},
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        createPipeline: () => ({
            get: async (keyword: string) => ({
                ok: true,
                name: keyword,
                seriesId: '7680000000000000001',
                douyinId: '7680000000000000001',
            }),
            prefetch: () => {},
            abort: () => {},
            drain: async () => {},
        }) as any,
    };

    await run({
        keywords: ['剧A', '剧B', '剧C'],
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=1'],
        roiRatio: '1.08',
        paidTemplate: '超超小额',
        taskNamePrefix: 'R3-漫剧-次新',
        dailyBudget: '300.00',
        skipSignalHandlers: true,
    }, deps);

    assert.deepEqual(events, [
        // 第 1 个 Tab：复制链接 -> 预检 -> 流程1(填写任务名称 R3-漫剧-次新-1) -> 搭剧子任务1、2 -> 流程2(填写项目日预算 300.00) -> 提交任务
        'tab1:copy',
        'tab-1:preflight',
        'tab-1:basicTaskName:R3-漫剧-次新-1',
        'tab-1:fillSubtask:1:剧A',
        'tab-1:fillSubtask:2:剧B',
        'tab-1:unifiedBudget:300.00',
        'tab-1:submit',
        // 第 2 个 Tab：复制链接 -> 预检 -> 流程1(填写任务名称 R3-漫剧-次新-2) -> 搭剧子任务1 -> 裁剪多余子任务 -> 流程2(填写项目日预算 300.00) -> 提交任务
        'tab2:copy',
        'tab-2:preflight',
        'tab-2:basicTaskName:R3-漫剧-次新-2',
        'tab-2:fillSubtask:1:剧C',
        'tab-2:trimUnused:keep=1',
        'tab-2:unifiedBudget:300.00',
        'tab-2:submit',
    ]);
});

test('后台防弹窗回归：lockPageActive 持久保持 CDP 焦点/活跃模拟且不 detach，createBackgroundPage 使用 background: true 创建新 Tab，全程禁止调用 bringToFront', async () => {
    const cdpCommands: Array<{ method: string; params: any }> = [];
    let detachedCount = 0;
    let closeListener: (() => void) | null = null;
    let newCDPSessionCount = 0;

    const mockContext: any = {
        newCDPSession: async () => {
            newCDPSessionCount++;
            return {
                send: async (method: string, params?: any) => {
                    cdpCommands.push({ method, params });
                    if (method === 'Target.createTarget') {
                        return { targetId: 'bg-target-1' };
                    }
                    return {};
                },
                detach: async () => {
                    detachedCount++;
                },
            };
        },
        waitForEvent: async (event: string) => {
            assert.equal(event, 'page');
            return bgPage;
        },
        pages: () => [mockPage],
        newPage: async () => {
            throw new Error('支持 CDP Target.createTarget 时不应回退调用抢占焦点的 context.newPage()');
        },
    };

    const mockPage: any = {
        isClosed: () => false,
        context: () => mockContext,
        once: (event: string, cb: () => void) => {
            if (event === 'close') closeListener = cb;
        },
        bringToFront: async () => {
            throw new Error('禁止调用 page.bringToFront() 抢占系统前台窗口焦点');
        },
    };

    const bgPage: any = {
        isClosed: () => false,
        context: () => mockContext,
        bringToFront: async () => {
            throw new Error('禁止对新 Tab 调用 bringToFront()');
        },
    };

    // 1. 连续调用 lockPageActive 应复用同一个 CDP 会话且在页面存活期间不 detach
    await lockPageActive(mockPage);
    await lockPageActive(mockContext, mockPage);
    assert.equal(newCDPSessionCount, 1, '同一 Page 应复用持久化 CDP 会话');
    assert.equal(detachedCount, 0, 'Page 未关闭前不应 detach CDP 会话，防止 Emulation 状态失效');
    assert.deepEqual(
        cdpCommands.slice(0, 3).map(c => c.method),
        ['Emulation.setFocusEmulationEnabled', 'Emulation.setIdleOverride', 'Page.setWebLifecycleState']
    );
    assert.deepEqual(cdpCommands[0].params, { enabled: true });
    assert.deepEqual(cdpCommands[2].params, { state: 'active' });

    // 2. createBackgroundPage 应使用 Target.createTarget({ url: 'about:blank', background: true })
    const created = await createBackgroundPage(mockContext, mockPage);
    assert.equal(created, bgPage);
    const createTargetCmd = cdpCommands.find(c => c.method === 'Target.createTarget');
    assert.deepEqual(createTargetCmd?.params, { url: 'about:blank', background: true });
    assert.equal(detachedCount, 1, 'createBackgroundPage 的临时会话应在创建完成后 detach');

    // 3. 页面关闭时自动释放并 detach 持久锁会话
    assert.ok(closeListener, '应注册 page close 清理监听');
    closeListener!();
    assert.equal(detachedCount, 2, 'Page 关闭后应自动 detach 对应的 CDP 会话');
});
