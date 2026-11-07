// ============================================================
// Unit Tests: 配置单一真相源 (SSOT) 与 DB 批量落账 / 日志缓冲优化
// ============================================================

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AuditStore } from '../../src/core/audit_store.ts';
import {
    writeStructuredLog,
    appendConsoleLog,
    appendErrorLog,
    flushLogBuffer,
    getConsoleLogPath,
    getLatestLogPath,
    getErrorLogPath,
    getStructuredLogPath,
} from '../../src/core/structured_log.ts';

describe('配置单一真相源 (SQLite SSOT) 行为验证', () => {
    let tmpDir: string;
    let store: AuditStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-ssot-test-'));
        store = new AuditStore(tmpDir);
    });

    afterEach(() => {
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('SQLite config 是权威配置来源，支持保存与全字段读取', () => {
        const testConfig = {
            keywords: ['权威剧目A', '权威剧目B'],
            copyUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=1001'],
            roiRatio: '1.35',
            paidTemplate: '小额',
        };

        store.saveConfig(testConfig);
        const loaded = store.config() as any;

        assert.ok(loaded);
        assert.deepEqual(loaded.keywords, testConfig.keywords);
        assert.deepEqual(loaded.copyUrls, testConfig.copyUrls);
        assert.equal(loaded.roiRatio, '1.35');
        assert.equal(loaded.paidTemplate, '小额');
    });

    test('保存配置具有 ACID 事务原子性，部分字段异常不破坏已有配置', () => {
        store.saveConfig({ roiRatio: '1.0', keywords: ['初始剧'] });
        const initial = store.config();

        assert.throws(() => {
            store.transaction(() => {
                store.saveConfig({ roiRatio: '2.0', keywords: ['非法剧'] });
                throw new Error('模拟事务回滚');
            });
        });

        const current = store.config();
        assert.deepEqual(current, initial);
    });
});

describe('AuditStore 批量落账 (Batch Commit) 机制验证', () => {
    let tmpDir: string;
    let store: AuditStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-batch-commit-'));
        store = new AuditStore(tmpDir);
    });

    afterEach(() => {
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('连续高频写入 operation 与 event 时进行批量合并，读操作前自动 flush 保证强一致性', () => {
        const runId = 'batch-run-1';
        store.beginRun(runId, {
            status: 'running',
            startedAt: Date.now(),
            items: [
                { index: 1, keyword: '剧目1', status: 'running' } as any,
                { index: 2, keyword: '剧目2', status: 'running' } as any,
            ],
        });

        // 连续产生多个 operations 与 events
        store.operation(runId, 'page:1', 'filling', { tabIndex: 1 });
        store.event(runId, 1, 'item_patch', { step: 'filling' }, [{ index: 1, status: 'filling' } as any]);
        store.operation(runId, 'page:1', 'success', { tabIndex: 1 });
        store.event(runId, 2, 'item_success', { step: 'done' }, [{ index: 1, status: 'success' } as any]);

        // 直接读取，底层自动执行 flushPending()，确保即时读到最新数据
        const runData = store.run(runId) as any;
        assert.ok(runData);
        assert.equal(runData.items[0].status, 'success');
        assert.equal(runData.operations.length, 1);
        assert.equal(runData.operations[0].status, 'success');
    });

    test('对重复的 (run_id, seq) 实施即时冲突拦截', () => {
        const runId = 'batch-run-dup';
        store.beginRun(runId, {
            status: 'running',
            startedAt: Date.now(),
            items: [{ index: 1, keyword: '测试剧', status: 'running' } as any],
        });

        store.event(runId, 1, 'step1', { val: 1 });
        assert.throws(() => {
            store.event(runId, 1, 'step1_dup', { val: 2 });
        }, /UNIQUE constraint/);
    });
});

describe('日志缓冲与低 I/O 成本写入器验证', () => {
    test('缓冲写入控制台与结构化日志，flushLogBuffer 一次性持久化', () => {
        const uniqueId = `BATCH_LOG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        appendConsoleLog(`[INFO] 测试控制台日志缓冲行: ${uniqueId}`);
        writeStructuredLog('TEST_BATCH_EVENT', { marker: uniqueId });

        // 主动 flush
        flushLogBuffer();

        const consoleContent = fs.readFileSync(getConsoleLogPath(), 'utf8');
        assert.ok(consoleContent.includes(uniqueId));

        const structuredContent = fs.readFileSync(getStructuredLogPath(), 'utf8');
        assert.ok(structuredContent.includes(uniqueId));
    });

    test('appendErrorLog 自动同步 flush 缓冲并写入 error.log', () => {
        const errorMarker = `ERROR_MARKER_${Date.now()}`;
        appendErrorLog({
            time: '12:00:00',
            tag: 'ERR',
            level: 'error',
            text: `严重异常: ${errorMarker}`,
            code: 'TEST_ERR_IO',
        });

        const errorContent = fs.readFileSync(getErrorLogPath(), 'utf8');
        assert.ok(errorContent.includes(errorMarker));
        assert.ok(errorContent.includes('TEST_ERR_IO'));
    });
});
