// ============================================================
// Strong Locator Infrastructure
// Multi-Strategy Resilient Locators, Fallback Resolution & Self-Healing
// ============================================================

import { profiler } from './profiler.ts';
import { writeStructuredLog } from '../core/structured_log.ts';

export interface StrongLocatorDefinition {
    id: string;
    description: string;
    primary: string;
    fallbacks?: string[];
    role?: string;
    timeout?: number;
}

export interface ResolvedLocatorResult {
    locator: any;
    selectorUsed: string;
    isFallback: boolean;
    durationMs: number;
}

export interface ResilientClickOptions {
    timeout?: number;
    force?: boolean;
    jsFallback?: boolean;
    waitForNav?: boolean;
    category?: 'STAGE' | 'DOM';
}

export interface ResilientFillOptions {
    timeout?: number;
    verify?: boolean;
    blur?: boolean;
    clearFirst?: boolean;
    category?: 'STAGE' | 'DOM';
}

export class StrongLocator {
    /**
     * 解析定位器：先尝试 primary 选择器，若在限定时间内未命中或不可见，则按顺序尝试 fallbacks
     */
    public static async resolve(
        root: any,
        defOrSelector: StrongLocatorDefinition | string,
        options: { timeout?: number; visible?: boolean } = {}
    ): Promise<ResolvedLocatorResult> {
        const start = performance.now();
        const def: StrongLocatorDefinition = typeof defOrSelector === 'string'
            ? { id: defOrSelector, description: defOrSelector, primary: defOrSelector }
            : defOrSelector;

        const timeout = options.timeout ?? def.timeout ?? 3000;
        const checkVisible = options.visible ?? true;

        const candidates = [def.primary, ...(def.fallbacks || [])];
        const perCandidateTimeout = Math.max(300, Math.floor(timeout / candidates.length));

        for (let i = 0; i < candidates.length; i++) {
            const selector = candidates[i];
            const isFallback = i > 0;
            const locator = root.locator(selector);

            try {
                if (checkVisible) {
                    await locator.first().waitFor({
                        state: 'visible',
                        timeout: perCandidateTimeout,
                    });
                } else {
                    await locator.first().waitFor({
                        state: 'attached',
                        timeout: perCandidateTimeout,
                    });
                }

                const durationMs = Math.round((performance.now() - start) * 100) / 100;
                if (isFallback) {
                    console.warn(
                        `⚠️ [StrongLocator] 节点“${def.description}”主定位器 [${def.primary}] 未命中，` +
                        `命中备用定位器 [${selector}] (${durationMs}ms)`
                    );
                    writeStructuredLog('STRONG_LOCATOR_FALLBACK_HIT', {
                        locatorId: def.id,
                        primary: def.primary,
                        usedSelector: selector,
                        durationMs,
                    });
                }

                return {
                    locator: locator.first(),
                    selectorUsed: selector,
                    isFallback,
                    durationMs,
                };
            } catch (_) {
                // Try next fallback candidate
            }
        }

        // Final fallback: return primary locator handle even if timed out
        const durationMs = Math.round((performance.now() - start) * 100) / 100;
        return {
            locator: root.locator(def.primary).first(),
            selectorUsed: def.primary,
            isFallback: false,
            durationMs,
        };
    }

    /**
     * 等待定位器元素可见
     */
    public static async waitForVisible(
        root: any,
        defOrSelector: StrongLocatorDefinition | string,
        timeout = 5000
    ): Promise<boolean> {
        const id = typeof defOrSelector === 'string' ? defOrSelector : defOrSelector.id;
        const span = profiler.startSpan(`wait_visible:${id}`, 'DOM', { id, timeout });

        try {
            const def: StrongLocatorDefinition = typeof defOrSelector === 'string'
                ? { id: defOrSelector, description: defOrSelector, primary: defOrSelector }
                : defOrSelector;
            const candidates = [def.primary, ...(def.fallbacks || [])];
            const perCandidateTimeout = Math.max(300, Math.floor(timeout / candidates.length));
            let found = false;

            for (const selector of candidates) {
                try {
                    await root.locator(selector).first().waitFor({
                        state: 'visible',
                        timeout: perCandidateTimeout,
                    });
                    found = true;
                    break;
                } catch (_) {
                    // Try next fallback candidate
                }
            }

            span.end({ ok: found });
            return found;
        } catch (_) {
            span.end({ ok: false });
            return false;
        }
    }

    /**
     * 等待定位器元素隐藏 / 销毁
     */
    public static async waitForHidden(
        root: any,
        defOrSelector: StrongLocatorDefinition | string,
        timeout = 5000
    ): Promise<boolean> {
        const id = typeof defOrSelector === 'string' ? defOrSelector : defOrSelector.id;
        const span = profiler.startSpan(`wait_hidden:${id}`, 'DOM', { id, timeout });

        try {
            const def: StrongLocatorDefinition = typeof defOrSelector === 'string'
                ? { id: defOrSelector, description: defOrSelector, primary: defOrSelector }
                : defOrSelector;
            const selectors = [def.primary, ...(def.fallbacks || [])];

            for (const selector of selectors) {
                const locator = root.locator(selector).first();
                await locator.waitFor({ state: 'hidden', timeout });
            }
            span.end({ ok: true });
            return true;
        } catch (_) {
            span.end({ ok: false });
            return false;
        }
    }

    /**
     * 强健点击操作：支持 fallback、DOM 强制点击、JS click 兜底
     */
    public static async click(
        root: any,
        defOrSelector: StrongLocatorDefinition | string,
        options: ResilientClickOptions = {}
    ): Promise<void> {
        const id = typeof defOrSelector === 'string' ? defOrSelector : defOrSelector.id;
        const timeout = options.timeout ?? 5000;
        const jsFallback = options.jsFallback ?? true;

        const span = profiler.startSpan(`click:${id}`, options.category || 'DOM', { id, timeout });

        try {
            const { locator, selectorUsed } = await this.resolve(root, defOrSelector, { timeout, visible: true });
            span.checkpoint('locator_resolved');

            try {
                await locator.click({
                    timeout,
                    force: options.force ?? false,
                });
            } catch (clickError: any) {
                if (jsFallback) {
                    span.checkpoint('js_click_fallback');
                    const clicked = await locator.evaluate((element: HTMLElement) => {
                        const target = element.closest('button, [role="button"], a') as HTMLElement || element;
                        target.click();
                        return true;
                    }).catch(() => false);

                    if (!clicked) {
                        throw clickError;
                    }
                } else {
                    throw clickError;
                }
            }

            span.end({ ok: true, selectorUsed });
        } catch (error) {
            span.endWithError(error);
            throw error;
        }
    }

    /**
     * 强健填充输入框：支持真清空、值校验与 blur 触发事件
     */
    public static async fill(
        root: any,
        defOrSelector: StrongLocatorDefinition | string,
        value: string,
        options: ResilientFillOptions = {}
    ): Promise<void> {
        const id = typeof defOrSelector === 'string' ? defOrSelector : defOrSelector.id;
        const timeout = options.timeout ?? 5000;
        const verify = options.verify ?? true;
        const expected = String(value ?? '');

        const span = profiler.startSpan(`fill:${id}`, options.category || 'DOM', { id, expected, timeout });

        try {
            const { locator, selectorUsed } = await this.resolve(root, defOrSelector, { timeout, visible: true });
            span.checkpoint('locator_resolved');

            if (options.clearFirst) {
                await locator.fill('');
            }

            await locator.fill(expected);

            if (options.blur) {
                await locator.blur().catch(() => {});
            }

            if (verify) {
                span.checkpoint('verify_value');
                let actual = await locator.inputValue().catch(() => '');
                if (actual !== expected) {
                    // Retry with focus and fill
                    await locator.focus();
                    await locator.fill(expected);
                    actual = await locator.inputValue().catch(() => '');
                    if (actual !== expected) {
                        throw new Error(
                            `[StrongLocator] 字段“${id}”填入值未生效：期望 [${expected}]，实际 [${actual}]`
                        );
                    }
                }
            }

            span.end({ ok: true, selectorUsed });
        } catch (error) {
            span.endWithError(error);
            throw error;
        }
    }

    /**
     * 获取节点文本并做格式化
     */
    public static async getText(
        root: any,
        defOrSelector: StrongLocatorDefinition | string,
        options: { timeout?: number; trim?: boolean } = {}
    ): Promise<string> {
        const timeout = options.timeout ?? 3000;
        const trim = options.trim ?? true;

        const { locator } = await this.resolve(root, defOrSelector, { timeout, visible: false });
        const text = await locator.textContent().catch(() => '');
        return trim ? (text || '').trim() : (text || '');
    }

    /**
     * 获取输入框当前真实 value
     */
    public static async getValue(
        root: any,
        defOrSelector: StrongLocatorDefinition | string,
        options: { timeout?: number } = {}
    ): Promise<string> {
        const timeout = options.timeout ?? 3000;
        const { locator } = await this.resolve(root, defOrSelector, { timeout, visible: false });
        return (await locator.inputValue().catch(() => '')).trim();
    }

    /**
     * 在一组候选定位器中找到第一个可见并返回
     */
    public static async findFirstVisible(
        root: any,
        defs: Array<StrongLocatorDefinition | string>,
        timeout = 2000
    ): Promise<{ locator: any; index: number; matchedDef: StrongLocatorDefinition | string } | null> {
        const span = profiler.startSpan('find_first_visible', 'DOM', { candidateCount: defs.length });

        for (let i = 0; i < defs.length; i++) {
            const def = defs[i];
            const selector = typeof def === 'string' ? def : def.primary;
            const locator = root.locator(selector).first();
            const visible = await locator.isVisible({ timeout: Math.min(timeout, 300) }).catch(() => false);
            if (visible) {
                span.end({ found: true, index: i });
                return { locator, index: i, matchedDef: def };
            }
        }

        span.end({ found: false });
        return null;
    }

    /**
     * 等待 DOM 微任务彻底静止（基于 MutationObserver 与 requestIdleCallback）
     */
    public static async waitDOMSettled(
        rootOrPage: any,
        options: { quietMs?: number; timeoutMs?: number } = {}
    ): Promise<boolean> {
        const quietMs = options.quietMs ?? 60;
        const timeoutMs = options.timeoutMs ?? 2500;
        const span = profiler.startSpan('wait_dom_settled', 'DOM', { quietMs, timeoutMs });

        try {
            const page = typeof rootOrPage.evaluate === 'function' ? rootOrPage : (rootOrPage.page ? rootOrPage.page() : null);
            if (!page) {
                span.end({ ok: false, reason: 'no_page_handle' });
                return false;
            }

            await page.evaluate(
                ({ quiet, timeout }: { quiet: number; timeout: number }) => {
                    return new Promise<void>(resolve => {
                        let timer: any = null;
                        const deadline = setTimeout(() => {
                            observer.disconnect();
                            resolve();
                        }, timeout);

                        const observer = new MutationObserver(() => {
                            clearTimeout(timer);
                            timer = setTimeout(() => {
                                observer.disconnect();
                                clearTimeout(deadline);
                                if (typeof requestIdleCallback === 'function') {
                                    requestIdleCallback(() => resolve());
                                } else {
                                    resolve();
                                }
                            }, quiet);
                        });

                        observer.observe(document.body || document.documentElement, {
                            childList: true,
                            subtree: true,
                            attributes: true,
                        });

                        timer = setTimeout(() => {
                            observer.disconnect();
                            clearTimeout(deadline);
                            resolve();
                        }, quiet);
                    });
                },
                { quiet: quietMs, timeout: timeoutMs }
            );

            span.end({ ok: true });
            return true;
        } catch (_) {
            span.end({ ok: false });
            return false;
        }
    }
}
