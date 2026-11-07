import { UNIFIED, STAGE_SELECTORS } from '../core/config.ts';
import { DAILY_BUDGET_MIN, DAILY_BUDGET_MAX } from '../core/validation.ts';
import { profiler } from '../infra/profiler.ts';
import { waitStageSubmitResult, dismissStagePageToasts } from './stage_save.ts';
import { waitStageOverlayHidden, discardStageDialog } from './stage_dialog.ts';
import { lockPageActive } from './cdp.ts';

/**
 * 构建任务名称：用户前端指定内容 + '-' + 自增序号 (序号从 1 开始)
 */
export function buildStageTaskName(prefix: string, sequenceNumber: number): string {
    const trimmed = String(prefix || '').trim().replace(/-+$/, '');
    if (!trimmed) {
        return '';
    }
    if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
        throw new Error(`任务自增序号无效: ${sequenceNumber}（必须为 >= 1 的整数）`);
    }
    return `${trimmed}-${sequenceNumber}`;
}

/**
 * 打开“任务基本配置”弹窗
 */
export async function openStageBasicConfigDialog(page: any): Promise<any> {
    const span = profiler.startSpan('stage.open_basic_config', 'STAGE');
    await dismissStagePageToasts(page);

    const dialog = page
        .locator(STAGE_SELECTORS.dialog)
        .filter({ hasText: /任务基本配置|任务名称/ })
        .filter({ hasNotText: '内容名称' })
        .first();

    if (await dialog.isVisible({ timeout: 300 }).catch(() => false)) {
        span.end({ ok: true, source: 'ALREADY_OPEN' });
        return dialog;
    }

    // 1. 优先通过 #sub-micro-container 下的第 1 列（任务基本配置）卡片定位编辑按钮
    const candidateButtons = [
        page.locator(STAGE_SELECTORS.basicConfigEditBtn).first(),
        page.locator('#sub-micro-container form > div > div > div > div:nth-child(1) button:has(.arco-icon-edit)').first(),
        page.locator('#sub-micro-container form > div > div > div > div:nth-child(1) .arco-icon-edit').first(),
    ];

    let clicked = false;
    for (const btn of candidateButtons) {
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click({ force: true, timeout: UNIFIED.STAGE_ACTION_TIMEOUT });
            clicked = true;
            break;
        }
    }

    // 2. 若结构化选择器未命中，通过 DOM 树查找“任务基本配置”标题所在卡片顶部的编辑图标
    if (!clicked) {
        const evalClicked = await page.evaluate(() => {
            const clean = (s: string) => s.replace(/\s+/g, '');
            const allElements = Array.from(document.querySelectorAll('#sub-micro-container *, body *'));
            const headerCandidates = allElements.filter(el => {
                const text = clean(el.textContent || '');
                return text === '1任务基本配置' || text === '任务基本配置';
            });
            headerCandidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

            for (const header of headerCandidates) {
                let container: HTMLElement | null = header as HTMLElement;
                for (let depth = 0; depth < 5 && container; depth++) {
                    const editIcon = container.querySelector('.arco-icon-edit');
                    if (editIcon) {
                        const btn = (editIcon.closest('button, [role="button"], a') || editIcon) as HTMLElement;
                        const rect = btn.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            btn.click();
                            return true;
                        }
                    }
                    container = container.parentElement;
                }
            }
            return false;
        }).catch(() => false);

        if (!evalClicked) {
            const error = new Error('搭剧平台未找到“任务基本配置”编辑入口');
            span.endWithError(error);
            throw error;
        }
    }

    await dialog.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
    });

    span.end({ ok: true });
    return dialog;
}

/**
 * 在“任务基本配置”弹窗中定位“任务名称”输入框
 */
export async function getStageTaskNameInput(
    _page: any,
    dialog: any,
    timeout = UNIFIED.STAGE_LOAD_TIMEOUT
): Promise<any> {
    const span = profiler.startSpan('stage.get_task_name_input', 'STAGE');

    // 1. 通过 evaluate 在弹窗内找到 label 为“任务名称”的 form-item 下的真实输入框
    const formItemIndex = await dialog.evaluate((dialogEl: HTMLElement) => {
        const items = Array.from(dialogEl.querySelectorAll('.arco-form-item, [class*="form-item"]'));
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const labelEl = item.querySelector('label, .arco-form-item-label, [class*="label"]');
            const labelText = labelEl ? (labelEl.textContent || '').replace(/[\s*：:]/g, '') : '';
            if (labelText === '任务名称' || labelText.includes('任务名称')) {
                const inputEl = item.querySelector('input:not([type="hidden"]):not(.arco-select-view-input):not([tabindex="-1"]), textarea');
                if (inputEl) {
                    return i;
                }
            }
        }
        return -1;
    }).catch(() => -1);

    if (formItemIndex >= 0) {
        const item = dialog.locator('.arco-form-item, [class*="form-item"]').nth(formItemIndex);
        const input = item.locator('input:not([type="hidden"]):not(.arco-select-view-input):not([tabindex="-1"]), textarea').first();
        if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
            span.end({ ok: true, source: 'evaluate_form_item' });
            return input;
        }
    }

    // 2. 备选强定位器
    const candidateLocators = [
        dialog.locator('.arco-form-item:has(label:text-matches("^\\\\s*任务名称\\\\s*\\\\*?\\\\s*$")) input:not([type="hidden"]), .arco-form-item:has(label:text-matches("^\\\\s*任务名称\\\\s*\\\\*?\\\\s*$")) textarea').first(),
        dialog.locator('.arco-form-item:has(label:has-text("任务名称")) input:not([type="hidden"]):not(.arco-select-view-input)').first(),
        dialog.locator('input[placeholder*="任务名称"], input[id*="task_name"], input[name*="task_name"]').first(),
    ];

    for (const loc of candidateLocators) {
        if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
            span.end({ ok: true, source: 'candidate_locator' });
            return loc;
        }
    }

    try {
        const input = await Promise.any(
            candidateLocators.map(async loc => {
                await loc.waitFor({ state: 'visible', timeout });
                return loc;
            })
        );
        span.end({ ok: true });
        return input;
    } catch (_) {
        const error = new Error('搭剧平台“任务基本配置”中未找到“任务名称”输入框');
        span.endWithError(error);
        throw error;
    }
}

/**
 * 流程1：进入“任务基本配置”填写任务名称（前缀-自增序号），并点击确定
 */
export async function fillStageBasicTaskName(
    page: any,
    taskNamePrefix: string,
    sequenceNumber: number,
    signal?: AbortSignal
): Promise<string> {
    const prefix = String(taskNamePrefix || '').trim();
    if (!prefix) {
        return '';
    }
    signal?.throwIfAborted();

    const fullTaskName = buildStageTaskName(prefix, sequenceNumber);
    const span = profiler.startSpan('stage.fill_basic_task_name', 'STAGE', {
        taskNamePrefix: prefix,
        sequenceNumber,
        fullTaskName,
    });

    await lockPageActive(page).catch(() => {});
    console.log(`📝 搭剧流程1: 进入【任务基本配置】填写任务名称 -> ${fullTaskName}`);

    const dialog = await openStageBasicConfigDialog(page);
    const input = await getStageTaskNameInput(page, dialog);

    await input.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });
    await input.scrollIntoViewIfNeeded().catch(() => {});

    let actual = (await input.inputValue().catch(() => '')).trim();
    if (actual !== fullTaskName) {
        await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
        await page.keyboard?.press('Control+A').catch(() => {});
        await page.keyboard?.press('Backspace').catch(() => {});
        await input.fill(fullTaskName).catch(() => {});
        await input.blur().catch(() => {});
        await (page.waitForTimeout ? page.waitForTimeout(100) : new Promise(r => setTimeout(r, 100)));

        actual = (await input.inputValue().catch(() => '')).trim();

        if (actual !== fullTaskName) {
            await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
            await page.keyboard?.press('Control+A').catch(() => {});
            await page.keyboard?.press('Backspace').catch(() => {});
            await page.keyboard?.type(fullTaskName, { delay: 20 }).catch(() => {});
            await input.blur().catch(() => {});
            await (page.waitForTimeout ? page.waitForTimeout(150) : new Promise(r => setTimeout(r, 150)));
            actual = (await input.inputValue().catch(() => '')).trim();
        }

        if (actual !== fullTaskName) {
            await input.evaluate((el: HTMLInputElement | HTMLTextAreaElement, val: string) => {
                const proto = el instanceof HTMLTextAreaElement
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (nativeSetter) {
                    nativeSetter.call(el, val);
                } else {
                    el.value = val;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            }, fullTaskName).catch(() => {});
            await (page.waitForTimeout ? page.waitForTimeout(150) : new Promise(r => setTimeout(r, 150)));
            actual = (await input.inputValue().catch(() => '')).trim();
        }

        if (actual !== fullTaskName) {
            const error = new Error(`搭剧“任务名称”填写后值不一致: 期望="${fullTaskName}", 实际="${actual}"`);
            span.endWithError(error);
            throw error;
        }
    }

    signal?.throwIfAborted();
    const okBtn = dialog.locator(STAGE_SELECTORS.okBtn).first();
    await okBtn.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });

    await waitStageSubmitResult(page, dialog, {
        submit: () => okBtn.click(),
        context: { subtaskIndex: 0, douyinId: `basic_config_${sequenceNumber}` },
    });

    await waitStageOverlayHidden(page).catch(() => {});
    console.log(`✅ 搭剧流程1: 任务基本配置“任务名称”已保存为 ${fullTaskName}`);
    span.end({ ok: true, fullTaskName });
    return fullTaskName;
}

/**
 * 打开“项目统一配置”弹窗
 */
export async function openStageUnifiedConfigDialog(page: any): Promise<any> {
    const span = profiler.startSpan('stage.open_unified_config', 'STAGE');
    await dismissStagePageToasts(page);

    const dialog = page
        .locator(STAGE_SELECTORS.dialog)
        .filter({ hasText: /项目统一配置|项目日预算/ })
        .filter({ hasNotText: '内容名称' })
        .first();

    if (await dialog.isVisible({ timeout: 300 }).catch(() => false)) {
        span.end({ ok: true, source: 'ALREADY_OPEN' });
        return dialog;
    }

    // 1. 优先通过 #sub-micro-container 下的第 3 列（项目统一配置）卡片定位编辑按钮
    const candidateButtons = [
        page.locator(STAGE_SELECTORS.unifiedConfigEditBtn).first(),
        page.locator('#sub-micro-container form > div > div > div > div:nth-child(3) button:has(.arco-icon-edit)').first(),
        page.locator('#sub-micro-container form > div > div > div > div:nth-child(3) .arco-icon-edit').first(),
    ];

    let clicked = false;
    for (const btn of candidateButtons) {
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click({ force: true, timeout: UNIFIED.STAGE_ACTION_TIMEOUT });
            clicked = true;
            break;
        }
    }

    // 2. 若结构化选择器未命中，通过 DOM 树查找“项目统一配置”标题所在卡片顶部的编辑图标
    if (!clicked) {
        const evalClicked = await page.evaluate(() => {
            const clean = (s: string) => s.replace(/\s+/g, '');
            const allElements = Array.from(document.querySelectorAll('#sub-micro-container *, body *'));
            const headerCandidates = allElements.filter(el => {
                const text = clean(el.textContent || '');
                return text === '3项目统一配置' || text === '项目统一配置';
            });
            headerCandidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

            for (const header of headerCandidates) {
                let container: HTMLElement | null = header as HTMLElement;
                for (let depth = 0; depth < 5 && container; depth++) {
                    const editIcon = container.querySelector('.arco-icon-edit');
                    if (editIcon) {
                        const btn = (editIcon.closest('button, [role="button"], a') || editIcon) as HTMLElement;
                        const rect = btn.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            btn.click();
                            return true;
                        }
                    }
                    container = container.parentElement;
                }
            }
            return false;
        }).catch(() => false);

        if (!evalClicked) {
            const error = new Error('搭剧平台未找到“项目统一配置”编辑入口');
            span.endWithError(error);
            throw error;
        }
    }

    await dialog.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
    });

    span.end({ ok: true });
    return dialog;
}

/**
 * 在“项目统一配置”弹窗中定位“项目日预算”输入框
 */
export async function getStageDailyBudgetInput(
    _page: any,
    dialog: any,
    timeout = UNIFIED.STAGE_LOAD_TIMEOUT
): Promise<any> {
    const span = profiler.startSpan('stage.get_daily_budget_input', 'STAGE');

    // 1. 通过 evaluate 在弹窗内找到 label 为“项目日预算”的 form-item 下的真实输入框
    const formItemIndex = await dialog.evaluate((dialogEl: HTMLElement) => {
        const items = Array.from(dialogEl.querySelectorAll('.arco-form-item, [class*="form-item"]'));
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const labelEl = item.querySelector('label, .arco-form-item-label, [class*="label"]');
            const labelText = labelEl ? (labelEl.textContent || '').replace(/[\s*：:]/g, '') : '';
            if (labelText === '项目日预算' || labelText.includes('项目日预算') || labelText === '日预算') {
                const inputEl = item.querySelector('input:not([type="hidden"]):not(.arco-select-view-input):not([tabindex="-1"])');
                if (inputEl) {
                    return i;
                }
            }
        }
        return -1;
    }).catch(() => -1);

    if (formItemIndex >= 0) {
        const item = dialog.locator('.arco-form-item, [class*="form-item"]').nth(formItemIndex);
        const input = item.locator('input:not([type="hidden"]):not(.arco-select-view-input):not([tabindex="-1"])').first();
        if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
            span.end({ ok: true, source: 'evaluate_form_item' });
            return input;
        }
    }

    // 2. 备选强定位器
    const candidateLocators = [
        dialog.locator('.arco-form-item:has(label:text-matches("^\\\\s*项目日预算\\\\s*\\\\*?\\\\s*$")) input:not([type="hidden"]):not(.arco-select-view-input)').first(),
        dialog.locator('.arco-form-item:has(label:has-text("项目日预算")) input:not([type="hidden"]):not(.arco-select-view-input)').first(),
        dialog.locator('input[placeholder*="日预算"], input[id*="budget"], input[name*="budget"]').first(),
    ];

    for (const loc of candidateLocators) {
        if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
            span.end({ ok: true, source: 'candidate_locator' });
            return loc;
        }
    }

    try {
        const input = await Promise.any(
            candidateLocators.map(async loc => {
                await loc.waitFor({ state: 'visible', timeout });
                return loc;
            })
        );
        span.end({ ok: true });
        return input;
    } catch (_) {
        const error = new Error('搭剧平台“项目统一配置”中未找到“项目日预算”输入框');
        span.endWithError(error);
        throw error;
    }
}

export function isBudgetMatch(actual: string, expected: string): boolean {
    const cleanAct = String(actual || '').replace(/[,，\s元¥￥]/g, '').trim();
    const cleanExp = String(expected || '').replace(/[,，\s元¥￥]/g, '').trim();
    if (!cleanAct || !cleanExp) return false;
    if (cleanAct === cleanExp) return true;
    const numAct = Number(cleanAct);
    const numExp = Number(cleanExp);
    if (Number.isFinite(numAct) && Number.isFinite(numExp) && Math.abs(numAct - numExp) < 0.001) {
        return true;
    }
    return false;
}

/**
 * 流程2：所有子任务剧搭完后，进入“项目统一配置”填写项目日预算，并点击确定
 */
export async function fillStageUnifiedDailyBudget(
    page: any,
    dailyBudget: string,
    signal?: AbortSignal
): Promise<void> {
    const expected = String(dailyBudget || '').trim();
    if (!expected) {
        return;
    }
    if (
        !/^\d+(?:\.\d{1,2})?$/.test(expected) ||
        !Number.isFinite(Number(expected)) ||
        Number(expected) < DAILY_BUDGET_MIN ||
        Number(expected) > DAILY_BUDGET_MAX
    ) {
        throw new Error(`项目日预算无效: ${expected}（必须为 ${DAILY_BUDGET_MIN} ~ ${DAILY_BUDGET_MAX} 之间的有效金额，仅限 0-9 数字和 .）`);
    }
    signal?.throwIfAborted();

    const span = profiler.startSpan('stage.fill_unified_daily_budget', 'STAGE', { dailyBudget: expected });
    await lockPageActive(page).catch(() => {});
    console.log(`💰 搭剧流程2: 进入【项目统一配置】填写项目日预算 -> ${expected} 元`);

    const dialog = await openStageUnifiedConfigDialog(page);
    const input = await getStageDailyBudgetInput(page, dialog);

    await input.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });
    await input.scrollIntoViewIfNeeded().catch(() => {});

    let actual = (await input.inputValue().catch(() => '')).trim();
    if (!isBudgetMatch(actual, expected)) {
        await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
        await page.keyboard?.press('Control+A').catch(() => {});
        await page.keyboard?.press('Backspace').catch(() => {});
        await input.fill(expected).catch(() => {});
        await input.blur().catch(() => {});
        await (page.waitForTimeout ? page.waitForTimeout(100) : new Promise(r => setTimeout(r, 100)));

        actual = (await input.inputValue().catch(() => '')).trim();

        if (!isBudgetMatch(actual, expected)) {
            await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
            await page.keyboard?.press('Control+A').catch(() => {});
            await page.keyboard?.press('Backspace').catch(() => {});
            await page.keyboard?.type(expected, { delay: 20 }).catch(() => {});
            await input.blur().catch(() => {});
            await (page.waitForTimeout ? page.waitForTimeout(150) : new Promise(r => setTimeout(r, 150)));
            actual = (await input.inputValue().catch(() => '')).trim();
        }

        if (!isBudgetMatch(actual, expected)) {
            await input.evaluate((el: HTMLInputElement, val: string) => {
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )?.set;
                if (nativeSetter) {
                    nativeSetter.call(el, val);
                } else {
                    el.value = val;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            }, expected).catch(() => {});
            await (page.waitForTimeout ? page.waitForTimeout(150) : new Promise(r => setTimeout(r, 150)));
            actual = (await input.inputValue().catch(() => '')).trim();
        }

        if (!isBudgetMatch(actual, expected)) {
            const error = new Error(`搭剧“项目日预算”填写后值不一致: 期望=${expected}, 实际=${actual}`);
            span.endWithError(error);
            throw error;
        }
    } else {
        console.log(`   “项目日预算”已为目标值: ${actual}`);
    }

    signal?.throwIfAborted();
    const okBtn = dialog.locator(STAGE_SELECTORS.okBtn).first();
    await okBtn.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });

    await waitStageSubmitResult(page, dialog, {
        submit: () => okBtn.click(),
        context: { subtaskIndex: 0, douyinId: 'unified_config_budget' },
    });

    await waitStageOverlayHidden(page).catch(() => {});
    console.log(`✅ 搭剧流程2: 项目统一配置“项目日预算”已保存为 ${actual} 元`);
    span.end({ ok: true, actual, expected });
}
