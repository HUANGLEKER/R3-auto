// ============================================================
// Field Map Infrastructure
// Centralized UI Element Schemas, Entity Mapping & Form Abstractions
// ============================================================

import { StrongLocator, type StrongLocatorDefinition } from './locator.ts';
import { STAGE_SELECTORS } from '../core/config.ts';

export type PlatformType = 'stage';
export type FieldType = 'input' | 'select' | 'button' | 'radio' | 'text' | 'container' | 'dialog';

export interface FieldDefinition<T = string> {
    id: string;
    label: string;
    platform: PlatformType;
    type: FieldType;
    locator: StrongLocatorDefinition;
    required?: boolean;
    extractor?: (val: string) => T;
    formatter?: (val: T) => string;
    validator?: (val: T) => boolean;
}

// ------------------------------------------------------------
// 1. 搭剧平台 (Stage) Field Map
// ------------------------------------------------------------
export const STAGE_FIELDS = {
    subtaskContainerBase: {
        id: 'stage.subtask_container_base',
        label: '子任务容器基础节点',
        platform: 'stage',
        type: 'container',
        locator: {
            id: 'stage.subtask_container_base',
            description: '子任务容器基础定位器',
            primary: STAGE_SELECTORS.subtaskContainerBase,
            fallbacks: [
                '#sub-micro-container [class*="box-card-content-"] > div > div',
                '#sub-micro-container form > div > div > div > div:nth-child(2) > div > div > div',
            ],
        },
    } as FieldDefinition,

    editIcon: {
        id: 'stage.edit_icon',
        label: '子任务编辑入口',
        platform: 'stage',
        type: 'button',
        locator: {
            id: 'stage.edit_icon',
            description: '子任务编辑图标',
            primary: STAGE_SELECTORS.editIcon,
            fallbacks: [
                '.arco-icon-edit',
                'button:has(.arco-icon-edit)',
                '[aria-label*="edit"]',
            ],
        },
    } as FieldDefinition,

    dialog: {
        id: 'stage.dialog',
        label: '搭剧编辑弹窗',
        platform: 'stage',
        type: 'dialog',
        locator: {
            id: 'stage.dialog',
            description: '搭剧编辑弹窗容器',
            primary: STAGE_SELECTORS.dialog,
            fallbacks: [
                '.arco-modal:visible',
                '.arco-drawer:visible',
                '[role="dialog"]:visible',
            ],
        },
    } as FieldDefinition,

    contentNameDropdown: {
        id: 'stage.content_name_dropdown',
        label: '内容名称下拉框',
        platform: 'stage',
        type: 'select',
        locator: {
            id: 'stage.content_name_dropdown',
            description: '内容名称下拉触发容器',
            primary: STAGE_SELECTORS.contentNameDropdown,
            fallbacks: [
                '#product_info_book_info_book_id_input',
                '[id*="book_id_input"]',
                '.arco-select:has(input[placeholder*="内容"])',
            ],
        },
    } as FieldDefinition,

    clearSearchIcon: {
        id: 'stage.clear_search_icon',
        label: '内容名称清空图标',
        platform: 'stage',
        type: 'button',
        locator: {
            id: 'stage.clear_search_icon',
            description: '下拉搜索框清空图标',
            primary: '.arco-select-clear-icon',
            fallbacks: ['[class*="select-clear"]', '.arco-icon-close-circle'],
        },
    } as FieldDefinition,

    autoMatchRadio: {
        id: 'stage.auto_match_radio',
        label: '自动匹配单选按钮',
        platform: 'stage',
        type: 'radio',
        locator: {
            id: 'stage.auto_match_radio',
            description: '自动匹配 Radio 选项',
            primary: STAGE_SELECTORS.autoMatchRadio,
            fallbacks: [
                '.arco-form-item:has(label:has-text("商品匹配方式")) .arco-radio-button:has-text("自动匹配")',
                '.arco-radio-button:has-text("自动匹配")',
                'label:has-text("自动匹配")',
                '[role="radio"]:has-text("自动匹配")',
            ],
        },
    } as FieldDefinition,

    customMatchRadio: {
        id: 'stage.custom_match_radio',
        label: '自定义指定单选按钮',
        platform: 'stage',
        type: 'radio',
        locator: {
            id: 'stage.custom_match_radio',
            description: '自定义指定 Radio 选项',
            primary: '.arco-radio-button:has-text("自定义指定")',
            fallbacks: [
                'label:has-text("自定义指定")',
                '[role="radio"]:has-text("自定义指定")',
            ],
        },
    } as FieldDefinition,

    productDropdown: {
        id: 'stage.product_dropdown',
        label: '商品选择下拉框',
        platform: 'stage',
        type: 'select',
        locator: {
            id: 'stage.product_dropdown',
            description: '商品下拉选择框（严格排除商品库）',
            primary: '.arco-form-item:has(label:text-is("商品 *")) .arco-select-view, .arco-form-item:has(label:text-is("商品")) .arco-select-view',
            fallbacks: [
                '.arco-form-item:has(label:has-text("商品")):not(:has(label:has-text("商品库"))):not(:has(label:has-text("关联商品"))):not(:has(label:has-text("匹配方式"))) .arco-select-view',
                '[id*="product_id"] .arco-select-view',
            ],
        },
    } as FieldDefinition,

    roiRatioInput: {
        id: 'stage.roi_ratio_input',
        label: '全域ROI系数输入框',
        platform: 'stage',
        type: 'input',
        locator: {
            id: 'stage.roi_ratio_input',
            description: '全域ROI系数输入框（严格区分于出价方式下拉框）',
            primary: 'input#bid_info_omni_roi_coefficient_input',
            fallbacks: [
                'input[id*="omni_roi_coefficient"], input[id*="roi_coefficient"], input[id*="roi_ratio"]',
                'input[placeholder*="全域ROI系数"], input[placeholder*="ROI系数"]',
                '.arco-form-item:has(label:has-text("全域ROI系数")):not(:has(.arco-select)) input:not([type="hidden"]):not(.arco-select-view-input)',
                'label:has-text("全域ROI系数") + * input:not(.arco-select-view-input)',
            ],
        },
    } as FieldDefinition,

    okBtn: {
        id: 'stage.ok_button',
        label: '确定提交按钮',
        platform: 'stage',
        type: 'button',
        locator: {
            id: 'stage.ok_button',
            description: '弹窗保存确定按钮',
            primary: STAGE_SELECTORS.okBtn,
            fallbacks: [
                'button:has-text("确定")',
                'button.arco-btn-primary:has-text("确定")',
                '[role="dialog"] button.arco-btn-primary',
            ],
        },
    } as FieldDefinition,

    cancelBtn: {
        id: 'stage.cancel_button',
        label: '取消修改按钮',
        platform: 'stage',
        type: 'button',
        locator: {
            id: 'stage.cancel_button',
            description: '弹窗取消按钮',
            primary: STAGE_SELECTORS.cancelBtn,
            fallbacks: [
                'button:has-text("取消")',
                'button.arco-btn-secondary:has-text("取消")',
                '[role="dialog"] button:has-text("取消")',
            ],
        },
    } as FieldDefinition,

    discardConfirmDialog: {
        id: 'stage.discard_confirm_dialog',
        label: '放弃修改确认弹窗',
        platform: 'stage',
        type: 'dialog',
        locator: {
            id: 'stage.discard_confirm_dialog',
            description: '关闭后不会保存确认弹窗',
            primary: '.arco-modal:has-text("关闭后不会保存")',
            fallbacks: [
                '[role="dialog"]:has-text("是否关闭")',
                '.arco-modal-wrapper:has-text("不会保存")',
            ],
        },
    } as FieldDefinition,
} as const;

// ------------------------------------------------------------
// 2. Field Map 操作执行器 (FieldMap Agent)
// ------------------------------------------------------------
export class FieldMap {
    public static async get<T = string>(
        root: any,
        field: FieldDefinition<T>,
        options: { timeout?: number } = {}
    ): Promise<T> {
        const raw = await StrongLocator.getValue(root, field.locator, options);
        if (field.extractor) {
            return field.extractor(raw);
        }
        return raw as unknown as T;
    }

    public static async set<T = string>(
        root: any,
        field: FieldDefinition<T>,
        value: T,
        options: { timeout?: number; verify?: boolean; blur?: boolean } = {}
    ): Promise<void> {
        const strVal = field.formatter ? field.formatter(value) : String(value ?? '');
        await StrongLocator.fill(root, field.locator, strVal, {
            timeout: options.timeout,
            verify: options.verify ?? true,
            blur: options.blur ?? true,
            category: field.platform === 'stage' ? 'STAGE' : 'DOM',
        });
    }

    public static async click(
        root: any,
        field: FieldDefinition,
        options: { timeout?: number; force?: boolean } = {}
    ): Promise<void> {
        await StrongLocator.click(root, field.locator, {
            timeout: options.timeout,
            force: options.force,
            category: field.platform === 'stage' ? 'STAGE' : 'DOM',
        });
    }

    public static async waitForVisible(
        root: any,
        field: FieldDefinition,
        timeout = 5000
    ): Promise<boolean> {
        return await StrongLocator.waitForVisible(root, field.locator, timeout);
    }

    public static async waitForHidden(
        root: any,
        field: FieldDefinition,
        timeout = 5000
    ): Promise<boolean> {
        return await StrongLocator.waitForHidden(root, field.locator, timeout);
    }
}
