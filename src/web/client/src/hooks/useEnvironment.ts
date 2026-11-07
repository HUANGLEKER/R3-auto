import { useState, useCallback, useEffect, useRef } from 'react';
import type { EnvInfo } from '../types.ts';
import { useToast } from '../context/ToastContext.tsx';

export function useEnvironment(currentInput: string = '') {
    const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const { showToast } = useToast();
    const inputRef = useRef(currentInput);
    const requestRef = useRef<{ id: number; controller?: AbortController }>({ id: 0 });
    const lastErrorRef = useRef('');
    inputRef.current = currentInput;

    const checkEnvironment = useCallback(async (inputKeywords?: string) => {
        requestRef.current.controller?.abort();
        const controller = new AbortController();
        const id = ++requestRef.current.id;
        requestRef.current.controller = controller;
        try {
            setLoading(true);
            const target = inputKeywords !== undefined ? inputKeywords : inputRef.current;
            const keywords = target.split('\n').map(value => value.trim()).filter(Boolean);
            const res = await fetch('/api/env', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keywords }), signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.ok || !data.env) throw new Error(data.error || '检测返回无效结果');
            if (id !== requestRef.current.id) return;
            setEnvInfo(data.env);
            lastErrorRef.current = '';
        } catch (error: any) {
            if (controller.signal.aborted || id !== requestRef.current.id) return;
            setEnvInfo(null);
            if (lastErrorRef.current !== error.message) showToast(`环境检测失败：${error.message}`, 'error');
            lastErrorRef.current = error.message;
        } finally {
            if (id === requestRef.current.id) setLoading(false);
        }
    }, [showToast]);

    const launchBrowser = useCallback(async () => {
        try {
            const res = await fetch('/api/env/launch-chrome', { method: 'POST' });
            const data = await res.json();
            showToast(data.message || '指令已发送', data.ok ? 'success' : 'error');
            setTimeout(() => checkEnvironment(), 2000);
        } catch (e: any) {
            showToast(`启动调试浏览器失败: ${e.message}`, 'error');
        }
    }, [checkEnvironment, showToast]);

    const openPages = useCallback(async () => {
        try {
            const activeInput = inputRef.current.trim();
            const keywords = activeInput ? activeInput.split('\n').map(s => s.trim()).filter(Boolean) : undefined;
            const res = await fetch('/api/env/open-pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keywords }),
            });
            const data = await res.json();
            if (data.ok) {
                showToast(`已成功打开并验证 ${data.opened} 个页面`, 'success');
            } else {
                const missing = (data.missingPages || []).join('、');
                showToast(`仍缺少页面: ${missing}，请在常读中切换上下文后刷新检测`, 'warning');
            }
            setTimeout(() => checkEnvironment(), 2000);
        } catch (e: any) {
            showToast(`打开页面失败: ${e.message}`, 'error');
        }
    }, [checkEnvironment, showToast]);

    // Initial check and periodic polling
    useEffect(() => {
        checkEnvironment(inputRef.current);
        const interval = setInterval(() => {
            checkEnvironment(inputRef.current);
        }, 10000);
        return () => {
            clearInterval(interval);
            requestRef.current.id++;
            requestRef.current.controller?.abort();
        };
    }, [checkEnvironment]);

    // Debounced check when currentInput changes
    useEffect(() => {
        const timer = setTimeout(() => {
            checkEnvironment(currentInput);
        }, 350);
        return () => clearTimeout(timer);
    }, [currentInput, checkEnvironment]);

    return {
        envInfo,
        loading,
        checkEnvironment,
        launchBrowser,
        openPages,
    };
}
