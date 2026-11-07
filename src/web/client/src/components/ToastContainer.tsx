import React from 'react';
import { useToast } from '../context/ToastContext.tsx';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
    const { toasts, removeToast } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-16 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
            {toasts.map(toast => {
                let bg = 'bg-white/95 border-slate-200 text-slate-800 shadow-xl shadow-slate-900/10';
                let icon = <Info className="w-4 h-4 text-sky-500 shrink-0" />;

                if (toast.type === 'success') {
                    bg = 'bg-white/95 border-emerald-200 text-emerald-900 shadow-xl shadow-emerald-500/10';
                    icon = <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
                } else if (toast.type === 'error') {
                    bg = 'bg-white/95 border-rose-200 text-rose-900 shadow-xl shadow-rose-500/10';
                    icon = <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />;
                } else if (toast.type === 'warning') {
                    bg = 'bg-white/95 border-amber-200 text-amber-900 shadow-xl shadow-amber-500/10';
                    icon = <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />;
                }

                return (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border backdrop-blur-md transition-all duration-300 transform translate-x-0 ${bg}`}
                    >
                        {icon}
                        <span className="text-xs font-medium leading-relaxed flex-1 break-words">
                            {toast.message}
                        </span>
                        <button
                            onClick={() => removeToast(toast.id)}
                            className="text-slate-400 hover:text-slate-700 transition-colors p-0.5 cursor-pointer"
                            title="关闭"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};
