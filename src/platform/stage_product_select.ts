import { UNIFIED } from '../core/config.ts';
import { profiler } from '../infra/profiler.ts';
import { dismissStagePageToasts } from './stage_save.ts';

export async function ensureStageCustomProductMatch(
    page: any,
    dialog: any
): Promise<void> {
    const customMatchRadio = dialog
        .locator('.arco-radio-button, [role="radio"], label, button')
        .filter({ hasText: /^自定义指定$/ })
        .first();

    if (await customMatchRadio.isVisible({ timeout: 400 }).catch(() => false)) {
        const isChecked = await customMatchRadio.evaluate((node: Element) => {
            return (
                node.classList.contains('arco-radio-checked') ||
                node.classList.contains('arco-radio-button-checked') ||
                node.getAttribute('aria-checked') === 'true' ||
                Boolean((node.querySelector('input[type="radio"]') as HTMLInputElement | null)?.checked)
            );
        }).catch(() => false);

        if (!isChecked) {
            console.log('   搭剧: 切换商品匹配方式为“自定义指定”');
            await customMatchRadio.click();
            await page.waitForTimeout(100);
        }
    }
}

export async function selectStageAutoProductMatch(
    page: any,
    dialog: any,
    timeout = UNIFIED.STAGE_ACTION_TIMEOUT
): Promise<void> {
    const span = profiler.startSpan('stage.select_auto_product_match', 'STAGE');
    console.log('   搭剧: 准备设置商品匹配方式为“自动匹配”');

    // 1. 优先在包含“商品匹配方式”的表单项内定位“自动匹配”单选按钮
    const scopedRadio = dialog.locator(
        '.arco-form-item:has(label:has-text("商品匹配方式")) .arco-radio-button, ' +
        '.arco-form-item:has(label:has-text("商品匹配方式")) [role="radio"], ' +
        '.arco-form-item:has(label:has-text("商品匹配方式")) label, ' +
        '.arco-form-item:has([class*="label"]:has-text("商品匹配方式")) .arco-radio-button, ' +
        '.arco-form-item:has([class*="label"]:has-text("商品匹配方式")) [role="radio"]'
    ).filter({ hasText: '自动匹配' }).first();

    // 2. 备选候选定位器列表
    const candidateLocators = [
        scopedRadio,
        dialog.locator('.arco-radio-button:has-text("自动匹配"), [role="radio"]:has-text("自动匹配")').first(),
        dialog.locator('.arco-radio-button, [role="radio"], label, button, .arco-radio').filter({ hasText: '自动匹配' }).first(),
        dialog.locator('label:has-text("自动匹配"), button:has-text("自动匹配")').first(),
    ];

    let targetRadio: any = null;
    for (const loc of candidateLocators) {
        if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
            targetRadio = loc;
            break;
        }
    }

    if (!targetRadio) {
        try {
            targetRadio = await Promise.any(
                candidateLocators.map(async loc => {
                    await loc.waitFor({ state: 'visible', timeout: Math.min(timeout, 5000) });
                    return loc;
                })
            );
        } catch (_) {
            // 尝试 DOM 探测与原生点击
            const clickedViaDom = await dialog.evaluate((dialogEl: HTMLElement) => {
                const items = Array.from(dialogEl.querySelectorAll('.arco-form-item, [class*="form-item"]'));
                for (const item of items) {
                    const labelEl = item.querySelector('label, [class*="label"], .arco-form-item-label');
                    const labelText = labelEl ? (labelEl.textContent || '').replace(/[\s*：:]/g, '') : '';
                    if (labelText.includes('商品匹配方式')) {
                        const candidates = Array.from(item.querySelectorAll('.arco-radio-button, .arco-radio, [role="radio"], label, button, span'));
                        for (const c of candidates) {
                            if ((c.textContent || '').includes('自动匹配')) {
                                (c as HTMLElement).click();
                                return true;
                            }
                        }
                    }
                }
                const allRadios = Array.from(dialogEl.querySelectorAll('.arco-radio-button, .arco-radio, [role="radio"], label, button'));
                for (const r of allRadios) {
                    if ((r.textContent || '').includes('自动匹配')) {
                        (r as HTMLElement).click();
                        return true;
                    }
                }
                return false;
            }).catch(() => false);

            if (!clickedViaDom) {
                const error = new Error('搭剧平台未找到“商品匹配方式 - 自动匹配”选项');
                span.endWithError(error);
                throw error;
            }

            console.log('     ✅ 已通过 DOM 触发点击商品匹配方式为“自动匹配”');
            if (page && typeof page.waitForTimeout === 'function') {
                await page.waitForTimeout(150);
            }
            await dismissStagePageToasts(page).catch(() => {});
            span.end({ ok: true, source: 'DOM_EVALUATE_CLICK' });
            return;
        }
    }

    if (typeof targetRadio.scrollIntoViewIfNeeded === 'function') {
        await targetRadio.scrollIntoViewIfNeeded().catch(() => {});
    }

    const isChecked = typeof targetRadio.evaluate === 'function' ? await targetRadio.evaluate((node: Element) => {
        const container = node.closest('.arco-radio, .arco-radio-button, [role="radio"]') || node;
        return (
            container.classList.contains('arco-radio-checked') ||
            container.classList.contains('arco-radio-button-checked') ||
            container.getAttribute('aria-checked') === 'true' ||
            Boolean((container.querySelector('input[type="radio"]') as HTMLInputElement | null)?.checked)
        );
    }).catch(() => false) : false;

    if (isChecked) {
        console.log('   搭剧: “商品匹配方式”当前已为“自动匹配”，点击确认');
    } else {
        console.log('   搭剧: 点击商品匹配方式为“自动匹配”');
    }

    await targetRadio.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(async () => {
        if (typeof targetRadio.evaluate === 'function') {
            await targetRadio.evaluate((el: HTMLElement) => el.click());
        }
    });

    if (page && typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(150);
    }
    await dismissStagePageToasts(page).catch(() => {});

    console.log('     ✅ 商品匹配方式已选择为“自动匹配”');
    span.end({ ok: true, previouslyChecked: isChecked });
}

export { selectStageAutoProductMatch as ensureStageAutoProductMatch };

export async function getStageProductSelectBox(
    _page: any,
    dialog: any
): Promise<any> {
    // 1. 在浏览器内部毫秒级定位“商品”表单项（严格排除“商品库”、“商品匹配方式”、“关联商品”）
    const formItemIndex = await dialog.evaluate((dialogEl: HTMLElement) => {
        const items = Array.from(dialogEl.querySelectorAll('.arco-form-item, [class*="form-item"]'));
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const labelEl = item.querySelector('label, [class*="label"], .arco-form-item-label');
            const labelText = labelEl ? (labelEl.textContent || '').replace(/[\s*：:]/g, '') : '';
            if (labelText === '商品') {
                return i;
            }
        }
        return -1;
    }).catch(() => -1);

    if (formItemIndex >= 0) {
        const item = dialog.locator('.arco-form-item, [class*="form-item"]').nth(formItemIndex);
        const selectView = item.locator('.arco-select-view, .arco-select, [role="combobox"]').first();
        if (await selectView.isVisible({ timeout: 500 }).catch(() => false)) {
            return selectView;
        }
    }

    // 2. 备选精准定位器
    const directLocators = [
        dialog.locator('.arco-form-item:has(label:text-is("商品 *")), .arco-form-item:has(label:text-is("商品"))').locator('.arco-select-view, .arco-select').first(),
        dialog.locator('.arco-select-view:has(input[placeholder*="请选择产品"]:not([placeholder*="库"]))').first(),
        dialog.locator('input[placeholder="请选择产品，仅支持ID搜索"], input[placeholder*="请选择产品"]:not([placeholder*="库"])').locator('xpath=ancestor::*[contains(@class,"arco-select-view") or contains(@class,"arco-select")][1]').first(),
    ];

    for (const loc of directLocators) {
        if (await loc.isVisible({ timeout: 300 }).catch(() => false)) {
            return loc;
        }
    }

    throw new Error('搭剧平台未找到“商品”下拉选择框（已严格排除“商品库”与“关联商品”）');
}

export async function getStageProductSearchInput(
    page: any,
    selectBox: any
): Promise<any> {
    let input = selectBox.locator('input:not([type="hidden"]), .arco-select-view-input').first();
    if (await input.isVisible({ timeout: 200 }).catch(() => false)) {
        return input;
    }

    await selectBox.click().catch(() => {});
    input = selectBox.locator('input:not([type="hidden"]), .arco-select-view-input').first();
    if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
        return input;
    }

    const popupInput = page.locator('.arco-select-popup input, .arco-trigger-popup input').first();
    if (await popupInput.isVisible({ timeout: 200 }).catch(() => false)) {
        return popupInput;
    }

    return input;
}

export async function clearStageProductSearch(
    page: any,
    selectBox: any
): Promise<any> {
    await selectBox.click().catch(() => {});

    const clearIcon = selectBox
        .locator('.arco-select-clear-icon, .arco-icon-close-circle')
        .first();

    if (await clearIcon.isVisible({ timeout: 200 }).catch(() => false)) {
        await clearIcon.click().catch(() => {});
    }

    const input = await getStageProductSearchInput(page, selectBox);
    await input.focus().catch(() => {});
    await input.fill('').catch(() => {});

    return input;
}

export async function selectStageProductById(
    page: any,
    dialog: any,
    douyinId: string,
    dramaName = ''
): Promise<boolean> {
    const span = profiler.startSpan('stage.select_product_by_id', 'STAGE', { douyinId, dramaName });
    const expectedId = String(douyinId || '').trim();

    if (!expectedId) {
        const error = new Error('选择商品时作品ID为空');
        span.endWithError(error);
        throw error;
    }

    // 确保“商品匹配方式”为“自定义指定”
    await ensureStageCustomProductMatch(page, dialog);
    await dismissStagePageToasts(page);

    const selectBox = await getStageProductSelectBox(page, dialog);
    await selectBox.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });

    // 如果已有值且包含当前作品ID或剧名，则已正确选中
    const currentVal = (await selectBox.innerText().catch(() => '')).trim();
    if (currentVal.includes(expectedId) || (dramaName && currentVal.includes(dramaName))) {
        console.log(`     “商品”已预选目标商品: ${currentVal}`);
        span.end({ ok: true, source: 'ALREADY_SELECTED' });
        return true;
    }

    const maxRetries = UNIFIED.STAGE_DRAMA_SEARCH_RETRY;

    for (let retry = 0; retry < maxRetries; retry++) {
        console.log(
            `     输入商品作品ID（第 ${retry + 1} 次）: ${expectedId}`
        );

        // 1. 点击 selectBox 打开下拉列表与激活搜索输入
        await selectBox.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
        await page.waitForTimeout(200);

        // 2. 清除并填入作品ID
        const clearIcon = selectBox.locator('.arco-select-clear-icon, .arco-icon-close-circle').first();
        if (await clearIcon.isVisible({ timeout: 200 }).catch(() => false)) {
            await clearIcon.click().catch(() => {});
            await page.waitForTimeout(100);
        }

        const searchInput = selectBox.locator('input:not([type="hidden"]), .arco-select-view-input').first();
        if (await searchInput.isVisible({ timeout: 200 }).catch(() => false)) {
            await searchInput.focus().catch(() => {});
            await searchInput.fill(expectedId).catch(() => {});
        } else {
            await page.keyboard.press('Control+A').catch(() => {});
            await page.keyboard.press('Backspace').catch(() => {});
            await page.keyboard.type(expectedId, { delay: 20 });
        }

        // 3. 等待下拉选项出现
        await page.waitForTimeout(400);

        const options = page.locator(
            'li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible'
        );

        // 最多等待 3.5 秒
        await page.waitForFunction(
            () => {
                const visible = (node: Element | null) => {
                    if (!node) return false;
                    const style = window.getComputedStyle(node);
                    const rect = node.getBoundingClientRect();
                    return (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        rect.width > 0 &&
                        rect.height > 0
                    );
                };

                const opts = Array.from(
                    document.querySelectorAll(
                        'li[role="option"], div[role="option"], .arco-select-option'
                    )
                ).filter(visible);

                return opts.length > 0;
            },
            null,
            { timeout: 3500 }
        ).catch(() => false);

        const optionCount = await options.count().catch(() => 0);
        console.log(`     商品候选列表数量: ${optionCount}`);

        if (optionCount === 0) {
            const hasLoadError = await page.locator('.arco-message-error, .arco-notification-error')
                .filter({ hasText: /服务端负载|ListProduct/ })
                .first().isVisible({ timeout: 150 }).catch(() => false);
            if (hasLoadError) {
                console.log('     ⚠️ 检测到平台商品接口服务端负载高，退避等待重试...');
                await page.waitForTimeout(1500);
                await dismissStagePageToasts(page);
            }
        }

        let targetOption: any = null;
        let targetText = '';

        for (let i = 0; i < optionCount; i++) {
            const candidate = options.nth(i);
            if (!await candidate.isVisible().catch(() => false)) {
                continue;
            }

            const text = (await candidate.innerText().catch(() => '')).trim();
            if (text.includes(expectedId) || (dramaName && text.includes(dramaName))) {
                targetOption = candidate;
                targetText = text;
                break;
            }
        }

        if (!targetOption && optionCount === 1) {
            const singleOption = options.first();
            const singleText = (await singleOption.innerText().catch(() => '')).trim();
            if (singleText && !/暂无|无数据|无匹配|空/.test(singleText)) {
                targetOption = singleOption;
                targetText = singleText;
            }
        }

        if (targetOption) {
            await targetOption.click({
                timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
            });

            await page.waitForTimeout(200);
            await dismissStagePageToasts(page);

            const afterSelectedText = (await selectBox.innerText().catch(() => '')).trim();
            console.log(
                `     已选中商品: ${targetText || afterSelectedText}`
            );
            span.end({ ok: true, retry: retry + 1, selected: targetText });
            return true;
        }

        console.log(
            `     “商品”下拉未找到作品ID=${expectedId}的候选，候选项数量=${optionCount}；重试...`
        );
    }

    span.end({ ok: false });
    return false;
}

