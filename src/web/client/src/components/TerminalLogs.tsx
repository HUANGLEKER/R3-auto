import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { LogEntry } from '../types.ts';
import { Terminal, Search, Trash2, Copy, Download, AlertTriangle, FileText } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard.ts';
import { useToast } from '../context/ToastContext.tsx';

interface TerminalLogsProps {
    logs: LogEntry[];
    onClearLogs: () => Promise<void>;
}

const FILTER_LEVELS = [
    { id: 'all', label: '全部' },
    { id: 'err', label: '错误' },
    { id: 'warn', label: '警告' },
    { id: 'task', label: '任务' },
    { id: 'ok', label: '成功' },
    { id: 'step', label: '步骤' },
];

export const TerminalLogs: React.FC<TerminalLogsProps> = ({ logs, onClearLogs }) => {
    const { showToast } = useToast();
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [filterLevel, setFilterLevel] = useState<string>('all');
    const [autoScroll, setAutoScroll] = useState<boolean>(true);
    const containerRef = useRef<HTMLDivElement>(null);

    const { errorCount, warnCount } = useMemo(() => {
        let errs = 0;
        let warns = 0;
        for (const l of logs) {
            const tag = (l.tag || '').toUpperCase();
            if (l.level === 'error' || tag.includes('ERR') || tag.includes('FAIL') || tag === 'STOP') {
                errs++;
            } else if (l.level === 'warn' || tag.includes('WARN')) {
                warns++;
            }
        }
        return { errorCount: errs, warnCount: warns };
    }, [logs]);

    const filteredLogs = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        return logs.filter(entry => {
            if (query && !entry.text.toLowerCase().includes(query)) return false;
            if (filterLevel === 'all') return true;

            const tag = (entry.tag || '').toUpperCase();
            const level = entry.level;

            if (filterLevel === 'err') {
                return level === 'error' || tag.includes('ERR') || tag.includes('FAIL') || tag === 'STOP';
            }
            if (filterLevel === 'warn') {
                return level === 'warn' || tag.includes('WARN');
            }
            if (filterLevel === 'ok') {
                return tag.includes('OK') || tag.includes('SUCCESS');
            }
            if (filterLevel === 'task') {
                return tag.includes('TASK');
            }
            if (filterLevel === 'step') {
                return tag.includes('STEP');
            }
            return true;
        });
    }, [logs, searchQuery, filterLevel]);

    useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [filteredLogs, autoScroll]);

    const handleCopyLogs = async () => {
        const text = logs.map(l => `[${l.time}] [${l.tag.padEnd(7)}] ${l.text}`).join('\n');
        const ok = await copyToClipboard(text);
        if (ok) showToast('全部控制台日志已复制到剪贴板', 'info');
    };

    const handleCopyErrors = async () => {
        const errorList = logs.filter(l => {
            const tag = (l.tag || '').toUpperCase();
            return l.level === 'error' || l.level === 'warn' || tag.includes('ERR') || tag.includes('WARN') || tag === 'STOP';
        });

        if (errorList.length === 0) {
            showToast('当前暂无异常或警告日志', 'info');
            return;
        }

        const header = `=== R3 自动化异常日志诊断报告 (${new Date().toLocaleString()}) ===\n共 ${errorList.length} 条异常记录：\n`;
        const body = errorList.map(l => `[${l.time}] [${l.tag.padEnd(7)}] ${l.text}`).join('\n');
        const ok = await copyToClipboard(header + body);
        if (ok) showToast(`已复制 ${errorList.length} 条异常诊断日志到剪贴板`, 'success');
    };

    const handleDownloadLogs = () => {
        window.open('/api/logs/download', '_blank');
        showToast('正在导出完整运行日志文件...', 'info');
    };

    const getTagClass = (tag: string, level?: string) => {
        const upper = tag.toUpperCase().trim();
        if (level === 'error' || upper.includes('ERR') || upper.includes('FAIL') || upper === 'STOP') {
            return 'text-rose-700 bg-rose-50 border-rose-200 font-bold';
        }
        if (level === 'warn' || upper.includes('WARN')) {
            return 'text-amber-700 bg-amber-50 border-amber-200 font-semibold';
        }
        if (upper.includes('OK') || upper.includes('SUCCESS')) {
            return 'text-emerald-700 bg-emerald-50 border-emerald-200';
        }
        if (upper.includes('STEP')) {
            return 'text-sky-700 bg-sky-50 border-sky-200';
        }
        if (upper.includes('TASK')) {
            return 'text-violet-700 bg-violet-50 border-violet-200 font-semibold';
        }
        return 'text-slate-600 bg-slate-100 border-slate-200';
    };

    return (
        <section className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col font-mono">
            {/* Terminal Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 mb-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-semibold text-slate-800">
                        实时控制台日志 (Console Terminal)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        {logs.length} 行
                    </span>
                    {errorCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setFilterLevel('err')}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-300 font-bold flex items-center gap-1 cursor-pointer hover:bg-rose-200 transition-colors"
                            title="点击快速筛选错误日志"
                        >
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            {errorCount} 错误
                        </button>
                    )}
                    {warnCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setFilterLevel('warn')}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 font-semibold flex items-center gap-1 cursor-pointer hover:bg-amber-200 transition-colors"
                            title="点击快速筛选警告日志"
                        >
                            {warnCount} 警告
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                    {/* Log Search */}
                    <div className="relative">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="搜索日志..."
                            className="pl-7 pr-2.5 py-1 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 w-28 sm:w-36"
                        />
                        <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2" />
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center rounded bg-slate-100 border border-slate-200 p-0.5 text-[10px]">
                        {FILTER_LEVELS.map(lvl => (
                            <button
                                key={lvl.id}
                                onClick={() => setFilterLevel(lvl.id)}
                                className={`px-2 py-0.5 rounded uppercase font-semibold transition-all cursor-pointer ${
                                    filterLevel === lvl.id
                                        ? 'bg-white text-emerald-600 shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                {lvl.label}
                            </button>
                        ))}
                    </div>

                    {/* Auto scroll */}
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={e => setAutoScroll(e.target.checked)}
                            className="rounded bg-slate-100 border-slate-300 text-emerald-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span>自动滚动</span>
                    </label>

                    {/* Action Tools */}
                    <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                        <button
                            type="button"
                            onClick={handleCopyErrors}
                            className="p-1 rounded text-slate-500 hover:text-amber-600 hover:bg-slate-100 transition-colors cursor-pointer"
                            title="一键复制异常排查日志"
                        >
                            <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={handleDownloadLogs}
                            className="p-1 rounded text-slate-500 hover:text-emerald-600 hover:bg-slate-100 transition-colors cursor-pointer"
                            title="导出并下载完整日志文件 (.log)"
                        >
                            <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={handleCopyLogs}
                            className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                            title="复制全部控制台日志"
                        >
                            <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={onClearLogs}
                            className="p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-slate-100 transition-colors cursor-pointer"
                            title="清空当前日志显示"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Terminal Screen Container */}
            <div
                ref={containerRef}
                className="h-64 overflow-y-auto p-2.5 rounded-lg bg-slate-50/70 border border-slate-100 flex flex-col gap-1 text-[11px] leading-relaxed selection:bg-emerald-600 selection:text-white"
            >
                {filteredLogs.length === 0 ? (
                    <div className="text-slate-400 text-center py-10 font-sans">
                        暂无匹配日志输出
                    </div>
                ) : (
                    filteredLogs.map((entry, idx) => {
                        const upperTag = (entry.tag || '').toUpperCase();
                        const isErr = entry.level === 'error' || upperTag.includes('ERR') || upperTag.includes('FAIL') || upperTag === 'STOP';
                        const isWarn = !isErr && (entry.level === 'warn' || upperTag.includes('WARN'));

                        return (
                            <div
                                key={idx}
                                className={`flex items-start gap-2 px-1.5 py-0.5 rounded transition-colors ${
                                    isErr
                                        ? 'bg-rose-50/80 border-l-2 border-rose-500 hover:bg-rose-100/70'
                                        : isWarn
                                        ? 'bg-amber-50/70 border-l-2 border-amber-500 hover:bg-amber-100/60'
                                        : 'hover:bg-slate-200/50'
                                }`}
                            >
                                <span className="text-slate-400 shrink-0 select-none">
                                    {entry.time}
                                </span>
                                <span className={`px-1.5 py-0.2 rounded border text-[10px] shrink-0 select-none ${getTagClass(entry.tag, entry.level)}`}>
                                    [{entry.tag}]
                                </span>
                                <span className={`break-all whitespace-pre-wrap ${
                                    isErr
                                        ? 'text-rose-900 font-medium'
                                        : isWarn
                                        ? 'text-amber-900 font-medium'
                                        : 'text-slate-700'
                                }`}>
                                    {entry.text}
                                </span>
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
};
