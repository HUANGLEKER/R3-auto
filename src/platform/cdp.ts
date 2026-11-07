// ============================================================
// Chrome CDP Connection & Page Topology Resolution Layer
// ============================================================

import { chromium } from 'playwright-core';
import {
    CDP_PORT,
    UNIFIED,
    COPY_PAGE_URL,
    STAGE_SELECTORS,
} from '../core/config.ts';
import { readCopyPageUrls } from '../core/paths.ts';
import {
    getStageSubtaskContainers,
    getStageSubtaskStats,
    tryClickStageReload,
} from './stage_dom.ts';
import { profiler } from '../infra/profiler.ts';
import { StrongLocator } from '../infra/locator.ts';
import { STAGE_FIELDS } from '../infra/field_map.ts';



export async function connectCDP() {
    const span = profiler.startSpan('cdp.connect', 'CDP');
    try {
        const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
        span.end({ ok: true });
        return browser;
    } catch (error) {
        span.endWithError(error);
        throw error;
    }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallbackValue: T): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallbackValue), ms);
    });
    return Promise.race([
        promise.then(res => {
            clearTimeout(timer);
            return res;
        }).catch(() => {
            clearTimeout(timer);
            return fallbackValue;
        }),
        timeoutPromise,
    ]);
}

export async function isPageAlive(page: any, timeoutMs = 2500): Promise<boolean> {
    try {
        if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
            return false;
        }
        const res = await withTimeout(
            page.evaluate(() => document.readyState),
            timeoutMs,
            null
        );
        if (res) return true;

        // 若首次超时，尝试后台轻量唤醒后重测一次（防止 Edge 后台睡眠休眠导致短暂不响应，且不抢占前台窗口焦点）
        await lockPageActive(page).catch(() => {});
        const retryRes = await withTimeout(
            page.evaluate(() => document.readyState),
            1200,
            null
        );
        return Boolean(retryRes);
    } catch {
        return false;
    }
}

const activeLockSessions = new WeakMap<object, any>();

/**
 * 锁定页面生命周期为活跃态，并启用焦点模拟、禁用 Chromium 后台节流与休眠挂起。
 * 保持每个 Page 的 CDP 会话在页面存活期间不 detach，避免会话断开导致 Emulation 状态失效，
 * 同时全程不调用 Page.bringToFront，防止后台运行时浏览器抢占系统窗口焦点。
 */
export async function lockPageActive(contextOrPage: any, maybePage?: any): Promise<void> {
    try {
        const page = maybePage !== undefined ? maybePage : contextOrPage;
        if (!page || typeof page !== 'object' || (typeof page.isClosed === 'function' && page.isClosed())) {
            return;
        }
        const context = maybePage !== undefined
            ? (contextOrPage ?? (typeof page.context === 'function' ? page.context() : null))
            : (typeof page.context === 'function' ? page.context() : null);
        if (!context || typeof context.newCDPSession !== 'function') {
            return;
        }

        let session = activeLockSessions.get(page);
        if (!session) {
            session = await context.newCDPSession(page);
            activeLockSessions.set(page, session);
            if (typeof page.once === 'function') {
                page.once('close', () => {
                    activeLockSessions.delete(page);
                    session.detach().catch(() => {});
                });
            }
        }

        const applyOverrides = async (cdpSession: any) => {
            await cdpSession.send('Emulation.setFocusEmulationEnabled', {
                enabled: true,
            }).catch(() => {});
            await cdpSession.send('Emulation.setIdleOverride', {
                isUserActive: true,
                isScreenUnlocked: true,
            }).catch(() => {});
            await cdpSession.send('Page.setWebLifecycleState', {
                state: 'active',
            }).catch(() => {});
        };

        try {
            await applyOverrides(session);
        } catch {
            activeLockSessions.delete(page);
            session = await context.newCDPSession(page);
            activeLockSessions.set(page, session);
            await applyOverrides(session);
        }
    } catch (_) {}
}

/**
 * 在后台创建新标签页（通过 CDP Target.createTarget 的 background: true），
 * 避免 context.newPage() 默认激活前台标签页导致浏览器窗口弹窗抢占焦点。
 */
export async function createBackgroundPage(
    context: any,
    openerPage?: any
): Promise<any> {
    const anchorPage = openerPage || (typeof context?.pages === 'function' ? context.pages()[0] : null);
    if (
        context &&
        typeof context.newCDPSession === 'function' &&
        typeof context.waitForEvent === 'function' &&
        anchorPage
    ) {
        let session: any = null;
        let createdTargetId = '';
        try {
            const existingPages = new Set(typeof context.pages === 'function' ? context.pages() : []);
            session = await context.newCDPSession(anchorPage);
            const pagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
            const result = await session.send('Target.createTarget', {
                url: 'about:blank',
                background: true,
            });
            createdTargetId = result?.targetId || '';
            const page = await pagePromise;
            if (page) {
                return page;
            }
            const fallbackCreated = (typeof context.pages === 'function' ? context.pages() : []).find(
                (p: any) => !existingPages.has(p)
            );
            if (fallbackCreated) {
                return fallbackCreated;
            }
            if (createdTargetId) {
                await session.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => {});
            }
        } catch (_) {
            if (session && createdTargetId) {
                await session.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => {});
            }
        } finally {
            if (session) {
                await session.detach().catch(() => {});
            }
        }
    }
    return context.newPage();
}

/**
 * 启用 CDP 资源精简拦截（过滤视频流等高开销媒体，保护内存）
 */
export async function enableResourceOptimization(context: any): Promise<void> {
    try {
        await context.route('**/*', (route: any) => {
            const req = route.request();
            const type = req.resourceType();
            const url = req.url().toLowerCase();

            if (['media', 'video'].includes(type) || url.endsWith('.mp4') || url.endsWith('.webm') || url.includes('/video/tos/')) {
                return route.abort();
            }
            route.continue();
        });
    } catch (_) {}
}

/**
 * 批次切换或内存压力时通过 CDP 触发 V8 堆内存垃圾回收
 */
export async function triggerBrowserGC(context: any): Promise<void> {
    try {
        const pages = context.pages();
        for (const page of pages) {
            if (!page || (typeof page.isClosed === 'function' && page.isClosed())) continue;
            try {
                const session = await context.newCDPSession(page);
                await session.send('HeapProfiler.collectGarbage').catch(() => {});
                await session.detach().catch(() => {});
            } catch (_) {}
        }
    } catch (_) {}
}

export async function detectCurrentChangduApp(page: any): Promise<{
    app: string;
    source: string;
    candidates: any[];
}> {
    const span = profiler.startSpan('detect_changdu_app', 'PAGE');

    // ------------------------------------------------------------
    // 第一层（最权威）：读取当前激活的级联选择器 / 导航栏 / 输入框属性 / 选中态组件
    // ------------------------------------------------------------
    try {
        const domResult: { app: string; source: string } | null = await withTimeout<{ app: string; source: string } | null>(
            page.evaluate(() => {
                const getElementText = (el: Element): string => {
                    const input = el as HTMLInputElement;
                    const parts = [
                        input.value,
                        el.getAttribute('value'),
                        el.getAttribute('placeholder'),
                        el.getAttribute('title'),
                        el.getAttribute('aria-label'),
                        el.textContent,
                        (el as HTMLElement).innerText,
                    ].filter(Boolean);
                    return parts.join(' ').trim();
                };

                // 优先检查级联选择器中的真实输入框与选中文本容器（排除浮动下拉面板）
                const selectors = [
                    'input.arco-cascader-view-input',
                    '.arco-cascader input',
                    '.layout-menus-cascader input',
                    '.layout-menus-cascader-title',
                    '.layout-menus-cascader',
                    '.arco-cascader-view-value',
                    '.arco-cascader-label',
                    '.arco-cascader-view',
                    '.arco-cascader',
                    '.arco-menu-selected',
                    '.layout-header',
                ];

                for (const sel of selectors) {
                    const elements = Array.from(document.querySelectorAll(sel));
                    for (const el of elements) {
                        // 过滤掉下拉面板选项（防止展开时同时包含“免费”和“付费”选项造成歧义）
                        if (el.closest('.arco-cascader-panel, .arco-trigger-popup, .arco-dropdown-menu, .arco-popover')) {
                            continue;
                        }

                        const text = getElementText(el);
                        if (!text) continue;

                        const hasPaid = /付费|paid/i.test(text);
                        const hasFree = /免费|free/i.test(text);

                        if (hasPaid && !hasFree) {
                            return { app: 'paid', source: `dom-cascader:${sel}` };
                        }
                        if (hasFree && !hasPaid) {
                            return { app: 'free', source: `dom-cascader:${sel}` };
                        }
                        if (hasPaid && hasFree) {
                            // 若同时包含（如标题包含“抖音端原生付费漫剧”），使用正则精准区分
                            if (/抖音端?原生?付费|付费漫剧|付费短剧/i.test(text)) {
                                return { app: 'paid', source: `dom-cascader-exact:${sel}` };
                            }
                            if (/抖音端?原生?免费|免费漫剧|免费短剧/i.test(text)) {
                                return { app: 'free', source: `dom-cascader-exact:${sel}` };
                            }
                        }
                    }
                }
                return null;
            }),
            1500,
            null
        );

        if (domResult?.app) {
            span.end({ app: domResult.app, source: domResult.source });
            return {
                app: domResult.app,
                source: domResult.source,
                candidates: [],
            };
        }
    } catch (_) {}

    // ------------------------------------------------------------
    // 第二层：可见精确/模糊文本位置判定（支持多级级联路径，支持 input.value）
    // ------------------------------------------------------------
    const labels = [
        { app: 'free', text: '抖音端原生免费漫剧' },
        { app: 'free', text: '抖音端原生免费短剧' },
        { app: 'free', text: '抖音端原生免费' },
        { app: 'free', text: '免费漫剧' },
        { app: 'free', text: '免费短剧' },
        { app: 'paid', text: '抖音端原生付费漫剧' },
        { app: 'paid', text: '抖音端原生付费短剧' },
        { app: 'paid', text: '抖音端原生付费' },
        { app: 'paid', text: '付费漫剧' },
        { app: 'paid', text: '付费短剧' },
    ];

    const candidates: Array<{
        app: string;
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
    }> = [];

    for (const item of labels) {
        const locator = page.getByText(item.text, { exact: false });

        const count = await withTimeout(
            locator.count(),
            1200,
            0
        );

        for (let i = 0; i < count; i++) {
            const node = locator.nth(i);

            const visible = await withTimeout(
                node.isVisible({ timeout: 400 }),
                800,
                false
            );

            if (!visible) {
                continue;
            }

            const box: { x: number; y: number; width: number; height: number } | null = await withTimeout<{ x: number; y: number; width: number; height: number } | null>(
                node.boundingBox(),
                800,
                null
            );

            if (!box) {
                continue;
            }

            candidates.push({
                app: item.app,
                text: item.text,
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
            });
        }
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => {
            const aLeft = a.x < 360 ? 0 : 1;
            const bLeft = b.x < 360 ? 0 : 1;

            if (aLeft !== bLeft) {
                return aLeft - bLeft;
            }

            if (a.y !== b.y) {
                return a.y - b.y;
            }

            return a.x - b.x;
        });

        span.end({ app: candidates[0].app, source: 'visible-fuzzy-text' });
        return {
            app: candidates[0].app,
            source: 'visible-fuzzy-text',
            candidates,
        };
    }

    // ------------------------------------------------------------
    // 第三层：智能过滤弹窗/气泡干扰后的纯净 DOM 文本匹配（包含 input 属性）
    // ------------------------------------------------------------
    try {
        const cleanEvalResult = await withTimeout(
            page.evaluate(() => {
                const clone = document.body.cloneNode(true) as HTMLElement;
                // 移除下拉弹窗、抽屉悬浮层，防止下拉选项列表中的“免费+付费”产生歧义
                const popups = clone.querySelectorAll(
                    '.arco-trigger, .arco-trigger-popup, .arco-dropdown-menu, .arco-cascader-panel, .arco-select-dropdown, .arco-popover'
                );
                popups.forEach(p => p.remove());

                // 收集所有 input 的 value
                const inputValues = Array.from(clone.querySelectorAll('input, textarea'))
                    .map(inp => (inp as HTMLInputElement).value || inp.getAttribute('placeholder') || '')
                    .join(' ');

                const cleanText = `${clone.innerText || ''} ${inputValues}`;
                const hasFree = /抖音端?原生?免费(?:漫剧|短剧)?|免费漫剧|免费短剧/.test(cleanText);
                const hasPaid = /抖音端?原生?付费(?:漫剧|短剧)?|付费漫剧|付费短剧/.test(cleanText);

                if (hasFree && !hasPaid) return 'free';
                if (hasPaid && !hasFree) return 'paid';
                return null;
            }),
            1500,
            null
        );

        if (cleanEvalResult) {
            span.end({ app: cleanEvalResult, source: 'clean-dom-text' });
            return {
                app: cleanEvalResult,
                source: 'clean-dom-text',
                candidates: [],
            };
        }
    } catch (_) {}

    // ------------------------------------------------------------
    // 第四层：全局 body 兜底匹配
    // ------------------------------------------------------------
    const bodyText = await withTimeout(
        page.locator('body').innerText({
            timeout: UNIFIED.PAGE_DETECT_TIMEOUT,
        }),
        UNIFIED.PAGE_DETECT_TIMEOUT + 500,
        ''
    );

    const hasFree = /抖音端?原生?免费(?:漫剧|短剧)?|免费漫剧|免费短剧/.test(bodyText);
    const hasPaid = /抖音端?原生?付费(?:漫剧|短剧)?|付费漫剧|付费短剧/.test(bodyText);

    if (hasFree && !hasPaid) {
        span.end({ app: 'free', source: 'body-unique' });
        return {
            app: 'free',
            source: 'body-unique',
            candidates: [],
        };
    }

    if (hasPaid && !hasFree) {
        span.end({ app: 'paid', source: 'body-unique' });
        return {
            app: 'paid',
            source: 'body-unique',
            candidates: [],
        };
    }

    span.end({ app: 'unknown', source: hasFree && hasPaid ? 'body-ambiguous' : 'not-found' });
    return {
        app: 'unknown',
        source: hasFree && hasPaid ? 'body-ambiguous' : 'not-found',
        candidates: [],
    };
}

export async function readPageIdentity(page: any): Promise<{
    page: any;
    url: string;
    app: string;
    type: string;
    appDetectSource: string;
    appCandidates: any[];
}> {
    let url = '';
    try {
        url = page.url();
    } catch (_) {}

    if (!url || url === 'about:blank') {
        url = await withTimeout(
            page.evaluate(() => location.href),
            1200,
            ''
        );
        if (!url || url === 'about:blank') {
            await lockPageActive(page).catch(() => {});
            url = await withTimeout(
                page.evaluate(() => location.href),
                1200,
                ''
            );
        }
    }

    let parsed: URL | null = null;
    try {
        parsed = new URL(url);
    } catch (_) {}

    const pathname = (parsed?.pathname || '').toLowerCase();

    let type = 'unknown';

    // 仅识别剧名输入所需的免费漫剧列表。
    if (
        pathname.includes('/sale/short-play/list') ||
        pathname.includes('/sale/comic/list') ||
        (pathname.includes('/list') && pathname.includes('/sale/')) ||
        (pathname.includes('/novelsale/') && pathname.includes('/list')) ||
        pathname.includes('/book-list') ||
        pathname.includes('/drama-list')
    ) {
        type = 'list';
    }

    // 2. DOM 级精准判定：检查左侧高亮选中的菜单项 (.arco-menu-selected) 与面包屑 / 页面标题
    if (type === 'unknown') {
        try {
            const pageTypeResult = await withTimeout(
                page.evaluate(() => {
                    // A. 优先直接读取侧边栏高亮选中的菜单项
                    const selectedMenuItems = Array.from(
                        document.querySelectorAll('.arco-menu-selected, .arco-menu-item-selected, [class*="menu-item-selected"]')
                    );
                    for (const item of selectedMenuItems) {
                        const text = (item.textContent || '').trim();
                        if (text.includes('漫剧列表') || text.includes('短剧列表') || text.includes('剧目列表')) {
                            return 'list';
                        }
                    }

                    // B. 检查页面主标题与面包屑最后一项
                    const breadcrumbLast = document.querySelector('.arco-breadcrumb-item:last-child');
                    const breadcrumbText = (breadcrumbLast?.textContent || '').trim();
                    if (breadcrumbText.includes('列表')) return 'list';

                    const pageHeader = document.querySelector('.arco-page-header-title, h1, h2');
                    const headerText = (pageHeader?.textContent || '').trim();
                    if (headerText.includes('列表')) return 'list';

                    // C. 检查页面主要搜索表单 / 表格列头特征
                    const bodyText = document.body?.innerText || '';
                    if (/获取漫剧推广链|获取短剧推广链|获取推广链|剧目ID/i.test(bodyText)) {
                        return 'list';
                    }

                    return null;
                }),
                1200,
                null
            );
            if (pageTypeResult) {
                type = pageTypeResult;
            }
        } catch (_) {}
    }

    // 3. Body 兜底匹配
    if (type === 'unknown') {
        const bodyText = await withTimeout(
            page.locator('body').innerText({
                timeout: UNIFIED.PAGE_DETECT_TIMEOUT,
            }),
            UNIFIED.PAGE_DETECT_TIMEOUT + 300,
            ''
        );

        if (/(?:漫剧|短剧|剧目)列表/.test(bodyText)) {
            type = 'list';
        }
    }

    const appResult = await detectCurrentChangduApp(page);

    return {
        page,
        url,
        app: appResult.app,
        type,
        appDetectSource: appResult.source,
        appCandidates: appResult.candidates,
    };
}

export async function resolveUnifiedPages(
    context: any,
    options: { requiresFreeList?: boolean } = {},
): Promise<{
    freeList: any;
    stagePage: any;
}> {
    const span = profiler.startSpan('resolve_unified_pages', 'PAGE');
    const requiresFreeList = options.requiresFreeList ?? true;
    const requiredPageCount = requiresFreeList ? 2 : 1;
    console.log(`🔍 正在连接 Edge 浏览器并自动扫描识别 ${requiredPageCount} 个必需页面（OpenAPI 模式）...`);

    const maxRounds = 3;
    let lastMissing: string[] = [];
    let lastChangdu: Array<Awaited<ReturnType<typeof readPageIdentity>>> = [];

    for (let round = 1; round <= maxRounds; round++) {
        const allPages = context.pages();

        let stagePage: any = null;
        const changdu: Array<Awaited<ReturnType<typeof readPageIdentity>>> = [];

        for (const page of allPages) {
            const alive = await isPageAlive(page, 1500);
            if (!alive) {
                continue;
            }

            let pageUrl = '';
            try {
                pageUrl = page.url();
            } catch (_) {}

            if (!pageUrl || pageUrl === 'about:blank') {
                pageUrl = await withTimeout(
                    page.evaluate(() => location.href),
                    1000,
                    ''
                );

                if (!pageUrl || pageUrl === 'about:blank') {
                    try {
                        const session = await context.newCDPSession(page);
                        const target = await withTimeout<{ targetInfo?: { url?: string } } | null>(
                            session.send('Target.getTargetInfo'),
                            1000,
                            null
                        );
                        pageUrl = target?.targetInfo?.url || pageUrl;
                        await session.detach().catch(() => {});
                    } catch (_) {}
                }
            }

            if (pageUrl.includes('usergrowth.com.cn')) {
                if (
                    !stagePage ||
                    pageUrl.includes('/onestop/ad/ad_create/copy')
                ) {
                    stagePage = page;
                }
            }

            if (pageUrl.includes('changdupingtai.com')) {
                changdu.push(await readPageIdentity(page));
            }
        }

        const pick = (app: string, type: string) =>
            changdu.find(
                item =>
                    item.app === app &&
                    item.type === type
            )?.page || null;

        const freeList = pick('free', 'list');

        const missing = [];
        if (requiresFreeList && !freeList) missing.push('免费漫剧列表');
        if (!stagePage) missing.push('搭剧平台已登录页面');

        if (missing.length === 0) {
            console.log(`✅ 已绑定 ${requiredPageCount} 个必需页面（OpenAPI 模式）：`);
            if (requiresFreeList) console.log('   免费漫剧列表');
            console.log('   搭剧平台（启动后只导航一次复制任务页）');

            // 启用防休眠锁定与媒体资源精简
            await Promise.all([
                ...(requiresFreeList ? [lockPageActive(context, freeList)] : []),
                lockPageActive(context, stagePage),
                enableResourceOptimization(context),
            ]).catch(() => {});

            span.end({ ok: true, rounds: round });
            return {
                freeList,
                stagePage,
            };
        }

        lastMissing = missing;
        lastChangdu = changdu;



        if (round < maxRounds) {
            console.log(
                `   ⏳ 第 ${round} 轮扫描发现部分标签页可能处于休眠挂起状态（未就绪: ${missing.join('、')}），正在自动唤醒预热并重试 (第 ${round + 1} 轮)...`
            );
            // 依次在后台唤醒每个标签页生命周期，防止 Edge 标签页后台挂起冻结且不抢占系统窗口焦点
            for (const page of allPages) {
                try {
                    await lockPageActive(context, page);
                    await page.waitForTimeout(100);
                } catch (_) {}
            }
            await new Promise(r => setTimeout(r, 600));
        }
    }

    console.error('\n❌ 常读页面识别未通过，当前检测到的页面状态：');
    for (const item of lastChangdu) {
        console.error(
            `   ${item.app}/${item.type}` +
            ` [app=${item.appDetectSource}] -> ${item.url}`
        );

        if (
            item.app === 'unknown' &&
            item.appCandidates?.length
        ) {
            console.error(
                '      可见应用候选: ' +
                item.appCandidates
                    .map((candidate: any) =>
                        `${candidate.app}@(${Math.round(candidate.x)},${Math.round(candidate.y)})`
                    )
                    .join(', ')
            );
        }
    }

    const guide = '【OpenAPI 模式排查指引】请确认 Edge 中已打开：\n' +
        (requiresFreeList ? '1. 免费漫剧列表（仅剧名输入时需要，左侧选择: 抖音端原生免费漫剧 -> 默认应用 -> 主管账号）\n2. ' : '1. ') +
        '搭剧平台 (已登录 usergrowth.com.cn)';
    const error = new Error(`缺少或未识别页面: ${lastMissing.join('、')}。\n${guide}`);
    span.endWithError(error);
    throw error;
}

export async function waitStageCopyPageReady(
    page: any,
    timeout = UNIFIED.STAGE_PAGE_READY_TIMEOUT
): Promise<number> {
    const span = profiler.startSpan('wait_stage_copy_page_ready', 'STAGE');
    await lockPageActive(page);

    const stageRoot = page.locator('#sub-micro-container');

    await stageRoot.waitFor({
        state: 'visible',
        timeout,
    });

    try {
        await page.waitForFunction(
            ({ baseSelector, editSelector }: { baseSelector: string; editSelector: string }) => {
                const raw = Array.from(
                    document.querySelectorAll(baseSelector)
                );

                const realTasks = raw.filter(node =>
                    node.querySelector(editSelector)
                );

                return realTasks.length > 0;
            },
            {
                baseSelector: STAGE_SELECTORS.subtaskContainerBase,
                editSelector: STAGE_SELECTORS.editIcon,
            },
            { timeout }
        );
    } catch (error) {
        const stats = await getStageSubtaskStats(page)
            .catch(() => ({
                rawCount: -1,
                taskCount: -1,
                auxiliaryCount: -1,
            }));

        const readyError: any = new Error(
            `搭剧页面业务 DOM Ready 超时：未检测到任何真实子任务（实际检测到 ${stats.taskCount} 个）；` +
            '已完全忽略 networkidle，仅等待真实子任务 DOM。'
        );
        readyError.code = 'STAGE_PAGE_DOM_READY_TIMEOUT';
        span.endWithError(readyError);
        throw readyError;
    }

    const { taskCount: detectedCount } = await getStageSubtaskStats(page);
    const effectiveCount = Math.min(Math.max(1, detectedCount), UNIFIED.STAGE_MAX_SUBTASKS);

    const firstSubtask = getStageSubtaskContainers(page).first();
    await firstSubtask.waitFor({
        state: 'visible',
        timeout,
    });

    console.log(
        `✅ 搭剧页面业务 DOM 已就绪：自动识别到 ${detectedCount} 个真实子任务，本链接任务有效可用子任务数 = ${effectiveCount}`
    );
    span.end({ ok: true, detectedCount, effectiveCount });
    return effectiveCount;
}

export async function prepareStageCopyPage(
    page: any,
    copyPageUrl?: string
): Promise<number> {
    const targetUrl = copyPageUrl || (function() {
        try {
            return readCopyPageUrls()[0];
        } catch (_) {
            return COPY_PAGE_URL;
        }
    })();

    const span = profiler.startSpan('prepare_stage_copy_page', 'STAGE', { targetUrl });
    await lockPageActive(page);

    let alreadyOnCopyPage = false;
    try {
        const current = new URL(page.url());
        const target = new URL(targetUrl);

        alreadyOnCopyPage =
            current.origin === target.origin &&
            current.pathname === target.pathname &&
            current.searchParams.get('_app_id') ===
            target.searchParams.get('_app_id') &&
            current.searchParams.get('ad_platform') ===
            target.searchParams.get('ad_platform') &&
            current.searchParams.get('id') ===
            target.searchParams.get('id');
    } catch (_) {}

    if (!alreadyOnCopyPage) {
        console.log(
            `🔗 搭剧平台：进入复制任务页 -> ${targetUrl}`
        );

        await page.goto(
            targetUrl,
            {
                waitUntil: 'domcontentloaded',
                timeout: UNIFIED.STAGE_PAGE_READY_TIMEOUT,
            }
        );
    } else {
        console.log(
            '🔗 搭剧平台：已在复制任务页，不重复导航'
        );
    }

    console.log(
        '⏳ 正在自动识别复制任务页真实子任务数（平台上限 10 个）...'
    );

    let capacity = 0;
    try {
        capacity = await waitStageCopyPageReady(page);
    } catch (error) {
        const reloaded = await tryClickStageReload(page)
            .catch(() => false);

        if (!reloaded) {
            span.endWithError(error);
            throw error;
        }

        console.log(
            '🔄 搭剧页面已点击重新加载，重新等待复制任务页完整加载...'
        );

        capacity = await waitStageCopyPageReady(page);
    }

    console.log(
        `✅ 复制任务页就绪：本链接任务自动识别子任务数 = ${capacity} 个（上限 ${UNIFIED.STAGE_MAX_SUBTASKS} 个）`
    );
    span.end({ ok: true, capacity });
    return capacity;
}

export async function openNextStageCopyTab(
    context: any,
    openerPage: any,
    tabNumber: number,
    copyPageUrl?: string
): Promise<{ page: any; capacity: number }> {
    const span = profiler.startSpan('open_next_stage_copy_tab', 'STAGE', { tabNumber });
    console.log(
        `🔗 搭剧平台：当前链接所有子任务已搭完，复制链接开启第 ${tabNumber} 个新链接任务 (新建 Tab)`
    );

    await lockPageActive(context, openerPage).catch(() => {});

    const page = await createBackgroundPage(context, openerPage);
    await lockPageActive(context, page).catch(() => {});

    const capacity = await prepareStageCopyPage(
        page,
        copyPageUrl
    );

    console.log(
        `✅ 搭剧平台：第 ${tabNumber} 个链接任务 Tab 已就绪，包含 ${capacity} 个子任务，后续从子任务 1 开始递推`
    );

    span.end({ ok: true, tabNumber, capacity });
    return { page, capacity };
}

export async function preflightStageSubtasks(
    page: any
): Promise<number> {
    const span = profiler.startSpan('preflight_stage_subtasks', 'STAGE');
    await lockPageActive(page);

    const tasks = getStageSubtaskContainers(page);

    const {
        rawCount,
        taskCount: actual,
        auxiliaryCount,
    } = await getStageSubtaskStats(page);

    console.log(
        `🔎 搭剧容量探测：页面实际检测到 ${actual} 个真实子任务` +
        (
            auxiliaryCount > 0
                ? `（原始候选节点 ${rawCount} 个，已排除辅助节点 ${auxiliaryCount} 个）`
                : ''
        )
    );

    if (actual <= 0) {
        const error: any = new Error(
            '搭剧页面未检测到任何真实子任务，无法开始搭建'
        );
        error.code = 'STAGE_PREFLIGHT_CAPACITY_FAILED';
        span.endWithError(error);
        throw error;
    }

    const effectiveCapacity = Math.min(actual, UNIFIED.STAGE_MAX_SUBTASKS);

    const firstTask = tasks.first();
    const editVisible = await StrongLocator.waitForVisible(
        firstTask,
        STAGE_FIELDS.editIcon.locator,
        UNIFIED.STAGE_ACTION_TIMEOUT
    );

    if (!editVisible) {
        const error = new Error(
            '搭剧第 1 个真实子任务不存在可操作的编辑入口；Preflight 未通过。'
        );
        span.endWithError(error);
        throw error;
    }

    console.log(
        `✅ 搭剧 Preflight 通过：当前链接任务有效子任务容量 = ${effectiveCapacity} 个`
    );
    span.end({ ok: true, actual, effectiveCapacity });
    return effectiveCapacity;
}
