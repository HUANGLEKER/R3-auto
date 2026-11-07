import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeConfigTransaction } from '../../src/core/config_store.ts';

test('配置事务：目标异常和第二次提交失败均保留整份原配置', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-config-'));
    const a = path.join(dir, 'roi.txt'), b = path.join(dir, 'panel.txt');
    try {
        fs.writeFileSync(a, '0.95');
        fs.mkdirSync(b);
        assert.throws(() => writeConfigTransaction([{ path: a, content: '1.25' }, { path: b, content: '中额' }]));
        assert.equal(fs.readFileSync(a, 'utf8'), '0.95');
        fs.rmdirSync(b);
        fs.writeFileSync(b, '超小额');
        const rename = fs.renameSync;
        const mocked = mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
            if (to === b && String(from).endsWith('.new')) throw new Error('模拟文件锁');
            return rename(from, to);
        });
        try {
            assert.throws(() => writeConfigTransaction([{ path: a, content: '1.25' }, { path: b, content: '中额' }]), /原配置已保留/);
            assert.equal(fs.readFileSync(a, 'utf8'), '0.95');
            assert.equal(fs.readFileSync(b, 'utf8'), '超小额');
            assert.deepEqual(fs.readdirSync(dir).sort(), ['panel.txt', 'roi.txt']);
        } finally { mocked.mock.restore(); }
        writeConfigTransaction([{ path: a, content: '1.25' }, { path: b, content: '中额' }]);
        assert.equal(fs.readFileSync(a, 'utf8'), '1.25');
        assert.equal(fs.readFileSync(b, 'utf8'), '中额');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('配置事务：回滚失败明确报错并保留恢复备份', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-config-'));
    const a = path.join(dir, 'a'), b = path.join(dir, 'b');
    fs.writeFileSync(a, 'original'); fs.writeFileSync(b, 'old');
    const rename = fs.renameSync;
    const mocked = mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
        if (to === b || String(from).endsWith('.backup')) throw new Error('模拟磁盘故障');
        return rename(from, to);
    });
    try {
        assert.throws(() => writeConfigTransaction([{ path: a, content: 'new' }, { path: b, content: 'new' }]), /回滚失败.*保留备份/);
        const backup = fs.readdirSync(dir).find(name => name.startsWith('a.') && name.endsWith('.backup'))!;
        assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), 'original');
    } finally { mocked.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); }
});
