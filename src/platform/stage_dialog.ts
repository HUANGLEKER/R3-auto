import { UNIFIED, STAGE_SELECTORS } from '../core/config.ts';
import { profiler } from '../infra/profiler.ts';
import { getStageSubtaskContainers } from './stage_dom.ts';
import { dismissStagePageToasts } from './stage_save.ts';

export async function openStageSubtask(
    page: any,
    subtaskIndex: number
): Promise<any> {
    const span = profiler.startSpan('stage.open_subtask', 'STAGE', { subtaskIndex });
    await dismissStagePageToasts(page);

    const dialog = page
        .locator(STAGE_SELECTORS.dialog)
        .filter({ hasText: '内容名称' })
        .first();

    // 如果弹窗已处于打开状态，直接复用
    if (await dialog.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log('   搭剧: 编辑弹窗已处于打开状态，直接复用');
        span.end({ ok: true, source: 'ALREADY_OPEN' });
        return dialog;
    }

    const container = getStageSubtaskContainers(page)
        .nth(subtaskIndex - 1);

    await container.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_PAGE_READY_TIMEOUT,
    });

    const editIcon = container
        .locator(STAGE_SELECTORS.editIcon)
        .first();

    await editIcon.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });

    const editBtn = editIcon.locator(
        'xpath=ancestor::button[1]'
    );

    await Promise.all([
        dialog.waitFor({
            state: 'visible',
            timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
        }),
        editBtn.click({
            force: true,
            timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
        }),
    ]);

    await page
        .locator(STAGE_SELECTORS.contentNameDropdown)
        .first()
        .waitFor({
            state: 'visible',
            timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
        });

    span.end({ ok: true });
    return dialog;
}

export async function confirmStageDiscardAfterCancel(
    page: any,
    dialog: any,
    subtaskIndex: number | null = null
): Promise<string> {
    const span = profiler.startSpan('stage.confirm_discard_after_cancel', 'STAGE', { subtaskIndex });
    const confirmDialog = page
        .locator('.arco-modal')
        .filter({
            hasText: /关闭后不会保存[\s\S]*是否关闭/,
        })
        .last();

    const closeState = await Promise.race([
        confirmDialog
            .waitFor({
                state: 'visible',
                timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
            })
            .then(() => 'confirmation' as const)
            .catch(() => null),
        dialog
            .waitFor({
                state: 'hidden',
                timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
            })
            .then(() => 'direct-hidden' as const)
            .catch(() => null),
    ]);

    if (closeState === 'confirmation') {
        console.log(
            '   搭剧: 已出现“关闭后不会保存”确认弹窗，点击“确定”放弃本轮修改'
        );

        const confirmBtn = confirmDialog
            .getByRole('button', {
                name: '确定',
                exact: true,
            })
            .first();

        if (!await confirmBtn
            .isVisible({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT })
            .catch(() => false)) {
            const error = new Error(
                `${subtaskIndex ? `第 ${subtaskIndex} 个子任务` : '搭剧编辑弹窗'}` +
                '取消后出现关闭确认，但未找到“确定”按钮'
            );
            span.endWithError(error);
            throw error;
        }

        await confirmBtn.click({
            timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
        });

        await confirmDialog.waitFor({
            state: 'hidden',
            timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
        });

        span.end({ closeState: 'confirmation' });
        return 'confirmation';
    }

    if (closeState === 'direct-hidden') {
        span.end({ closeState: 'direct-hidden' });
        return 'direct-hidden';
    }

    const error = new Error(
        `${subtaskIndex ? `第 ${subtaskIndex} 个子任务` : '搭剧编辑弹窗'}` +
        '点击“取消”后，既未出现关闭确认，也未关闭编辑弹窗'
    );
    span.endWithError(error);
    throw error;
}

export async function waitStageOverlayHidden(page: any): Promise<void> {
    await page.waitForFunction(
        () => {
            const visible = (node: Element | null) => {
                if (!node) {
                    return false;
                }

                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();

                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0
                );
            };

            const masks = Array.from(
                document.querySelectorAll(
                    '.arco-modal-mask, .arco-drawer-mask'
                )
            );

            return !masks.some(visible);
        },
        null,
        { timeout: UNIFIED.STAGE_ACTION_TIMEOUT }
    );
}

export async function discardStageDialog(
    page: any,
    {
        subtaskIndex = null as number | null,
        requireDialog = false,
        waitSubtaskReady = false,
        reason = 'cleanup',
    } = {}
): Promise<boolean> {
    const span = profiler.startSpan('stage.discard_dialog', 'STAGE', { subtaskIndex, reason });
    const dialog = page
        .locator(STAGE_SELECTORS.dialog)
        .filter({ hasText: '内容名称' })
        .first();

    const orphanConfirm = page
        .locator('.arco-modal')
        .filter({
            hasText: /关闭后不会保存[\s\S]*是否关闭/,
        })
        .last();

    if (await orphanConfirm
        .isVisible({ timeout: 250 })
        .catch(() => false)) {
        const confirmBtn = orphanConfirm
            .getByRole('button', {
                name: '确定',
                exact: true,
            })
            .first();

        if (await confirmBtn
            .isVisible({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT })
            .catch(() => false)) {
            console.log(
                `   搭剧 cleanup(${reason}): 检测到遗留关闭确认，点击“确定”`
            );
            await confirmBtn.click();
            await orphanConfirm.waitFor({
                state: 'hidden',
                timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
            }).catch(() => {});
        }
    }

    const dialogVisible = await dialog
        .isVisible({ timeout: 500 })
        .catch(() => false);

    if (!dialogVisible) {
        if (requireDialog) {
            const error = new Error(
                `${subtaskIndex ? `第 ${subtaskIndex} 个子任务` : '搭剧'}` +
                '需要取消重试，但未找到仍打开的编辑弹窗'
            );
            span.endWithError(error);
            throw error;
        }

        await waitStageOverlayHidden(page)
            .catch(() => {});
        span.end({ dialogWasVisible: false });
        return false;
    }

    const cancelBtn = dialog
        .locator(STAGE_SELECTORS.cancelBtn)
        .first();

    if (await cancelBtn
        .isVisible({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT })
        .catch(() => false)) {
        console.log(
            `   搭剧 cleanup(${reason}): 点击编辑弹窗“取消”`
        );

        await cancelBtn.click({
            timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
        });

        await confirmStageDiscardAfterCancel(
            page,
            dialog,
            subtaskIndex
        );
    } else {
        console.log(
            `   搭剧 cleanup(${reason}): 未找到“取消”，使用 Escape 兜底`
        );

        await page.keyboard.press('Escape');

        const confirmVisible = await orphanConfirm
            .isVisible({ timeout: 800 })
            .catch(() => false);

        if (confirmVisible) {
            const confirmBtn = orphanConfirm
                .getByRole('button', {
                    name: '确定',
                    exact: true,
                })
                .first();

            if (await confirmBtn
                .isVisible({ timeout: UNIFIED.STAGE_ACTION_TIMEOUT })
                .catch(() => false)) {
                await confirmBtn.click();
                await orphanConfirm.waitFor({
                    state: 'hidden',
                    timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
                }).catch(() => {});
            }
        }
    }

    await dialog.waitFor({
        state: 'hidden',
        timeout: UNIFIED.STAGE_DIALOG_TIMEOUT,
    });

    await waitStageOverlayHidden(page);

    if (waitSubtaskReady && subtaskIndex) {
        const container = getStageSubtaskContainers(page)
            .nth(subtaskIndex - 1);

        await container.waitFor({
            state: 'visible',
            timeout: UNIFIED.STAGE_PAGE_READY_TIMEOUT,
        });

        await container
            .locator(STAGE_SELECTORS.editIcon)
            .first()
            .waitFor({
                state: 'visible',
                timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
            });
    }

    span.end({ ok: true });
    return true;
}

export async function cancelStageDialogForRetry(
    page: any,
    subtaskIndex: number
): Promise<void> {
    await dismissStagePageToasts(page).catch(() => {});
    await discardStageDialog(
        page,
        {
            subtaskIndex,
            requireDialog: false,
            waitSubtaskReady: true,
            reason: '子任务重试清理',
        }
    );
    await dismissStagePageToasts(page).catch(() => {});

    console.log(
        `   搭剧: 第 ${subtaskIndex} 个子任务已完成统一 cleanup，准备重新进入同一子任务`
    );
}

export async function closeStageDialogIfOpen(page: any): Promise<void> {
    try {
        await discardStageDialog(
            page,
            {
                requireDialog: false,
                waitSubtaskReady: false,
                reason: '异常恢复',
            }
        );
    } catch (error: any) {
        console.log(
            `   ⚠️ 搭剧统一 cleanup 失败: ${error.message}`
        );
    }
}
