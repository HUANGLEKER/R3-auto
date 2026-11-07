import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { ToastProvider } from './context/ToastContext.tsx';
import './index.css';

// 确保彻底清除暗色主题类与历史记录
document.documentElement.classList.remove('dark');
try {
    localStorage.removeItem('r3_theme');
} catch (_) {}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <ToastProvider>
            <App />
        </ToastProvider>
    </React.StrictMode>
);
