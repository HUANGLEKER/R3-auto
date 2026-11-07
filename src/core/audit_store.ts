import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {faultService} from './service_health.ts';

export class AuditStore {
    private db: DatabaseSync;
    private onFailure: (error: unknown) => void;
    private pendingEvents: Array<{
        runId: string;
        seq: number;
        kind: string;
        payload: string;
        items: Array<{ index: number; payload: string }>;
        header?: { status: string; finishedAt: number | null; payload: string };
    }> = [];
    private pendingOperations: Array<{
        runId: string;
        id: string;
        status: string;
        payload: string;
    }> = [];
    private flushTimer: NodeJS.Timeout | null = null;
    private readonly maxBatch = 30;
    private readonly batchDelayMs = 20;

    constructor(directory: string, onFailure: (error: unknown) => void = () => {
    }) {
        this.onFailure = onFailure;
        fs.mkdirSync(directory, {recursive: true});
        this.db = new DatabaseSync(path.join(directory, 'r3_state.sqlite'));
        this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
            CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, started INTEGER NOT NULL, finished INTEGER, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS run_configs (run_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS items (run_id TEXT NOT NULL, item_id INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,item_id));
            CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,seq));
            CREATE TABLE IF NOT EXISTS operations (run_id TEXT NOT NULL, operation_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,operation_id));`);

        try {
            process.once('beforeExit', () => this.flushPending());
            process.once('exit', () => this.flushPending());
        } catch (_) {}
    }

    flushPending(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.pendingEvents.length === 0 && this.pendingOperations.length === 0) {
            return;
        }
        const events = this.pendingEvents;
        const operations = this.pendingOperations;
        this.pendingEvents = [];
        this.pendingOperations = [];

        this.transaction(() => {
            if (events.length > 0) {
                const insertEvent = this.db.prepare('INSERT INTO events VALUES (?,?,?,?)');
                const updateItem = this.db.prepare('UPDATE items SET payload=? WHERE run_id=? AND item_id=?');
                const updateRun = this.db.prepare('UPDATE runs SET status=?,finished=?,payload=? WHERE id=?');

                for (const ev of events) {
                    insertEvent.run(ev.runId, ev.seq, ev.kind, ev.payload);
                    for (const item of ev.items) {
                        updateItem.run(item.payload, ev.runId, item.index);
                    }
                    if (ev.header) {
                        updateRun.run(ev.header.status, ev.header.finishedAt, ev.header.payload, ev.runId);
                    }
                }
            }

            if (operations.length > 0) {
                const insertOp = this.db.prepare(
                    'INSERT INTO operations VALUES (?,?,?,?) ON CONFLICT(run_id,operation_id) DO UPDATE SET status=excluded.status,payload=excluded.payload'
                );
                for (const op of operations) {
                    insertOp.run(op.runId, op.id, op.status, op.payload);
                }
            }
        });
    }

    transaction<T>(operation: () => T): T {
        let began = false;
        try {
            this.db.exec('BEGIN IMMEDIATE');
            began = true;
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            if (began) {
                try {
                    this.db.exec('ROLLBACK');
                } catch (_) {
                }
            }
            this.onFailure(error);
            throw error;
        }
    }

    recoverInterrupted(): void {
        this.flushPending();
        this.transaction(() => this.db.exec(`UPDATE runs
                                             SET status='needs_review',
                                                 finished=NULL
                                             WHERE status = 'running';
        UPDATE operations
        SET status='uncertain'
        WHERE status IN ('intent', 'submitting');`));
    }

    config(): Record<string, unknown> | null {
        this.flushPending();
        const row = this.db.prepare('SELECT payload FROM config WHERE id=1').get();
        return row ? JSON.parse(String(row.payload)) : null;
    }

    saveConfig(payload: unknown): void {
        this.flushPending();
        this.transaction(() => this.db.prepare('INSERT INTO config VALUES (1,1,?) ON CONFLICT(id) DO UPDATE SET version=version+1,payload=excluded.payload').run(JSON.stringify(payload)));
    }

    beginRun(id: string, payload: {
        status: string;
        startedAt: number | null;
        items: Array<{ index: number }>
    }, config?: unknown): void {
        this.flushPending();
        this.transaction(() => {
            const {items, ...header} = payload;
            this.db.prepare('INSERT INTO runs VALUES (?,?,?,NULL,?)').run(id, 'running', payload.startedAt ?? Date.now(), JSON.stringify(header));
            if (config) this.db.prepare('INSERT INTO run_configs VALUES (?,?)').run(id, JSON.stringify(config));
            const insert = this.db.prepare('INSERT INTO items VALUES (?,?,?)');
            for (const item of items) insert.run(id, item.index, JSON.stringify(item));
        });
    }

    event(id: string, seq: number, kind: string, payload: unknown, items: Array<{ index: number }> = [], header?: {
        status: string;
        finishedAt: number | null
    }): void {
        // 重复 seq 即时冲突检测，保证与 SQLite 主键约束契约一致
        if (this.pendingEvents.some(e => e.runId === id && e.seq === seq)) {
            const err = new Error('UNIQUE constraint failed: events.run_id, events.seq');
            (err as any).code = 'ERR_SQLITE_ERROR';
            this.onFailure(err);
            throw err;
        }

        const existing = this.db.prepare('SELECT seq FROM events WHERE run_id=? AND seq=?').get(id, seq);
        if (existing) {
            const err = new Error('UNIQUE constraint failed: events.run_id, events.seq');
            (err as any).code = 'ERR_SQLITE_ERROR';
            this.onFailure(err);
            throw err;
        }

        this.pendingEvents.push({
            runId: id,
            seq,
            kind,
            payload: JSON.stringify(payload),
            items: items.map(item => ({ index: item.index, payload: JSON.stringify(item) })),
            header: header ? { status: header.status, finishedAt: header.finishedAt, payload: JSON.stringify(header) } : undefined
        });

        if (this.pendingEvents.length + this.pendingOperations.length >= this.maxBatch) {
            this.flushPending();
        } else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flushPending(), this.batchDelayMs);
        }
    }

    operation(runId: string, id: string, status: string, payload: unknown): void {
        this.pendingOperations.push({
            runId,
            id,
            status,
            payload: JSON.stringify(payload)
        });

        if (this.pendingEvents.length + this.pendingOperations.length >= this.maxBatch) {
            this.flushPending();
        } else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flushPending(), this.batchDelayMs);
        }
    }

    history(): unknown[] {
        this.flushPending();
        return this.db.prepare('SELECT id,status,started,finished FROM runs ORDER BY started DESC LIMIT 100').all();
    }

    run(id: string, offset = 0, limit = 200): unknown {
        this.flushPending();
        const header = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
        if (!header) return null;
        return {
            ...header, payload: JSON.parse(String(header.payload)),
            config: JSON.parse(String(this.db.prepare('SELECT payload FROM run_configs WHERE run_id=?').get(id)?.payload ?? 'null')),
            totalItems: Number(this.db.prepare('SELECT COUNT(*) AS count FROM items WHERE run_id=?').get(id)?.count ?? 0),
            items: this.db.prepare('SELECT payload FROM items WHERE run_id=? ORDER BY item_id LIMIT ? OFFSET ?').all(id, limit, offset).map(row => JSON.parse(String(row.payload))),
            operations: this.db.prepare('SELECT operation_id,status,payload FROM operations WHERE run_id=?').all(id).map(row => ({
                ...row,
                payload: JSON.parse(String(row.payload))
            }))
        };
    }

    close(): void {
        this.flushPending();
        this.db.close();
    }
}

let store: AuditStore | undefined;

export function getAuditStore(): AuditStore {
    if (!store) {
        try {
            store = new AuditStore(process.env.R3_DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data'), faultService);
            store.recoverInterrupted();
        } catch (error) {
            faultService(error);
            throw error;
        }
    }
    return store;
}
