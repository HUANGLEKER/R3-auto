// Local Web Console entry point started by R3-Web.exe or npm start.
import { spawn } from 'node:child_process';
import { startServer, closeServer } from './server.ts';
import { automationBridge } from './automation_bridge.ts';
import { onServiceFault } from '../core/service_health.ts';
import { getAuditStore } from '../core/audit_store.ts';

process.title = 'R3 漫剧自动化 Web 控制台';

const instanceId = process.env.R3_WEB_INSTANCE_ID;
const isIpcMode = Boolean(instanceId && typeof process.send === 'function');
if (instanceId && !process.send) {
    throw new Error('IPC 模式下必须提供有效的进程通信通道');
}

let closing = false;
let shutdownPromise: Promise<void> | undefined;

function openBrowser(url: string): void {
    if (process.env.R3_NO_OPEN_BROWSER === '1' || isIpcMode) return;
    try {
        if (process.platform === 'win32') {
            const child = spawn('cmd.exe', ['/c', 'start', '', url], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.unref();
        }
    } catch (_) {}
}

onServiceFault(health => {
    if (isIpcMode) {
        process.send?.({ type: 'r3:fault', instanceId, pid: process.pid, message: health.reason });
    }
    const deadline = setTimeout(() => {
        try { getAuditStore().recoverInterrupted(); } catch (_) {}
        process.exit(1);
    }, 90000);
    void shutdown().then(() => {
        clearTimeout(deadline);
        process.exitCode = 1;
    }, () => {
        try { getAuditStore().recoverInterrupted(); } catch (_) {}
        process.exit(1);
    });
});

const starting = startServer();

function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    shutdownPromise = (async () => {
        await automationBridge.shutdown();
        await starting.catch(() => {});
        await closeServer();
        if (process.connected) process.disconnect?.();
    })();
    return shutdownPromise;
}

if (isIpcMode) {
    process.on('message', message => {
        if (
            message &&
            typeof message === 'object' &&
            'type' in message &&
            'instanceId' in message &&
            message.type === 'r3:shutdown' &&
            message.instanceId === instanceId
        ) {
            void shutdown();
        }
    });
    process.once('disconnect', () => { void shutdown(); });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
        void shutdown().finally(() => {
            process.exit(0);
        });
    });
}

starting.then(port => {
    if (closing) return;
    const url = `http://127.0.0.1:${port}`;
    if (isIpcMode) {
        process.send?.({ type: 'r3:ready', instanceId, pid: process.pid, port });
    } else {
        console.log('💡 浏览器将自动打开控制台页面；关闭此窗口即可停止后台服务。\n');
        openBrowser(url);
    }
}).catch(error => {
    console.error('Web backend start failed:', error);
    if (isIpcMode) {
        process.send?.({ type: 'r3:error', instanceId, pid: process.pid, message: error.message }, () => {
            if (process.connected) process.disconnect?.();
        });
    }
    process.exitCode = 1;
});
