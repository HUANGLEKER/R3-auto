import { UNIFIED } from '../core/config.ts';
import { profiler } from '../infra/profiler.ts';
import { dismissStagePageToasts } from './stage_save.ts';
import { isPaidTemplateMatched } from '../core/utils.ts';

export const STAGE_CONFIG_CONSTANTS = Object.freeze({
    DEFAULT_APP: '默认应用',
    DIRECTOR_ACCOUNT: '主管账号',
    PROMOTION_LINK_NAME: '{剧集简称}{随机数}',
    DEFAULT_PAID_TEMPLATE: '超超小额',
});

/**
 * 在弹窗内精准定位 IAA 配置 或 IAP 配置下的指定表单项
 */
export async function getSectionFormItem(
    dialog: any,
    section: 'IAA' | 'IAP',
    fieldName: string
): Promise<any> {
    const formItemIndex = await dialog.evaluate(
        (dialogEl: HTMLElement, { sec, field }: { sec: 'IAA' | 'IAP'; field: string }) => {
            const items = Array.from(dialogEl.querySelectorAll('.arco-form-item, [class*="form-item"]'));
            if (items.length === 0) return -1;

            const clean = (str: string) => str.replace(/[\s*：:]/g, '');
            const targetLabel = clean(field);

            // 收集所有 label 匹配该字段名的 form-item 索引
            const matchingIndices: number[] = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const labelEl = item.querySelector('label, [class*="label"], .arco-form-item-label');
                const lText = clean(labelEl ? labelEl.textContent || '' : '');
                if (lText === targetLabel || lText.includes(targetLabel)) {
                    matchingIndices.push(i);
                }
            }

            if (matchingIndices.length === 0) return -1;

            // 起始解锁集数仅属于 IAA，充值模板仅属于 IAP
            if (matchingIndices.length === 1 && (field.includes('起始解锁') || field.includes('充值模板'))) {
                return matchingIndices[0];
            }

            // 查找 section 标题元素
            const findHeader = (s: 'IAA' | 'IAP'): Element | null => {
                const exactRegex = s === 'IAA' ? /^IAA\s*配置$/i : /^IAP\s*配置$/i;
                const all = Array.from(dialogEl.querySelectorAll('*'));
                const exact = all.filter(el => exactRegex.test((el.textContent || '').trim()));
                if (exact.length > 0) {
                    exact.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
                    return exact[0];
                }
                const looseRegex = s === 'IAA' ? /IAA\s*配置/i : /IAP\s*配置/i;
                const otherRegex = s === 'IAA' ? /IAP\s*配置/i : /IAA\s*配置/i;
                const loose = all.filter(el => {
                    const t = (el.textContent || '').trim();
                    return looseRegex.test(t) && !otherRegex.test(t);
                });
                if (loose.length > 0) {
                    loose.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
                    return loose[0];
                }
                return null;
            };

            const iaaHeader = findHeader('IAA');
            const iapHeader = findHeader('IAP');

            if (iaaHeader && iapHeader) {
                for (const idx of matchingIndices) {
                    const item = items[idx];
                    const afterIaa = (iaaHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                    const beforeIap = (iapHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
                    const afterIap = (iapHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

                    if (sec === 'IAA' && afterIaa && beforeIap) {
                        return idx;
                    }
                    if (sec === 'IAP' && afterIap) {
                        return idx;
                    }
                }
            } else if (iaaHeader && sec === 'IAA') {
                for (const idx of matchingIndices) {
                    const item = items[idx];
                    const afterIaa = (iaaHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                    if (afterIaa) return idx;
                }
            } else if (iapHeader && sec === 'IAP') {
                for (const idx of matchingIndices) {
                    const item = items[idx];
                    const afterIap = (iapHeader.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                    if (afterIap) return idx;
                }
            }

            // 兜底顺序规则：IAA 在前（第1个），IAP 在后（第2个）
            if (sec === 'IAA') {
                return matchingIndices[0];
            } else {
                return matchingIndices[matchingIndices.length > 1 ? 1 : 0];
            }
        },
        { sec: section, field: fieldName }
    ).catch(() => -1);

    if (formItemIndex >= 0) {
        return dialog.locator('.arco-form-item, [class*="form-item"]').nth(formItemIndex);
    }

    // 备选 Playwright 强定位器
    const targetLabelRegex = new RegExp(`^\\s*${fieldName}\\s*\\*?\\s*$`);
    const allMatches = dialog.locator('.arco-form-item, [class*="form-item"]')
        .filter({ has: dialog.locator(`label:text-matches("${targetLabelRegex.source}"), .arco-form-item-label:text-matches("${targetLabelRegex.source}")`) });
    const matchCount = await allMatches.count().catch(() => 0);

    if (matchCount > 0) {
        if (fieldName.includes('起始解锁') || fieldName.includes('充值模板') || matchCount === 1) {
            return allMatches.first();
        }
        if (section === 'IAA') {
            return allMatches.first();
        } else {
            return allMatches.nth(1);
        }
    }

    throw new Error(`搭剧平台未找到【${section} 配置】中的“${fieldName}”表单项`);
}

export async function getSectionSelectBox(
    page: any,
    dialog: any,
    section: 'IAA' | 'IAP',
    fieldName: string
): Promise<any> {
    const item = await getSectionFormItem(dialog, section, fieldName);
    // 操作前检查并处理表单项内的“配置加载失败 重试”
    await handleStageConfigRetry(page, item, `${section} ${fieldName}`);
    const selectBox = item.locator('.arco-select-view, .arco-select, [role="combobox"]').first();
    await selectBox.waitFor({ state: 'visible', timeout: 5000 });
    return selectBox;
}

export async function getSectionTextInput(
    _page: any,
    dialog: any,
    section: 'IAA' | 'IAP',
    fieldName: string
): Promise<any> {
    const item = await getSectionFormItem(dialog, section, fieldName);
    const input = item.locator('textarea, input:not([type="hidden"]):not([tabindex="-1"])').first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    return input;
}

/**
 * 在容器或页面中寻找“配置加载失败”或“加载失败”对应的“重试”按钮/链接
 */
export async function findStageRetryElement(container: any, page?: any): Promise<any | null> {
    if (!container && !page) return null;

    const searchInLocator = async (loc: any): Promise<any | null> => {
        try {
            // 1. 查找文本精确匹配“重试”/“点击重试”/“重新加载”的按钮、链接、span 或 div
            const exactCandidates = loc.locator(
                'button:visible, a:visible, span:visible, [role="button"]:visible, div:visible'
            ).filter({ hasText: /^[\s\u00A0]*(?:点击)?(?:重试|重新加载)[\s\u00A0]*$/ });

            const exactCount = await exactCandidates.count().catch(() => 0);
            for (let i = 0; i < exactCount; i++) {
                const candidate = exactCandidates.nth(i);
                if (await candidate.isVisible().catch(() => false)) {
                    return candidate;
                }
            }

            // 2. 检查是否有包含“配置加载失败”或“加载失败”的提示容器
            const failureContainers = loc.locator(
                ':text-matches("配置加载失败|加载失败|获取失败|请求失败")'
            );
            const failCount = await failureContainers.count().catch(() => 0);

            if (failCount > 0) {
                const failureContainer = failureContainers.first();
                // 在该容器内查找包含“重试”的元素
                const retryWithin = failureContainer.locator(
                    'button:visible, a:visible, span:visible, [role="button"]:visible'
                ).filter({ hasText: /重试/ }).first();

                if (await retryWithin.isVisible().catch(() => false)) {
                    return retryWithin;
                }

                // 在同级或父级中查找包含“重试”的元素
                const parentRetry = failureContainer.locator('..').locator(
                    'button:visible, a:visible, span:visible, [role="button"]:visible'
                ).filter({ hasText: /重试/ }).first();

                if (await parentRetry.isVisible().catch(() => false)) {
                    return parentRetry;
                }
            }
        } catch (_) {}
        return null;
    };

    // 1. 先在传入的 container (如当前 form-item) 中查找
    if (container) {
        const found = await searchInLocator(container);
        if (found) return found;
    }

    // 2. 若未在 container 中找到，且有 page，在当前活跃弹窗或全局页面中查找
    if (page && typeof page.locator === 'function') {
        const dialog = page.locator('.arco-drawer:visible, .arco-modal:visible, [role="dialog"]:visible').last();
        if (await dialog.isVisible({ timeout: 200 }).catch(() => false)) {
            const foundInDialog = await searchInLocator(dialog);
            if (foundInDialog) return foundInDialog;
        }

        const foundInPage = await searchInLocator(page);
        if (foundInPage) return foundInPage;
    }

    return null;
}

/**
 * 检查并点击搭剧表单项或弹窗中的“配置加载失败 重试”按钮
 * @param page Playwright Page
 * @param container 表单项定位器或弹窗定位器
 * @param fieldName 字段名称（用于日志输出）
 * @param maxAttempts 最多重试点击次数，默认无限次（直到成功）
 * @returns 是否检测到并执行了重试
 */
export async function handleStageConfigRetry(
    page: any,
    container: any,
    fieldName = '配置',
    maxAttempts = Infinity
): Promise<boolean> {
    let attempt = 0;
    let didRetry = false;

    while (attempt < maxAttempts) {
        if (page?.isClosed && page.isClosed()) {
            break;
        }

        const retryBtn = await findStageRetryElement(container, page);
        if (!retryBtn) {
            // 如果此前已经执行过重试且当前已找不到重试元素，说明重试成功，错误已恢复
            if (didRetry) {
                console.log(`     ✅ 搭剧【${fieldName}】“重试”成功，错误提示已消除，配置已重新加载`);
                await (page?.waitForTimeout ? page.waitForTimeout(300) : new Promise(r => setTimeout(r, 300)));
                return true;
            }
            break;
        }

        didRetry = true;
        attempt++;
        const attemptText = Number.isFinite(maxAttempts)
            ? ` (第 ${attempt}/${maxAttempts} 次)`
            : ` (第 ${attempt} 次)`;
        console.log(`     ⚠️ 检测到搭剧【${fieldName}】出现错误（配置加载失败），正在自动点击“重试”按钮${attemptText}...`);

        await retryBtn.scrollIntoViewIfNeeded().catch(() => {});
        try {
            await retryBtn.click({ timeout: 3000 });
        } catch (_) {
            await retryBtn.evaluate((el: HTMLElement) => {
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                if (typeof el.click === 'function') el.click();
            }).catch(() => {});
        }

        // 点击后等待异步请求响应，检测重试按钮或失败文字是否消失
        const waitTimeout = 4000;
        const interval = 250;
        let elapsed = 0;
        let disappeared = false;

        while (elapsed < waitTimeout) {
            if (page?.isClosed && page.isClosed()) {
                break;
            }
            await (page?.waitForTimeout ? page.waitForTimeout(interval) : new Promise(r => setTimeout(r, interval)));
            elapsed += interval;
            const stillPresent = await findStageRetryElement(container, page);
            if (!stillPresent) {
                disappeared = true;
                break;
            }
        }

        if (disappeared) {
            console.log(`     ✅ 搭剧【${fieldName}】“重试”成功，错误提示已消除，配置已重新加载`);
            await (page?.waitForTimeout ? page.waitForTimeout(300) : new Promise(r => setTimeout(r, 300)));
            return true;
        }
    }

    if (didRetry && Number.isFinite(maxAttempts)) {
        console.log(`     ⚠️ 搭剧【${fieldName}】已尝试重试点击 ${attempt} 次`);
    }

    return didRetry;
}

/**
 * 获取当前页面上最后活跃的可见下拉选项弹窗
 */
async function getActiveSelectPopup(page: any): Promise<any> {
    const popups = page.locator('.arco-select-popup:visible, .arco-trigger-popup:visible, [role="listbox"]:visible');
    const count = await popups.count().catch(() => 0);
    if (count > 0) {
        return popups.nth(count - 1);
    }
    return page.locator('.arco-select-popup:visible, .arco-trigger-popup:visible').last();
}

/**
 * 在下拉选择框中按文本匹配选择选项
 */
export async function selectStageDropdownOptionByText(
    page: any,
    selectBox: any,
    targetText: string,
    fieldName: string,
    matcher?: (target: string, candidate: string) => boolean
): Promise<void> {
    const formItem = selectBox.locator('xpath=ancestor::*[contains(@class,"arco-form-item") or contains(@class,"form-item")][1]');

    // 0. 操作前检查并处理“配置加载失败 重试”
    await handleStageConfigRetry(page, formItem, fieldName);

    const currentVal = (await selectBox.innerText().catch(() => '')).trim();
    const isMatch = (cand: string) => matcher ? matcher(targetText, cand) : (cand.includes(targetText) || cand === targetText);

    if (isMatch(currentVal)) {
        console.log(`     ${fieldName}已为: ${currentVal}`);
        return;
    }

    console.log(`     准备选择${fieldName}: ${targetText}`);
    await selectBox.scrollIntoViewIfNeeded().catch(() => {});
    await selectBox.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(200);

    const searchOptionsInPopup = async () => {
        const activePopup = await getActiveSelectPopup(page);
        await activePopup.waitFor({ state: 'visible', timeout: 3500 }).catch(() => {});

        await page.waitForFunction(
            () => {
                const popups = Array.from(document.querySelectorAll('.arco-select-popup, .arco-trigger-popup, [role="listbox"]'))
                    .filter(el => {
                        const style = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0 && rect.width > 0;
                    });
                if (popups.length === 0) return false;
                const last = popups[popups.length - 1];
                return last.querySelectorAll('li[role="option"], div[role="option"], .arco-select-option').length > 0;
            },
            null,
            { timeout: 3500 }
        ).catch(() => false);

        const popups = page.locator('.arco-select-popup:visible, .arco-trigger-popup:visible, [role="listbox"]:visible');
        const popupCount = await popups.count().catch(() => 0);
        const popup = popupCount > 0 ? popups.last() : null;

        let options = popup
            ? popup.locator('li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible')
            : page.locator('li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible');

        let count = await options.count().catch(() => 0);
        if (count === 0) {
            options = page.locator('li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible');
            count = await options.count().catch(() => 0);
        }

        let targetOption: any = null;
        let matchedText = '';

        for (let i = 0; i < count; i++) {
            const opt = options.nth(i);
            const text = (await opt.innerText().catch(() => '')).trim();
            if (isMatch(text)) {
                targetOption = opt;
                matchedText = text;
                break;
            }
        }

        // 若未直接找到，尝试搜索输入
        if (!targetOption) {
            const searchInput = selectBox.locator('input:not([type="hidden"]), .arco-select-view-input').first();
            if (await searchInput.isVisible({ timeout: 300 }).catch(() => false)) {
                await searchInput.focus().catch(() => {});
                await searchInput.fill(targetText).catch(() => {});
                await page.waitForTimeout(300);

                const filteredOptions = (popup || page).locator('li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible');
                const fCount = await filteredOptions.count().catch(() => 0);
                for (let i = 0; i < fCount; i++) {
                    const opt = filteredOptions.nth(i);
                    const text = (await opt.innerText().catch(() => '')).trim();
                    if (isMatch(text)) {
                        targetOption = opt;
                        matchedText = text;
                        break;
                    }
                }
            }
        }

        return { targetOption, matchedText };
    };

    let { targetOption, matchedText } = await searchOptionsInPopup();

    // 如果未找到匹配选项，可能是由于“配置加载失败”需点击“重试”
    if (!targetOption) {
        // 先按 Escape 关闭可能遮挡表单项的下拉浮层
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(150);

        const retried = await handleStageConfigRetry(page, formItem, fieldName);
        if (retried) {
            console.log(`     🔄 【${fieldName}】重试后重新打开下拉列表并匹配“${targetText}”...`);
            await selectBox.scrollIntoViewIfNeeded().catch(() => {});
            await selectBox.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
            await page.waitForTimeout(300);
            const retryRes = await searchOptionsInPopup();
            targetOption = retryRes.targetOption;
            matchedText = retryRes.matchedText;
        }
    }

    if (!targetOption) {
        throw new Error(`搭剧“${fieldName}”下拉框中未找到匹配“${targetText}”的选项`);
    }

    await targetOption.scrollIntoViewIfNeeded().catch(() => {});
    await targetOption.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT });
    await page.waitForTimeout(200);
    await dismissStagePageToasts(page);

    const afterVal = (await selectBox.innerText().catch(() => '')).trim();
    console.log(`     ✅ ${fieldName}已成功选择: ${matchedText || afterVal}`);
}

/**
 * 在下拉选择框中按索引选择选项（0-based，1 表示第 2 个选项）
 */
export async function selectStageDropdownOptionByIndex(
    page: any,
    selectBox: any,
    targetIndex: number,
    fieldName: string
): Promise<void> {
    const formItem = selectBox.locator('xpath=ancestor::*[contains(@class,"arco-form-item") or contains(@class,"form-item")][1]');

    // 0. 操作前检查并处理“配置加载失败 重试”
    await handleStageConfigRetry(page, formItem, fieldName);

    console.log(`     准备选择${fieldName}第 ${targetIndex + 1} 个选项`);
    await selectBox.scrollIntoViewIfNeeded().catch(() => {});
    await selectBox.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(200);

    const queryOptions = async () => {
        await page.waitForFunction(
            () => {
                const popups = Array.from(document.querySelectorAll('.arco-select-popup, .arco-trigger-popup, [role="listbox"]'))
                    .filter(el => {
                        const style = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0 && rect.width > 0;
                    });
                if (popups.length === 0) return false;
                const last = popups[popups.length - 1];
                return last.querySelectorAll('li[role="option"], div[role="option"], .arco-select-option').length > 0;
            },
            null,
            { timeout: 3500 }
        ).catch(() => false);

        const popups = page.locator('.arco-select-popup:visible, .arco-trigger-popup:visible, [role="listbox"]:visible');
        const popupCount = await popups.count().catch(() => 0);
        const popup = popupCount > 0 ? popups.last() : null;

        let options = popup
            ? popup.locator('li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible')
            : page.locator('li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible');

        let count = await options.count().catch(() => 0);
        if (count === 0) {
            options = page.locator('li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible');
            count = await options.count().catch(() => 0);
        }
        return { options, count };
    };

    let { options, count } = await queryOptions();

    if (count === 0) {
        // 先按 Escape 关闭可能遮挡表单项的下拉浮层
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(150);

        const retried = await handleStageConfigRetry(page, formItem, fieldName);
        if (retried) {
            console.log(`     🔄 【${fieldName}】重试后重新打开下拉列表...`);
            await selectBox.scrollIntoViewIfNeeded().catch(() => {});
            await selectBox.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
            await page.waitForTimeout(300);
            const retryRes = await queryOptions();
            options = retryRes.options;
            count = retryRes.count;
        }
    }

    if (count === 0) {
        throw new Error(`搭剧“${fieldName}”下拉框打开后无可用选项`);
    }

    if (count <= targetIndex) {
        throw new Error(`搭剧“${fieldName}”下拉框选项不足 (期望选择第 ${targetIndex + 1} 个，但实际仅有 ${count} 个选项)`);
    }

    const actualIndex = targetIndex;
    const targetOption = options.nth(actualIndex);
    const selectedText = (await targetOption.innerText().catch(() => '')).trim();

    await targetOption.scrollIntoViewIfNeeded().catch(() => {});
    await targetOption.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT });
    await page.waitForTimeout(200);
    await dismissStagePageToasts(page);

    const afterVal = (await selectBox.innerText().catch(() => '')).trim();
    console.log(`     ✅ ${fieldName}已成功选择第 ${actualIndex + 1} 个选项: ${selectedText || afterVal}`);
}

/**
 * 填写表单项中的文本输入框/多行文本框并校验
 */
export async function fillStageTextInput(
    page: any,
    input: any,
    value: string,
    fieldName: string
): Promise<void> {
    const expected = String(value || '').trim();
    let actual = (await input.inputValue().catch(() => '')).trim();
    if (actual === expected) {
        console.log(`     ${fieldName}已为目标值: ${actual}`);
        return;
    }

    console.log(`     准备填写${fieldName}: ${expected}`);
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await input.fill(expected).catch(() => {});
    await input.blur().catch(() => {});
    await page.waitForTimeout(100);

    actual = (await input.inputValue().catch(() => '')).trim();
    if (actual !== expected) {
        await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
        await page.keyboard.press('Control+A').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.keyboard.type(expected, { delay: 20 }).catch(() => {});
        await input.blur().catch(() => {});
        await page.waitForTimeout(150);
        actual = (await input.inputValue().catch(() => '')).trim();
    }

    if (actual !== expected) {
        await input.evaluate((el: HTMLInputElement | HTMLTextAreaElement, val: string) => {
            const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) {
                nativeSetter.call(el, val);
            } else {
                el.value = val;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        }, expected).catch(() => {});
        await page.waitForTimeout(150);
        actual = (await input.inputValue().catch(() => '')).trim();
    }

    if (actual !== expected) {
        throw new Error(`搭剧“${fieldName}”填写后值不一致: 期望="${expected}", 实际="${actual}"`);
    }

    console.log(`     ✅ ${fieldName}已成功填入: ${actual}`);
}

/**
 * 填写 IAA 配置：
 * 1. 小程序通过下拉框选择默认应用
 * 2. 渠道账号通过下拉框选择主管账号
 * 3. 推广链名称填写 {剧集简称}{随机数}
 * 4. 起始解锁集数通过下拉框选择第二个选项
 */
export async function fillStageIaaConfig(page: any, dialog: any): Promise<void> {
    const span = profiler.startSpan('stage.fill_iaa_config', 'STAGE');
    console.log('   搭剧: 开始填写 IAA 配置...');

    // 操作前检查弹窗或 IAA 区域是否存在错误重试按钮
    await handleStageConfigRetry(page, dialog, 'IAA 配置');

    // 1. 小程序 -> 默认应用
    const appBox = await getSectionSelectBox(page, dialog, 'IAA', '小程序');
    await selectStageDropdownOptionByText(page, appBox, STAGE_CONFIG_CONSTANTS.DEFAULT_APP, 'IAA 小程序');

    // 2. 渠道账号 -> 主管账号
    const channelBox = await getSectionSelectBox(page, dialog, 'IAA', '渠道账号');
    await selectStageDropdownOptionByText(page, channelBox, STAGE_CONFIG_CONSTANTS.DIRECTOR_ACCOUNT, 'IAA 渠道账号');

    // 3. 推广链名称 -> {剧集简称}{随机数}
    const nameInput = await getSectionTextInput(page, dialog, 'IAA', '推广链名称');
    await fillStageTextInput(page, nameInput, STAGE_CONFIG_CONSTANTS.PROMOTION_LINK_NAME, 'IAA 推广链名称');

    // 4. 起始解锁集数 -> 第二个选项 (index 1)
    const episodeBox = await getSectionSelectBox(page, dialog, 'IAA', '起始解锁集数');
    await selectStageDropdownOptionByIndex(page, episodeBox, 1, 'IAA 起始解锁集数');

    span.end({ ok: true });
}

/**
 * 填写 IAP 配置：
 * 1. 小程序通过下拉框选择默认应用
 * 2. 渠道账号通过下拉框选择主管账号
 * 3. 推广链名称填写 {剧集简称}{随机数}
 * 4. 充值模板选择超超小额 (或传入的目标模板)
 */
export async function fillStageIapConfig(
    page: any,
    dialog: any,
    paidTemplate = UNIFIED.PAID_TEMPLATE
): Promise<void> {
    const span = profiler.startSpan('stage.fill_iap_config', 'STAGE', { paidTemplate });
    console.log('   搭剧: 开始填写 IAP 配置...');

    // 操作前检查弹窗或 IAP 区域是否存在错误重试按钮
    await handleStageConfigRetry(page, dialog, 'IAP 配置');

    // 1. 小程序 -> 默认应用
    const appBox = await getSectionSelectBox(page, dialog, 'IAP', '小程序');
    await selectStageDropdownOptionByText(page, appBox, STAGE_CONFIG_CONSTANTS.DEFAULT_APP, 'IAP 小程序');

    // 2. 渠道账号 -> 主管账号
    const channelBox = await getSectionSelectBox(page, dialog, 'IAP', '渠道账号');
    await selectStageDropdownOptionByText(page, channelBox, STAGE_CONFIG_CONSTANTS.DIRECTOR_ACCOUNT, 'IAP 渠道账号');

    // 3. 推广链名称 -> {剧集简称}{随机数}
    const nameInput = await getSectionTextInput(page, dialog, 'IAP', '推广链名称');
    await fillStageTextInput(page, nameInput, STAGE_CONFIG_CONSTANTS.PROMOTION_LINK_NAME, 'IAP 推广链名称');

    // 4. 充值模板 -> 超超小额 (或 paidTemplate)
    const templateBox = await getSectionSelectBox(page, dialog, 'IAP', '充值模板');
    await selectStageDropdownOptionByText(
        page,
        templateBox,
        paidTemplate || STAGE_CONFIG_CONSTANTS.DEFAULT_PAID_TEMPLATE,
        'IAP 充值模板',
        isPaidTemplateMatched
    );

    span.end({ ok: true });
}

/**
 * 统一执行 IAA 配置和 IAP 配置的填写
 */
export async function fillStageIaaAndIapConfig(
    page: any,
    dialog: any,
    options?: { paidTemplate?: string }
): Promise<void> {
    await handleStageConfigRetry(page, dialog, 'IAA/IAP 配置');
    await fillStageIaaConfig(page, dialog);
    await fillStageIapConfig(page, dialog, options?.paidTemplate);
}
