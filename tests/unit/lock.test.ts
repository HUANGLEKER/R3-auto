// ============================================================
// Unit Tests: Lock & Concurrency Control
// ============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RUN_LOCK_PATH } from '../../src/core/paths.ts';
import {
    isProcessAlive,
    withPromoViewLock,
    acquireSingleInstanceLock, releaseSingleInstanceLock, RUN_LOCK_GATE_PATH,
} from '../../src/core/lock.ts';

describe('Lock & Mutex: 并发锁与剪贴板排队互斥', () => {
    test('isProcessAlive 正确检测当前进程存活性', () => {
        // 当前进程自身一定处于存活状态
        assert.equal(isProcessAlive(process.pid), true);

        // 负数或无效 PID 应返回 false
        assert.equal(isProcessAlive(-1), false);
        assert.equal(isProcessAlive(0), false);
        assert.equal(isProcessAlive(null), false);
        assert.equal(isProcessAlive(undefined), false);

        // 一个极大且极不可能存在的 PID
        assert.equal(isProcessAlive(99999999), false);
    });

    test('withPromoViewLock 保证并发任务严格串行化执行', async () => {
        const executionOrder: number[] = [];

        const task1 = withPromoViewLock(async () => {
            await new Promise(r => setTimeout(r, 50));
            executionOrder.push(1);
            return 'res1';
        });

        const task2 = withPromoViewLock(async () => {
            await new Promise(r => setTimeout(r, 10));
            executionOrder.push(2);
            return 'res2';
        });

        const task3 = withPromoViewLock(async () => {
            executionOrder.push(3);
            return 'res3';
        });

        const [r1, r2, r3] = await Promise.all([task1, task2, task3]);

        assert.equal(r1, 'res1');
        assert.equal(r2, 'res2');
        assert.equal(r3, 'res3');
        assert.deepEqual(executionOrder, [1, 2, 3], '任务必须按照排队次序严格串行执行');
    });
});

test('损坏、空锁及遗留获取目录均阻断；释放只删除自己的令牌', () => {
    assert.ok(process.env.R3_DATA_DIR);
    try {
        for (const raw of ['', '{', '{}', JSON.stringify({ pid: '123' })]) {
            fs.writeFileSync(RUN_LOCK_PATH, raw);
            assert.throws(acquireSingleInstanceLock, /损坏|尚未写完/);
            assert.equal(fs.readFileSync(RUN_LOCK_PATH, 'utf8'), raw);
        }
        fs.unlinkSync(RUN_LOCK_PATH);
        fs.mkdirSync(RUN_LOCK_GATE_PATH);
        assert.throws(acquireSingleInstanceLock, /获取目录/);
        fs.rmdirSync(RUN_LOCK_GATE_PATH);
        acquireSingleInstanceLock();
        assert.throws(acquireSingleInstanceLock, /已有任务/);
        fs.writeFileSync(RUN_LOCK_PATH, JSON.stringify({ pid: process.pid, token: 'replacement' }));
        releaseSingleInstanceLock();
        assert.equal(JSON.parse(fs.readFileSync(RUN_LOCK_PATH, 'utf8')).token, 'replacement');
    } finally {
        releaseSingleInstanceLock();
        if (fs.existsSync(RUN_LOCK_PATH)) fs.unlinkSync(RUN_LOCK_PATH);
        if (fs.existsSync(RUN_LOCK_GATE_PATH)) fs.rmdirSync(RUN_LOCK_GATE_PATH);
    }
});
