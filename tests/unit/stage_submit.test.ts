import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseStageSubmitResult, submitStagePage, STAGE_SUBMIT_PATH, nextStageSlot, findStageConflicts, trimUnusedStageTasks, closeSubmittedStageTab, isStageSubmitRetryable, isStageNativeContentUnverified } from '../../src/platform/stage_submit.ts';

// Response structure captured from UserGrowth on 2026-09-26; operational IDs anonymized.
const duplicate = {
    code: 50000, status_code: 40000,
    msg: '投手参数校验失败:以下"剧目+抖音号"已被其它任务创建过项目，请勿重复配置：剧目 7665000000000000001+抖音号 30200000001（任务 65000001）、剧目 7665000000000000001+抖音号 42800000002（任务 65000001）、剧目 7665000000000000001+抖音号 80400000003（任务 65000001）、剧目 7681000000000000002+抖音号 20200000004（任务 65000001）、剧目 7681000000000000002+抖音号 22000000005（任务 65000001）等 86 条',
};

test('真实 HTTP 200 错误响应按业务码解析，只取本次列出的剧目，长 ID 不丢精度', () => {
    assert.deepEqual(parseStageSubmitResult(200, duplicate), {
        kind: 'duplicate', displayedDramaIds: ['7665000000000000001', '7681000000000000002'], message: duplicate.msg,
    });
    assert.deepEqual(parseStageSubmitResult(200, { code: 0 }), { kind: 'success' });
    for (const [status, body] of [[500, duplicate], [200, {}]] as const) {
        assert.equal(parseStageSubmitResult(status, body).kind, 'blocked');
    }
});

test('9月27日真实响应结构：16条冲突只展示同一剧5条，仅处理该剧，后续响应另行处理', () => {
    // Preserve the captured response shape; anonymize operational IDs.
    const shown = '7688000000000000001';
    const notShown = '7688000000000000002';
    const msg = '投手参数校验失败:以下"剧目+抖音号"已被其它任务创建过项目，请勿重复配置：' +
        ['30000000001', '30000000002', '30000000003', '30000000004', '30000000005']
            .map(account => `剧目 ${shown}+抖音号 ${account}（任务 65000001）`).join('、') + '等 16 条';
    const response = parseStageSubmitResult(200, {
        code: 50000, msg, status_code: 40000,
        status_msg: `RPCError{BizStatusCode:[40000] BizStatusMessage:[${msg}]}`,
    });
    assert.equal(response.kind, 'duplicate');
    if (response.kind !== 'duplicate') throw new Error('expected duplicate');
    assert.deepEqual(response.displayedDramaIds, [shown]);
    const tasks = [shown, notShown, '7688000000000000003'].map((douyinId, index) => ({
        keyword: `剧${index}`, douyinId, subtaskIndex: index + 1, tabIndex: 1,
        dramaName: `剧${index}`, seriesId: '1', completedAt: '',
    }));
    assert.deepEqual(findStageConflicts(tasks, 1, response.displayedDramaIds), [tasks[0]]);
    const next = parseStageSubmitResult(200, { code: 50000, status_code: 40000,
        msg: msg.replaceAll(shown, notShown) });
    assert.equal(next.kind, 'duplicate');
    if (next.kind !== 'duplicate') throw new Error('expected duplicate');
    assert.deepEqual(findStageConflicts(tasks, 1, next.displayedDramaIds), [tasks[1]]);
    assert.equal(parseStageSubmitResult(200, { code: 50000, status_code: 40000,
        msg: '投手参数校验失败：已被其它任务创建过项目，共16条' }).kind, 'blocked');
});

test('单剧目冲突（已被任务 xxx 创建过项目）正常识别并按剧目长 ID 定位槽位', () => {
    const singleMsg = '投手参数校验失败:剧目 7690205370731464730 + 抖音号 37658739142 已被任务 66542003 创建过项目, 请勿重复配置, 请稍后重试';
    const response = parseStageSubmitResult(200, {
        code: 50000, status_code: 40000, msg: singleMsg,
    });
    assert.equal(response.kind, 'duplicate');
    if (response.kind !== 'duplicate') throw new Error('expected duplicate');
    assert.deepEqual(response.displayedDramaIds, ['7690205370731464730']);

    const tasks = [
        { keyword: '剧1', douyinId: '7660848491894605843', seriesId: '1001', subtaskIndex: 1, tabIndex: 1, dramaName: '剧1', completedAt: '' },
        { keyword: '剧2', douyinId: '7690205370731464730', seriesId: '1002', subtaskIndex: 2, tabIndex: 1, dramaName: '剧2', completedAt: '' },
        { keyword: '剧3', douyinId: '7695128773000000000', seriesId: '1003', subtaskIndex: 3, tabIndex: 1, dramaName: '剧3', completedAt: '' },
    ];
    const conflicts = findStageConflicts(tasks, 1, response.displayedDramaIds);
    assert.deepEqual(conflicts, [tasks[1]]);

    // 支持 seriesId 匹配
    const tasksBySeries = [
        { keyword: '剧1', douyinId: '1001', seriesId: '7690205370731464730', subtaskIndex: 1, tabIndex: 1, dramaName: '剧1', completedAt: '' },
    ];
    assert.deepEqual(findStageConflicts(tasksBySeries, 1, response.displayedDramaIds), [tasksBySeries[0]]);
});

test('提交时UpsertAutoCreateTask错误中除了重复剧冲突错误，其他错误全按渠道qps限流处理（retryable）', () => {
    const qpsMsg = 'UpsertAutoCreateTask失败，子任务 1：所选渠道无法核实当前原生内容，请稍后重试';
    const channelQueryMsg = '子任务 4: 查询分销渠道失败，请稍后重试';
    const supplierQueryMsg = '子任务 1: 查询客户所属供应商失败，请稍后重试';
    const supplierErrorWithPrefix = 'UpsertAutoCreateTask失败，子任务 1: 查询客户所属供应商失败，请稍后重试';

    // 重复剧冲突错误不属于 retryable
    assert.equal(isStageSubmitRetryable(duplicate.msg), false);
    assert.equal(isStageSubmitRetryable('投手参数校验失败:剧目 7690205370731464730 + 抖音号 37658739142 已被任务 66542003 创建过项目, 请勿重复配置, 请稍后重试'), false);
    assert.equal(isStageSubmitRetryable(''), false);

    // 其他错误全按渠道 QPS 限流处理
    assert.equal(isStageSubmitRetryable(supplierQueryMsg), true);
    assert.equal(isStageSubmitRetryable(supplierErrorWithPrefix), true);
    assert.equal(isStageSubmitRetryable(qpsMsg), true);
    assert.equal(isStageSubmitRetryable('子任务 2：所选渠道无法核实当前原生内容，请稍后重试'), true);
    assert.equal(isStageSubmitRetryable(channelQueryMsg), true);
    assert.equal(isStageSubmitRetryable('子任务 4：查询分销渠道失败，请稍后重试'), true);
    assert.equal(isStageSubmitRetryable('服务端负载高，请稍后重试'), true);
    assert.equal(isStageSubmitRetryable('权限不足'), true);

    // 查询客户所属供应商失败按渠道 QPS 处理，不属于原生内容未核实（不切新 Tab）
    assert.equal(isStageNativeContentUnverified(supplierQueryMsg), false);
    assert.equal(isStageNativeContentUnverified(supplierErrorWithPrefix), false);
    assert.equal(isStageNativeContentUnverified(qpsMsg), true);
    assert.equal(isStageNativeContentUnverified('子任务 2：所选渠道无法核实当前原生内容，请稍后重试'), true);
    assert.equal(isStageNativeContentUnverified(channelQueryMsg), true);
    assert.equal(isStageNativeContentUnverified('子任务 4：查询分销渠道失败，请稍后重试'), true);
    assert.equal(isStageNativeContentUnverified('服务端负载高，请稍后重试'), false);
    assert.equal(isStageNativeContentUnverified('访问速度过快'), false);
    assert.equal(isStageNativeContentUnverified(''), false);

    const resultSupplierQuery = parseStageSubmitResult(200, {
        code: 50000, status_code: 40000, msg: supplierQueryMsg,
    });
    assert.deepEqual(resultSupplierQuery, {
        kind: 'retryable',
        message: supplierQueryMsg,
    });

    const result = parseStageSubmitResult(200, {
        code: 50000, status_code: 40000, msg: qpsMsg,
    });
    assert.deepEqual(result, {
        kind: 'retryable',
        message: qpsMsg,
    });

    const resultChannelQuery = parseStageSubmitResult(200, {
        code: 50000, status_code: 40000, msg: channelQueryMsg,
    });
    assert.deepEqual(resultChannelQuery, {
        kind: 'retryable',
        message: channelQueryMsg,
    });

    // 其它非冲突业务错误也全按渠道 QPS 限流重试
    const otherError = parseStageSubmitResult(200, {
        code: 50000, status_code: 40000, msg: '权限不足',
    });
    assert.deepEqual(otherError, {
        kind: 'retryable',
        message: '权限不足',
    });
});

function fakePage(action: (page: any) => void) {
    const page: any = new EventEmitter();
    page.clicks = 0;
    const locator = {
        first() { return this; }, waitFor: async () => {}, count: async () => 1,
        click: async () => { page.clicks++; action(page); },
    };
    page.locator = () => locator;
    page.getByRole = () => locator;
    return page;
}
const request = () => ({ url: () => `https://usergrowth.com.cn${STAGE_SUBMIT_PATH}`, method: () => 'POST' });
function respond(page: any, req: any, body: unknown) {
    page.emit('response', { request: () => req, status: () => 200, json: async () => body });
}

test('监听先于点击，忽略旧响应，重复响应不触发重提，并清理监听器', async () => {
    const page = fakePage(p => {
        respond(p, request(), { code: 0 });
        const req = request();
        p.emit('request', req);
        respond(p, req, duplicate);
    });
    assert.equal((await submitStagePage(page)).kind, 'duplicate');
    assert.equal(page.clicks, 1);
    assert.equal(page.eventNames().length, 0);
});

test('超时、断线不重提；提交后取消仍等待在途响应', async () => {
    const silent = fakePage(() => {});
    assert.equal((await submitStagePage(silent, undefined, 10)).kind, 'blocked');
    assert.equal(silent.clicks, 1);
    assert.equal(silent.eventNames().length, 0);
    const broken = fakePage(p => { const req = request(); p.emit('request', req); p.emit('requestfailed', req); });
    assert.equal((await submitStagePage(broken)).kind, 'blocked');
    const controller = new AbortController();
    const cancelled = fakePage(p => {
        const req = request(); p.emit('request', req); controller.abort();
        setTimeout(() => respond(p, req, { code: 0 }), 10);
    });
    assert.equal((await submitStagePage(cancelled, controller.signal)).kind, 'success');
    await assert.rejects(submitStagePage(cancelled, controller.signal), /abort/i);
    assert.equal(cancelled.clicks, 1);
});

test('多轮冲突依次取后续剧递补，只替换当前页冲突槽位，补齐后再提交', async () => {
    const task = (keyword: string, subtaskIndex: number, tabIndex = 1) => ({ keyword, douyinId: keyword,
        subtaskIndex, tabIndex, dramaName: keyword, seriesId: '1', completedAt: '' });
    let tasks = [task('A', 1), task('B', 2), task('C', 3), task('A', 1, 2)];
    const pending = ['D', 'E'];
    const responseBodies = ['A', 'D'].map(id => ({ ...duplicate,
        msg: `投手参数校验失败:以下"剧目+抖音号"已被其它任务创建过项目，请勿重复配置：剧目 ${id === 'A' ? '11' : '44'}+抖音号 22（任务 33）等 10 条`,
    }));
    tasks[0].douyinId = '11';
    let round = 0;
    const page = fakePage(p => {
        const req = request(); p.emit('request', req);
        respond(p, req, responseBodies[round++] || { code: 0 });
    });
    for (;;) {
        assert.equal(nextStageSlot(tasks, 1), 4);
        const result = await submitStagePage(page);
        if (result.kind === 'success') break;
        assert.equal(result.kind, 'duplicate');
        if (result.kind !== 'duplicate') throw new Error('unexpected');
        const conflicts = findStageConflicts(tasks, 1, result.displayedDramaIds);
        tasks = tasks.filter(t => !conflicts.includes(t));
        assert.equal(nextStageSlot(tasks, 1), 1);
        const replacement = task(pending.shift()!, nextStageSlot(tasks, 1));
        replacement.douyinId = replacement.keyword === 'D' ? '44' : '55';
        tasks.push(replacement);
    }
    assert.equal(page.clicks, 3);
    assert.deepEqual(tasks.filter(t => t.tabIndex === 1).sort((a, b) => a.subtaskIndex - b.subtaskIndex).map(t => t.keyword), ['E', 'B', 'C']);
    assert.equal(tasks.find(t => t.tabIndex === 2)!.keyword, 'A');
    assert.throws(() => findStageConflicts(tasks, 1, ['unknown']), /不匹配/);
});

test('末页只从末尾移除未填写复制配置，数量异常时不继续', async () => {
    let count = 4;
    const removed: number[] = [];
    let pending: number | undefined;
    const confirmation: any = {
        filter() { return this; }, count: async () => pending === undefined ? 0 : 1,
        waitFor: async () => { assert.notEqual(pending, undefined); },
        getByRole: () => ({ click: async () => { removed.push(pending! + 1); count--; pending = undefined; } }),
    };
    const tasks: any = {
        count: async () => count, filter() { return this; },
        nth: (index: number) => ({
            locator: () => ({ click: async () => { assert.equal(index, count - 1); pending = index; } }),
            waitFor: async () => { assert.ok(index >= count); },
        }),
    };
    const page = { locator: (selector: string) => selector.includes('popconfirm') ? confirmation : tasks };
    const remainingCounts: number[] = [];
    await trimUnusedStageTasks(page, 2, 4, undefined, async remaining => { remainingCounts.push(remaining); });
    assert.deepEqual(remainingCounts, [3, 2]);
    assert.deepEqual(removed, [4, 3]);
    assert.equal(count, 2);
    await assert.rejects(trimUnusedStageTasks(page, 1, 3), /不匹配/);
    assert.deepEqual(removed, [4, 3]);
});

test('closeSubmittedStageTab：成功提交的页面正常调用 close 关闭 Tab', async () => {
    let closed = false;
    const page = {
        isClosed: () => false,
        close: async () => { closed = true; },
    };
    await closeSubmittedStageTab(page, 1, '末页');
    assert.equal(closed, true, '应当已成功调用 page.close');
});

test('closeSubmittedStageTab：页面已处于关闭状态时幂等跳过，不重复调用 close', async () => {
    let callCount = 0;
    const page = {
        isClosed: () => true,
        close: async () => { callCount++; },
    };
    await closeSubmittedStageTab(page, 2);
    assert.equal(callCount, 0, '已关闭的页面不应再次调用 close');
});

test('closeSubmittedStageTab：无 close 方法或关闭异常时安全捕获不抛错', async () => {
    await assert.doesNotReject(closeSubmittedStageTab(null, 1));
    await assert.doesNotReject(closeSubmittedStageTab({}, 1));
    const failingPage = {
        isClosed: () => false,
        close: async () => { throw new Error('Target closed'); },
    };
    await assert.doesNotReject(closeSubmittedStageTab(failingPage, 1));
});
