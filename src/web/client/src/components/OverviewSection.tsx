import React, { useState, useEffect, useRef } from 'react';
import type { ConsoleState } from '../types.ts';
import { formatElapsed, getCurrentTimeString } from '../utils/formatters.ts';
import {
    Play,
    Square,
    RotateCcw,
    PlayCircle,
    ChevronDown,
    ExternalLink,
    RefreshCw,
    Download,
    Trash2,
    CheckCircle,
    Activity,
    XCircle,
    Percent,
    Clock,
    Layers,
} from 'lucide-react';

interface OverviewSectionProps {
    state: ConsoleState;
    totalInputs: number;
    serviceFaulted?: boolean;
    onStart: () => void;
    onStop: () => void;
    onRetryFailed: () => void;
    onLaunchBrowser: () => void;
    onOpenPages: () => void;
    onRefreshEnv: () => void;
    onClearLogs: () => void;
}

export const OverviewSection: React.FC<OverviewSectionProps> = ({
    state,
    totalInputs,
    serviceFaulted = false,
    onStart,
    onStop,
    onRetryFailed,
    onLaunchBrowser,
    onOpenPages,
    onRefreshEnv,
    onClearLogs,
}) => {
    const [currentTime, setCurrentTime] = useState<string>(getCurrentTimeString());
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const [elapsedTime, setElapsedTime] = useState<string>('00m 00s');
    const menuRef = useRef<HTMLDivElement>(null);

    // Live Clock & Elapsed Timer
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(getCurrentTimeString());
            setElapsedTime(formatElapsed(state.startedAt, state.finishedAt));
        }, 1000);
        return () => clearInterval(timer);
    }, [state.startedAt, state.finishedAt]);

    // Close menu when clicking outside or pressing Escape
    useEffect(() => {
        if (!menuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuOpen]);

    const isRunning = state.status === 'running';
    const startDisabled = isRunning || serviceFaulted;

    // Metrics calculations
    const total = state.progress.total || state.items.length || totalInputs || 0;
    const success = state.progress.successCount || 0;
    const failed = state.progress.failedCount || 0;
    const running = state.items.filter(i => i.status === 'running' || i.status === 'submitting').length;
    const failedItemsCount = state.items.filter(i => i.status === 'failed').length;
    const processed = success + failed;
    const rate = processed > 0 ? Math.round((success / processed) * 100) : 0;
    const percentage = state.progress.percentage || 0;

    // Avg & ETA calculation
    let avgStr = '-';
    let etaStr = '-';
    if (state.startedAt && processed > 0) {
        const now = state.finishedAt || Date.now();
        const elapsedSec = Math.max(1, Math.floor((now - state.startedAt) / 1000));
        const avgSec = elapsedSec / processed;
        const avgM = Math.floor(avgSec / 60);
        const avgS = Math.floor(avgSec % 60);
        avgStr = avgM > 0 ? `${avgM}m ${avgS}s` : `${avgSec.toFixed(1)}s`;

        const remaining = Math.max(0, total - processed);
        if (isRunning && remaining > 0) {
            const etaSec = Math.round(remaining * avgSec);
            const etaM = Math.floor(etaSec / 60);
            const etaS = etaSec % 60;
            etaStr = `${etaM}m ${String(etaS).padStart(2, '0')}s`;
        } else if (state.status === 'completed') {
            etaStr = '已完成';
        }
    }

    return (
        <section className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm backdrop-blur-sm transition-colors flex flex-col gap-4">
            {/* Top Control Bar: Start / Stop / Retry + Progress + Aux Actions */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                {/* Left: Execution Controls */}
                <div className="flex flex-wrap items-center gap-2.5">
                    {/* Start Button */}
                    <button
                        id="btn-start"
                        onClick={onStart}
                        disabled={startDisabled}
                        className={`flex items-center gap-2 px-4 sm:px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
                            startDisabled
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200 shadow-none'
                                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/20'
                        }`}
                    >
                        <Play className="w-4 h-4 fill-current" />
                        <span>开始执行</span>
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-black/25 text-emerald-200">
                            Ctrl+Enter
                        </span>
                    </button>

                    {/* Stop Button */}
                    <button
                        id="btn-stop"
                        onClick={onStop}
                        disabled={!isRunning}
                        className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer ${
                            !isRunning
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200 shadow-none'
                                : 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-md shadow-rose-600/20'
                        }`}
                    >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>终止执行</span>
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-black/25 text-rose-200">
                            Esc
                        </span>
                    </button>

                    {/* Retry Failed */}
                    {failedItemsCount > 0 && !isRunning && (
                        <button
                            id="btn-retry-failed"
                            disabled={serviceFaulted}
                            onClick={onRetryFailed}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md shadow-amber-600/20 transition-all active:scale-95 animate-subtle-pulse cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>重试失败 (<span id="retry-failed-count">{failedItemsCount}</span>)</span>
                        </button>
                    )}
                </div>

                {/* Center: Live Progress Bar */}
                <div className="flex-1 max-w-full lg:max-w-xs xl:max-w-md flex flex-col justify-center">
                    <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                        <span className="font-medium text-[11px]">整体完成进度</span>
                        <span id="overview-progress-text" className="font-mono font-bold text-sky-600">
                            {percentage}%
                        </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                        <div
                            id="overview-progress-fill"
                            className="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                        />
                    </div>
                </div>

                {/* Right: Action tools & Last Update */}
                <div className="flex items-center gap-2 self-start lg:self-center">
                    <span id="last-update-time" className="hidden sm:inline-block text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                        最后更新: {currentTime}
                    </span>

                    <button
                        id="btn-launch-cdp"
                        onClick={onLaunchBrowser}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-semibold shadow-xs active:scale-95 transition-all cursor-pointer"
                        title="启动独立 Edge 调试窗口 (CDP 9224)"
                    >
                        <PlayCircle className="w-3.5 h-3.5 text-sky-500" />
                        <span className="hidden md:inline">启动 Edge 调试</span>
                        <span className="md:hidden">Edge</span>
                    </button>

                    {/* More actions dropdown */}
                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            onClick={() => setMenuOpen(!menuOpen)}
                            aria-haspopup="true"
                            aria-expanded={menuOpen}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-medium transition-all cursor-pointer shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 select-none"
                        >
                            <span>更多</span>
                            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${menuOpen ? 'rotate-180 text-indigo-500' : ''}`} />
                        </button>

                        {menuOpen && (
                            <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl z-50 py-1 text-xs text-slate-700 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
                                <button
                                    onClick={() => { setMenuOpen(false); onOpenPages(); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors text-left cursor-pointer"
                                >
                                    <ExternalLink className="w-3.5 h-3.5 text-sky-500" />
                                    <span>打开缺失页面并验证</span>
                                </button>
                                <button
                                    onClick={() => { setMenuOpen(false); onRefreshEnv(); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors text-left cursor-pointer"
                                >
                                    <RefreshCw className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>刷新系统环境检测</span>
                                </button>
                                <div className="h-px bg-slate-200 my-1" />
                                <button
                                    onClick={() => { setMenuOpen(false); window.location.href = '/api/export'; }}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors text-left cursor-pointer"
                                >
                                    <Download className="w-3.5 h-3.5 text-indigo-500" />
                                    <span>导出执行结果 (CSV)</span>
                                </button>
                                <button
                                    onClick={() => { setMenuOpen(false); onClearLogs(); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors text-left text-rose-500 cursor-pointer"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>清空控制台日志</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Row: 6 High-Density KPI & Timing Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {/* 1. Total */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-500 mb-1">
                        <span className="text-[11px] font-medium">总任务</span>
                        <Layers className="w-3.5 h-3.5 opacity-60" />
                    </div>
                    <div id="kpi-total-val" className="text-xl font-bold font-mono tracking-tight text-slate-900">
                        {total}
                    </div>
                    <span id="chip-val-total" className="hidden">{total}</span>
                </div>

                {/* 2. Success */}
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-emerald-700 mb-1">
                        <span className="text-[11px] font-medium">成功</span>
                        <CheckCircle className="w-3.5 h-3.5 opacity-80" />
                    </div>
                    <div id="kpi-success-val" className="text-xl font-bold font-mono tracking-tight text-emerald-600">
                        {success}
                    </div>
                    <span id="chip-val-success" className="hidden">{success}</span>
                </div>

                {/* 3. Running */}
                <div className="bg-sky-50/70 border border-sky-200 rounded-lg p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-sky-700 mb-1">
                        <span className="text-[11px] font-medium">运行中</span>
                        <Activity className={`w-3.5 h-3.5 opacity-80 ${running > 0 ? 'animate-spin' : ''}`} />
                    </div>
                    <div id="kpi-running-val" className="text-xl font-bold font-mono tracking-tight text-sky-600">
                        {running}
                    </div>
                    <span id="chip-val-running" className="hidden">{running}</span>
                </div>

                {/* 4. Failed */}
                <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-rose-700 mb-1">
                        <span className="text-[11px] font-medium">失败</span>
                        <XCircle className="w-3.5 h-3.5 opacity-80" />
                    </div>
                    <div id="kpi-failed-val" className="text-xl font-bold font-mono tracking-tight text-rose-600">
                        {failed}
                    </div>
                    <span id="chip-val-failed" className="hidden">{failed}</span>
                </div>

                {/* 5. Rate */}
                <div className="bg-teal-50/70 border border-teal-200 rounded-lg p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-teal-700 mb-1">
                        <span className="text-[11px] font-medium">成功率</span>
                        <Percent className="w-3.5 h-3.5 opacity-80" />
                    </div>
                    <div id="kpi-rate-val" className="text-xl font-bold font-mono tracking-tight text-teal-600">
                        {rate}%
                    </div>
                </div>

                {/* 6. Duration & ETA */}
                <div className="bg-indigo-50/70 border border-indigo-200 rounded-lg p-2.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-indigo-700 mb-1">
                        <span className="text-[11px] font-medium">耗时与预估</span>
                        <Clock className="w-3.5 h-3.5 opacity-80" />
                    </div>
                    <div id="kpi-duration-val" className="text-base font-bold font-mono tracking-tight text-indigo-700">
                        {elapsedTime}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 truncate">
                        <span>均:<span id="chip-val-avg" className="font-bold text-amber-600 ml-0.5">{avgStr}</span></span>
                        <span>剩:<span id="chip-val-eta" className="font-bold text-amber-600 ml-0.5">{etaStr}</span></span>
                        <span id="chip-val-duration" className="hidden">{elapsedTime}</span>
                    </div>
                </div>
            </div>
        </section>
    );
};
