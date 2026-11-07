import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/runner.ts';
import { clearConflictDramaGuard, recordConflictDramas } from '../../src/core/conflict_guard.ts';
import fs from 'node:fs';
import { RUN_SUCCESS_MARKER_PATH } from '../../src/core/paths.ts';

for (const scenario of ['id', 'name', 'resolved', 'all_known', 'other_failure']) {
    test(`重复预检跳过后的收尾：${scenario}`, async () => {
        clearConflictDramaGuard();
        const dramaId = '1234567890123456780';
        const dramaName = '已记录的重复剧';
        recordConflictDramas([{ dramaId, douyinAccount: '111', taskId: '222' }], '服务器重复记录',
            { dramaNameMap: { [dramaId]: dramaName } });
        const keyword = scenario === 'name' ? dramaName : scenario === 'resolved' ? '另一输入别名' : dramaId;
        const keywords = scenario === 'all_known' ? [dramaId, dramaName]
            : scenario === 'other_failure' ? [dramaId, '解析失败剧'] : [keyword];
        const failures: Array<{ keyword: string; reason: string }> = [];
        const summaries: Array<{ total: number; successCount: number; failedCount: number; untouchedTasks: unknown[] }> = [];
        const resolvedInputs: string[] = [];
        let drained = false;
        let disconnected = false;
        let mutations = 0;
        let successes = 0;
        const unexpectedMutation = async () => { mutations++; throw new Error('预检跳过后不应修改或提交模板'); };
        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => { disconnected = true; } }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: unexpectedMutation,
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: unexpectedMutation,
            trimUnusedStageTasks: unexpectedMutation,
            removeStageTasks: unexpectedMutation,
            submitStagePage: unexpectedMutation,
            createPipeline: () => ({
                get: async (input: string) => {
                    resolvedInputs.push(input);
                    return scenario === 'other_failure' ? { ok: false, status: '模拟解析失败' }
                        : { ok: true, name: dramaName, seriesId: '1234567890123456781', douyinId: dramaId };
                },
                prefetch: () => {}, abort: () => {}, drain: async () => { drained = true; },
            }) as any,
        };
        const pending = run({
            keywords, copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1', paidTemplate: '超超小额', skipSignalHandlers: true,
            onItemFailure: info => { failures.push({ keyword: info.keyword, reason: info.reason }); },
            onItemSuccess: () => { successes++; },
            onSummary: info => { summaries.push(info); },
        }, deps);
        await pending;
        assert.deepEqual(resolvedInputs, scenario === 'resolved' ? [keyword] : scenario === 'other_failure' ? ['解析失败剧'] : []);
        assert.equal(mutations, 0);
        assert.equal(successes, 0);
        assert.deepEqual(failures.map(item => item.keyword), keywords);
        for (const failure of failures.filter(item => item.keyword !== '解析失败剧')) assert.match(failure.reason, /重复剧预检拦截/);
        assert.equal(summaries.length, 1);
        assert.equal(summaries[0].total, keywords.length);
        assert.equal(summaries[0].successCount, 0);
        assert.equal(summaries[0].failedCount, keywords.length);
        assert.deepEqual(summaries[0].untouchedTasks, [1, 2, 3, 4].map(subtaskIndex => ({ tabIndex: 1, subtaskIndex })));
        assert.equal(fs.existsSync(RUN_SUCCESS_MARKER_PATH), false, '预检跳过不能写入提交成功标记');
        assert.equal(drained, true);
        assert.equal(disconnected, true);
    });
}

for (const scenario of ['single', 'single_partial_page', 'one_conflict_in_batch']) {
    test(`单部重复剧正确收尾：${scenario}`, async () => {
        clearConflictDramaGuard();
        const keywords = scenario === 'one_conflict_in_batch' ? ['A', 'B'] : ['A'];
        const capacity = scenario === 'single_partial_page' ? 4 : keywords.length;
        const rows = Array<string>(capacity).fill('template');
        const submissions: string[][] = [];
        const failures: string[] = [];
        const successes: string[] = [];
        const summaries: Array<{ successCount: number; failedCount: number; untouchedTasks: unknown[] }> = [];
        let drained = false;
        let disconnected = false;
        const id = (name: string) => name === 'A' ? '1234567890123456780' : '1234567890123456781';
        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => { disconnected = true; } }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => capacity,
            preflightStageSubtasks: async () => capacity,
            openNextStageCopyTab: async () => { throw new Error('不应打开下一页'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async (_page, slot, _count, data) => { rows[slot - 1] = data.name!; },
            trimUnusedStageTasks: async (_page, keep) => { rows.splice(keep); },
            removeStageTasks: async (_page, slots, count, _signal, onRemoved) => {
                assert.equal(count, rows.length);
                assert.deepEqual(slots, [1]);
                assert.equal(rows[0], 'A');
                rows.splice(0, 1);
                await onRemoved?.(rows.length, 1);
            },
            createPipeline: () => ({
                get: async (keyword: string) => ({ ok: true, name: keyword, seriesId: id(keyword),
                    douyinId: id(keyword) }),
                prefetch: () => {}, abort: () => {}, drain: async () => { drained = true; },
            }) as any,
            submitStagePage: async () => {
                assert.ok(rows.length > 0, '不得提交空页');
                submissions.push([...rows]);
                if (submissions.length === 1) return {
                    kind: 'duplicate', displayedDramaIds: [id('A')], message: '模拟单部剧重复投放',
                };
                assert.deepEqual(rows, ['B'], '只能提交保留下来的非冲突剧');
                return { kind: 'success' };
            },
        };
        await run({
            keywords, copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1', paidTemplate: '超超小额', skipSignalHandlers: true,
            onItemSuccess: info => { successes.push(info.keyword); },
            onItemFailure: info => { failures.push(info.keyword); },
            onSummary: info => { summaries.push(info); },
        }, deps);
        const hasRemaining = scenario === 'one_conflict_in_batch';
        assert.deepEqual(submissions, hasRemaining ? [['A', 'B'], ['B']] : [['A']]);
        assert.deepEqual(rows, hasRemaining ? ['B'] : []);
        assert.deepEqual(failures, ['A']);
        assert.deepEqual(successes, hasRemaining ? ['B'] : []);
        assert.equal(summaries.length, 1);
        assert.equal(summaries[0].successCount, hasRemaining ? 1 : 0);
        assert.equal(summaries[0].failedCount, 1);
        assert.deepEqual(summaries[0].untouchedTasks, []);
        assert.equal(drained, true);
        assert.equal(disconnected, true);
    });
}

for (const scenario of ['enough', 'insufficient', 'replacement_failed', 'none', 'later_conflicts']) {
    test(`重复剧整批处理后才提交：${scenario}`, async () => {
        clearConflictDramaGuard();
        const keywords = scenario === 'enough' ? ['A', 'B', 'C', 'D', 'E', 'F', 'G']
            : ['insufficient', 'later_conflicts'].includes(scenario) ? ['A', 'B', 'C', 'D', 'E']
                : scenario === 'replacement_failed' ? ['A', 'B', 'C', 'D', 'E', 'F'] : ['A', 'B', 'C', 'D'];
        const id = (name: string) => `123456789012345678${name.charCodeAt(0) - 65}`;
        const rows = ['', '', '', ''];
        const submissions: string[][] = [];
        const deletions: number[] = [];
        const successful: Array<{ keyword: string; slot: number }> = [];
        const failures: string[] = [];
        let drained = false;
        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: async () => { throw new Error('不应打开下一页'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async (_page, slot, _count, data) => { rows[slot - 1] = data.name!; },
            trimUnusedStageTasks: async () => { throw new Error('不应删除非冲突任务'); },
            removeStageTasks: async (_page, slots, count, _signal, onRemoved) => {
                assert.equal(count, rows.length);
                for (const slot of [...slots].sort((a, b) => b - a)) {
                    assert.ok(['A', 'C', 'D', ...(scenario === 'later_conflicts' ? ['E'] : [])].includes(rows[slot - 1]));
                    deletions.push(slot);
                    rows.splice(slot - 1, 1);
                    await onRemoved?.(rows.length, slot);
                }
            },
            createPipeline: () => ({
                get: async (keyword: string) => scenario === 'replacement_failed' && keyword === 'E'
                    ? { ok: false, status: '模拟递补解析失败' }
                    : { ok: true, name: keyword, seriesId: id(keyword), douyinId: id(keyword) },
                prefetch: () => {}, abort: () => {}, drain: async () => { drained = true; },
            }) as any,
            submitStagePage: async () => {
                submissions.push([...rows]);
                if (submissions.length === 1) return {
                    kind: 'duplicate', displayedDramaIds: ['A', 'C', 'D'].map(id), message: '模拟多剧冲突',
                };
                assert.ok(rows.every(name => !['A', 'C', 'D'].includes(name)), '所有已知冲突解决后才能再次提交');
                if (scenario === 'later_conflicts' && submissions.length === 2) return {
                    kind: 'duplicate', displayedDramaIds: [id('E')], message: '后续响应展示的冲突',
                };
                return { kind: 'success' };
            },
        };
        await run({ keywords, copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1', paidTemplate: '超超小额', skipSignalHandlers: true,
            onItemSuccess: info => { successful.push({ keyword: info.keyword, slot: info.subtaskIndex }); },
            onItemFailure: info => { failures.push(info.keyword); },
        }, deps);
        const expected = scenario === 'enough' ? ['E', 'B', 'F', 'G']
            : scenario === 'insufficient' ? ['E', 'B'] : scenario === 'replacement_failed' ? ['F', 'B'] : ['B'];
        assert.deepEqual(submissions, scenario === 'later_conflicts'
            ? [['A', 'B', 'C', 'D'], ['E', 'B'], ['B']] : [['A', 'B', 'C', 'D'], expected]);
        assert.deepEqual(deletions, scenario === 'enough' ? [] : ['none', 'later_conflicts'].includes(scenario) ? [4, 3, 1] : [4, 3]);
        assert.deepEqual(successful.sort((a, b) => a.slot - b.slot), expected.map((keyword, index) => ({ keyword, slot: index + 1 })));
        assert.deepEqual(failures, ['replacement_failed', 'later_conflicts'].includes(scenario) ? ['A', 'C', 'D', 'E'] : ['A', 'C', 'D']);
        assert.equal(drained, true);
    });
}

test('当前 Tab 已满 10 个子任务后命中重复剧预检跳过时，不会上报错误的子任务 11，而是归属到下一 Tab 子任务 1', async () => {
    clearConflictDramaGuard();
    const conflictDramaId = '7680722277561796642';
    recordConflictDramas(
        [{ dramaId: conflictDramaId, douyinAccount: '21256720979', taskId: '73482142' }],
        '服务器重复记录',
        { dramaNameMap: { [conflictDramaId]: '急诊摸鱼王' } },
    );

    const tab1Items = Array.from({ length: 10 }, (_, i) => `77000000000000000${String(i + 1).padStart(2, '0')}`);
    const nextTabValidItem = '7703854991487797283';
    const keywords = [...tab1Items, conflictDramaId, nextTabValidItem];

    const failureRecords: Array<{ keyword: string; tabIndex: number; subtaskIndex: number }> = [];
    const filledRecords: Array<{ keyword: string; tabIndex: number; subtaskIndex: number }> = [];

    const deps: Parameters<typeof run>[1] = {
        connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
        resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
        prepareStageCopyPage: async () => 10,
        preflightStageSubtasks: async () => 10,
        openNextStageCopyTab: async () => ({ page: {}, capacity: 10 }),
        triggerBrowserGC: async () => {},
        closeStageDialogIfOpen: async () => {},
        fillStageTaskWithReopenRetry: async () => {},
        trimUnusedStageTasks: async () => {},
        removeStageTasks: async () => {},
        closeSubmittedStageTab: async () => {},
        submitStagePage: async () => ({ kind: 'success' }),
        createPipeline: () => ({
            get: async (keyword: string) => ({
                ok: true,
                name: `剧目_${keyword}`,
                seriesId: keyword,
                douyinId: keyword,
            }),
            prefetch: () => {},
            abort: () => {},
            drain: async () => {},
        }) as any,
    };

    await run({
        keywords,
        copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
        roiRatio: '1.1',
        paidTemplate: '超超小额',
        skipSignalHandlers: true,
        onItemFilled: info => {
            filledRecords.push({ keyword: info.keyword, tabIndex: info.tabIndex, subtaskIndex: info.subtaskIndex });
        },
        onItemFailure: info => {
            failureRecords.push({ keyword: info.keyword, tabIndex: info.tabIndex, subtaskIndex: info.subtaskIndex });
        },
    }, deps);

    assert.equal(failureRecords.length, 1);
    assert.deepEqual(failureRecords[0], {
        keyword: conflictDramaId,
        tabIndex: 2,
        subtaskIndex: 1,
    });
    assert.ok(
        filledRecords.every(r => r.subtaskIndex >= 1 && r.subtaskIndex <= 10),
        '所有子任务编号必须在 1~10 范围内',
    );
    assert.deepEqual(filledRecords[filledRecords.length - 1], {
        keyword: nextTabValidItem,
        tabIndex: 2,
        subtaskIndex: 1,
    });
});
