// ============================================================
// BAT / CMD Console UI & Logging Layer
// ============================================================

import util from 'node:util';
import {faultService} from './service_health.ts';
import {BAT_LOG_LEVEL} from './config.ts';
import {appendConsoleLog, appendErrorLog, writeStructuredLog} from './structured_log.ts';
import type {
    ConsoleWriteOptions,
    ConsoleClassification,
} from '../types/index.ts';

export const RAW_CONSOLE = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

export const CONSOLE_LAST_MESSAGE = new Map<string, number>();

export function consoleTimeText(): string {
    const now = new Date();
    return [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join(':');
}

export function consoleDurationText(ms: unknown): string {
    const value = Number(ms);

    if (!Number.isFinite(value)) {
        return String(ms);
    }

    if (value < 1000) {
        return `${Math.round(value)}ms`;
    }

    if (value < 60000) {
        return `${(value / 1000).toFixed(2)}s`;
    }

    const min = Math.floor(value / 60000);
    const sec = ((value % 60000) / 1000).toFixed(1);
    return `${min}m${sec}s`;
}

export function compactAwemeForConsole(value: unknown): string {
    return String(value || '').replace(
        /aweme:\/\/[^\s"'<>]+/gi,
        raw => {
            const id =
                raw.match(
                    /[?&]playlet_id=(\d{10,30})(?:[&#]|$)/i
                )?.[1] || '';

            if (id) {
                return (
                    `aweme://playlet?playlet_id=${id}` +
                    ' [完整链接已获取]'
                );
            }

            return raw.length > 100
                ? `${raw.slice(0, 96)}...`
                : raw;
        }
    );
}

export function compactHttpForConsole(value: unknown): string {
    return String(value || '').replace(
        /https?:\/\/[^\s]+/gi,
        raw => {
            try {
                const parsed = new URL(raw);
                let result =
                    `${parsed.hostname}${parsed.pathname}`;

                // 页面识别/业务 XHR 日志不展开长 query。
                // 只有 query 中包含短剧ID/作品ID时保留关键字段。
                const important = [];

                for (const key of [
                    'book_id',
                    'query',
                    'playlet_id',
                ]) {
                    const current =
                        parsed.searchParams.get(key);

                    if (current) {
                        important.push(
                            `${key}=${current}`
                        );
                    }
                }

                if (important.length > 0) {
                    result +=
                        `?${important.join('&')}`;
                }

                return result.length > 130
                    ? `${result.slice(0, 126)}...`
                    : result;
            } catch (_) {
                return raw.length > 130
                    ? `${raw.slice(0, 126)}...`
                    : raw;
            }
        }
    );
}

export function compactDurationsForConsole(value: unknown): string {
    return String(value || '').replace(
        /\b(\d{1,9})ms\b/g,
        (_, ms) =>
            consoleDurationText(Number(ms))
    );
}

export function normalizeConsoleText(value: unknown): string {
    return compactDurationsForConsole(
        compactHttpForConsole(
            compactAwemeForConsole(
                String(value || '')
                    .replace(/\r/g, '')
                    .trim()
            )
        )
    );
}

export function classifyConsoleMessage(
    original: unknown,
    level: 'log' | 'warn' | 'error' = 'log'
): ConsoleClassification | null {
    let text = normalizeConsoleText(original);

    if (!text) {
        return null;
    }

    // 原脚本视觉分隔线统一由 Item / Summary 格式替代。
    if (/^[=\-─]{8,}$/.test(text)) {
        return null;
    }

    const item =
        text.match(
            /^===\s*\[(\d+)\/(\d+)\]\s*(.*?)\s*===$/
        );

    if (item) {
        const current =
            String(item[1]).padStart(
                String(item[2]).length,
                '0'
            );

        return {
            tag: 'TASK',
            text:
                `──────── [${current}/${item[2]}] ` +
                `${item[3]} ────────`,
            forceBlankBefore: true,
        };
    }

    const mappings: Array<[RegExp, string]> = [
        [/^✅\s*/, 'OK'],
        [/^❌\s*/, 'ERR'],
        [/^⚠️\s*/, 'WARN'],
        [/^⛔\s*/, 'STOP'],
        [/^⏭️\s*/, 'SKIP'],
        [/^🔎\s*/, 'CHECK'],
        [/^📊\s*/, 'LOG'],
        [/^📅\s*/, 'DATE'],
        [/^🔗\s*/, 'NAV'],
        [/^⏳\s*/, 'WAIT'],
        [/^🔄\s*/, 'RELOAD'],
        [/^⚡\s*/, 'CACHE'],
        [/^🔒\s*/, 'LOCK'],
        [/^🔐\s*/, 'LOCK'],
        [/^♻️\s*/, 'RETRY'],
        [/^ℹ️\s*/, 'INFO'],
        [/^⏱\s*/, 'TIME'],
        [/^🗑️?\s*/, 'DELETE'],
    ];

    for (const [pattern, tag] of mappings) {
        if (pattern.test(text)) {
            text = text.replace(pattern, '');
            return {tag, text};
        }
    }

    // 常见业务阶段做统一标签。
    if (/^搭剧[:：]/.test(text)) {
        return {
            tag: 'STAGE',
            text: text.replace(
                /^搭剧[:：]\s*/,
                ''
            ),
        };
    }

    if (
        /^(内容搜索XHR|自动匹配XHR|保存XHR)[:：]/i
            .test(text)
    ) {
        return {tag: 'XHR', text};
    }

    if (
        /搜索框已真实清空|输入作品ID|下拉显示“暂无数据”|搜索完成但未检测到可选项/
            .test(text)
    ) {
        return {tag: 'SEARCH', text};
    }

    if (/^\[候选\s+\d+\/\d+\]/.test(text)) {
        return {tag: 'CAND', text};
    }

    if (/^当前常读页面识别结果[:：]?$/.test(text)) {
        return {
            tag: 'INIT',
            text: '常读页面识别结果',
            forceBlankBefore: true,
        };
    }

    if (
        /^(free|paid)\/(list|promotion)\b/
            .test(text)
    ) {
        return {tag: 'PAGE', text};
    }

    if (
        /^常读 \+ 搭剧统一流程/.test(text)
    ) {
        return {
            tag: 'START',
            text,
            forceBlankBefore: true,
        };
    }

    if (
        /^处理完成[:：]/.test(text) ||
        /^总耗时[:：]/.test(text) ||
        /^P2统计[:：]/.test(text) ||
        /^未生成 Excel\/CSV/.test(text)
    ) {
        return {tag: 'SUMMARY', text};
    }

    // 错误或警告级别必须保留对应标签，防止被错误地归为 INFO
    if (level === 'error') {
        return {tag: 'ERR', text};
    }

    if (level === 'warn') {
        return {tag: 'WARN', text};
    }

    // 原来大量使用前导空格表示子步骤，这里统一成 STEP。
    if (/^\s+/.test(String(original))) {
        return {
            tag: 'STEP',
            text,
        };
    }

    return {tag: 'INFO', text};
}

export function shouldSuppressConsole(tag: string, text: string): boolean {
    if (BAT_LOG_LEVEL === 'debug') {
        return false;
    }

    // 关键错误和警告绝对不静默过滤
    if (tag === 'ERR' || tag === 'WARN' || tag === 'STOP') {
        return false;
    }

    // 过滤与核心业务无关的技术噪音日志
    if (
        tag === 'XHR' ||
        tag === 'SEARCH' ||
        tag === 'CACHE' ||
        tag === 'LOCK'
    ) {
        return true;
    }

    // 过滤底层细节文本
    if (
        /seriesId\s*内存缓存命中|DOM\s*value\s*已校验|未生成 Excel\/CSV|运行完成标记已写入|JSONL 结构化日志/i.test(text)
    ) {
        return true;
    }

    if (BAT_LOG_LEVEL === 'compact') {
        if (
            tag === 'INFO' &&
            (
                /^(IAA =|规则[:：]|P0\/P1\/P2|不读取 Excel)/.test(text)
            )
        ) {
            return true;
        }
    }

    return false;
}

export type LogListener = (entry: {
    time: string;
    tag: string;
    level: 'info' | 'warn' | 'error';
    text: string;
    stack?: string;
}) => void;

const logListeners = new Set<LogListener>();

export function addLogListener(listener: LogListener): () => void {
    logListeners.add(listener);
    return () => {
        logListeners.delete(listener);
    };
}

export function writeConsoleLine(
    level: 'log' | 'warn' | 'error',
    tag: string,
    text: string,
    options: ConsoleWriteOptions = {}
): void {
    if (shouldSuppressConsole(tag, text)) {
        return;
    }

    const now = Date.now();
    const dedupeKey =
        `${level}|${tag}|${text}`;

    // 1 秒内完全相同的日志只显示一次，
    // 避免多个 watcher 同时完成造成重复刷屏。
    const lastAt =
        CONSOLE_LAST_MESSAGE.get(dedupeKey) || 0;

    if (
        now - lastAt < 1000 &&
        !['ERR', 'WARN', 'STOP'].includes(tag)
    ) {
        return;
    }

    CONSOLE_LAST_MESSAGE.set(
        dedupeKey,
        now
    );

    const timeStr = consoleTimeText();
    const mappedLevel = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';

    // 1. 同步持久化至文本日志与错误排查日志
    const plainPrefix = `[${timeStr}] [${String(tag).padEnd(7, ' ')}]`;
    appendConsoleLog(`${plainPrefix} ${text}`);
    if (mappedLevel === 'error' || mappedLevel === 'warn' || tag === 'ERR' || tag === 'WARN' || tag === 'STOP') {
        appendErrorLog({
            time: timeStr,
            tag,
            level: mappedLevel,
            text,
        });
    }

    // 2. 通知外部监听者（如 Web 控制台）
    for (const listener of logListeners) {
        try {
            listener({
                time: timeStr,
                tag,
                level: mappedLevel,
                text,
            });
        } catch (_) {
        }
    }

    if (options.forceBlankBefore) {
        RAW_CONSOLE.log('');
    }

    // 3. 针对控制台多行文本（如堆栈信息），进行规范对齐排版
    const lines = text.split('\n');
    const firstLine = `${plainPrefix} ${lines[0]}`;
    const outputLines = [firstLine];
    const indent = ' '.repeat(plainPrefix.length + 1);
    for (let i = 1; i < lines.length; i++) {
        outputLines.push(`${indent}${lines[i]}`);
    }
    const line = outputLines.join('\n');

    if (level === 'error') {
        RAW_CONSOLE.error(line);
    } else if (level === 'warn') {
        RAW_CONSOLE.warn(line);
    } else {
        RAW_CONSOLE.log(line);
    }
}

let globalErrorHandlersInstalled = false;

export function installGlobalErrorHandlers(): void {
    if (globalErrorHandlersInstalled) return;
    globalErrorHandlersInstalled = true;

    process.on('uncaughtException', (err: Error) => {
        faultService(err);
        const message = err?.stack || err?.message || String(err);
        writeConsoleLine('error', 'ERR', `💥 未捕获的全局异常 (UncaughtException): ${message}`);
        writeStructuredLog('GLOBAL_UNCAUGHT_EXCEPTION', {
            error: err?.message,
            stack: err?.stack,
        });
    });

    process.on('unhandledRejection', (reason: unknown) => {
        faultService(reason);
        const message = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
        writeConsoleLine('error', 'ERR', `💥 未处理的Promise拒绝 (UnhandledRejection): ${message}`);
        writeStructuredLog('GLOBAL_UNHANDLED_REJECTION', {
            error: String(reason),
            stack: reason instanceof Error ? reason.stack : undefined,
        });
    });
}

export function installReadableConsole(): void {
    installGlobalErrorHandlers();

    const wrap =
        (level: 'log' | 'warn' | 'error') =>
            (...args: any[]) => {
                const raw =
                    util.format(...args);

                const classified =
                    classifyConsoleMessage(raw, level);

                if (!classified) {
                    return;
                }

                writeConsoleLine(
                    level,
                    classified.tag,
                    classified.text,
                    classified
                );
            };

    console.log = wrap('log');
    console.warn = wrap('warn');
    console.error = wrap('error');
}

/** 结构化日志辅助对象，统一快捷输出规范日志 */
export const logger = {
    info: (message: string) => console.log(message),
    ok: (message: string) => console.log(`✅ ${message}`),
    warn: (message: string) => console.warn(`⚠️ ${message}`),
    error: (message: string, err?: unknown) => {
        if (err instanceof Error && err.stack) {
            console.error(`❌ ${message}\n${err.stack}`);
        } else if (err) {
            console.error(`❌ ${message} (${util.format(err)})`);
        } else {
            console.error(`❌ ${message}`);
        }
    },
    step: (message: string) => console.log(`   ${message}`),
    task: (current: number, total: number, name: string) => console.log(`=== [${current}/${total}] ${name} ===`),
    summary: (message: string) => console.log(`处理完成: ${message}`),
};
