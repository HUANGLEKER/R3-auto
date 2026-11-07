// ============================================================
// Unit Tests: Logging, Error Classification & Diagnostics
// ============================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    classifyConsoleMessage,
    shouldSuppressConsole,
    consoleDurationText,
    consoleTimeText,
    addLogListener,
    writeConsoleLine,
} from '../../src/core/logger.ts';
import {
    getStructuredLogDir,
    getConsoleLogPath,
    getErrorLogPath,
    getLatestLogPath,
    appendConsoleLog,
    appendErrorLog,
    getRecentLogFiles,
    cleanOldStructuredLogs,
    flushLogBuffer,
} from '../../src/core/structured_log.ts';
import { formatTroubleshootingAdvice } from '../../src/core/utils.ts';

describe('Logger: 消息等级分类与标签映射 (Console Classification)', () => {
    test('error 级别的日志默认归类为 ERR 标签，不再错误降级为 INFO', () => {
        const classified = classifyConsoleMessage('Web backend start failed: Connection refused', 'error');
        assert.ok(classified);
        assert.equal(classified.tag, 'ERR');
        assert.match(classified.text, /Web backend start failed/);
    });

    test('warn 级别的日志默认归类为 WARN 标签', () => {
        const classified = classifyConsoleMessage('Slow response detected from upstream', 'warn');
        assert.ok(classified);
        assert.equal(classified.tag, 'WARN');
    });

    test('log 级别的前缀符号正确映射为对应语义标签', () => {
        assert.equal(classifyConsoleMessage('✅ 任务执行成功', 'log')?.tag, 'OK');
        assert.equal(classifyConsoleMessage('❌ 任务执行失败', 'log')?.tag, 'ERR');
        assert.equal(classifyConsoleMessage('⚠️ 发现潜在问题', 'log')?.tag, 'WARN');
        assert.equal(classifyConsoleMessage('⏳ 正在等待重试...', 'log')?.tag, 'WAIT');
        assert.equal(classifyConsoleMessage('🔄 重新加载页面', 'log')?.tag, 'RELOAD');
        assert.equal(classifyConsoleMessage('=== [1/10] 测试剧目 ===', 'log')?.tag, 'TASK');
    });

    test('ERR、WARN、STOP 标签绝不会被控制台日志过滤器静默过滤', () => {
        assert.equal(shouldSuppressConsole('ERR', 'Any error message'), false);
        assert.equal(shouldSuppressConsole('WARN', 'Any warning message'), false);
        assert.equal(shouldSuppressConsole('STOP', 'Process stopped'), false);
    });
});

describe('Diagnostics: 故障排查建议生成器 (formatTroubleshootingAdvice)', () => {
    test('正确识别并输出常见故障的针对性排查指引', () => {
        assert.match(
            formatTroubleshootingAdvice(new Error('未查询到对应端原生作品')) || '',
            /作品匹配失败/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('常读 OpenAPI 失败（HTTP 200，code 500）：QPS 已达上限')) || '',
            /接口限流/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('常读 OpenAPI 失败（HTTP 200，code 500）：访问速度过快')) || '',
            /接口限流/
        );
        assert.match(
            formatTroubleshootingAdvice(Object.assign(new Error('未知阻断'), { code: 'STAGE_TASK_BLOCKING_FAILURE' })) || '',
            /阻断性失败/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('缺少或未识别页面: 常读 - 免费漫剧列表')) || '',
            /浏览器环境异常/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('重复剧预检拦截: 已被其它任务创建过项目')) || '',
            /冲突去重拦截/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('投手参数校验失败:剧目 7690205370731464730 + 抖音号 37658739142 已被任务 66542003 创建过项目, 请勿重复配置')) || '',
            /冲突去重拦截/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('UpsertAutoCreateTask失败，子任务 1：所选渠道无法核实当前原生内容，请稍后重试')) || '',
            /接口限流/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('子任务 4: 查询分销渠道失败，请稍后重试')) || '',
            /接口限流/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('常读 OpenAPI /novelsale/openapi/content/aweme_series/list/v1/ 失败（HTTP 0，code 未知）：fetch failed')) || '',
            /接口限流/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('常读 OpenAPI /novelsale/openapi/content/aweme_series/list/v1/ 失败（HTTP 0，code 未知）：The operation was aborted due to timeout')) || '',
            /接口限流/
        );
        assert.match(
            formatTroubleshootingAdvice(new Error('常读 OpenAPI 分页提前结束')) || '',
            /作品匹配失败/
        );
    });
});

describe('File Logging: 文本执行日志与错误排查日志写入', () => {
    test('appendConsoleLog 正确写入 console 日志与 latest.log', () => {
        const testLine = `[TEST_${Date.now()}] 测试控制台日志行`;
        appendConsoleLog(testLine);
        flushLogBuffer();

        const consoleLog = fs.readFileSync(getConsoleLogPath(), 'utf8');
        assert.ok(consoleLog.includes(testLine));

        const latestLog = fs.readFileSync(getLatestLogPath(), 'utf8');
        assert.ok(latestLog.includes(testLine));
    });

    test('appendErrorLog 正确写入 error.log 并包含排查上下文', () => {
        const errorMsg = `测试致命异常_${Date.now()}`;
        appendErrorLog({
            time: '12:00:00',
            tag: 'ERR',
            level: 'error',
            text: errorMsg,
            code: 'TEST_CODE_500',
            stack: 'Error: test\n    at Object.test (test.ts:1:1)',
            context: { dramaId: '1234567890123456789' },
        });

        const errorLog = fs.readFileSync(getErrorLogPath(), 'utf8');
        assert.ok(errorLog.includes(errorMsg));
        assert.ok(errorLog.includes('TEST_CODE_500'));
        assert.ok(errorLog.includes('1234567890123456789'));
    });

    test('getRecentLogFiles 能够正确枚举日志目录下的日志文件', () => {
        const files = getRecentLogFiles();
        assert.ok(Array.isArray(files));
        assert.ok(files.length > 0);
        assert.ok(files.some(f => f.name.endsWith('.log') || f.name.endsWith('.jsonl')));
    });
});
