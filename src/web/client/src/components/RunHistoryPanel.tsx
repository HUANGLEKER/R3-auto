import { useState, useRef } from 'react';
import {
    History,
    ChevronDown,
    ChevronUp,
    AlertCircle,
    CheckCircle2,
    Clock,
    ArrowLeft,
    ArrowRight,
    AlertTriangle,
    Eye,
} from 'lucide-react';

interface HistoricalRun {
    id: string;
    status: string;
    started: number;
}

interface HistoricalRecord {
    status: string;
    totalItems: number;
    items: Array<{ index: number; keyword: string; status: string; error?: string }>;
    operations: Array<{ operation_id: string; status: string }>;
}

export function RunHistoryPanel() {
    const [runs, setRuns] = useState<HistoricalRun[]>([]);
    const [record, setRecord] = useState<HistoricalRecord | null>(null);
    const [error, setError] = useState('');
    const [opened, setOpened] = useState(false);
    const [selected, setSelected] = useState('');
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const requestId = useRef(0);

    const load = async (id?: string, nextOffset = 0) => {
        const request = ++requestId.current;
        setLoading(true);
        try {
            const response = await fetch(id ? `/api/history/${encodeURIComponent(id)}?offset=${nextOffset}` : '/api/history');
            const data = await response.json();
            if (request !== requestId.current) return;
            if (!response.ok || !data.ok) throw new Error(data.message || '历史记录读取失败');
            if (id) {
                setRecord(data.record);
                setSelected(id);
                setOffset(nextOffset);
            } else {
                setRuns(data.runs || []);
                setOpened(true);
            }
            setError('');
        } catch (failure: any) {
            if (request === requestId.current) setError(failure.message);
        } finally {
            if (request === requestId.current) setLoading(false);
        }
    };

    const getRunStatusBadge = (status: string) => {
        if (status === 'needs_review') {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                    <AlertTriangle className="w-3 h-3 text-rose-500" />
                    <span>异常退出，结果待核对</span>
                </span>
            );
        }
        if (status === 'completed') {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    <span>已完成</span>
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>{status}</span>
            </span>
        );
    };

    return (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm backdrop-blur-sm overflow-hidden transition-colors">
            {/* Header toggle bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-semibold text-slate-900">
                        历史运行审计与核对
                    </span>
                    <span className="text-[10px] text-slate-500 hidden sm:inline">
                        (异常断电或服务中断后结果核查)
                    </span>
                </div>

                <button
                    type="button"
                    onClick={() => (opened ? setOpened(false) : void load())}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 text-xs font-medium transition-all shadow-xs cursor-pointer"
                >
                    <span>{opened ? '收起运行历史' : '查看运行历史与待核对结果'}</span>
                    {opened ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
            </div>

            {/* Error banner */}
            {error && (
                <div role="alert" className="m-3 p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                    <span>{error}</span>
                </div>
            )}

            {/* Body */}
            {opened && (
                <div className="p-4 flex flex-col gap-4 text-xs">
                    {/* Runs list */}
                    <div>
                        <div className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                            历史执行记录列表
                        </div>
                        {runs.length === 0 ? (
                            <p className="text-slate-400 py-3 text-center">
                                {loading ? '加载历史记录中...' : '暂无运行历史'}
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
                                {runs.map(run => {
                                    const isSelected = selected === run.id;
                                    return (
                                        <div
                                            key={run.id}
                                            onClick={() => void load(run.id)}
                                            className={`p-2.5 rounded-lg border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                                                isSelected
                                                    ? 'border-indigo-500 bg-indigo-50/50 shadow-xs'
                                                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-1">
                                                <span className="font-mono text-[11px] text-slate-700 font-medium truncate">
                                                    {new Date(run.started).toLocaleString()}
                                                </span>
                                                <button
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        void load(run.id);
                                                    }}
                                                    className="text-indigo-600 hover:underline flex items-center gap-0.5 text-[11px] shrink-0"
                                                >
                                                    <Eye className="w-3 h-3" />
                                                    <span>查看</span>
                                                </button>
                                            </div>
                                            <div>{getRunStatusBadge(run.status)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Selected Run Details */}
                    {record && (
                        <div className="mt-2 pt-4 border-t border-slate-200 flex flex-col gap-3">
                            <div className="p-2.5 rounded-lg bg-sky-50/80 border border-sky-200/80 text-[11px] text-sky-800">
                                💡 历史记录仅供核对，每次执行仍从当前输入开始。
                            </div>

                            {/* Pending operations */}
                            {record.operations
                                .filter(operation => ['uncertain', 'intent', 'submitting'].includes(operation.status))
                                .map(operation => (
                                    <div
                                        key={operation.operation_id}
                                        className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2"
                                    >
                                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                        <span>待核对操作：<strong className="font-mono">{operation.operation_id}</strong>（{operation.status}）</span>
                                    </div>
                                ))}

                            {/* Items table */}
                            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0">
                                        <tr>
                                            <th className="py-2 px-3 w-12 text-center">#</th>
                                            <th className="py-2 px-3">漫剧名称</th>
                                            <th className="py-2 px-3 w-28 text-center">状态</th>
                                            <th className="py-2 px-3">错误 / 详情</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {record.items.map(item => (
                                            <tr key={item.index} className="hover:bg-slate-50">
                                                <td className="py-2 px-3 text-center font-mono text-slate-400">{item.index}</td>
                                                <td className="py-2 px-3 font-semibold text-slate-800">{item.keyword}</td>
                                                <td className="py-2 px-3 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                                        item.status === 'success'
                                                            ? 'bg-emerald-50 text-emerald-700'
                                                            : item.status === 'failed'
                                                            ? 'bg-rose-50 text-rose-700'
                                                            : 'bg-slate-100 text-slate-700'
                                                    }`}>
                                                        {item.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-3 font-mono text-[11px] text-slate-500 truncate max-w-xs" title={item.error}>
                                                    {item.error || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            <div className="flex items-center justify-between gap-4 pt-1">
                                <span className="font-mono text-slate-500 text-[11px]">
                                    显示 {offset + 1}–{offset + record.items.length} / 共 {record.totalItems} 条
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={offset === 0}
                                        onClick={() => void load(selected, Math.max(0, offset - 200))}
                                        className="flex items-center gap-1 px-3 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed bg-white text-slate-700 transition-colors"
                                    >
                                        <ArrowLeft className="w-3 h-3" />
                                        <span>上一页</span>
                                    </button>
                                    <button
                                        disabled={offset + record.items.length >= record.totalItems}
                                        onClick={() => void load(selected, offset + 200)}
                                        className="flex items-center gap-1 px-3 py-1 rounded border border-slate-300 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed bg-white text-slate-700 transition-colors"
                                    >
                                        <span>下一页</span>
                                        <ArrowRight className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
