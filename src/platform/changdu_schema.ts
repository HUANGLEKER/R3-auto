import { z } from 'zod';

const id = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const optionalText = z.string().nullish();
const recordSchema = z.looseObject({
    book_id: id.optional(), playlet_id: id.optional(), book_name: optionalText,
});

const envelopeSchema = z.looseObject({ code: z.number().int(), message: z.string().optional() });
const paginationSchema = z.looseObject({
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    has_more: z.boolean().optional(), is_truncated: z.boolean().optional(),
});

/** Run only after lossless JSON decoding; no numeric coercion of long IDs. */
export function validateOpenApiEnvelope(value: unknown): Record<string, unknown> & { code: number; message?: string } {
    const result = envelopeSchema.safeParse(value);
    if (!result.success) throw new Error('常读 OpenAPI 响应结构无效：业务码或消息类型错误');
    if (result.data.code === 200 && !paginationSchema.safeParse(value).success) {
        throw new Error('常读 OpenAPI 分页总数或分页标记类型无效');
    }
    return result.data;
}

export function validateOpenApiRecords(value: unknown): z.infer<typeof recordSchema>[] {
    const result = z.array(recordSchema).safeParse(value);
    if (!result.success) throw new Error('常读 OpenAPI 列表响应结构无效：作品 ID 或剧名字段类型错误，无法确认作品 ID');
    return result.data;
}
