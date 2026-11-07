import { UNIFIED } from '../core/config.ts';
import { isStageSaveRequest } from './stage_network.ts';
import { writeStructuredLog } from '../core/structured_log.ts';

const errorSelector = '.arco-form-message, .arco-message-error, .arco-notification-error';

export const STAGE_PAGE_ERROR_PATTERN = /不能为空|失败|错误|无效|请选择|必填|异常|超时|超出|未找到|校验|合规|不合规|规范|字符|格式|符号|禁止|只能|只允许|不支持|长度|限制|检查|权限|冲突|已存在|无法|非法|不合法|合法|请修改|请重试/;
export const STAGE_LINGERING_ERROR_PATTERN = /已被.*创建过项目|所选渠道无法核实|无法核实当前原生内容|查询分销渠道失败|查询客户所属供应商|UpsertAutoCreateTask|ListProduct|服务端负载|服务器负载/;

/**
 * 清理/关闭页面上残留的通知提示（例如整页提交失败后留存的全局错误 Toast、平台商品接口负载高提示），规避误杀后续子任务保存
 */
export async function dismissStagePageToasts(page: any): Promise<void> {
    if (!page || typeof page.evaluate !== 'function') return;
    try {
        await page.evaluate((patternStr?: string) => {
            const pattern = patternStr
                ? new RegExp(patternStr)
                : /已被.*创建过项目|所选渠道无法核实|无法核实当前原生内容|查询分销渠道失败|查询客户所属供应商|UpsertAutoCreateTask|ListProduct|服务端负载|服务器负载/;
            const closeButtons = document.querySelectorAll(
                '.arco-notification-close-btn, .arco-notification-item .arco-icon-close, ' +
                '.arco-message-close-btn, .arco-message-item .arco-icon-close'
            );
            for (const btn of closeButtons) {
                try { (btn as HTMLElement).click(); } catch (_) {}
            }
            const toasts = document.querySelectorAll('.arco-message-error, .arco-notification-error');
            for (const toast of toasts) {
                if (pattern.test(toast.textContent || '')) {
                    (toast as HTMLElement).style.display = 'none';
                }
            }
        }, STAGE_LINGERING_ERROR_PATTERN.source);
    } catch (_) {}
}

interface SavePageError {
    text: string;
    field: string;
    controls: Array<{ id: string; name: string }>;
    scope: string;
}

async function readSavePageErrors(page: any): Promise<SavePageError[]> {
    return page.locator(errorSelector).evaluateAll((nodes: Element[]) => nodes.filter(node => {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || node.getClientRects().length === 0) {
            return false;
        }
        const text = (node.textContent || '').trim();
        if (!text) return false;
        const isToast = node.classList.contains('arco-message-error') || node.classList.contains('arco-notification-error');
        return isToast || /不能为空|失败|错误|无效|请选择|必填|异常|超时|超出|未找到|校验|合规|不合规|规范|字符|格式|符号|禁止|只能|只允许|不支持|长度|限制|检查|权限|冲突|已存在|无法|非法|不合法|合法|请修改|请重试/.test(text);
    }).slice(0, 20).map(node => {
        const item = node.closest('.arco-form-item');
        return {
            text: (node.textContent || '').trim().slice(0, 1000),
            field: (item?.querySelector('label, .arco-form-item-label')?.textContent || '').trim().slice(0, 200),
            // Record control identities only; never dump values, headers, or request bodies.
            controls: Array.from(item?.querySelectorAll('input, textarea, select') || []).slice(0, 10)
                .map(control => ({ id: control.id.slice(0, 200), name: (control.getAttribute('name') || '').slice(0, 200) })),
            scope: node.closest('.arco-modal, .arco-drawer, [role="dialog"]') ? 'dialog' : 'page',
        };
    }));
}

interface SaveRequestStatus {
    method: string;
    endpoint: string;
    state: 'pending' | 'response_received' | 'parsed' | 'parse_failed' | 'request_failed';
    httpStatus?: number;
    code?: string | number | null;
    statusCode?: string | number | null;
    message?: string;
    failure?: string;
}

function businessCode(value: unknown): string | number | null {
    return typeof value === 'string' ? value.slice(0, 200) : typeof value === 'number' ? value : null;
}

/** Confirm this save attempt through its response, dialog state, and page errors. */
export async function waitStageSubmitResult(page: any, dialog: any, options: {
    submit?: () => Promise<void>;
    timeoutMs?: number;
    context?: { subtaskIndex: number; douyinId: string };
} = {}): Promise<void> {
    const timeout = options.timeoutMs ?? UNIFIED.STAGE_SAVE_TIMEOUT;
    const requests = new Set<any>();
    const requestStatuses = new Map<any, SaveRequestStatus>();
    let beforeSubmitErrors: SavePageError[] = [];
    let detectedErrorsRead: Promise<SavePageError[]> | undefined;
    let diagnosticReadError: string | undefined;
    const captureErrors = async (): Promise<SavePageError[]> => {
        try { return await readSavePageErrors(page); }
        catch (error: any) { diagnosticReadError = String(error.message).slice(0, 500); return []; }
    };
    let responseSeen = false;
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const responseResult = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    void responseResult.catch(() => {});
    const onRequest = (request: any) => {
        if (!isStageSaveRequest(request)) return;
        requests.add(request);
        const url = new URL(request.url());
        requestStatuses.set(request, { method: request.method(), endpoint: `${url.origin}${url.pathname}`, state: 'pending' });
    };
    const onResponse = async (response: any) => {
        if (!requests.has(response.request())) return;
        responseSeen = true;
        const status = requestStatuses.get(response.request())!;
        status.httpStatus = response.status();
        status.state = 'response_received';
        try {
            const body = await response.json();
            status.state = 'parsed';
            status.code = businessCode(body?.code);
            status.statusCode = businessCode(body?.status_code);
            const message = body?.msg ?? body?.message ?? body?.status_msg;
            if (typeof message === 'string') status.message = message.slice(0, 1000);
            if (response.status() < 200 || response.status() >= 300 || body?.code !== 0 ||
                (body.status_code !== undefined && body.status_code !== 0)) {
                throw new Error('搭剧保存响应失败，禁止继续提交');
            }
            finish();
        } catch (error: any) {
            if (status.state !== 'parsed') status.state = 'parse_failed';
            status.failure = String(error.message).slice(0, 500);
            fail(new Error(`搭剧保存结果未确认：${error.message}`));
        }
    };
    const onFailed = (request: any) => {
        if (requests.has(request)) {
            const status = requestStatuses.get(request)!;
            status.state = 'request_failed';
            status.failure = String(request.failure?.()?.errorText || '连接中断').slice(0, 500);
            fail(new Error('搭剧保存连接中断，结果不确定'));
        }
    };
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onFailed);
    const timer = setTimeout(() => fail(new Error('搭剧保存响应超时，结果不确定')), timeout);
    const errors = page.locator(errorSelector)
        .filter({ hasText: STAGE_PAGE_ERROR_PATTERN })
        .filter({ hasNotText: STAGE_LINGERING_ERROR_PATTERN }).first();
    try {
        await dismissStagePageToasts(page);
        beforeSubmitErrors = await captureErrors();
        const hidden = dialog.waitFor({ state: 'hidden', timeout });
        void hidden.catch(() => {});
        const detectedError = errors.waitFor({ state: 'visible', timeout })
            .then(() => {
                // Start the snapshot immediately, but do not delay the blocking failure.
                detectedErrorsRead = captureErrors();
                throw new Error('搭剧保存失败，页面出现错误提示');
            }, () => new Promise<void>(() => {}));
        void detectedError.catch(() => {});
        if (options.submit) await options.submit();
        await Promise.race([hidden, detectedError, responseResult.then(() => hidden)]);
        if (requests.size || responseSeen) await responseResult;
        if (await errors.isVisible()) throw new Error('搭剧保存失败，页面出现错误提示');
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('.arco-modal-mask, .arco-drawer-mask'))
            .some(node => {
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }), null, { timeout: UNIFIED.STAGE_ACTION_TIMEOUT });
    } catch (error: any) {
        // Keep transient toasts captured at detection as well as fields revealed by this click.
        const detectedPageErrors = await detectedErrorsRead || [];
        const currentErrors = await captureErrors();
        const pageErrors = [...new Map([...detectedPageErrors, ...currentErrors]
            .map(entry => [JSON.stringify(entry), entry])).values()].slice(0, 20);
        const diagnostics = {
            ...options.context,
            reason: String(error.message),
            beforeSubmitErrors,
            pageErrors: pageErrors.map(entry => ({ ...entry,
                existedBeforeSubmit: beforeSubmitErrors.some(before => JSON.stringify(before) === JSON.stringify(entry)),
            })),
            requests: [...requestStatuses.values()].slice(0, 20).map(status => ({ ...status })),
            requestCount: requests.size,
            responseSeen,
            diagnosticReadError,
        };
        writeStructuredLog('STAGE_SAVE_FAILURE', diagnostics);
        const pageSummary = pageErrors.map(entry => `${entry.field || entry.scope}: ${entry.text}`).join(' | ') || '未捕获到可见错误提示';
        const requestSummary = diagnostics.requests.map(status =>
            `${status.method} ${status.endpoint} [${status.state}, HTTP=${status.httpStatus ?? '未收到'}, code=${status.code ?? '未知'}, status_code=${status.statusCode ?? '未知'}] ${status.message || status.failure || ''}`
        ).join(' | ') || '未观察到匹配的保存请求';
        const failure = new Error(`${error.message}；页面提示：${pageSummary}；保存接口：${requestSummary}`, { cause: error });
        throw Object.assign(failure, { diagnostics });
    } finally {
        clearTimeout(timer);
        page.off('request', onRequest);
        page.off('response', onResponse);
        page.off('requestfailed', onFailed);
    }
}
