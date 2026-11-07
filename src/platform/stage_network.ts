// ============================================================
// Stage Platform Network Observation
// ============================================================

import { STAGE_ENDPOINTS, UNIFIED } from '../core/config.ts';

export function getStageResponseMeta(response: any): any {
    try {
        const request = response.request();
        const type = request.resourceType();
        if (type !== 'xhr' && type !== 'fetch') return null;

        const url = new URL(response.url());
        const host = url.hostname.toLowerCase();
        if (
            host !== STAGE_ENDPOINTS.HOST_SUFFIX &&
            !host.endsWith(`.${STAGE_ENDPOINTS.HOST_SUFFIX}`)
        ) return null;

        if (!url.pathname.startsWith(STAGE_ENDPOINTS.API_PREFIX)) return null;
        if (response.status() >= 500) return null;

        return {
            request,
            url,
            pathname: url.pathname,
            method: request.method().toUpperCase(),
        };
    } catch (_) {
        return null;
    }
}

export function isStageBusinessResponse(response: any): boolean {
    return Boolean(getStageResponseMeta(response));
}

export function stageRequestContainsValue(request: any, value: unknown): boolean {
    const expected = String(value || '');
    if (!expected) return false;

    try {
        const raw = [request.url(), request.postData() || ''].join('\n');
        return raw.includes(expected) || raw.includes(encodeURIComponent(expected));
    } catch (_) {
        return false;
    }
}

export function isStageContentSearchResponse(response: any, request: any, dramaId: string): boolean {
    const meta = getStageResponseMeta(response);
    return Boolean(
        meta && request === meta.request &&
        STAGE_ENDPOINTS.CONTENT_SEARCH.test(meta.pathname) &&
        stageRequestContainsValue(request, dramaId)
    );
}

export function isStageAutoMatchResponse(response: any, request: any, dramaId: string): boolean {
    const meta = getStageResponseMeta(response);
    return Boolean(
        meta && request === meta.request &&
        (stageRequestContainsValue(request, dramaId) || STAGE_ENDPOINTS.AUTO_MATCH_HINT.test(meta.pathname))
    );
}

export function isStageSaveResponse(response: any, request: any): boolean {
    const meta = getStageResponseMeta(response);
    if (!meta || request !== meta.request || !/POST|PUT|PATCH|DELETE/.test(meta.method)) {
        return false;
    }
    return isStageSaveRequest(request);
}

export function isStageSaveRequest(request: any): boolean {
    try {
        const url = new URL(request.url());
        return (url.hostname === STAGE_ENDPOINTS.HOST_SUFFIX || url.hostname.endsWith(`.${STAGE_ENDPOINTS.HOST_SUFFIX}`)) &&
            url.pathname.startsWith(STAGE_ENDPOINTS.API_PREFIX) && /^(POST|PUT|PATCH)$/.test(request.method()) &&
            STAGE_ENDPOINTS.SAVE_HINT.test(url.pathname);
    } catch (_) { return false; }
}

export function createStageXHRWatcher(
    page: any,
    predicate: (response: any, request: any) => boolean,
    timeout = UNIFIED.STAGE_ACTION_TIMEOUT,
): { promise: Promise<any>; cancel: () => void } {
    let done = false;
    let timer: NodeJS.Timeout | null = null;
    let resolvePromise: (value: any) => void = () => {};

    const finish = (value: any) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        page.off('response', onResponse);
        resolvePromise(value);
    };

    const onResponse = (response: any) => {
        if (done || !isStageBusinessResponse(response)) return;
        try {
            const request = response.request();
            if (!predicate(response, request)) return;
            finish({ url: response.url(), status: response.status(), method: request.method() });
        } catch (_) {}
    };

    const promise = new Promise<any>(resolve => {
        resolvePromise = resolve;
        page.on('response', onResponse);
        timer = setTimeout(() => finish(null), timeout);
    });

    return { promise, cancel: () => finish(null) };
}
