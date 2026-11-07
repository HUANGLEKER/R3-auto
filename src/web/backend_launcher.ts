import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface LaunchBackendOptions {
    nodeExe: string;
    serverScript: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}

export interface LaunchedBackend {
    child: ChildProcess;
    ready: Promise<string>;
    shutdown(): Promise<void>;
}

/** Dedicated IPC channel identifies the spawned backend, never a service found by port scanning. */
export function launchBackend({
    nodeExe,
    serverScript,
    cwd,
    env = process.env,
    timeoutMs = 15000,
}: LaunchBackendOptions): LaunchedBackend {
    const instanceId = randomUUID();
    const child = spawn(nodeExe, [serverScript], {
        cwd,
        env: { ...env, R3_WEB_INSTANCE_ID: instanceId, R3_NO_OPEN_BROWSER: '1' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
    });
    const exited = new Promise<void>(resolve => {
        child.once('exit', () => resolve());
        child.once('error', () => resolve());
    });
    const ready = new Promise<string>((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            child.off('message', onMessage);
            child.off('error', onError);
            child.off('exit', onExit);
        };
        const fail = (error: Error) => {
            cleanup();
            reject(error);
        };
        const onError = (error: Error) => fail(error);
        const onExit = (code: number | null) => fail(new Error(`后台服务在就绪前退出（${code}）`));
        const onMessage = (message: any) => {
            if (!message || message.instanceId !== instanceId || message.pid !== child.pid) return;
            if (message.type === 'r3:error') return fail(new Error(String(message.message || '后台服务启动失败')));
            if (message.type !== 'r3:ready' || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) return;
            cleanup();
            resolve(`http://127.0.0.1:${message.port}`);
        };
        const timer = setTimeout(() => {
            fail(new Error('后台服务 IPC 就绪握手超时'));
            child.kill();
        }, timeoutMs);
        child.on('message', onMessage);
        child.once('error', onError);
        child.once('exit', onExit);
    });
    return {
        child,
        ready,
        async shutdown() {
            if (child.connected) {
                child.send({ type: 'r3:shutdown', instanceId }, () => {});
            }
            await exited;
        },
    };
}
