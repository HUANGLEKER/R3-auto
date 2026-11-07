import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { TaskItem, ItemStatus } from '../types.ts';
import { TASK_STATUS_LABELS } from '../types.ts';
import { formatDuration } from '../utils/formatters.ts';
import { useToast } from '../context/ToastContext.tsx';
import { Search, Download, Eye, Inbox } from 'lucide-react';
import { useVirtualRows, RESULT_ROW_HEIGHT } from '../hooks/useVirtualRows.ts';
import { Select, type SelectOption } from './Select.tsx';

interface ExecutionTableProps {
    items: TaskItem[];
    onViewDetail: (item: TaskItem) => void;
    failedFilterRequest?: number;
}

const STATUS_OPTIONS: Array<{ value: string; label: string; dot: string }> = [
    { value: 'all', label: '全部状态', dot: 'bg-slate-400' },
    { value: 'success', label: '已提交', dot: 'bg-emerald-500' },
    { value: 'filled', label: '已填写，待提交', dot: 'bg-teal-500' },
    { value: 'submitting', label: '提交中', dot: 'bg-blue-500 animate-spin' },
    { value: 'uncertain', label: '结果不确定', dot: 'bg-amber-500' },
    { value: 'running', label: '解析中', dot: 'bg-sky-500 animate-ping' },
    { value: 'pending', label: '等待中', dot: 'bg-slate-400' },
    { value: 'failed', label: '失败', dot: 'bg-rose-500' },
];

export const ExecutionTable: React.FC<ExecutionTableProps> = React.memo(({ items, onViewDetail, failedFilterRequest = 0 }) => {
    const { showToast } = useToast();
    const sectionRef = useRef<HTMLElement>(null);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { all: items.length };
        for (const item of items) {
            counts[item.status] = (counts[item.status] || 0) + 1;
        }
        return counts;
    }, [items]);

    const statusSelectOptions: SelectOption[] = useMemo(() => {
        return STATUS_OPTIONS.map(opt => ({
            value: opt.value,
            label: opt.label,
            dot: opt.dot,
            count: opt.value !== 'all' ? statusCounts[opt.value] : undefined,
        }));
    }, [statusCounts]);

    useEffect(() => {
        if (failedFilterRequest === 0) return;
        setSearchQuery('');
        setStatusFilter('failed');
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [failedFilterRequest]);

    const filteredItems = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        return items.filter(item => {
            if (statusFilter !== 'all' && item.status !== statusFilter) return false;
            if (query) {
                const kw = (item.keyword || '').toLowerCase();
                const name = (item.name || '').toLowerCase();
                const sId = (item.seriesId || '').toLowerCase();
                const dyId = (item.douyinId || '').toLowerCase();
                return kw.includes(query) || name.includes(query) || sId.includes(query) || dyId.includes(query);
            }
            return true;
        });
    }, [items, searchQuery, statusFilter]);
    const { containerRef, start, end, paddingTop, paddingBottom } = useVirtualRows(filteredItems.length, `${searchQuery}\0${statusFilter}`);
    const visibleItems = filteredItems.slice(start, end);

    const getStatusBadge = (status: ItemStatus) => {
        let badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
        let dot = 'bg-slate-400';

        if (status === 'running') {
            badgeClass = 'bg-sky-50 text-sky-700 border-sky-300';
            dot = 'bg-sky-500 animate-ping';
        } else if (status === 'submitting') {
            badgeClass = 'bg-blue-50 text-blue-700 border-blue-300';
            dot = 'bg-blue-500 animate-spin';
        } else if (status === 'success') {
            badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-300';
            dot = 'bg-emerald-500';
        } else if (status === 'failed') {
            badgeClass = 'bg-rose-50 text-rose-700 border-rose-300';
            dot = 'bg-rose-500';
        } else if (status === 'uncertain') {
            badgeClass = 'bg-amber-50 text-amber-700 border-amber-300';
            dot = 'bg-amber-500';
        }

        return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${badgeClass}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                <span>{TASK_STATUS_LABELS[status] || status}</span>
            </span>
        );
    };

    return (
        <section ref={sectionRef} className="bg-white rounded-xl border border-slate-200 shadow-sm backdrop-blur-sm overflow-hidden flex flex-col table-card transition-colors">
            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs font-bold flex items-center justify-center">
                        4
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                        最近执行记录
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                    {/* Search Input */}
                    <div className="relative">
                        <input
                            id="input-table-search"
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="搜索漫剧/ID..."
                            className="pl-8 pr-3 py-1 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 w-36 sm:w-44 transition-all"
                        />
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                    </div>

                    {/* Status Filter Dropdown */}
                    <Select
                        id="select-status-filter"
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={statusSelectOptions}
                        align="right"
                        colorScheme="emerald"
                        menuClassName="w-44"
                    />

                    {/* Export CSV */}
                    <button
                        onClick={() => window.location.href = '/api/export'}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 text-xs font-medium transition-all cursor-pointer"
                    >
                        <Download className="w-3.5 h-3.5 text-indigo-500" />
                        <span>导出 CSV</span>
                    </button>
                </div>
            </div>

            {/* Table Container */}
            <div ref={containerRef} id="results-table-scroll" className="overflow-auto min-h-[260px] max-h-[460px]">
                <table aria-rowcount={filteredItems.length + 1} className="w-full min-w-[950px] table-fixed text-left text-xs border-collapse whitespace-nowrap">
                    <colgroup>
                        {[48, 200, 150, 160, 130, 80, 100, 80].map((width, index) => <col key={index} style={{ width }} />)}
                    </colgroup>
                    <thead className="sticky top-0 bg-slate-50/95 text-slate-600 font-semibold border-b border-slate-200 backdrop-blur-md z-10">
                        <tr>
                            <th className="py-2.5 px-3 text-center w-12 font-mono">#</th>
                            <th className="py-2.5 px-3 min-w-[140px]">漫剧名称</th>
                            <th className="py-2.5 px-3 min-w-[110px]">漫剧 ID</th>
                            <th className="py-2.5 px-3 min-w-[130px]">抖音作品 ID</th>
                            <th className="py-2.5 px-3 min-w-[100px]">搭剧位置</th>
                            <th className="py-2.5 px-3 text-center min-w-[80px]">耗时</th>
                            <th className="py-2.5 px-3 text-center min-w-[100px]">状态</th>
                            <th className="py-2.5 px-3 text-center min-w-[80px]">操作</th>
                        </tr>
                    </thead>
                    <tbody id="results-table-body" className="divide-y divide-slate-200">
                        {filteredItems.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="py-12 text-center text-slate-500">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <Inbox className="w-8 h-8 text-slate-400 stroke-1" />
                                        <span>{items.length === 0 ? '尚未开始任务，请在上方输入剧名并点击“开始执行”' : '未找到匹配的条目'}</span>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            <>
                            {paddingTop > 0 && <tr aria-hidden="true"><td colSpan={8} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>}
                            {visibleItems.map((item, offset) => {
                                const slotText = item.tabIndex ? `Tab${item.tabIndex}-任务${item.subtaskIndex}` : '-';
                                return (
                                    <tr
                                        key={item.index}
                                        id={`row-item-${item.index}`}
                                        aria-rowindex={start + offset + 2}
                                        style={{ height: RESULT_ROW_HEIGHT }}
                                        className="hover:bg-slate-50/80 transition-colors"
                                    >
                                        <td className="py-2 px-3 text-center font-mono text-slate-500">
                                             {item.index}
                                        </td>
                                        <td className="py-2 px-3 font-semibold text-slate-900">
                                            <span className="block truncate" title={item.name || item.keyword}>{item.name || item.keyword}</span>
                                        </td>
                                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                                            {item.seriesId || '-'}
                                        </td>
                                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                                            {item.douyinId || '-'}
                                        </td>
                                        <td className="py-2 px-3 font-mono text-[11px] text-slate-700">
                                            {slotText}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-500">
                                            {formatDuration(item.durationMs)}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            {getStatusBadge(item.status)}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <button
                                                    onClick={() => onViewDetail(item)}
                                                    className="p-1 rounded text-slate-500 hover:text-sky-600 hover:bg-slate-100 transition-colors cursor-pointer"
                                                    title="查看详情"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={8} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
});
