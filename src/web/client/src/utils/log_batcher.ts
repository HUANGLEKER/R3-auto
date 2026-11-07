/** Bound both queued and displayed logs; snapshots can invalidate an entire pending batch. */
export function createLogBatcher<T>(consume: (entries: T[]) => void, delayMs = 100, limit = 800) {
    let entries: T[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const reset = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        entries = [];
    };
    const flush = () => {
        const batch = entries;
        reset();
        if (!disposed && batch.length) consume(batch);
    };
    return {
        append(entry: T) {
            if (disposed) return;
            entries.push(entry);
            if (entries.length > limit) entries.splice(0, entries.length - limit);
            if (timer === undefined) timer = setTimeout(flush, delayMs);
        },
        flush, reset,
        dispose() { reset(); disposed = true; },
    };
}
