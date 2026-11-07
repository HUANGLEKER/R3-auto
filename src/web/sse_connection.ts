// ============================================================
// SSE (Server-Sent Events) 连接管理器
// 实现基于背压缓冲与最大帧限制的流式传输连接
// ============================================================

import type { ServerResponse } from 'node:http';
import { registerTransportQueue, recordTransportFrame, recordSlowDisconnect } from '../core/observability.ts';

/**
 * 创建 SSE 连接封装对象。
 * 限制慢客户端最大缓冲字节数，超出阈值时安全断开以防止内存无限制累积。
 */
export function createSSEConnection(
    response: ServerResponse,
    maxBytes = 1024 * 1024,
    maxFrameBytes = 16 * 1024 * 1024
) {
    const queue: string[] = [];
    let bytes = 0;
    let blocked = false;
    let closed = false;

    const unregister = registerTransportQueue(() => bytes);

    const close = () => {
        closed = true;
        queue.length = 0;
        bytes = 0;
        response.off('drain', drain);
        unregister();
    };

    const drain = () => {
        blocked = false;
        while (!closed && !blocked && queue.length) {
            const frame = queue.shift()!;
            bytes -= Buffer.byteLength(frame);
            blocked = !response.write(frame);
        }
    };

    response.on('drain', drain);
    response.once('close', close);

    return {
        write(frame: string): void {
            if (closed) return;
            const size = Buffer.byteLength(frame);
            if (size > maxFrameBytes || (blocked && bytes + size > maxBytes)) {
                recordSlowDisconnect();
                close();
                response.destroy();
                return;
            }
            recordTransportFrame(size);
            if (blocked) {
                queue.push(frame);
                bytes += size;
            } else {
                blocked = !response.write(frame);
            }
        },
        close,
        queuedBytes: () => bytes,
    };
}
