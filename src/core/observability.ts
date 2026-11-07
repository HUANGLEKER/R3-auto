import {monitorEventLoopDelay} from 'node:perf_hooks';

const delay = monitorEventLoopDelay({resolution: 20});
delay.enable();
const queues = new Set<() => number>();
let frames = 0, bytes = 0, slowDisconnects = 0;

export function registerTransportQueue(queue: () => number): () => void {
    queues.add(queue);
    return () => queues.delete(queue);
}

export function recordTransportFrame(size: number): void {
    frames++;
    bytes += size;
}

export function recordSlowDisconnect(): void {
    slowDisconnects++;
}

export function getRuntimeDiagnostics() {
    return {
        process: {
            rssBytes: process.memoryUsage().rss,
            eventLoopMeanMs: Number.isFinite(delay.mean) ? delay.mean / 1e6 : 0,
            eventLoopMaxMs: delay.max / 1e6
        },
        transport: {
            connections: queues.size,
            queuedBytes: [...queues].reduce((sum, queue) => sum + queue(), 0),
            frames,
            bytes,
            slowDisconnects
        }
    };
}
