// ============================================================
// Edge / Chrome Browser Launcher & CDP Topology Checker
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { CDP_PORT } from '../core/config.ts';
import { PROJECT_DIR, readCopyPageUrls, readKeywords } from '../core/paths.ts';
import { needsFreeDramaList } from '../core/drama_input.ts';

export interface TabInfo {
    id: string;
    title: string;
    url: string;
    type: string;
}

export interface BrowserInfo {
    path: string;
    name: 'Edge' | 'Chrome' | 'Browser';
}

export interface EnvironmentStatus {
    cdpConnected: boolean;
    browserFound: boolean;
    browserName: string;
    browserPath: string | null;
    tabs: TabInfo[];
    topology: {
        freeList: boolean;
        stagePage: boolean;
    };
    requiresFreeList: boolean;
    missingPages: string[];
}

export function findBrowserExecutable(): BrowserInfo | null {
    // 1. Prioritize Microsoft Edge
    const edgeCandidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ];

    for (const p of edgeCandidates) {
        if (p && fs.existsSync(p)) {
            return { path: p, name: 'Edge' };
        }
    }

    try {
        const queryResult = execSync(
            'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe" /ve',
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        const match = queryResult.match(/REG_SZ\s+(.+)/);
        if (match && match[1] && fs.existsSync(match[1].trim())) {
            return { path: match[1].trim(), name: 'Edge' };
        }
    } catch (_) {}

    // 2. Fallback to Google Chrome
    const chromeCandidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];

    for (const p of chromeCandidates) {
        if (p && fs.existsSync(p)) {
            return { path: p, name: 'Chrome' };
        }
    }

    try {
        const queryResult = execSync(
            'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        const match = queryResult.match(/REG_SZ\s+(.+)/);
        if (match && match[1] && fs.existsSync(match[1].trim())) {
            return { path: match[1].trim(), name: 'Chrome' };
        }
    } catch (_) {}

    return null;
}

export async function isCDPAvailable(port = CDP_PORT): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(1200),
        });
        return res.ok;
    } catch (_) {
        return false;
    }
}

async function evalTabQuick(wsUrl: string): Promise<{ url: string; path: string; pageType: string; app: string } | null> {
    if (!wsUrl) return null;
    return new Promise(resolve => {
        let ws: any = null;
        const timer = setTimeout(() => {
            if (ws) {
                try { ws.close(); } catch (_) {}
            }
            resolve(null);
        }, 2500);

        try {
            ws = new (globalThis as any).WebSocket(wsUrl);
            ws.onopen = () => {
                const code = `(() => {
                    const p = location.pathname;
                    let pageType = 'unknown';
                    if (p.includes('/list')) {
                        pageType = 'list';
                    } else {
                        const title = document.title || '';
                        const headers = Array.from(document.querySelectorAll('h1, h2, .arco-breadcrumb-item, .arco-page-header-title, .arco-menu-selected'))
                            .map(el => el.textContent || '')
                            .join(' ');
                        if (/(?:漫剧|短剧)列表/.test(title + ' ' + headers)) pageType = 'list';
                    }

                    let app = 'unknown';
                    // 1. 优先读取级联选择器 / 选中导航
                    const cascaderSelectors = [
                        '.layout-menus-cascader-title',
                        '.layout-menus-cascader',
                        '.arco-cascader-view-value',
                        '.arco-cascader-label',
                        '.arco-cascader-view',
                        '.arco-cascader',
                        '.arco-menu-selected',
                        '.layout-header'
                    ];
                    for (const sel of cascaderSelectors) {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const text = el.textContent || '';
                            if (text.includes('付费')) { app = 'paid'; break; }
                            if (text.includes('免费')) { app = 'free'; break; }
                        }
                        if (app !== 'unknown') break;
                    }

                    // 2. 移除弹窗悬浮层后的纯净 body 文本探测
                    if (app === 'unknown' && document.body) {
                        const clone = document.body.cloneNode(true);
                        const popups = clone.querySelectorAll('.arco-trigger, .arco-trigger-popup, .arco-dropdown-menu, .arco-cascader-panel, .arco-select-dropdown, .arco-popover');
                        popups.forEach(p => p.remove());
                        const cleanText = clone.innerText || '';
                        const hasF = /抖音端原生免费/.test(cleanText);
                        const hasP = /抖音端原生付费/.test(cleanText);
                        if (hasF && !hasP) app = 'free';
                        else if (hasP && !hasF) app = 'paid';
                    }

                    // 3. 全局 body 兜底
                    if (app === 'unknown' && document.body) {
                        const text = document.body.innerText || '';
                        const hasF = text.includes('抖音端原生免费');
                        const hasP = text.includes('抖音端原生付费');
                        if (hasF && !hasP) app = 'free';
                        else if (hasP && !hasF) app = 'paid';
                    }

                    return { url: location.href, path: p, pageType, app };
                })()`;
                ws.send(JSON.stringify({
                    id: 1,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: code,
                        returnByValue: true,
                    },
                }));
            };
            ws.onmessage = (e: any) => {
                clearTimeout(timer);
                try {
                    const data = JSON.parse(e.data);
                    ws.close();
                    resolve(data.result?.result?.value || null);
                } catch (_) {
                    try { ws.close(); } catch (_) {}
                    resolve(null);
                }
            };
            ws.onerror = () => {
                clearTimeout(timer);
                resolve(null);
            };
        } catch (_) {
            clearTimeout(timer);
            resolve(null);
        }
    });
}

export async function checkEnvironment(inputOverride?: string[]): Promise<EnvironmentStatus> {
    let requiresFreeList = true;
    try { requiresFreeList = needsFreeDramaList(inputOverride || readKeywords()); } catch (_) {}
    const browser = findBrowserExecutable();
    const cdpConnected = await isCDPAvailable();

    if (!cdpConnected) {
        return {
            cdpConnected: false,
            browserFound: Boolean(browser),
            browserName: browser ? browser.name : 'Edge',
            browserPath: browser ? browser.path : null,
            tabs: [],
            topology: {
                freeList: false,
                stagePage: false,
            },
            requiresFreeList,
            missingPages: requiresFreeList ? ['常读 - 免费漫剧列表', '一站式搭剧平台'] : ['一站式搭剧平台'],
        };
    }

    let rawList: any[] = [];
    try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, {
            signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
            rawList = (await res.json()) as any[];
        }
    } catch (_) {}

    const pageTargets = rawList.filter(item => item && (item.type === 'page' || !item.type));
    const tabs: TabInfo[] = pageTargets.map(item => ({
        id: String(item.id || ''),
        title: String(item.title || ''),
        url: String(item.url || ''),
        type: String(item.type || 'page'),
    }));

    // 精确探测每个标签页的实时 DOM 与应用身份
    const evaluated = await Promise.all(
        pageTargets.map(t => evalTabQuick(t.webSocketDebuggerUrl))
    );

    let freeList = false;
    let stagePage = false;

    for (let i = 0; i < evaluated.length; i++) {
        const r = evaluated[i];
        const tab = tabs[i];
        const effectiveUrl = (r?.url || tab?.url || '').toLowerCase();
        const effectivePath = (r?.path || '').toLowerCase();

        if (effectiveUrl.includes('usergrowth.com.cn')) {
            stagePage = true;
        }

        if (effectiveUrl.includes('changdupingtai.com') || tab?.title?.includes('常读')) {
            const app = r?.app || (tab?.title?.includes('付费') ? 'paid' : tab?.title?.includes('免费') ? 'free' : 'unknown');
            const pageType = r?.pageType || (effectivePath.includes('/promotion-list') ? 'promotion' : effectivePath.includes('/list') ? 'list' : 'unknown');

            if (app === 'free' && pageType === 'list') freeList = true;
        }
    }

    const missingPages: string[] = [];
    if (requiresFreeList && !freeList) missingPages.push('常读 - 免费漫剧列表');
    if (!stagePage) missingPages.push('一站式搭剧平台');

    return {
        cdpConnected: true,
        browserFound: Boolean(browser),
        browserName: browser ? browser.name : 'Edge',
        browserPath: browser ? browser.path : null,
        tabs,
        topology: {
            freeList,
            stagePage,
        },
        requiresFreeList,
        missingPages,
    };
}

export function launchBrowserWithCDP(port = CDP_PORT): { ok: boolean; message: string } {
    const browser = findBrowserExecutable();
    if (!browser) {
        return {
            ok: false,
            message: '未在系统中找到 Microsoft Edge 或 Google Chrome 浏览器。',
        };
    }

    try {
        const userDataDir = path.join(
            process.env.LOCALAPPDATA || path.join(PROJECT_DIR, 'data'),
            'EdgeDebug9224'
        );

        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }

        const args = [
            `--remote-debugging-port=${port}`,
            '--remote-allow-origins=*',
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,SleepingTabs',
            'about:blank',
        ];

        const child = spawn(browser.path, args, {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();

        return {
            ok: true,
            message: `已成功启动独立 ${browser.name} 调试窗口 (CDP 端口 ${port})！`,
        };
    } catch (err: any) {
        return {
            ok: false,
            message: `启动 ${browser.name} 失败: ${err.message}`,
        };
    }
}

export async function openTabViaCDP(url: string, port = CDP_PORT): Promise<boolean> {
    try {
        const encoded = encodeURIComponent(url);
        const res = await fetch(`http://127.0.0.1:${port}/json/new?${encoded}`, {
            method: 'PUT',
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch (_) {
        return false;
    }
}

export interface OpenStandardPagesResult {
    opened: number;
    requested: number;
    environment: EnvironmentStatus;
    missingPages: string[];
}

/**
 * Opens tabs only for missing topology roles and returns a fresh, verified
 * topology snapshot. Changdu's free/paid context is selected inside the
 * authenticated SPA, so opening a URL alone must never be reported as a
 * successful role assignment.
 */
export async function openStandardPages(portOrInput?: number | string[], maybePort?: number): Promise<OpenStandardPagesResult> {
    let port = CDP_PORT;
    let inputOverride: string[] | undefined;
    if (typeof portOrInput === 'number') {
        port = portOrInput;
    } else if (Array.isArray(portOrInput)) {
        inputOverride = portOrInput;
        if (typeof maybePort === 'number') port = maybePort;
    }
    const before = await checkEnvironment(inputOverride);
    let copyUrl = 'https://usergrowth.com.cn/';
    try {
        const urls = readCopyPageUrls();
        if (urls && urls.length > 0) {
            copyUrl = urls[0];
        }
    } catch (_) {}

    const standardUrls: string[] = [];
    if (before.requiresFreeList && !before.topology.freeList) standardUrls.push('https://changdupingtai.com/sale/comic/list');
    if (!before.topology.stagePage) standardUrls.push(copyUrl);

    let opened = 0;
    for (const url of standardUrls) {
        const ok = await openTabViaCDP(url, port);
        if (ok) opened++;
        await new Promise(r => setTimeout(r, 300));
    }

    const environment = await checkEnvironment(inputOverride);
    return {
        opened,
        requested: standardUrls.length,
        environment,
        missingPages: environment.missingPages,
    };
}
