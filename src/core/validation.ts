import { z } from 'zod';

export const keywordSchema = z.string().trim().min(1).max(500)
    .refine(value => !/[\r\n\u0000]/.test(value), '每项输入只能包含一行文本');
export const copyUrlSchema = z.string().trim().max(8192).refine(value => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'usergrowth.com.cn' &&
            !url.username && !url.password && (!url.port || url.port === '443') &&
            url.pathname === '/onestop/ad/ad_create/copy';
    } catch { return false; }
}, '复制链接必须为 usergrowth.com.cn 的 HTTPS 搭剧复制页');
export const roiSchema = z.union([z.string().trim(), z.number().finite().transform(String)])
    .refine(value => /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100,
        'ROI 必须为大于 0 且不超过 100 的有限十进制数');
export const paidTemplateSchema = z.enum(['超超小额', '超小额', '小额', '中额']).optional();
export const DAILY_BUDGET_MIN = 300;
export const DAILY_BUDGET_MAX = 9999999.99;

/**
 * 过滤项目日预算输入：仅保留 0~9 数字和最多一个小数点（最多两位小数），其余字符全部无效。
 * 若输入值高于 9999999.99 则自动变为 9999999.99。
 */
export function sanitizeDailyBudgetInput(raw: unknown): string {
    const str = raw === undefined || raw === null ? '' : String(raw);
    const cleaned = str.replace(/[^0-9.]/g, '');
    if (!cleaned) return '';
    const dotIndex = cleaned.indexOf('.');
    let formatted: string;
    if (dotIndex === -1) {
        formatted = cleaned.replace(/^0+(?=\d)/, '');
    } else {
        const intPartRaw = cleaned.slice(0, dotIndex);
        const intPart = intPartRaw ? intPartRaw.replace(/^0+(?=\d)/, '') : '0';
        const decPart = cleaned.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2);
        formatted = `${intPart}.${decPart}`;
    }
    const num = Number(formatted);
    if (Number.isFinite(num) && num > DAILY_BUDGET_MAX) {
        return String(DAILY_BUDGET_MAX);
    }
    return formatted;
}

/**
 * 归一化项目日预算：低于 300 自动变为 300，高于 9999999.99 自动变为 9999999.99。
 */
export function normalizeDailyBudget(raw: unknown): string {
    const sanitized = sanitizeDailyBudgetInput(raw).replace(/\.$/, '');
    if (!sanitized) return String(DAILY_BUDGET_MIN);
    const num = Number(sanitized);
    if (!Number.isFinite(num) || num < DAILY_BUDGET_MIN) {
        return String(DAILY_BUDGET_MIN);
    }
    if (num > DAILY_BUDGET_MAX) {
        return String(DAILY_BUDGET_MAX);
    }
    return sanitized;
}

export const taskNamePrefixSchema = z.string().trim().max(180)
    .refine(value => !/[\r\n\u0000]/.test(value), '任务名称不能包含换行或控制字符')
    .optional();
export const dailyBudgetSchema = z.union([z.string().trim(), z.number().finite().transform(String)])
    .refine(
        value => value === '' || (
            /^\d+(?:\.\d{1,2})?$/.test(value) &&
            Number.isFinite(Number(value)) &&
            Number(value) >= DAILY_BUDGET_MIN &&
            Number(value) <= DAILY_BUDGET_MAX
        ),
        `项目日预算必须为 ${DAILY_BUDGET_MIN} ~ ${DAILY_BUDGET_MAX} 之间的有效金额（仅限 0-9 数字和 .，最多两位小数）`
    )
    .optional();
const keywords = z.array(keywordSchema).max(10000);
const copyUrls = z.array(copyUrlSchema).max(1000);

export const startRequestSchema = z.strictObject({
    keywords: keywords.min(1).optional(), copyPageUrls: copyUrls.min(1).optional(),
    roiRatio: roiSchema.optional(), paidTemplate: paidTemplateSchema,
    taskNamePrefix: taskNamePrefixSchema, dailyBudget: dailyBudgetSchema,
});
export const runConfigSchema = z.strictObject({
    keywords: keywords.min(1), copyPageUrls: copyUrls.min(1),
    roiRatio: roiSchema, paidTemplate: paidTemplateSchema,
    taskNamePrefix: taskNamePrefixSchema, dailyBudget: dailyBudgetSchema,
});
export const configRequestSchema = z.strictObject({
    keywords: keywords.optional(), copyUrls: copyUrls.optional(),
    roiRatio: roiSchema.optional(), paidTemplate: paidTemplateSchema,
    taskNamePrefix: taskNamePrefixSchema, dailyBudget: dailyBudgetSchema,
});
export const environmentRequestSchema = z.strictObject({ keywords: keywords.optional() });

export class InputValidationError extends Error {
    statusCode = 400;
}

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        // Field paths and validation messages only; never echo submitted values.
        throw new InputValidationError('参数校验失败：' + result.error.issues.map(issue =>
            `${issue.path.join('.') || '请求体'}: ${issue.message}`).join('；'));
    }
    return result.data;
}
