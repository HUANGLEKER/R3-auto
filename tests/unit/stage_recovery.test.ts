import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { getStructuredLogPath } from '../../src/core/structured_log.ts';
import { fillStageTask, fillStageTaskWithReopenRetry, waitStageSubmitResult } from '../../src/platform/stage.ts';
import { STAGE_LINGERING_ERROR_PATTERN } from '../../src/platform/stage_save.ts';
import { UNIFIED } from '../../src/core/config.ts';

test('内容搜索重开耗尽返回可延期错误，成功重试正常结束', async () => {
    for (const succeed of [false, true]) {
        let attempts = 0;
        let cleanups = 0;
        const operation = fillStageTaskWithReopenRetry({}, 1, 2,
            { douyinId: '1234567890123456789' }, {
                fillStageTask: async () => {
                    attempts++;
                    if (succeed && attempts === 2) return;
                    throw Object.assign(new Error('选择失败'), { code: 'STAGE_DRAMA_SELECT_FAILED' });
                },
                cancelStageDialogForRetry: async () => { cleanups++; },
            });
        if (succeed) {
            await operation;
            assert.equal(attempts, 2);
            assert.equal(cleanups, 1);
        } else {
            await assert.rejects(operation, { code: 'STAGE_DRAMA_SEARCH_EXHAUSTED' });
            assert.equal(attempts, UNIFIED.STAGE_DIALOG_REOPEN_MAX);
            assert.equal(cleanups, attempts);
        }
    }
});

test('商品选择耗尽在放弃每轮修改后返回可延期错误', async () => {
    let cleanups = 0;
    await assert.rejects(fillStageTaskWithReopenRetry({}, 1, 2,
        { douyinId: '1234567890123456789' }, {
            fillStageTask: async () => {
                throw Object.assign(new Error('商品选择失败'), { code: 'STAGE_PRODUCT_SELECT_FAILED' });
            },
            cancelStageDialogForRetry: async () => { cleanups++; },
        }), { code: 'STAGE_PRODUCT_SEARCH_EXHAUSTED' });
    assert.equal(cleanups, UNIFIED.STAGE_DIALOG_REOPEN_MAX);
});

test('商品选择失败但取消修改未确认时不能返回可延期错误', async () => {
    let attempts = 0;
    await assert.rejects(fillStageTaskWithReopenRetry({}, 1, 2,
        { douyinId: '1234567890123456789' }, {
            fillStageTask: async () => {
                attempts++;
                throw Object.assign(new Error('商品选择失败'), { code: 'STAGE_PRODUCT_SELECT_FAILED' });
            },
            cancelStageDialogForRetry: async () => { throw new Error('无法确认放弃修改'); },
        }), /无法确认放弃修改/);
    assert.equal(attempts, 1);
});

test('子任务保存失败（网络超时/ListOmniDeliveryAweme等错误）在当前子任务下重新搭建该剧，成功后正常结束', async () => {
    let attempts = 0;
    let cleanups = 0;
    const saveErrorMsg = '搭剧保存失败，页面出现错误提示; 页面提示: page: ListOmniDeliveryAweme错误ListOmniDeliveryAweme失败，接口调用超时，请稍后重试logid: 2026102811490315E202B59E5A6166C17A; 保存接口: 未观察到匹配的保存请求';

    await fillStageTaskWithReopenRetry({}, 1, 4,
        { douyinId: '1234567890123456789', name: '测试剧' }, {
            fillStageTask: async () => {
                attempts++;
                if (attempts === 1) {
                    throw new Error(saveErrorMsg);
                }
            },
            cancelStageDialogForRetry: async () => { cleanups++; },
        });

    assert.equal(attempts, 2, '第 1 轮保存失败后应在当前子任务进行第 2 轮重新搭建');
    assert.equal(cleanups, 1, '第 1 轮失败后应执行 1 次弹窗清理');
});

test('子任务保存连续 3 轮失败后抛出 STAGE_SUBTASK_SAVE_EXHAUSTED 可延期错误', async () => {
    let attempts = 0;
    let cleanups = 0;
    const saveErrorMsg = '搭剧保存失败，页面出现错误提示; 页面提示: page: ListOmniDeliveryAweme错误ListOmniDeliveryAweme失败，接口调用超时，请稍后重试';

    await assert.rejects(fillStageTaskWithReopenRetry({}, 1, 4,
        { douyinId: '1234567890123456789', name: '测试剧' }, {
            fillStageTask: async () => {
                attempts++;
                throw new Error(saveErrorMsg);
            },
            cancelStageDialogForRetry: async () => { cleanups++; },
        }), (error: any) => {
            assert.equal(error.code, 'STAGE_SUBTASK_SAVE_EXHAUSTED');
            assert.match(error.message, /连续 3 轮仍无法完成/);
            return true;
        });

    assert.equal(attempts, UNIFIED.STAGE_DIALOG_REOPEN_MAX);
    assert.equal(cleanups, UNIFIED.STAGE_DIALOG_REOPEN_MAX);
});

test('弹窗保存等待关闭，超时不重复等待，监听器被清理', async () => {
    for (const hidden of [true, false]) {
        const page: any = new EventEmitter();
        const errorLocator = {
            filter() { return this; }, first() { return this; },
            waitFor: async () => { throw new Error('no error'); },
            innerText: async () => '',
            isVisible: async () => false,
        };
        page.locator = () => errorLocator;
        page.waitForFunction = async () => true;
        let waits = 0;
        const dialog = { waitFor: async () => {
            waits++;
            if (!hidden) throw new Error('timeout');
        } };
        const options = { timeoutMs: 100 };
        if (hidden) await waitStageSubmitResult(page, dialog, options);
        else await assert.rejects(waitStageSubmitResult(page, dialog, options), /timeout/);
        assert.equal(waits, 1);
        assert.equal(page.listenerCount('response'), 0);
    }
});

test('保存响应必须属于本次点击，业务失败和断网均阻止成功', async () => {
    for (const kind of ['success', 'http_error', 'business_error', 'broken', 'old_response', 'unrelated']) {
        const page: any = new EventEmitter();
        page.locator = () => ({ filter() { return this; }, first() { return this; },
            waitFor: async () => { throw new Error('no error'); }, isVisible: async () => false });
        page.waitForFunction = async () => {};
        const request = { url: () => kind === 'unrelated'
            ? 'https://usergrowth.com.cn/advertising/api/v1/product/list'
            : 'https://usergrowth.com.cn/advertising/api/v1/subtask/upsert', method: () => 'POST' };
        const operation = waitStageSubmitResult(page, { waitFor: async () => {} }, {
            timeoutMs: 100,
            submit: async () => {
                if (kind !== 'old_response') page.emit('request', request);
                if (kind === 'broken') page.emit('requestfailed', request);
                else page.emit('response', { request: () => request, status: () => kind === 'http_error' ? 400 : 200,
                    json: async () => ({ code: kind === 'business_error' ? 400 : 0 }) });
            },
        });
        if (['http_error', 'business_error', 'broken'].includes(kind)) {
            await assert.rejects(operation, /失败|中断/);
        } else {
            await operation;
        }
        for (const event of ['request', 'response', 'requestfailed']) assert.equal(page.listenerCount(event), 0);
    }
});

test('弹窗关闭且没有页面错误时不执行二次字段比对', async () => {
    const page: any = new EventEmitter();
    page.locator = () => ({ filter() { return this; }, first() { return this; },
        waitFor: async () => { throw new Error('no error'); }, isVisible: async () => false });
    page.waitForFunction = async () => {};
    await waitStageSubmitResult(page, { waitFor: async () => {} });
});

test('保存失败诊断保留接口状态、业务消息、断网和超时，清理监听器', async () => {
    for (const kind of ['business', 'http', 'parse', 'broken', 'timeout']) {
        const page: any = new EventEmitter();
        page.locator = () => ({ filter() { return this; }, first() { return this; },
            evaluateAll: async () => [],
            waitFor: async () => { throw new Error('no error'); }, isVisible: async () => false });
        page.waitForFunction = async () => {};
        const request = {
            url: () => 'https://usergrowth.com.cn/advertising/api/v1/subtask/upsert?token=secret-token',
            method: () => 'POST', failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }),
        };
        await assert.rejects(waitStageSubmitResult(page, { waitFor: () => new Promise(() => {}) }, {
            timeoutMs: 40,
            context: { subtaskIndex: 8, douyinId: '7692705601670875170' },
            submit: async () => {
                page.emit('request', request);
                if (kind === 'timeout') return;
                if (kind === 'broken') { page.emit('requestfailed', request); return; }
                page.emit('response', { request: () => request, status: () => kind === 'http' ? 503 : 200,
                    json: async () => {
                        if (kind === 'parse') throw new Error('invalid JSON');
                        return { code: 400, status_code: 12, msg: '项目名称校验失败', unrelated: 'secret-body' };
                    } });
            },
        }), (error: any) => {
            const status = error.diagnostics.requests[0];
            assert.equal(error.diagnostics.subtaskIndex, 8);
            assert.equal(status.endpoint, 'https://usergrowth.com.cn/advertising/api/v1/subtask/upsert');
            assert.doesNotMatch(JSON.stringify(error.diagnostics), /secret-token|secret-body/);
            if (kind === 'broken') {
                assert.equal(status.state, 'request_failed');
                assert.match(error.message, /ERR_CONNECTION_RESET/);
            } else if (kind === 'timeout') {
                assert.equal(status.state, 'pending');
                assert.match(error.message, /超时/);
            } else if (kind === 'parse') {
                assert.equal(status.state, 'parse_failed');
                assert.equal(status.httpStatus, 200);
                assert.match(error.message, /invalid JSON/);
            } else {
                assert.equal(status.httpStatus, kind === 'http' ? 503 : 200);
                assert.equal(status.code, 400);
                assert.equal(status.statusCode, 12);
                assert.match(error.message, /项目名称校验失败/);
            }
            return true;
        });
        const logged = JSON.parse(fs.readFileSync(getStructuredLogPath(), 'utf8').trim().split('\n').at(-1)!);
        assert.equal(logged.event, 'STAGE_SAVE_FAILURE');
        assert.equal(logged.subtaskIndex, 8);
        assert.equal(logged.requests[0].state, kind === 'broken' ? 'request_failed' : kind === 'timeout' ? 'pending' : kind === 'parse' ? 'parse_failed' : 'parsed');
        for (const event of ['request', 'response', 'requestfailed']) assert.equal(page.listenerCount(event), 0);
    }
});

test('STAGE_LINGERING_ERROR_PATTERN 正确匹配并忽略服务端负载高与 ListProduct 提示', () => {
    assert.match('ListProduct错误ListProduct失败，服务端负载高, 请稍后重试logid: 20261012151419CF65869E14205025DFAF', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('UpsertAutoCreateTask错误UpsertAutoCreateTask失败，投手参数校验失败', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('已被其它任务创建过项目', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('已被其他任务创建过项目', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('已被任务 66542003 创建过项目', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('UpsertAutoCreateTask失败，子任务 1：所选渠道无法核实当前原生内容，请稍后重试', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('子任务 4: 查询分销渠道失败，请稍后重试', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('UpsertAutoCreateTask失败，子任务 4：查询分销渠道失败，请稍后重试', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('UpsertAutoCreateTask失败，子任务 1: 查询客户所属供应商失败，请稍后重试', STAGE_LINGERING_ERROR_PATTERN);
    assert.match('子任务 1: 查询客户所属供应商失败，请稍后重试', STAGE_LINGERING_ERROR_PATTERN);
    assert.doesNotMatch('项目名称不能为空', STAGE_LINGERING_ERROR_PATTERN);
    assert.doesNotMatch('保存失败', STAGE_LINGERING_ERROR_PATTERN);
});

test('fillStageTask 搭剧执行逻辑不包含使用抖音作品id选择商品的流程', () => {
    const fnStr = fillStageTask.toString();
    assert.equal(fnStr.includes('selectStageProductById'), false);
    assert.equal(fnStr.includes('START_SELECT_PRODUCT'), false);
    assert.equal(fnStr.includes('STAGE_PRODUCT_SELECT_FAILED'), false);
});

test('fillStageTask 搭剧执行逻辑在填写ROI系数后增加点击商品匹配方式为自动匹配', () => {
    const fnStr = fillStageTask.toString();
    assert.equal(fnStr.includes('selectStageAutoProductMatch'), true);
    assert.equal(fnStr.includes('START_AUTO_MATCH'), true);
    assert.equal(fnStr.includes('AUTO_MATCH_COMPLETED'), true);
    const roiIndex = fnStr.indexOf('fillStageRoiRatio');
    const autoMatchIndex = fnStr.indexOf('selectStageAutoProductMatch');
    assert.ok(roiIndex > 0 && autoMatchIndex > roiIndex, 'selectStageAutoProductMatch 必须在 fillStageRoiRatio 之后调用');
});

