import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { TaskItem } from './types.ts';
import { useSSE } from './hooks/useSSE.ts';
import { useEnvironment } from './hooks/useEnvironment.ts';
import { useToast } from './context/ToastContext.tsx';
import { Header } from './components/Header.tsx';
import { OverviewSection } from './components/OverviewSection.tsx';
import { DramaEditorPanel } from './components/DramaEditorPanel.tsx';
import { PlacementConfigPanel } from './components/PlacementConfigPanel.tsx';
import { PipelineStepper } from './components/PipelineStepper.tsx';
import { ExecutionTable } from './components/ExecutionTable.tsx';
import { RunHistoryPanel } from './components/RunHistoryPanel.tsx';
import { TerminalLogs } from './components/TerminalLogs.tsx';
import { EnvironmentStatus } from './components/EnvironmentStatus.tsx';
import { DetailModal } from './components/DetailModal.tsx';
import { ToastContainer } from './components/ToastContainer.tsx';
import {
    SlidersHorizontal,
    ChevronDown,
    ChevronUp,
    Layers,
    Table,
    Terminal,
    History,
} from 'lucide-react';
import { classifyDramaInputs } from './utils/dramaInput.ts';
import { normalizeDailyBudget } from '../../../core/validation.ts';

type MonitorTab = 'combined' | 'table' | 'logs' | 'history';

export const App: React.FC = () => {
    const { showToast } = useToast();
    const [keywordsText, setKeywordsText] = useState<string>('');

    const {
        state,
        activeStep,
        setCopyUrls,
        setRoiRatio,
        setPaidTemplate,
        setTaskNamePrefix,
        setDailyBudget,
        clearLogs,
    } = useSSE();

    const {
        envInfo,
        loading: envLoading,
        checkEnvironment,
        launchBrowser,
        openPages,
    } = useEnvironment(keywordsText);

    const [configCollapsed, setConfigCollapsed] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<MonitorTab>('combined');
    const [selectedModalItem, setSelectedModalItem] = useState<TaskItem | null>(null);

    // Load initial config from server
    const loadConfig = useCallback(async () => {
        try {
            const res = await fetch('/api/config');
            const data = await res.json();
            if (data.ok) {
                if (Array.isArray(data.keywords)) {
                    setKeywordsText(data.keywords.join('\n'));
                }
                if (Array.isArray(data.copyUrls)) {
                    setCopyUrls(data.copyUrls);
                }
                if (data.roiRatio) {
                    setRoiRatio(String(data.roiRatio));
                }
                if (data.paidTemplate) {
                    setPaidTemplate(data.paidTemplate);
                }
                if (data.taskNamePrefix !== undefined) {
                    setTaskNamePrefix(String(data.taskNamePrefix));
                }
                if (data.dailyBudget !== undefined) {
                    setDailyBudget(normalizeDailyBudget(data.dailyBudget));
                }
                showToast('已从 data/ 目录载入配置', 'info');
            }
        } catch (_) {
            showToast('读取配置文件失败', 'error');
        }
    }, [setCopyUrls, setRoiRatio, setPaidTemplate, setTaskNamePrefix, setDailyBudget, showToast]);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    // Save keywords to data/drama_list.txt
    const handleSaveKeywords = useCallback(async (keywords: string[]) => {
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keywords }),
            });
            const data = await res.json();
            if (data.ok) {
                showToast('剧名已成功保存到 data/drama_list.txt', 'success');
            } else {
                showToast(data.message || '保存失败', 'error');
            }
        } catch (_) {
            showToast('保存文件失败', 'error');
        }
    }, [showToast]);

    // Save copy URLs to data/文件链接.xlsx
    const handleSaveCopyUrls = useCallback(async (copyUrls: string[]) => {
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ copyUrls }),
            });
            const data = await res.json();
            if (data.ok) {
                showToast(`已成功保存 ${copyUrls.length} 条链接至 data/文件链接.xlsx`, 'success');
            } else {
                showToast(data.message || '保存失败', 'error');
            }
        } catch (_) {
            showToast('保存文件链接失败', 'error');
        }
    }, [showToast]);

    // Save ROI ratio
    const handleSaveRoiRatio = useCallback(async (roiRatio: string) => {
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roiRatio }),
            });
            const data = await res.json();
            if (data.ok) {
                setRoiRatio(roiRatio);
                showToast(`投放配置已保存 (ROI: ${roiRatio})`, 'success');
            } else {
                showToast(data.message || '保存失败', 'error');
            }
        } catch (_) {
            showToast('保存投放配置失败', 'error');
        }
    }, [setRoiRatio, showToast]);

    // Save Paid Template
    const handleSavePaidTemplate = useCallback(async (paidTemplate: '超超小额' | '超小额' | '小额' | '中额') => {
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paidTemplate }),
            });
            const data = await res.json();
            if (data.ok) {
                setPaidTemplate(paidTemplate);
                showToast(`充值模板已保存 (${paidTemplate})`, 'success');
            } else {
                showToast(data.message || '保存失败', 'error');
            }
        } catch (_) {
            showToast('保存充值模板失败', 'error');
        }
    }, [setPaidTemplate, showToast]);

    // Save Task Name Prefix
    const handleSaveTaskNamePrefix = useCallback(async (taskNamePrefix: string) => {
        const trimmed = taskNamePrefix.trim();
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskNamePrefix: trimmed }),
            });
            const data = await res.json();
            if (data.ok) {
                setTaskNamePrefix(trimmed);
                showToast(trimmed ? `任务名称前缀已保存 (${trimmed}-1, -2...)` : '已清空任务名称前缀', 'success');
            } else {
                showToast(data.message || '保存失败', 'error');
            }
        } catch (_) {
            showToast('保存任务名称前缀失败', 'error');
        }
    }, [setTaskNamePrefix, showToast]);

    // Save Daily Budget
    const handleSaveDailyBudget = useCallback(async (dailyBudget: string) => {
        const normalized = normalizeDailyBudget(dailyBudget);
        setDailyBudget(normalized);
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dailyBudget: normalized }),
            });
            const data = await res.json();
            if (data.ok) {
                showToast(`项目日预算已保存 (${normalized} 元)`, 'success');
            } else {
                showToast(data.message || '保存失败', 'error');
            }
        } catch (_) {
            showToast('保存项目日预算失败', 'error');
        }
    }, [setDailyBudget, showToast]);

    // Start automation execution
    const handleStartAutomation = useCallback(async (customKeywords?: string[]) => {
        if (state.health?.status === 'faulted') {
            showToast('后台服务故障，请重启并核对历史结果', 'error');
            return;
        }
        const keywords = customKeywords || keywordsText.split('\n').map(s => s.trim()).filter(Boolean);
        if (keywords.length === 0) {
            showToast('请先输入至少一部漫剧名称', 'warning');
            return;
        }

        if (state.copyUrls.length === 0) {
            showToast('请先配置至少一条搭剧复制链接', 'warning');
            return;
        }

        const normalizedBudget = normalizeDailyBudget(state.dailyBudget ?? '300');
        setDailyBudget(normalizedBudget);

        try {
            const res = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keywords,
                    copyPageUrls: state.copyUrls,
                    roiRatio: state.roiRatio || '1',
                    paidTemplate: state.paidTemplate || '超超小额',
                    taskNamePrefix: state.taskNamePrefix ?? '',
                    dailyBudget: normalizedBudget,
                }),
            });
            const data = await res.json();
            if (data.ok) {
                showToast(data.message || '任务已成功启动', 'success');
            } else {
                showToast(data.message || '启动失败', 'error');
            }
        } catch (e: any) {
            showToast(`网络请求异常: ${e.message}`, 'error');
        }
    }, [keywordsText, state.copyUrls, state.roiRatio, state.paidTemplate, state.taskNamePrefix, state.dailyBudget, state.health, showToast]);

    // Stop automation execution
    const handleStopAutomation = useCallback(async () => {
        try {
            const res = await fetch('/api/stop', { method: 'POST' });
            const data = await res.json();
            showToast(data.message || '任务终止信号已发送', 'info');
        } catch (_) {
            showToast('终止任务失败', 'error');
        }
    }, [showToast]);

    // Retry failed items
    const handleRetryFailed = useCallback(() => {
        const failedItems = state.items.filter(i => i.status === 'failed');
        if (failedItems.length === 0) {
            showToast('当前没有失败的项目', 'info');
            return;
        }
        const failedKeywords = failedItems.map(i => i.keyword);
        setKeywordsText(failedKeywords.join('\n'));
        handleStartAutomation(failedKeywords);
    }, [handleStartAutomation, showToast, state.items]);

    // Global keyboard shortcuts (Ctrl+Enter, Esc)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                if (state.status !== 'running') {
                    e.preventDefault();
                    handleStartAutomation();
                }
            } else if (e.key === 'Escape') {
                if (!selectedModalItem && state.status === 'running') {
                    e.preventDefault();
                    handleStopAutomation();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleStartAutomation, handleStopAutomation, selectedModalItem, state.status]);

    const inputClassification = useMemo(() => {
        return classifyDramaInputs(keywordsText.split('\n'));
    }, [keywordsText]);

    const totalInputs = inputClassification.total;

    // Error log count for badge
    const errorLogCount = useMemo(() => {
        return state.logs.filter(l => {
            const tag = (l.tag || '').toUpperCase();
            return l.level === 'error' || tag.includes('ERR') || tag.includes('FAIL') || tag === 'STOP';
        }).length;
    }, [state.logs]);

    return (
        <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 transition-colors">
            <ToastContainer />

            {/* Top Navigation Bar */}
            <Header status={state.status} />

            {/* Main Content Area */}
            <main className="flex-1 w-full max-w-[1720px] mx-auto p-4 sm:p-5 flex flex-col gap-4 sm:gap-5 min-w-0">
                {/* Fault alert */}
                {state.health?.status === 'faulted' && (
                    <p role="alert" className="rounded-xl border border-rose-400 bg-rose-50 p-4 text-sm text-rose-700">
                        后台服务故障：{state.health.reason}。请核对运行历史与平台结果后重启程序。
                    </p>
                )}

                {/* System Environment Status */}
                <EnvironmentStatus
                    envInfo={envInfo}
                    loading={envLoading}
                    onRefresh={() => checkEnvironment(keywordsText)}
                    isPureIdMode={inputClassification.isPureId}
                />

                {/* 1. Unified Overview & Control Center */}
                    <OverviewSection
                        state={state}
                        totalInputs={totalInputs}
                        serviceFaulted={state.health?.status === 'faulted'}
                        onStart={() => handleStartAutomation()}
                        onStop={handleStopAutomation}
                        onRetryFailed={handleRetryFailed}
                        onLaunchBrowser={launchBrowser}
                        onOpenPages={openPages}
                        onRefreshEnv={() => checkEnvironment(keywordsText)}
                        onClearLogs={clearLogs}
                    />

                    {/* 2. Dual Config Panels (Collapsible) */}
                    <div className="flex flex-col gap-2">
                        {/* Collapsible toggle & summary ribbon */}
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 shadow-xs backdrop-blur-sm">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                                    <span>任务配置</span>
                                </div>
                                <span className="text-slate-300 hidden sm:inline">|</span>
                                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-medium">
                                    漫剧: {totalInputs} 部{inputClassification.isPureId ? ' (纯ID)' : ''}
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-cyan-50 text-cyan-700 font-medium">
                                    搭剧链接: {state.copyUrls.length} 条
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono font-medium">
                                    ROI: {state.roiRatio}
                                </span>
                                {state.taskNamePrefix && (
                                    <span className="px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 font-medium">
                                        任务名: {state.taskNamePrefix}-1...
                                    </span>
                                )}
                                {state.dailyBudget && (
                                    <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-mono font-medium">
                                        日预算: ¥{state.dailyBudget}
                                    </span>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => setConfigCollapsed(prev => !prev)}
                                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer ml-auto"
                            >
                                <span>{configCollapsed ? '展开编辑配置' : '收起配置'}</span>
                                {configCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                            </button>
                        </div>

                        {/* Panels Body */}
                        {!configCollapsed && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                                <DramaEditorPanel
                                    value={keywordsText}
                                    onChange={setKeywordsText}
                                    onLoadConfig={loadConfig}
                                    onSaveConfig={handleSaveKeywords}
                                />

                                <PlacementConfigPanel
                                    copyUrls={state.copyUrls}
                                    onUpdateCopyUrls={setCopyUrls}
                                    roiRatio={state.roiRatio}
                                    onUpdateRoiRatio={setRoiRatio}
                                    paidTemplate={state.paidTemplate}
                                    onUpdatePaidTemplate={setPaidTemplate}
                                    taskNamePrefix={state.taskNamePrefix}
                                    onUpdateTaskNamePrefix={setTaskNamePrefix}
                                    dailyBudget={state.dailyBudget}
                                    onUpdateDailyBudget={setDailyBudget}
                                    onLoadConfig={loadConfig}
                                    onSaveRoiRatio={handleSaveRoiRatio}
                                    onSavePaidTemplate={handleSavePaidTemplate}
                                    onSaveTaskNamePrefix={handleSaveTaskNamePrefix}
                                    onSaveDailyBudget={handleSaveDailyBudget}
                                    onSaveCopyUrls={handleSaveCopyUrls}
                                />
                            </div>
                        )}
                    </div>

                    {/* 3. Automated Pipeline Stepper */}
                    <PipelineStepper
                        status={state.status}
                        activeStep={activeStep}
                    />

                    {/* 4. Monitoring View Tabs & Content */}
                    <div className="flex flex-col gap-3">
                        {/* Tab switcher bar */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                            <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl border border-slate-200 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('combined')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                                        activeTab === 'combined'
                                            ? 'bg-white text-indigo-600 shadow-xs'
                                            : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    <Layers className="w-3.5 h-3.5" />
                                    <span>完整看板 (表格 + 终端)</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveTab('table')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                                        activeTab === 'table'
                                            ? 'bg-white text-indigo-600 shadow-xs'
                                            : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    <Table className="w-3.5 h-3.5" />
                                    <span>仅看记录表格</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveTab('logs')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                                        activeTab === 'logs'
                                            ? 'bg-white text-indigo-600 shadow-xs'
                                            : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    <Terminal className="w-3.5 h-3.5" />
                                    <span>实时控制台终端</span>
                                    {errorLogCount > 0 && (
                                        <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold animate-pulse">
                                            {errorLogCount}
                                        </span>
                                    )}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveTab('history')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                                        activeTab === 'history'
                                            ? 'bg-white text-indigo-600 shadow-xs'
                                            : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    <History className="w-3.5 h-3.5" />
                                    <span>历史运行核对</span>
                                </button>
                            </div>
                        </div>

                        {/* Tab Content Display */}
                        <div className="flex flex-col gap-4">
                            {/* Combined mode: Table + History + Logs */}
                            {activeTab === 'combined' && (
                                <>
                                    <ExecutionTable
                                        items={state.items}
                                        onViewDetail={setSelectedModalItem}
                                    />
                                    <RunHistoryPanel />
                                    <TerminalLogs
                                        logs={state.logs}
                                        onClearLogs={clearLogs}
                                    />
                                </>
                            )}

                            {/* Table only mode */}
                            {activeTab === 'table' && (
                                <ExecutionTable
                                    items={state.items}
                                    onViewDetail={setSelectedModalItem}
                                />
                            )}

                            {/* Logs only mode */}
                            {activeTab === 'logs' && (
                                <TerminalLogs
                                    logs={state.logs}
                                    onClearLogs={clearLogs}
                                />
                            )}

                            {/* History only mode */}
                            {activeTab === 'history' && (
                                <RunHistoryPanel />
                            )}
                        </div>
                    </div>
                </main>

            {/* Detail View Modal */}
            <DetailModal
                item={selectedModalItem}
                onClose={() => setSelectedModalItem(null)}
            />
        </div>
    );
};
