// ============================================================
// Unit Tests: Strong Locator (Multi-Strategy & Fallbacks)
// ============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StrongLocator } from '../../src/infra/locator.ts';
import type { StrongLocatorDefinition } from '../../src/infra/locator.ts';

describe('Strong Locator: 多候选定位与容错机制', () => {
    test('resolve 优先命中主定位器 (Primary Selector)', async () => {
        const mockRoot = {
            locator: (selector: string) => ({
                first: () => ({
                    waitFor: async () => true,
                    selector,
                }),
            }),
        };

        const def: StrongLocatorDefinition = {
            id: 'test_btn',
            description: '测试按钮',
            primary: 'button.primary-btn',
            fallbacks: ['button.fallback-btn', 'button[role="button"]'],
        };

        const result = await StrongLocator.resolve(mockRoot, def, { timeout: 100 });
        assert.equal(result.isFallback, false);
        assert.equal(result.selectorUsed, 'button.primary-btn');
    });

    test('resolve 主定位器失败时自动降级到候选定位器 (Fallback)', async () => {
        const mockRoot = {
            locator: (selector: string) => ({
                first: () => ({
                    waitFor: async () => {
                        if (selector === 'button.primary-btn') {
                            throw new Error('Primary not found');
                        }
                        return true;
                    },
                    selector,
                }),
            }),
        };

        const def: StrongLocatorDefinition = {
            id: 'test_btn',
            description: '测试按钮',
            primary: 'button.primary-btn',
            fallbacks: ['button.fallback-btn', 'button[role="button"]'],
        };

        const result = await StrongLocator.resolve(mockRoot, def, { timeout: 100 });
        assert.equal(result.isFallback, true);
        assert.equal(result.selectorUsed, 'button.fallback-btn');
    });

    test('fill 强健写入支持真实值校验', async () => {
        let internalValue = '';
        const mockRoot = {
            locator: (selector: string) => ({
                first: () => ({
                    waitFor: async () => true,
                    fill: async (val: string) => { internalValue = val; },
                    inputValue: async () => internalValue,
                    blur: async () => {},
                }),
            }),
        };

        await StrongLocator.fill(mockRoot, 'input#roi', '1.05', { verify: true });
        assert.equal(internalValue, '1.05');
    });
});
