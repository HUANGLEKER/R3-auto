export interface ServiceHealth { status: 'ready' | 'faulted'; reason: string | null; faultedAt: number | null; }
const health: ServiceHealth = { status: 'ready', reason: null, faultedAt: null };
const listeners = new Set<(health: ServiceHealth) => void>();
export function getServiceHealth(): ServiceHealth { return { ...health }; }
export function faultService(error: unknown): void {
    if (health.status === 'faulted') return;
    health.status = 'faulted'; health.reason = error instanceof Error ? error.message : String(error); health.faultedAt = Date.now();
    for (const listener of listeners) { try { listener(getServiceHealth()); } catch (_) {} }
}
export function onServiceFault(listener: (health: ServiceHealth) => void): () => void {
    listeners.add(listener); return () => listeners.delete(listener);
}
