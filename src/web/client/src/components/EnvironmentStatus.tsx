import React from 'react';
import type { EnvInfo } from '../types.ts';
import { RefreshCw, Monitor, Globe, FileText, Activity } from 'lucide-react';

interface EnvironmentStatusProps {
    envInfo: EnvInfo | null;
    loading: boolean;
    onRefresh: () => void;
    isPureIdMode?: boolean;
}

export const EnvironmentStatus: React.FC<EnvironmentStatusProps> = ({
    envInfo,
    loading,
    onRefresh,
    isPureIdMode = false,
}) => {
    const isPureId = isPureIdMode || (envInfo?.requiresFreeList === false);
    // Status helpers
    const cdpOk = envInfo?.cdpConnected ?? false;
    const freeListOk = envInfo ? (isPureId ? true : envInfo.topology.freeList) : false;
    const stagePageOk = envInfo?.topology.stagePage ?? false;

    return (
        <section className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-xs backdrop-blur-sm">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 mb-3">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-500" />
                    <h3 className="text-xs font-bold text-slate-800 tracking-tight">
                        系统环境状态
                    </h3>
                </div>
                <button
                    type="button"
                    onClick={onRefresh}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
                    title="刷新检测"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-500' : 'text-slate-500'}`} />
                    <span className="text-[11px]">刷新检测</span>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. Edge CDP */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/70 flex items-center justify-center shrink-0 shadow-2xs">
                            <Monitor className="w-4 h-4 text-slate-500" />
                        </div>
                        <div className="min-w-0">
                            <div className="font-semibold text-xs text-slate-800 truncate">
                                Edge (CDP 9224)
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                                {cdpOk ? `通信正常 (${envInfo?.tabs.length || 0} 标签)` : '未连接 (需启动 9224)'}
                            </div>
                        </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ml-2 ${
                        cdpOk
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                        {cdpOk ? '正常' : '异常'}
                    </span>
                </div>

                {/* 2. Changdu Free List */}
                <div className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                    isPureId
                        ? 'bg-slate-50/60 border-slate-200/80'
                        : 'bg-slate-50 border-slate-100'
                }`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/70 flex items-center justify-center shrink-0 shadow-2xs">
                            <Globe className="w-4 h-4 text-slate-500" />
                        </div>
                        <div className="min-w-0">
                            <div className="font-semibold text-xs text-slate-800 flex items-center gap-1.5 truncate">
                                <span className="truncate">常读·免费漫剧列表</span>
                                {isPureId && (
                                    <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-sky-50 text-sky-600 border border-sky-200/60 shrink-0">
                                        免打开
                                    </span>
                                )}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                                {isPureId
                                    ? '纯 ID 输入，直连 API 无需此页'
                                    : freeListOk
                                    ? '页面加载成功'
                                    : '未检测到页面'}
                            </div>
                        </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ml-2 ${
                        isPureId
                            ? 'bg-slate-100 text-slate-600 border-slate-200'
                            : freeListOk
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                        {isPureId ? '不需要' : freeListOk ? '正常' : '未打开'}
                    </span>
                </div>

                {/* 3. Stage Task Page */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/70 flex items-center justify-center shrink-0 shadow-2xs">
                            <FileText className="w-4 h-4 text-slate-500" />
                        </div>
                        <div className="min-w-0">
                            <div className="font-semibold text-xs text-slate-800 truncate">
                                搭剧平台·任务页
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                                {stagePageOk ? '已就绪' : '未打开或未登录'}
                            </div>
                        </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ml-2 ${
                        stagePageOk
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                        {stagePageOk ? '正常' : '未打开'}
                    </span>
                </div>
            </div>
        </section>
    );
};
