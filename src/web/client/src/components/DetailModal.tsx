import React, { useEffect } from 'react';
import type { TaskItem } from '../types.ts';
import { TASK_STATUS_LABELS } from '../types.ts';
import { formatDuration } from '../utils/formatters.ts';
import { copyToClipboard } from '../utils/clipboard.ts';
import { useToast } from '../context/ToastContext.tsx';
import { X, Copy } from 'lucide-react';

interface DetailModalProps {
    item: TaskItem | null;
    onClose: () => void;
}

export const DetailModal: React.FC<DetailModalProps> = ({ item, onClose }) => {
    const { showToast } = useToast();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    if (!item) return null;

    const handleCopyAll = async () => {
        const json = JSON.stringify(item, null, 2);
        const ok = await copyToClipboard(json);
        if (ok) showToast('已复制该漫剧完整数据 (JSON)', 'success');
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-xs"
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col text-slate-800">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/80">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                        漫剧详情: {item.name || item.keyword}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200/60 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Modal Content */}
                <div className="p-5 flex flex-col gap-3 text-xs overflow-y-auto max-h-[70vh]">
                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">序号</span>
                        <span className="col-span-2 font-mono font-semibold">{item.index}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">待处理关键词</span>
                        <span className="col-span-2 font-medium">{item.keyword || '-'}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">匹配漫剧名</span>
                        <span className="col-span-2 font-bold text-emerald-600">{item.name || '-'}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">漫剧 ID</span>
                        <span className="col-span-2 font-mono text-sky-600 select-all">{item.seriesId || '-'}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">抖音作品 ID</span>
                        <span className="col-span-2 font-mono text-sky-600 select-all">{item.douyinId || '-'}</span>
                    </div>


                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">搭剧填单位置</span>
                        <span className="col-span-2 font-mono font-medium">
                            {item.tabIndex ? `Tab ${item.tabIndex} / 槽位 ${item.subtaskIndex}` : '-'}
                        </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">执行耗时</span>
                        <span className="col-span-2 font-mono">
                            {formatDuration(item.durationMs)}
                        </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-1 border-b border-slate-100">
                        <span className="text-slate-500">状态</span>
                        <span className="col-span-2 font-semibold text-emerald-600">
                            {TASK_STATUS_LABELS[item.status] || item.status}
                        </span>
                    </div>

                    {item.error && (
                        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex flex-col gap-1">
                            <span className="font-bold text-rose-800">错误详情:</span>
                            <span className="font-mono text-[11px] leading-relaxed break-all">
                                {item.error}
                            </span>
                        </div>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50/80">
                    <button
                        onClick={handleCopyAll}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 text-xs font-medium transition-all"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        <span>复制全部数据</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow transition-all"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};
