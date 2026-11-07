import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

function startWorker(dataDir: string) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/run_lock_worker.ts', import.meta.url))], {
        env: { ...process.env, R3_DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
    });
    return child;
}
function message(child: ChildProcess, type: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('lock worker timeout')); }, 5000);
        const cleanup = () => { clearTimeout(timeout); child.off('message', onMessage); child.off('exit', onExit); };
        const onMessage = (value: any) => { if (value?.type === type) { cleanup(); resolve(value); } };
        const onExit = () => { cleanup(); reject(new Error('lock worker exited')); };
        child.on('message', onMessage); child.once('exit', onExit);
    });
}

for (const stale of [false, true]) test(`多进程同时${stale ? '回收失效锁' : '首次获取锁'}只能放行一个实例`, { timeout: 15000 }, async () => {
    assert.ok(process.env.R3_DATA_DIR);
    const dir = fs.mkdtempSync(path.join(process.env.R3_DATA_DIR, 'lock-race-'));
    if (stale) fs.writeFileSync(path.join(dir, 'full_flow_unified.run.lock'), JSON.stringify({ pid: 99999999 }));
    const workers = Array.from({ length: 6 }, () => startWorker(dir));
    const exits = workers.map(child => once(child, 'exit'));
    try {
        await Promise.all(workers.map(child => message(child, 'ready')));
        const results = workers.map(child => message(child, 'result'));
        workers.forEach(child => child.send('acquire'));
        const outcomes = await Promise.all(results);
        assert.equal(outcomes.filter(value => value.acquired).length, 1);
        const winner = workers[outcomes.findIndex(value => value.acquired)];
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'full_flow_unified.run.lock'), 'utf8')).pid, winner.pid);
        workers.forEach(child => child.send('release'));
        await Promise.all(exits);
        assert.equal(fs.existsSync(path.join(dir, 'full_flow_unified.run.lock')), false);
    } finally {
        for (const child of workers) if (child.exitCode === null && child.signalCode === null) child.kill();
        await Promise.all(exits);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
