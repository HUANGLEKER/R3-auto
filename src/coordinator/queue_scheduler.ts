// ============================================================
// 待搭剧目队列调度器 (QueueScheduler)
// 支持剧目暂缓重试与 QPS 触发上限时的退避重新入队
// ============================================================

export interface QueueItem {
    keyword: string;
    index: number;
    deferred: boolean;
    qpsRetryCount: number;
    notBefore?: number;
}

export class QueueScheduler {
    readonly items: QueueItem[];

    constructor(keywords: string[]) {
        this.items = keywords.map((keyword, index) => ({
            keyword,
            index,
            deferred: false,
            qpsRetryCount: 0,
        }));
    }

    /**
     * 将剧目延迟至队列末尾重试（仅允许推迟一次）
     */
    deferSelection(item: QueueItem): boolean {
        if (item.deferred) {
            return false;
        }
        item.deferred = true;
        this.items.push(item);
        return true;
    }

    /**
     * 限流重排：最多两次；第 n 次重排后至少冷却 n × cooldownMs 才可再次处理。
     */
    deferRateLimit(item: QueueItem, cooldownMs = 0, now = Date.now()): boolean {
        if (item.qpsRetryCount >= 2) {
            return false;
        }
        item.qpsRetryCount++;
        item.notBefore = now + cooldownMs * item.qpsRetryCount;
        this.items.push(item);
        return true;
    }
}
