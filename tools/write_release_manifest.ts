import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files: Array<{ path: string; bytes: number; sha256: string }> = [];
function collect(relative: string): void {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`发布文件不能为符号链接：${relative}`);
    if (stat.isDirectory()) {
        for (const name of fs.readdirSync(absolute).sort()) collect(`${relative}/${name}`);
    } else if (stat.isFile()) {
        files.push({ path: relative, bytes: stat.size, sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') });
    }
}

const lockFile = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm-lock.yaml' : 'package-lock.json';
for (const entry of ['src', 'package.json', lockFile, 'tools/launcher', 'node/node.exe', 'R3-Web.exe', '启动.bat']) {
    if (fs.existsSync(path.join(root, entry))) collect(entry);
    else if (entry !== 'R3-Web.exe') throw new Error(`发布文件缺失：${entry}`);
}
files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
const version = createHash('sha256').update(JSON.stringify(files)).digest('hex');
const manifest = {
    schemaVersion: 1,
    version: version.slice(0, 16),
    contentSha256: version,
    builtAt: new Date().toISOString(),
    retention: 'latest-only',
    rollback: { available: false, reason: '构建不保留旧版本；回滚需要外部完整发布包备份' },
    dependencyLock: lockFile,
    files,
};
const target = path.join(root, 'release-manifest.json');
const temporary = `${target}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
fs.renameSync(temporary, target);
console.log(`发布清单已生成：${manifest.version}，${files.length} 个文件，仅保留最新版本。`);
