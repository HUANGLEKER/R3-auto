import { UNIFIED } from '../core/config.ts';
import { profiler } from '../infra/profiler.ts';


export async function getStageRoiRatioInput(
    _page: any,
    dialog: any,
    timeout = UNIFIED.STAGE_LOAD_TIMEOUT
): Promise<any> {
    const span = profiler.startSpan('stage.get_roi_ratio_input', 'STAGE');

    // 1. 优先直接通过精准 ID / placeholder 定位（最快且 100% 避免误匹配到出价方式下拉框）
    const directLocators = [
        dialog.locator('input#bid_info_omni_roi_coefficient_input').first(),
        dialog.locator('input[id*="omni_roi_coefficient"], input[id*="roi_coefficient"], input[id*="roi_ratio"]').first(),
        dialog.locator('input[placeholder="请输入全域ROI系数"], input[placeholder*="全域ROI系数"]').first(),
    ];

    for (const loc of directLocators) {
        if (await loc.isVisible({ timeout: 300 }).catch(() => false)) {
            span.end({ ok: true, source: 'direct_id_or_placeholder' });
            return loc;
        }
    }

    // 2. 通过 evaluate 在 DOM 树中精准找到 label 为“全域ROI系数”的 form-item 内的真实 input（严格排除 .arco-select 与 .arco-select-view-input）
    const formItemIndex = await dialog.evaluate((dialogEl: HTMLElement) => {
        const items = Array.from(dialogEl.querySelectorAll('.arco-form-item'));
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const labelEl = item.querySelector('label, .arco-form-item-label');
            const labelText = labelEl ? (labelEl.textContent || '').replace(/[\s*：:]/g, '') : '';
            if (labelText === '全域ROI系数' || labelText.includes('全域ROI系数')) {
                // 排除出价方式下拉框与隐藏占位 input
                const inputEl = item.querySelector('input:not([type="hidden"]):not(.arco-select-view-input):not([tabindex="-1"])');
                if (inputEl) {
                    return i;
                }
            }
        }
        return -1;
    }).catch(() => -1);

    if (formItemIndex >= 0) {
        const item = dialog.locator('.arco-form-item').nth(formItemIndex);
        const input = item.locator('input:not([type="hidden"]):not(.arco-select-view-input):not([tabindex="-1"])').first();
        if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
            span.end({ ok: true, source: 'evaluate_form_item' });
            return input;
        }
    }

    // 3. 备选 Playwright 强定位器列表
    const candidateLocators = [
        dialog.locator('input#bid_info_omni_roi_coefficient_input').first(),
        dialog.locator('input[id*="omni_roi_coefficient"], input[id*="roi_coefficient"], input[id*="roi_ratio"]').first(),
        dialog.locator('input[placeholder*="全域ROI系数"], input[placeholder*="ROI系数"]').first(),
        dialog.locator('.arco-form-item:has(label:has-text("全域ROI系数")):not(:has(.arco-select)) input:not([type="hidden"]):not(.arco-select-view-input)').first(),
    ];

    for (const loc of candidateLocators) {
        if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
            span.end({ ok: true, source: 'candidate_locator' });
            return loc;
        }
    }

    // 4. 最终等待
    try {
        const input = await Promise.any(
            candidateLocators.map(async loc => {
                await loc.waitFor({
                    state: 'visible',
                    timeout,
                });
                return loc;
            })
        );
        span.end({ ok: true });
        return input;
    } catch (_) {
        const error = new Error('搭剧平台未找到“全域ROI系数”输入框');
        span.endWithError(error);
        throw error;
    }
}


export async function fillStageRoiRatio(
    page: any,
    dialog: any,
    roiRatioValue: string
): Promise<void> {
    const span = profiler.startSpan('stage.fill_roi_ratio', 'STAGE', { roiRatioValue });
    const expected = String(roiRatioValue || '').trim();

    if (!expected) {
        const error = new Error('“全域ROI系数”待填值为空，请检查 data/roi系数.txt');
        span.endWithError(error);
        throw error;
    }

    console.log(`   搭剧: 准备填写全域ROI系数: ${expected}`);

    const input = await getStageRoiRatioInput(page, dialog);
    await input.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });
    await input.scrollIntoViewIfNeeded().catch(() => {});

    const isMatch = (act: string, exp: string) => {
        if (!act) return false;
        if (act === exp) return true;
        const numAct = parseFloat(act);
        const numExp = parseFloat(exp);
        if (!isNaN(numAct) && !isNaN(numExp) && Math.abs(numAct - numExp) < 0.0001) {
            return true;
        }
        return false;
    };

    // 检查当前值是否已符合预期
    let actual = (await input.inputValue().catch(() => '')).trim();
    if (isMatch(actual, expected)) {
        console.log(`     “全域ROI系数”已为目标值: ${actual}`);
        span.end({ ok: true, source: 'ALREADY_MATCHED' });
        return;
    }

    // 尝试填入：点击 -> 全选 -> 退格 -> 填入 -> 失焦
    await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await input.fill(expected).catch(() => {});
    await input.blur().catch(() => {});
    await page.waitForTimeout(100);

    actual = (await input.inputValue().catch(() => '')).trim();

    // 若未生效（如 InputNumber 拦截），使用模拟键盘键入
    if (!isMatch(actual, expected)) {
        await input.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT }).catch(() => {});
        await page.keyboard.press('Control+A').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.keyboard.type(expected, { delay: 20 }).catch(() => {});
        await input.blur().catch(() => {});
        await page.waitForTimeout(150);
        actual = (await input.inputValue().catch(() => '')).trim();
    }

    // 若仍未生效，尝试 evaluate 触发 React/Vue 原生 input setter
    if (!isMatch(actual, expected)) {
        await input.evaluate((el: HTMLInputElement, val: string) => {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(el, val);
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

    if (!isMatch(actual, expected)) {
        const error = new Error(`“全域ROI系数”填写后值不一致: 期望=${expected}, 实际=${actual}`);
        span.endWithError(error);
        throw error;
    }

    console.log(`     ✅ 全域ROI系数已成功填入并校验: ${actual} (期望: ${expected})`);
    span.end({ ok: true, actual, expected });
}

