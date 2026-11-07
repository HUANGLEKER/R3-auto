import React, { useRef, useMemo } from 'react';
import { Clipboard, Trash2, SplitSquareVertical, FolderOpen, Save, Zap } from 'lucide-react';
import { readFromClipboard } from '../utils/clipboard.ts';
import { useToast } from '../context/ToastContext.tsx';
import { classifyDramaInputs } from '../utils/dramaInput.ts';

interface DramaEditorPanelProps {
    value: string;
    onChange: (val: string) => void;
    onLoadConfig: () => Promise<void>;
    onSaveConfig: (keywords: string[]) => Promise<void>;
}

export const DramaEditorPanel: React.FC<DramaEditorPanelProps> = ({
    value,
    onChange,
    onLoadConfig,
    onSaveConfig,
}) => {
    const { showToast } = useToast();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);

    // Calculate line numbers and effective count
    const lines = useMemo(() => value.split('\n'), [value]);
    const lineCount = Math.max(1, lines.length);
    const effectiveCount = useMemo(() => lines.map(s => s.trim()).filter(Boolean).length, [lines]);
    const classification = useMemo(() => classifyDramaInputs(lines), [lines]);

    const handleScroll = () => {
        if (textareaRef.current && lineNumbersRef.current) {
            lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
        }
    };

    const handlePaste = async () => {
        const text = await readFromClipboard();
        if (!text || !text.trim()) {
            showToast('剪贴板中没有文本内容', 'warning');
            return;
        }
        const trimmed = text.trim();
        const next = value.trim() ? `${value.trim()}\n${trimmed}` : trimmed;
        onChange(next);
        showToast('已从剪贴板粘贴导入剧名', 'success');
    };

    const handleClear = () => {
        if (!value.trim()) return;
        onChange('');
        showToast('已清空待处理剧名', 'info');
    };

    const handleDeduplicate = () => {
        const raw = lines.map(s => s.trim()).filter(Boolean);
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const item of raw) {
            if (!seen.has(item)) {
                seen.add(item);
                deduped.push(item);
            }
        }
        onChange(deduped.join('\n'));
        const diff = raw.length - deduped.length;
        showToast(`已完成去重，当前保留 ${deduped.length} 部有效剧名${diff > 0 ? `（去除 ${diff} 条重复）` : ''}`, 'success');
    };

    const handleSave = async () => {
        const keywords = lines.map(s => s.trim()).filter(Boolean);
        await onSaveConfig(keywords);
    };

    return (
        <section className="bg-white rounded-xl border border-slate-200 flex flex-col shadow-sm backdrop-blur-sm overflow-hidden transition-colors">
            {/* Panel Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 text-xs font-bold flex items-center justify-center">
                        1
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                        待处理漫剧列表
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    {classification.isPureId && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1 shadow-2xs">
                            <Zap className="w-3 h-3 text-sky-500" />
                            <span>纯 ID 模式</span>
                        </span>
                    )}
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        {effectiveCount} 部
                    </span>
                </div>
            </div>

            {/* Line Numbered Editor */}
            <div className="relative flex flex-1 min-h-[220px] max-h-[300px] bg-slate-50/50 border-b border-slate-200">
                {/* Line Numbers Gutter */}
                <div
                    ref={lineNumbersRef}
                    className="w-10 select-none py-3 text-right pr-2.5 font-mono text-[11px] text-slate-400 bg-slate-100 border-r border-slate-200 overflow-hidden leading-6"
                >
                    {Array.from({ length: lineCount }, (_, i) => (
                        <div key={i + 1}>{i + 1}</div>
                    ))}
                </div>

                {/* Textarea */}
                <textarea
                    id="input-keywords"
                    ref={textareaRef}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onScroll={handleScroll}
                    spellCheck={false}
                    placeholder={`逐行输入剧名、漫剧 ID 或抖音作品 ID。ID 将直连 OpenAPI。\n九品县令\n漫剧ID：7676052763846921240\n抖音作品ID：7676052763846921240`}
                    className="flex-1 p-3 font-mono text-xs leading-6 text-slate-900 bg-transparent resize-none focus:outline-none placeholder:text-slate-400 overflow-y-auto selection:bg-blue-600 selection:text-white"
                />
            </div>

            {/* Mode Banner when Pure ID detected */}
            {classification.isPureId && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-sky-50/80 border-b border-sky-100 text-[11px] text-sky-800 transition-colors">
                    <Zap className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                    <span>已识别 {classification.idCount} 条漫剧/抖音 ID，直连 OpenAPI，无需打开常读免费列表页</span>
                </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1.5 pl-10 pr-3 py-2.5 bg-slate-50 text-xs">
                <button
                    onClick={handlePaste}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 transition-all cursor-pointer"
                    title="从剪贴板粘贴"
                >
                    <Clipboard className="w-3.5 h-3.5 text-sky-500" />
                    <span>粘贴导入</span>
                </button>
                <button
                    onClick={handleClear}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-rose-600 transition-all cursor-pointer"
                    title="清空全部输入"
                >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>清空</span>
                </button>
                <button
                    onClick={handleDeduplicate}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-emerald-600 transition-all cursor-pointer"
                    title="清理空行并去重"
                >
                    <SplitSquareVertical className="w-3.5 h-3.5 text-emerald-500" />
                    <span>去重</span>
                </button>
                <button
                    onClick={onLoadConfig}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-indigo-600 transition-all cursor-pointer"
                    title="从 data/drama_list.txt 读取"
                >
                    <FolderOpen className="w-3.5 h-3.5 text-indigo-500" />
                    <span>读取文件</span>
                </button>
                <button
                    onClick={handleSave}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-teal-600 transition-all cursor-pointer"
                    title="保存至 data/drama_list.txt"
                >
                    <Save className="w-3.5 h-3.5 text-teal-500" />
                    <span>保存文件</span>
                </button>
            </div>
        </section>
    );
};
