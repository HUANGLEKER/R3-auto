export function formatDuration(durationMs?: number): string {
    if (!durationMs || durationMs <= 0) return '-';
    const totalSec = Math.floor(durationMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function formatElapsed(startedAt: number | null, finishedAt: number | null): string {
    if (!startedAt) return '00m 00s';
    const end = finishedAt || Date.now();
    const elapsedSec = Math.max(0, Math.floor((end - startedAt) / 1000));
    const m = Math.floor(elapsedSec / 60);
    const s = elapsedSec % 60;
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function formatRoiRatio(raw: unknown): string {
    return raw === undefined || raw === null ? '' : String(raw).trim();
}

export function getCurrentTimeString(): string {
    const now = new Date();
    return [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join(':');
}
