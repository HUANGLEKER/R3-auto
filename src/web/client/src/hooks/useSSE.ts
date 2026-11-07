import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConsoleState, LogEntry, TaskItem, ProgressInfo } from '../types.ts';
import { useToast } from '../context/ToastContext.tsx';
import { createLogBatcher } from '../utils/log_batcher.ts';
import { createPatchBatcher } from '../utils/patch_batcher.ts';
import { consoleEventSchema, type ConsoleEvent } from '../../../../contracts/console.ts';

const DEFAULT_STATE: ConsoleState = {
    status: 'idle',
    progress: { current: 0, total: 0, percentage: 0, successCount: 0, failedCount: 0 },
    currentItem: null,
    items: [],
    logs: [],
    copyUrls: [],
    roiRatio: '1.00',
    paidTemplate: '超超小额',
    taskNamePrefix: '',
    dailyBudget: '300',
    startedAt: null,
    finishedAt: null,
    lastError: null,
};

function stepFromLog(text: string): number | null {
    if (text.includes('只读查询') || text.includes('检索')) return 1;
    if (text.includes('资质') || text.includes('授权')) return 2;
    if (text.includes('作品ID') || text.includes('作品 ID')) return 3;
    if (text.includes('对齐') || text.includes('一致性')) return 4;
    if (text.includes('搭剧') || text.includes('填单')) return 5;
    return null;
}

export function useSSE() {
    const [state, setState] = useState<ConsoleState>(DEFAULT_STATE);
    // Editable next-run configuration is independent of the server's active-run snapshot.
    const [config, setConfig] = useState<{
        copyUrls: string[];
        roiRatio: string;
        paidTemplate: '超超小额' | '超小额' | '小额' | '中额';
        taskNamePrefix: string;
        dailyBudget: string;
    }>({
        copyUrls: DEFAULT_STATE.copyUrls,
        roiRatio: DEFAULT_STATE.roiRatio,
        paidTemplate: (DEFAULT_STATE.paidTemplate as any) || '超超小额',
        taskNamePrefix: DEFAULT_STATE.taskNamePrefix || '',
        dailyBudget: DEFAULT_STATE.dailyBudget || '300',
    });
    const [activeStep, setActiveStep] = useState<number>(0);
    const { showToast } = useToast();
    const eventSourceRef = useRef<EventSource | null>(null);
    const logBatchRef = useRef<ReturnType<typeof createLogBatcher<LogEntry>> | null>(null);
    const runningRef = useRef(false);
    const cursorRef = useRef({ runId: '', seq: -1 });

    const connect = useCallback(() => {
        logBatchRef.current?.dispose();
        logBatchRef.current = createLogBatcher<LogEntry>(entries => {
            setState(previous => ({ ...previous, logs: [...previous.logs, ...entries].slice(-800) }));
            if (runningRef.current) {
                for (let index = entries.length - 1; index >= 0; index--) {
                    const step = stepFromLog(entries[index].text);
                    if (step !== null) { setActiveStep(step); break; }
                }
            }
        });
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const es = new EventSource('/api/events');
        eventSourceRef.current = es;
        let disposed = false;
        let recovering = false;
        const retiredRuns = new Set<string>();
        let pendingEvents: ConsoleEvent[] = [];
        const recoveryController = new AbortController();
        const patchBatch = createPatchBatcher((patch, moves) => {
            const { items: changes, ...metadata } = patch;
            setState(previous => {
                const updates = new Map(changes?.map(item => [item.index, item]));
                let items = changes?.length ? previous.items.map(item => updates.get(item.index) ?? item) : previous.items;
                if (moves.length) {
                    const moveSet = new Set(moves);
                    const moved = new Map(items.filter(item => moveSet.has(item.index)).map(item => [item.index, item]));
                    items = [...items.filter(item => !moved.has(item.index)), ...moves.flatMap(index => moved.has(index) ? [moved.get(index)!] : [])];
                }
                return { ...previous, ...metadata, items };
            });
        });
        const receive = (event: ConsoleEvent) => {
            if (disposed) return;
            if (retiredRuns.has(event.runId)) return;
            if (recovering && event.kind !== 'snapshot') {
                if (pendingEvents.length >= 2000) pendingEvents = [];
                pendingEvents.push(event);
                return;
            }
            const cursor = cursorRef.current;
            if (event.kind === 'snapshot') {
                if (cursor.runId === event.runId && event.seq < cursor.seq) return;
                logBatchRef.current?.reset();
                patchBatch.reset();
                if (cursor.runId && cursor.runId !== event.runId) retiredRuns.add(cursor.runId);
                cursorRef.current = { runId: event.runId, seq: event.seq };
                runningRef.current = event.data.status === 'running';
                setState(previous => ({ ...previous, ...event.data }));
                if (!runningRef.current) setActiveStep(0);
                return;
            }
            if (event.runId === cursor.runId && event.seq <= cursor.seq) return;
            if (event.runId !== cursor.runId || event.seq !== cursor.seq + 1) { pendingEvents.push(event); void recover(); return; }
            cursorRef.current = { runId: event.runId, seq: event.seq };
            if (event.kind === 'logs') { for (const entry of event.data) logBatchRef.current?.append(entry); }
            else if (event.kind === 'logs_cleared') {
                logBatchRef.current?.reset(); setState(previous => ({ ...previous, logs: [] }));
            } else if (event.kind === 'phase') {
                patchBatch.flush();
                logBatchRef.current?.flush();
                if (event.data.phase === 'resolving') {
                    setActiveStep(prev => (prev >= 1 && prev <= 4 ? prev : 1));
                } else if (event.data.phase === 'filling' || event.data.phase === 'verifying' || event.data.phase === 'submitting') {
                    setActiveStep(5);
                } else if (event.data.phase === 'idle') {
                    setActiveStep(0);
                }
            } else if (event.kind === 'error') {
                setState(previous => ({ ...previous, lastError: event.data.message }));
                showToast(`运行异常：${event.data.message}`, 'error');
            } else if (event.kind === 'patch') {
                patchBatch.append(event.data);
                if (event.data.status && event.data.status !== 'running') patchBatch.flush();
                if (event.data.status) { runningRef.current = event.data.status === 'running'; if (!runningRef.current) setActiveStep(0); }
                const health = event.data.health as { status?: string; reason?: string } | undefined;
                if (health?.status === 'faulted') showToast(`后台服务故障：${health.reason || '请重启并核对结果'}`, 'error');
            }
        };
        const recover = async () => {
            if (recovering || disposed) return;
            recovering = true;
            try {
                const response = await fetch('/api/status', { signal: recoveryController.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const payload = await response.json();
                const snapshot = consoleEventSchema.parse(payload.event);
                if (snapshot.kind !== 'snapshot') throw new Error('状态接口未返回快照');
                if (!disposed) receive(snapshot);
            } catch (error: any) { pendingEvents = []; if (!disposed) showToast(`状态同步失败：${error.message}`, 'error'); }
            finally {
                recovering = false;
                const buffered = pendingEvents; pendingEvents = [];
                if (!disposed) for (const event of buffered) {
                    if (!retiredRuns.has(event.runId)) receive(event);
                }
            }
        };
        es.addEventListener('console_event', event => {
            try {
                const parsed = consoleEventSchema.safeParse(JSON.parse(event.data));
                if (!parsed.success) { void recover(); return; }
                receive(parsed.data);
            } catch (_) { void recover(); }
        });

        // 支持 DOM 性能基准测试与兼容事件
        es.addEventListener('init', (e: any) => {
            try {
                const data = JSON.parse(e.data);
                logBatchRef.current?.reset();
                runningRef.current = data.status === 'running';
                setState(prev => ({ ...prev, ...data }));
                if (data.status === 'idle') setActiveStep(0);
            } catch (_) {}
        });

        es.addEventListener('state_change', (e: any) => {
            try {
                const data = JSON.parse(e.data);
                if (Array.isArray(data.logs)) logBatchRef.current?.reset();
                else logBatchRef.current?.flush();
                runningRef.current = data.status === 'running';
                setState(prev => {
                    const next = { ...prev, ...data };
                    if (next.status !== 'running') setActiveStep(0);
                    return next;
                });
            } catch (_) {}
        });

        es.addEventListener('log', (e: any) => {
            try {
                const entry = JSON.parse(e.data) as LogEntry;
                logBatchRef.current?.append(entry);
            } catch (_) {}
        });

        es.addEventListener('logs_cleared', () => {
            logBatchRef.current?.reset();
            setState(previous => ({ ...previous, logs: [] }));
        });

        es.onerror = () => {
            // Auto reconnection handled by browser
        };
        return () => { disposed = true; pendingEvents = []; patchBatch.dispose(); recoveryController.abort(); };
    }, [showToast]);

    useEffect(() => {
        const disposeConnection = connect();
        return () => {
            disposeConnection();
            logBatchRef.current?.dispose();
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, [connect]);

    const setCopyUrls = useCallback((urls: string[]) => {
        setConfig(prev => ({ ...prev, copyUrls: urls }));
    }, []);

    const setRoiRatio = useCallback((ratio: string) => {
        setConfig(prev => ({ ...prev, roiRatio: ratio }));
    }, []);

    const setPaidTemplate = useCallback((template: '超超小额' | '超小额' | '小额' | '中额') => {
        setConfig(prev => ({ ...prev, paidTemplate: template }));
    }, []);

    const setTaskNamePrefix = useCallback((prefix: string) => {
        setConfig(prev => ({ ...prev, taskNamePrefix: prefix }));
    }, []);

    const setDailyBudget = useCallback((budget: string) => {
        setConfig(prev => ({ ...prev, dailyBudget: budget }));
    }, []);

    const clearLogs = useCallback(async () => {
        try {
            const response = await fetch('/api/logs/clear', { method: 'POST' });
            if (!response.ok) throw new Error('清空日志失败');
            logBatchRef.current?.reset();
            setState(prev => ({ ...prev, logs: [] }));
            showToast('已清空控制台日志', 'info');
        } catch (_) {
            showToast('清空日志请求失败', 'error');
        }
    }, [showToast]);

    return {
        state: { ...state, ...config },
        setState,
        activeStep,
        setActiveStep,
        setCopyUrls,
        setRoiRatio,
        setPaidTemplate,
        setTaskNamePrefix,
        setDailyBudget,
        clearLogs,
    };
}
