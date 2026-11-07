// ============================================================
// Drama Conflict Guard Layer (Duplicate Drama Pre-check & Storage)
// ============================================================

import fs from 'node:fs';
import {CONFLICT_DRAMAS_PATH} from './paths.ts';

export interface ConflictDramaRecord {
    dramaId: string;
    douyinAccount: string;
    taskId?: string;
    dramaName?: string;
    reason: string;
    recordedAt: string;
}

export interface ConflictDramaStore {
    version: number;
    // Map of dramaId -> Array of ConflictDramaRecord
    items: Record<string, ConflictDramaRecord[]>;
    loadFailed?: boolean;
}

export function loadConflictDramaGuard(): ConflictDramaStore {
    try {
        if (!fs.existsSync(CONFLICT_DRAMAS_PATH)) {
            return {version: 1, items: {}};
        }

        const raw = fs.readFileSync(CONFLICT_DRAMAS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const isRecord = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

        if (!isRecord(parsed) || !isRecord(parsed.items)) {
            throw new Error('剧目冲突文件结构无效');
        }

        const items: Record<string, ConflictDramaRecord[]> = {};
        for (const [key, records] of Object.entries(parsed.items)) {
            if (Array.isArray(records)) {
                items[key] = records.filter(r => isRecord(r) && typeof r.dramaId === 'string' && r.dramaId.trim());
            } else if (isRecord(records) && typeof records.dramaId === 'string') {
                // 兼容单对象格式
                items[key] = [records as ConflictDramaRecord];
            }
        }

        return {
            version: parsed.version || 1,
            items,
            loadFailed: parsed.loadFailed === true,
        };
    } catch (error: any) {
        console.log(`⚠️ 剧目冲突记录文件读取失败: ${error.message}`);
        return {
            version: 1,
            items: {},
            loadFailed: true,
        };
    }
}

export const conflictDramaGuard: ConflictDramaStore = loadConflictDramaGuard();

/** 获得锁或新运行开始前刷新，避免常驻进程使用旧快照 */
export function reloadConflictDramaGuard(): void {
    const latest = loadConflictDramaGuard();
    conflictDramaGuard.version = latest.version;
    conflictDramaGuard.items = latest.items;
    conflictDramaGuard.loadFailed = latest.loadFailed === true;
}

export function saveConflictDramaGuard(): void {
    const tmpPath = `${CONFLICT_DRAMAS_PATH}.${process.pid}.tmp`;
    const payload = JSON.stringify(conflictDramaGuard, null, 2);

    let fd: number | null = null;
    try {
        fd = fs.openSync(tmpPath, 'w');
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;

        fs.renameSync(tmpPath, CONFLICT_DRAMAS_PATH);
    } catch (error: any) {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            } catch (_) {
            }
        }
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        } catch (_) {
        }
        console.log(`⚠️ 剧目冲突记录文件原子写入失败: ${error.message}`);
    }
}

/**
 * 从服务器返回的错误信息中精准解析出所有的“剧目 + 抖音号（任务）”对
 */
export function parseConflictPairsFromMessage(message: string): Array<{
    dramaId: string;
    douyinAccount: string;
    taskId?: string
}> {
    if (!message || typeof message !== 'string') return [];
    return [...message.matchAll(/剧目\s*(\d+)\s*[\+＋]\s*抖音号\s*(\d+)(?:\s*[（(]任务\s*(\d+)[)）]|\s*已被任务\s*(\d+)\s*创建过项目)?/g)].map(m => ({
        dramaId: m[1],
        douyinAccount: m[2],
        taskId: m[3] || m[4] || '',
    }));
}

/**
 * 记录服务器返回的重复剧冲突条目（剧目 + 抖音号）
 */
export function recordConflictDramas(
    conflicts: Array<{ dramaId: string; douyinAccount: string; taskId?: string }> | string[],
    reason: string,
    meta?: { dramaNameMap?: Record<string, string> }
): number {
    let addedCount = 0;
    const now = new Date().toISOString();

    // 优先从服务器 reason 中正则解析出结构化对；若无则从 conflicts 兜底
    const parsedFromReason = parseConflictPairsFromMessage(reason);
    let list: Array<{ dramaId: string; douyinAccount: string; taskId?: string }>;

    if (parsedFromReason.length > 0) {
        list = parsedFromReason;
    } else {
        list = (conflicts || []).map(c => typeof c === 'string' ? {dramaId: c, douyinAccount: ''} : c);
    }

    for (const c of list) {
        const dramaId = String(c.dramaId || '').trim();
        const douyinAccount = String(c.douyinAccount || '').trim();
        if (!dramaId) continue;

        if (!conflictDramaGuard.items[dramaId]) {
            conflictDramaGuard.items[dramaId] = [];
        }

        const existingList = conflictDramaGuard.items[dramaId];
        const existing = existingList.find(r => r.douyinAccount === douyinAccount);
        const dramaName = meta?.dramaNameMap?.[dramaId] || existing?.dramaName || '';

        const record: ConflictDramaRecord = {
            dramaId,
            douyinAccount,
            taskId: c.taskId || existing?.taskId || '',
            dramaName,
            reason,
            recordedAt: now,
        };

        if (existing) {
            Object.assign(existing, record);
        } else {
            existingList.push(record);
            addedCount++;
        }
    }

    if (addedCount > 0 || list.length > 0) {
        saveConflictDramaGuard();
    }

    return addedCount;
}

/**
 * 查询指定剧目（按 ID 或剧名）是否已被记录为冲突重复剧
 * @param dramaIdOrName 剧目 ID (作品ID/漫剧ID) 或剧名
 * @param douyinAccount 可选的指定抖音号。若提供则优先精确匹配该抖音号
 */
export function getDramaConflict(
    dramaIdOrName: string,
    douyinAccount?: string
): ConflictDramaRecord | null {
    const target = String(dramaIdOrName || '').trim();
    if (!target) return null;

    // 1. 按 dramaId 精确查询
    const listById = conflictDramaGuard.items[target];
    if (listById && listById.length > 0) {
        if (douyinAccount) {
            return listById.find(r => r.douyinAccount === douyinAccount) ?? null;
        }
        return listById[0];
    }

    // 2. 按剧名匹配 (仅在剧名非纯单字母时，避免单字符如 A, B 测试占位符误伤)
    if (target.length > 1) {
        for (const records of Object.values(conflictDramaGuard.items)) {
            for (const record of records) {
                if (record.dramaName && (record.dramaName === target || record.dramaName.trim() === target)) {
                    if (douyinAccount) {
                        if (record.douyinAccount === douyinAccount) return record;
                    } else {
                        return record;
                    }
                }
            }
        }
    }

    return null;
}

/**
 * 判定剧目是否为重复剧
 */
export function isDramaConflict(dramaIdOrName: string, douyinAccount?: string): boolean {
    return getDramaConflict(dramaIdOrName, douyinAccount) !== null;
}

/**
 * 清除冲突记录（主要用于测试隔离）
 */
export function clearConflictDramaGuard(): void {
    conflictDramaGuard.items = {};
    conflictDramaGuard.loadFailed = false;
    try {
        if (fs.existsSync(CONFLICT_DRAMAS_PATH)) {
            fs.unlinkSync(CONFLICT_DRAMAS_PATH);
        }
    } catch (_) {
    }
}
