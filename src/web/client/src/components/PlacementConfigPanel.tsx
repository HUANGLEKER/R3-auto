import React, { useState } from 'react';
import {
    Plus,
    X,
    Clipboard,
    Trash2,
    SplitSquareVertical,
    FolderOpen,
    Save,
    Minus,
    HelpCircle,
    Link,
} from 'lucide-react';
import { readFromClipboard } from '../utils/clipboard.ts';
import { formatRoiRatio } from '../utils/formatters.ts';
import { useToast } from '../context/ToastContext.tsx';
import { copyUrlSchema, sanitizeDailyBudgetInput, normalizeDailyBudget } from '../../../../core/validation.ts';
import { Select, type SelectOption } from './Select.tsx';

type PaidTemplateType = '超超小额' | '超小额' | '小额' | '中额';

const PAID_TEMPLATE_OPTIONS: SelectOption<PaidTemplateType>[] = [
    { value: '超超小额', label: '超超小额' },
    { value: '超小额', label: '超小额' },
    { value: '小额', label: '小额' },
    { value: '中额', label: '中额' },
];

interface PlacementConfigPanelProps {
    copyUrls: string[];
    onUpdateCopyUrls: (urls: string[]) => void;
    roiRatio: string;
    onUpdateRoiRatio: (ratio: string) => void;
    paidTemplate?: '超超小额' | '超小额' | '小额' | '中额';
    onUpdatePaidTemplate?: (template: '超超小额' | '超小额' | '小额' | '中额') => void;
    taskNamePrefix?: string;
    onUpdateTaskNamePrefix?: (prefix: string) => void;
    dailyBudget?: string;
    onUpdateDailyBudget?: (budget: string) => void;
    onLoadConfig: () => Promise<void>;
    onSaveRoiRatio: (roi: string) => Promise<void>;
    onSavePaidTemplate?: (template: '超超小额' | '超小额' | '小额' | '中额') => Promise<void>;
    onSaveTaskNamePrefix?: (prefix: string) => Promise<void>;
    onSaveDailyBudget?: (budget: string) => Promise<void>;
    onSaveCopyUrls: (urls: string[]) => Promise<void>;
}

export const PlacementConfigPanel: React.FC<PlacementConfigPanelProps> = ({
    copyUrls,
    onUpdateCopyUrls,
    roiRatio,
    onUpdateRoiRatio,
    paidTemplate,
    onUpdatePaidTemplate,
    taskNamePrefix = '',
    onUpdateTaskNamePrefix,
    dailyBudget = '300',
    onUpdateDailyBudget,
    onLoadConfig,
    onSaveRoiRatio,
    onSavePaidTemplate,
    onSaveTaskNamePrefix,
    onSaveDailyBudget,
    onSaveCopyUrls,
}) => {
    const { showToast } = useToast();
    const [newUrl, setNewUrl] = useState<string>('');

    const handleAddUrl = () => {
        const val = newUrl.trim();
        if (copyUrlSchema.safeParse(val).success) {
            onUpdateCopyUrls([...copyUrls, val]);
            setNewUrl('');
            showToast('已添加搭剧复制任务链接', 'success');
        } else {
            showToast('请输入 usergrowth.com.cn 的 HTTPS 搭剧复制页链接', 'warning');
        }
    };

    const handleRemoveUrl = (index: number) => {
        const updated = copyUrls.filter((_, i) => i !== index);
        onUpdateCopyUrls(updated);
    };

    const handlePasteUrls = async () => {
        const text = await readFromClipboard();
        if (!text || !text.trim()) {
            showToast('剪贴板中没有文本内容', 'warning');
            return;
        }
        const lines = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
        const validUrls: string[] = [];
        for (const line of lines) {
            const match = line.match(/https?:\/\/[^\s"']+/i);
            if (match && copyUrlSchema.safeParse(match[0]).success) {
                validUrls.push(match[0]);
            }
        }

        if (validUrls.length === 0) {
            showToast('剪贴板中未识别到有效的 HTTPS 搭剧复制页链接', 'warning');
            return;
        }

        onUpdateCopyUrls([...copyUrls, ...validUrls]);
        const skipped = lines.length - validUrls.length;
        showToast(`已导入 ${validUrls.length} 条任务链接${skipped > 0 ? `，忽略 ${skipped} 条无效内容` : ''}`, 'success');
    };

    const handleClearUrls = () => {
        if (copyUrls.length === 0) return;
        onUpdateCopyUrls([]);
        showToast('已清空搭剧任务链接', 'info');
    };

    const handleDeduplicateUrls = () => {
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const u of copyUrls) {
            if (!seen.has(u)) {
                seen.add(u);
                deduped.push(u);
            }
        }
        const diff = copyUrls.length - deduped.length;
        onUpdateCopyUrls(deduped);
        showToast(`已完成去重，当前保留 ${deduped.length} 条链接${diff > 0 ? `（去除 ${diff} 条重复）` : ''}`, 'success');
    };

    const handleAdjustRoi = (delta: number) => {
        let val = parseFloat(roiRatio) || 1.0;
        val = Math.max(0.1, val + delta);
        onUpdateRoiRatio(val.toFixed(2));
    };

    return (
        <section className="bg-white rounded-xl border border-slate-200 flex flex-col shadow-sm backdrop-blur-sm transition-colors relative z-10">
            {/* Panel Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 rounded-t-xl">
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 text-xs font-bold flex items-center justify-center">
                        2
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                        投放配置
                    </span>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    {copyUrls.length} 条
                </span>
            </div>

            <div className="p-4 flex flex-col gap-4">
                {/* 1. Task Links Input & List */}
                <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        搭剧复制任务链接
                    </label>
                    <div className="flex gap-2 mb-2">
                        <div className="relative flex-1">
                            <input
                                id="input-new-url"
                                type="text"
                                value={newUrl}
                                onChange={e => setNewUrl(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
                                placeholder="https://usergrowth.com.cn/onestop/ad/ad_create/copy?..."
                                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 transition-colors"
                            />
                            <Link className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        </div>
                        <button
                            onClick={handleAddUrl}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow-sm transition-all cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            <span>添加链接</span>
                        </button>
                    </div>

                    {/* URL Items container */}
                    <div className="min-h-[70px] max-h-[100px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1.5 flex flex-col gap-1">
                        {copyUrls.length === 0 ? (
                            <div className="text-slate-400 text-[11px] text-center py-4 font-medium">
                                暂无链接，请在上方输入链接或点击“读取文件 / 粘贴导入”
                            </div>
                        ) : (
                            copyUrls.map((url, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between gap-2 px-2.5 py-1 rounded bg-white border border-slate-200 text-xs text-slate-700 shadow-2xs"
                                >
                                    <span className="truncate font-mono text-[11px]" title={url}>
                                        {idx + 1}. {url}
                                    </span>
                                    <button
                                        onClick={() => handleRemoveUrl(idx)}
                                        className="text-slate-400 hover:text-rose-500 transition-colors p-0.5 shrink-0 cursor-pointer"
                                        title="删除"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    {/* URL Actions Toolbar */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
                        <button
                            onClick={handlePasteUrls}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 transition-all cursor-pointer"
                        >
                            <Clipboard className="w-3 h-3 text-sky-500" />
                            <span>粘贴导入</span>
                        </button>
                        <button
                            onClick={handleClearUrls}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-rose-600 transition-all cursor-pointer"
                        >
                            <Trash2 className="w-3 h-3 text-rose-500" />
                            <span>清空</span>
                        </button>
                        <button
                            onClick={handleDeduplicateUrls}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-emerald-600 transition-all cursor-pointer"
                        >
                            <SplitSquareVertical className="w-3 h-3 text-emerald-500" />
                            <span>去重</span>
                        </button>
                        <button
                            onClick={onLoadConfig}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-indigo-600 transition-all cursor-pointer"
                        >
                            <FolderOpen className="w-3 h-3 text-indigo-500" />
                            <span>读取文件</span>
                        </button>
                        <button
                            onClick={() => onSaveCopyUrls(copyUrls)}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-cyan-600 transition-all cursor-pointer"
                        >
                            <Save className="w-3 h-3 text-cyan-500" />
                            <span>保存文件</span>
                        </button>
                    </div>
                </div>

                <div className="h-px bg-slate-200" />

                {/* 2. ROI Coefficient Stepper */}
                <div>
                    <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-slate-700">
                        <span>全局 ROI 系数</span>
                        <span title="搭剧子任务填单时自动填写的全局 ROI 系数">
                            <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-lg border border-slate-300 bg-slate-50 overflow-hidden">
                            <button
                                onClick={() => handleAdjustRoi(-0.01)}
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
                                title="减小 0.01"
                            >
                                <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                                id="input-roi-ratio"
                                type="text"
                                value={roiRatio}
                                onChange={e => onUpdateRoiRatio(e.target.value)}
                                onBlur={() => onUpdateRoiRatio(formatRoiRatio(roiRatio))}
                                className="w-16 py-1 text-center font-mono text-xs font-bold text-slate-900 bg-transparent focus:outline-none"
                            />
                            <button
                                onClick={() => handleAdjustRoi(0.01)}
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
                                title="增加 0.01"
                            >
                                <Plus className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        <button
                            onClick={() => onSaveRoiRatio(formatRoiRatio(roiRatio))}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 text-xs font-medium transition-all cursor-pointer"
                        >
                            <Save className="w-3.5 h-3.5 text-emerald-500" />
                            <span>保存</span>
                        </button>
                    </div>
                </div>

                <div className="h-px bg-slate-200" />

                {/* 3. Paid Template Selector */}
                <div>
                    <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-slate-700">
                        <span>充值模板</span>
                        <span title="搭剧子任务填单时选择的 IAP 充值模板大类">
                            <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Select<PaidTemplateType>
                            id="select-paid-template"
                            value={(paidTemplate || '超超小额') as PaidTemplateType}
                            onChange={val => onUpdatePaidTemplate?.(val)}
                            options={PAID_TEMPLATE_OPTIONS}
                            colorScheme="indigo"
                            triggerClassName="w-36"
                        />

                        {onSavePaidTemplate && (
                            <button
                                onClick={() => onSavePaidTemplate(paidTemplate || '超超小额')}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 text-xs font-medium transition-all cursor-pointer"
                            >
                                <Save className="w-3.5 h-3.5 text-emerald-500" />
                                <span>保存</span>
                            </button>
                        )}
                    </div>
                </div>

                <div className="h-px bg-slate-200" />

                {/* 4. Task Name Prefix (任务基本配置) & Daily Budget (项目统一配置) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Task Name Prefix */}
                    <div>
                        <div className="flex items-center justify-between gap-1.5 mb-2 text-xs font-medium text-slate-700">
                            <div className="flex items-center gap-1.5">
                                <span>任务名称前缀</span>
                                <span title="复制链接后进入“任务基本配置”填写任务名称，自动拼接 -自增序号（序号从 1 开始）">
                                    <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                                </span>
                            </div>
                            {taskNamePrefix.trim() && (
                                <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded truncate max-w-[140px]" title={`${taskNamePrefix.trim().replace(/-+$/, '')}-1`}>
                                    示例: {taskNamePrefix.trim().replace(/-+$/, '')}-1
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                id="input-task-name-prefix"
                                type="text"
                                value={taskNamePrefix}
                                onChange={e => onUpdateTaskNamePrefix?.(e.target.value)}
                                placeholder="如: R3-漫剧-次新 (自动加 -1, -2)"
                                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 transition-colors"
                            />
                            {onSaveTaskNamePrefix && (
                                <button
                                    type="button"
                                    onClick={() => onSaveTaskNamePrefix(taskNamePrefix)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 text-xs font-medium transition-all cursor-pointer shrink-0"
                                >
                                    <Save className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>保存</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Daily Budget */}
                    <div>
                        <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-slate-700">
                            <span>项目日预算</span>
                            <span title="搭剧完所有子任务剧后，进入“项目统一配置”填写项目日预算（最低 300，最高 9999999.99），点击确定后进入提交任务环节">
                                <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1 min-w-0">
                                <input
                                    id="input-daily-budget"
                                    type="text"
                                    inputMode="decimal"
                                    value={dailyBudget}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            onUpdateDailyBudget?.(normalizeDailyBudget(dailyBudget));
                                            (e.currentTarget as HTMLInputElement).blur();
                                            return;
                                        }
                                        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
                                            if (!/^[0-9.]$/.test(e.key) || (e.key === '.' && dailyBudget.includes('.'))) {
                                                e.preventDefault();
                                            }
                                        }
                                    }}
                                    onChange={e => onUpdateDailyBudget?.(sanitizeDailyBudgetInput(e.target.value))}
                                    onBlur={() => onUpdateDailyBudget?.(normalizeDailyBudget(dailyBudget))}
                                    placeholder="例如: 300.00"
                                    className="w-full pl-2.5 pr-8 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 font-mono text-xs placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 transition-colors"
                                />
                                <span className="absolute right-2.5 top-1.5 text-xs text-slate-400 select-none">
                                    元
                                </span>
                            </div>
                            {onSaveDailyBudget && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const normalized = normalizeDailyBudget(dailyBudget);
                                        onUpdateDailyBudget?.(normalized);
                                        void onSaveDailyBudget(normalized);
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 text-xs font-medium transition-all cursor-pointer shrink-0"
                                >
                                    <Save className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>保存</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
