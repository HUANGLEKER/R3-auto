// ============================================================
// Local Web Console Server (Native Node HTTP + SSE + REST API)
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { UNIFIED } from '../core/config.ts';
import { configRequestSchema, startRequestSchema, environmentRequestSchema, parseInput, InputValidationError } from '../core/validation.ts';
import { getAuditStore } from '../core/audit_store.ts';
import { getServiceHealth } from '../core/service_health.ts';
import { getRuntimeDiagnostics } from '../core/observability.ts';
import { createSSEConnection } from './sse_connection.ts';
import { taskStatusLabels } from '../core/task_state.ts';
import { automationBridge } from './automation_bridge.ts';
import {
    checkEnvironment,
    launchBrowserWithCDP,
    openStandardPages,
} from './chrome_launcher.ts';
import {
    readKeywords,
    readCopyPageUrls,
    readRoiRatio,
    txtPath,
    excelLinkPath,
    roiRatioPath,
} from '../core/paths.ts';
import {
    getConsoleLogPath,
    getErrorLogPath,
    getLatestLogPath,
    getRecentLogFiles,
} from '../core/structured_log.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
};

const PORT = Number(process.env.PORT || 3000);
const LOOPBACK_HOST = '127.0.0.1';

/**
 * The console controls a logged-in browser session and can create paid assets.
 * Only accept state-changing requests from this loopback console's own origin.
 */
function isTrustedConsoleOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return false;

    try {
        const url = new URL(origin);
        const allowedHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
        return url.protocol === 'http:' && allowedHost && Number(url.port) === req.socket.localPort;
    } catch (_) {
        return false;
    }
}

/**
 * 防 DNS rebinding：GET 接口会返回历史和日志，也必须要求 Host 为本机回环地址。
 */
function isTrustedHost(req: http.IncomingMessage): boolean {
    const host = req.headers.host;
    if (!host) return false;
    try {
        const hostname = new URL(`http://${host}`).hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    } catch (_) {
        return false;
    }
}

function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bodySize = 0;
        let rejected = false;
        req.on('data', chunk => {
            if (rejected) return;
            bodySize += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            if (bodySize > 5 * 1024 * 1024) {
                rejected = true;
                chunks.length = 0;
                const error = Object.assign(new Error('Payload too large'), { statusCode: 413 });
                reject(error);
                return;
            }
            chunks.push(Buffer.from(chunk));
        });
        req.on('end', () => {
            if (rejected) return;
            const body = Buffer.concat(chunks).toString('utf8');
            if (!body.trim()) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new InputValidationError('请求体不是有效 JSON'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res: http.ServerResponse, status: number, data: any): void {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(data));
}

function serveStaticFile(res: http.ServerResponse, filePath: string, contentType: string): void {
    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
    }
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
    });
    res.end(content);
}

export const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase();
    if (!isTrustedHost(req)) {
        return sendJson(res, 403, { ok: false, error: '仅允许通过本机回环地址访问控制台' });
    }

    // The console is same-origin only; deliberately do not grant cross-origin access.
    if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !isTrustedConsoleOrigin(req)) {
            return sendJson(res, 403, { ok: false, error: '仅允许本地控制台发起状态变更请求' });
        }

        // SSE Events endpoint
        if (pathname === '/api/events' && method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
            });

            const connection = createSSEConnection(res);
            const writeEvent = (event: ReturnType<typeof automationBridge.snapshotEvent>) =>
                connection.write(`id: ${event.runId}:${event.seq}\nevent: console_event\ndata: ${JSON.stringify(event)}\n\n`);
            writeEvent(automationBridge.snapshotEvent());

            const unsubscribe = automationBridge.subscribeEvents(writeEvent);

            const heartbeat = setInterval(() => {
                try {
                    connection.write(': heartbeat\n\n');
                } catch (_) {}
            }, 15000);

            req.on('close', () => {
                clearInterval(heartbeat);
                unsubscribe();
                connection.close();
            });
            return;
        }

        // REST API: Current status
        if (pathname === '/api/status' && method === 'GET') {
            return sendJson(res, 200, { ok: true, state: automationBridge.getState(), event: automationBridge.snapshotEvent(), health: getServiceHealth(), diagnostics: getRuntimeDiagnostics() });
        }
        if (pathname === '/api/history' && method === 'GET') return sendJson(res, 200, { ok: true, runs: getAuditStore().history() });
        if (pathname.startsWith('/api/history/') && method === 'GET') {
            const offset = Number(parsedUrl.searchParams.get('offset') ?? '0');
            if (!Number.isSafeInteger(offset) || offset < 0) return sendJson(res, 400, { ok: false, message: 'offset 必须为非负整数' });
            const record = getAuditStore().run(decodeURIComponent(pathname.slice('/api/history/'.length)), offset);
            return sendJson(res, record ? 200 : 404, { ok: !!record, record });
        }

        // REST API: Environment check
        if (pathname === '/api/env' && method === 'GET') {
            const input = parsedUrl.searchParams.get('input');
            const inputKeywords = input !== null && input.trim() !== '' ? input.split('\n') : undefined;
            const env = await checkEnvironment(inputKeywords);
            return sendJson(res, 200, { ok: true, env });
        }
        if (pathname === '/api/env' && method === 'POST') {
            const body = parseInput(environmentRequestSchema, await parseJsonBody(req));
            const env = await checkEnvironment(body.keywords);
            return sendJson(res, 200, { ok: true, env });
        }

        // REST API: Launch Edge / Browser
        if ((pathname === '/api/env/launch-chrome' || pathname === '/api/env/launch-edge') && method === 'POST') {
            const result = launchBrowserWithCDP();
            return sendJson(res, result.ok ? 200 : 400, result);
        }

        // REST API: Open missing standard pages
        if (pathname === '/api/env/open-pages' && method === 'POST') {
            const body = await parseJsonBody(req).catch(() => ({})) as any;
            const keywords = Array.isArray(body?.keywords) ? body.keywords : undefined;
            const result = await openStandardPages(keywords);
            return sendJson(res, 200, {
                ok: result.missingPages.length === 0,
                ...result,
            });
        }

        // REST API: Get configuration
        if (pathname === '/api/config' && method === 'GET') {
            let keywords: string[] = [];
            let copyUrls: string[] = [];
            let roiRatio = '1';

            try {
                keywords = readKeywords();
            } catch (_) {}

            try {
                copyUrls = readCopyPageUrls();
            } catch (_) {}

            try {
                roiRatio = readRoiRatio();
            } catch (_) {}

            const savedConfig = getAuditStore().config();
            const paidTemplate = savedConfig?.paidTemplate || UNIFIED.PAID_TEMPLATE;
            const taskNamePrefix = savedConfig?.taskNamePrefix !== undefined ? String(savedConfig.taskNamePrefix) : UNIFIED.TASK_NAME_PREFIX;
            const dailyBudget = savedConfig?.dailyBudget !== undefined ? String(savedConfig.dailyBudget) : UNIFIED.DAILY_BUDGET;

            return sendJson(res, 200, {
                ok: true,
                keywords,
                copyUrls,
                roiRatio,
                paidTemplate,
                taskNamePrefix,
                dailyBudget,
                txtPath,
                excelLinkPath,
                roiRatioPath,
            });
        }

        // REST API: Save configuration (收敛 SQLite 单一真相源，废除旧文件覆盖)
        if (pathname === '/api/config' && method === 'POST') {
            const body = parseInput(configRequestSchema, await parseJsonBody(req));
            const store = getAuditStore();
            let previous = store.config();
            if (!previous) {
                previous = {};
                try { previous.keywords = readKeywords(); } catch (_) {}
                try { previous.copyUrls = readCopyPageUrls(); } catch (_) {}
                previous.roiRatio = readRoiRatio();
            }
            const updatedConfig = {
                keywords: body.keywords ?? previous.keywords ?? [],
                copyUrls: body.copyUrls ?? previous.copyUrls ?? [],
                roiRatio: body.roiRatio !== undefined ? String(body.roiRatio).trim() : (previous.roiRatio ?? '1'),
                paidTemplate: body.paidTemplate ?? previous.paidTemplate ?? UNIFIED.PAID_TEMPLATE,
                taskNamePrefix: body.taskNamePrefix !== undefined ? String(body.taskNamePrefix).trim() : (previous.taskNamePrefix ?? UNIFIED.TASK_NAME_PREFIX),
                dailyBudget: body.dailyBudget !== undefined ? String(body.dailyBudget).trim() : (previous.dailyBudget ?? UNIFIED.DAILY_BUDGET),
            };
            store.saveConfig(updatedConfig);
            return sendJson(res, 200, { ok: true, message: '配置已成功保存' });
        }


        // REST API: Start automation
        if (pathname === '/api/start' && method === 'POST') {
            const body = parseInput(startRequestSchema, await parseJsonBody(req));
            const result = await automationBridge.start({
                keywords: body.keywords,
                copyPageUrls: body.copyPageUrls,
                roiRatio: body.roiRatio,
                paidTemplate: body.paidTemplate,
                taskNamePrefix: body.taskNamePrefix,
                dailyBudget: body.dailyBudget,
            });
            return sendJson(res, result.ok ? 200 : 400, result);
        }

        // REST API: Stop automation
        if (pathname === '/api/stop' && method === 'POST') {
            const result = automationBridge.stop();
            return sendJson(res, result.ok ? 200 : 400, result);
        }

        // REST API: Clear logs
        if (pathname === '/api/logs/clear' && method === 'POST') {
            automationBridge.clearLogs();
            return sendJson(res, 200, { ok: true });
        }

        // REST API: Get latest logs summary
        if (pathname === '/api/logs/latest' && method === 'GET') {
            const state = automationBridge.getState();
            const errorLogs = state.logs.filter(l => l.level === 'error' || l.level === 'warn' || l.tag === 'ERR' || l.tag === 'WARN');
            return sendJson(res, 200, {
                ok: true,
                runId: automationBridge.getRunId(),
                totalCount: state.logs.length,
                errorCount: errorLogs.length,
                logPath: getConsoleLogPath(automationBridge.getRunId()),
                errorLogPath: getErrorLogPath(),
                recentLogs: state.logs.slice(-100),
            });
        }

        // REST API: List all log files
        if (pathname === '/api/logs/list' && method === 'GET') {
            return sendJson(res, 200, { ok: true, files: getRecentLogFiles() });
        }

        // REST API: Download execution log file
        if (pathname === '/api/logs/download' && method === 'GET') {
            const consolePath = getConsoleLogPath(automationBridge.getRunId());
            const latestPath = getLatestLogPath();
            let content = '';
            if (fs.existsSync(consolePath)) {
                content = fs.readFileSync(consolePath, 'utf8');
            } else if (fs.existsSync(latestPath)) {
                content = fs.readFileSync(latestPath, 'utf8');
            } else {
                const state = automationBridge.getState();
                content = state.logs.map(l => `[${l.time}] [${l.tag.padEnd(7)}] ${l.text}`).join('\r\n');
            }
            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': `attachment; filename="R3_Console_${automationBridge.getRunId()}.log"`,
            });
            res.end('\uFEFF' + content);
            return;
        }

        // REST API: Download error log file
        if (pathname === '/api/logs/download-errors' && method === 'GET') {
            const errorPath = getErrorLogPath();
            let content = '';
            if (fs.existsSync(errorPath)) {
                content = fs.readFileSync(errorPath, 'utf8');
            } else {
                const state = automationBridge.getState();
                const errorLogs = state.logs.filter(l => l.level === 'error' || l.level === 'warn' || l.tag === 'ERR' || l.tag === 'WARN');
                content = errorLogs.map(l => `[${l.time}] [${l.tag.padEnd(7)}] ${l.text}`).join('\r\n');
            }
            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': 'attachment; filename="R3_Errors.log"',
            });
            res.end('\uFEFF' + content);
            return;
        }

        // REST API: Export result CSV
        if (pathname === '/api/export' && method === 'GET') {
            const state = automationBridge.getState();
            const rows = [
                ['序号', '漫剧关键词', '匹配漫剧名', '漫剧ID', '抖音作品ID', '搭剧位置', '耗时(s)', '状态', '错误原因'].join(','),
            ];

            for (const item of state.items) {
                const row = [
                    item.index,
                    `"${(item.keyword || '').replace(/"/g, '""')}"`,
                    `"${(item.name || '').replace(/"/g, '""')}"`,
                    `"${item.seriesId || ''}"`,
                    `"${item.douyinId || ''}"`,
                    item.tabIndex ? `Tab${item.tabIndex}-任务${item.subtaskIndex}` : '',
                    item.durationMs ? (item.durationMs / 1000).toFixed(2) : '',
                    taskStatusLabels[item.status],
                    `"${(item.error || '').replace(/"/g, '""')}"`,
                ];
                rows.push(row.join(','));
            }

            const csvContent = '\uFEFF' + rows.join('\r\n');
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="R3_Result_${new Date().toISOString().slice(0, 10)}.csv"`,
            });
            res.end(csvContent);
            return;
        }

        // Static Files
        if (pathname === '/' || pathname === '/index.html') {
            return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
        }

        const relativePath = decodeURIComponent(pathname.replace(/^\/+/, ''));
        const targetPath = path.resolve(PUBLIC_DIR, relativePath);
        if ((targetPath === PUBLIC_DIR || targetPath.startsWith(PUBLIC_DIR + path.sep)) && fs.existsSync(targetPath)) {
            const stat = fs.statSync(targetPath);
            if (stat.isFile()) {
                const ext = path.extname(targetPath).toLowerCase();
                const mime = MIME_TYPES[ext] || 'application/octet-stream';
                return serveStaticFile(res, targetPath, mime);
            }
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
    } catch (err: any) {
        const status = err?.statusCode === 413 ? 413 : err instanceof InputValidationError ? 400 : 500;
        sendJson(res, status, { ok: false, error: err.message || 'Internal Server Error', message: err.message || 'Internal Server Error' });
    }
});

export function startServer(preferredPort = PORT, maxRetries = 10): Promise<number> {
    return new Promise((resolve, reject) => {
        let currentPort = preferredPort;
        let attempts = 0;

        const tryListen = () => {
            server.removeAllListeners('error');

            server.once('error', (err: any) => {
                // Windows can report exclusive/reserved ports as EACCES.
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    attempts++;
                    console.log(`⚠️ 端口 ${currentPort} 不可用 (${err.code})`);
                    if (attempts < maxRetries && currentPort < 65535) {
                        currentPort++;
                        setTimeout(tryListen, 200);
                    } else {
                        reject(new Error(`无法绑定可用端口（已尝试 ${preferredPort} ~ ${currentPort}）`));
                    }
                } else {
                    reject(err);
                }
            });

            server.listen(currentPort, LOOPBACK_HOST, () => {
                const address = server.address();
                const boundPort = typeof address === 'object' && address ? address.port : currentPort;
                const url = `http://${LOOPBACK_HOST}:${boundPort}`;
                console.log(`\n============================================================`);
                console.log(`🚀 R3 漫剧自动化 Web 控制台已启动: ${url}`);
                console.log(`============================================================\n`);

                resolve(boundPort);
            });
        };

        tryListen();
    });
}

export function closeServer(): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
}
