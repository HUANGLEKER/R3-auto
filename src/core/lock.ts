// ============================================================
// Single-Instance Process Lock & Promo View Mutex Lock
// ============================================================

import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUN_LOCK_PATH} from './paths.ts';

const __filename = fileURLToPath(import.meta.url);

// ------------------------------------------------------------
// 1. P2：免费/付费并行只读查询时，序列化 Drawer + Clipboard fallback
// ------------------------------------------------------------
export type LockProfilerHook = {
    onLockAcquired?: (waitMs: number) => any;
    onLockReleased?: (token: any, waitMs: number, holdMs: number) => void;
    recordLockEvent?: (waitMs: number, holdMs: number) => void;
};

let lockProfilerHook: LockProfilerHook | null = null;

export function setLockProfilerHook(hook: LockProfilerHook | null): void {
    lockProfilerHook = hook;
}

let promoViewLockTail: Promise<unknown> = Promise.resolve();

export async function withPromoViewLock<T>(task: () => Promise<T>): Promise<T> {
    const queueStart = performance.now();
    const previous = promoViewLockTail;
    let release!: () => void;

    promoViewLockTail = new Promise<void>(resolve => {
        release = resolve;
    });

    await previous;

    const waitMs = Math.round((performance.now() - queueStart) * 100) / 100;
    const holdStart = performance.now();
    const spanToken = lockProfilerHook?.onLockAcquired ? lockProfilerHook.onLockAcquired(waitMs) : null;

    try {
        return await task();
    } finally {
        const holdMs = Math.round((performance.now() - holdStart) * 100) / 100;
        lockProfilerHook?.recordLockEvent?.(waitMs, holdMs);
        if (lockProfilerHook?.onLockReleased) {
            lockProfilerHook.onLockReleased(spanToken, waitMs, holdMs);
        }
        release();
    }
}

// ------------------------------------------------------------
// 2. P1：单实例锁，避免多个运行同时修改搭剧任务
// ------------------------------------------------------------
// Atomic directory creation serializes all acquisition/reclamation attempts.
// Never reclaim this short-lived gate by age: a paused process may still own it.
export const RUN_LOCK_GATE_PATH = RUN_LOCK_PATH + '.acquire';
let ownedToken: string | null = null;

export function isProcessAlive(pid: unknown): boolean {
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: any) {
        // Only ESRCH proves absence. Permission and other errors must fail closed.
        return error?.code !== 'ESRCH';
    }
}

interface RunLock {
    pid: number;
    startedAt?: string;
    script?: string;
    token?: string;
}

export function readRunLock(): RunLock | null {
    let raw: string;
    try {
        raw = fs.readFileSync(RUN_LOCK_PATH, 'utf8');
    } catch (error: any) {
        if (error?.code === 'ENOENT') return null;
        throw new Error('运行锁不可读，已阻断启动，请核对运行实例。', {cause: error});
    }
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
            (value.token !== undefined && (typeof value.token !== 'string' || !value.token))) {
            throw new Error('锁结构无效');
        }
        return value;
    } catch (cause) {
        throw new Error('运行锁损坏或尚未写完，已阻断启动，禁止自动删除。', {cause});
    }
}

export function acquireSingleInstanceLock(): void {
    if (ownedToken) throw new Error('当前进程已有任务正在运行。');
    try {
        fs.mkdirSync(RUN_LOCK_GATE_PATH);
    } catch (cause) {
        throw new Error('运行锁正在获取或存在遗留获取目录，请稍后重试；持续失败需核对实例后处理。', {cause});
    }
    try {
        const existing = readRunLock();
        if (existing && isProcessAlive(existing.pid)) {
            throw new Error('检测到另一个脚本实例正在运行（PID=' + existing.pid + '），本次运行已终止。');
        }
        // Every cooperating acquirer holds the gate. Nobody can replace a stale
        // lock between this read and unlink; unreadable locks are never deleted.
        if (existing) fs.unlinkSync(RUN_LOCK_PATH);
        const token = randomUUID();
        const fd = fs.openSync(RUN_LOCK_PATH, 'wx');
        try {
            fs.writeFileSync(fd, JSON.stringify({
                pid: process.pid, token,
                startedAt: new Date().toISOString(), script: path.basename(__filename)
            }), 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        ownedToken = token;
    } finally {
        // Non-recursive removal: never erase unexpected contents or another gate.
        fs.rmdirSync(RUN_LOCK_GATE_PATH);
    }
}

export function releaseSingleInstanceLock(): void {
    if (!ownedToken) return;
    try {
        const existing = readRunLock();
        // A live owner cannot be reclaimed by another acquirer. Compare the token
        // as well as PID so a replaced/corrupt file is left intact.
        if (existing?.pid === process.pid && existing.token === ownedToken) fs.unlinkSync(RUN_LOCK_PATH);
    } catch (_) {
        // Fail closed on shutdown; an unreadable lock must remain for inspection.
    } finally {
        ownedToken = null;
    }
}
