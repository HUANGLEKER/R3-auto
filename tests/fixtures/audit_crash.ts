import fs from 'node:fs';
import path from 'node:path';
import { AuditStore } from '../../src/core/audit_store.ts';

const directory = process.argv[2];
if (!directory) throw new Error('缺少隔离数据目录');
const store = new AuditStore(directory);
store.saveConfig({ roiRatio: '0.95', paidTemplate: '中额' });
store.beginRun('interrupted-run', { status: 'running', startedAt: 1, items: [{ index: 1 }] });
store.operation('interrupted-run', 'paid:7684258927520778290', 'intent', { seriesId: '7684258927520778290' });
store.operation('interrupted-run', 'page:1', 'submitting', { tabIndex: 1 });
fs.writeFileSync(path.join(directory, 'roi系数.txt'), '9');
// Abrupt exit before exporting the remaining files or updating the authoritative config.
process.exit(9);
