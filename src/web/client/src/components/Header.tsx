import React from 'react';
import type { TaskStatus } from '../types.ts';
import { Cpu } from 'lucide-react';

interface HeaderProps {
    status: TaskStatus;
}

export const Header: React.FC<HeaderProps> = ({ status }) => {
    let statusText = '系统就绪待命';
    let statusClass = 'bg-slate-100 border-slate-300 text-slate-700';
    let dotClass = 'bg-slate-400';

    if (status === 'running') {
        statusText = '自动化执行中...';
        statusClass = 'bg-sky-50 border-sky-300 text-sky-700';
        dotClass = 'bg-sky-500 animate-ping';
    } else if (status === 'completed') {
        statusText = '任务已全部完成';
        statusClass = 'bg-emerald-50 border-emerald-300 text-emerald-700';
        dotClass = 'bg-emerald-500';
    } else if (status === 'error' || status === 'aborted') {
        statusText = status === 'error' ? '运行发生异常中断' : '任务已终止';
        statusClass = 'bg-rose-50 border-rose-300 text-rose-700';
        dotClass = 'bg-rose-500';
    }

    return (
        <header className="sticky top-0 z-40 w-full h-14 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 flex items-center justify-between transition-colors shadow-xs">
            {/* Left: Brand Identity */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 via-sky-500 to-cyan-400 flex items-center justify-center shadow-md shadow-indigo-500/20 text-white">
                    <Cpu className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-sm tracking-tight text-slate-900">
                            R3 漫剧自动化控制台
                        </span>
                        <span className="px-1.5 py-0.2 text-[10px] font-extrabold uppercase rounded bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                            PRO
                        </span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium">
                        常读分销 + 搭剧自动填写
                    </span>
                </div>
            </div>

            {/* Right: Status */}
            <div className="flex items-center gap-3">
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium shadow-xs transition-all ${statusClass}`}>
                    <span className="relative flex h-2 w-2">
                        <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClass}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${status === 'running' ? 'bg-sky-500' : dotClass}`}></span>
                    </span>
                    <span>{statusText}</span>
                </div>
            </div>
        </header>
    );
};
