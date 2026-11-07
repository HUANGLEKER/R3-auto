import type { ConsolePatch, TaskItem } from '../../../../contracts/console.ts';

/** Coalesce repeated projections without dropping a task change when the buffer is full. */
export function createPatchBatcher(consume: (patch: ConsolePatch, moves: number[]) => void, delayMs = 100, limit = 10000) {
    let updates = new Map<number, TaskItem>();
    let moves = new Set<number>();
    let metadata: ConsolePatch = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false, disposed = false;
    const reset = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined; updates = new Map(); moves = new Set(); metadata = {}; dirty = false;
    };
    const flush = () => {
        if (!dirty || disposed) return;
        const patch = { ...metadata, items: [...updates.values()] }, order = [...moves];
        reset(); consume(patch, order);
    };
    return {
        append(patch: ConsolePatch) {
            if (disposed) return;
            const { items, moveToEnd, ...fields } = patch;
            metadata = { ...metadata, ...fields }; dirty = true;
            for (const item of items ?? []) {
                updates.set(item.index, item);
            }
            if (moveToEnd !== undefined) { moves.delete(moveToEnd); moves.add(moveToEnd); dirty = true; }
            if (updates.size >= limit) flush();
            if (dirty && timer === undefined) timer = setTimeout(flush, delayMs);
        },
        flush, reset, dispose() { reset(); disposed = true; },
    };
}
