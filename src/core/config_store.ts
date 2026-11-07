import fs from 'node:fs';
import {randomUUID} from 'node:crypto';

/** Stage every file before replacing any; restore earlier replacements if a commit fails. */
export function writeConfigTransaction(files: Array<{ path: string; content: string | Buffer }>): void {
    const token = randomUUID();
    const entries = files.map(file => ({
        ...file,
        previous: fs.existsSync(file.path) ? fs.readFileSync(file.path) : null,
        staged: `${file.path}.${token}.new`,
        backup: `${file.path}.${token}.backup`,
    }));
    const committed: typeof entries = [];
    let preserveBackups = false;
    const writeDurable = (target: string, content: string | Buffer) => {
        const fd = fs.openSync(target, 'wx');
        try {
            fs.writeFileSync(fd, content);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
    };
    try {
        for (const entry of entries) {
            writeDurable(entry.staged, entry.content);
            if (entry.previous !== null) writeDurable(entry.backup, entry.previous);
        }
        for (const entry of entries) {
            fs.renameSync(entry.staged, entry.path);
            committed.push(entry);
        }
    } catch (cause) {
        const recoveryErrors: string[] = [];
        for (const entry of committed.reverse()) {
            try {
                if (entry.previous !== null) fs.renameSync(entry.backup, entry.path);
                else fs.unlinkSync(entry.path);
            } catch (error: any) {
                preserveBackups = true;
                recoveryErrors.push(`${entry.path}: ${error.message}; 备份=${entry.backup}`);
            }
        }
        throw new Error(recoveryErrors.length
            ? `配置保存与回滚失败，请用保留备份恢复：${recoveryErrors.join('；')}`
            : '配置保存失败，原配置已保留', {cause});
    } finally {
        for (const entry of entries) {
            try {
                fs.rmSync(entry.staged, {force: true});
            } catch (_) {
            }
            if (!preserveBackups) {
                try {
                    fs.rmSync(entry.backup, {force: true});
                } catch (_) {
                }
            }
        }
    }
}
