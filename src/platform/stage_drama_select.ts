import { evaluateStageSelection } from './stage_selection_policy.ts';
import { UNIFIED, STAGE_SELECTORS, STAGE_SELECTION_STATE } from '../core/config.ts';
import { profiler } from '../infra/profiler.ts';
import { createStageXHRWatcher, isStageContentSearchResponse } from './stage_network.ts';

export async function getVisibleStageSelectPopupText(page: any): Promise<string> {
    return page.evaluate(() => {
        const visible = (node: Element | null) => {
            if (!node) {
                return false;
            }

            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) !== 0 &&
                rect.width > 0 &&
                rect.height > 0
            );
        };

        const popups = Array.from(
            document.querySelectorAll(
                '.arco-select-popup, .arco-trigger-popup, [role="listbox"]'
            )
        ).filter(visible);

        const popup = popups[popups.length - 1] as HTMLElement | undefined;
        return popup
            ? (popup.innerText || '').trim()
            : '';
    }).catch(() => '');
}

export async function waitStageDramaSearchOutcome(
    page: any,
    beforePopupText: string,
    timeout = UNIFIED.STAGE_SEARCH_TIMEOUT,
    requireChange = true
): Promise<string> {
    const handle = await page.waitForFunction(
        ({ beforePopupText, requireChange }: { beforePopupText: string; requireChange: boolean }) => {
            const visible = (node: Element | null) => {
                if (!node) {
                    return false;
                }

                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();

                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    Number(style.opacity || 1) !== 0 &&
                    rect.width > 0 &&
                    rect.height > 0
                );
            };

            const popups = Array.from(
                document.querySelectorAll(
                    '.arco-select-popup, .arco-trigger-popup, [role="listbox"]'
                )
            ).filter(visible);

            const popup = popups[popups.length - 1] as HTMLElement | undefined;
            if (!popup) {
                return false;
            }

            const text = (popup.innerText || '').trim();

            const options = Array.from(
                popup.querySelectorAll(
                    'li[role="option"], div[role="option"], .arco-select-option'
                )
            ).filter(visible);

            const emptyVisible = Array.from(
                popup.querySelectorAll(
                    '.arco-empty, .ug-onestop-empty, [class*="empty"]'
                )
            ).some(visible);

            if (
                requireChange &&
                beforePopupText &&
                text === beforePopupText
            ) {
                return false;
            }

            if (options.length > 0) {
                return 'option';
            }

            if (
                emptyVisible ||
                /暂无数据|没有数据|无数据/.test(text)
            ) {
                return 'empty';
            }

            return false;
        },
        { beforePopupText, requireChange },
        { timeout }
    );

    return handle.jsonValue();
}

export async function waitStageExactDramaSearchResult(
    page: any,
    dramaId: string,
    timeout = UNIFIED.STAGE_SEARCH_TIMEOUT
): Promise<string> {
    const span = profiler.startSpan('stage.wait_exact_drama_search_result', 'STAGE', { dramaId });
    const expected = String(dramaId || '').trim();

    if (!expected) {
        const error = new Error('等待内容名称搜索结果时作品ID为空');
        span.endWithError(error);
        throw error;
    }

    const effectiveTimeout = Math.min(
        Math.max(Number(timeout) || 0, 1000),
        4500
    );

    const result = await page
        .waitForFunction(
            ({ expected }: { expected: string }) => {
                const visible = (node: Element | null) => {
                    if (!node) {
                        return false;
                    }

                    const style = window.getComputedStyle(node);
                    const rect = node.getBoundingClientRect();

                    return (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        Number(style.opacity || 1) !== 0 &&
                        rect.width > 0 &&
                        rect.height > 0
                    );
                };

                const options = (
                    Array.from(
                        document.querySelectorAll(
                            'li[role="option"], div[role="option"], .arco-select-option'
                        )
                    ) as HTMLElement[]
                ).filter(visible);

                const matched = options.some(option => {
                    const values = [
                        option.textContent || '',
                        option.getAttribute('data-value') || '',
                        option.getAttribute('value') || '',
                        option.getAttribute('title') || '',
                        option.getAttribute('aria-label') || '',
                        option.id || '',
                    ];

                    return values.some(value =>
                        String(value).includes(expected)
                    );
                });

                return matched ? 'option' : false;
            },
            { expected },
            { timeout: effectiveTimeout }
        )
        .then((handle: any) => handle.jsonValue())
        .catch(() => 'timeout');

    span.end({ outcome: String(result || 'timeout') });
    return String(result || 'timeout');
}

export async function waitStageDramaSelected(
    _page: any,
    selectBox: any,
    timeout = UNIFIED.STAGE_ACTION_TIMEOUT
): Promise<void> {
    const selectedText = selectBox
        .locator(
            '.arco-select-view-value .text-ellipsis, .arco-select-view-value, .text-ellipsis'
        )
        .first();

    const clearIcon = selectBox
        .locator('.arco-select-clear-icon')
        .first();

    const settleTimeout = Math.min(
        Math.max(Number(timeout) || 0, 300),
        1200
    );

    await Promise.race([
        selectedText
            .waitFor({
                state: 'visible',
                timeout: settleTimeout,
            })
            .then(() => true)
            .catch(() => false),
        clearIcon
            .waitFor({
                state: 'visible',
                timeout: settleTimeout,
            })
            .then(() => true)
            .catch(() => false),
    ]);
}

export async function getStageDramaSearchInput(
    page: any,
    selectBox: any
): Promise<any> {
    const candidates = [
        selectBox.locator(
            'input:not([type="hidden"])'
        ).first(),
        page.locator(
            `${STAGE_SELECTORS.contentNameDropdown} input:not([type="hidden"])`
        ).first(),
        page.locator(
            'input[placeholder*="内容ID"]'
        ).first(),
        page.locator(
            'input[placeholder*="内容"][placeholder*="搜索"]'
        ).first(),
    ];

    for (const input of candidates) {
        if (
            await input
                .isVisible({
                    timeout: 500,
                })
                .catch(() => false)
        ) {
            return input;
        }
    }

    throw new Error(
        '搭剧平台未找到“内容名称”的真实搜索 input'
    );
}

export async function clearStageDramaSearch(
    page: any,
    selectBox: any
): Promise<any> {
    const span = profiler.startSpan('stage.clear_drama_search', 'STAGE');
    await selectBox.click().catch(() => {});

    const clearIcon = selectBox
        .locator('.arco-select-clear-icon')
        .first();

    if (
        await clearIcon
            .isVisible({
                timeout: 400,
            })
            .catch(() => false)
    ) {
        await clearIcon.click();
    }

    await selectBox.click().catch(() => {});

    const input =
        await getStageDramaSearchInput(
            page,
            selectBox
        );

    await input.focus();
    await input.fill('');

    if (
        await input
            .inputValue()
            .catch(() => '') !== ''
    ) {
        await input.press('Control+A');
        await input.press('Backspace');
    }

    await page.waitForFunction(
        (inputElement: HTMLInputElement) =>
            String(inputElement?.value || '') === '',
        await input.elementHandle(),
        {
            timeout:
            UNIFIED.STAGE_ACTION_TIMEOUT,
        }
    );

    const actual =
        await input
            .inputValue()
            .catch(() => '');

    if (actual !== '') {
        const error = new Error(
            `内容名称搜索框清空失败，实际残留值: ${actual}`
        );
        span.endWithError(error);
        throw error;
    }

    span.end({ ok: true });
    return input;
}

export async function pageWaitForExactInputValue(
    input: any,
    expected: string,
    timeout = UNIFIED.STAGE_ACTION_TIMEOUT
): Promise<void> {
    const handle = await input.elementHandle();

    if (!handle) {
        throw new Error(
            '内容名称搜索 input 已失效'
        );
    }

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        const actual = await input
            .inputValue()
            .catch(() => null);

        if (actual === String(expected)) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 40));
    }

    const actual = await input
        .inputValue()
        .catch(() => '');

    throw new Error(
        `内容名称输入值未稳定：期望=${expected}，实际=${actual}`
    );
}

/** Close the stale dropdown by clicking the blank space beside the field. */
export async function resetStageDramaSearchFocus(page: any, selectBox: any, input: any): Promise<any> {
    await input.blur();
    const dialog = page.locator('.arco-drawer:visible, .arco-modal:visible')
        .filter({ has: selectBox }).first();
    const [selectBounds, dialogBounds] = await Promise.all([
        selectBox.boundingBox(),
        dialog.boundingBox(),
    ]);
    if (!selectBounds || !dialogBounds) {
        throw new Error('无法定位内容名称右侧的弹窗空白区域');
    }

    const blankX = Math.min(selectBounds.x + selectBounds.width + 48, dialogBounds.x + dialogBounds.width - 12);
    const blankY = selectBounds.y + selectBounds.height / 2;
    if (blankX <= selectBounds.x + selectBounds.width + 8 ||
        blankY >= dialogBounds.y + dialogBounds.height) {
        throw new Error('内容名称右侧没有可点击的弹窗空白区域');
    }

    const blankIsSafe = await page.evaluate(({ x, y }: { x: number; y: number }) => {
        const target = document.elementFromPoint(x, y);
        return Boolean(
            target?.closest('.arco-drawer, .arco-modal') &&
            !target?.closest('input, button, a, label, [role="button"], [role="option"], .arco-select-popup, .arco-drawer-mask, .arco-modal-mask')
        );
    }, { x: blankX, y: blankY });
    if (!blankIsSafe) {
        throw new Error('内容名称右侧目标位置不是安全的弹窗空白区域');
    }

    await page.mouse.click(blankX, blankY);
    await page.locator('.arco-select-popup:visible').first().waitFor({
        state: 'hidden',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });
    const reopenedInput = await getStageDramaSearchInput(page, selectBox);
    await reopenedInput.click({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT });
    await reopenedInput.focus();
    await reopenedInput.fill('');
    await pageWaitForExactInputValue(reopenedInput, '');
    console.log('     重试前已点击内容名称右侧空白区域并等待旧下拉关闭，重新打开下拉并清空');
    return reopenedInput;
}

export async function typeStageDramaId(
    input: any,
    dramaId: string
): Promise<void> {
    const span = profiler.startSpan('stage.type_drama_id', 'STAGE', { dramaId });
    const expected = String(dramaId || '');

    if (!expected) {
        const error = new Error('待搜索的抖音作品ID为空');
        span.endWithError(error);
        throw error;
    }

    await input.focus();

    const before =
        await input
            .inputValue()
            .catch(() => '');

    if (before !== '') {
        const error = new Error(
            `输入作品ID前搜索框未清空，当前值: ${before}`
        );
        span.endWithError(error);
        throw error;
    }

    await input.fill(expected);

    let actual =
        await input
            .inputValue()
            .catch(() => '');

    if (actual !== expected) {
        const deadline = Date.now() + 800;

        while (
            Date.now() < deadline &&
            actual !== expected
        ) {
            await input.page().waitForTimeout(40);
            actual =
                await input
                    .inputValue()
                    .catch(() => '');
        }
    }

    if (actual !== expected) {
        const error = new Error(
            `内容名称输入值未稳定：期望=${expected}，实际=${actual}`
        );
        span.endWithError(error);
        throw error;
    }

    span.end({ ok: true });
}

export async function getStageOptionIdentity(option: any): Promise<{
    text: string;
    attrs: Record<string, string>;
}> {
    return option.evaluate((node: Element) => {
        const attrs: Record<string, string> = {};
        for (const name of [
            'data-value',
            'value',
            'title',
            'aria-label',
            'id',
        ]) {
            const value = node.getAttribute(name);
            if (value) {
                attrs[name] = value;
            }
        }

        return {
            text: (node.textContent || '').trim(),
            attrs,
        };
    }).catch(() => ({ text: '', attrs: {} }));
}

export async function verifyStageDramaSelection({
    page: _page,
    selectBox,
    dramaId,
    optionIdentity,
    optionCount,
    queryValueBeforeClick,
}: {
    page?: any;
    selectBox: any;
    dramaId: string;
    optionIdentity: { text: string; attrs: Record<string, string> };
    optionCount: number;
    queryValueBeforeClick: string;
}): Promise<{ state: string; source: string; detail?: string }> {
    const span = profiler.startSpan('stage.verify_drama_selection', 'STAGE', { dramaId });
    const expected = String(dramaId || '');

    const selectedSnapshot: string[] = await selectBox.evaluate((node: Element) => {
        const values: string[] = [];
        values.push(node.textContent || '');

        for (const attr of [
            'data-value',
            'value',
            'title',
            'aria-label',
        ]) {
            values.push(node.getAttribute(attr) || '');
        }

        const inputs = Array.from(
            node.querySelectorAll('input')
        );
        for (const rawInput of inputs) {
            const input = rawInput as HTMLInputElement;
            values.push(input.value || '');
            values.push(input.getAttribute('value') || '');
        }

        return values;
    }).catch(() => []);

    const result = evaluateStageSelection(expected,
        [optionIdentity?.text || '', ...Object.values(optionIdentity?.attrs || {})],
        selectedSnapshot, String(queryValueBeforeClick || ''), optionCount);
    span.end(result);
    return result;
}
export async function selectStageDramaById(
    page: any,
    dramaId: string
): Promise<boolean> {
    const span = profiler.startSpan('stage.select_drama_by_id', 'STAGE', { dramaId });
    const selectBox = page
        .locator(STAGE_SELECTORS.contentNameDropdown)
        .first();

    await selectBox.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });

    const maxRetries = UNIFIED.STAGE_DRAMA_SEARCH_RETRY;
    const expected = String(dramaId || '');

    for (let retry = 0; retry < maxRetries; retry++) {
        let searchInput = await clearStageDramaSearch(
            page,
            selectBox
        );

        if (retry > 0) {
            searchInput = await resetStageDramaSearchFocus(page, selectBox, searchInput);
        }

        console.log('     搜索框已真实清空，value=""');
        console.log(
            `     输入作品ID（第 ${retry + 1} 次）: ${dramaId}`
        );

        const xhrWatcher = createStageXHRWatcher(
            page,
            (response, request) =>
                isStageContentSearchResponse(
                    response,
                    request,
                    dramaId
                ),
            UNIFIED.STAGE_SEARCH_TIMEOUT
        );

        xhrWatcher.promise
            .then(value => {
                if (value?.url) {
                    console.log(
                        `     内容搜索XHR: ${value.method} ${value.url}`
                    );
                }
            })
            .catch(() => {});

        try {
            await typeStageDramaId(
                searchInput,
                dramaId
            );

            const outcome =
                await waitStageExactDramaSearchResult(
                    page,
                    dramaId,
                    UNIFIED.STAGE_SEARCH_TIMEOUT
                );

            if (outcome !== 'option') {
                const currentValue =
                    await searchInput
                        .inputValue()
                        .catch(() => '');

                console.log(
                    `     当前作品ID精确候选未在短等待内出现，真实value="${currentValue}"；执行真清空后重试...`
                );

                await clearStageDramaSearch(
                    page,
                    selectBox
                );
                continue;
            }

            const options = page.locator(
                'li[role="option"]:visible, div[role="option"]:visible, .arco-select-option:visible'
            );

            const optionCount = await options.count();

            let option: any = null;
            let optionIdentity: {
                text: string;
                attrs: Record<string, string>;
            } = {
                text: '',
                attrs: {},
            };

            for (let i = 0; i < optionCount; i++) {
                const candidate = options.nth(i);

                if (!await candidate
                    .isVisible()
                    .catch(() => false)) {
                    continue;
                }

                const identity =
                    await getStageOptionIdentity(
                        candidate
                    );

                const values = [
                    identity.text || '',
                    ...Object.values(
                        identity.attrs || {}
                    ),
                ];

                if (
                    values.some(value =>
                        String(value).includes(expected)
                    )
                ) {
                    option = candidate;
                    optionIdentity = identity;
                    break;
                }
            }

            if (option) {
                const queryValueBeforeClick =
                    await searchInput
                        .inputValue()
                        .catch(() => '');

                await option.click({
                    timeout:
                    UNIFIED.STAGE_ACTION_TIMEOUT,
                });

                await waitStageDramaSelected(
                    page,
                    selectBox
                );

                const verified =
                    await verifyStageDramaSelection({
                        page,
                        selectBox,
                        dramaId,
                        optionIdentity,
                        optionCount,
                        queryValueBeforeClick,
                    });

                if (
                    verified.state ===
                    STAGE_SELECTION_STATE.VERIFIED
                ) {
                    console.log(
                        `     已选中剧目并完成二次校验 (${verified.source})`
                    );
                    span.end({ ok: true, retry: retry + 1 });
                    return true;
                }

                console.log(
                    `     ⚠️ 选中结果二次校验失败 (${verified.source}: ${verified.detail || ''})，真清空后重试`
                );

                await clearStageDramaSearch(
                    page,
                    selectBox
                );
                continue;
            }

            const currentValue =
                await searchInput
                    .inputValue()
                    .catch(() => '');

            console.log(
                `     搜索结果已出现但未找到作品ID=${dramaId}的精确候选，当前真实value="${currentValue}"；执行真清空后重试...`
            );

            await clearStageDramaSearch(
                page,
                selectBox
            );
        } finally {
            xhrWatcher.cancel();
        }
    }

    span.end({ ok: false });
    return false;
}

