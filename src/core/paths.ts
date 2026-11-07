// ============================================================
// File Paths & Success Marker Handshake
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {getAuditStore} from './audit_store.ts';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_DIR = path.resolve(__dirname, '../../');
export const DATA_DIR = process.env.R3_DATA_DIR
    ? path.resolve(process.env.R3_DATA_DIR)
    : path.join(PROJECT_DIR, 'data');
export const txtPath = path.join(DATA_DIR, 'drama_list.txt');
export const excelLinkPath = path.join(DATA_DIR, '文件链接.xlsx');
export const roiRatioPath = path.join(DATA_DIR, 'roi系数.txt');

// 仅当主流程真正执行到最终 RUN_SUMMARY 后才写入。
// BAT 会同时检查 Node ExitCode=0 和该 marker，避免“无操作也显示成功”。
export const RUN_SUCCESS_MARKER_PATH = path.join(
    DATA_DIR,
    '.full_flow_success.json'
);

export const CONFLICT_DRAMAS_PATH = path.join(
    DATA_DIR,
    'conflict_dramas.json'
);

export const RUN_LOCK_PATH = path.join(
    DATA_DIR,
    'full_flow_unified.run.lock'
);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {recursive: true});
}

/**
 * 每次运行开始前删除上一次成功标记。
 * 删除失败直接抛错，避免旧 marker 导致 BAT 误判。
 */
export function clearRunSuccessMarker(): void {
    if (!fs.existsSync(RUN_SUCCESS_MARKER_PATH)) {
        return;
    }

    fs.unlinkSync(RUN_SUCCESS_MARKER_PATH);
}

/**
 * 主流程完整结束后原子写入成功标记。
 * 只有执行到 RUN_SUMMARY 后才允许调用。
 */
export function writeRunSuccessMarker(payload: Record<string, unknown>): void {
    const tmpPath = `${RUN_SUCCESS_MARKER_PATH}.${process.pid}.tmp`;

    fs.writeFileSync(
        tmpPath,
        JSON.stringify(
            {
                ok: true,
                pid: process.pid,
                completedAt: new Date().toISOString(),
                ...payload,
            },
            null,
            2
        ),
        'utf8'
    );

    fs.renameSync(tmpPath, RUN_SUCCESS_MARKER_PATH);
}

/**
 * 解析搭剧复制任务页 URL 列表文件
 */
export function parseCopyUrlsFromFile(targetFile: string): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();

    const addUrl = (raw: string) => {
        const text = String(raw || '').trim();
        let target = '';
        if (/^https?:\/\//i.test(text)) {
            target = text;
        } else if (text.includes('usergrowth.com.cn') && /https?:\/\/[^\s"']+/i.test(text)) {
            const match = text.match(/https?:\/\/[^\s"']+/i);
            if (match) target = match[0];
        }
        if (target && !seen.has(target)) {
            seen.add(target);
            urls.push(target);
        }
    };

    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(targetFile);

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) continue;

            // 1. 逐单元格扫描 URL
            for (const key of Object.keys(sheet)) {
                if (key.startsWith('!')) continue;
                const cell = sheet[key];
                const rawValue = String(cell?.v ?? cell?.w ?? '').trim();
                addUrl(rawValue);
            }

            // 2. 按行数组再次检索
            const rows = XLSX.utils.sheet_to_json(sheet, {header: 1}) as any[][];
            for (const row of rows) {
                if (!Array.isArray(row)) continue;
                for (const item of row) {
                    addUrl(String(item ?? ''));
                }
            }
        }
    } catch (err: any) {
        console.log(`⚠️ 读取 Excel 异常: ${err.message}，尝试纯文本回退检索...`);
    }

    // 3. 容错回退检索
    if (urls.length === 0) {
        try {
            const buffer = fs.readFileSync(targetFile);
            const rawString = buffer.toString('latin1');
            const urlMatches = rawString.match(/https?:\/\/[a-zA-Z0-9_\-./?&=%#~:;,+]+/g);
            if (urlMatches) {
                for (const u of urlMatches) {
                    if (u.includes('usergrowth.com.cn') || u.includes('/copy')) {
                        addUrl(u);
                    }
                }
            }
        } catch (_) {
        }
    }

    if (urls.length === 0) {
        throw new Error(
            `在“${targetFile}”中未解析到有效的搭剧复制链接 (URL)。请确认表格内填入了以 http:// 或 https:// 开头的有效链接。`
        );
    }

    return urls;
}

/**
 * 读取待处理漫剧关键词列表（收敛 SQLite 单一真相源）
 */
export function readKeywords(): string[] {
    const saved = getAuditStore().config()?.keywords;
    if (Array.isArray(saved)) {
        return saved as string[];
    }

    const candidatePaths = [
        path.join(DATA_DIR, 'drama_list.txt'),
        path.join(DATA_DIR, '搭链接.txt'),
    ];

    let targetFile = '';
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            targetFile = p;
            break;
        }
    }

    if (!targetFile) {
        throw new Error(
            [
                '找不到输入文件 data/drama_list.txt 且 SQLite 配置未初始化',
                `项目根目录: ${PROJECT_DIR}`,
                `期望路径: ${txtPath}`,
                '请在 Web 控制台中配置或确认“drama_list.txt”位于当前 R3 项目的 data 文件夹中。',
            ].join(' | ')
        );
    }

    const content = fs.readFileSync(targetFile, 'utf8');
    const keywords = content
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);

    try {
        const store = getAuditStore();
        const prev = store.config() || {};
        store.saveConfig({ ...prev, keywords });
    } catch (_) {}

    return keywords;
}

/**
 * 读取搭剧复制任务页 URL 列表（收敛 SQLite 单一真相源）
 */
export function readCopyPageUrls(): string[] {
    const saved = getAuditStore().config()?.copyUrls;
    if (Array.isArray(saved)) {
        return saved as string[];
    }

    const candidatePaths = [
        path.join(DATA_DIR, '文件链接.xlsx'),
        path.join(DATA_DIR, '文件链接.xls'),
    ];

    let targetFile = '';
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            targetFile = p;
            break;
        }
    }

    if (!targetFile) {
        throw new Error(
            [
                '找不到搭剧复制链接文件 data/文件链接.xlsx 且 SQLite 配置未初始化',
                `项目根目录: ${PROJECT_DIR}`,
                `期望路径: ${candidatePaths[0]}`,
                '请在 Web 控制台中配置或在 data/ 目录下放置“文件链接.xlsx”。',
            ].join(' | ')
        );
    }

    const urls = parseCopyUrlsFromFile(targetFile);
    try {
        const store = getAuditStore();
        const prev = store.config() || {};
        store.saveConfig({ ...prev, copyUrls: urls });
    } catch (_) {}

    return urls;
}

/**
 * 读取全域 ROI 系数（收敛 SQLite 单一真相源）
 */
export function readRoiRatio(): string {
    const saved = getAuditStore().config()?.roiRatio;
    if (typeof saved === 'string' && saved.trim()) {
        return saved.trim();
    }
    if (typeof saved === 'number') {
        return String(saved);
    }

    const candidatePaths = [
        path.join(DATA_DIR, 'roi系数.txt'),
        path.join(DATA_DIR, 'ROI系数.txt'),
        path.join(DATA_DIR, 'roi.txt'),
        path.join(PROJECT_DIR, 'roi系数.txt'),
    ];

    let targetFile = '';
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            targetFile = p;
            break;
        }
    }

    let ratio = '1';
    if (targetFile) {
        try {
            ratio = fs.readFileSync(targetFile, 'utf8').trim() || '1';
        } catch (_) {
            ratio = '1';
        }
    }

    try {
        const store = getAuditStore();
        const prev = store.config() || {};
        store.saveConfig({ ...prev, roiRatio: ratio });
    } catch (_) {}

    return ratio;
}

