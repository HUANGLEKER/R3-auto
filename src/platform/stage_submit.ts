import { getStageSubtaskContainers } from './stage.ts';
import { writeStructuredLog } from '../core/structured_log.ts';
/** Filled slots belong only to the current run; they are not persisted for resuming. */
export interface FilledStageTask {
    inputIndex?: number;
    tabIndex: number;
    subtaskIndex: number;
    keyword: string;
    dramaName: string;
    seriesId: string;
    douyinId: string;
    completedAt: string;
    durationMs?: number;
}

export function nextStageSlot(tasks: FilledStageTask[], tabIndex: number): number {
    let slot = 1;
    while (tasks.some(task => task.tabIndex === tabIndex && task.subtaskIndex === slot)) slot++;
    return slot;
}

export function findStageConflicts(tasks: FilledStageTask[], tabIndex: number, ids: string[]): FilledStageTask[] {
    const conflicts = tasks.filter(task => task.tabIndex === tabIndex && (ids.includes(task.douyinId) || ids.includes(task.seriesId)));
    if (!ids.length || ids.some(id => !conflicts.some(task => task.douyinId === id || task.seriesId === id))) {
        throw new Error('重复剧目与本页已填写槽位不匹配，已停止自动覆盖。');
    }
    return conflicts;
}

/**
 * 安全关闭已成功提交的搭剧任务页面 Tab
 * @param page Playwright Page
 * @param tabNumber Tab 序号（1-based，用于日志）
 * @param label 场景标签（如“先前暂缓”、“末页”）
 */
export async function closeSubmittedStageTab(
    page: any,
    tabNumber: number,
    label?: string
): Promise<void> {
    if (!page) return;
    try {
        if (typeof page.isClosed === 'function' && page.isClosed()) {
            return;
        }
        if (typeof page.close === 'function') {
            const desc = label ? `（${label}）` : '';
            console.log(`🗑️ 搭剧第 ${tabNumber} 页${desc}已成功提交，已自动关闭对应 Tab`);
            await page.close();
            writeStructuredLog('STAGE_PAGE_CLOSED', { tabIndex: tabNumber, label, reason: 'submitted_success' });
        }
    } catch (err: any) {
        console.log(`⚠️ 关闭搭剧第 ${tabNumber} 页 Tab 出现异常: ${err?.message || err}`);
    }
}

/** Remove only unused copied draft rows, from the end, before a partial final batch. */
export async function trimUnusedStageTasks(page: any, keepCount: number, expectedCount: number, signal?: AbortSignal,
    onRemoved?: (remaining: number) => Promise<void>): Promise<void> {
    const tasks = getStageSubtaskContainers(page);
    if (keepCount < 1 || keepCount > expectedCount || await tasks.count() !== expectedCount) {
        throw new Error('末页子任务数量不匹配，已停止提交。');
    }
    const confirmation = page.locator('.arco-popconfirm-wrapper:visible')
        .filter({ hasText: /^确认删除当前配置吗[?？]/ });
    // A stopped cleanup can leave a popconfirm attached to a previously selected row.
    // Cancel it before explicitly choosing the current last unused row again.
    if (await confirmation.count() > 0) {
        await confirmation.getByRole('button', { name: '取消', exact: true }).click({ timeout: 5000 });
        await confirmation.waitFor({ state: 'hidden', timeout: 5000 });
    }
    for (let count = expectedCount; count > keepCount; count--) {
        signal?.throwIfAborted();
        const row = tasks.nth(count - 1);
        await row.locator('button:has(.arco-icon-delete)').click({ timeout: 5000 });
        await confirmation.waitFor({ state: 'visible', timeout: 5000 });
        signal?.throwIfAborted();
        await confirmation.getByRole('button', { name: '确定', exact: true }).click({ timeout: 5000 });
        await tasks.nth(count - 1).waitFor({ state: 'detached', timeout: 5000 });
        if (await tasks.count() !== count - 1) throw new Error('移除末页未填写配置后数量异常，已停止提交。');
        await onRemoved?.(count - 1);
    }
}

/** Delete validated conflict slots in descending order. */
export async function removeStageTasks(page: any, slots: number[], expectedCount: number, signal?: AbortSignal,
    onRemoved?: (remaining: number, slot: number) => Promise<void>): Promise<void> {
    const tasks = getStageSubtaskContainers(page);
    if (!slots.length || new Set(slots).size !== slots.length || slots.some(slot => !Number.isInteger(slot) || slot < 1 || slot > expectedCount) || await tasks.count() !== expectedCount) {
        throw new Error('末页子任务数量不匹配，已停止提交。');
    }
    const confirmation = page.locator('.arco-popconfirm-wrapper:visible')
        .filter({ hasText: /^确认删除当前配置吗[?？]/ });
    // A stopped cleanup can leave a popconfirm attached to a previously selected row.
    // Cancel it before explicitly choosing the current last unused row again.
    if (await confirmation.count() > 0) {
        await confirmation.getByRole('button', { name: '取消', exact: true }).click({ timeout: 5000 });
        await confirmation.waitFor({ state: 'hidden', timeout: 5000 });
    }
    let count = expectedCount;
    for (const slot of [...slots].sort((a, b) => b - a)) {
        signal?.throwIfAborted();
        const row = tasks.nth(slot - 1);
        await row.locator('button:has(.arco-icon-delete)').click({ timeout: 5000 });
        await confirmation.waitFor({ state: 'visible', timeout: 5000 });
        signal?.throwIfAborted();
        await confirmation.getByRole('button', { name: '确定', exact: true }).click({ timeout: 5000 });
        await tasks.nth(count - 1).waitFor({ state: 'detached', timeout: 5000 });
        if (await tasks.count() !== count - 1) throw new Error('移除末页未填写配置后数量异常，已停止提交。');
        await onRemoved?.(count - 1, slot);
        count--;
    }
}

export const STAGE_SUBMIT_PATH = '/advertising/api/v1/auto_create/task/upsert';
export type StageSubmitResult =
    | { kind: 'success' }
    | { kind: 'duplicate'; displayedDramaIds: string[]; message: string }
    | { kind: 'retryable'; message: string }
    | { kind: 'blocked'; message: string };

export function isStageNativeContentUnverified(message: string): boolean {
    if (!message || typeof message !== 'string') return false;
    return /无法核实当前原生内容|所选渠道无法核实|查询分销渠道失败/i.test(message);
}

export function isStageSubmitDuplicate(message: string): boolean {
    if (!message || typeof message !== 'string') return false;
    return message.includes('投手参数校验失败') && /已被.*创建过项目/.test(message);
}

export function isStageSubmitRetryable(message: string): boolean {
    if (!message || typeof message !== 'string') return false;
    // 提交时 UpsertAutoCreateTask 错误中除了重复剧冲突错误，其他错误全按渠道 QPS 限流处理
    return !isStageSubmitDuplicate(message);
}

export function parseStageSubmitResult(status: number, body: unknown): StageSubmitResult {
    const data = body as Record<string, unknown> | null;
    if (status < 200 || status >= 300 || !data || typeof data !== 'object' || typeof data.code !== 'number') {
        return { kind: 'blocked', message: '提交响应异常，结果不确定，请核对平台任务。' };
    }
    const message = typeof data.msg === 'string' ? data.msg
        : (typeof data.message === 'string' ? data.message
        : (typeof data.status_msg === 'string' ? data.status_msg : ''));

    // 成功状态
    if (data.code === 0 && (data.status_code === undefined || data.status_code === 0)) {
        return { kind: 'success' };
    }

    // 重复剧冲突错误（已被其它任务创建过项目）
    if (isStageSubmitDuplicate(message)) {
        // The real response lists only a prefix of drama/account pairs. "等 16 条"
        // counts pairs, not dramas. Only explicitly displayed IDs authorize replacement.
        const displayedDramaIds = [...new Set([...message.matchAll(/剧目\s*(\d+)\s*[\+＋]\s*抖音号\s*\d+/g)].map(m => m[1]))];
        if (displayedDramaIds.length) return { kind: 'duplicate', displayedDramaIds, message };
        return { kind: 'blocked', message: message || '重复剧目无法匹配，请核对平台任务。' };
    }

    // 提交时 UpsertAutoCreateTask 错误中除了重复剧冲突错误，其他错误全按渠道 QPS 限流处理
    if (isStageSubmitRetryable(message)) {
        return { kind: 'retryable', message };
    }
    return { kind: 'blocked', message: message || '提交返回未知业务状态，已停止自动重试。' };
}

export function isStageSubmitRequest(request: any): boolean {
    try {
        const url = new URL(request.url());
        return url.hostname === 'usergrowth.com.cn' && url.pathname === STAGE_SUBMIT_PATH && request.method() === 'POST';
    } catch { return false; }
}

/** Observe only a request started by this click, never an old response or a toast. */
export async function submitStagePage(page: any, signal?: AbortSignal, timeoutMs = 30000): Promise<StageSubmitResult> {
    signal?.throwIfAborted();
    let button: any;
    try {
        button = await resolveStageSubmitButton(page, signal);
    } catch (cause) {
        throw Object.assign(new Error('整页提交按钮尚未就绪，未执行点击，请人工核对当前页面。', { cause }), { code: 'STAGE_SUBMIT_NOT_STARTED' });
    }
    const requests = new Set<any>();
    let finish!: (result: StageSubmitResult) => void;
    const result = new Promise<StageSubmitResult>(resolve => { finish = resolve; });
    const onRequest = (request: any) => { if (isStageSubmitRequest(request)) requests.add(request); };
    const onResponse = async (response: any) => {
        if (!requests.has(response.request())) return;
        try { finish(parseStageSubmitResult(response.status(), await response.json())); }
        catch { finish({ kind: 'blocked', message: '提交响应无法解析，结果不确定，请人工核对。' }); }
    };
    const onFailed = (request: any) => {
        if (requests.has(request)) finish({ kind: 'blocked', message: '提交连接中断，结果不确定，请人工核对。' });
    };
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onFailed);
    const timer = setTimeout(() => finish({ kind: 'blocked', message: '等待提交结果超时，禁止自动重复提交，请人工核对。' }), timeoutMs);
    try {
        signal?.throwIfAborted();
        await button.click({ timeout: 10000 });
        // Once sent, drain the response even if cancellation is requested.
        return await result;
    } finally {
        clearTimeout(timer);
        page.off('request', onRequest);
        page.off('response', onResponse);
        page.off('requestfailed', onFailed);
    }
}

/** Click once only: a timeout must never cause a second creation request. */
export async function clickStageSubmit(page: any, signal?: AbortSignal): Promise<void> {
    const button = await resolveStageSubmitButton(page, signal);
    signal?.throwIfAborted();
    await button.click({ timeout: 10000 });
}

async function resolveStageSubmitButton(page: any, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    // Arco renders the label in a child span; :text-is matches that span, not the button.
    // Validate and click the same locator, without .first() masking ambiguous matches.
    const button = page.getByRole('button', { name: '确认提交', exact: true });
    await button.waitFor({ state: 'visible', timeout: 10000 });
    if (await button.count() !== 1) {
        throw new Error('整页确认提交按钮不唯一，已停止提交。');
    }
    signal?.throwIfAborted();
    return button;
}
