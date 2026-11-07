// ============================================================
// Global Ambient & Type Declarations
// ============================================================

export type ConsoleWriteOptions = {
    forceBlankBefore?: boolean;
};

export type ConsoleClassification = {
    tag: string;
    text: string;
    forceBlankBefore?: boolean;
};

export interface ResolvedDramaData {
    name: string;
    seriesId: string;
    douyinId: string;
    cacheHit?: boolean;
    status?: string;
}

