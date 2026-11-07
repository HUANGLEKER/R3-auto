import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectStageAutoProductMatch, ensureStageAutoProductMatch } from '../../src/platform/stage_product_select.ts';

function createMockLocator(opts: {
    visible?: boolean;
    isChecked?: boolean;
    onClick?: () => void;
    onScroll?: () => void;
} = {}) {
    const isVisible = opts.visible ?? true;
    const isChecked = opts.isChecked ?? false;

    const loc: any = {
        isVisible: async () => isVisible,
        waitFor: async () => {
            if (!isVisible) throw new Error('Element not visible');
            return loc;
        },
        scrollIntoViewIfNeeded: async () => {
            opts.onScroll?.();
        },
        evaluate: async (fn: (node: any) => any) => {
            const fakeNode = {
                closest: () => ({
                    classList: { contains: (cls: string) => isChecked && cls.includes('checked') },
                    getAttribute: (attr: string) => (isChecked && attr === 'aria-checked' ? 'true' : null),
                    querySelector: () => (isChecked ? { checked: true } : null),
                }),
                classList: { contains: (cls: string) => isChecked && cls.includes('checked') },
                getAttribute: (attr: string) => (isChecked && attr === 'aria-checked' ? 'true' : null),
                querySelector: () => null,
            };
            return fn(fakeNode);
        },
        click: async () => {
            opts.onClick?.();
        },
        filter: () => loc,
        first: () => loc,
        locator: () => loc,
    };
    return loc;
}

test('ensureStageAutoProductMatch 是 selectStageAutoProductMatch 的别名', () => {
    assert.equal(typeof selectStageAutoProductMatch, 'function');
    assert.equal(selectStageAutoProductMatch, ensureStageAutoProductMatch);
});

test('selectStageAutoProductMatch 能够通过包含“商品匹配方式”的表单项精确定位并点击“自动匹配”', async () => {
    let clicked = false;
    let scrolled = false;
    const mockPage = {
        waitForTimeout: async () => {},
        evaluate: async () => {},
    };

    const targetRadio = createMockLocator({
        visible: true,
        isChecked: false,
        onClick: () => { clicked = true; },
        onScroll: () => { scrolled = true; },
    });

    const mockDialog = {
        locator: (selector: string) => {
            if (selector.includes('商品匹配方式')) {
                return targetRadio;
            }
            return createMockLocator({ visible: false });
        },
        evaluate: async () => false,
    };

    await selectStageAutoProductMatch(mockPage, mockDialog);
    assert.equal(clicked, true);
    assert.equal(scrolled, true);
});

test('selectStageAutoProductMatch 当“自动匹配”已被选中时正常点击确认并不报错', async () => {
    let clicked = false;
    const mockPage = {
        waitForTimeout: async () => {},
        evaluate: async () => {},
    };

    const targetRadio = createMockLocator({
        visible: true,
        isChecked: true,
        onClick: () => { clicked = true; },
    });

    const mockDialog = {
        locator: (selector: string) => {
            if (selector.includes('商品匹配方式')) {
                return targetRadio;
            }
            return createMockLocator({ visible: false });
        },
        evaluate: async () => false,
    };

    await selectStageAutoProductMatch(mockPage, mockDialog);
    assert.equal(clicked, true);
});

test('selectStageAutoProductMatch 在表单项未定位到时通过备选全局定位器点击', async () => {
    let fallbackClicked = false;
    const mockPage = {
        waitForTimeout: async () => {},
        evaluate: async () => {},
    };

    const fallbackRadio = createMockLocator({
        visible: true,
        isChecked: false,
        onClick: () => { fallbackClicked = true; },
    });

    const mockDialog = {
        locator: (selector: string) => {
            if (selector.includes('商品匹配方式')) {
                return createMockLocator({ visible: false });
            }
            if (selector.includes('自动匹配')) {
                return fallbackRadio;
            }
            return createMockLocator({ visible: false });
        },
        evaluate: async () => false,
    };

    await selectStageAutoProductMatch(mockPage, mockDialog);
    assert.equal(fallbackClicked, true);
});

test('selectStageAutoProductMatch 当定位器均不可见时通过 DOM evaluate 兜底点击', async () => {
    let domEvaluateCalled = false;
    let buttonClicked = false;
    const mockPage = {
        waitForTimeout: async () => {},
        evaluate: async () => {},
    };

    const mockDialog = {
        locator: () => createMockLocator({ visible: false }),
        evaluate: async (fn: (dialogEl: any) => boolean) => {
            domEvaluateCalled = true;
            const fakeDialog = {
                querySelectorAll: (sel: string) => {
                    if (sel.includes('arco-form-item')) {
                        return [{
                            querySelector: () => ({ textContent: '商品匹配方式 *' }),
                            querySelectorAll: () => [{
                                textContent: '自动匹配 ⓘ',
                                click: () => { buttonClicked = true; },
                            }],
                        }];
                    }
                    return [];
                },
            };
            return fn(fakeDialog);
        },
    };

    await selectStageAutoProductMatch(mockPage, mockDialog);
    assert.equal(domEvaluateCalled, true);
    assert.equal(buttonClicked, true);
});

test('selectStageAutoProductMatch 未能找到任何选项时抛出明确异常', async () => {
    const mockPage = {
        waitForTimeout: async () => {},
        evaluate: async () => {},
    };

    const mockDialog = {
        locator: () => createMockLocator({ visible: false }),
        evaluate: async () => false,
    };

    await assert.rejects(
        selectStageAutoProductMatch(mockPage, mockDialog, 100),
        /搭剧平台未找到“商品匹配方式 - 自动匹配”选项/
    );
});
