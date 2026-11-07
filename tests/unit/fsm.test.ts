// ============================================================
// Unit Tests: Finite State Machine (FSM)
// ============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    createStageSubtaskFSM,
    createDramaResolverFSM,
} from '../../src/infra/fsm.ts';

describe('Finite State Machine (FSM): 确定性状态迁移与生命周期', () => {
    test('createDramaResolverFSM 正常成功主线状态迁移', async () => {
        const fsm = createDramaResolverFSM('测试剧');
        assert.equal(fsm.getState(), 'INITIAL');

        await fsm.send('START_RESOLVE');
        assert.equal(fsm.getState(), 'SEARCHING_FREE');

        await fsm.send('FREE_SEARCH_OK');
        assert.equal(fsm.getState(), 'CANDIDATES_EVALUATING');

        await fsm.send('START_PARALLEL_READ');
        assert.equal(fsm.getState(), 'PARALLEL_READING');

        await fsm.send('PARALLEL_READ_DONE');
        assert.equal(fsm.getState(), 'CONFIRMING_FREE_IAA');

        await fsm.send('FREE_IAA_READY');
        assert.equal(fsm.getState(), 'CONFIRMING_DOUYIN_ID');

        await fsm.send('DOUYIN_ID_READY');
        assert.equal(fsm.getState(), 'CONFIRMING_PAID_IAP');

        await fsm.send('PAID_IAP_READY');
        assert.equal(fsm.getState(), 'RESOLVED');

        const history = fsm.getHistory();
        assert.ok(history.length >= 7);
    });

    test('createDramaResolverFSM 候选失败与耗尽状态迁移', async () => {
        const fsm = createDramaResolverFSM('未知剧');
        await fsm.send('START_RESOLVE');
        await fsm.send('NO_FREE_CANDIDATES');
        assert.equal(fsm.getState(), 'NO_USABLE_DRAMA');
    });

    test('createStageSubtaskFSM 填单与保存生命周期', async () => {
        const fsm = createStageSubtaskFSM({
            subtaskIndex: 1,
            requiredCount: 10,
            dramaName: '测试剧',
            douyinId: '7384920182746192837',
            round: 1,
            maxRounds: 3,
        });
        assert.equal(fsm.getState(), 'IDLE');

        await fsm.send('START_OPEN');
        assert.equal(fsm.getState(), 'OPENING');

        await fsm.send('DIALOG_OPENED');
        assert.equal(fsm.getState(), 'DIALOG_READY');

        await fsm.send('START_SEARCH');
        assert.equal(fsm.getState(), 'SEARCHING_DRAMA');

        await fsm.send('SELECT_SUCCESS');
        assert.equal(fsm.getState(), 'DRAMA_SELECTED');

        await fsm.send('START_FILL_ROI');
        assert.equal(fsm.getState(), 'FILLING_ROI');

        await fsm.send('ROI_FILLED_SUCCESS');
        assert.equal(fsm.getState(), 'ROI_FILLED');

        await fsm.send('START_SELECT_PRODUCT');
        assert.equal(fsm.getState(), 'SEARCHING_PRODUCT');

        await fsm.send('PRODUCT_SELECTED_SUCCESS');
        assert.equal(fsm.getState(), 'PRODUCT_SELECTED');

        await fsm.send('START_FILL_LINKS');
        assert.equal(fsm.getState(), 'LINKS_FILLING');

        await fsm.send('LINKS_VERIFIED_SUCCESS');
        assert.equal(fsm.getState(), 'LINKS_VERIFIED');

        await fsm.send('START_SUBMIT');
        assert.equal(fsm.getState(), 'SUBMITTING');

        await fsm.send('SUBMIT_SUCCESS');
        assert.equal(fsm.getState(), 'COMPLETED');
    });

    test('createStageSubtaskFSM 支持商品选择完成后无需填链直接提交', async () => {
        const fsm = createStageSubtaskFSM({
            subtaskIndex: 1,
            requiredCount: 10,
            dramaName: '测试剧',
            douyinId: '7384920182746192837',
            round: 1,
            maxRounds: 3,
        });

        await fsm.send('START_OPEN');
        await fsm.send('DIALOG_OPENED');
        await fsm.send('START_SEARCH');
        await fsm.send('SELECT_SUCCESS');
        await fsm.send('START_FILL_ROI');
        await fsm.send('ROI_FILLED_SUCCESS');
        await fsm.send('START_SELECT_PRODUCT');
        await fsm.send('PRODUCT_SELECTED_SUCCESS');
        assert.equal(fsm.getState(), 'PRODUCT_SELECTED');

        // 配置填写完成后提交
        await fsm.send('START_SUBMIT');
        assert.equal(fsm.getState(), 'SUBMITTING');

        await fsm.send('SUBMIT_SUCCESS');
        assert.equal(fsm.getState(), 'COMPLETED');
    });

    test('createStageSubtaskFSM 支持删除商品选择流程后填完ROI直接提交', async () => {
        const fsm = createStageSubtaskFSM({
            subtaskIndex: 1,
            requiredCount: 10,
            dramaName: '测试剧',
            douyinId: '7384920182746192837',
            round: 1,
            maxRounds: 3,
        });

        await fsm.send('START_OPEN');
        await fsm.send('DIALOG_OPENED');
        await fsm.send('START_SEARCH');
        await fsm.send('SELECT_SUCCESS');
        await fsm.send('START_FILL_ROI');
        await fsm.send('ROI_FILLED_SUCCESS');
        assert.equal(fsm.getState(), 'ROI_FILLED');

        // 删除商品选择流程后，直接提交
        await fsm.send('START_SUBMIT');
        assert.equal(fsm.getState(), 'SUBMITTING');

        await fsm.send('SUBMIT_SUCCESS');
        assert.equal(fsm.getState(), 'COMPLETED');
    });

    test('createStageSubtaskFSM 支持填写ROI后执行自动匹配并完成提交', async () => {
        const fsm = createStageSubtaskFSM({
            subtaskIndex: 1,
            requiredCount: 10,
            dramaName: '测试剧',
            douyinId: '7384920182746192837',
            round: 1,
            maxRounds: 3,
        });

        await fsm.send('START_OPEN');
        await fsm.send('DIALOG_OPENED');
        await fsm.send('START_SEARCH');
        await fsm.send('SELECT_SUCCESS');
        await fsm.send('START_FILL_ROI');
        await fsm.send('ROI_FILLED_SUCCESS');
        assert.equal(fsm.getState(), 'ROI_FILLED');

        // 填写全域ROI系数后执行自动匹配
        await fsm.send('START_AUTO_MATCH');
        assert.equal(fsm.getState(), 'AUTO_MATCHING');

        await fsm.send('AUTO_MATCH_COMPLETED');
        assert.equal(fsm.getState(), 'LINKS_FILLING');

        await fsm.send('START_FILL_LINKS');
        assert.equal(fsm.getState(), 'LINKS_FILLING');

        await fsm.send('LINKS_VERIFIED_SUCCESS');
        assert.equal(fsm.getState(), 'LINKS_VERIFIED');

        await fsm.send('START_SUBMIT');
        assert.equal(fsm.getState(), 'SUBMITTING');

        await fsm.send('SUBMIT_SUCCESS');
        assert.equal(fsm.getState(), 'COMPLETED');
    });

    test('FSM updateContext 能够正确更新上下文变量', () => {
        const fsm = createStageSubtaskFSM({
            subtaskIndex: 2,
            requiredCount: 10,
            dramaName: '',
            douyinId: '',
            round: 1,
            maxRounds: 3,
        });
        fsm.updateContext({ dramaName: '神级龙婿', douyinId: '7384920182746192837' });

        const ctx = fsm.getContext();
        assert.equal(ctx.subtaskIndex, 2);
        assert.equal(ctx.dramaName, '神级龙婿');
        assert.equal(ctx.douyinId, '7384920182746192837');
    });
});
