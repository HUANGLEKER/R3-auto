// ============================================================
// 单剧目解析处理器 (ItemProcessor)
// 适配 ResolverPort 接口并负责异常与取消信号转换
// ============================================================

import type {ResolverPort} from '../contracts/platform.ts';

export class ItemProcessor {
    private pipeline: ResolverPort;

    constructor(pipeline: ResolverPort) {
        this.pipeline = pipeline;
    }

    /**
     * 解析指定剧目，支持传入 AbortSignal 协作式中断
     */
    async resolve(keyword: string, index: number, signal?: AbortSignal) {
        signal?.throwIfAborted();
        const result = await this.pipeline.get(keyword, index);
        signal?.throwIfAborted();

        if (!result.ok) {
            throw Object.assign(new Error(result.status), {
                code: result.errorCode ?? 'DRAMA_UNAVAILABLE',
                category: result.category,
            });
        }

        return result;
    }
}
