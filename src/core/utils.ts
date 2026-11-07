// ============================================================
// Core Utility Functions
// ============================================================

import { UNIFIED } from './config.ts';

export function normalizeTitle(value: unknown): string {
    return String(value || '')
        .trim()
        // 只去除 ASCII 控制字符与 HTML 特殊字符，保留中文、字母、数字及中文标点
        .replace(/[\x00-\x1F\x7F<>&"']/g, '');
}

export function elapsed(start: number): number {
    return Date.now() - start;
}

/**
 * 抖音作品 ID 全程按字符串处理。
 * 不能 Number()/parseInt()，否则 18~20 位长 ID 可能超过 JS Number 安全整数范围而失真。
 */
export function normalizeDouyinId(value: unknown): string {
    const text = String(value || '').trim();
    return /^\d{10,30}$/.test(text) ? text : '';
}

// JSON 中的 16~20 位 ID 先转成字符串再 JSON.parse，防止 JS Number 精度损失。
export const BIG_ID_REGEX =
    /("[-_a-zA-Z0-9]*id"\s*:\s*)(-?\d{16,})(?=\s*[,}\]])/gi;

export function parseJsonPreserveIds(text: unknown): any {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(
            String(text).replace(
                BIG_ID_REGEX,
                '$1"$2"'
            )
        );
    } catch (_) {
        return null;
    }
}

export type PaidPanelType = '中额' | '小额' | '超小额' | '超超小额';

/**
 * 识别任意充值面板/模板名称所属的面板大类：
 * - 超超小额 (如：超超小额、超超小额（60集以上）、超超小额(60集以下))
 * - 超小额   (如：超小额、超小额（60集以上）、超小额(30集-50集))
 * - 小额     (如：小额、小额（30集以上）、小额(30集-50集)、小额（50集以上）)
 * - 中额     (如：中额、中额（30集以上）、中额(30集-50集)、中额（50集以上）)
 * 
 * 严格区分小额、超小额、超超小额，互不混淆！
 */
export function getPaidPanelCategory(name: unknown): PaidPanelType | null {
    const raw = String(name || '').trim();
    if (!raw) return null;
    const text = raw.replace(/\s+/g, '');

    // 匹配顺序非常重要：先双“超”前缀"超超小额"，再单“超”前缀"超小额"，再"小额"，最后"中额"
    if (text.includes('超超小额')) {
        return '超超小额';
    }
    if (text.includes('超小额')) {
        return '超小额';
    }
    if (text.includes('小额')) {
        return '小额';
    }
    if (text.includes('中额')) {
        return '中额';
    }
    return null;
}

/**
 * 判断两个模板或面板名称是否匹配同一业务分类：
 * 支持 targetTemplate 为四大面板（中额、小额、超小额、超超小额）中的任一种，
 * 并能匹配 candidateTemplate 下包含括号备注的不同形态（如 中额（30集以上）、中额（30集-50集）等）。
 */
export function isPaidTemplateMatched(
    targetTemplate: string,
    candidateTemplate: unknown
): boolean {
    const candidate = String(candidateTemplate || '').trim();
    if (!candidate) return false;

    const targetCategory = getPaidPanelCategory(targetTemplate);
    const candidateCategory = getPaidPanelCategory(candidate);

    if (targetCategory && candidateCategory) {
        return targetCategory === candidateCategory;
    }

    if (targetCategory && !candidateCategory) {
        return false;
    }

    return candidate === targetTemplate || candidate.includes(targetTemplate);
}

/**
 * 分布式标准 Full Jitter 指数退避重试算法：
 * SleepTime = Math.random() * Math.min(maxMs, baseMs * Math.pow(2, attempt))
 */
export async function retryWithJitter<T>(
    fn: (attempt: number) => Promise<T>,
    options: {
        maxRetries?: number;
        baseMs?: number;
        maxMs?: number;
        onRetry?: (attempt: number, delayMs: number, error: any) => void;
    } = {}
): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const baseMs = options.baseMs ?? 300;
    const maxMs = options.maxMs ?? 3000;

    let lastError: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn(attempt + 1);
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries - 1) {
                break;
            }

            const expCap = Math.min(maxMs, baseMs * Math.pow(2, attempt));
            const jitterDelay = Math.round(Math.random() * expCap);

            if (options.onRetry) {
                options.onRetry(attempt + 1, jitterDelay, error);
            }

            await new Promise(resolve => setTimeout(resolve, jitterDelay));
        }
    }

    throw lastError || new Error(`重试 ${maxRetries} 次后仍失败`);
}

/**
 * 根据错误类型与特征信息生成排查指引建议，帮助运维和操作人员快速定位原因。
 */
export function formatTroubleshootingAdvice(error: unknown): string | null {
    if (!error) return null;
    const msg = typeof error === 'string' ? error : (error as any)?.message || String(error);
    const code = (error as any)?.code;

    if (code === 'STAGE_TASK_BLOCKING_FAILURE') {
        return '阻断性失败：搭剧页面状态发生严重未预期改变，已停止自动化以防错填。请人工查看 Edge 浏览器当前页面。';
    }
    if (code === 'STAGE_SUBMIT_NOT_STARTED' || msg.includes('整页确认提交按钮')) {
        return '提交未开始：确认提交按钮未就绪或被遮挡，请核对搭剧页面是否有未关闭的模态对话框或表单校验红字。';
    }
    if (msg.includes('未查询到对应端原生作品') || msg.includes('分页提前结束')) {
        return '作品匹配失败：常读 OpenAPI 未检索到该剧或分页提前结束，请核实剧名/短剧ID是否正确，以及作品是否处于已发布状态。';
    }
    if (msg.includes('作品未发布') || msg.includes('作品无授权') || msg.includes('作品不可投放')) {
        return '作品资格不足：该作品在常读后台尚未通过发布审核、缺乏授权或被设为不可投放。';
    }
    if (msg.includes('QPS') || msg.includes('限流') || msg.includes('访问速度过快') || msg.includes('速度过快') || msg.includes('无法核实当前原生内容') || msg.includes('所选渠道无法核实') || msg.includes('查询分销渠道失败') || msg.includes('fetch failed') || msg.includes('aborted due to timeout') || msg.includes('The operation was aborted')) {
        return '接口限流：触发平台或常读访问频次上限，系统已自动通过退避算法重试或移至队列末尾。';
    }
    if (code === 'STAGE_DRAMA_SEARCH_EXHAUSTED' || msg.includes('三轮搜索失败')) {
        return '搭剧搜索失败：搭剧页面短剧下拉框未能检索到对应剧目，请确认该剧是否已在搭剧后台录入。';
    }
    if (msg.includes('缺少或未识别页面') || msg.includes('常读页面识别未通过')) {
        return '浏览器环境异常：未能识别到全部必需的 Edge/Chrome 标签页，请确保浏览器已用调试端口（9224）启动并打开指定页面。';
    }
    if (msg.includes('重复剧') || /已被.*创建过项目/.test(msg)) {
        return '冲突去重拦截：该剧目与抖音号已被其它任务创建过项目，系统已自动跳过或替换。';
    }
    if (msg.includes('凭据未配置') || msg.includes('SECRET_KEY') || msg.includes('DISTRIBUTOR_ID')) {
        return '凭据缺失：常读 OpenAPI 秘钥或渠道 ID 未配置，请检查 .env 文件或配置面板。';
    }
    if (msg.includes('CDP') || msg.includes('ECONNREFUSED') || msg.includes('target closed') || msg.includes('browser has been closed')) {
        return '浏览器连接中断：与 Edge/Chrome 浏览器的 CDP 通信断开，请检查浏览器是否意外退出。';
    }

    return null;
}
