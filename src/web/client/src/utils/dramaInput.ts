// ============================================================
// Client-side Drama Input Classification & Detection
// ============================================================

export function parseDramaInput(value: unknown): {
    raw: string;
    kind: 'book_id' | 'douyin_id' | 'ambiguous_id' | 'title';
    id: string;
} {
    const raw = String(value || '').trim();
    const douyin = raw.match(/^(?:抖音(?:作品|专辑|版本)?|作品|aweme|item)\s*id\s*[:：#]?\s*([0-9]{10,30})$/i);
    if (douyin) return { raw, kind: 'douyin_id', id: douyin[1] };
    const book = raw.match(/^(?:漫剧|剧目|书本|book|series|playlet)\s*id\s*[:：#]?\s*([0-9]{10,30})$/i);
    if (book) return { raw, kind: 'book_id', id: book[1] };
    const numeric = raw.match(/^([0-9]{10,30})$/);
    return numeric
        ? { raw, kind: 'ambiguous_id', id: numeric[1] }
        : { raw, kind: 'title', id: '' };
}

export interface DramaInputClassification {
    total: number;
    idCount: number;
    titleCount: number;
    isPureId: boolean;
    requiresFreeList: boolean;
}

export function classifyDramaInputs(inputs: string[]): DramaInputClassification {
    const valid = inputs.map(input => String(input || '').trim()).filter(Boolean);
    if (valid.length === 0) {
        return { total: 0, idCount: 0, titleCount: 0, isPureId: false, requiresFreeList: true };
    }
    let idCount = 0;
    let titleCount = 0;
    for (const item of valid) {
        if (parseDramaInput(item).kind === 'title') {
            titleCount++;
        } else {
            idCount++;
        }
    }
    return {
        total: valid.length,
        idCount,
        titleCount,
        isPureId: titleCount === 0 && idCount > 0,
        requiresFreeList: titleCount > 0,
    };
}
