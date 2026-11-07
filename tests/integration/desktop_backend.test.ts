import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { launchBackend } from '../../src/web/backend_launcher.ts';

const serverScript = fileURLToPath(new URL('../../src/web/main.ts', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/backend_ipc.ts', import.meta.url));

test('本地 Web 服务 IPC 回传实际端口，忽略已占用端口上的其他服务，并可正常退出', { timeout: 15000 }, async () => {
    assert.ok(process.env.R3_DATA_DIR);
    const occupied = http.createServer((_req, res) => res.end('not our backend'));
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    const port = (occupied.address() as any).port;
    const backend = launchBackend({ nodeExe: process.execPath, serverScript, cwd: process.cwd(), env: { ...process.env, PORT: String(port) } });
    backend.child.stdout.resume();
    let errors = ''; backend.child.stderr.on('data', data => { errors += data; });
    try {
        const url = await backend.ready as string;
        assert.notEqual(new URL(url).port, String(port));
        assert.equal(new URL(url).hostname, '127.0.0.1');
        const status = await (await fetch(url + '/api/status')).json();
        assert.equal(status.state.status, 'idle');
        assert.match(await (await fetch(url)).text(), /<html/i);
        backend.child.send({ type: 'r3:shutdown', instanceId: 'wrong' });
        assert.equal((await fetch(url + '/api/status')).status, 200);
    } finally {
        await backend.shutdown();
        occupied.close();
        assert.equal(backend.child.exitCode, 0, errors);
    }
});

test('握手只接受对应子进程标识，不使用 stdout 中的 URL', async () => {
    const backend = launchBackend({ nodeExe: process.execPath, serverScript: fixture, cwd: process.cwd() });
    backend.child.stdout.resume(); backend.child.stderr.resume();
    try { assert.equal(await backend.ready, 'http://127.0.0.1:32123'); }
    finally { await backend.shutdown(); }
});

for (const mode of ['exit', 'timeout']) test('IPC 握手失败：' + mode, { timeout: 5000 }, async () => {
    const backend = launchBackend({ nodeExe: process.execPath, serverScript: fixture, cwd: process.cwd(),
        env: { ...process.env, IPC_TEST_MODE: mode }, timeoutMs: 1000 });
    backend.child.stdout.resume(); backend.child.stderr.resume();
    await assert.rejects(backend.ready, /就绪前退出|握手超时/);
    await backend.shutdown();
});
