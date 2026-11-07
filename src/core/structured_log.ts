// ============================================================
// P2：JSONL Structured Logging & Audit Trail
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.ts';
import { currentRunId, processSessionId } from './run_context.ts';
import { faultService } from './service_health.ts';

export const RUN_ID = processSessionId;

export function getStructuredLogDir(): string {
    const baseDir = process.env.R3_DATA_DIR ? path.resolve(process.env.R3_DATA_DIR) : DATA_DIR;
    return path.join(baseDir, 'logs');
}

export const STRUCTURED_LOG_DIR = path.join(
    DATA_DIR,
    'logs'
);

function ensureLogDir(): string {
    const dir = getStructuredLogDir();
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (_) {}
    }
    return dir;
}

ensureLogDir();

function resolveStructuredLogPath(runId = currentRunId()): string {
    return path.join(getStructuredLogDir(), `${runId}.jsonl`);
}

function resolveConsoleLogPath(runId = currentRunId()): string {
    return path.join(getStructuredLogDir(), `${runId}.log`);
}

function resolveErrorLogPath(): string {
    return path.join(getStructuredLogDir(), 'error.log');
}

function resolveLatestLogPath(): string {
    return path.join(getStructuredLogDir(), 'latest.log');
}

// ------------------------------------------------------------
// 高性能批量日志写入器 (Buffered Batch Log Writer)
// ------------------------------------------------------------
const logBuffers = new Map<string, string[]>();
let logFlushTimer: NodeJS.Timeout | null = null;
const MAX_LOG_BUFFER_LINES = 25;
const LOG_FLUSH_DELAY_MS = 25;

export function flushLogBuffer(): void {
    if (logFlushTimer) {
        clearTimeout(logFlushTimer);
        logFlushTimer = null;
    }
    if (logBuffers.size === 0) return;

    for (const [filePath, lines] of logBuffers.entries()) {
        if (!lines || lines.length === 0) continue;
        try {
            ensureLogDir();
            const chunk = lines.join('');
            fs.appendFileSync(filePath, chunk, 'utf8');
        } catch (_) {}
    }
    logBuffers.clear();
}

try {
    process.once('beforeExit', flushLogBuffer);
    process.once('exit', flushLogBuffer);
} catch (_) {}

function bufferLogLine(filePath: string, line: string): void {
    let lines = logBuffers.get(filePath);
    if (!lines) {
        lines = [];
        logBuffers.set(filePath, lines);
    }
    lines.push(line);

    if (lines.length >= MAX_LOG_BUFFER_LINES) {
        flushLogBuffer();
    } else if (!logFlushTimer) {
        logFlushTimer = setTimeout(() => flushLogBuffer(), LOG_FLUSH_DELAY_MS);
    }
}

export function getStructuredLogPath(runId = currentRunId()): string {
    flushLogBuffer();
    return resolveStructuredLogPath(runId);
}

export function getConsoleLogPath(runId = currentRunId()): string {
    flushLogBuffer();
    return resolveConsoleLogPath(runId);
}

export function getErrorLogPath(): string {
    flushLogBuffer();
    return resolveErrorLogPath();
}

export function getLatestLogPath(): string {
    flushLogBuffer();
    return resolveLatestLogPath();
}

export const STRUCTURED_LOG_PATH = resolveStructuredLogPath(RUN_ID);
export const CONSOLE_LOG_PATH = resolveConsoleLogPath(RUN_ID);
export const ERROR_LOG_PATH = resolveErrorLogPath();
export const LATEST_LOG_PATH = resolveLatestLogPath();

export function writeStructuredLog(
    event: string,
    fields: Record<string, unknown> = {}
): void {
    try {
        const payload = {
            ts: new Date().toISOString(),
            runId: currentRunId(), processSessionId,
            pid: process.pid,
            event,
            ...fields,
        };

        bufferLogLine(
            resolveStructuredLogPath(),
            JSON.stringify(payload) + '\n'
        );
    } catch (error) {
        faultService(new Error('结构化审计日志写入失败', { cause: error }));
    }
}

export function appendConsoleLog(line: string): void {
    try {
        const fullLine = line.endsWith('\n') ? line : line + '\n';
        bufferLogLine(resolveConsoleLogPath(), fullLine);
        bufferLogLine(resolveLatestLogPath(), fullLine);
    } catch (_) {}
}

export function appendErrorLog(entry: {
    time: string;
    tag: string;
    level: string;
    text: string;
    code?: string;
    stack?: string;
    context?: Record<string, unknown>;
}): void {
    try {
        flushLogBuffer();
        ensureLogDir();
        const timeHeader = `[${new Date().toISOString()}] [PID ${process.pid}] [Run ${currentRunId()}] [${entry.tag}]`;
        const codePart = entry.code ? ` [Code: ${entry.code}]` : '';
        let content = `${timeHeader}${codePart} ${entry.text}\n`;
        if (entry.context && Object.keys(entry.context).length > 0) {
            content += `   Context: ${JSON.stringify(entry.context)}\n`;
        }
        if (entry.stack) {
            content += `   Stack:\n${entry.stack.split('\n').map(s => '      ' + s).join('\n')}\n`;
        }
        content += '------------------------------------------------------------\n';
        fs.appendFileSync(getErrorLogPath(), content, 'utf8');
        flushLogBuffer();
    } catch (_) {}
}

export function getRecentLogFiles(): Array<{ name: string; size: number; mtime: string }> {
    try {
        const dir = getStructuredLogDir();
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.log') || f.endsWith('.jsonl'))
            .map(f => {
                const fullPath = path.join(dir, f);
                const stats = fs.statSync(fullPath);
                return {
                    name: f,
                    size: stats.size,
                    mtime: new Date(stats.mtimeMs).toISOString(),
                };
            })
            .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
    } catch (_) {
        return [];
    }
}

export function cleanOldStructuredLogs(maxDays = 14, maxFiles = 50): void {
    try {
        const dir = getStructuredLogDir();
        if (!fs.existsSync(dir)) return;
        const currentJsonl = getStructuredLogPath();
        const currentLog = getConsoleLogPath();
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.jsonl') || (f.endsWith('.log') && f !== 'error.log' && f !== 'latest.log') || f.endsWith('_profile.json'))
            .map(f => {
                const fullPath = path.join(dir, f);
                const stats = fs.statSync(fullPath);
                return { file: f, fullPath, mtimeMs: stats.mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);

        const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;

        for (let i = 0; i < files.length; i++) {
            const entry = files[i];
            if (i >= maxFiles || entry.mtimeMs < cutoff) {
                if (entry.fullPath !== currentJsonl && entry.fullPath !== currentLog) {
                    try {
                        fs.unlinkSync(entry.fullPath);
                    } catch (_) {}
                }
            }
        }
    } catch (_) {}
}

// 启动时静默触发一次日志轮转清理
cleanOldStructuredLogs();
