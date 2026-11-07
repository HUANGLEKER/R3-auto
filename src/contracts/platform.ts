import type {ResolvedDramaData} from '../types/index.ts';
import type {StageSubmitResult} from '../platform/stage_submit.ts';
import type * as openApi from '../platform/changdu_openapi.ts';

export type FailureCategory = 'unavailable' | 'retryable' | 'cancelled' | 'uncertain' | 'fatal';

interface ResolverFields extends Partial<ResolvedDramaData> {
    status: string;
    attempts: string[];
    cacheHit?: boolean;
    category?: FailureCategory;
    errorCode?: string;
}

export type ResolverResult = ResolverFields & ({ ok: true } | { ok: false });

export interface CatalogPort {
    search(keyword: string, signal?: AbortSignal): Promise<{
        candidates: Array<{ seriesId: string; name: string }>;
        reason?: string
    }>;
}

export interface BookEligibilityPort {
    checkOpenApiBookEligibility: typeof openApi.checkOpenApiBookEligibility;
    isChangduOpenApiConfigured: typeof openApi.isChangduOpenApiConfigured;
    resolveOpenApiBookId: typeof openApi.resolveOpenApiBookId;
}

export interface ResolverPort {
    get(keyword: string, index: number): Promise<ResolverResult>;

    prefetch(keyword: string, index: number): void;

    abort(): void;

    drain(): Promise<void>;
}

export interface StagePort {
    fill(page: unknown, slot: number, capacity: number, data: {
        name?: string;
        douyinId: string;
        roiRatio?: string;
        paidTemplate?: string;
        signal?: AbortSignal
    }): Promise<void>;

    /** Once sent, cancellation must drain the actual response; uncertain outcomes never authorize retry. */
    submit(page: unknown, signal?: AbortSignal): Promise<StageSubmitResult>;
}

export type PlatformId<K extends 'book' | 'playlet'> = string & { readonly platformId: K };

export function platformId<K extends 'book' | 'playlet'>(value: string, kind: K): PlatformId<K> {
    if (!/^\d+$/.test(value)) throw new Error(`${kind} ID 无效`);
    return value as PlatformId<K>;
}
