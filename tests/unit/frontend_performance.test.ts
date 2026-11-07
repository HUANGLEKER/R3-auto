import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogBatcher } from '../../src/web/client/src/utils/log_batcher.ts';
import { createPatchBatcher } from '../../src/web/client/src/utils/patch_batcher.ts';

test('任务增量合并不丢行，队列达到上限时先提交；快照清除旧批次', context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const batches: any[] = [];
    const buffer = createPatchBatcher((patch, moves) => batches.push({ patch, moves }), 100, 3);
    buffer.append({ items: [{ index: 1, keyword: '甲', status: 'running' }], moveToEnd: 1 });
    buffer.append({ items: [{ index: 1, keyword: '甲', status: 'failed' }], lastError: '失败' });
    context.mock.timers.tick(100);
    assert.equal(batches.length, 1); assert.equal(batches[0].patch.items[0].status, 'failed'); assert.deepEqual(batches[0].moves, [1]);
    buffer.append({ items: [1, 2, 3, 4].map(index => ({ index, keyword: String(index), status: 'success' })) });
    assert.equal(batches[1].patch.items.length, 4);
    buffer.append({ lastError: '旧批次' }); buffer.reset(); context.mock.timers.tick(100);
    assert.equal(batches.length, 2); buffer.dispose();
});
import { evaluateStageSelection } from '../../src/platform/stage_selection_policy.ts';

test('日志突发只产生一个批次，顺序和内存上限受控', context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const batches: number[][] = [];
    const buffer = createLogBatcher<number>(entries => batches.push(entries));
    for (let index = 0; index < 2000; index++) buffer.append(index);
    assert.equal(batches.length, 0);
    context.mock.timers.tick(99);
    assert.equal(batches.length, 0);
    context.mock.timers.tick(1);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0], Array.from({ length: 800 }, (_, index) => index + 1200));
    buffer.append(2000); buffer.append(2001);
    buffer.flush();
    assert.deepEqual(batches[1], [2000, 2001]);
    context.mock.timers.tick(100);
    assert.equal(batches.length, 2);
    buffer.dispose();
});

test('快照、清空和卸载取消旧日志批次', context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const batches: string[][] = [];
    const buffer = createLogBatcher<string>(entries => batches.push(entries));
    buffer.append('旧运行'); buffer.reset();
    context.mock.timers.tick(100);
    assert.equal(batches.length, 0);
    buffer.append('新运行');
    context.mock.timers.tick(100);
    assert.deepEqual(batches, [['新运行']]);
    buffer.append('卸载前'); buffer.dispose(); buffer.append('卸载后'); buffer.flush();
    context.mock.timers.tick(100);
    assert.deepEqual(batches, [['新运行']]);
});

test('独立选择策略保留 ID 证据优先及精确单候选规则，拒绝歧义和空 ID', () => {
    const id = '1234567890123456789';
    assert.equal(evaluateStageSelection(id, [id], [], '', 2).source, 'OPTION_IDENTITY');
    assert.equal(evaluateStageSelection(id, [], [id], '', 2).source, 'SELECTED_VALUE');
    assert.equal(evaluateStageSelection(id, [], [], id, 1).source, 'EXACT_QUERY_SINGLE_OPTION');
    assert.equal(evaluateStageSelection(id, [], [], id, 2).source, 'AMBIGUOUS_SELECTION');
    assert.equal(evaluateStageSelection(id, [], [], 'other', 1).source, 'AMBIGUOUS_SELECTION');
    assert.equal(evaluateStageSelection('', [''], [], '', 1).source, 'AMBIGUOUS_SELECTION');
});
