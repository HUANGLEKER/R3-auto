import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';

export interface RunContext {
    runId: string;
    startedAt: number;
    resources: Map<string, unknown>;
}

const contexts = new AsyncLocalStorage<RunContext>();
export const processSessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}_pid${process.pid}`;

export function currentRunContext(): RunContext | undefined {
    return contexts.getStore();
}

export function currentRunId(): string {
    return contexts.getStore()?.runId ?? processSessionId;
}

export function withRunContext<T>(runId: string, operation: () => T): T {
    return contexts.run({runId, startedAt: Date.now(), resources: new Map()}, operation);
}

export function newRunId(): string {
    return `${processSessionId}_${randomUUID()}`;
}

export function runResource<T>(name: string, factory: () => T, fallback: T): T {
    const context = contexts.getStore();
    if (!context) return fallback;
    if (!context.resources.has(name)) context.resources.set(name, factory());
    return context.resources.get(name) as T;
}

/** Compatibility facade; each async run receives its own instance, diagnostics see the latest. */
export function scopedProxy<T extends object>(name: string, factory: () => T): T {
    let latest = factory();
    const resolve = () => runResource(name, () => {
        latest = factory();
        return latest;
    }, latest);
    return new Proxy(latest, {
        get(_target, key) {
            const value = Reflect.get(resolve(), key, resolve());
            return typeof value === 'function' ? value.bind(resolve()) : value;
        },
        set(_target, key, value) {
            return Reflect.set(resolve(), key, value);
        },
        ownKeys() {
            return Reflect.ownKeys(resolve());
        },
        getOwnPropertyDescriptor(_target, key) {
            return Object.getOwnPropertyDescriptor(resolve(), key);
        },
    });
}
