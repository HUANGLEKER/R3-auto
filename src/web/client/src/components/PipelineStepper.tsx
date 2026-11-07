import React from 'react';
import type { TaskStatus } from '../types.ts';
import { Check } from 'lucide-react';

interface PipelineStepperProps {
    status: TaskStatus;
    activeStep: number;
}

export const PipelineStepper: React.FC<PipelineStepperProps> = ({
    status,
    activeStep,
}) => {
    const isRunning = status === 'running';

    const steps = [
        { num: 1, title: '1 只读查询', sub: '免费/付费列表' },
        { num: 2, title: '2 资质核对', sub: '状态与授权校验' },
        { num: 3, title: '3 提取作品 ID', sub: '抖音 long ID 校验' },
        { num: 4, title: '4 渠道对齐', sub: '双渠道一致性确认' },
        { num: 5, title: '5 搭剧精准填单', sub: '匹配提交与自愈' },
    ];

    let badgeText = '待命';
    let badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
    let dotClass = 'bg-slate-400';

    if (isRunning) {
        badgeText = '运行中';
        badgeClass = 'bg-sky-50 text-sky-700 border-sky-300';
        dotClass = 'bg-sky-500 animate-ping';
    } else if (status === 'completed') {
        badgeText = '已完成';
        badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-300';
        dotClass = 'bg-emerald-500';
    }

    return (
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm backdrop-blur-sm overflow-hidden transition-colors">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-5">
                <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-600 text-xs font-bold flex items-center justify-center">
                        3
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                        自动化流水线实时进度
                    </span>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium ${badgeClass}`}>
                    <span className="relative flex h-2 w-2">
                        <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClass}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${isRunning ? 'bg-sky-500' : dotClass}`}></span>
                    </span>
                    <span>{badgeText}</span>
                </div>
            </div>

            {/* Stepper Flow */}
            <div className="flex items-center justify-between w-full overflow-x-auto py-2">
                {steps.map((step, idx) => {
                    const isDone = isRunning ? step.num < activeStep : status === 'completed';
                    const isActive = isRunning && step.num === activeStep;

                    let nodeStyle = 'border-slate-300 bg-slate-100 text-slate-500';
                    if (isDone) {
                        nodeStyle = 'border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/30';
                    } else if (isActive) {
                        nodeStyle = 'border-sky-400 bg-sky-500 text-white shadow-lg shadow-sky-500/40 ring-4 ring-sky-500/20 animate-pulse';
                    }

                    return (
                        <React.Fragment key={step.num}>
                            {/* Step Node */}
                            <div className="flex flex-col items-center min-w-[120px] text-center shrink-0">
                                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all duration-300 ${nodeStyle}`}>
                                    {isDone ? <Check className="w-4 h-4 stroke-[3]" /> : step.num}
                                </div>
                                <div className="mt-2.5">
                                    <div className={`text-xs font-semibold tracking-tight transition-colors ${
                                        isActive ? 'text-sky-600 font-bold' : isDone ? 'text-emerald-600' : 'text-slate-700'
                                    }`}>
                                        {step.title}
                                    </div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                        {step.sub}
                                    </div>
                                </div>
                            </div>

                            {/* Connecting Line */}
                            {idx < steps.length - 1 && (
                                <div className="flex-1 mx-2 h-1 bg-slate-200 rounded-full overflow-hidden shrink-0 min-w-[30px]">
                                    <div
                                        className="h-full bg-emerald-500 transition-all duration-500"
                                        style={{
                                            width: isDone
                                                ? '100%'
                                                : isActive
                                                ? '50%'
                                                : '0%',
                                        }}
                                    />
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </section>
    );
};
