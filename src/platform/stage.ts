// ============================================================
// 搭剧平台 (Stage) 子任务填单编排与重试门面
// ============================================================

import { UNIFIED, STAGE_SELECTORS } from '../core/config.ts';
import { profiler } from '../infra/profiler.ts';
import { createStageSubtaskFSM } from '../infra/fsm.ts';
import { readRoiRatio } from '../core/paths.ts';
import { fillStageProjectName } from './stage_project_name.ts';
import { fillStageIaaAndIapConfig, fillStageIaaConfig, fillStageIapConfig } from './stage_iaa_iap.ts';
import { waitStageSubmitResult } from './stage_save.ts';
import { retryStageFill } from './stage_retry.ts';
import { tryClickStageReload } from './stage_dom.ts';
import { selectStageDramaById } from './stage_drama_select.ts';
import { fillStageRoiRatio } from './stage_form_fields.ts';
import { selectStageAutoProductMatch } from './stage_product_select.ts';
import { openStageSubtask, cancelStageDialogForRetry } from './stage_dialog.ts';
import { lockPageActive } from './cdp.ts';

// 统一重导出平台子模块能力，方便外部集中引用
export { waitStageSubmitResult, dismissStagePageToasts } from './stage_save.ts';
export * from './stage_network.ts';
export {
    fillStageIaaAndIapConfig,
    fillStageIaaConfig,
    fillStageIapConfig,
} from './stage_iaa_iap.ts';
export { getStageSubtaskContainers, getStageSubtaskStats, tryClickStageReload } from './stage_dom.ts';
export {
    getVisibleStageSelectPopupText,
    waitStageDramaSearchOutcome,
    waitStageExactDramaSearchResult,
    waitStageDramaSelected,
    getStageDramaSearchInput,
    clearStageDramaSearch,
    pageWaitForExactInputValue,
    resetStageDramaSearchFocus,
    typeStageDramaId,
    getStageOptionIdentity,
    verifyStageDramaSelection,
    selectStageDramaById,
} from './stage_drama_select.ts';
export {
    ensureStageCustomProductMatch,
    selectStageAutoProductMatch,
    ensureStageAutoProductMatch,
    getStageProductSelectBox,
    getStageProductSearchInput,
    clearStageProductSearch,
    selectStageProductById,
} from './stage_product_select.ts';
export {
    getStageRoiRatioInput,
    fillStageRoiRatio,
} from './stage_form_fields.ts';
export {
    openStageSubtask,
    confirmStageDiscardAfterCancel,
    waitStageOverlayHidden,
    discardStageDialog,
    cancelStageDialogForRetry,
    closeStageDialogIfOpen,
} from './stage_dialog.ts';
export {
    buildStageTaskName,
    openStageBasicConfigDialog,
    getStageTaskNameInput,
    fillStageBasicTaskName,
    openStageUnifiedConfigDialog,
    getStageDailyBudgetInput,
    isBudgetMatch,
    fillStageUnifiedDailyBudget,
} from './stage_page_config.ts';

export async function fillStageTask(
    page: any,
    subtaskIndex: number,
    requiredCount: number,
    data: { name?: string; douyinId: string; roiRatio?: string; paidTemplate?: string; signal?: AbortSignal }
): Promise<void> {
    const span = profiler.startSpan('stage.fill_task', 'STAGE', { subtaskIndex, douyinId: data.douyinId });
    const fsm = createStageSubtaskFSM({
        subtaskIndex,
        requiredCount,
        dramaName: data.name || '',
        douyinId: data.douyinId,
        roiRatio: data.roiRatio,
        round: 1,
        maxRounds: UNIFIED.STAGE_DIALOG_REOPEN_MAX,
    });

    await lockPageActive(page);

    const reloaded = await tryClickStageReload(page)
        .catch(() => false);

    if (reloaded) {
        console.log(
            '   搭剧: 检测到重新加载，等待任务页恢复完成...'
        );
    }

    console.log(
        `   搭剧: 打开第 ${subtaskIndex} 个子任务`
    );

    await fsm.send('START_OPEN');
    const dialog = await openStageSubtask(
        page,
        subtaskIndex
    );
    await fsm.send('DIALOG_OPENED');

    console.log(
        `   搭剧: 作品ID=${data.douyinId}`
    );

    await fsm.send('START_SEARCH');
    const selected = await selectStageDramaById(
        page,
        data.douyinId
    );

    if (!selected) {
        await fsm.send('SEARCH_FAILED').catch(() => {});
        const error: any = new Error(
            `搭剧平台无法通过作品ID选择内容名称: ${data.douyinId}`
        );
        error.code = 'STAGE_DRAMA_SELECT_FAILED';
        span.endWithError(error);
        throw error;
    }
    await fsm.send('SELECT_SUCCESS');

    // 成功填写内容名称后增加填写全域ROI系数（从 data/roi系数.txt 获取）
    const roiRatioVal = data.roiRatio || readRoiRatio();
    await fsm.send('START_FILL_ROI').catch(() => {});
    await fillStageRoiRatio(page, dialog, roiRatioVal);
    await fsm.send('ROI_FILLED_SUCCESS').catch(() => {});

    // 填写全域ROI系数后增加点击商品匹配方式为自动匹配
    await fsm.send('START_AUTO_MATCH').catch(() => {});
    await selectStageAutoProductMatch(page, dialog);
    await fsm.send('AUTO_MATCH_COMPLETED').catch(() => {});

    await fillStageProjectName(dialog, data.name || '');

    // 更新项目名称后增加填写 IAA 配置和 IAP 配置
    await fsm.send('START_FILL_LINKS').catch(() => {});
    await fillStageIaaAndIapConfig(page, dialog, {
        paidTemplate: data.paidTemplate || UNIFIED.PAID_TEMPLATE,
    });
    await fsm.send('LINKS_VERIFIED_SUCCESS').catch(() => {});

    const okBtn = dialog
        .locator(STAGE_SELECTORS.okBtn)
        .first();

    await okBtn.waitFor({
        state: 'visible',
        timeout: UNIFIED.STAGE_ACTION_TIMEOUT,
    });

    await fsm.send('START_SUBMIT');
    await waitStageSubmitResult(page, dialog, {
        submit: () => okBtn.click(),
        context: { subtaskIndex, douyinId: data.douyinId },
    });
    await fsm.send('SUBMIT_SUCCESS');

    console.log(
        '   搭剧: 保存完成，弹窗已关闭'
    );
    span.end({ ok: true });
}


export async function fillStageTaskWithReopenRetry(
    page: any, subtaskIndex: number, requiredCount: number,
    data: { name?: string; douyinId: string; roiRatio?: string; paidTemplate?: string; signal?: AbortSignal },
    dependencies = {
        fillStageTask,
        cancelStageDialogForRetry,
        delay: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    }
): Promise<void> {
    return retryStageFill(page, subtaskIndex, requiredCount, data, dependencies);
}
