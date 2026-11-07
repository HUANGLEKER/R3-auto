// ============================================================
// Changdu OpenAPI: native content lookup and eligibility
// ============================================================

import { validateOpenApiEnvelope, validateOpenApiRecords } from './changdu_schema.ts';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseJsonPreserveIds } from '../core/utils.ts';

const HOST = 'https://openapi.changdupingtai.com';
const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readDotEnv(): Record<string, string> {
    const envPath = path.join(PROJECT_DIR, '.env');
    if (!fs.existsSync(envPath)) return {};
    return Object.fromEntries(
        fs.readFileSync(envPath, 'utf8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#') && line.indexOf('=') > 0)
            .map(line => {
                const divider = line.indexOf('=');
                const key = line.slice(0, divider).trim();
                const value = line.slice(divider + 1).trim().replace(/^['"]|['"]$/g, '');
                return [key, value];
            })
            .filter(([key]) => Boolean(key)),
    );
}

const DOT_ENV = readDotEnv();

export type OpenApiChannel = 'free' | 'paid';
export type OpenApiInputKind = 'book_id' | 'douyin_id' | 'ambiguous_id';

/** 只允许确定的单作品资格失败继续尝试下一候选。 */
export class ChangduEligibilityError extends Error {}

export interface ChangduOpenApiOptions {
    freeDistributorId: string;
    paidDistributorId: string;
    secretKey: string;
    fetch?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** 同一接口两次请求的最小间隔，默认 1000ms（官方建议单接口 QPS ≤ 1）。 */
    minIntervalMs?: number;
}

export class ChangduOpenApiError extends Error {
    code: number | undefined;
    httpStatus: number;
    endpoint: string;

    constructor(message: string, code: number | undefined, httpStatus: number, endpoint: string) {
        super(`常读 OpenAPI ${endpoint} 失败（HTTP ${httpStatus}，code ${code ?? '未知'}）：${message}`);
        this.name = 'ChangduOpenApiError';
        this.code = code;
        this.httpStatus = httpStatus;
        this.endpoint = endpoint;
    }
}

/**
 * 官方文档：code 500 = 访问速度过快（501 才是内部错误）；HTTP 429 同样表示限流。
 * 此外，常读平台高频访问触发限流时，网关亦常直接丢包超时或重置连接，表现为 fetch failed 或 aborted due to timeout（HTTP 0，code 未知）。
 * 优先按业务码/状态码判定，仅在没有结构化信息（如经过 Error 包装的消息）时才回退到文本匹配。
 */
export function isQpsLimitError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof Error && error.name === 'AbortError' && !/timeout/i.test(error.message)) {
        return false;
    }
    if (error instanceof ChangduOpenApiError && (error.code === 500 || error.httpStatus === 429 || error.httpStatus === 0)) return true;
    const msg = typeof error === 'string'
        ? error
        : (error as any)?.message || (error as any)?.msg || String(error);
    if (/qps/i.test(msg) || msg.includes('访问速度过快') || msg.includes('速度过快') || msg.includes('限流')) {
        return true;
    }
    if (msg.includes('fetch failed') || msg.includes('aborted due to timeout')) {
        return true;
    }
    if (error instanceof TypeError && msg.includes('fetch failed')) {
        return true;
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
        return true;
    }
    return false;
}

/** 官方建议单个接口 QPS 控制在 1 以内；按接口串行并保持该最小间隔。 */
export const REQUEST_MIN_INTERVAL_MS = 1000;

/** 每个客户端覆盖同一主管账号的两个渠道，共享接口级限流队列。 */
export function createChangduOpenApiClient(options: ChangduOpenApiOptions) {
    const FREE_ID = options.freeDistributorId;
    const PAID_ID = options.paidDistributorId;
    const SECRET = options.secretKey;
    const send = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    const now = options.now ?? Date.now;
    async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (!options.sleep) { await delay(ms, undefined, { signal }); return; }
        if (!signal) { await options.sleep(ms); return; }
        let onAbort!: () => void;
        try {
            await Promise.race([options.sleep(ms), new Promise<never>((_, reject) => {
                onAbort = () => reject(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
                if (signal.aborted) onAbort();
            })]);
        } finally { signal.removeEventListener('abort', onAbort); }
    }
    const minIntervalMs = options.minIntervalMs ?? REQUEST_MIN_INTERVAL_MS;
    const queues = new Map<string, Promise<void>>();
    const lastStarted = new Map<string, number>();

    async function withRequestSlot<T>(endpoint: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const previous = queues.get(endpoint) ?? Promise.resolve();
        const pending = previous.then(async () => {
            signal?.throwIfAborted();
            // 官方建议单个接口 QPS 控制在 1 以内；两个渠道共用同一接口队列，合并计算。
            const wait = (lastStarted.get(endpoint) ?? -Infinity) + minIntervalMs - now();
            if (wait > 0) await sleep(wait, signal);
            signal?.throwIfAborted();
            lastStarted.set(endpoint, now());
            return operation();
        });
        queues.set(endpoint, pending.then(() => {}, () => {}));
        return pending;
    }

    function distributorId(channel: OpenApiChannel): string {
        return channel === 'free' ? FREE_ID : PAID_ID;
    }

    function isChangduOpenApiConfigured(): boolean {
        return Boolean(FREE_ID && PAID_ID && SECRET);
    }

    function signGet(distributor: string, params: Record<string, string>): { ts: string; sign: string } {
        const ts = String(Math.floor(now() / 1000));
        const values = Object.keys(params).sort().map(key => `${params[key]}|`).join('');
        return { ts, sign: createHash('md5').update(`${distributor}${SECRET}${ts}${values}`, 'utf8').digest('hex') };
    }

    async function request(
        path: string,
        channel: OpenApiChannel,
        payload: Record<string, string>,
        signal?: AbortSignal,
    ): Promise<any> {
        const distributor = distributorId(channel);
        if (!distributor || !SECRET) throw new Error('常读 OpenAPI 凭据未配置');
        const body = { ...payload, distributor_id: distributor };
        // 只读内容查询可有限重试临时故障。
        for (let attempt = 0; ; attempt++) {
            signal?.throwIfAborted();
            let retryAfter = 0;
            try {
                return await withRequestSlot(path, async () => {
                    const auth = signGet(distributor, body);
                    const requestUrl = `${HOST}${path}?${new URLSearchParams(body)}`;
                    const init: RequestInit = {
                        headers: { 'header-ts': auth.ts, 'header-sign': auth.sign },
                        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
                    };
                    const response = await send(requestUrl, init);
                    const decoded = parseJsonPreserveIds(await response.text());
                    // HTTP transport failures retain retry semantics even without a JSON envelope.
                    const result = response.ok ? validateOpenApiEnvelope(decoded) : decoded;
                    signal?.throwIfAborted();
                    if (!response.ok || !result || result.code !== 200) {
                        const header = response.headers.get('retry-after');
                        if (header) {
                            retryAfter = /^\d+(?:\.\d+)?$/.test(header)
                                ? Number(header) * 1000
                                : Math.max(0, Date.parse(header) - now());
                        }
                        throw new ChangduOpenApiError(result?.message || '响应无效', result?.code, response.status, path);
                    }
                    return result;
                }, signal);
            } catch (error) {
                signal?.throwIfAborted();
                const isQps = isQpsLimitError(error);
                const retryable = error instanceof ChangduOpenApiError
                    ? ![410, 411, 412, 413].includes(error.code ?? 0)
                        && (error.code === 500 || error.code === 501 || error.httpStatus === 429 || error.httpStatus >= 500)
                    : error instanceof TypeError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name));
                const maxAttempts = isQps ? 3 : 2;
                if (!retryable || attempt >= maxAttempts || retryAfter > 30_000) {
                    if (error instanceof ChangduOpenApiError) throw error;
                    throw new ChangduOpenApiError(error instanceof Error ? error.message : '网络请求失败', undefined, 0, path);
                }
                let backoffMs: number;
                if (isQps) {
                    // 针对 QPS 已达上限错误，增加 1~2 秒随机指数退避
                    const jitter = Math.floor(Math.random() * 1000);
                    const baseDelay = 1000 + jitter; // 1000ms ~ 2000ms
                    backoffMs = Math.round(baseDelay * (1.5 ** attempt));
                    console.log(`⏳ 常读 OpenAPI 触发 QPS 限流 [${path}]，随机退避 ${(backoffMs / 1000).toFixed(2)}s 进行第 ${attempt + 1} 次重试...`);
                } else {
                    backoffMs = 1000 * 2 ** attempt;
                }
                await sleep(Math.max(backoffMs, Number.isFinite(retryAfter) ? retryAfter : 0), signal);
            }
        }
    }

    function get(path: string, channel: OpenApiChannel, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
        return request(path, channel, params, signal);
    }

    /** 兼容 OpenAPI 不同版本的 `data`、`result` 与嵌套列表响应。 */
    function contentRecords(body: any): any[] {
        const value = body?.data ?? body?.result;
        if (Array.isArray(value)) return validateOpenApiRecords(value);
        if (Array.isArray(value?.list)) return validateOpenApiRecords(value.list);
        throw new Error('常读 OpenAPI 列表响应缺失，不能确认记录不存在');
    }

    async function paginated(path: string, channel: OpenApiChannel, params: Record<string, string>, signal?: AbortSignal): Promise<any[]> {
        // 端原生文档上限100；当前渠道带query实测100返回4000“查询数量超过20”，兼容使用20。
        const pageSize = 20;
        const rows: any[] = [];
        const seenPages = new Set<string>();
        const seenIds = new Set<string>();
        let expectedTotal: number | undefined;
        for (let page = 0; page <= 10000; page++) {
            signal?.throwIfAborted();
            const body = await get(path, channel, { ...params, page_index: String(page), page_size: String(pageSize) }, signal);
            if (body.is_truncated === true) throw new Error('常读 OpenAPI 内容查询被截断，不能确认完整结果');
            const batch = contentRecords(body);
            const total = body.total;
            if (total !== undefined) {
                if (!Number.isSafeInteger(total) || total < 0) throw new Error('常读 OpenAPI 分页总数无效');
                if (expectedTotal !== undefined && total !== expectedTotal) throw new Error('常读 OpenAPI 查询期间总数变化，请重新查询');
                expectedTotal = total;
            }
            if (!batch.length) {
                const prematureEmpty = body.has_more === true || (expectedTotal !== undefined && rows.length < expectedTotal);
                if (prematureEmpty) {
                    throw new Error('常读 OpenAPI 分页提前结束');
                }
                return rows;
            }
            const signature = JSON.stringify(batch);
            if (seenPages.has(signature)) throw new Error('常读 OpenAPI 分页重复，不能确认完整结果');
            seenPages.add(signature);
            for (const item of batch) {
                const id = String(item?.book_id ?? '');
                if (!/^\d+$/.test(id)) throw new Error('常读 OpenAPI 分页记录缺少有效 ID');
                if (seenIds.has(id)) throw new Error('常读 OpenAPI 分页记录重复，不能确认完整结果');
                seenIds.add(id);
            }
            rows.push(...batch);
            if (expectedTotal !== undefined && rows.length > expectedTotal) throw new Error('常读 OpenAPI 分页记录超出总数，请重新查询');
            const more = body.has_more === true || (expectedTotal !== undefined ? rows.length < expectedTotal : batch.length === pageSize);
            if (!more) return rows;
        }
        throw new Error('常读 OpenAPI 内容查询被截断，不能确认完整结果');
    }

    function firstBookId(value: any): string {
        const candidate = value?.book_id || '';
        return /^\d{10,30}$/.test(String(candidate)) ? String(candidate) : '';
    }
    function firstBookName(value: any): string {
        return String(value?.book_name || value?.series_name || value?.name || value?.book_info?.book_name || '');
    }

    /**
     * 将“抖音作品 ID / 漫剧 ID / 无前缀数字”安全归一为 OpenAPI 所需 book_id。
     * 解析后核验作品发布、投放、授权状态及抖音作品 ID。
     */
    async function nativeBook(channel: OpenApiChannel, inputId: string, kind: OpenApiInputKind, signal?: AbortSignal): Promise<any> {
        if (!/^\d{10,30}$/.test(inputId)) throw new Error('常读作品 ID 格式无效');
        const rows = await paginated('/novelsale/openapi/content/aweme_series/list/v1/', channel, { query: inputId }, signal);
        const matched = rows.filter(row => firstBookId(row) && (kind === 'book_id'
            ? firstBookId(row) === inputId
            : kind === 'douyin_id' ? firstBookId(row) === inputId || String(row.playlet_id) === inputId : true));
        if (!matched.length) throw new ChangduEligibilityError('未查询到对应端原生作品');
        if (matched.length !== 1) throw new Error('作品 ID 返回多个版本，无法安全确定抖音版本 ID');
        const row = matched[0];
        // 同一端原生接口：请求筛选值1=已发布；响应data[].publish_status的2=已发布。
        if (row.publish_status !== 2) throw new ChangduEligibilityError('作品未发布、已下架或发布状态未知');
        if (row.delivery_status !== true) throw new ChangduEligibilityError('作品不可投放或可投状态未知');
        // 同作品按渠道核验：2=无授权，4=普通授权；其余值未确认，不套用其他接口枚举。
        if (row.permission_status === 2) throw new ChangduEligibilityError('作品无授权');
        if (row.permission_status !== 4) throw new ChangduEligibilityError('作品授权状态未知');
        if (!/^\d{10,30}$/.test(String(row.playlet_id ?? ''))) throw new Error('端原生作品缺少有效抖音作品 ID');
        return row;
    }

    async function resolveOpenApiBookId(inputId: string, kind: OpenApiInputKind, signal?: AbortSignal): Promise<{ bookId: string; bookName: string; source: string }> {
        const row = await nativeBook('free', inputId, kind, signal);
        return { bookId: firstBookId(row), bookName: firstBookName(row), source: 'OPENAPI_AWEME_SERIES' };
    }

    async function checkOpenApiBookEligibility(channel: OpenApiChannel, bookId: string, signal?: AbortSignal): Promise<{ bookId: string; playletId: string; bookName: string }> {
        const row = await nativeBook(channel, bookId, 'book_id', signal);
        return { bookId: firstBookId(row), playletId: String(row.playlet_id), bookName: firstBookName(row) };
    }

    return { isChangduOpenApiConfigured, resolveOpenApiBookId, checkOpenApiBookEligibility };
}

export const { isChangduOpenApiConfigured, resolveOpenApiBookId, checkOpenApiBookEligibility } = createChangduOpenApiClient({
    freeDistributorId: process.env.CHANGDU_OPENAPI_FREE_DISTRIBUTOR_ID || DOT_ENV.CHANGDU_OPENAPI_FREE_DISTRIBUTOR_ID || '',
    paidDistributorId: process.env.CHANGDU_OPENAPI_PAID_DISTRIBUTOR_ID || DOT_ENV.CHANGDU_OPENAPI_PAID_DISTRIBUTOR_ID || '',
    secretKey: process.env.CHANGDU_OPENAPI_SECRET_KEY || DOT_ENV.CHANGDU_OPENAPI_SECRET_KEY || '',
});
