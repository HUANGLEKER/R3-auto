import { UNIFIED } from '../core/config.ts';
import { profiler } from '../infra/profiler.ts';

export async function retryStageFill(
    page: any,
    subtaskIndex: number,
    requiredCount: number,
    data: StageFillData,
    dependencies: {
        fillStageTask: (page: any, slot: number, count: number, data: StageFillData) => Promise<void>;
        cancelStageDialogForRetry: (page: any, slot: number) => Promise<void>;
        delay?: (ms: number) => Promise<void>;
    }
): Promise<void> {
    const span = profiler.startSpan('stage.fill_task_reopen_retry', 'STAGE', { subtaskIndex, douyinId: data.douyinId });
    const maxRounds = UNIFIED.STAGE_DIALOG_REOPEN_MAX;
    const signal = data.signal;
    let lastError: any = null;

    for (let round = 1; round <= maxRounds; round++) {
        if (signal?.aborted) {
            const abortErr = signal.reason || new Error('Aborted');
            span.endWithError(abortErr);
            throw abortErr;
        }

        try {
            if (round > 1) {
                console.log(
                    `   搭剧: 重新进入第 ${subtaskIndex} 个子任务重新搭建该剧（整轮重试 ${round}/${maxRounds}）`
                );
            }

            await dependencies.fillStageTask(
                page,
                subtaskIndex,
                requiredCount,
                data
            );

            span.end({ ok: true, round });
            return;
        } catch (error: any) {
            lastError = error;

            if (signal?.aborted || error?.name === 'AbortError') {
                span.endWithError(error);
                throw error;
            }

            console.log(
                `   ⚠️ 搭剧: 第 ${subtaskIndex} 个子任务搭建/保存本轮失败：${error.message}`
            );

            await dependencies.cancelStageDialogForRetry(
                page,
                subtaskIndex
            );

            if (round < maxRounds) {
                console.log(
                    `   🔄 搭剧: 因网络波动或接口超时，在第 ${subtaskIndex} 个子任务下重新搭建该剧 (${round + 1}/${maxRounds})...`
                );
                if (dependencies.delay) {
                    if (signal?.aborted) {
                        const abortErr = signal.reason || new Error('Aborted');
                        span.endWithError(abortErr);
                        throw abortErr;
                    }
                    await dependencies.delay(1000);
                }
                continue;
            }
        }
    }

    const blockingError: any = new Error(
        [
            `第 ${subtaskIndex} 个子任务内容/商品配置及保存连续 ${maxRounds} 轮仍无法完成`,
            `作品ID=${data.douyinId}`,
            `最后错误=${lastError?.message || '未知'}`,
        ].join('；')
    );

    blockingError.code = lastError?.code === 'STAGE_DRAMA_SELECT_FAILED'
        ? 'STAGE_DRAMA_SEARCH_EXHAUSTED'
        : (lastError?.code === 'STAGE_PRODUCT_SELECT_FAILED'
            ? 'STAGE_PRODUCT_SEARCH_EXHAUSTED'
            : 'STAGE_SUBTASK_SAVE_EXHAUSTED');
    span.endWithError(blockingError);
    throw blockingError;
}


export interface StageFillData { name?: string; douyinId: string; roiRatio?: string; paidTemplate?: string; signal?: AbortSignal; }
