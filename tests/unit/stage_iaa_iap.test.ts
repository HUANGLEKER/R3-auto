import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    STAGE_CONFIG_CONSTANTS,
    fillStageIaaConfig,
    fillStageIapConfig,
    fillStageIaaAndIapConfig,
    getSectionFormItem,
    getSectionSelectBox,
    getSectionTextInput,
    selectStageDropdownOptionByText,
    selectStageDropdownOptionByIndex,
    fillStageTextInput,
    findStageRetryElement,
    handleStageConfigRetry,
} from '../../src/platform/stage_iaa_iap.ts';
import { isPaidTemplateMatched } from '../../src/core/utils.ts';

describe('Unit: 搭剧 IAA 与 IAP 配置字段及规则', () => {
    test('配置常量正确包含目标小程序、渠道账号、推广链名称与充值模板', () => {
        assert.equal(STAGE_CONFIG_CONSTANTS.DEFAULT_APP, '默认应用');
        assert.equal(STAGE_CONFIG_CONSTANTS.DIRECTOR_ACCOUNT, '主管账号');
        assert.equal(STAGE_CONFIG_CONSTANTS.PROMOTION_LINK_NAME, '{剧集简称}{随机数}');
        assert.equal(STAGE_CONFIG_CONSTANTS.DEFAULT_PAID_TEMPLATE, '超超小额');
    });

    test('充值模板同构匹配规则：准确识别超超小额及其变体，不混淆超小额', () => {
        const target = STAGE_CONFIG_CONSTANTS.DEFAULT_PAID_TEMPLATE;
        assert.equal(isPaidTemplateMatched(target, '超超小额'), true);
        assert.equal(isPaidTemplateMatched(target, '超超小额（60集以上）'), true);
        assert.equal(isPaidTemplateMatched(target, '超超小额(30集-50集)'), true);
        assert.equal(isPaidTemplateMatched(target, '超超小额 (自定义)'), true);

        // 负例隔离
        assert.equal(isPaidTemplateMatched(target, '超小额'), false);
        assert.equal(isPaidTemplateMatched(target, '超小额（60集以上）'), false);
        assert.equal(isPaidTemplateMatched(target, '小额'), false);
        assert.equal(isPaidTemplateMatched(target, '中额'), false);
        assert.equal(isPaidTemplateMatched(target, ''), false);
    });

    test('模块函数导出完备', () => {
        assert.equal(typeof fillStageIaaConfig, 'function');
        assert.equal(typeof fillStageIapConfig, 'function');
        assert.equal(typeof fillStageIaaAndIapConfig, 'function');
        assert.equal(typeof getSectionFormItem, 'function');
        assert.equal(typeof getSectionSelectBox, 'function');
        assert.equal(typeof getSectionTextInput, 'function');
        assert.equal(typeof selectStageDropdownOptionByText, 'function');
        assert.equal(typeof selectStageDropdownOptionByIndex, 'function');
        assert.equal(typeof fillStageTextInput, 'function');
        assert.equal(typeof findStageRetryElement, 'function');
        assert.equal(typeof handleStageConfigRetry, 'function');
    });

    test('handleStageConfigRetry 在无重试元素时安全返回 false', async () => {
        const mockContainer = {
            locator: () => ({
                filter: () => ({
                    count: async () => 0,
                    nth: () => ({ isVisible: async () => false }),
                    first: () => ({ isVisible: async () => false }),
                }),
                first: () => ({ isVisible: async () => false }),
                count: async () => 0,
            }),
        };
        const result = await handleStageConfigRetry(null, mockContainer, '测试配置', 1);
        assert.equal(result, false);
    });

    test('handleStageConfigRetry 检测到重试按钮时能够自动点击并等待恢复', async () => {
        let clicked = false;
        let isPresent = true;

        const mockButton = {
            isVisible: async () => isPresent,
            scrollIntoViewIfNeeded: async () => {},
            click: async () => {
                clicked = true;
                isPresent = false;
            },
            evaluate: async () => {},
        };

        const mockContainer = {
            locator: (selector: string) => {
                if (selector.includes(':text-matches')) {
                    return {
                        count: async () => 0,
                        first: () => ({ isVisible: async () => false }),
                    };
                }
                return {
                    filter: () => ({
                        count: async () => isPresent ? 1 : 0,
                        nth: () => mockButton,
                        first: () => mockButton,
                    }),
                    count: async () => isPresent ? 1 : 0,
                };
            },
        };

        const result = await handleStageConfigRetry(null, mockContainer, 'IAP 小程序', 2);
        assert.equal(clicked, true, '应当已点击重试按钮');
        assert.equal(result, true, '应当成功恢复');
    });

    test('handleStageConfigRetry 默认支持无限次重试点击直到成功（突破旧3次上限）', async () => {
        let clickCount = 0;
        let isPresent = true;

        const mockButton = {
            isVisible: async () => isPresent,
            scrollIntoViewIfNeeded: async () => {},
            click: async () => {
                clickCount++;
                if (clickCount >= 5) {
                    isPresent = false;
                }
            },
            evaluate: async () => {},
        };

        const mockContainer = {
            locator: (selector: string) => {
                if (selector.includes(':text-matches')) {
                    return {
                        count: async () => 0,
                        first: () => ({ isVisible: async () => false }),
                    };
                }
                return {
                    filter: () => ({
                        count: async () => isPresent ? 1 : 0,
                        nth: () => mockButton,
                        first: () => mockButton,
                    }),
                    count: async () => isPresent ? 1 : 0,
                };
            },
        };

        const mockPage = {
            isClosed: () => false,
            waitForTimeout: async () => {},
            locator: () => ({
                last: () => ({
                    isVisible: async () => false,
                }),
                isVisible: async () => false,
                count: async () => 0,
            }),
        };

        const result = await handleStageConfigRetry(mockPage, mockContainer, 'IAA/IAP 配置');
        assert.equal(clickCount, 5, '应当持续重试点击直到第5次成功，突破原有的3次限制');
        assert.equal(result, true, '最终应当成功恢复');
    });

    test('selectStageDropdownOptionByIndex 选项不足 targetIndex 时抛出错误触发重试而非静默降级', async () => {
        const mockSelectBox = {
            locator: () => ({
                isVisible: async () => false,
                locator: () => ({
                    count: async () => 0,
                    first: () => ({ isVisible: async () => false }),
                }),
                first: () => ({ isVisible: async () => false }),
                count: async () => 0,
            }),
            scrollIntoViewIfNeeded: async () => {},
            click: async () => {},
        };

        const mockPage = {
            waitForTimeout: async () => {},
            waitForFunction: async () => true,
            locator: (selector: string) => ({
                count: async () => selector.includes('popup') ? 1 : 1,
                last: () => ({
                    isVisible: async () => false,
                    locator: () => ({
                        count: async () => 1, // 仅有 1 个选项 (index 0)
                        nth: () => ({}),
                    }),
                }),
                filter: () => ({ count: async () => 0 }),
            }),
            keyboard: { press: async () => {} },
        };

        // 期望选择第 2 个选项 (targetIndex = 1)，但只有 1 个选项
        await assert.rejects(
            selectStageDropdownOptionByIndex(mockPage, mockSelectBox, 1, 'IAA 起始解锁集数'),
            /搭剧“IAA 起始解锁集数”下拉框选项不足/
        );
    });
});
