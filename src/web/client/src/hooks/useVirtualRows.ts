import { useLayoutEffect, useRef, useState } from 'react';

const OVERSCAN = 8;
export const RESULT_ROW_HEIGHT = 44;

export function useVirtualRows(count: number, resetKey: string) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ top: 0, height: 460 });
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const update = () => setViewport(previous => {
            const next = { top: Math.floor(container.scrollTop / RESULT_ROW_HEIGHT) * RESULT_ROW_HEIGHT, height: container.clientHeight };
            return previous.top === next.top && previous.height === next.height ? previous : next;
        });
        const observer = new ResizeObserver(update);
        observer.observe(container);
        container.addEventListener('scroll', update, { passive: true });
        update();
        return () => { observer.disconnect(); container.removeEventListener('scroll', update); };
    }, []);
    useLayoutEffect(() => {
        if (containerRef.current) containerRef.current.scrollTop = 0;
        setViewport(previous => ({ ...previous, top: 0 }));
    }, [resetKey]);
    const visibleCount = Math.ceil(viewport.height / RESULT_ROW_HEIGHT) + OVERSCAN * 2;
    const start = Math.max(0, Math.min(Math.floor(viewport.top / RESULT_ROW_HEIGHT) - OVERSCAN, count - visibleCount));
    const end = Math.min(count, start + visibleCount);
    return { containerRef, start, end, paddingTop: start * RESULT_ROW_HEIGHT, paddingBottom: (count - end) * RESULT_ROW_HEIGHT };
}
