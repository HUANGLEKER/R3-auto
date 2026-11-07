import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { AuditStore } from '../../src/core/audit_store.ts';
import { currentRunId, scopedProxy, withRunContext } from '../../src/core/run_context.ts';
import { createSSEConnection } from '../../src/web/sse_connection.ts';
import { QueueScheduler } from '../../src/coordinator/queue_scheduler.ts';
import { ItemProcessor } from '../../src/coordinator/item_processor.ts';
import { PageCoordinator, type PageContext } from '../../src/coordinator/page_coordinator.ts';
import { platformId } from '../../src/contracts/platform.ts';
import { consoleEventSchema } from '../../src/contracts/console.ts';

test('运行资源跨异步边界隔离，长 ID 保持精度', async () => {
    const resources = scopedProxy('test-resource', () => new Map<string, string>());
    await Promise.all(['run-a', 'run-b'].map(id => withRunContext(id, async () => {
        resources.set('id', id);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(currentRunId(), id); assert.equal(resources.get('id'), id);
    })));
    assert.equal(platformId('7684258927520778290', 'book'), '7684258927520778290');
    assert.throws(() => platformId('1e19', 'playlet'), /无效/);
});

test('账本重启标记待核对；重复事件事务回滚且不改写完成项', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-ledger-'));
    let store = new AuditStore(directory);
    try {
        store.saveConfig({ roiRatio: '0.95', keywords: ['原始输入'] });
        store.beginRun('run-a', { status: 'running', startedAt: 1, items: [{ index: 1, keyword: '长 ID', status: 'running' } as any] });
        store.operation('run-a', 'paid:7684258927520778290', 'intent', { seriesId: '7684258927520778290' });
        store.event('run-a', 1, 'patch', {}, [{ index: 1, status: 'success' } as any]);
        assert.throws(() => store.event('run-a', 1, 'patch', {}, [{ index: 1, status: 'failed' } as any]));
        assert.equal((store.run('run-a') as any).items[0].status, 'success');
        store.close(); store = new AuditStore(directory); store.recoverInterrupted();
        const record = store.run('run-a') as any;
        assert.equal(record.status, 'needs_review'); assert.equal(record.operations[0].status, 'uncertain');
        assert.equal(record.operations[0].payload.seriesId, '7684258927520778290');
        assert.equal(record.items[0].status, 'success'); assert.equal(store.config()?.roiRatio, '0.95');
        store.recoverInterrupted(); assert.equal((store.run('run-a') as any).status, 'needs_review');
    } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('进程在配置导出中途和外部操作 intent 后退出：权威配置不混合，操作待核对', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-crash-'));
    let store: AuditStore | undefined;
    try {
        const child = spawnSync(process.execPath, [fileURLToPath(new URL('../fixtures/audit_crash.ts', import.meta.url)), directory], { windowsHide: true });
        assert.equal(child.status, 9, child.stderr.toString());
        store = new AuditStore(directory); store.recoverInterrupted();
        assert.equal(fs.readFileSync(path.join(directory, 'roi系数.txt'), 'utf8'), '9');
        assert.equal(store.config()?.roiRatio, '0.95'); assert.equal(store.config()?.paidTemplate, '中额');
        const record = store.run('interrupted-run') as any;
        assert.equal(record.status, 'needs_review'); assert.equal(record.operations.length, 2);
        assert.ok(record.operations.every((operation: any) => operation.status === 'uncertain'));
    } finally { store?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('SSE 慢客户端按 drain 顺序发送，超界断开且释放队列', () => {
    const response = new EventEmitter() as EventEmitter & { write(value: string): boolean; destroy(): void };
    const written: string[] = []; let writable = false, destroyed = false;
    response.write = value => { written.push(value); return writable; };
    response.destroy = () => { destroyed = true; response.emit('close'); };
    const sink = createSSEConnection(response as unknown as ServerResponse, 8, 20);
    sink.write('a'); sink.write('bc'); sink.write('de');
    assert.deepEqual(written, ['a']); assert.equal(sink.queuedBytes(), 4);
    writable = true; response.emit('drain'); assert.deepEqual(written, ['a', 'bc', 'de']);
    writable = false; sink.write('f'); sink.write('12345678'); sink.write('x');
    assert.equal(destroyed, true); assert.equal(sink.queuedBytes(), 0); assert.equal(response.listenerCount('drain'), 0);
});

test('排队预算耗尽与平台不确定结果由类型控制', async () => {
    const scheduler = new QueueScheduler(['甲', '乙']); const first = scheduler.items[0];
    assert.equal(scheduler.deferSelection(first), true); assert.equal(scheduler.items.at(-1), first);
    assert.equal(scheduler.deferSelection(first), false);
    assert.equal(scheduler.deferRateLimit(first), true); assert.equal(scheduler.deferRateLimit(first), true);
    assert.equal(scheduler.deferRateLimit(first), false);
    const processor = new ItemProcessor({ async get() { return { ok: false, status: '结果不确定', attempts: [], category: 'uncertain' }; }, prefetch() {}, abort() {}, async drain() {} });
    await assert.rejects(processor.resolve('甲', 0), (error: any) => error.category === 'uncertain');
    const cancellation = new AbortController(); cancellation.abort(new Error('停止'));
    await assert.rejects(processor.resolve('甲', 0, cancellation.signal), /停止/);
});

test('页提交不确定后禁止第二次发送；未开始的提交保留 pending', async () => {
    let calls = 0;
    const context: PageContext = { stageStates: [{ submitStatus: 'pending', replacementSlots: [], fillUncertain: false }],
        activeStageTabIndex: 0, currentSubtaskInTab: 2, stageCapacities: [1], stagePages: [{} as any], filledTasks: [],
        successCount: 0, keywords: ['甲'], processedCount: 1, failedDramas: [], nextEmptySlot: () => 1,
        async submitStagePage() { calls++; throw new Error('响应丢失'); } };
    const coordinator = new PageCoordinator(context);
    await assert.rejects(coordinator.submit(), /响应丢失/); await coordinator.submit();
    assert.equal(calls, 1); assert.equal(context.stageStates[0].submitStatus, 'uncertain');
    context.stageStates[0].submitStatus = 'pending';
    context.submitStagePage = async () => { throw Object.assign(new Error('未开始'), { code: 'STAGE_SUBMIT_NOT_STARTED' }); };
    await assert.rejects(coordinator.submit(), /未开始/); assert.equal(context.stageStates[0].submitStatus, 'pending');
});

test('整页提交遇渠道限流（无法核实当前原生内容）使用退避算法反复提交，直至提交成功', async () => {
    let calls = 0;
    const delays: number[] = [];
    const context: PageContext = {
        stageStates: [{ submitStatus: 'pending', replacementSlots: [], fillUncertain: false }],
        activeStageTabIndex: 0, currentSubtaskInTab: 2, stageCapacities: [1], stagePages: [{} as any],
        filledTasks: [{ keyword: '甲', dramaName: '甲', seriesId: '1', douyinId: '1', tabIndex: 1, subtaskIndex: 1, completedAt: '' }],
        successCount: 0, keywords: ['甲'], processedCount: 1, failedDramas: [], nextEmptySlot: () => 1,
        options: { submitBackoffBaseMs: 10, submitBackoffMaxMs: 50 },
        delay: async (ms) => { delays.push(ms); },
        async submitStagePage() {
            calls++;
            if (calls < 3) {
                return { kind: 'retryable', message: 'UpsertAutoCreateTask失败，子任务 1：所选渠道无法核实当前原生内容，请稍后重试' };
            }
            return { kind: 'success' };
        },
    };
    const coordinator = new PageCoordinator(context);
    await coordinator.submit();
    assert.equal(calls, 3);
    assert.equal(delays.length, 2);
    assert.equal(context.stageStates[0].submitStatus, 'submitted');
    assert.equal(context.successCount, 1);
});

test('整页提交遇渠道无法核实当前原生内容且存在后续剧时，暂缓当前页提交并标记 deferred', async () => {
    let calls = 0;
    const delays: number[] = [];
    const context: PageContext = {
        stageStates: [{ submitStatus: 'pending', replacementSlots: [], fillUncertain: false }],
        activeStageTabIndex: 0, currentSubtaskInTab: 2, stageCapacities: [1], stagePages: [{} as any],
        filledTasks: [{ keyword: '甲', dramaName: '甲', seriesId: '1', douyinId: '1', tabIndex: 1, subtaskIndex: 1, completedAt: '' }],
        successCount: 0, keywords: ['甲', '乙'], processedCount: 1, failedDramas: [], nextEmptySlot: () => 1,
        options: { submitBackoffBaseMs: 10, submitBackoffMaxMs: 50 },
        hasSubsequentDramas: () => true,
        delay: async (ms) => { delays.push(ms); },
        async submitStagePage() {
            calls++;
            return { kind: 'retryable', message: 'UpsertAutoCreateTask失败，子任务 1：所选渠道无法核实当前原生内容，请稍后重试' };
        },
    };
    const coordinator = new PageCoordinator(context);
    await coordinator.submit();
    assert.equal(calls, 1, '遇到原生内容未核实且有后续剧时不应在当前页循环退避');
    assert.equal(delays.length, 0);
    assert.equal(context.stageStates[0].submitStatus, 'deferred');
    assert.equal(context.successCount, 0);
});

test('新 Tab 所有子任务搭完后，再次提交先前暂缓的 Tab 并提交新 Tab', async () => {
    const submittedTabs: number[] = [];
    const context: PageContext = {
        stageStates: [
            { submitStatus: 'deferred', replacementSlots: [], fillUncertain: false },
            { submitStatus: 'pending', replacementSlots: [], fillUncertain: false },
        ],
        activeStageTabIndex: 1,
        currentSubtaskInTab: 2,
        stageCapacities: [1, 1],
        stagePages: [{ name: 'page1' } as any, { name: 'page2' } as any],
        filledTasks: [
            { keyword: '甲', dramaName: '甲', seriesId: '1', douyinId: '1', tabIndex: 1, subtaskIndex: 1, completedAt: '' },
            { keyword: '乙', dramaName: '乙', seriesId: '2', douyinId: '2', tabIndex: 2, subtaskIndex: 1, completedAt: '' },
        ],
        successCount: 0,
        keywords: ['甲', '乙'],
        processedCount: 2,
        failedDramas: [],
        nextEmptySlot: () => 2,
        async submitStagePage(page: any) {
            submittedTabs.push(page.name === 'page1' ? 1 : 2);
            return { kind: 'success' };
        },
    };
    const coordinator = new PageCoordinator(context);
    await coordinator.submit();

    // 先提交暂缓的第 1 页，再提交已搭满的第 2 页
    assert.deepEqual(submittedTabs, [1, 2]);
    assert.equal(context.stageStates[0].submitStatus, 'submitted');
    assert.equal(context.stageStates[1].submitStatus, 'submitted');
    assert.equal(context.successCount, 2);
});

test('先前暂缓的 Tab 重新提交成功后，自动关闭对应 Tab', async () => {
    let closedPage1 = false;
    let closedPage2 = false;
    const context: PageContext = {
        stageStates: [
            { submitStatus: 'deferred', replacementSlots: [], fillUncertain: false },
            { submitStatus: 'pending', replacementSlots: [], fillUncertain: false },
        ],
        activeStageTabIndex: 1,
        currentSubtaskInTab: 2,
        stageCapacities: [1, 1],
        stagePages: [
            { name: 'page1', isClosed: () => false, close: async () => { closedPage1 = true; } } as any,
            { name: 'page2', isClosed: () => false, close: async () => { closedPage2 = true; } } as any,
        ],
        filledTasks: [
            { keyword: '甲', dramaName: '甲', seriesId: '1', douyinId: '1', tabIndex: 1, subtaskIndex: 1, completedAt: '' },
            { keyword: '乙', dramaName: '乙', seriesId: '2', douyinId: '2', tabIndex: 2, subtaskIndex: 1, completedAt: '' },
        ],
        successCount: 0,
        keywords: ['甲', '乙'],
        processedCount: 2,
        failedDramas: [],
        nextEmptySlot: () => 2,
        async submitStagePage() {
            return { kind: 'success' };
        },
    };
    const coordinator = new PageCoordinator(context);
    await coordinator.submit();

    assert.equal(closedPage1, true, '先前暂缓的第 1 页在重新提交成功后应立即自动关闭');
    assert.equal(closedPage2, false, '当前活跃的第 2 页在 submitTab 中不应被提前关闭（由 runner 在新 Tab 就绪或末页关闭）');
});

test('新 Tab 尚未搭满时，不触发先前暂缓 Tab 的再次提交', async () => {
    let calls = 0;
    const context: PageContext = {
        stageStates: [
            { submitStatus: 'deferred', replacementSlots: [], fillUncertain: false },
            { submitStatus: 'pending', replacementSlots: [], fillUncertain: false },
        ],
        activeStageTabIndex: 1,
        currentSubtaskInTab: 1, // 容量为 2，当前为 1，尚未搭满
        stageCapacities: [1, 2],
        stagePages: [{ name: 'page1' } as any, { name: 'page2' } as any],
        filledTasks: [
            { keyword: '甲', dramaName: '甲', seriesId: '1', douyinId: '1', tabIndex: 1, subtaskIndex: 1, completedAt: '' },
        ],
        successCount: 0,
        keywords: ['甲', '乙', '丙'],
        processedCount: 1,
        failedDramas: [],
        nextEmptySlot: () => 1,
        hasSubsequentDramas: () => true,
        async submitStagePage() {
            calls++;
            return { kind: 'success' };
        },
    };
    const coordinator = new PageCoordinator(context);
    await coordinator.submit();

    assert.equal(calls, 0);
    assert.equal(context.stageStates[0].submitStatus, 'deferred');
    assert.equal(context.stageStates[1].submitStatus, 'pending');
});

test('整页提交退避重试期间收到 abort 信号安全停止，状态恢复为 pending', async () => {
    const controller = new AbortController();
    const context: PageContext = {
        stageStates: [{ submitStatus: 'pending', replacementSlots: [], fillUncertain: false }],
        activeStageTabIndex: 0, currentSubtaskInTab: 2, stageCapacities: [1], stagePages: [{} as any],
        filledTasks: [{ keyword: '甲', dramaName: '甲', seriesId: '1', douyinId: '1', tabIndex: 1, subtaskIndex: 1, completedAt: '' }],
        successCount: 0, keywords: ['甲'], processedCount: 1, failedDramas: [], nextEmptySlot: () => 1,
        options: { abortSignal: controller.signal, submitBackoffBaseMs: 10 },
        delay: async (_ms, _val, opts) => {
            controller.abort();
            opts?.signal?.throwIfAborted();
        },
        async submitStagePage() {
            return { kind: 'retryable', message: '所选渠道无法核实当前原生内容' };
        },
    };
    const coordinator = new PageCoordinator(context);
    await assert.rejects(coordinator.submit(), /abort/i);
    assert.equal(context.stageStates[0].submitStatus, 'pending');
});

test('共享事件契约拒绝未知版本、状态和负序号', () => {
    const event = { protocolVersion: 1, runId: 'run-a', seq: 1, kind: 'patch', data: { items: [{ index: 1, keyword: '甲', status: 'success' }] } };
    assert.equal(consoleEventSchema.safeParse(event).success, true);
    assert.equal(consoleEventSchema.safeParse({ ...event, protocolVersion: 2 }).success, false);
    assert.equal(consoleEventSchema.safeParse({ ...event, seq: -1 }).success, false);
    assert.equal(consoleEventSchema.safeParse({ ...event, data: { items: [{ index: 1, keyword: '甲', status: '完成' }] } }).success, false);
});
